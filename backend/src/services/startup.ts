/**
 * Startup service
 * Handles initialization of runners and pools when the server starts
 */

import { db, type RunnerRow, type RunnerPoolRow } from '../db/index.js';
import { ensureWarmRunners } from './autoscaler.js';
import { 
  startRunner, 
  isRunnerRunning, 
  syncRunnerStatus,
  isRunnerProcessAlive,
  trackOrphanedRunner,
  stopOrphanedRunner,
  removeRunner
} from './runnerManager.js';
import { startDockerRunner, syncDockerRunnerStatus, isDockerAvailable, removeDockerRunner, getContainerStatus } from './dockerRunner.js';
import { startReconciler } from './reconciler.js';

// Prepared statements
const getAllEnabledPools = db.prepare(`
  SELECT * FROM runner_pools WHERE enabled = 1
`);

const getNonEphemeralRunners = db.prepare(`
  SELECT * FROM runners WHERE ephemeral = 0 AND status NOT IN ('error', 'removing')
`);

const getPooledEphemeralRunners = db.prepare(`
  SELECT * FROM runners WHERE ephemeral = 1 AND pool_id IS NOT NULL AND status NOT IN ('error', 'removing')
`);

const updateRunnerStatus = db.prepare(`
  UPDATE runners SET status = ?, updated_at = datetime('now') WHERE id = ?
`);

const deleteRunner = db.prepare('DELETE FROM runners WHERE id = ?');

/**
 * Initialize all runners and pools on server startup
 */
export async function initializeRunnersOnStartup(): Promise<void> {
  console.log('🔄 Initializing runners...');

  // Check Docker availability once
  const dockerAvailable = await isDockerAvailable();
  if (!dockerAvailable) {
    console.log('ℹ️  Docker not available - skipping Docker runner initialization');
  }

  // 1. Clean up stale ephemeral runners FIRST (before creating new ones)
  await cleanupStaleEphemeralRunners(dockerAvailable);

  // 2. Handle non-ephemeral (static) runners - try to restart them
  await restartStaticRunners(dockerAvailable);

  // 3. Ensure warm runners for all enabled pools
  await initializePoolWarmRunners(dockerAvailable);

  // 4. Start the periodic reconciliation service
  startReconciler();

  console.log('✅ Runner initialization complete');
}

/**
 * Restart non-ephemeral (static) runners that should persist across server restarts
 */
async function restartStaticRunners(dockerAvailable: boolean): Promise<void> {
  const runners = getNonEphemeralRunners.all() as RunnerRow[];
  
  if (runners.length === 0) {
    console.log('ℹ️  No static runners to restart');
    return;
  }

  console.log(`🔄 Checking ${runners.length} static runner(s)...`);

  for (const runner of runners) {
    try {
      if (runner.isolation_type === 'docker') {
        if (!dockerAvailable) {
          console.log(`⚠️  Skipping Docker runner ${runner.name} - Docker not available`);
          updateRunnerStatus.run('offline', runner.id);
          continue;
        }

        // For Docker runners, sync status and restart if needed
        await syncDockerRunnerStatus(runner.id);
        const updatedRunner = db.prepare('SELECT * FROM runners WHERE id = ?').get(runner.id) as RunnerRow;
        
        if (updatedRunner.status === 'offline') {
          console.log(`🐳 Restarting Docker runner ${runner.name}...`);
          await startDockerRunner(runner.id);
        } else {
          console.log(`✓ Docker runner ${runner.name} is ${updatedRunner.status}`);
        }
      } else {
        // For native runners, check if process is still running
        // First check our in-memory map (will be empty after restart)
        if (isRunnerRunning(runner.id)) {
          console.log(`✓ Native runner ${runner.name} is already tracked`);
          await syncRunnerStatus(runner.id);
        } else if (isRunnerProcessAlive(runner.id, runner.process_id)) {
          // Process is still running from before restart - track as orphaned
          console.log(`🔗 Native runner ${runner.name} found still running (PID: ${runner.process_id}), reattaching...`);
          if (runner.process_id) {
            trackOrphanedRunner(runner.id, runner.process_id);
          }
          // Sync status with GitHub to see if it's actually working
          await syncRunnerStatus(runner.id);
          console.log(`✓ Reattached to runner ${runner.name}`);
        } else if (runner.runner_dir) {
          // Process is not running - clear stale PID and restart
          if (runner.process_id) {
            console.log(`ℹ️  Clearing stale PID ${runner.process_id} for runner ${runner.name}`);
            db.prepare('UPDATE runners SET process_id = NULL WHERE id = ?').run(runner.id);
          }
          console.log(`🔄 Restarting native runner ${runner.name}...`);
          updateRunnerStatus.run('pending', runner.id);
          await startRunner(runner.id, runner.runner_dir);
        } else {
          console.log(`⚠️  Native runner ${runner.name} has no runner_dir, marking offline`);
          updateRunnerStatus.run('offline', runner.id);
        }
      }
    } catch (error) {
      console.error(`❌ Failed to restart runner ${runner.name}:`, error);
      updateRunnerStatus.run('error', runner.id);
    }
  }
}

/**
 * Clean up stale ephemeral runners that were left over from a previous server run
 * Ephemeral runners should not persist across restarts - they get recreated by the pool
 * This now properly cleans up processes/containers, not just DB records
 */
async function cleanupStaleEphemeralRunners(dockerAvailable: boolean): Promise<void> {
  const staleRunners = getPooledEphemeralRunners.all() as RunnerRow[];
  
  if (staleRunners.length === 0) {
    return;
  }

  console.log(`🧹 Cleaning up ${staleRunners.length} stale ephemeral runner(s)...`);

  for (const runner of staleRunners) {
    try {
      console.log(`  Removing stale runner ${runner.name}...`);
      
      // Clean up the actual resources (process/container and files)
      if (runner.isolation_type === 'docker') {
        if (dockerAvailable && runner.container_id) {
          // Check if container exists and stop/remove it
          const status = await getContainerStatus(runner.container_id);
          if (status) {
            console.log(`    Removing Docker container for ${runner.name}`);
            await removeDockerRunner(runner.id).catch(err => {
              console.warn(`    Warning: Could not remove container for ${runner.name}:`, err.message);
            });
          }
        }
      } else {
        // Native runner - stop any orphaned process and clean up files
        if (runner.process_id && isRunnerProcessAlive(runner.id, runner.process_id)) {
          console.log(`    Stopping orphaned process for ${runner.name} (PID: ${runner.process_id})`);
          await stopOrphanedRunner(runner.id, runner.process_id).catch(err => {
            console.warn(`    Warning: Could not stop process for ${runner.name}:`, err.message);
          });
        }
        
        // Clean up runner files
        if (runner.runner_dir) {
          await removeRunner(runner.id).catch(err => {
            console.warn(`    Warning: Could not clean files for ${runner.name}:`, err.message);
          });
        }
      }
      
      // Delete the database record
      deleteRunner.run(runner.id);
      console.log(`  ✓ Cleaned up ${runner.name}`);
    } catch (error) {
      console.error(`  Failed to cleanup runner ${runner.name}:`, error);
    }
  }
}

/**
 * Initialize warm runners for all enabled pools
 */
async function initializePoolWarmRunners(dockerAvailable: boolean): Promise<void> {
  const pools = getAllEnabledPools.all() as RunnerPoolRow[];
  
  if (pools.length === 0) {
    console.log('ℹ️  No enabled pools to initialize');
    return;
  }

  console.log(`🏊 Initializing ${pools.length} runner pool(s)...`);

  for (const pool of pools) {
    try {
      // Skip Docker pools if Docker isn't available
      if (pool.isolation_type === 'docker' && !dockerAvailable) {
        console.log(`⚠️  Skipping Docker pool ${pool.name} - Docker not available`);
        continue;
      }

      console.log(`  Pool ${pool.name}: ensuring ${pool.warm_runners} warm runner(s)`);
      await ensureWarmRunners(pool);
    } catch (error) {
      console.error(`❌ Failed to initialize pool ${pool.name}:`, error);
    }
  }
}

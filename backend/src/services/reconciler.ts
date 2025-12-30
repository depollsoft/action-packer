/**
 * Runner Reconciliation Service
 * 
 * Periodically checks for orphaned runners and cleans them up.
 * This handles cases where:
 * - Webhooks were missed (network issues, server downtime)
 * - GitHub removed runners that we still have records for
 * - Local processes died without triggering our cleanup handlers
 * - Runner directories exist on disk without corresponding database entries
 */

import fs from 'fs/promises';
import path from 'path';
import { db, type RunnerRow, type RunnerPoolRow } from '../db/index.js';
import { createClientFromCredentialId } from './credentialResolver.js';
import { cleanupRunnerFiles, isRunnerProcessAlive, stopOrphanedRunner, RUNNERS_DIR } from './runnerManager.js';
import { removeDockerRunner, getContainerStatus } from './dockerRunner.js';
import { ensureWarmRunners } from './autoscaler.js';

// Reconciliation interval (5 minutes)
const RECONCILE_INTERVAL_MS = 5 * 60 * 1000;

// Maximum time for a single reconciliation run (2 minutes)
const RECONCILE_TIMEOUT_MS = 2 * 60 * 1000;

// Track if reconciliation is running to prevent overlap
let isReconciling = false;
let reconcileTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Helper to add timeout to a promise (properly cleans up timer to avoid leaks)
 */
function withTimeout<T>(promise: Promise<T>, ms: number, operation: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`${operation} timed out after ${ms}ms`));
    }, ms);

    promise.then(
      (value) => {
        clearTimeout(timeoutId);
        resolve(value);
      },
      (err) => {
        clearTimeout(timeoutId);
        reject(err);
      }
    );
  });
}

// Prepared statements
const getAllRunners = db.prepare('SELECT * FROM runners WHERE status NOT IN (\'error\', \'removing\')');
const getAllEnabledPools = db.prepare('SELECT * FROM runner_pools WHERE enabled = 1');
const deleteRunner = db.prepare('DELETE FROM runners WHERE id = ?');
const updateRunnerStatus = db.prepare('UPDATE runners SET status = ?, updated_at = datetime(\'now\') WHERE id = ?');

/**
 * Start the periodic reconciliation service
 */
export function startReconciler(): void {
  if (reconcileTimer) {
    console.log('[reconciler] Already running');
    return;
  }

  console.log(`[reconciler] Starting reconciliation service (interval: ${RECONCILE_INTERVAL_MS / 1000}s)`);
  
  // Run immediately on start, then periodically
  setTimeout(() => {
    reconcileRunners().catch(err => {
      console.error('[reconciler] Initial reconciliation failed:', err);
    });
  }, 10000); // Wait 10s after startup for things to settle
  
  reconcileTimer = setInterval(() => {
    reconcileRunners().catch(err => {
      console.error('[reconciler] Periodic reconciliation failed:', err);
    });
  }, RECONCILE_INTERVAL_MS);
  
  reconcileTimer.unref(); // Don't prevent process from exiting
}

/**
 * Stop the reconciliation service
 */
export function stopReconciler(): void {
  if (reconcileTimer) {
    clearInterval(reconcileTimer);
    reconcileTimer = null;
    console.log('[reconciler] Stopped');
  }
}

/**
 * Main reconciliation logic
 */
export async function reconcileRunners(): Promise<void> {
  if (isReconciling) {
    console.log('[reconciler] Skipping - reconciliation already in progress');
    return;
  }

  isReconciling = true;
  console.log('[reconciler] Starting reconciliation...');

  // Use withTimeout to properly clean up timers
  try {
    await withTimeout(
      reconcileRunnersInternal(),
      RECONCILE_TIMEOUT_MS,
      'Reconciliation'
    );
  } catch (error) {
    console.error('[reconciler] Reconciliation failed:', error);
  } finally {
    isReconciling = false;
  }
}

/**
 * Internal reconciliation logic (called with timeout wrapper)
 */
async function reconcileRunnersInternal(): Promise<void> {
  const stats = {
    checked: 0,
    orphanedRemoved: 0,
    staleRemoved: 0,
    errorsFixed: 0,
  };

  // Group runners by credential to minimize API calls
  const runners = getAllRunners.all() as RunnerRow[];
  const runnersByCredential = new Map<string, RunnerRow[]>();
  
  for (const runner of runners) {
    const existing = runnersByCredential.get(runner.credential_id) || [];
    existing.push(runner);
    runnersByCredential.set(runner.credential_id, existing);
  }

  // Check each credential's runners against GitHub (with per-credential timeout)
  for (const [credentialId, localRunners] of runnersByCredential) {
    try {
      const client = await createClientFromCredentialId(credentialId);
      
      // Add 30s timeout for GitHub API calls
      const ghRunners = await withTimeout(
        client.listRunners(),
        30000,
        `listRunners for credential ${credentialId}`
      );
      const ghRunnerIds = new Set(ghRunners.map(r => r.id));
      const ghRunnerNames = new Set(ghRunners.map(r => r.name));

        for (const runner of localRunners) {
          stats.checked++;

          // Check if runner exists in GitHub (by ID or name)
          const existsInGitHub = 
            (runner.github_runner_id && ghRunnerIds.has(runner.github_runner_id)) ||
            ghRunnerNames.has(runner.name);

          if (!existsInGitHub) {
            // Runner doesn't exist in GitHub - it's orphaned
            console.log(`[reconciler] Runner ${runner.name} not found in GitHub, cleaning up...`);
            await cleanupOrphanedRunner(runner);
            stats.orphanedRemoved++;
            continue;
          }

          // Check if the local process/container is actually running
          if (runner.isolation_type === 'docker') {
            if (runner.container_id) {
              const containerStatus = await getContainerStatus(runner.container_id);
              if (!containerStatus && runner.status === 'online') {
                // Container doesn't exist but we think it's online
                console.log(`[reconciler] Docker runner ${runner.name} container not found, marking offline`);
                updateRunnerStatus.run('offline', runner.id);
                stats.errorsFixed++;
              }
            } else if (runner.status === 'online') {
              // No container_id but marked online - something is wrong
              console.log(`[reconciler] Docker runner ${runner.name} has no container_id, marking offline`);
              updateRunnerStatus.run('offline', runner.id);
              stats.errorsFixed++;
            }
          } else {
            // Native runner
            const processAlive = isRunnerProcessAlive(runner.id, runner.process_id);
            if (!processAlive && runner.status === 'online') {
              console.log(`[reconciler] Native runner ${runner.name} process not found, marking offline`);
              updateRunnerStatus.run('offline', runner.id);
              stats.errorsFixed++;
            }
          }
        }
      } catch (error) {
        console.error(`[reconciler] Failed to check runners for credential ${credentialId}:`, error);
      }
    }

    // Check for stale runners (no heartbeat in a long time)
    const staleThresholdMinutes = 30;
    const staleRunners = db.prepare(`
      SELECT * FROM runners 
      WHERE ephemeral = 1 
      AND status IN ('online', 'busy')
      AND last_heartbeat < datetime('now', ?)
    `).all(`-${staleThresholdMinutes} minutes`) as RunnerRow[];

    for (const runner of staleRunners) {
      console.log(`[reconciler] Runner ${runner.name} has stale heartbeat, checking status...`);
      try {
        // Try to sync with GitHub before cleaning up (with timeout)
        const client = await createClientFromCredentialId(runner.credential_id);
        let ghRunner;
        
        if (runner.github_runner_id) {
          try {
            ghRunner = await withTimeout(
              client.getRunner(runner.github_runner_id),
              15000,
              `getRunner ${runner.github_runner_id}`
            );
          } catch {
            // Runner doesn't exist in GitHub or timed out
          }
        }
        
        if (!ghRunner) {
          // Runner is truly orphaned
          console.log(`[reconciler] Stale runner ${runner.name} not found in GitHub, cleaning up...`);
          await cleanupOrphanedRunner(runner);
          stats.staleRemoved++;
        } else {
          // Runner exists but maybe just not checking in - update heartbeat
          db.prepare('UPDATE runners SET last_heartbeat = datetime(\'now\') WHERE id = ?').run(runner.id);
        }
      } catch (error) {
        console.error(`[reconciler] Failed to check stale runner ${runner.name}:`, error);
      }
    }

    // Ensure warm runners for all pools
    const pools = getAllEnabledPools.all() as RunnerPoolRow[];
    for (const pool of pools) {
      try {
        await ensureWarmRunners(pool);
      } catch (error) {
        console.error(`[reconciler] Failed to ensure warm runners for pool ${pool.name}:`, error);
      }
    }

    // Clean up orphaned directories (exist on disk but not in database)
    const orphanedDirsRemoved = await cleanupOrphanedDirectories();
    if (orphanedDirsRemoved > 0) {
      stats.orphanedRemoved += orphanedDirsRemoved;
    }

    console.log(`[reconciler] Reconciliation complete:`, stats);
}

/**
 * Clean up an orphaned runner (exists locally but not in GitHub)
 * Uses direct file cleanup instead of removeRunner() to avoid unnecessary
 * GitHub API calls and deregistration scripts for runners that are already gone.
 */
async function cleanupOrphanedRunner(runner: RunnerRow): Promise<void> {
  try {
    // Check if runner still exists in database (may have been cleaned up concurrently)
    const currentRunner = db.prepare('SELECT id FROM runners WHERE id = ?').get(runner.id);
    if (!currentRunner) {
      console.log(`[reconciler] Runner ${runner.name} already cleaned up by another process`);
      return;
    }

    // Stop any running process/container
    if (runner.isolation_type === 'docker') {
      await removeDockerRunner(runner.id).catch(() => {});
    } else {
      // Stop any orphaned native process
      await stopOrphanedRunner(runner.id, runner.process_id).catch(() => {});
      // Clean up files directly (no GitHub API calls needed for orphaned runners)
      await cleanupRunnerFiles(runner.runner_dir);
    }

    // Delete the database record (idempotent)
    deleteRunner.run(runner.id);
    console.log(`[reconciler] Cleaned up orphaned runner ${runner.name}`);
  } catch (error) {
    console.error(`[reconciler] Failed to cleanup runner ${runner.name}:`, error);
  }
}

/**
 * Clean up orphaned runner directories (exist on disk but not in database)
 * This catches cases where cleanup failed partway through, leaving directories behind.
 */
async function cleanupOrphanedDirectories(): Promise<number> {
  let removed = 0;
  
  try {
    // Check if runners directory exists
    try {
      await fs.access(RUNNERS_DIR);
    } catch {
      // Directory doesn't exist, nothing to clean up
      return 0;
    }

    // List all directories in the runners directory
    const entries = await fs.readdir(RUNNERS_DIR, { withFileTypes: true });
    const directories = entries.filter(e => e.isDirectory()).map(e => e.name);

    if (directories.length === 0) {
      return 0;
    }

    // Get all runner IDs from the database
    const dbRunners = db.prepare('SELECT id, runner_dir FROM runners').all() as { id: string; runner_dir: string | null }[];
    const dbRunnerIds = new Set(dbRunners.map(r => r.id));
    
    // Also track runner directories that are in use
    const dbRunnerDirs = new Set(
      dbRunners
        .filter(r => r.runner_dir)
        .map(r => path.basename(r.runner_dir!))
    );

    // Find directories that don't have a corresponding database entry
    for (const dir of directories) {
      // Skip if this directory ID exists in the database or if the path is in use
      if (dbRunnerIds.has(dir) || dbRunnerDirs.has(dir)) {
        continue;
      }

      // This is an orphaned directory - remove it
      const dirPath = path.join(RUNNERS_DIR, dir);
      console.log(`[reconciler] Removing orphaned runner directory: ${dir}`);
      
      try {
        await fs.rm(dirPath, { recursive: true, force: true });
        removed++;
      } catch (error) {
        console.error(`[reconciler] Failed to remove orphaned directory ${dir}:`, error);
      }
    }

    if (removed > 0) {
      console.log(`[reconciler] Removed ${removed} orphaned runner director${removed === 1 ? 'y' : 'ies'}`);
    }
  } catch (error) {
    console.error('[reconciler] Failed to clean up orphaned directories:', error);
  }

  return removed;
}

import { v4 as uuidv4 } from 'uuid';
import { db, type CredentialRow, type RunnerPoolRow } from '../db/index.js';
import { createClientFromCredentialId } from './credentialResolver.js';
import { createDockerRunner, removeDockerRunner } from './dockerRunner.js';
import { downloadRunner, configureRunner, startRunner } from './runnerManager.js';

const getPoolRunnerCounts = db.prepare(`
  SELECT 
    COUNT(*) as total,
    SUM(CASE WHEN status IN ('online', 'busy', 'configuring', 'pending') THEN 1 ELSE 0 END) as active,
    SUM(CASE WHEN status = 'online' THEN 1 ELSE 0 END) as idle,
    SUM(CASE WHEN status = 'busy' THEN 1 ELSE 0 END) as busy
  FROM runners
  WHERE pool_id = ?
`);

const getIdlePoolRunner = db.prepare(`
  SELECT * FROM runners
  WHERE pool_id = ? AND status = 'online' AND ephemeral = 1
  ORDER BY created_at ASC
  LIMIT 1
`);

const getCredentialById = db.prepare('SELECT * FROM credentials WHERE id = ?');

/**
 * Check if a pool's runners would be eligible to run a job based on labels.
 * 
 * Per GitHub's documentation: "a self-hosted runner must have ALL [requested] labels 
 * to be eligible to process the job" - labels operate cumulatively.
 * 
 * This means: ALL job labels must be present in the pool's labels.
 * The pool's label set must be a superset of (or equal to) the job's requested labels.
 * 
 * Examples:
 * - Pool: ["self-hosted", "linux", "docker"], Job: ["self-hosted", "linux"] → MATCH
 * - Pool: ["self-hosted", "linux", "docker"], Job: ["self-hosted", "docker"] → MATCH  
 * - Pool: ["self-hosted", "linux"], Job: ["self-hosted", "linux", "docker"] → NO MATCH (pool lacks "docker")
 * - Pool: ["self-hosted", "linux", "gpu"], Job: ["self-hosted", "linux", "docker"] → NO MATCH (pool lacks "docker")
 */
export function labelsMatch(poolLabels: string[], jobLabels: string[]): boolean {
  // If job requests no labels, any pool matches
  if (jobLabels.length === 0) return true;

  // All job labels must be present in pool labels (case-insensitive)
  const poolLabelsLower = poolLabels.map(l => l.toLowerCase());
  return jobLabels.every(jobLabel => poolLabelsLower.includes(jobLabel.toLowerCase()));
}

/**
 * Get the effective labels for a pool, including default labels that GitHub
 * automatically applies based on the runner's OS and architecture.
 * 
 * GitHub adds these default labels to all self-hosted runners:
 * - "self-hosted" (always)
 * - OS label: "linux", "macos", or "windows"
 * - Architecture label: "x64", "arm64", or "arm"
 * 
 * Note: Docker isolation always runs Linux containers, regardless of host OS.
 */
export function getPoolEffectiveLabels(pool: RunnerPoolRow): string[] {
  const customLabels = JSON.parse(pool.labels) as string[];
  
  // Determine the effective OS for the runner
  // Docker containers always run Linux regardless of host OS
  let effectivePlatform = pool.platform;
  if (pool.isolation_type === 'docker') {
    effectivePlatform = 'linux';
  }
  
  // Map platform to GitHub's OS label
  const osLabel = {
    'linux': 'Linux',
    'darwin': 'macOS',
    'win32': 'Windows',
  }[effectivePlatform] || effectivePlatform;
  
  // Map architecture to GitHub's arch label
  const archLabel = {
    'x64': 'X64',
    'arm64': 'ARM64',
  }[pool.architecture] || pool.architecture;
  
  // Combine default labels with custom labels (avoiding duplicates)
  const defaultLabels = ['self-hosted', osLabel, archLabel];
  const allLabels = [...defaultLabels];
  
  for (const label of customLabels) {
    if (!allLabels.some(l => l.toLowerCase() === label.toLowerCase())) {
      allLabels.push(label);
    }
  }
  
  return allLabels;
}

/**
 * Scale up: create a new ephemeral runner for the pool.
 */
export async function scaleUp(pool: RunnerPoolRow): Promise<string | null> {
  try {
    const counts = getPoolRunnerCounts.get(pool.id) as any;

    if (counts.active >= pool.max_runners) {
      console.log(`[autoscale] Pool ${pool.name}: at max capacity (${counts.active}/${pool.max_runners})`);
      return null;
    }

    console.log(`[autoscale] Pool ${pool.name}: scaling up (${counts.active}/${pool.max_runners})`);

    const runnerName = `${pool.name}-${uuidv4().slice(0, 8)}`;
    const labels = JSON.parse(pool.labels);

    const runnerId = uuidv4();
    const insertRunner = db.prepare(`
      INSERT INTO runners (id, name, credential_id, platform, architecture, isolation_type, labels, ephemeral, pool_id, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, 'pending')
    `);

    insertRunner.run(
      runnerId,
      runnerName,
      pool.credential_id,
      pool.platform,
      pool.architecture,
      pool.isolation_type,
      pool.labels,
      pool.id
    );

    void (async () => {
      try {
        if (pool.isolation_type === 'docker') {
          await createDockerRunner(runnerId, runnerName, labels, pool.credential_id, pool.architecture, true, {
            enableKvm: Boolean(pool.enable_kvm),
            enableDockerSocket: Boolean(pool.enable_docker_socket),
            enablePrivileged: Boolean(pool.enable_privileged),
          });
          return;
        }

        const runnerDir = await downloadRunner(runnerId, pool.credential_id);
        await configureRunner(runnerId, runnerName, labels, pool.credential_id, runnerDir, true);
        await startRunner(runnerId, runnerDir);

        // Best-effort: store GitHub runner ID for later updates.
        try {
          const client = await createClientFromCredentialId(pool.credential_id);
          const runners = await client.listRunners();
          const ghRunner = runners.find(r => r.name === runnerName);
          if (ghRunner) {
            db.prepare('UPDATE runners SET github_runner_id = ? WHERE id = ?').run(ghRunner.id, runnerId);
          }
        } catch (error) {
          console.error('[autoscale] Failed to get GitHub runner ID:', error);
        }
      } catch (error) {
        console.error(`[autoscale] Failed to create runner for pool ${pool.name}:`, error);
        const message = error instanceof Error ? error.message : 'Unknown error';
        db.prepare('UPDATE runners SET status = ?, error_message = ? WHERE id = ?').run('error', message, runnerId);
      }
    })();

    return runnerId;
  } catch (error) {
    console.error(`[autoscale] Failed to scale up pool ${pool.name}:`, error);
    return null;
  }
}

/**
 * Scale down: remove idle ephemeral runners if above minimum warm runners.
 */
export async function scaleDown(pool: RunnerPoolRow): Promise<void> {
  try {
    const counts = getPoolRunnerCounts.get(pool.id) as any;

    if (counts.idle <= pool.warm_runners) {
      console.log(`[autoscale] Pool ${pool.name}: at minimum warm runners (${counts.idle}/${pool.warm_runners})`);
      return;
    }

    console.log(`[autoscale] Pool ${pool.name}: scaling down (${counts.idle} idle, min ${pool.warm_runners})`);

    const runner = getIdlePoolRunner.get(pool.id) as any;
    if (!runner) return;

    if (runner.isolation_type === 'docker') {
      await removeDockerRunner(runner.id);
    } else {
      const { removeRunner } = await import('./runnerManager.js');
      await removeRunner(runner.id);
    }

    db.prepare('DELETE FROM runners WHERE id = ?').run(runner.id);
    console.log(`[autoscale] Removed runner ${runner.name} from pool ${pool.name}`);
  } catch (error) {
    console.error(`[autoscale] Failed to scale down pool ${pool.name}:`, error);
  }
}

/**
 * Ensure minimum warm runners for a pool.
 */
export async function ensureWarmRunners(pool: RunnerPoolRow): Promise<void> {
  const counts = getPoolRunnerCounts.get(pool.id) as any;

  const runnersNeeded = pool.warm_runners - counts.active;
  if (runnersNeeded <= 0) return;

  console.log(`[autoscale] Pool ${pool.name}: creating ${runnersNeeded} warm runners`);

  for (let i = 0; i < runnersNeeded; i++) {
    await scaleUp(pool);
  }
}

/**
 * Helper: fetch the pool row (used by routes when they only have the ID).
 */
export function getPoolById(poolId: string): RunnerPoolRow | undefined {
  return db.prepare('SELECT * FROM runner_pools WHERE id = ?').get(poolId) as RunnerPoolRow | undefined;
}

/**
 * Helper: resolve pool credential for callers that need it.
 */
export function getCredentialByPool(pool: RunnerPoolRow): CredentialRow {
  const credential = getCredentialById.get(pool.credential_id) as CredentialRow | undefined;
  if (!credential) throw new Error(`Credential not found for pool: ${pool.id}`);
  return credential;
}

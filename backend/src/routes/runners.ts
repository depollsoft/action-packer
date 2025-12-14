/**
 * Runners API routes
 * Handles runner creation, management, and status
 */

import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db, type RunnerRow, type CredentialRow } from '../db/index.js';
import { decrypt } from '../utils/index.js';
import {
  detectPlatform,
  stopRunner,
  startRunner,
  removeRunner,
  syncRunnerStatus,
  createDockerRunner,
  stopDockerRunner,
  startDockerRunner,
  removeDockerRunner,
  syncDockerRunnerStatus,
  isDockerAvailable,
  createGitHubClient,
  type GitHubScope,
} from '../services/index.js';

export const runnersRouter = Router();

type CreateRunnerBody = {
  name: string;
  credentialId: string;
  labels?: string[];
  platform?: 'darwin' | 'linux' | 'win32';
  architecture?: 'x64' | 'arm64';
  isolationType?: 'native' | 'docker' | 'tart' | 'hyperv';
  ephemeral?: boolean;
  poolId?: string;
};

type UpdateRunnerBody = {
  name?: string;
  labels?: string[];
};

// Prepared statements
const getAllRunners = db.prepare(`
  SELECT r.*, c.name as credential_name, c.scope, c.target
  FROM runners r
  JOIN credentials c ON r.credential_id = c.id
  ORDER BY r.created_at DESC
`);

const getRunnerById = db.prepare('SELECT * FROM runners WHERE id = ?');

const getRunnerWithCredential = db.prepare(`
  SELECT r.*, c.name as credential_name, c.scope, c.target
  FROM runners r
  JOIN credentials c ON r.credential_id = c.id
  WHERE r.id = ?
`);

const updateRunnerName = db.prepare(`
  UPDATE runners SET name = ?, updated_at = datetime('now') WHERE id = ?
`);

const updateRunnerLabels = db.prepare(`
  UPDATE runners SET labels = ?, updated_at = datetime('now') WHERE id = ?
`);

const deleteRunnerById = db.prepare('DELETE FROM runners WHERE id = ?');

const getCredentialById = db.prepare('SELECT * FROM credentials WHERE id = ?');

const getRunnersByPool = db.prepare(`
  SELECT r.*, c.name as credential_name, c.scope, c.target
  FROM runners r
  JOIN credentials c ON r.credential_id = c.id
  WHERE r.pool_id = ?
  ORDER BY r.created_at DESC
`);

const getRunnersByCredential = db.prepare(`
  SELECT r.*, c.name as credential_name, c.scope, c.target
  FROM runners r
  JOIN credentials c ON r.credential_id = c.id
  WHERE r.credential_id = ?
  ORDER BY r.created_at DESC
`);

/**
 * Get system info (platform, architecture, Docker availability)
 */
runnersRouter.get('/system-info', async (_req: Request, res: Response) => {
  try {
    const { platform, arch } = detectPlatform();
    const dockerAvailable = await isDockerAvailable();
    
    res.json({
      platform,
      architecture: arch,
      dockerAvailable,
      defaultIsolation: platform === 'linux' && dockerAvailable ? 'docker' : 'native',
      supportedIsolationTypes: [
        { type: 'native', available: true, description: 'Native runner (default for macOS/Windows)' },
        { type: 'docker', available: dockerAvailable, description: 'Docker container (Linux only)' },
        { type: 'tart', available: false, description: 'Tart VM (macOS only) - coming soon' },
        { type: 'hyperv', available: false, description: 'Hyper-V VM (Windows only) - coming soon' },
      ],
    });
  } catch (error) {
    console.error('Failed to get system info:', error);
    res.status(500).json({ error: 'Failed to get system info' });
  }
});

/**
 * List all runners
 */
runnersRouter.get('/', (req: Request, res: Response) => {
  try {
    const { credentialId, poolId } = req.query;
    
    let runners;
    if (poolId) {
      runners = getRunnersByPool.all(poolId);
    } else if (credentialId) {
      runners = getRunnersByCredential.all(credentialId);
    } else {
      runners = getAllRunners.all();
    }
    
    // Parse labels JSON
    const parsedRunners = (runners as any[]).map(r => ({
      ...r,
      labels: JSON.parse(r.labels || '[]'),
      ephemeral: Boolean(r.ephemeral),
    }));
    
    res.json({ runners: parsedRunners });
  } catch (error) {
    console.error('Failed to list runners:', error);
    res.status(500).json({ error: 'Failed to list runners' });
  }
});

/**
 * Get a single runner by ID
 */
runnersRouter.get('/:id', (req: Request, res: Response) => {
  try {
    const runner = getRunnerWithCredential.get(req.params.id) as any;
    
    if (!runner) {
      res.status(404).json({ error: 'Runner not found' });
      return;
    }
    
    res.json({
      runner: {
        ...runner,
        labels: JSON.parse(runner.labels || '[]'),
        ephemeral: Boolean(runner.ephemeral),
      },
    });
  } catch (error) {
    console.error('Failed to get runner:', error);
    res.status(500).json({ error: 'Failed to get runner' });
  }
});

/**
 * Create a new runner
 */
runnersRouter.post('/', async (req: Request, res: Response) => {
  try {
    const body = req.body as CreateRunnerBody;
    
    // Validate required fields
    if (!body.name || !body.credentialId) {
      res.status(400).json({ error: 'Missing required fields: name, credentialId' });
      return;
    }
    
    // Check credential exists
    const credential = getCredentialById.get(body.credentialId) as CredentialRow | undefined;
    if (!credential) {
      res.status(404).json({ error: 'Credential not found' });
      return;
    }
    
    // Determine platform and architecture
    const detected = detectPlatform();
    const platform = body.platform || detected.platform;
    const architecture = body.architecture || detected.arch;
    const isolationType = body.isolationType || 'native';
    const labels = body.labels || [];
    const ephemeral = body.ephemeral || false;
    
    // Validate isolation type
    if (isolationType === 'docker') {
      const dockerAvailable = await isDockerAvailable();
      if (!dockerAvailable) {
        res.status(400).json({ error: 'Docker is not available on this system' });
        return;
      }
    }
    
    if (isolationType === 'tart' || isolationType === 'hyperv') {
      res.status(400).json({ error: `${isolationType} isolation is not yet supported` });
      return;
    }
    
    // Create runner ID
    const id = uuidv4();
    
    // Insert runner record first
    const insertRunner = db.prepare(`
      INSERT INTO runners (id, name, credential_id, platform, architecture, isolation_type, labels, ephemeral, pool_id, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `);
    
    insertRunner.run(
      id,
      body.name,
      body.credentialId,
      platform,
      architecture,
      isolationType,
      JSON.stringify(labels),
      ephemeral ? 1 : 0,
      body.poolId || null
    );
    
    // Start async runner creation
    (async () => {
      try {
        if (isolationType === 'docker') {
          await createDockerRunner(id, body.name, labels, body.credentialId, architecture, ephemeral);
        } else {
          // For native runners, we need to use the full flow
          const { downloadRunner, configureRunner, startRunner: startNativeRunner } = await import('../services/runnerManager.js');
          
          const runnerDir = await downloadRunner(id, body.credentialId);
          await configureRunner(id, body.name, labels, body.credentialId, runnerDir, ephemeral);
          await startNativeRunner(id, runnerDir);
          
          // Get GitHub runner ID
          const token = decrypt({
            encrypted: credential.encrypted_token,
            iv: credential.iv,
            authTag: credential.auth_tag,
          });
          
          const client = createGitHubClient(token, credential.scope as GitHubScope, credential.target);
          const runners = await client.listRunners();
          const ghRunner = runners.find(r => r.name === body.name);
          
          if (ghRunner) {
            db.prepare('UPDATE runners SET github_runner_id = ? WHERE id = ?').run(ghRunner.id, id);
          }
        }
      } catch (error) {
        console.error('Failed to create runner:', error);
        const message = error instanceof Error ? error.message : 'Unknown error';
        db.prepare('UPDATE runners SET status = ?, error_message = ? WHERE id = ?')
          .run('error', message, id);
      }
    })();
    
    // Return immediately with pending status
    const runner = getRunnerWithCredential.get(id) as any;
    res.status(202).json({
      runner: {
        ...runner,
        labels: JSON.parse(runner.labels || '[]'),
        ephemeral: Boolean(runner.ephemeral),
      },
      message: 'Runner creation started',
    });
  } catch (error) {
    console.error('Failed to create runner:', error);
    res.status(500).json({ error: 'Failed to create runner' });
  }
});

/**
 * Update a runner
 */
runnersRouter.patch('/:id', async (req: Request, res: Response) => {
  try {
    const runner = getRunnerById.get(req.params.id) as RunnerRow | undefined;
    
    if (!runner) {
      res.status(404).json({ error: 'Runner not found' });
      return;
    }
    
    const body = req.body as UpdateRunnerBody;
    
    // Update name if provided
    if (body.name) {
      updateRunnerName.run(body.name, req.params.id);
    }
    
    // Update labels if provided
    if (body.labels) {
      updateRunnerLabels.run(JSON.stringify(body.labels), req.params.id);
      
      // Also update labels on GitHub if runner is registered
      if (runner.github_runner_id) {
        try {
          const credential = getCredentialById.get(runner.credential_id) as CredentialRow;
          const token = decrypt({
            encrypted: credential.encrypted_token,
            iv: credential.iv,
            authTag: credential.auth_tag,
          });
          
          const client = createGitHubClient(token, credential.scope as GitHubScope, credential.target);
          await client.setRunnerLabels(runner.github_runner_id, body.labels);
        } catch (error) {
          console.error('Failed to update labels on GitHub:', error);
          // Continue anyway - local update succeeded
        }
      }
    }
    
    const updated = getRunnerWithCredential.get(req.params.id) as any;
    res.json({
      runner: {
        ...updated,
        labels: JSON.parse(updated.labels || '[]'),
        ephemeral: Boolean(updated.ephemeral),
      },
    });
  } catch (error) {
    console.error('Failed to update runner:', error);
    res.status(500).json({ error: 'Failed to update runner' });
  }
});

/**
 * Delete a runner
 */
runnersRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    const runner = getRunnerById.get(req.params.id) as RunnerRow | undefined;
    
    if (!runner) {
      res.status(404).json({ error: 'Runner not found' });
      return;
    }
    
    // Remove the runner (stops process, deregisters from GitHub, cleans up files)
    if (runner.isolation_type === 'docker') {
      await removeDockerRunner(runner.id);
    } else {
      await removeRunner(runner.id);
    }
    
    // Delete from database
    deleteRunnerById.run(req.params.id);
    
    res.status(204).send();
  } catch (error) {
    console.error('Failed to delete runner:', error);
    res.status(500).json({ error: 'Failed to delete runner' });
  }
});

/**
 * Start a stopped runner
 */
runnersRouter.post('/:id/start', async (req: Request, res: Response) => {
  try {
    const runner = getRunnerById.get(req.params.id) as RunnerRow | undefined;
    
    if (!runner) {
      res.status(404).json({ error: 'Runner not found' });
      return;
    }
    
    if (runner.status === 'online' || runner.status === 'busy') {
      res.status(400).json({ error: 'Runner is already running' });
      return;
    }
    
    if (runner.isolation_type === 'docker') {
      await startDockerRunner(runner.id);
    } else {
      if (!runner.runner_dir) {
        res.status(400).json({ error: 'Runner directory not found' });
        return;
      }
      await startRunner(runner.id, runner.runner_dir);
    }
    
    const updated = getRunnerWithCredential.get(req.params.id) as any;
    res.json({
      runner: {
        ...updated,
        labels: JSON.parse(updated.labels || '[]'),
        ephemeral: Boolean(updated.ephemeral),
      },
    });
  } catch (error) {
    console.error('Failed to start runner:', error);
    res.status(500).json({ error: 'Failed to start runner' });
  }
});

/**
 * Stop a running runner
 */
runnersRouter.post('/:id/stop', async (req: Request, res: Response) => {
  try {
    const runner = getRunnerById.get(req.params.id) as RunnerRow | undefined;
    
    if (!runner) {
      res.status(404).json({ error: 'Runner not found' });
      return;
    }
    
    if (runner.status === 'offline') {
      res.status(400).json({ error: 'Runner is already stopped' });
      return;
    }
    
    if (runner.isolation_type === 'docker') {
      await stopDockerRunner(runner.id);
    } else {
      await stopRunner(runner.id);
    }
    
    const updated = getRunnerWithCredential.get(req.params.id) as any;
    res.json({
      runner: {
        ...updated,
        labels: JSON.parse(updated.labels || '[]'),
        ephemeral: Boolean(updated.ephemeral),
      },
    });
  } catch (error) {
    console.error('Failed to stop runner:', error);
    res.status(500).json({ error: 'Failed to stop runner' });
  }
});

/**
 * Sync runner status with GitHub
 */
runnersRouter.post('/:id/sync', async (req: Request, res: Response) => {
  try {
    const runner = getRunnerById.get(req.params.id) as RunnerRow | undefined;
    
    if (!runner) {
      res.status(404).json({ error: 'Runner not found' });
      return;
    }
    
    if (runner.isolation_type === 'docker') {
      await syncDockerRunnerStatus(runner.id);
    } else {
      await syncRunnerStatus(runner.id);
    }
    
    const updated = getRunnerWithCredential.get(req.params.id) as any;
    res.json({
      runner: {
        ...updated,
        labels: JSON.parse(updated.labels || '[]'),
        ephemeral: Boolean(updated.ephemeral),
      },
    });
  } catch (error) {
    console.error('Failed to sync runner status:', error);
    res.status(500).json({ error: 'Failed to sync runner status' });
  }
});

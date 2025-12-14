/**
 * Runner Pools API routes
 * Handles autoscaling pool configuration and management
 */

import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db, type RunnerPoolRow, type CredentialRow } from '../db/index.js';
import { decrypt, generateSecret } from '../utils/index.js';
import { createGitHubClient, type GitHubScope } from '../services/index.js';

export const poolsRouter = Router();

type CreatePoolBody = {
  name: string;
  credentialId: string;
  platform?: 'darwin' | 'linux' | 'win32';
  architecture?: 'x64' | 'arm64';
  isolationType?: 'native' | 'docker' | 'tart' | 'hyperv';
  labels?: string[];
  minRunners?: number;
  maxRunners?: number;
  warmRunners?: number;
  idleTimeoutMinutes?: number;
};

type UpdatePoolBody = {
  name?: string;
  labels?: string[];
  minRunners?: number;
  maxRunners?: number;
  warmRunners?: number;
  idleTimeoutMinutes?: number;
  enabled?: boolean;
};

// Prepared statements
const getAllPools = db.prepare(`
  SELECT p.*, c.name as credential_name, c.scope, c.target,
    (SELECT COUNT(*) FROM runners r WHERE r.pool_id = p.id) as runner_count,
    (SELECT COUNT(*) FROM runners r WHERE r.pool_id = p.id AND r.status = 'online') as online_count,
    (SELECT COUNT(*) FROM runners r WHERE r.pool_id = p.id AND r.status = 'busy') as busy_count
  FROM runner_pools p
  JOIN credentials c ON p.credential_id = c.id
  ORDER BY p.created_at DESC
`);

const getPoolById = db.prepare('SELECT * FROM runner_pools WHERE id = ?');

const getPoolWithStats = db.prepare(`
  SELECT p.*, c.name as credential_name, c.scope, c.target,
    (SELECT COUNT(*) FROM runners r WHERE r.pool_id = p.id) as runner_count,
    (SELECT COUNT(*) FROM runners r WHERE r.pool_id = p.id AND r.status = 'online') as online_count,
    (SELECT COUNT(*) FROM runners r WHERE r.pool_id = p.id AND r.status = 'busy') as busy_count
  FROM runner_pools p
  JOIN credentials c ON p.credential_id = c.id
  WHERE p.id = ?
`);

const insertPool = db.prepare(`
  INSERT INTO runner_pools (id, name, credential_id, platform, architecture, isolation_type, labels, min_runners, max_runners, warm_runners, idle_timeout_minutes)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const updatePoolName = db.prepare(`
  UPDATE runner_pools SET name = ?, updated_at = datetime('now') WHERE id = ?
`);

const updatePoolLabels = db.prepare(`
  UPDATE runner_pools SET labels = ?, updated_at = datetime('now') WHERE id = ?
`);

const updatePoolScaling = db.prepare(`
  UPDATE runner_pools SET min_runners = ?, max_runners = ?, warm_runners = ?, idle_timeout_minutes = ?, updated_at = datetime('now') WHERE id = ?
`);

const updatePoolEnabled = db.prepare(`
  UPDATE runner_pools SET enabled = ?, updated_at = datetime('now') WHERE id = ?
`);

const deletePoolById = db.prepare('DELETE FROM runner_pools WHERE id = ?');

const getCredentialById = db.prepare('SELECT * FROM credentials WHERE id = ?');

const getPoolRunners = db.prepare(`
  SELECT r.*, c.name as credential_name, c.scope, c.target
  FROM runners r
  JOIN credentials c ON r.credential_id = c.id
  WHERE r.pool_id = ?
  ORDER BY r.created_at DESC
`);

const getWebhookByCredential = db.prepare(`
  SELECT * FROM webhook_configs WHERE credential_id = ?
`);

const insertWebhook = db.prepare(`
  INSERT INTO webhook_configs (id, credential_id, secret, events)
  VALUES (?, ?, ?, ?)
`);

const updateWebhookId = db.prepare(`
  UPDATE webhook_configs SET webhook_id = ?, updated_at = datetime('now') WHERE id = ?
`);

const deleteWebhookById = db.prepare('DELETE FROM webhook_configs WHERE id = ?');

/**
 * List all pools
 */
poolsRouter.get('/', (_req: Request, res: Response) => {
  try {
    const pools = getAllPools.all() as any[];
    
    const parsedPools = pools.map(p => ({
      ...p,
      labels: JSON.parse(p.labels || '[]'),
      enabled: Boolean(p.enabled),
    }));
    
    res.json({ pools: parsedPools });
  } catch (error) {
    console.error('Failed to list pools:', error);
    res.status(500).json({ error: 'Failed to list pools' });
  }
});

/**
 * Get a single pool by ID
 */
poolsRouter.get('/:id', (req: Request, res: Response) => {
  try {
    const pool = getPoolWithStats.get(req.params.id) as any;
    
    if (!pool) {
      res.status(404).json({ error: 'Pool not found' });
      return;
    }
    
    res.json({
      pool: {
        ...pool,
        labels: JSON.parse(pool.labels || '[]'),
        enabled: Boolean(pool.enabled),
      },
    });
  } catch (error) {
    console.error('Failed to get pool:', error);
    res.status(500).json({ error: 'Failed to get pool' });
  }
});

/**
 * Create a new pool
 */
poolsRouter.post('/', async (req: Request, res: Response) => {
  try {
    const body = req.body as CreatePoolBody;
    
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
    
    // Defaults
    const platform = body.platform || process.platform as 'darwin' | 'linux' | 'win32';
    const architecture = body.architecture || (process.arch === 'arm64' ? 'arm64' : 'x64');
    const isolationType = body.isolationType || 'native';
    const labels = body.labels || [];
    const minRunners = body.minRunners ?? 0;
    const maxRunners = body.maxRunners ?? 5;
    const warmRunners = body.warmRunners ?? 1;
    const idleTimeoutMinutes = body.idleTimeoutMinutes ?? 10;
    
    // Validate scaling params
    if (minRunners < 0 || maxRunners < 1 || warmRunners < 0) {
      res.status(400).json({ error: 'Invalid scaling parameters' });
      return;
    }
    
    if (minRunners > maxRunners || warmRunners > maxRunners) {
      res.status(400).json({ error: 'minRunners and warmRunners cannot exceed maxRunners' });
      return;
    }
    
    const id = uuidv4();
    
    insertPool.run(
      id,
      body.name,
      body.credentialId,
      platform,
      architecture,
      isolationType,
      JSON.stringify(labels),
      minRunners,
      maxRunners,
      warmRunners,
      idleTimeoutMinutes
    );
    
    const pool = getPoolWithStats.get(id) as any;
    res.status(201).json({
      pool: {
        ...pool,
        labels: JSON.parse(pool.labels || '[]'),
        enabled: Boolean(pool.enabled),
      },
    });
  } catch (error) {
    console.error('Failed to create pool:', error);
    res.status(500).json({ error: 'Failed to create pool' });
  }
});

/**
 * Update a pool
 */
poolsRouter.patch('/:id', async (req: Request, res: Response) => {
  try {
    const pool = getPoolById.get(req.params.id) as RunnerPoolRow | undefined;
    
    if (!pool) {
      res.status(404).json({ error: 'Pool not found' });
      return;
    }
    
    const body = req.body as UpdatePoolBody;
    
    // Update name if provided
    if (body.name !== undefined) {
      updatePoolName.run(body.name, req.params.id);
    }
    
    // Update labels if provided
    if (body.labels !== undefined) {
      updatePoolLabels.run(JSON.stringify(body.labels), req.params.id);
    }
    
    // Update scaling params if any provided
    if (body.minRunners !== undefined || body.maxRunners !== undefined || 
        body.warmRunners !== undefined || body.idleTimeoutMinutes !== undefined) {
      const minRunners = body.minRunners ?? pool.min_runners;
      const maxRunners = body.maxRunners ?? pool.max_runners;
      const warmRunners = body.warmRunners ?? pool.warm_runners;
      const idleTimeoutMinutes = body.idleTimeoutMinutes ?? pool.idle_timeout_minutes;
      
      // Validate
      if (minRunners > maxRunners || warmRunners > maxRunners) {
        res.status(400).json({ error: 'minRunners and warmRunners cannot exceed maxRunners' });
        return;
      }
      
      updatePoolScaling.run(minRunners, maxRunners, warmRunners, idleTimeoutMinutes, req.params.id);
    }
    
    // Update enabled if provided
    if (body.enabled !== undefined) {
      updatePoolEnabled.run(body.enabled ? 1 : 0, req.params.id);
    }
    
    const updated = getPoolWithStats.get(req.params.id) as any;
    res.json({
      pool: {
        ...updated,
        labels: JSON.parse(updated.labels || '[]'),
        enabled: Boolean(updated.enabled),
      },
    });
  } catch (error) {
    console.error('Failed to update pool:', error);
    res.status(500).json({ error: 'Failed to update pool' });
  }
});

/**
 * Delete a pool
 */
poolsRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    const pool = getPoolById.get(req.params.id);
    
    if (!pool) {
      res.status(404).json({ error: 'Pool not found' });
      return;
    }
    
    // Note: Runners belonging to this pool will have pool_id set to NULL
    // They won't be deleted automatically
    deletePoolById.run(req.params.id);
    
    res.status(204).send();
  } catch (error) {
    console.error('Failed to delete pool:', error);
    res.status(500).json({ error: 'Failed to delete pool' });
  }
});

/**
 * Get runners in a pool
 */
poolsRouter.get('/:id/runners', (req: Request, res: Response) => {
  try {
    const pool = getPoolById.get(req.params.id);
    
    if (!pool) {
      res.status(404).json({ error: 'Pool not found' });
      return;
    }
    
    const runners = getPoolRunners.all(req.params.id) as any[];
    
    const parsedRunners = runners.map(r => ({
      ...r,
      labels: JSON.parse(r.labels || '[]'),
      ephemeral: Boolean(r.ephemeral),
    }));
    
    res.json({ runners: parsedRunners });
  } catch (error) {
    console.error('Failed to get pool runners:', error);
    res.status(500).json({ error: 'Failed to get pool runners' });
  }
});

/**
 * Setup webhook for autoscaling
 */
poolsRouter.post('/:id/webhook', async (req: Request, res: Response) => {
  try {
    const pool = getPoolById.get(req.params.id) as RunnerPoolRow | undefined;
    
    if (!pool) {
      res.status(404).json({ error: 'Pool not found' });
      return;
    }
    
    const { webhookUrl } = req.body;
    
    if (!webhookUrl) {
      res.status(400).json({ error: 'Missing webhookUrl in request body' });
      return;
    }
    
    // Check if webhook already exists for this credential
    const existingWebhook = getWebhookByCredential.get(pool.credential_id) as any;
    
    if (existingWebhook) {
      res.status(400).json({ 
        error: 'Webhook already exists for this credential',
        webhookId: existingWebhook.webhook_id,
      });
      return;
    }
    
    // Generate webhook secret
    const secret = generateSecret();
    
    // Get credential to create webhook on GitHub
    const credential = getCredentialById.get(pool.credential_id) as CredentialRow;
    const token = decrypt({
      encrypted: credential.encrypted_token,
      iv: credential.iv,
      authTag: credential.auth_tag,
    });
    
    const client = createGitHubClient(token, credential.scope as GitHubScope, credential.target);
    
    // Create webhook on GitHub
    const ghWebhook = await client.createWebhook(webhookUrl, secret, ['workflow_job']);
    
    if (!ghWebhook) {
      res.status(500).json({ error: 'Failed to create webhook on GitHub' });
      return;
    }
    
    // Store webhook config
    const webhookId = uuidv4();
    insertWebhook.run(webhookId, pool.credential_id, secret, JSON.stringify(['workflow_job']));
    updateWebhookId.run(ghWebhook.id, webhookId);
    
    res.status(201).json({
      webhook: {
        id: webhookId,
        githubWebhookId: ghWebhook.id,
        events: ['workflow_job'],
      },
    });
  } catch (error) {
    console.error('Failed to setup webhook:', error);
    res.status(500).json({ error: 'Failed to setup webhook' });
  }
});

/**
 * Remove webhook for autoscaling
 */
poolsRouter.delete('/:id/webhook', async (req: Request, res: Response) => {
  try {
    const pool = getPoolById.get(req.params.id) as RunnerPoolRow | undefined;
    
    if (!pool) {
      res.status(404).json({ error: 'Pool not found' });
      return;
    }
    
    const webhook = getWebhookByCredential.get(pool.credential_id) as any;
    
    if (!webhook) {
      res.status(404).json({ error: 'No webhook found for this pool' });
      return;
    }
    
    // Delete from GitHub
    if (webhook.webhook_id) {
      try {
        const credential = getCredentialById.get(pool.credential_id) as CredentialRow;
        const token = decrypt({
          encrypted: credential.encrypted_token,
          iv: credential.iv,
          authTag: credential.auth_tag,
        });
        
        const client = createGitHubClient(token, credential.scope as GitHubScope, credential.target);
        await client.deleteWebhook(webhook.webhook_id);
      } catch (error) {
        console.error('Failed to delete webhook from GitHub:', error);
        // Continue to delete local record anyway
      }
    }
    
    // Delete local record
    deleteWebhookById.run(webhook.id);
    
    res.status(204).send();
  } catch (error) {
    console.error('Failed to remove webhook:', error);
    res.status(500).json({ error: 'Failed to remove webhook' });
  }
});

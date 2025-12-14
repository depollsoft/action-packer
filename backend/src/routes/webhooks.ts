/**
 * Webhooks handler for GitHub events
 * Processes workflow_job events for autoscaling
 */

import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db, type RunnerPoolRow, type CredentialRow, type WebhookConfigRow } from '../db/index.js';
import { decrypt, verifyHmacSignature } from '../utils/index.js';
import {
  createGitHubClient,
  removeRunner,
  createDockerRunner,
  removeDockerRunner,
  type GitHubScope,
} from '../services/index.js';

export const webhooksRouter = Router();

// Type definitions for GitHub webhook payloads
type WorkflowJobPayload = {
  action: 'queued' | 'in_progress' | 'completed' | 'waiting';
  workflow_job: {
    id: number;
    run_id: number;
    name: string;
    status: string;
    conclusion: string | null;
    labels: string[];
    runner_id: number | null;
    runner_name: string | null;
  };
  repository: {
    id: number;
    name: string;
    full_name: string;
    owner: {
      login: string;
      type: string;
    };
  };
  organization?: {
    login: string;
  };
};

// Prepared statements
const getWebhookByCredentialTarget = db.prepare(`
  SELECT w.*, c.scope, c.target
  FROM webhook_configs w
  JOIN credentials c ON w.credential_id = c.id
  WHERE c.target = ? OR c.target = ?
`);

const getPoolsByCredential = db.prepare(`
  SELECT * FROM runner_pools WHERE credential_id = ? AND enabled = 1
`);

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
 * Check if a pool's labels match the job's requested labels
 */
function labelsMatch(poolLabels: string[], jobLabels: string[]): boolean {
  // If job has no labels, any runner can handle it
  if (jobLabels.length === 0) return true;
  
  // Check if pool has all the labels the job needs
  // (excluding standard labels like 'self-hosted', os, arch)
  const standardLabels = ['self-hosted', 'linux', 'macos', 'windows', 'x64', 'arm64', 'ARM64'];
  const customJobLabels = jobLabels.filter(l => !standardLabels.includes(l));
  
  if (customJobLabels.length === 0) return true;
  
  return customJobLabels.every(jobLabel => poolLabels.includes(jobLabel));
}

/**
 * Scale up: create a new ephemeral runner for the pool
 */
async function scaleUp(pool: RunnerPoolRow): Promise<string | null> {
  try {
    const counts = getPoolRunnerCounts.get(pool.id) as any;
    
    // Check if we can create more runners
    if (counts.active >= pool.max_runners) {
      console.log(`[autoscale] Pool ${pool.name}: at max capacity (${counts.active}/${pool.max_runners})`);
      return null;
    }
    
    console.log(`[autoscale] Pool ${pool.name}: scaling up (${counts.active}/${pool.max_runners})`);
    
    // Generate unique runner name
    const runnerName = `${pool.name}-${uuidv4().slice(0, 8)}`;
    const labels = JSON.parse(pool.labels);
    
    // Create runner record
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
    
    // Start async runner creation
    (async () => {
      try {
        if (pool.isolation_type === 'docker') {
          await createDockerRunner(runnerId, runnerName, labels, pool.credential_id, pool.architecture, true);
        } else {
          const { downloadRunner, configureRunner, startRunner } = await import('../services/runnerManager.js');
          
          const runnerDir = await downloadRunner(runnerId, pool.credential_id);
          await configureRunner(runnerId, runnerName, labels, pool.credential_id, runnerDir, true);
          await startRunner(runnerId, runnerDir);
          
          // Get GitHub runner ID
          const credential = getCredentialById.get(pool.credential_id) as CredentialRow;
          const token = decrypt({
            encrypted: credential.encrypted_token,
            iv: credential.iv,
            authTag: credential.auth_tag,
          });
          
          const client = createGitHubClient(token, credential.scope as GitHubScope, credential.target);
          const runners = await client.listRunners();
          const ghRunner = runners.find(r => r.name === runnerName);
          
          if (ghRunner) {
            db.prepare('UPDATE runners SET github_runner_id = ? WHERE id = ?').run(ghRunner.id, runnerId);
          }
        }
      } catch (error) {
        console.error(`[autoscale] Failed to create runner for pool ${pool.name}:`, error);
        const message = error instanceof Error ? error.message : 'Unknown error';
        db.prepare('UPDATE runners SET status = ?, error_message = ? WHERE id = ?')
          .run('error', message, runnerId);
      }
    })();
    
    return runnerId;
  } catch (error) {
    console.error(`[autoscale] Failed to scale up pool ${pool.name}:`, error);
    return null;
  }
}

/**
 * Scale down: remove idle ephemeral runners if above minimum
 * Exported for use by periodic cleanup tasks
 */
export async function scaleDown(pool: RunnerPoolRow): Promise<void> {
  try {
    const counts = getPoolRunnerCounts.get(pool.id) as any;
    
    // Check if we're above minimum warm runners
    if (counts.idle <= pool.warm_runners) {
      console.log(`[autoscale] Pool ${pool.name}: at minimum warm runners (${counts.idle}/${pool.warm_runners})`);
      return;
    }
    
    console.log(`[autoscale] Pool ${pool.name}: scaling down (${counts.idle} idle, min ${pool.warm_runners})`);
    
    // Get an idle ephemeral runner to remove
    const runner = getIdlePoolRunner.get(pool.id) as any;
    
    if (runner) {
      if (runner.isolation_type === 'docker') {
        await removeDockerRunner(runner.id);
      } else {
        await removeRunner(runner.id);
      }
      
      // Delete from database
      db.prepare('DELETE FROM runners WHERE id = ?').run(runner.id);
      console.log(`[autoscale] Removed runner ${runner.name} from pool ${pool.name}`);
    }
  } catch (error) {
    console.error(`[autoscale] Failed to scale down pool ${pool.name}:`, error);
  }
}

/**
 * Ensure minimum warm runners for a pool
 */
async function ensureWarmRunners(pool: RunnerPoolRow): Promise<void> {
  const counts = getPoolRunnerCounts.get(pool.id) as any;
  
  const runnersNeeded = pool.warm_runners - counts.active;
  if (runnersNeeded <= 0) return;
  
  console.log(`[autoscale] Pool ${pool.name}: creating ${runnersNeeded} warm runners`);
  
  for (let i = 0; i < runnersNeeded; i++) {
    await scaleUp(pool);
  }
}

/**
 * GitHub webhook handler
 */
webhooksRouter.post('/github', async (req: Request, res: Response) => {
  try {
    const event = req.headers['x-github-event'] as string;
    const signature = req.headers['x-hub-signature-256'] as string;
    const deliveryId = req.headers['x-github-delivery'] as string;
    
    console.log(`[webhook] Received ${event} event (delivery: ${deliveryId})`);
    
    // Only process workflow_job events
    if (event !== 'workflow_job') {
      res.status(200).json({ message: 'Event ignored' });
      return;
    }
    
    const payload = req.body as WorkflowJobPayload;
    
    // Determine the target (repo or org)
    const repoFullName = payload.repository.full_name;
    const orgName = payload.organization?.login || '';
    
    // Find webhook config for this target
    const webhook = getWebhookByCredentialTarget.get(repoFullName, orgName) as (WebhookConfigRow & { scope: string; target: string }) | undefined;
    
    if (!webhook) {
      console.log(`[webhook] No webhook config found for ${repoFullName} or ${orgName}`);
      res.status(404).json({ error: 'No webhook configuration found' });
      return;
    }
    
    // Verify signature
    const rawBody = JSON.stringify(req.body);
    if (!verifyHmacSignature(rawBody, signature, webhook.secret)) {
      console.warn(`[webhook] Invalid signature for delivery ${deliveryId}`);
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }
    
    // Get pools for this credential
    const pools = getPoolsByCredential.all(webhook.credential_id) as RunnerPoolRow[];
    
    if (pools.length === 0) {
      console.log(`[webhook] No enabled pools for credential ${webhook.credential_id}`);
      res.status(200).json({ message: 'No pools configured' });
      return;
    }
    
    const jobLabels = payload.workflow_job.labels;
    
    // Handle based on action
    switch (payload.action) {
      case 'queued': {
        console.log(`[webhook] Job ${payload.workflow_job.id} queued with labels: ${jobLabels.join(', ')}`);
        
        // Find matching pools and scale up
        for (const pool of pools) {
          const poolLabels = JSON.parse(pool.labels) as string[];
          
          if (labelsMatch(poolLabels, jobLabels)) {
            await scaleUp(pool);
          }
        }
        break;
      }
      
      case 'in_progress': {
        console.log(`[webhook] Job ${payload.workflow_job.id} in progress on runner ${payload.workflow_job.runner_name}`);
        
        // Update runner status to busy if we know it
        if (payload.workflow_job.runner_id) {
          db.prepare(`
            UPDATE runners SET status = 'busy', updated_at = datetime('now')
            WHERE github_runner_id = ?
          `).run(payload.workflow_job.runner_id);
        }
        break;
      }
      
      case 'completed': {
        console.log(`[webhook] Job ${payload.workflow_job.id} completed (${payload.workflow_job.conclusion})`);
        
        // For ephemeral runners, they'll self-terminate
        // For non-ephemeral, update status back to online
        if (payload.workflow_job.runner_id) {
          const runner = db.prepare(`
            SELECT * FROM runners WHERE github_runner_id = ?
          `).get(payload.workflow_job.runner_id) as any;
          
          if (runner) {
            if (runner.ephemeral) {
              // Ephemeral runner will be removed by GitHub
              // We can clean up our record
              setTimeout(async () => {
                try {
                  if (runner.isolation_type === 'docker') {
                    await removeDockerRunner(runner.id);
                  }
                  db.prepare('DELETE FROM runners WHERE id = ?').run(runner.id);
                  console.log(`[autoscale] Cleaned up ephemeral runner ${runner.name}`);
                  
                  // Ensure warm runners
                  if (runner.pool_id) {
                    const pool = db.prepare('SELECT * FROM runner_pools WHERE id = ?').get(runner.pool_id) as RunnerPoolRow;
                    if (pool) {
                      await ensureWarmRunners(pool);
                    }
                  }
                } catch (error) {
                  console.error(`[autoscale] Failed to cleanup ephemeral runner:`, error);
                }
              }, 5000);
            } else {
              db.prepare(`
                UPDATE runners SET status = 'online', updated_at = datetime('now')
                WHERE id = ?
              `).run(runner.id);
            }
          }
        }
        break;
      }
    }
    
    res.status(200).json({ message: 'Webhook processed' });
  } catch (error) {
    console.error('[webhook] Error processing webhook:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Health check for webhook endpoint (used by GitHub to verify)
 */
webhooksRouter.get('/github', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', message: 'Webhook endpoint ready' });
});

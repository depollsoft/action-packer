/**
 * Webhooks handler for GitHub events
 * Processes workflow_job events for autoscaling
 */

import { Router, Request, Response } from 'express';
import { db, type RunnerPoolRow, type WebhookConfigRow } from '../db/index.js';
import type { CredentialRow, GitHubAppRow } from '../db/schema.js';
import { decrypt, verifyHmacSignature } from '../utils/index.js';
import {
  removeDockerRunner,
  removeRunner,
} from '../services/index.js';
import { ensureWarmRunners, getPoolEffectiveLabels, labelsMatch, scaleUp, scaleDown as autoscaleDown } from '../services/autoscaler.js';

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
  installation?: {
    id: number;
  };
};

// Prepared statements
const getWebhookByCredentialTarget = db.prepare(`
  SELECT w.*, c.scope, c.target
  FROM webhook_configs w
  JOIN credentials c ON w.credential_id = c.id
  WHERE c.target = ? OR c.target = ?
`);

const getGitHubApp = db.prepare('SELECT * FROM github_app WHERE id = 1');

const getCredentialByInstallationAndTarget = db.prepare(`
  SELECT * FROM credentials
  WHERE installation_id = ?
    AND (target = ? OR target = ?)
  ORDER BY CASE WHEN target = ? THEN 0 ELSE 1 END
  LIMIT 1
`);

const getPoolsByCredential = db.prepare(`
  SELECT * FROM runner_pools WHERE credential_id = ? AND enabled = 1
`);

// Re-export for compatibility (used by future periodic tasks)
export async function scaleDown(pool: RunnerPoolRow): Promise<void> {
  return autoscaleDown(pool);
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

    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody?.toString() || JSON.stringify(req.body);

    // Prefer classic (per-credential) webhook config if available
    const classicWebhook = getWebhookByCredentialTarget.get(repoFullName, orgName) as (WebhookConfigRow & { scope: string; target: string }) | undefined;

    let credentialId: string | null = null;
    let webhookSecret: string | null = null;

    if (classicWebhook) {
      webhookSecret = classicWebhook.secret;
      credentialId = classicWebhook.credential_id;
    } else {
      // GitHub App mode: verify against the app-level webhook secret and map using installation.id
      const app = getGitHubApp.get() as GitHubAppRow | undefined;
      if (app) {
        webhookSecret = decrypt({
          encrypted: app.encrypted_webhook_secret,
          iv: app.webhook_secret_iv,
          authTag: app.webhook_secret_auth_tag,
        });

        // For GitHub App webhooks, use installation.id to find the right credential
        const installationId = payload.installation?.id;
        const ownerLogin = payload.repository.owner?.login || orgName;

        if (installationId) {
          const cred = getCredentialByInstallationAndTarget.get(
            installationId,
            repoFullName,
            ownerLogin,
            repoFullName
          ) as CredentialRow | undefined;
          credentialId = cred?.id ?? null;
        }
      }
    }

    if (!webhookSecret || !credentialId) {
      console.log(`[webhook] No webhook config found for ${repoFullName} or ${orgName}`);
      res.status(404).json({ error: 'No webhook configuration found' });
      return;
    }
    
    // Verify signature using raw body (captured by middleware for accurate verification)
    if (!verifyHmacSignature(rawBody, signature, webhookSecret)) {
      console.warn(`[webhook] Invalid signature for delivery ${deliveryId}`);
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }
    
    // Get pools for this credential
    const pools = getPoolsByCredential.all(credentialId) as RunnerPoolRow[];
    
    if (pools.length === 0) {
      console.log(`[webhook] No enabled pools for credential ${credentialId}`);
      res.status(200).json({ message: 'No pools configured' });
      return;
    }
    
    const jobLabels = payload.workflow_job.labels;
    
    // Handle based on action
    switch (payload.action) {
      case 'queued': {
        console.log(`[webhook] Job ${payload.workflow_job.id} queued with labels: ${jobLabels.join(', ')}`);
        
        // Find matching pools and scale up
        let matchedPools = 0;
        console.log(`[webhook] Checking ${pools.length} pool(s) for matches...`);
        for (const pool of pools) {
          try {
            const effectiveLabels = getPoolEffectiveLabels(pool);
            const matches = labelsMatch(effectiveLabels, jobLabels);
            console.log(`[webhook] Pool ${pool.name} (platform=${pool.platform}, arch=${pool.architecture}, isolation=${pool.isolation_type}) labels=[${effectiveLabels.join(',')}] matches=${matches}`);
            
            if (matches) {
              matchedPools++;
              await scaleUp(pool);
            }
          } catch (err) {
            console.error(`[webhook] Error checking pool ${pool.name}:`, err);
          }
        }
        if (matchedPools === 0) {
          console.log(`[webhook] No pools matched job labels`);
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
              // We can clean up our record and resources
              setTimeout(async () => {
                try {
                  if (runner.isolation_type === 'docker') {
                    await removeDockerRunner(runner.id);
                  } else {
                    // Clean up native runner process and files
                    await removeRunner(runner.id);
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

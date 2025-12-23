import { describe, it, expect, afterAll, afterEach, beforeEach } from 'vitest';
import request from 'supertest';
import { app, server } from '../src/index.js';
import { db } from '../src/db/index.js';
import { encrypt, createHmacSignature } from '../src/utils/index.js';

afterAll(() => {
  server.close();
});

describe('GitHub App webhook verification', () => {
  beforeEach(() => {
    // Clean relevant tables before each test to avoid cross-test pollution
    db.prepare('DELETE FROM webhook_configs').run();
    db.prepare('DELETE FROM runner_pools').run();
    db.prepare('DELETE FROM credentials').run();
    db.prepare('DELETE FROM github_app').run();
  });

  afterEach(() => {
    // Clean up after each test
    db.prepare('DELETE FROM webhook_configs').run();
    db.prepare('DELETE FROM runner_pools').run();
    db.prepare('DELETE FROM credentials').run();
    db.prepare('DELETE FROM github_app').run();
  });

  it('accepts workflow_job when only GitHub App webhook secret exists', async () => {

    const appWebhookSecret = 'test-app-webhook-secret';
    const encryptedSecret = encrypt(appWebhookSecret);

    db.prepare(`
      INSERT INTO github_app (
        id, app_id, app_slug, app_name, client_id,
        encrypted_client_secret, client_secret_iv, client_secret_auth_tag,
        encrypted_private_key, private_key_iv, private_key_auth_tag,
        encrypted_webhook_secret, webhook_secret_iv, webhook_secret_auth_tag,
        iv, auth_tag,
        owner_login, owner_id, owner_type, html_url, permissions, events
      ) VALUES (
        1, 123, 'test-app', 'Test App', 'client-id',
        'x', 'x', 'x',
        'x', 'x', 'x',
        ?, ?, ?,
        'legacy-iv', 'legacy-auth-tag',
        'depoll', 1, 'User', null, '{}', '["workflow_job"]'
      )
    `).run(encryptedSecret.encrypted, encryptedSecret.iv, encryptedSecret.authTag);

    const installationId = 555;
    const credentialId = 'cred-1';
    const placeholderToken = encrypt(`gha:${installationId}`);

    db.prepare(`
      INSERT INTO credentials (
        id, name, type, scope, target, encrypted_token, iv, auth_tag, installation_id, validated_at
      ) VALUES (?, ?, 'github_app', 'repo', ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      credentialId,
      'GitHub App: depoll/depollsoft',
      'depoll/depollsoft',
      placeholderToken.encrypted,
      placeholderToken.iv,
      placeholderToken.authTag,
      installationId
    );

    db.prepare(`
      INSERT INTO runner_pools (
        id, name, credential_id, platform, architecture, isolation_type, labels,
        min_runners, max_runners, warm_runners, idle_timeout_minutes, enabled
      ) VALUES (?, ?, ?, 'darwin', 'x64', 'native', '[]', 0, 5, 1, 10, 1)
    `).run('pool-1', 'pool', credentialId);

    const payload = {
      action: 'in_progress',
      workflow_job: {
        id: 1,
        run_id: 1,
        name: 'job',
        status: 'in_progress',
        conclusion: null,
        labels: ['self-hosted'],
        runner_id: null,
        runner_name: null,
      },
      repository: {
        id: 1,
        name: 'depollsoft',
        full_name: 'depoll/depollsoft',
        owner: { login: 'depoll', type: 'User' },
      },
      installation: { id: installationId },
    };

    const raw = JSON.stringify(payload);
    const sig = createHmacSignature(raw, appWebhookSecret);

    const response = await request(app)
      .post('/api/webhooks/github')
      .set('x-github-event', 'workflow_job')
      .set('x-github-delivery', 'test-delivery')
      .set('x-hub-signature-256', sig)
      .set('content-type', 'application/json')
      .send(payload);

    expect(response.status).toBe(200);
    expect(response.body.message).toBe('Webhook processed');
  });
});

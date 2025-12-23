/**
 * Onboarding and GitHub App setup routes
 * Handles the initial setup flow for Action Packer
 */

import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/index.js';
import type {
  AppSettingRow,
  GitHubAppRow,
  GitHubAppInstallationRow,
  SessionRow,
} from '../db/schema.js';
import { encrypt, decrypt, generateSecret } from '../utils/crypto.js';
import {
  generateAppManifest,
  exchangeManifestCode,
  generateAppJWT,
  getAppInfo,
  listInstallations,
  getOAuthAuthorizationUrl,
  exchangeOAuthCode,
  getAuthenticatedUser,
  GitHubAppClient,
  type GitHubAppCredentials,
  type GitHubAppInstallation,
} from '../services/githubApp.js';

const router = Router();
const authRouter = Router();
const githubAppRouter = Router();

function isDebugOAuthEnabled(): boolean {
  return process.env.DEBUG_OAUTH === '1' || process.env.DEBUG_OAUTH === 'true';
}

function maskToken(value: string | null | undefined, visible: number = 6): string {
  if (!value) return '<none>';
  if (value.length <= visible) return value;
  return `…${value.slice(-visible)}`;
}

function base64UrlEncode(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlEncodeString(value: string): string {
  return base64UrlEncode(Buffer.from(value, 'utf8'));
}

function base64UrlDecodeToString(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + '='.repeat(padLength);
  return Buffer.from(padded, 'base64').toString('utf8');
}

function base64UrlDecodeToBuffer(value: string): Buffer {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + '='.repeat(padLength);
  return Buffer.from(padded, 'base64');
}

function getOAuthStateSecret(): string {
  const secret = process.env.ENCRYPTION_KEY;
  if (secret) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('ENCRYPTION_KEY environment variable is required in production');
  }
  return 'action-packer-dev-oauth-state';
}

function getOAuthStateSecretFingerprint(): string {
  const secret = getOAuthStateSecret();
  // Fingerprint only; does not reveal the secret.
  return crypto.createHash('sha256').update(secret).digest('hex').slice(0, 10);
}

function createSignedOAuthState(): string {
  const payload = {
    t: Date.now(),
    n: generateSecret(16),
    v: 1,
  };

  const payloadB64 = base64UrlEncodeString(JSON.stringify(payload));
  const sig = crypto
    .createHmac('sha256', getOAuthStateSecret())
    .update(payloadB64)
    .digest();

  return `${payloadB64}.${base64UrlEncode(sig)}`;
}

function verifySignedOAuthState(state: string, maxAgeMs: number): { valid: boolean; reason?: string } {
  const parts = state.split('.');
  if (parts.length !== 2) return { valid: false, reason: 'not_signed' };
  const [payloadB64, sigB64] = parts;
  if (!payloadB64 || !sigB64) return { valid: false, reason: 'malformed' };

  let actualSig: Buffer;
  try {
    actualSig = base64UrlDecodeToBuffer(sigB64);
  } catch {
    return { valid: false, reason: 'bad_sig_b64' };
  }

  const expectedSig = crypto
    .createHmac('sha256', getOAuthStateSecret())
    .update(payloadB64)
    .digest();

  if (actualSig.length !== expectedSig.length || !crypto.timingSafeEqual(actualSig, expectedSig)) {
    return { valid: false, reason: 'bad_sig' };
  }

  let payloadRaw: string;
  try {
    payloadRaw = base64UrlDecodeToString(payloadB64);
  } catch {
    return { valid: false, reason: 'bad_payload_b64' };
  }

  let payload: { t?: number };
  try {
    payload = JSON.parse(payloadRaw) as { t?: number };
  } catch {
    return { valid: false, reason: 'bad_payload_json' };
  }

  if (typeof payload.t !== 'number') return { valid: false, reason: 'missing_ts' };
  if (Date.now() - payload.t > maxAgeMs) return { valid: false, reason: 'expired' };

  return { valid: true };
}

// ============================================
// Settings Helpers
// ============================================

function getSetting(key: string): string | null {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as
    | AppSettingRow
    | undefined;
  return row?.value ?? null;
}

function setSetting(key: string, value: string): void {
  db.prepare(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')`
  ).run(key, value, value);
}

function getGitHubApp(): GitHubAppRow | null {
  const row = db.prepare('SELECT * FROM github_app WHERE id = 1').get() as
    | GitHubAppRow
    | undefined;
  return row ?? null;
}

/**
 * Create or get an existing credential for a GitHub App installation
 * For Organization installations: creates one org-level credential
 * For User installations: creates per-repo credentials for each accessible repository
 */
async function ensureCredentialsForInstallation(installation: {
  id: number;
  target_type: 'User' | 'Organization';
  account_login: string;
}): Promise<string[]> {
  const githubApp = getGitHubApp();
  if (!githubApp) {
    console.error('GitHub App not configured, cannot create credentials');
    return [];
  }

  const credentialIds: string[] = [];

  if (installation.target_type === 'Organization') {
    // For organizations, create/get a single org-level credential
    const existing = db
      .prepare('SELECT id FROM credentials WHERE installation_id = ? AND scope = ?')
      .get(installation.id, 'org') as { id: string } | undefined;

    if (existing) {
      return [existing.id];
    }

    const credentialId = uuidv4();
    const name = `GitHub App: ${installation.account_login}`;
    const placeholderToken = `gha:${installation.id}`;
    const encryptedToken = encrypt(placeholderToken);

    db.prepare(
      `INSERT INTO credentials (
        id, name, type, scope, target, encrypted_token, iv, auth_tag, installation_id, validated_at
      ) VALUES (?, ?, 'github_app', 'org', ?, ?, ?, ?, ?, datetime('now'))`
    ).run(
      credentialId,
      name,
      installation.account_login,
      encryptedToken.encrypted,
      encryptedToken.iv,
      encryptedToken.authTag,
      installation.id
    );

    return [credentialId];
  }

  // For User installations, create credentials per repository
  try {
    const privateKey = decrypt({
      encrypted: githubApp.encrypted_private_key,
      iv: githubApp.private_key_iv,
      authTag: githubApp.private_key_auth_tag,
    });

    const appClient = new GitHubAppClient({
      privateKey,
      clientId: githubApp.client_id,
      appId: githubApp.app_id,
      installationId: installation.id,
    });

    const repos = await appClient.listRepositories();
    
    if (repos.length === 0) {
      console.warn(`No repositories found for User installation ${installation.id}`);
      return [];
    }

    for (const repo of repos) {
      // Check if credential already exists for this repo
      const existing = db
        .prepare('SELECT id FROM credentials WHERE installation_id = ? AND target = ?')
        .get(installation.id, repo.full_name) as { id: string } | undefined;

      if (existing) {
        credentialIds.push(existing.id);
        continue;
      }

      // Create new credential for this repo
      const credentialId = uuidv4();
      const name = `GitHub App: ${repo.full_name}`;
      const placeholderToken = `gha:${installation.id}`;
      const encryptedToken = encrypt(placeholderToken);

      db.prepare(
        `INSERT INTO credentials (
          id, name, type, scope, target, encrypted_token, iv, auth_tag, installation_id, validated_at
        ) VALUES (?, ?, 'github_app', 'repo', ?, ?, ?, ?, ?, datetime('now'))`
      ).run(
        credentialId,
        name,
        repo.full_name,
        encryptedToken.encrypted,
        encryptedToken.iv,
        encryptedToken.authTag,
        installation.id
      );

      credentialIds.push(credentialId);
    }
  } catch (error) {
    console.error(`Failed to create credentials for User installation ${installation.id}:`, error);
  }

  return credentialIds;
}

// ============================================
// Setup Status
// ============================================

export type SetupStatus = {
  isComplete: boolean;
  steps: {
    githubApp: {
      complete: boolean;
      appName?: string;
      appSlug?: string;
    };
    installation: {
      complete: boolean;
      count: number;
    };
  };
};

/**
 * GET /api/onboarding/status
 * Check the current onboarding/setup status
 */
router.get('/status', (_req: Request, res: Response, next: NextFunction) => {
  try {
    const githubApp = getGitHubApp();
    const installations = db
      .prepare('SELECT COUNT(*) as count FROM github_app_installations')
      .get() as { count: number };

    const status: SetupStatus = {
      isComplete: !!githubApp && installations.count > 0,
      steps: {
        githubApp: {
          complete: !!githubApp,
          appName: githubApp?.app_name,
          appSlug: githubApp?.app_slug,
        },
        installation: {
          complete: installations.count > 0,
          count: installations.count,
        },
      },
    };

    res.json(status);
  } catch (error) {
    next(error);
  }
});

// ============================================
// GitHub App Manifest Flow
// ============================================

/**
 * GET /api/onboarding/manifest
 * Generate a GitHub App manifest for automatic app creation
 */
router.get('/manifest', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { org, name } = req.query;
    
    // Get or generate the base URL
    let baseUrl = getSetting('base_url');
    if (!baseUrl) {
      // Try to infer from request
      const protocol = req.headers['x-forwarded-proto'] || req.protocol;
      const host = req.headers['x-forwarded-host'] || req.headers.host;
      baseUrl = `${protocol}://${host}`;
    }

    // Generate a state token for CSRF protection
    const state = generateSecret(16);
    setSetting('manifest_state', state);

    const appName = (name as string) || 'Action Packer';
    const forOrganization = !!org;

    const manifest = generateAppManifest({
      name: appName,
      baseUrl,
      forOrganization,
    });

    // Build the GitHub URL to redirect to
    let githubUrl: string;
    if (org) {
      githubUrl = `https://github.com/organizations/${org}/settings/apps/new?state=${state}`;
    } else {
      githubUrl = `https://github.com/settings/apps/new?state=${state}`;
    }

    res.json({
      manifest,
      manifestJson: JSON.stringify(manifest),
      githubUrl,
      state,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/onboarding/base-url
 * Set the base URL for the Action Packer instance
 */
router.post('/base-url', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { baseUrl } = req.body;

    if (!baseUrl || typeof baseUrl !== 'string') {
      res.status(400).json({ error: 'Base URL is required' });
      return;
    }

    // Validate URL format
    try {
      new URL(baseUrl);
    } catch {
      res.status(400).json({ error: 'Invalid URL format' });
      return;
    }

    setSetting('base_url', baseUrl.replace(/\/$/, '')); // Remove trailing slash

    res.json({ success: true, baseUrl });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/github-app/callback
 * Handle the callback from GitHub after app creation via manifest
 */
async function handleGitHubAppManifestCallback(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { code, state } = req.query;

    if (!code || typeof code !== 'string') {
      res.status(400).json({ error: 'Missing code parameter' });
      return;
    }

    // Verify state for CSRF protection
    const expectedState = getSetting('manifest_state');
    if (state !== expectedState) {
      res.status(400).json({ error: 'Invalid state parameter' });
      return;
    }

    // Clear the state
    db.prepare('DELETE FROM app_settings WHERE key = ?').run('manifest_state');

    // Exchange the code for app credentials
    const appCredentials = await exchangeManifestCode(code);

    // Store the app credentials
    await storeGitHubAppCredentials(appCredentials);

    // Redirect to the frontend onboarding completion page
    const baseUrl = getSetting('base_url') || '';
    res.redirect(`${baseUrl}/onboarding/app-created?app=${appCredentials.slug}`);
  } catch (error) {
    next(error);
  }
}

// Backwards-compatible route (when mounted at /api/onboarding)
router.get('/github-app/callback', handleGitHubAppManifestCallback);

// Preferred route (when mounted at /api/github-app)
githubAppRouter.get('/callback', handleGitHubAppManifestCallback);

/**
 * Store GitHub App credentials in the database
 */
async function storeGitHubAppCredentials(credentials: GitHubAppCredentials): Promise<void> {
  // Encrypt sensitive values - each gets its own IV/authTag
  const encryptedClientSecret = encrypt(credentials.client_secret);
  const encryptedPrivateKey = encrypt(credentials.pem);
  const encryptedWebhookSecret = encrypt(credentials.webhook_secret);

  db.prepare(
    `INSERT OR REPLACE INTO github_app (
      id, app_id, app_slug, app_name, client_id,
      encrypted_client_secret, client_secret_iv, client_secret_auth_tag,
      encrypted_private_key, private_key_iv, private_key_auth_tag,
      encrypted_webhook_secret, webhook_secret_iv, webhook_secret_auth_tag,
      owner_login, owner_id, owner_type, html_url,
      permissions, events, updated_at
    ) VALUES (
      1, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, datetime('now')
    )`
  ).run(
    credentials.id,
    credentials.slug,
    credentials.name,
    credentials.client_id,
    encryptedClientSecret.encrypted,
    encryptedClientSecret.iv,
    encryptedClientSecret.authTag,
    encryptedPrivateKey.encrypted,
    encryptedPrivateKey.iv,
    encryptedPrivateKey.authTag,
    encryptedWebhookSecret.encrypted,
    encryptedWebhookSecret.iv,
    encryptedWebhookSecret.authTag,
    credentials.owner.login,
    credentials.owner.id,
    credentials.owner.type || 'User',
    credentials.html_url || null,
    JSON.stringify(credentials.permissions),
    JSON.stringify(credentials.events)
  );
}

// ============================================
// Manual GitHub App Setup
// ============================================

/**
 * POST /api/onboarding/github-app/manual
 * Set up a GitHub App using manually provided credentials
 */
router.post(
  '/github-app/manual',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const {
        appId,
        appName,
        clientId,
        clientSecret,
        privateKey,
        webhookSecret,
      } = req.body;

      // Validate required fields
      if (!appId || !clientId || !clientSecret || !privateKey) {
        res.status(400).json({
          error: 'Missing required fields: appId, clientId, clientSecret, privateKey',
        });
        return;
      }

      // Validate the credentials by trying to authenticate
      try {
        const appJwt = generateAppJWT(privateKey, clientId);
        const appInfo = await getAppInfo(appJwt);

        // Store the credentials
        const encryptedClientSecret = encrypt(clientSecret);
        const encryptedPrivateKey = encrypt(privateKey);
        const encryptedWebhookSecret = encrypt(webhookSecret || generateSecret(32));

        db.prepare(
          `INSERT OR REPLACE INTO github_app (
            id, app_id, app_slug, app_name, client_id,
            encrypted_client_secret, client_secret_iv, client_secret_auth_tag,
            encrypted_private_key, private_key_iv, private_key_auth_tag,
            encrypted_webhook_secret, webhook_secret_iv, webhook_secret_auth_tag,
            owner_login, owner_id, owner_type, html_url,
            permissions, events, updated_at
          ) VALUES (
            1, ?, ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, datetime('now')
          )`
        ).run(
          appId,
          appInfo.slug,
          appName || appInfo.name,
          clientId,
          encryptedClientSecret.encrypted,
          encryptedClientSecret.iv,
          encryptedClientSecret.authTag,
          encryptedPrivateKey.encrypted,
          encryptedPrivateKey.iv,
          encryptedPrivateKey.authTag,
          encryptedWebhookSecret.encrypted,
          encryptedWebhookSecret.iv,
          encryptedWebhookSecret.authTag,
          appInfo.owner.login,
          appInfo.owner.id,
          'User', // Default, will be updated when we have more info
          null,
          JSON.stringify(appInfo.permissions),
          JSON.stringify(appInfo.events)
        );

        res.json({
          success: true,
          app: {
            id: appId,
            slug: appInfo.slug,
            name: appName || appInfo.name,
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        res.status(400).json({
          error: `Failed to validate GitHub App credentials: ${message}`,
        });
      }
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/onboarding/github-app
 * Get the configured GitHub App info (without secrets)
 */
router.get('/github-app', (_req: Request, res: Response, next: NextFunction) => {
  try {
    const app = getGitHubApp();

    if (!app) {
      res.status(404).json({ error: 'GitHub App not configured' });
      return;
    }

    res.json({
      appId: app.app_id,
      slug: app.app_slug,
      name: app.app_name,
      clientId: app.client_id,
      owner: {
        login: app.owner_login,
        id: app.owner_id,
        type: app.owner_type,
      },
      htmlUrl: app.html_url,
      permissions: JSON.parse(app.permissions),
      events: JSON.parse(app.events),
      createdAt: app.created_at,
      updatedAt: app.updated_at,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/onboarding/github-app
 * Remove the configured GitHub App
 */
router.delete('/github-app', (_req: Request, res: Response, next: NextFunction) => {
  try {
    db.prepare('DELETE FROM github_app WHERE id = 1').run();
    db.prepare('DELETE FROM github_app_installations').run();
    db.prepare('DELETE FROM sessions').run();

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// ============================================
// Installations
// ============================================

/**
 * GET /api/onboarding/installations
 * List all installations of the GitHub App
 */
router.get('/installations', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const app = getGitHubApp();

    if (!app) {
      res.status(404).json({ error: 'GitHub App not configured' });
      return;
    }

    const { refresh } = req.query;

    if (refresh === 'true') {
      // Fetch fresh installations from GitHub
      const privateKey = decrypt({
        encrypted: app.encrypted_private_key,
        iv: app.private_key_iv,
        authTag: app.private_key_auth_tag,
      });

      const appJwt = generateAppJWT(privateKey, app.client_id);
      const installations = await listInstallations(appJwt);

      // Sync installations to database and create credentials
      for (const installation of installations) {
        db.prepare(
          `INSERT OR REPLACE INTO github_app_installations (
            id, app_id, target_id, target_type, account_login, account_id,
            repository_selection, permissions, events, suspended_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
        ).run(
          installation.id,
          installation.app_id,
          installation.target_id,
          installation.target_type,
          installation.account.login,
          installation.account.id,
          installation.repository_selection,
          JSON.stringify(installation.permissions),
          JSON.stringify(installation.events),
          installation.suspended_at
        );

        // Auto-create credentials for this installation (async for User installations)
        await ensureCredentialsForInstallation({
          id: installation.id,
          target_type: installation.target_type,
          account_login: installation.account.login,
        });
      }

      // Remove installations that no longer exist
      const installationIds = installations.map((i) => i.id);
      if (installationIds.length > 0) {
        db.prepare(
          `DELETE FROM github_app_installations 
           WHERE id NOT IN (${installationIds.map(() => '?').join(',')})`
        ).run(...installationIds);
      } else {
        db.prepare('DELETE FROM github_app_installations').run();
      }
    }

    // Return installations from database with credential info
    const rows = db
      .prepare('SELECT * FROM github_app_installations ORDER BY account_login')
      .all() as GitHubAppInstallationRow[];

    const installationsWithCreds = await Promise.all(rows.map(async (row) => {
      // Get or create credentials for this installation
      const credentialIds = await ensureCredentialsForInstallation({
        id: row.id,
        target_type: row.target_type as 'User' | 'Organization',
        account_login: row.account_login,
      });

      return {
        id: row.id,
        appId: row.app_id,
        targetId: row.target_id,
        targetType: row.target_type,
        account: {
          login: row.account_login,
          id: row.account_id,
        },
        repositorySelection: row.repository_selection,
        permissions: JSON.parse(row.permissions),
        events: JSON.parse(row.events),
        suspendedAt: row.suspended_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        credentialId: credentialIds[0], // Keep first for backward compat
        credentialIds,
      };
    }));

    res.json({ installations: installationsWithCreds });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/onboarding/install-url
 * Get the URL to install the GitHub App
 */
router.get('/install-url', (_req: Request, res: Response, next: NextFunction) => {
  try {
    const app = getGitHubApp();

    if (!app) {
      res.status(404).json({ error: 'GitHub App not configured' });
      return;
    }

    // The installation URL is on the app's page
    const installUrl = `https://github.com/apps/${app.app_slug}/installations/new`;

    res.json({ installUrl, appSlug: app.app_slug });
  } catch (error) {
    next(error);
  }
});

// ============================================
// OAuth / User Authentication
// ============================================

/**
 * GET /api/onboarding/auth/login
 * Start the OAuth flow to authenticate a user
 */
function handleOAuthLogin(_req: Request, res: Response, next: NextFunction): void {
  try {
    res.set('Cache-Control', 'no-store');
    res.set('Pragma', 'no-cache');
    res.set('Vary', 'Cookie');

    const app = getGitHubApp();

    if (!app) {
      res.status(404).json({ error: 'GitHub App not configured' });
      return;
    }

    const baseUrl = getSetting('base_url') || '';
    const redirectUri = `${baseUrl}/api/auth/callback`;

    // Generate and store state for CSRF protection.
    // Store per-state to allow multiple outstanding login attempts.
    const state = createSignedOAuthState();

    // Also store state in an httpOnly cookie so validation works even if the
    // database file differs across environments/instances.
    res.cookie('oauth_state', state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 10 * 60 * 1000,
      path: '/api',
    });

    if (isDebugOAuthEnabled()) {
      console.log('[oauth] /login', {
        host: _req.headers.host,
        forwardedHost: _req.headers['x-forwarded-host'],
        forwardedProto: _req.headers['x-forwarded-proto'],
        baseUrl,
        redirectUri,
        state: maskToken(state),
        signedState: state.includes('.'),
        secretFp: getOAuthStateSecretFingerprint(),
        cookie: {
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          path: '/api',
          maxAgeMs: 10 * 60 * 1000,
        },
      });
    }

    // Best-effort cleanup of old states
    db.prepare(
      "DELETE FROM app_settings WHERE key LIKE 'oauth_state:%' AND updated_at < datetime('now', '-2 hours')"
    ).run();

    setSetting(`oauth_state:${state}`, new Date().toISOString());

    // Legacy (single-state) key for backwards-compat/debugging
    setSetting('oauth_state', state);

    const authUrl = getOAuthAuthorizationUrl({
      clientId: app.client_id,
      redirectUri,
      state,
    });

    res.json({ authUrl, state });
  } catch (error) {
    next(error);
  }
}

// When mounted at /api/onboarding
router.get('/auth/login', handleOAuthLogin);

// When mounted at /api/auth
authRouter.get('/login', handleOAuthLogin);

/**
 * GET /api/auth/callback
 * Handle the OAuth callback from GitHub
 */
async function handleOAuthCallback(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.set('Cache-Control', 'no-store');
    res.set('Pragma', 'no-cache');
    res.set('Vary', 'Cookie');

    const { code, state } = req.query;

    if (!code || typeof code !== 'string') {
      res.status(400).json({ error: 'Missing code parameter' });
      return;
    }

    if (!state || typeof state !== 'string') {
      res.status(400).json({ error: 'Missing state parameter' });
      return;
    }

    // Verify state.
    // Prefer per-state key (supports multiple outstanding login attempts).
    const stateKey = `oauth_state:${state}`;
    const stateRow = db
      .prepare('SELECT value FROM app_settings WHERE key = ?')
      .get(stateKey) as AppSettingRow | undefined;

    const legacyExpectedState = getSetting('oauth_state');
    const cookieState = (req as Request & { cookies?: Record<string, string> }).cookies?.oauth_state;
    const signed = verifySignedOAuthState(state, 10 * 60 * 1000);
    const stateValid = signed.valid || state === cookieState || !!stateRow || state === legacyExpectedState;

    if (isDebugOAuthEnabled()) {
      const outstandingCount = (
        db
          .prepare("SELECT COUNT(*) as count FROM app_settings WHERE key LIKE 'oauth_state:%'")
          .get() as { count: number }
      ).count;

      console.log('[oauth] /callback', {
        host: req.headers.host,
        forwardedHost: req.headers['x-forwarded-host'],
        forwardedProto: req.headers['x-forwarded-proto'],
        url: req.originalUrl,
        query: {
          hasCode: typeof code === 'string' && code.length > 0,
          state: maskToken(typeof state === 'string' ? state : null),
        },
        cookies: {
          hasOAuthStateCookie: !!cookieState,
          oauthStateCookie: maskToken(cookieState ?? null),
        },
        db: {
          stateKeyExists: !!stateRow,
          outstandingStateKeys: outstandingCount,
          legacyExpectedState: maskToken(legacyExpectedState),
        },
        decision: {
          stateValid,
          signedValid: signed.valid,
          signedReason: signed.valid ? undefined : signed.reason,
          matched: state === cookieState ? 'cookie' : stateRow ? 'db-key' : state === legacyExpectedState ? 'legacy' : 'none',
        },
        secretFp: getOAuthStateSecretFingerprint(),
      });
    }

    if (!stateValid) {
      if (isDebugOAuthEnabled()) {
        const outstandingCount = (
          db
            .prepare("SELECT COUNT(*) as count FROM app_settings WHERE key LIKE 'oauth_state:%'")
            .get() as { count: number }
        ).count;

        res.status(400).json({
          error: 'Invalid state parameter',
          debug: {
            host: req.headers.host,
            forwardedHost: req.headers['x-forwarded-host'],
            forwardedProto: req.headers['x-forwarded-proto'],
            state: maskToken(state),
            cookieState: maskToken(cookieState ?? null),
            legacyExpectedState: maskToken(legacyExpectedState),
            stateKeyExists: !!stateRow,
            outstandingStateKeys: outstandingCount,
            signedValid: signed.valid,
            signedReason: signed.valid ? undefined : signed.reason,
            secretFp: getOAuthStateSecretFingerprint(),
          },
        });
        return;
      }

      res.status(400).json({ error: 'Invalid state parameter' });
      return;
    }

    // Clear used state
    if (stateRow) {
      db.prepare('DELETE FROM app_settings WHERE key = ?').run(stateKey);
    }
    // Always clear legacy key too (best effort)
    db.prepare('DELETE FROM app_settings WHERE key = ?').run('oauth_state');

    // Clear cookie state (best effort)
    res.clearCookie('oauth_state', {
      path: '/api',
    });

    const app = getGitHubApp();
    if (!app) {
      res.status(500).json({ error: 'GitHub App not configured' });
      return;
    }

    // Decrypt client secret
    const clientSecret = decrypt({
      encrypted: app.encrypted_client_secret,
      iv: app.client_secret_iv,
      authTag: app.client_secret_auth_tag,
    });

    const baseUrl = getSetting('base_url') || '';

    // Exchange code for token
    const tokenData = await exchangeOAuthCode({
      clientId: app.client_id,
      clientSecret,
      code,
      redirectUri: `${baseUrl}/api/auth/callback`,
    });

    // Get user info
    const user = await getAuthenticatedUser(tokenData.access_token);

    // Create session
    const sessionId = uuidv4();
    const encryptedToken = encrypt(tokenData.access_token);
    const expiresAt = new Date(
      Date.now() + (tokenData.expires_in || 8 * 60 * 60) * 1000
    ).toISOString();

    db.prepare(
      `INSERT INTO sessions (
        id, user_id, user_login, user_name, user_email, user_avatar_url,
        encrypted_access_token, iv, auth_tag, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      sessionId,
      user.id,
      user.login,
      user.name,
      user.email,
      user.avatar_url,
      encryptedToken.encrypted,
      encryptedToken.iv,
      encryptedToken.authTag,
      expiresAt
    );

    // If this is the first user to log in after setup, make them the admin
    const existingAdminId = getSetting('admin_user_id');
    if (!existingAdminId && getSetting('setup_complete') === 'true') {
      setSetting('admin_user_id', user.id.toString());
      console.log(`👑 User ${user.login} (${user.id}) set as admin`);
    }

    // Redirect to frontend with session cookie
    res.cookie('session', sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: (tokenData.expires_in || 8 * 60 * 60) * 1000,
    });

    res.redirect(`${baseUrl}/`);
  } catch (error) {
    next(error);
  }
}

// When mounted at /api/onboarding
router.get('/auth/callback', handleOAuthCallback);

// When mounted at /api/auth
authRouter.get('/callback', handleOAuthCallback);

/**
 * GET /api/onboarding/auth/me
 * Get the current authenticated user
 */
function handleAuthMe(req: Request, res: Response, next: NextFunction): void {
  try {
    const sessionId = req.cookies?.session;

    if (!sessionId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const session = db
      .prepare('SELECT * FROM sessions WHERE id = ? AND expires_at > datetime(?)')
      .get(sessionId, new Date().toISOString()) as SessionRow | undefined;

    if (!session) {
      res.status(401).json({ error: 'Session expired' });
      return;
    }

    res.json({
      user: {
        id: session.user_id,
        login: session.user_login,
        name: session.user_name,
        email: session.user_email,
        avatarUrl: session.user_avatar_url,
      },
    });
  } catch (error) {
    next(error);
  }
}

router.get('/auth/me', handleAuthMe);
authRouter.get('/me', handleAuthMe);

/**
 * POST /api/onboarding/auth/logout
 * Log out the current user
 */
function handleAuthLogout(req: Request, res: Response, next: NextFunction): void {
  try {
    const sessionId = (req as Request & { cookies?: Record<string, string> }).cookies?.session;

    if (sessionId) {
      db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    }

    res.clearCookie('session');
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
}

router.post('/auth/logout', handleAuthLogout);
authRouter.post('/logout', handleAuthLogout);

// ============================================
// Create credential from installation
// ============================================

/**
 * POST /api/onboarding/installations/:id/credential
 * Create a credential from a GitHub App installation
 */
router.post(
  '/installations/:id/credential',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const installationId = parseInt(req.params.id, 10);
      const { name, scope, target } = req.body;

      if (!name || !scope || !target) {
        res.status(400).json({
          error: 'Missing required fields: name, scope, target',
        });
        return;
      }

      // Verify installation exists
      const installation = db
        .prepare('SELECT * FROM github_app_installations WHERE id = ?')
        .get(installationId) as GitHubAppInstallationRow | undefined;

      if (!installation) {
        res.status(404).json({ error: 'Installation not found' });
        return;
      }

      // Create a placeholder token - the actual token is generated on demand
      // using the installation ID and GitHub App credentials
      const credentialId = uuidv4();
      const placeholderToken = `gha:${installationId}`;
      const encryptedToken = encrypt(placeholderToken);

      db.prepare(
        `INSERT INTO credentials (
          id, name, type, scope, target, encrypted_token, iv, auth_tag, installation_id, validated_at
        ) VALUES (?, ?, 'github_app', ?, ?, ?, ?, ?, ?, datetime('now'))`
      ).run(
        credentialId,
        name,
        scope,
        target,
        encryptedToken.encrypted,
        encryptedToken.iv,
        encryptedToken.authTag,
        installationId
      );

      res.status(201).json({
        credential: {
          id: credentialId,
          name,
          type: 'github_app',
          scope,
          target,
          installationId,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// Setup URL callback (after app installation)
// ============================================

/**
 * GET /onboarding/install-complete
 * Redirect handler after GitHub App installation
 */
router.get('/install-complete', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { installation_id } = req.query;

    if (installation_id) {
      // Refresh installations to capture the new one
      const app = getGitHubApp();
      if (app) {
        const privateKey = decrypt({
          encrypted: app.encrypted_private_key,
          iv: app.private_key_iv,
          authTag: app.private_key_auth_tag,
        });

        const appJwt = generateAppJWT(privateKey, app.client_id);
        const installations = await listInstallations(appJwt);

        // Sync the specific installation
        const newInstallation = installations.find(
          (i) => i.id === parseInt(installation_id as string, 10)
        );

        if (newInstallation) {
          db.prepare(
            `INSERT OR REPLACE INTO github_app_installations (
              id, app_id, target_id, target_type, account_login, account_id,
              repository_selection, permissions, events, suspended_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
          ).run(
            newInstallation.id,
            newInstallation.app_id,
            newInstallation.target_id,
            newInstallation.target_type,
            newInstallation.account.login,
            newInstallation.account.id,
            newInstallation.repository_selection,
            JSON.stringify(newInstallation.permissions),
            JSON.stringify(newInstallation.events),
            newInstallation.suspended_at
          );
        }
      }
    }

    // Redirect to frontend
    const baseUrl = getSetting('base_url') || '';
    res.redirect(`${baseUrl}/`);
  } catch (error) {
    next(error);
  }
});

// ============================================
// Webhook handling for installation events
// ============================================

/**
 * Handle installation webhook events
 * Called from the main webhooks router
 */
export async function handleInstallationWebhook(
  action: string,
  installation: GitHubAppInstallation
): Promise<void> {
  if (action === 'created') {
    db.prepare(
      `INSERT OR REPLACE INTO github_app_installations (
        id, app_id, target_id, target_type, account_login, account_id,
        repository_selection, permissions, events, suspended_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    ).run(
      installation.id,
      installation.app_id,
      installation.target_id,
      installation.target_type,
      installation.account.login,
      installation.account.id,
      installation.repository_selection,
      JSON.stringify(installation.permissions),
      JSON.stringify(installation.events),
      installation.suspended_at
    );

    // Auto-create credentials for this installation (per-repo for User installations)
    await ensureCredentialsForInstallation({
      id: installation.id,
      target_type: installation.target_type,
      account_login: installation.account.login,
    });
  } else if (action === 'deleted') {
    // Delete associated credentials (there may be multiple for User installations)
    db.prepare('DELETE FROM credentials WHERE installation_id = ?').run(
      installation.id
    );
    db.prepare('DELETE FROM github_app_installations WHERE id = ?').run(
      installation.id
    );
  } else if (action === 'suspend') {
    db.prepare(
      `UPDATE github_app_installations 
       SET suspended_at = datetime('now'), updated_at = datetime('now') 
       WHERE id = ?`
    ).run(installation.id);
  } else if (action === 'unsuspend') {
    db.prepare(
      `UPDATE github_app_installations 
       SET suspended_at = NULL, updated_at = datetime('now') 
       WHERE id = ?`
    ).run(installation.id);
  }
}

export { router as onboardingRouter, authRouter, githubAppRouter };

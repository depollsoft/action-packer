/**
 * Onboarding and GitHub App setup routes
 * Handles the initial setup flow for Action Packer
 */

import { Router, Request, Response, NextFunction } from 'express';
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
  type GitHubAppCredentials,
  type GitHubAppInstallation,
} from '../services/githubApp.js';

const router = Router();

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
router.get('/github-app/callback', async (req: Request, res: Response, next: NextFunction) => {
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
});

/**
 * Store GitHub App credentials in the database
 */
async function storeGitHubAppCredentials(credentials: GitHubAppCredentials): Promise<void> {
  // Encrypt sensitive values
  const encryptedClientSecret = encrypt(credentials.client_secret);
  const encryptedPrivateKey = encrypt(credentials.pem);
  const encryptedWebhookSecret = encrypt(credentials.webhook_secret);

  // Use a single IV/authTag for all encrypted fields (they're decrypted together)
  // In a more complex system, you might use separate encryption for each field

  db.prepare(
    `INSERT OR REPLACE INTO github_app (
      id, app_id, app_slug, app_name, client_id,
      encrypted_client_secret, encrypted_private_key, encrypted_webhook_secret,
      iv, auth_tag, owner_login, owner_id, owner_type, html_url,
      permissions, events, updated_at
    ) VALUES (
      1, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, datetime('now')
    )`
  ).run(
    credentials.id,
    credentials.slug,
    credentials.name,
    credentials.client_id,
    encryptedClientSecret.encrypted,
    encryptedPrivateKey.encrypted,
    encryptedWebhookSecret.encrypted,
    encryptedPrivateKey.iv, // Use the IV from private key encryption
    encryptedPrivateKey.authTag,
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
            encrypted_client_secret, encrypted_private_key, encrypted_webhook_secret,
            iv, auth_tag, owner_login, owner_id, owner_type, html_url,
            permissions, events, updated_at
          ) VALUES (
            1, ?, ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?, ?, ?, ?,
            ?, ?, datetime('now')
          )`
        ).run(
          appId,
          appInfo.slug,
          appName || appInfo.name,
          clientId,
          encryptedClientSecret.encrypted,
          encryptedPrivateKey.encrypted,
          encryptedWebhookSecret.encrypted,
          encryptedPrivateKey.iv,
          encryptedPrivateKey.authTag,
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
        iv: app.iv,
        authTag: app.auth_tag,
      });

      const appJwt = generateAppJWT(privateKey, app.client_id);
      const installations = await listInstallations(appJwt);

      // Sync installations to database
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

    // Return installations from database
    const rows = db
      .prepare('SELECT * FROM github_app_installations ORDER BY account_login')
      .all() as GitHubAppInstallationRow[];

    const installations = rows.map((row) => ({
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
    }));

    res.json({ installations });
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
router.get('/auth/login', (_req: Request, res: Response, next: NextFunction) => {
  try {
    const app = getGitHubApp();

    if (!app) {
      res.status(404).json({ error: 'GitHub App not configured' });
      return;
    }

    const baseUrl = getSetting('base_url') || '';
    const redirectUri = `${baseUrl}/api/auth/callback`;

    // Generate and store state for CSRF protection
    const state = generateSecret(16);
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
});

/**
 * GET /api/auth/callback
 * Handle the OAuth callback from GitHub
 */
router.get('/auth/callback', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { code, state } = req.query;

    if (!code || typeof code !== 'string') {
      res.status(400).json({ error: 'Missing code parameter' });
      return;
    }

    // Verify state
    const expectedState = getSetting('oauth_state');
    if (state !== expectedState) {
      res.status(400).json({ error: 'Invalid state parameter' });
      return;
    }

    // Clear the state
    db.prepare('DELETE FROM app_settings WHERE key = ?').run('oauth_state');

    const app = getGitHubApp();
    if (!app) {
      res.status(500).json({ error: 'GitHub App not configured' });
      return;
    }

    // Decrypt client secret
    const clientSecret = decrypt({
      encrypted: app.encrypted_client_secret,
      iv: app.iv,
      authTag: app.auth_tag,
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
});

/**
 * GET /api/onboarding/auth/me
 * Get the current authenticated user
 */
router.get('/auth/me', (req: Request, res: Response, next: NextFunction) => {
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
});

/**
 * POST /api/onboarding/auth/logout
 * Log out the current user
 */
router.post('/auth/logout', (req: Request, res: Response, next: NextFunction) => {
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
});

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
          iv: app.iv,
          authTag: app.auth_tag,
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
export function handleInstallationWebhook(
  action: string,
  installation: GitHubAppInstallation
): void {
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
  } else if (action === 'deleted') {
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

export { router as onboardingRouter };

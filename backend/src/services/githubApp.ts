/**
 * GitHub App authentication and management service
 * Handles manifest-based app creation, JWT generation, and installation tokens
 */

import jwt from 'jsonwebtoken';
import { Octokit } from '@octokit/rest';

// ============================================
// Types
// ============================================

export interface GitHubAppManifest {
  name: string;
  url: string;
  description?: string;
  hook_attributes?: {
    url: string;
    active?: boolean;
  };
  redirect_url?: string;
  callback_urls?: string[];
  setup_url?: string;
  setup_on_update?: boolean;
  public?: boolean;
  default_permissions?: GitHubAppPermissions;
  default_events?: GitHubWebhookEvent[];
  request_oauth_on_install?: boolean;
}

export interface GitHubAppPermissions {
  // Repository permissions
  actions?: 'read' | 'write';
  administration?: 'read' | 'write';
  metadata?: 'read';
  contents?: 'read' | 'write';
  // Organization permissions
  organization_self_hosted_runners?: 'read' | 'write';
  organization_administration?: 'read' | 'write';
  members?: 'read';
}

export type GitHubWebhookEvent =
  | 'workflow_job'
  | 'workflow_run'
  | 'check_run'
  | 'check_suite'
  | 'push'
  | 'pull_request'
  | 'installation'
  | 'installation_repositories';

export interface GitHubAppCredentials {
  id: number;
  slug: string;
  client_id: string;
  client_secret: string;
  webhook_secret: string;
  pem: string;
  name: string;
  owner: {
    login: string;
    id: number;
    type?: 'User' | 'Organization';
  };
  html_url?: string;
  permissions: GitHubAppPermissions;
  events: GitHubWebhookEvent[];
  created_at?: string;
  updated_at?: string;
}

export interface GitHubAppInstallation {
  id: number;
  app_id: number;
  app_slug?: string;
  target_id: number;
  target_type: 'User' | 'Organization';
  account: {
    login: string;
    id: number;
    type: 'User' | 'Organization';
  };
  repository_selection: 'all' | 'selected';
  access_tokens_url: string;
  repositories_url: string;
  permissions: GitHubAppPermissions;
  events: GitHubWebhookEvent[];
  created_at: string;
  updated_at: string;
  suspended_at: string | null;
}

export interface InstallationAccessToken {
  token: string;
  expires_at: string;
  permissions: GitHubAppPermissions;
  repository_selection?: 'all' | 'selected';
  repositories?: Array<{
    id: number;
    name: string;
    full_name: string;
  }>;
}

export interface GitHubUserAccessToken {
  access_token: string;
  token_type: 'bearer';
  scope: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
}

export interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string;
  html_url: string;
  type: 'User';
}

// ============================================
// Manifest Generation
// ============================================

/**
 * Generate a GitHub App manifest for self-hosted runner management
 */
export function generateAppManifest(options: {
  name: string;
  baseUrl: string;
  webhookUrl?: string;
  description?: string;
  forOrganization?: boolean;
}): GitHubAppManifest {
  const { name, baseUrl, webhookUrl, description, forOrganization } = options;
  
  const manifest: GitHubAppManifest = {
    name,
    url: baseUrl,
    description: description || 'Self-hosted GitHub Actions runner manager created by Action Packer',
    hook_attributes: {
      url: webhookUrl || `${baseUrl}/api/webhooks/github`,
      active: true,
    },
    redirect_url: `${baseUrl}/api/github-app/callback`,
    callback_urls: [
      `${baseUrl}/api/auth/callback`,
    ],
    setup_url: `${baseUrl}/onboarding/install-complete`,
    setup_on_update: true,
    public: false,
    default_permissions: {
      metadata: 'read',
      actions: 'read',
      administration: 'write', // Required for repo-level runners
    },
    default_events: [
      'workflow_job',
    ],
    request_oauth_on_install: false,
  };
  
  // Add org-level permissions if creating for an organization
  if (forOrganization) {
    manifest.default_permissions = {
      ...manifest.default_permissions,
      organization_self_hosted_runners: 'write',
      organization_administration: 'read',
      members: 'read',
    };
  }
  
  return manifest;
}

// ============================================
// JWT Generation
// ============================================

/**
 * Generate a JWT for authenticating as a GitHub App
 * JWTs are valid for up to 10 minutes
 */
export function generateAppJWT(privateKey: string, clientId: string): string {
  const now = Math.floor(Date.now() / 1000);
  
  const payload = {
    iat: now - 60, // Issued 60 seconds in the past for clock drift
    exp: now + 600, // Expires in 10 minutes
    iss: clientId,
  };
  
  return jwt.sign(payload, privateKey, { algorithm: 'RS256' });
}

// ============================================
// API Calls
// ============================================

/**
 * Exchange manifest creation code for app credentials
 * This must be called within 1 hour of app creation
 */
export async function exchangeManifestCode(code: string): Promise<GitHubAppCredentials> {
  const response = await fetch(
    `https://api.github.com/app-manifests/${code}/conversions`,
    {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    }
  );
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      error.message || `Failed to exchange manifest code: ${response.status}`
    );
  }
  
  return response.json();
}

/**
 * Get the authenticated GitHub App info
 */
export async function getAppInfo(appJwt: string): Promise<{
  id: number;
  slug: string;
  name: string;
  owner: { login: string; id: number };
  permissions: GitHubAppPermissions;
  events: GitHubWebhookEvent[];
}> {
  const response = await fetch('https://api.github.com/app', {
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${appJwt}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || `Failed to get app info: ${response.status}`);
  }
  
  return response.json();
}

/**
 * List all installations for the GitHub App
 */
export async function listInstallations(
  appJwt: string
): Promise<GitHubAppInstallation[]> {
  const response = await fetch('https://api.github.com/app/installations', {
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${appJwt}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      error.message || `Failed to list installations: ${response.status}`
    );
  }
  
  return response.json();
}

/**
 * Get installation for a specific repository
 */
export async function getRepoInstallation(
  appJwt: string,
  owner: string,
  repo: string
): Promise<GitHubAppInstallation | null> {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/installation`,
    {
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${appJwt}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    }
  );
  
  if (response.status === 404) {
    return null;
  }
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      error.message || `Failed to get repo installation: ${response.status}`
    );
  }
  
  return response.json();
}

/**
 * Get installation for a specific organization
 */
export async function getOrgInstallation(
  appJwt: string,
  org: string
): Promise<GitHubAppInstallation | null> {
  const response = await fetch(
    `https://api.github.com/orgs/${org}/installation`,
    {
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${appJwt}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    }
  );
  
  if (response.status === 404) {
    return null;
  }
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      error.message || `Failed to get org installation: ${response.status}`
    );
  }
  
  return response.json();
}

/**
 * Get installation for a specific user
 */
export async function getUserInstallation(
  appJwt: string,
  username: string
): Promise<GitHubAppInstallation | null> {
  const response = await fetch(
    `https://api.github.com/users/${username}/installation`,
    {
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${appJwt}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    }
  );
  
  if (response.status === 404) {
    return null;
  }
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      error.message || `Failed to get user installation: ${response.status}`
    );
  }
  
  return response.json();
}

/**
 * Generate an installation access token
 */
export async function getInstallationAccessToken(
  appJwt: string,
  installationId: number,
  options?: {
    repositories?: string[];
    repository_ids?: number[];
    permissions?: GitHubAppPermissions;
  }
): Promise<InstallationAccessToken> {
  const response = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${appJwt}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: options ? JSON.stringify(options) : undefined,
    }
  );
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      error.message || `Failed to get installation token: ${response.status}`
    );
  }
  
  return response.json();
}

// ============================================
// OAuth Flow
// ============================================

/**
 * Generate OAuth authorization URL for user authentication
 */
export function getOAuthAuthorizationUrl(options: {
  clientId: string;
  redirectUri: string;
  state: string;
  allowSignup?: boolean;
}): string {
  const { clientId, redirectUri, state, allowSignup = false } = options;
  
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    allow_signup: String(allowSignup),
  });
  
  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

/**
 * Exchange OAuth code for user access token
 */
export async function exchangeOAuthCode(options: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri?: string;
}): Promise<GitHubUserAccessToken> {
  const { clientId, clientSecret, code, redirectUri } = options;
  
  const body: Record<string, string> = {
    client_id: clientId,
    client_secret: clientSecret,
    code,
  };
  
  if (redirectUri) {
    body.redirect_uri = redirectUri;
  }
  
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  
  if (!response.ok) {
    throw new Error(`OAuth token exchange failed: ${response.status}`);
  }
  
  const data = await response.json();
  
  if (data.error) {
    throw new Error(data.error_description || data.error);
  }
  
  return data;
}

/**
 * Get authenticated user info using access token
 */
export async function getAuthenticatedUser(
  accessToken: string
): Promise<GitHubUser> {
  const response = await fetch('https://api.github.com/user', {
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${accessToken}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || `Failed to get user: ${response.status}`);
  }
  
  return response.json();
}

// ============================================
// GitHub App Client
// ============================================

/**
 * Create an Octokit client authenticated as the GitHub App installation
 */
export class GitHubAppClient {
  private privateKey: string;
  private clientId: string;
  private installationId: number;
  private tokenCache: { token: string; expiresAt: Date } | null = null;
  
  constructor(options: {
    privateKey: string;
    clientId: string;
    appId: number;
    installationId: number;
  }) {
    this.privateKey = options.privateKey;
    this.clientId = options.clientId;
    // appId is accepted for API compatibility but not stored - we use clientId for JWT
    this.installationId = options.installationId;
  }
  
  /**
   * Get a valid installation access token, using cache if available
   */
  async getToken(): Promise<string> {
    // Check if we have a valid cached token (with 5 minute buffer)
    if (this.tokenCache) {
      const bufferTime = 5 * 60 * 1000; // 5 minutes
      if (this.tokenCache.expiresAt.getTime() - Date.now() > bufferTime) {
        return this.tokenCache.token;
      }
    }
    
    // Generate new JWT and get installation token
    const appJwt = generateAppJWT(this.privateKey, this.clientId);
    const tokenData = await getInstallationAccessToken(appJwt, this.installationId);
    
    // Cache the token
    this.tokenCache = {
      token: tokenData.token,
      expiresAt: new Date(tokenData.expires_at),
    };
    
    return tokenData.token;
  }
  
  /**
   * Get an Octokit client with the installation token
   */
  async getOctokit(): Promise<Octokit> {
    const token = await this.getToken();
    return new Octokit({ auth: token });
  }
  
  /**
   * Validate the GitHub App credentials
   */
  async validate(): Promise<{ valid: boolean; error?: string }> {
    try {
      const appJwt = generateAppJWT(this.privateKey, this.clientId);
      await getAppInfo(appJwt);
      
      // Also validate the installation
      await this.getToken();
      
      return { valid: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { valid: false, error: message };
    }
  }
  
  /**
   * List repositories accessible to this installation
   */
  async listRepositories(): Promise<Array<{ id: number; name: string; full_name: string; owner: string }>> {
    const octokit = await this.getOctokit();
    const repos: Array<{ id: number; name: string; full_name: string; owner: string }> = [];
    
    try {
      for await (const response of octokit.paginate.iterator(
        octokit.rest.apps.listReposAccessibleToInstallation,
        { per_page: 100 }
      )) {
        for (const repo of response.data) {
          repos.push({
            id: repo.id,
            name: repo.name,
            full_name: repo.full_name,
            owner: repo.owner.login,
          });
        }
      }
    } catch (error) {
      console.error('Failed to list installation repositories:', error);
    }
    
    return repos;
  }
}

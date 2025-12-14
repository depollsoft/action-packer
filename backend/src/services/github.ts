/**
 * GitHub API client service using Octokit
 * Handles authentication, rate limiting, and common operations
 */

import { Octokit } from '@octokit/rest';

export type GitHubScope = 'repo' | 'org';

export type GitHubRunner = {
  id: number;
  name: string;
  os: string;
  status: 'online' | 'offline';
  busy: boolean;
  labels: Array<{ id?: number; name: string; type?: string }>;
};

export type GitHubRunnerDownload = {
  os: string;
  architecture: string;
  download_url: string;
  filename: string;
  temp_download_token?: string;
  sha256_checksum?: string;
};

export type RegistrationToken = {
  token: string;
  expires_at: string;
};

export type Repository = {
  id: number;
  name: string;
  full_name: string;
  owner: {
    login: string;
    type: string;
  };
  private: boolean;
  html_url: string;
};

export type Organization = {
  id: number;
  login: string;
  description: string | null;
  html_url: string;
};

/**
 * GitHub API client wrapper
 */
export class GitHubClient {
  private octokit: Octokit;
  private scope: GitHubScope;
  private target: string;

  constructor(token: string, scope: GitHubScope, target: string) {
    this.octokit = new Octokit({ auth: token });
    this.scope = scope;
    this.target = target;
  }

  /**
   * Parse owner and repo from target string
   */
  private parseRepoTarget(): { owner: string; repo: string } {
    const parts = this.target.split('/');
    if (parts.length !== 2) {
      throw new Error(`Invalid repository target: ${this.target}. Expected format: owner/repo`);
    }
    return { owner: parts[0], repo: parts[1] };
  }

  /**
   * Validate the token by fetching the authenticated user
   */
  async validateToken(): Promise<{ valid: boolean; login?: string; error?: string }> {
    try {
      const { data } = await this.octokit.rest.users.getAuthenticated();
      return { valid: true, login: data.login };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { valid: false, error: message };
    }
  }

  /**
   * Check if the token has admin access to the target repo/org
   */
  async checkAdminAccess(): Promise<{ hasAccess: boolean; error?: string }> {
    try {
      if (this.scope === 'repo') {
        const { owner, repo } = this.parseRepoTarget();
        const { data } = await this.octokit.rest.repos.get({ owner, repo });
        // Need admin permission to manage runners
        if (!data.permissions?.admin) {
          return { hasAccess: false, error: 'Token does not have admin access to repository' };
        }
      } else {
        // For org, check membership with admin role
        const { data } = await this.octokit.rest.orgs.getMembershipForAuthenticatedUser({
          org: this.target,
        });
        if (data.role !== 'admin') {
          return { hasAccess: false, error: 'Token does not have admin access to organization' };
        }
      }
      return { hasAccess: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { hasAccess: false, error: message };
    }
  }

  /**
   * List repositories accessible with this token
   */
  async listRepositories(): Promise<Repository[]> {
    const repos: Repository[] = [];
    
    try {
      if (this.scope === 'org') {
        // List org repos
        for await (const response of this.octokit.paginate.iterator(
          this.octokit.rest.repos.listForOrg,
          { org: this.target, per_page: 100 }
        )) {
          repos.push(...response.data.map(r => ({
            id: r.id,
            name: r.name,
            full_name: r.full_name,
            owner: { login: r.owner.login, type: r.owner.type ?? 'User' },
            private: r.private,
            html_url: r.html_url,
          })));
        }
      } else {
        // For repo scope, just return the single repo
        const { owner, repo } = this.parseRepoTarget();
        const { data } = await this.octokit.rest.repos.get({ owner, repo });
        repos.push({
          id: data.id,
          name: data.name,
          full_name: data.full_name,
          owner: { login: data.owner.login, type: data.owner.type ?? 'User' },
          private: data.private,
          html_url: data.html_url,
        });
      }
    } catch (error) {
      console.error('Failed to list repositories:', error);
      throw error;
    }
    
    return repos;
  }

  /**
   * List organizations the authenticated user belongs to
   */
  async listOrganizations(): Promise<Organization[]> {
    const orgs: Organization[] = [];
    
    try {
      for await (const response of this.octokit.paginate.iterator(
        this.octokit.rest.orgs.listForAuthenticatedUser,
        { per_page: 100 }
      )) {
        orgs.push(...response.data.map(o => ({
          id: o.id,
          login: o.login,
          description: o.description,
          html_url: o.url,
        })));
      }
    } catch (error) {
      console.error('Failed to list organizations:', error);
      throw error;
    }
    
    return orgs;
  }

  /**
   * Get runner downloads for the target
   */
  async getRunnerDownloads(): Promise<GitHubRunnerDownload[]> {
    try {
      if (this.scope === 'repo') {
        const { owner, repo } = this.parseRepoTarget();
        const { data } = await this.octokit.rest.actions.listRunnerApplicationsForRepo({
          owner,
          repo,
        });
        return data as GitHubRunnerDownload[];
      } else {
        const { data } = await this.octokit.rest.actions.listRunnerApplicationsForOrg({
          org: this.target,
        });
        return data as GitHubRunnerDownload[];
      }
    } catch (error) {
      console.error('Failed to get runner downloads:', error);
      throw error;
    }
  }

  /**
   * Create a registration token for adding a new runner
   */
  async createRegistrationToken(): Promise<RegistrationToken> {
    try {
      if (this.scope === 'repo') {
        const { owner, repo } = this.parseRepoTarget();
        const { data } = await this.octokit.rest.actions.createRegistrationTokenForRepo({
          owner,
          repo,
        });
        return { token: data.token, expires_at: data.expires_at };
      } else {
        const { data } = await this.octokit.rest.actions.createRegistrationTokenForOrg({
          org: this.target,
        });
        return { token: data.token, expires_at: data.expires_at };
      }
    } catch (error) {
      console.error('Failed to create registration token:', error);
      throw error;
    }
  }

  /**
   * Create a remove token for removing a runner
   */
  async createRemoveToken(): Promise<RegistrationToken> {
    try {
      if (this.scope === 'repo') {
        const { owner, repo } = this.parseRepoTarget();
        const { data } = await this.octokit.rest.actions.createRemoveTokenForRepo({
          owner,
          repo,
        });
        return { token: data.token, expires_at: data.expires_at };
      } else {
        const { data } = await this.octokit.rest.actions.createRemoveTokenForOrg({
          org: this.target,
        });
        return { token: data.token, expires_at: data.expires_at };
      }
    } catch (error) {
      console.error('Failed to create remove token:', error);
      throw error;
    }
  }

  /**
   * List runners for the target
   */
  async listRunners(): Promise<GitHubRunner[]> {
    const runners: GitHubRunner[] = [];
    
    try {
      if (this.scope === 'repo') {
        const { owner, repo } = this.parseRepoTarget();
        for await (const response of this.octokit.paginate.iterator(
          this.octokit.rest.actions.listSelfHostedRunnersForRepo,
          { owner, repo, per_page: 100 }
        )) {
          runners.push(...response.data.map(r => ({
            id: r.id,
            name: r.name,
            os: r.os,
            status: r.status as 'online' | 'offline',
            busy: r.busy,
            labels: r.labels,
          })));
        }
      } else {
        for await (const response of this.octokit.paginate.iterator(
          this.octokit.rest.actions.listSelfHostedRunnersForOrg,
          { org: this.target, per_page: 100 }
        )) {
          runners.push(...response.data.map(r => ({
            id: r.id,
            name: r.name,
            os: r.os,
            status: r.status as 'online' | 'offline',
            busy: r.busy,
            labels: r.labels,
          })));
        }
      }
    } catch (error) {
      console.error('Failed to list runners:', error);
      throw error;
    }
    
    return runners;
  }

  /**
   * Get a specific runner by ID
   */
  async getRunner(runnerId: number): Promise<GitHubRunner | null> {
    try {
      if (this.scope === 'repo') {
        const { owner, repo } = this.parseRepoTarget();
        const { data } = await this.octokit.rest.actions.getSelfHostedRunnerForRepo({
          owner,
          repo,
          runner_id: runnerId,
        });
        return {
          id: data.id,
          name: data.name,
          os: data.os,
          status: data.status as 'online' | 'offline',
          busy: data.busy,
          labels: data.labels,
        };
      } else {
        const { data } = await this.octokit.rest.actions.getSelfHostedRunnerForOrg({
          org: this.target,
          runner_id: runnerId,
        });
        return {
          id: data.id,
          name: data.name,
          os: data.os,
          status: data.status as 'online' | 'offline',
          busy: data.busy,
          labels: data.labels,
        };
      }
    } catch (error) {
      console.error('Failed to get runner:', error);
      return null;
    }
  }

  /**
   * Delete a runner by ID
   */
  async deleteRunner(runnerId: number): Promise<boolean> {
    try {
      if (this.scope === 'repo') {
        const { owner, repo } = this.parseRepoTarget();
        await this.octokit.rest.actions.deleteSelfHostedRunnerFromRepo({
          owner,
          repo,
          runner_id: runnerId,
        });
      } else {
        await this.octokit.rest.actions.deleteSelfHostedRunnerFromOrg({
          org: this.target,
          runner_id: runnerId,
        });
      }
      return true;
    } catch (error) {
      console.error('Failed to delete runner:', error);
      return false;
    }
  }

  /**
   * Set labels on a runner (replaces existing custom labels)
   */
  async setRunnerLabels(runnerId: number, labels: string[]): Promise<boolean> {
    try {
      if (this.scope === 'repo') {
        const { owner, repo } = this.parseRepoTarget();
        await this.octokit.rest.actions.setCustomLabelsForSelfHostedRunnerForRepo({
          owner,
          repo,
          runner_id: runnerId,
          labels,
        });
      } else {
        await this.octokit.rest.actions.setCustomLabelsForSelfHostedRunnerForOrg({
          org: this.target,
          runner_id: runnerId,
          labels,
        });
      }
      return true;
    } catch (error) {
      console.error('Failed to set runner labels:', error);
      return false;
    }
  }

  /**
   * Create a webhook for the target (for autoscaling)
   */
  async createWebhook(
    webhookUrl: string,
    secret: string,
    events: string[] = ['workflow_job']
  ): Promise<{ id: number } | null> {
    try {
      if (this.scope === 'repo') {
        const { owner, repo } = this.parseRepoTarget();
        const { data } = await this.octokit.rest.repos.createWebhook({
          owner,
          repo,
          config: {
            url: webhookUrl,
            content_type: 'json',
            secret,
          },
          events,
          active: true,
        });
        return { id: data.id };
      } else {
        const { data } = await this.octokit.rest.orgs.createWebhook({
          org: this.target,
          name: 'web',
          config: {
            url: webhookUrl,
            content_type: 'json',
            secret,
          },
          events,
          active: true,
        });
        return { id: data.id };
      }
    } catch (error) {
      console.error('Failed to create webhook:', error);
      return null;
    }
  }

  /**
   * Delete a webhook
   */
  async deleteWebhook(webhookId: number): Promise<boolean> {
    try {
      if (this.scope === 'repo') {
        const { owner, repo } = this.parseRepoTarget();
        await this.octokit.rest.repos.deleteWebhook({
          owner,
          repo,
          hook_id: webhookId,
        });
      } else {
        await this.octokit.rest.orgs.deleteWebhook({
          org: this.target,
          hook_id: webhookId,
        });
      }
      return true;
    } catch (error) {
      console.error('Failed to delete webhook:', error);
      return false;
    }
  }
}

/**
 * Create a GitHub client from credential data
 */
export function createGitHubClient(
  token: string,
  scope: GitHubScope,
  target: string
): GitHubClient {
  return new GitHubClient(token, scope, target);
}

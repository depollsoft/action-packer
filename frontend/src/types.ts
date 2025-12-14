/**
 * Shared type definitions for the frontend
 */

export type Credential = {
  id: string;
  name: string;
  type: 'pat' | 'github_app';
  scope: 'repo' | 'org';
  target: string;
  created_at: string;
  updated_at: string;
  validated_at: string | null;
};

export type RunnerStatus = 'pending' | 'configuring' | 'online' | 'offline' | 'busy' | 'error' | 'removing';

export type IsolationType = 'native' | 'docker' | 'tart' | 'hyperv';

export type Runner = {
  id: string;
  name: string;
  credential_id: string;
  credential_name: string;
  scope: 'repo' | 'org';
  target: string;
  github_runner_id: number | null;
  status: RunnerStatus;
  platform: 'darwin' | 'linux' | 'win32';
  architecture: 'x64' | 'arm64';
  isolation_type: IsolationType;
  labels: string[];
  runner_dir: string | null;
  process_id: number | null;
  container_id: string | null;
  error_message: string | null;
  pool_id: string | null;
  ephemeral: boolean;
  created_at: string;
  updated_at: string;
  last_heartbeat: string | null;
};

export type RunnerPool = {
  id: string;
  name: string;
  credential_id: string;
  credential_name: string;
  scope: 'repo' | 'org';
  target: string;
  platform: 'darwin' | 'linux' | 'win32';
  architecture: 'x64' | 'arm64';
  isolation_type: IsolationType;
  labels: string[];
  min_runners: number;
  max_runners: number;
  warm_runners: number;
  idle_timeout_minutes: number;
  enabled: boolean;
  runner_count: number;
  online_count: number;
  busy_count: number;
  created_at: string;
  updated_at: string;
};

export type SystemInfo = {
  platform: 'darwin' | 'linux' | 'win32';
  architecture: 'x64' | 'arm64';
  dockerAvailable: boolean;
  defaultIsolation: IsolationType;
  supportedIsolationTypes: Array<{
    type: IsolationType;
    available: boolean;
    description: string;
  }>;
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

export type GitHubRunner = {
  id: number;
  name: string;
  os: string;
  status: 'online' | 'offline';
  busy: boolean;
  labels: Array<{ id?: number; name: string; type?: string }>;
};

// API Response types
export type ApiResponse<T> = {
  data?: T;
  error?: string;
};

export type CredentialsResponse = { credentials: Credential[] };
export type CredentialResponse = { credential: Credential };
export type RunnersResponse = { runners: Runner[] };
export type RunnerResponse = { runner: Runner; message?: string };
export type PoolsResponse = { pools: RunnerPool[] };
export type PoolResponse = { pool: RunnerPool };
export type RepositoriesResponse = { repositories: Repository[] };
export type OrganizationsResponse = { organizations: Organization[] };
export type GitHubRunnersResponse = { runners: GitHubRunner[] };
export type ValidationResponse = { valid: boolean; login?: string; error?: string };

// WebSocket message types
export type WebSocketMessage = {
  type: 'runner_update' | 'pool_update' | 'credential_update';
  data: unknown;
  timestamp: string;
};

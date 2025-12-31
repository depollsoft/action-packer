/**
 * API client for communicating with the backend
 */

import type {
  SystemInfo,
  CredentialsResponse,
  CredentialResponse,
  RunnersResponse,
  RunnerResponse,
  PoolsResponse,
  PoolResponse,
  RepositoriesResponse,
  OrganizationsResponse,
  GitHubRunnersResponse,
  ValidationResponse,
} from './types';

const API_BASE = import.meta.env.VITE_API_URL || '';

// Custom error class for API errors
export class ApiError extends Error {
  code: string;
  status: number;
  
  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
  
  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }
  
  get isNotAuthenticated(): boolean {
    return this.code === 'NOT_AUTHENTICATED' || this.code === 'SESSION_EXPIRED';
  }
  
  get isNotAdmin(): boolean {
    return this.code === 'NOT_ADMIN';
  }
}

// Event emitter for auth errors
type AuthErrorListener = (error: ApiError) => void;
const authErrorListeners: Set<AuthErrorListener> = new Set();

export function onAuthError(listener: AuthErrorListener): () => void {
  authErrorListeners.add(listener);
  return () => authErrorListeners.delete(listener);
}

function notifyAuthError(error: ApiError): void {
  authErrorListeners.forEach(listener => listener(error));
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE}${endpoint}`;
  
  const response = await fetch(url, {
    ...options,
    credentials: 'include', // Include cookies for session auth
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ 
      error: 'Request failed',
      code: 'UNKNOWN_ERROR'
    }));
    
    const apiError = new ApiError(
      error.message || error.error || `HTTP ${response.status}`,
      error.code || 'UNKNOWN_ERROR',
      response.status
    );
    
    // Notify listeners of auth errors
    if (apiError.isAuthError) {
      notifyAuthError(apiError);
    }
    
    throw apiError;
  }
  
  // Handle 204 No Content
  if (response.status === 204) {
    return {} as T;
  }
  
  return response.json();
}

// Credentials API
export const credentialsApi = {
  list: () => request<CredentialsResponse>('/api/credentials'),
  
  get: (id: string) => request<CredentialResponse>(`/api/credentials/${id}`),
  
  create: (data: {
    name: string;
    scope: 'repo' | 'org';
    target: string;
    token: string;
  }) => request<CredentialResponse>('/api/credentials', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  
  update: (id: string, data: { name?: string; token?: string }) =>
    request<CredentialResponse>(`/api/credentials/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  
  delete: (id: string) =>
    request<void>(`/api/credentials/${id}`, { method: 'DELETE' }),
  
  validate: (id: string) =>
    request<ValidationResponse>(`/api/credentials/${id}/validate`, {
      method: 'POST',
    }),
  
  listRepos: (id: string) =>
    request<RepositoriesResponse>(`/api/credentials/${id}/repos`),
  
  listOrgs: (id: string) =>
    request<OrganizationsResponse>(`/api/credentials/${id}/orgs`),
  
  listGitHubRunners: (id: string) =>
    request<GitHubRunnersResponse>(`/api/credentials/${id}/github-runners`),
};

// Runners API
export const runnersApi = {
  getSystemInfo: () => request<SystemInfo>('/api/runners/system-info'),
  
  list: (params?: { credentialId?: string; poolId?: string }) => {
    const searchParams = new URLSearchParams();
    if (params?.credentialId) searchParams.set('credentialId', params.credentialId);
    if (params?.poolId) searchParams.set('poolId', params.poolId);
    const query = searchParams.toString();
    return request<RunnersResponse>(`/api/runners${query ? `?${query}` : ''}`);
  },
  
  get: (id: string) => request<RunnerResponse>(`/api/runners/${id}`),
  
  create: (data: {
    name: string;
    credentialId: string;
    labels?: string[];
    platform?: 'darwin' | 'linux' | 'win32';
    architecture?: 'x64' | 'arm64';
    isolationType?: 'native' | 'docker' | 'tart' | 'hyperv';
    ephemeral?: boolean;
    poolId?: string;
  }) => request<RunnerResponse>('/api/runners', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  
  update: (id: string, data: { name?: string; labels?: string[] }) =>
    request<RunnerResponse>(`/api/runners/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  
  delete: (id: string) =>
    request<void>(`/api/runners/${id}`, { method: 'DELETE' }),
  
  start: (id: string) =>
    request<RunnerResponse>(`/api/runners/${id}/start`, { method: 'POST' }),
  
  stop: (id: string) =>
    request<RunnerResponse>(`/api/runners/${id}/stop`, { method: 'POST' }),
  
  sync: (id: string) =>
    request<RunnerResponse>(`/api/runners/${id}/sync`, { method: 'POST' }),
};

// Pools API
export const poolsApi = {
  list: () => request<PoolsResponse>('/api/pools'),
  
  get: (id: string) => request<PoolResponse>(`/api/pools/${id}`),
  
  create: (data: {
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
    enableKvm?: boolean;
    enableDockerSocket?: boolean;
    enablePrivileged?: boolean;
  }) => request<PoolResponse>('/api/pools', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  
  update: (id: string, data: {
    name?: string;
    labels?: string[];
    minRunners?: number;
    maxRunners?: number;
    warmRunners?: number;
    idleTimeoutMinutes?: number;
    enabled?: boolean;
    enableKvm?: boolean;
    enableDockerSocket?: boolean;
    enablePrivileged?: boolean;
  }) => request<PoolResponse>(`/api/pools/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  }),
  
  delete: (id: string) =>
    request<void>(`/api/pools/${id}`, { method: 'DELETE' }),
  
  listRunners: (id: string) =>
    request<RunnersResponse>(`/api/pools/${id}/runners`),
  
  setupWebhook: (id: string, webhookUrl: string) =>
    request<{ webhook: { id: string; githubWebhookId: number; events: string[] } }>(
      `/api/pools/${id}/webhook`,
      {
        method: 'POST',
        body: JSON.stringify({ webhookUrl }),
      }
    ),
  
  removeWebhook: (id: string) =>
    request<void>(`/api/pools/${id}/webhook`, { method: 'DELETE' }),
};

// Onboarding API
export const onboardingApi = {
  getStatus: () =>
    request<import('./types').SetupStatus>('/api/onboarding/status'),
  
  setBaseUrl: (baseUrl: string) =>
    request<{ success: boolean; baseUrl: string }>('/api/onboarding/base-url', {
      method: 'POST',
      body: JSON.stringify({ baseUrl }),
    }),
  
  getManifest: (options?: { org?: string; name?: string }) => {
    const params = new URLSearchParams();
    if (options?.org) params.set('org', options.org);
    if (options?.name) params.set('name', options.name);
    const query = params.toString();
    return request<import('./types').GitHubAppManifestResponse>(
      `/api/onboarding/manifest${query ? `?${query}` : ''}`
    );
  },
  
  getGitHubApp: () =>
    request<import('./types').GitHubAppInfo>('/api/onboarding/github-app'),
  
  setupGitHubAppManual: (data: {
    appId: number;
    appName?: string;
    clientId: string;
    clientSecret: string;
    privateKey: string;
    webhookSecret?: string;
  }) =>
    request<{ success: boolean; app: { id: number; slug: string; name: string } }>(
      '/api/onboarding/github-app/manual',
      {
        method: 'POST',
        body: JSON.stringify(data),
      }
    ),
  
  deleteGitHubApp: () =>
    request<void>('/api/onboarding/github-app', { method: 'DELETE' }),
  
  getInstallations: (refresh?: boolean) =>
    request<import('./types').InstallationsResponse>(
      `/api/onboarding/installations${refresh ? '?refresh=true' : ''}`
    ),

  syncCredentials: () =>
    request<import('./types').InstallationsResponse>(
      '/api/onboarding/installations?refresh=true'
    ),
  
  getInstallUrl: () =>
    request<{ installUrl: string; appSlug: string }>('/api/onboarding/install-url'),
  
  getAuthLoginUrl: () =>
    request<{ authUrl: string; state: string }>('/api/onboarding/auth/login'),
  
  getCurrentUser: () =>
    request<{ user: import('./types').AuthUser }>('/api/onboarding/auth/me'),
  
  logout: () =>
    request<{ success: boolean }>('/api/onboarding/auth/logout', { method: 'POST' }),
};

// Health check
export const healthApi = {
  check: () => request<{ status: string; timestamp: string; uptime: number }>('/health'),
};

// Logs API
export const logsApi = {
  list: (params?: { limit?: number; since?: number; level?: string }) => {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.set('limit', params.limit.toString());
    if (params?.since) searchParams.set('since', params.since.toString());
    if (params?.level) searchParams.set('level', params.level);
    const query = searchParams.toString();
    return request<import('./types').LogsResponse>(`/api/logs${query ? `?${query}` : ''}`);
  },

  getRunnerLogs: (id: string, params?: { tail?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.tail) searchParams.set('tail', params.tail.toString());
    const query = searchParams.toString();
    return request<import('./types').RunnerLogsResponse>(`/api/logs/runner/${id}${query ? `?${query}` : ''}`);
  },
};

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

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE}${endpoint}`;
  
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || `HTTP ${response.status}`);
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

// Health check
export const healthApi = {
  check: () => request<{ status: string; timestamp: string; uptime: number }>('/health'),
};

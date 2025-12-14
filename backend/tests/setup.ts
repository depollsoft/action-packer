/**
 * Test setup and utilities
 */

import { vi } from 'vitest';

// Mock environment for tests
process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = 'test';

// Mock GitHub client
vi.mock('../src/services/github.js', () => ({
  createGitHubClient: vi.fn(() => ({
    validateToken: vi.fn().mockResolvedValue({
      valid: true,
      login: 'testuser',
      scopes: ['repo', 'admin:org'],
    }),
    checkAdminAccess: vi.fn().mockResolvedValue({
      hasAccess: true,
    }),
    createRegistrationToken: vi.fn().mockResolvedValue({
      token: 'test-registration-token',
      expires_at: new Date(Date.now() + 3600000).toISOString(),
    }),
    createRemoveToken: vi.fn().mockResolvedValue({
      token: 'test-remove-token',
    }),
    listRunners: vi.fn().mockResolvedValue({
      total_count: 0,
      runners: [],
    }),
    deleteRunner: vi.fn().mockResolvedValue(true),
    setRunnerLabels: vi.fn().mockResolvedValue([]),
    listRepositories: vi.fn().mockResolvedValue({
      total_count: 0,
      repositories: [],
    }),
    listOrganizations: vi.fn().mockResolvedValue([]),
    createWebhook: vi.fn().mockResolvedValue({
      id: 12345,
      active: true,
    }),
    deleteWebhook: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Re-export for tests
export { vi };

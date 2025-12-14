/**
 * Tests for Dashboard component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Dashboard } from './Dashboard';

// Mock the API
vi.mock('../api', () => ({
  runnersApi: {
    list: vi.fn().mockResolvedValue({
      runners: [
        {
          id: '1',
          name: 'test-runner-1',
          status: 'online',
          platform: 'darwin',
          architecture: 'arm64',
          labels: ['self-hosted', 'macOS'],
          credential_name: 'Test PAT',
          target: 'owner/repo',
        },
        {
          id: '2',
          name: 'test-runner-2',
          status: 'busy',
          platform: 'linux',
          architecture: 'x64',
          labels: ['self-hosted', 'Linux'],
          credential_name: 'Test PAT',
          target: 'owner/repo',
        },
      ],
    }),
    getSystemInfo: vi.fn().mockResolvedValue({
      platform: 'darwin',
      architecture: 'arm64',
      dockerAvailable: true,
      supportedIsolationTypes: [
        { type: 'native', available: true, description: 'Native runner' },
        { type: 'docker', available: true, description: 'Docker container' },
      ],
    }),
  },
  poolsApi: {
    list: vi.fn().mockResolvedValue({
      pools: [],
    }),
  },
  credentialsApi: {
    list: vi.fn().mockResolvedValue({
      credentials: [],
    }),
  },
}));

describe('Dashboard', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
  });

  it('renders the dashboard header', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <Dashboard />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Dashboard/i })).toBeInTheDocument();
    });
  });

  it('displays runner statistics', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <Dashboard />
      </QueryClientProvider>
    );

    await waitFor(() => {
      // Check stat cards are rendered
      expect(screen.getByText('Total Runners')).toBeInTheDocument();
    });
  });
});

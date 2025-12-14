/**
 * Tests for CredentialManager component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CredentialManager } from './CredentialManager';

// Mock the API
vi.mock('../api', () => ({
  credentialsApi: {
    list: vi.fn().mockResolvedValue({
      credentials: [
        {
          id: '1',
          name: 'Production PAT',
          type: 'pat',
          scope: 'org',
          target: 'my-org',
          created_at: '2024-01-01T00:00:00Z',
          validated_at: '2024-01-01T00:00:00Z',
        },
        {
          id: '2',
          name: 'Test Repo PAT',
          type: 'pat',
          scope: 'repo',
          target: 'owner/repo',
          created_at: '2024-01-02T00:00:00Z',
          validated_at: null,
        },
      ],
    }),
    create: vi.fn().mockResolvedValue({
      credential: {
        id: '3',
        name: 'New PAT',
        type: 'pat',
        scope: 'repo',
        target: 'new-owner/new-repo',
      },
    }),
    delete: vi.fn().mockResolvedValue(undefined),
    validate: vi.fn().mockResolvedValue({
      valid: true,
      login: 'testuser',
    }),
  },
}));

describe('CredentialManager', () => {
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

  it('renders the credentials header', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <CredentialManager />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Credentials/i })).toBeInTheDocument();
    });
  });

  it('displays the Add Credential button', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <CredentialManager />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Add Credential')).toBeInTheDocument();
    });
  });

  it('displays credentials list', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <CredentialManager />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Production PAT')).toBeInTheDocument();
      expect(screen.getByText('Test Repo PAT')).toBeInTheDocument();
    });
  });

  it('opens add credential modal when button clicked', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <CredentialManager />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Add Credential')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Add Credential'));

    await waitFor(() => {
      expect(screen.getByText('Add GitHub Credential')).toBeInTheDocument();
    });
  });
});

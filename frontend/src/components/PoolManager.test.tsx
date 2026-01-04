/**
 * Tests for PoolManager component (architecture selection)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PoolManager } from './PoolManager';

const { createPoolMock, updatePoolMock, listPoolsMock } = vi.hoisted(() => ({
  createPoolMock: vi.fn().mockResolvedValue({
    pool: { id: 'pool-1' },
  }),
  updatePoolMock: vi.fn().mockResolvedValue({
    pool: { id: 'pool-1' },
  }),
  listPoolsMock: vi.fn().mockResolvedValue({ pools: [] }),
}));

vi.mock('../api', () => ({
  poolsApi: {
    list: () => listPoolsMock(),
    create: (...args: unknown[]) => createPoolMock(...args),
    update: (...args: unknown[]) => updatePoolMock(...args),
    delete: vi.fn(),
    enable: vi.fn(),
    disable: vi.fn(),
  },
  credentialsApi: {
    list: vi.fn().mockResolvedValue({
      credentials: [
        {
          id: 'cred-1',
          name: 'Test PAT',
          type: 'pat',
          scope: 'repo',
          target: 'owner/repo',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
          validated_at: '2024-01-01T00:00:00Z',
        },
      ],
    }),
  },
  runnersApi: {
    getSystemInfo: vi.fn().mockResolvedValue({
      platform: 'darwin',
      architecture: 'arm64',
      dockerAvailable: true,
      defaultIsolation: 'native',
      supportedIsolationTypes: [
        { type: 'native', available: true, description: 'Native runner' },
        { type: 'docker', available: true, description: 'Docker container' },
      ],
    }),
  },
}));

describe('PoolManager (architecture selection)', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
  });

  it('shows architecture selector only for Docker isolation', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <PoolManager />
      </QueryClientProvider>
    );

    const openButton = await screen.findByRole('button', { name: /Create Pool/i });
    await waitFor(() => expect(openButton).not.toBeDisabled());
    fireEvent.click(openButton);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Create Runner Pool' })).toBeInTheDocument();
    });

    expect(screen.queryByText('Architecture')).not.toBeInTheDocument();

    const isolationLabel = screen.getByText('Isolation Type');
    const isolationSelect = isolationLabel.parentElement?.querySelector('select') as HTMLSelectElement;

    fireEvent.change(isolationSelect, { target: { value: 'docker' } });
    expect(screen.getByText('Architecture')).toBeInTheDocument();

    fireEvent.change(isolationSelect, { target: { value: 'native' } });
    expect(screen.queryByText('Architecture')).not.toBeInTheDocument();
  });

  it('shows emulation warning when x64 is selected on an ARM64 host', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <PoolManager />
      </QueryClientProvider>
    );

    const openButton = await screen.findByRole('button', { name: /Create Pool/i });
    await waitFor(() => expect(openButton).not.toBeDisabled());
    fireEvent.click(openButton);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Create Runner Pool' })).toBeInTheDocument();
    });

    const isolationLabel = screen.getByText('Isolation Type');
    const isolationSelect = isolationLabel.parentElement?.querySelector('select') as HTMLSelectElement;
    fireEvent.change(isolationSelect, { target: { value: 'docker' } });

    const archLabel = screen.getByText('Architecture');
    const archSelect = archLabel.parentElement?.querySelector('select') as HTMLSelectElement;

    expect(archSelect.value).toBe('arm64');
    fireEvent.change(archSelect, { target: { value: 'x64' } });

    expect(screen.getByText(/x64 will run under emulation on ARM64/i)).toBeInTheDocument();
  });

  it('passes architecture only when Docker isolation is selected', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <PoolManager />
      </QueryClientProvider>
    );

    const openButton = await screen.findByRole('button', { name: /Create Pool/i });
    await waitFor(() => expect(openButton).not.toBeDisabled());

    // Native: architecture should not be provided
    fireEvent.click(openButton);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Create Runner Pool' })).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText('my-pool'), { target: { value: 'native-pool' } });

    const nativeModal = screen.getByRole('heading', { name: 'Create Runner Pool' }).closest('.card');
    expect(nativeModal).toBeTruthy();
    fireEvent.click(within(nativeModal as HTMLElement).getByRole('button', { name: 'Create Pool' }));

    await waitFor(() => {
      expect(createPoolMock).toHaveBeenCalled();
    });

    expect(createPoolMock).toHaveBeenCalledWith(
      expect.objectContaining({
        isolationType: 'native',
        architecture: undefined,
      }),
      expect.anything()
    );

    // Close modal
    fireEvent.click(within(nativeModal as HTMLElement).getByRole('button', { name: 'Cancel' }));

    // Docker: architecture should be provided
    fireEvent.click(openButton);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Create Runner Pool' })).toBeInTheDocument();
    });

    const isolationLabel = screen.getByText('Isolation Type');
    const isolationSelect = isolationLabel.parentElement?.querySelector('select') as HTMLSelectElement;
    fireEvent.change(isolationSelect, { target: { value: 'docker' } });

    const archLabel = screen.getByText('Architecture');
    const archSelect = archLabel.parentElement?.querySelector('select') as HTMLSelectElement;
    fireEvent.change(archSelect, { target: { value: 'x64' } });

    fireEvent.change(screen.getByPlaceholderText('my-pool'), { target: { value: 'docker-pool' } });

    const dockerModal = screen.getByRole('heading', { name: 'Create Runner Pool' }).closest('.card');
    expect(dockerModal).toBeTruthy();
    fireEvent.click(within(dockerModal as HTMLElement).getByRole('button', { name: 'Create Pool' }));

    await waitFor(() => {
      expect(createPoolMock).toHaveBeenCalledWith(
        expect.objectContaining({
          isolationType: 'docker',
          architecture: 'x64',
        }),
        expect.anything()
      );
    });
  });
});

describe('PoolManager (edit pool)', () => {
  let queryClient: QueryClient;

  const mockPool = {
    id: 'pool-1',
    name: 'Test Pool',
    credential_id: 'cred-1',
    credential_name: 'Test PAT',
    scope: 'repo' as const,
    target: 'owner/repo',
    platform: 'darwin' as const,
    architecture: 'arm64' as const,
    isolation_type: 'native' as const,
    labels: ['self-hosted', 'test'],
    min_runners: 0,
    max_runners: 5,
    warm_runners: 2,
    idle_timeout_minutes: 10,
    enabled: true,
    runner_count: 3,
    online_count: 2,
    busy_count: 1,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    listPoolsMock.mockResolvedValue({ pools: [mockPool] });
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
  });

  it('opens edit modal when clicking edit button', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <PoolManager />
      </QueryClientProvider>
    );

    // Wait for pools to load
    await waitFor(() => {
      expect(screen.getByText('Test Pool')).toBeInTheDocument();
    });

    // Click edit button
    const editButton = screen.getByTitle('Edit pool');
    fireEvent.click(editButton);

    // Check that edit modal opens with pool name in title
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Edit Pool: Test Pool/i })).toBeInTheDocument();
    });
  });

  it('displays current pool values in edit form', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <PoolManager />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Test Pool')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTitle('Edit pool'));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Edit Pool/i })).toBeInTheDocument();
    });

    // Check form values
    const nameInput = screen.getByPlaceholderText('my-pool') as HTMLInputElement;
    expect(nameInput.value).toBe('Test Pool');

    const labelsInput = screen.getByPlaceholderText('self-hosted, linux, x64') as HTMLInputElement;
    expect(labelsInput.value).toBe('self-hosted, test');

    // Check scaling values using input type number
    const numberInputs = screen.getAllByRole('spinbutton');
    expect(numberInputs.length).toBe(4); // min, max, warm, timeout
  });

  it('shows read-only pool info in edit form', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <PoolManager />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Test Pool')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTitle('Edit pool'));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Edit Pool/i })).toBeInTheDocument();
    });

    // Check read-only info is displayed
    expect(screen.getByText(/Test PAT/)).toBeInTheDocument();
    expect(screen.getByText(/native/)).toBeInTheDocument();
  });

  it('submits updated values when saving', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <PoolManager />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Test Pool')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTitle('Edit pool'));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Edit Pool/i })).toBeInTheDocument();
    });

    // Change values
    const nameInput = screen.getByPlaceholderText('my-pool');
    fireEvent.change(nameInput, { target: { value: 'Updated Pool' } });

    const numberInputs = screen.getAllByRole('spinbutton');
    // Change max runners (second input)
    fireEvent.change(numberInputs[1], { target: { value: '10' } });
    // Change warm runners (third input)
    fireEvent.change(numberInputs[2], { target: { value: '3' } });

    // Submit form
    const modal = screen.getByRole('heading', { name: /Edit Pool/i }).closest('.card');
    fireEvent.click(within(modal as HTMLElement).getByRole('button', { name: /Save Changes/i }));

    await waitFor(() => {
      expect(updatePoolMock).toHaveBeenCalledWith(
        'pool-1',
        expect.objectContaining({
          name: 'Updated Pool',
          maxRunners: 10,
          warmRunners: 3,
        })
      );
    });
  });

  it('validates that warm runners cannot exceed max runners', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <PoolManager />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Test Pool')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTitle('Edit pool'));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Edit Pool/i })).toBeInTheDocument();
    });

    // Set warm runners higher than max
    const numberInputs = screen.getAllByRole('spinbutton');
    fireEvent.change(numberInputs[1], { target: { value: '3' } }); // maxRunners = 3
    fireEvent.change(numberInputs[2], { target: { value: '5' } }); // warmRunners = 5

    // Submit form
    const modal = screen.getByRole('heading', { name: /Edit Pool/i }).closest('.card');
    fireEvent.click(within(modal as HTMLElement).getByRole('button', { name: /Save Changes/i }));

    // Check for validation error
    await waitFor(() => {
      expect(screen.getByText(/Warm runners cannot exceed max runners/i)).toBeInTheDocument();
    });

    // Update should not be called
    expect(updatePoolMock).not.toHaveBeenCalled();
  });

  it('closes modal when clicking cancel', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <PoolManager />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Test Pool')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTitle('Edit pool'));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Edit Pool/i })).toBeInTheDocument();
    });

    // Click cancel
    const modal = screen.getByRole('heading', { name: /Edit Pool/i }).closest('.card');
    fireEvent.click(within(modal as HTMLElement).getByRole('button', { name: /Cancel/i }));

    // Modal should close
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: /Edit Pool/i })).not.toBeInTheDocument();
    });
  });
});

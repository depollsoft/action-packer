import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import App from './App';

// Mock the onboarding API
vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    onboardingApi: {
      getStatus: vi.fn().mockResolvedValue({
        isComplete: true,
        steps: {
          githubApp: { complete: true, appName: 'Test App', appSlug: 'test-app' },
          installation: { complete: true, count: 1 },
        },
      }),
      getCurrentUser: vi.fn().mockResolvedValue({
        user: {
          id: 12345,
          login: 'testuser',
          name: 'Test User',
          email: 'test@example.com',
          avatarUrl: 'https://avatars.githubusercontent.com/u/12345',
        },
      }),
      logout: vi.fn().mockResolvedValue({ success: true }),
    },
    onAuthError: vi.fn().mockReturnValue(() => {}),
    ApiError: class ApiError extends Error {
      code: string;
      status: number;
      constructor(message: string, code: string, status: number) {
        super(message);
        this.code = code;
        this.status = status;
      }
      get isAuthError() { return this.status === 401 || this.status === 403; }
      get isNotAuthenticated() { return this.code === 'NOT_AUTHENTICATED' || this.code === 'SESSION_EXPIRED'; }
      get isNotAdmin() { return this.code === 'NOT_ADMIN'; }
    },
  };
});

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the Action Packer app', async () => {
    render(<App />);
    // Wait for loading to finish and show main app (Dashboard appears in nav and in page heading)
    await waitFor(() => {
      expect(screen.getAllByText(/Dashboard/i).length).toBeGreaterThan(0);
    });
  });
  
  it('renders the sidebar navigation when setup is complete', async () => {
    render(<App />);
    // Wait for loading to finish and navigation to appear
    await waitFor(() => {
      const nav = screen.getByRole('navigation');
      expect(nav).toBeInTheDocument();
    });
    // Verify key navigation labels are present
    expect(screen.getAllByText(/Dashboard/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Credentials/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Runners/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Settings/i)).toBeInTheDocument();
  });
});

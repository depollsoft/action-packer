import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { onboardingApi, onAuthError, type ApiError } from '../api';
import type { AuthUser } from '../types';

interface AuthContextType {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  error: string | null;
  checkAuth: () => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

interface AuthProviderProps {
  children: ReactNode;
  setupComplete: boolean;
}

export function AuthProvider({ children, setupComplete }: AuthProviderProps) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const checkAuth = useCallback(async () => {
    // If setup isn't complete, no need to check auth
    if (!setupComplete) {
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      const response = await onboardingApi.getCurrentUser();
      setUser(response.user);
      setError(null);
    } catch (err) {
      setUser(null);
      // Don't set error for auth failures - we'll handle those specially
      if (err instanceof Error && 'code' in err) {
        const apiErr = err as ApiError;
        if (!apiErr.isAuthError) {
          setError(err.message);
        }
      }
    } finally {
      setIsLoading(false);
    }
  }, [setupComplete]);

  const logout = useCallback(async () => {
    try {
      await onboardingApi.logout();
    } catch {
      // Ignore errors on logout
    } finally {
      setUser(null);
    }
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Check auth on mount and when setup status changes
  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  // Listen for auth errors from API calls
  useEffect(() => {
    return onAuthError((err: ApiError) => {
      if (err.isNotAuthenticated) {
        setUser(null);
      } else if (err.isNotAdmin) {
        setError('You do not have permission to access this resource. Only the administrator can manage runners.');
      }
    });
  }, []);

  const value: AuthContextType = {
    user,
    isLoading,
    isAuthenticated: !!user,
    error,
    checkAuth,
    logout,
    clearError,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

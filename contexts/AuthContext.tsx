'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { authService } from '@/services/auth.service';
import { apiClient } from '@/lib/api';
import type { User } from '@/types/api';

interface AuthContextValue {
  currentUser: User | null;
  isAdmin: boolean;
  loading: boolean;
  refreshCurrentUser: () => Promise<void>;
  clearCurrentUser: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  currentUser: null,
  isAdmin: false,
  loading: true,
  refreshCurrentUser: async () => {},
  clearCurrentUser: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchCurrentUser = useCallback(async () => {
    try {
      const user = await authService.getCurrentUser();
      setCurrentUser(user);
      // Set user_role cookie for middleware to read
      document.cookie = `user_role=${user.role}; path=/; SameSite=Strict`;
    } catch {
      setCurrentUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Check in-memory/localStorage token — more reliable than the non-HttpOnly cookie
    const hasToken = typeof window !== 'undefined' && !!apiClient.getToken();

    if (hasToken) {
      fetchCurrentUser();
    } else {
      setLoading(false);
    }
  }, [fetchCurrentUser]);

  const refreshCurrentUser = useCallback(async () => {
    await fetchCurrentUser();
  }, [fetchCurrentUser]);

  const clearCurrentUser = useCallback(() => {
    setCurrentUser(null);
    document.cookie = 'user_role=; path=/; max-age=0; SameSite=Strict';
  }, []);

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        isAdmin: currentUser?.role === 'admin',
        loading,
        refreshCurrentUser,
        clearCurrentUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

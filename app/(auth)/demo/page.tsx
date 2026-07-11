'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiClient } from '@/lib/api';
import type { AuthResponse } from '@/types/api';
import { Logo } from '@/components/ui/logo';
import { getErrorMessage } from '@/lib/utils';

export default function DemoPage() {
  const [error, setError] = useState<string | null>(null);

  const startDemo = async () => {
    setError(null);
    try {
      // Start from a clean slate so any stale session (from a previous login) can't
      // race this bootstrap — clearToken runs synchronously before the provider
      // effects, so AuthProvider won't fire a stale-token /auth/me.
      apiClient.clearToken();
      const res = await apiClient.post<AuthResponse>('/api/v1/auth/demo');
      apiClient.setToken(res.access_token, res.refresh_token ?? undefined);
      window.location.href = '/dashboard';
    } catch (err) {
      setError(getErrorMessage(err, 'Could not start the demo. Please try again.'));
    }
  };

  useEffect(() => {
    startDemo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-white px-6">
      <div className="w-full max-w-sm text-center space-y-7">
        <Logo size={44} className="mx-auto !text-black" />

        {!error ? (
          <>
            <div className="space-y-2">
              <h1 className="text-xl font-semibold" style={{ color: '#0a0a0a', letterSpacing: '-0.02em' }}>
                Preparing your live demo…
              </h1>
              <p className="text-sm" style={{ color: '#6b7280' }}>
                Signing you in — no account needed.
              </p>
            </div>
            <div className="flex justify-center">
              <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-gray-200 border-t-black" />
            </div>
          </>
        ) : (
          <>
            <div className="space-y-2">
              <h1 className="text-xl font-semibold" style={{ color: '#0a0a0a' }}>
                Something went wrong
              </h1>
              <p className="text-sm" style={{ color: '#6b7280' }}>{error}</p>
            </div>
            <button
              onClick={startDemo}
              className="w-full h-10 rounded text-sm font-medium"
              style={{ backgroundColor: '#0a0a0a', color: '#ffffff' }}
            >
              Try again
            </button>
            <p className="text-sm" style={{ color: '#6b7280' }}>
              or{' '}
              <Link href="/login" className="font-medium underline" style={{ color: '#0a0a0a' }}>
                sign in
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}

"use client";

import Link from 'next/link';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { authService } from '@/services/auth.service';
import { ProjectSelector } from '@/components/ProjectSelector';

export function Navbar({ title, description }: { title?: string; description?: string }) {
  const { currentUser } = useAuth();
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-b px-6 py-3">
      <div>
        <h1 className="font-semibold">{title || 'EviStreams'}</h1>
        {description && <p className="text-sm text-gray-500">{description}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <ProjectSelector />
        <span>{currentUser?.full_name || currentUser?.email}</span>
        <button onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}>Change theme</button>
        <Link href="/settings">Account</Link>
        <button onClick={() => authService.logout()}>Sign out</button>
      </div>
    </header>
  );
}

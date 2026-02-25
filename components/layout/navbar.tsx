'use client';

import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import { User, LogOut, Settings, Bell, Sun, Moon } from 'lucide-react';
import { NotificationCenter } from './notification-center';
import { useTheme } from '@/contexts/ThemeContext';
import { cn } from '@/lib/utils';

interface NavbarProps {
  title?: string;
  description?: string;
}

export function Navbar({ title, description }: NavbarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { resolvedTheme, setTheme } = useTheme();

  const [scrolled, setScrolled] = useState(() => typeof window !== 'undefined' ? window.scrollY > 8 : false);
  const [showNotifications, setShowNotifications] = useState(false);

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 8);
    window.addEventListener('scroll', handler, { passive: true });
    return () => window.removeEventListener('scroll', handler);
  }, []);

  const handleLogout = () => {
    sessionStorage.removeItem('auth_token');
    router.push('/login');
  };

  const isDashboardOrProjects = pathname === '/dashboard' || pathname === '/projects';

  return (
    <>
      <nav className={cn(
        "sticky top-0 z-30 transition-[background-color,box-shadow,border-color] duration-200",
        scrolled
          ? "bg-white/80 dark:bg-[#0a0a0a]/90 backdrop-blur-2xl border-b border-gray-200/60 dark:border-[#1f1f1f] shadow-[0_1px_2px_rgba(0,0,0,0.03),0_2px_8px_rgba(0,0,0,0.04)]"
          : "bg-transparent"
      )}>
        <div className={cn("flex items-center px-5 relative", title ? "min-h-[3.25rem] py-2" : "h-12")}>

          {/* Left: page title for non-dashboard pages, or spacer */}
          {!isDashboardOrProjects && title ? (
            <div className="flex flex-col justify-center flex-1 min-w-0">
              <span className="text-sm font-semibold text-gray-900 dark:text-white leading-tight">{title}</span>
              {description && <span className="text-xs text-gray-400 dark:text-gray-500 leading-tight mt-0.5">{description}</span>}
            </div>
          ) : (
            <div className="flex-1" />
          )}

          {/* Center: Dashboard + Projects tabs (only on dashboard/projects pages) */}
          {isDashboardOrProjects && (
            <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-0.5">
              <Link
                href="/dashboard"
                className={cn(
                  "text-sm px-3 py-1.5 rounded-md transition-colors",
                  pathname === '/dashboard'
                    ? "font-semibold text-gray-900 dark:text-white"
                    : "font-medium text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                )}
              >
                Dashboard
              </Link>
              <Link
                href="/projects"
                className={cn(
                  "text-sm px-3 py-1.5 rounded-md transition-colors",
                  pathname === '/projects' || pathname.startsWith('/projects/')
                    ? "font-semibold text-gray-900 dark:text-white"
                    : "font-medium text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                )}
              >
                Projects
              </Link>
            </div>
          )}

          {/* Right side */}
          <div className="flex items-center gap-2 flex-1 justify-end">
            <div className="h-3.5 w-px bg-gray-200/50 dark:bg-[#1a1a1a]/30" />

            <button
              onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
              className="p-1.5 rounded-md hover:bg-gray-100/80 dark:hover:bg-white/5 transition-colors"
              title={resolvedTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {resolvedTheme === 'dark' ? (
                <Sun className="h-4 w-4 text-gray-300" />
              ) : (
                <Moon className="h-4 w-4 text-gray-500" />
              )}
            </button>

            <button
              onClick={() => setShowNotifications(true)}
              className="relative p-1.5 rounded-md hover:bg-gray-100/80 dark:hover:bg-white/5 transition-colors"
            >
              <Bell className="h-4 w-4 text-gray-500 dark:text-[#c0c0c0]" />
            </button>

            <div className="h-3.5 w-px bg-gray-200/50 dark:bg-[#1a1a1a]/30" />

            <div className="relative group">
              <button className="flex items-center justify-center w-8 h-8 rounded-full hover:bg-gray-100/80 dark:hover:bg-white/5 transition-colors">
                <User className="h-4 w-4 text-gray-700 dark:text-[#c0c0c0]" />
              </button>
              <div className="absolute right-0 top-full mt-2 w-48 bg-white rounded-lg border border-gray-200 shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 dark:bg-[#111111] dark:border-[#2a2a2a]">
                <Link href="/settings" className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-t-lg transition-colors dark:text-zinc-300 dark:hover:bg-[#1a1a1a]">
                  <Settings className="h-4 w-4" />
                  Account Settings
                </Link>
                <div className="h-px bg-gray-200 dark:bg-[#1f1f1f]" />
                <button onClick={handleLogout} className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-red-600 hover:bg-red-50 rounded-b-lg transition-colors w-full text-left">
                  <LogOut className="h-4 w-4" />
                  Sign Out
                </button>
              </div>
            </div>
          </div>
        </div>
      </nav>

      <NotificationCenter
        isOpen={showNotifications}
        onClose={() => setShowNotifications(false)}
      />
    </>
  );
}

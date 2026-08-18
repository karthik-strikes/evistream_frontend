'use client';

import { Navbar } from './navbar';
import { Sidebar } from './sidebar';
import { IssueReporter } from '@/components/features/issue-reporter/IssueReporter';

interface DashboardLayoutProps {
  children: React.ReactNode;
  title?: string;
  description?: string;
  action?: React.ReactNode;
  /**
   * Let the page own its own scrolling instead of scrolling `<main>`.
   *
   * Without this, a page that wants full-height panes has no way to measure the
   * navbar, so the consensus review screen hard-coded `calc(100vh - 160px)`
   * twice — a number tied to the current navbar height that produces double
   * scrollbars or dead space the moment any chrome above it changes. With it, the
   * page is just a `flex-1 min-h-0` child.
   *
   * Off by default, so no existing page moves.
   */
  fullHeight?: boolean;
}

export function DashboardLayout({ children, title, description, action, fullHeight = false }: DashboardLayoutProps) {
  return (
    <div className="flex h-screen overflow-hidden bg-white dark:bg-[#050505]">
      {/* Sidebar */}
      <Sidebar />

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        <Navbar title={title} description={description} />
        <main
          className={
            fullHeight
              ? 'flex-1 min-h-0 flex flex-col overflow-hidden px-6 pt-4 pb-6 max-w-full'
              : 'flex-1 overflow-y-auto px-6 pt-4 pb-6 max-w-full'
          }
        >
          {/* Action button row (if provided) */}
          {action && (
            <div className="flex justify-end mb-4">
              {action}
            </div>
          )}

          {/* Page Content */}
          {children}
        </main>
      </div>
      <IssueReporter />
    </div>
  );
}

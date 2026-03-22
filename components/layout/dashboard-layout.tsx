'use client';

import { Navbar } from './navbar';
import { Sidebar } from './sidebar';
import { IssueReporter } from '@/components/features/issue-reporter/IssueReporter';

interface DashboardLayoutProps {
  children: React.ReactNode;
  title?: string;
  description?: string;
  action?: React.ReactNode;
}

export function DashboardLayout({ children, title, description, action }: DashboardLayoutProps) {
  return (
    <div className="flex h-screen overflow-hidden bg-white dark:bg-[#050505]">
      {/* Sidebar */}
      <Sidebar />

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        <Navbar title={title} description={description} />
        <main className="flex-1 overflow-y-auto px-6 pt-4 pb-6 max-w-full">
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

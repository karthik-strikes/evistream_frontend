'use client';

import { Navbar } from './navbar';
import { Sidebar } from './sidebar';

interface DashboardLayoutProps {
  children: React.ReactNode;
  title?: string;
  description?: string;
  action?: React.ReactNode;
}

export function DashboardLayout({ children, title, description, action }: DashboardLayoutProps) {
  return (
    <div className="flex min-h-screen bg-white dark:bg-[#050505]">
      {/* Sidebar */}
      <Sidebar />

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        <Navbar title={title} description={description} />
        <main className="flex-1 px-6 pt-4 pb-6">
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
    </div>
  );
}

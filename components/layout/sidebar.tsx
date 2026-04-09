'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import {
  LayoutDashboard,
  FileText,
  FileCheck,
  PlayCircle,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Edit,
  Settings,
  Loader2,
  Activity,
  MessageSquare,
  PanelLeft,
  PanelLeftClose,
  CheckSquare2,
  Shield,
} from 'lucide-react';
import { Logo } from '@/components/ui/logo';
import { cn } from '@/lib/utils';
import { typography } from '@/lib/typography';
import type { LucideIcon } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useProjectPermissions } from '@/hooks/useProjectPermissions';

interface NavigationItem {
  name: string;
  href: string;
  icon: LucideIcon;
  badge?: string;
  /** Permission required to show this item. Admin/owner always see it. */
  permission?: string;
}

interface NavigationSection {
  title: string;
  items: NavigationItem[];
}

const navigationSections: NavigationSection[] = [
  {
    title: 'Data Management',
    items: [
      { name: 'Documents', href: '/documents', icon: FileText, permission: 'can_view_docs' },
      { name: 'Forms', href: '/forms', icon: FileCheck, permission: 'can_view_docs' },
    ],
  },
  {
    title: 'Extraction',
    items: [
      { name: 'Run Extraction', href: '/extractions', icon: PlayCircle, permission: 'can_view_results' },
      { name: 'Manual Extract', href: '/manual-extraction', icon: Edit, permission: 'can_view_results' },
      { name: 'Consensus', href: '/consensus', icon: CheckSquare2, permission: 'can_adjudicate' },
      { name: 'Results', href: '/results', icon: BarChart3, permission: 'can_view_results' },
    ],
  },
  {
    title: 'Monitoring',
    items: [
      { name: 'Jobs', href: '/jobs', icon: Loader2, permission: 'can_view_results' },
    ],
  },
  {
    title: 'Settings',
    items: [
      { name: 'Settings', href: '/settings', icon: Settings },
    ],
  },
];

const ROLE_BADGE_STYLES: Record<string, { bg: string; text: string }> = {
  admin:   { bg: 'bg-purple-100 dark:bg-purple-400/15', text: 'text-purple-600 dark:text-purple-400' },
  owner:   { bg: 'bg-amber-100 dark:bg-amber-400/15', text: 'text-amber-600 dark:text-amber-400' },
  manager: { bg: 'bg-blue-100 dark:bg-blue-400/15', text: 'text-blue-600 dark:text-blue-400' },
  member:  { bg: 'bg-gray-100 dark:bg-gray-400/15', text: 'text-gray-600 dark:text-gray-400' },
  viewer:  { bg: 'bg-green-100 dark:bg-green-400/15', text: 'text-green-600 dark:text-green-400' },
};

const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin', owner: 'Owner', manager: 'Manager', member: 'Member', viewer: 'Viewer',
};

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(true);
  const { isAdmin } = useAuth();
  const perms = useProjectPermissions();

  // Determine effective role for display
  const effectiveRole = isAdmin ? 'admin' : perms.role || 'member';
  const roleStyle = ROLE_BADGE_STYLES[effectiveRole] || ROLE_BADGE_STYLES.member;

  // Filter nav items based on permissions
  const filteredSections = navigationSections.map(section => ({
    ...section,
    items: section.items.filter(item => {
      if (!item.permission) return true; // No permission required
      if (isAdmin || perms.isOwner) return true; // Admin/owner see everything
      return !!(perms as Record<string, unknown>)[item.permission];
    }),
  })).filter(section => section.items.length > 0);

  // Add admin section
  const allSections = [
    ...filteredSections,
    ...(isAdmin ? [{
      title: 'Administration',
      items: [{ name: 'Admin Panel', href: '/admin', icon: Shield }],
    }] : []),
  ];

  return (
    <div
      className={cn(
        'sticky top-0 flex h-screen flex-col border-r border-gray-200 bg-gray-50 transition-[width] duration-200 flex-shrink-0 overflow-y-auto dark:bg-[#0a0a0a] dark:border-[#1a1a1a]',
        collapsed ? 'w-16' : 'w-56'
      )}
    >
      <div className="flex h-16 items-center justify-between px-3">
        <Link href="/dashboard" className={cn("flex items-center space-x-3", collapsed && "mx-auto")}>
          <Logo size={28} />
          {!collapsed && (
            <div className="flex flex-col">
              <span className="text-base font-bold leading-none dark:text-white">eviStreams</span>
              <span className="text-xs text-gray-500 leading-none mt-0.5 dark:text-[#888888]">Medical AI</span>
            </div>
          )}
        </Link>
        {!collapsed && (
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="flex items-center justify-center rounded-lg p-1.5 transition-colors hover:bg-gray-100 text-gray-600 flex-shrink-0 dark:text-zinc-400 dark:hover:bg-[#1a1a1a]"
            title="Collapse sidebar"
          >
            <PanelLeftClose className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Expand button when collapsed */}
      {collapsed && (
        <div className="px-2 mb-2">
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="w-full flex items-center justify-center rounded-lg p-2 transition-colors hover:bg-gray-100 text-gray-600 dark:text-zinc-400 dark:hover:bg-[#1a1a1a]"
            title="Expand sidebar"
          >
            <PanelLeft className="h-5 w-5" />
          </button>
        </div>
      )}

      {/* Role badge */}
      {!collapsed && (
        <div className="px-3 mb-2">
          <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider', roleStyle.bg, roleStyle.text)}>
            {ROLE_LABELS[effectiveRole] || effectiveRole}
          </span>
        </div>
      )}

      <nav className="flex-1 overflow-y-auto p-2">
        {allSections.map((section, sectionIndex) => (
          <div key={section.title} className={sectionIndex > 0 ? 'mt-6' : ''}>
            {!collapsed && (
              <h3 className={cn(typography.nav.section, 'px-3 mb-2')}>
                {section.title}
              </h3>
            )}
            {collapsed && sectionIndex > 0 && (
              <div className="h-px bg-gray-100 my-2 mx-2 dark:bg-[#2a2a2a]" />
            )}
            <div className="space-y-1">
              {section.items.map((item) => {
                const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
                const Icon = item.icon;
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    className={cn(
                      'flex items-center gap-3 rounded px-3 py-2 transition-colors',
                      isActive ? cn(typography.nav.itemActive, 'bg-gray-100 dark:bg-[#1a1a1a] dark:text-white') : cn(typography.nav.item, 'hover:bg-gray-50 dark:text-zinc-400 dark:hover:bg-[#141414]'),
                      collapsed && 'justify-center'
                    )}
                    title={collapsed ? item.name : undefined}
                  >
                    <Icon className="h-4 w-4 flex-shrink-0" />
                    {!collapsed && (
                      <span className="flex-1">{item.name}</span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

    </div>
  );
}

'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import {
  FileText,
  FileCheck,
  LayoutGrid,
  PlayCircle,
  BarChart3,
  Edit,
  Settings,
  Loader2,
  PanelLeft,
  PanelLeftClose,
  CheckSquare2,
  Shield,
  DollarSign,
} from 'lucide-react';
import { Logo } from '@/components/ui/logo';
import { ForestPlotIcon } from '@/components/ui/forest-plot-icon';
import { cn } from '@/lib/utils';
import { typography } from '@/lib/typography';
import type { LucideIcon } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useProjectPermissions } from '@/hooks/useProjectPermissions';

/** Lucide icons, plus any local SVG component taking the same className prop. */
type NavIcon = LucideIcon | React.ComponentType<{ className?: string }>;

interface NavigationItem {
  name: string;
  href: string;
  icon: NavIcon;
  badge?: string;
  permission?: string;
}

interface NavigationSection {
  title: string;
  items: NavigationItem[];
}

const navigationSections: NavigationSection[] = [
  {
    title: 'Workspace',
    items: [
      { name: 'Projects', href: '/projects', icon: LayoutGrid },
    ],
  },
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
      { name: 'Manual Extract', href: '/manual-extraction', icon: Edit, permission: 'can_run_extractions' },
      { name: 'Risk of Bias', href: '/risk-of-bias', icon: Shield, badge: 'New', permission: 'can_adjudicate' },
      { name: 'Consensus', href: '/consensus', icon: CheckSquare2, permission: 'can_adjudicate' },
      { name: 'Results', href: '/results', icon: BarChart3, permission: 'can_view_results' },
      { name: 'Synthesis', href: '/synthesis', icon: ForestPlotIcon, badge: 'New', permission: 'can_view_results' },
    ],
  },
  {
    title: 'Monitoring',
    items: [
      { name: 'Jobs', href: '/jobs', icon: Loader2, permission: 'can_view_results' },
      { name: 'Usage', href: '/usage', icon: DollarSign },
    ],
  },
  {
    title: 'Settings',
    items: [
      { name: 'Settings', href: '/settings', icon: Settings },
    ],
  },
];

function NavTooltip({ label, side = 'right' }: { label: string; side?: 'right' | 'bottom' }) {
  return (
    <span
      role="tooltip"
      className={cn(
        'pointer-events-none absolute z-50 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs font-medium text-white opacity-0 shadow-md transition-opacity duration-150 delay-300 group-hover:opacity-100 dark:bg-white dark:text-gray-900',
        side === 'right' && 'left-full top-1/2 ml-2 -translate-y-1/2',
        side === 'bottom' && 'left-1/2 top-full mt-1.5 -translate-x-1/2',
      )}
    >
      {label}
    </span>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    const v = window.localStorage.getItem('evistream:sidebar-collapsed');
    return v === null ? true : v === '1';
  });
  const { isAdmin } = useAuth();
  const perms = useProjectPermissions();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('evistream:sidebar-collapsed', collapsed ? '1' : '0');
  }, [collapsed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '\\' || !(e.metaKey || e.ctrlKey)) return;
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (t?.isContentEditable) return;
      e.preventDefault();
      setCollapsed((c) => !c);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const filteredSections = navigationSections.map(section => ({
    ...section,
    items: section.items.filter(item => {
      if (!item.permission) return true;
      if (isAdmin || perms.isOwner) return true;
      return !!(perms as Record<string, unknown>)[item.permission];
    }),
  })).filter(section => section.items.length > 0);

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
        'sticky top-0 flex h-screen flex-col border-r border-gray-200 bg-gray-50 transition-[width] duration-200 ease-out flex-shrink-0 overflow-y-auto overflow-x-hidden dark:bg-[#0a0a0a] dark:border-[#1a1a1a]',
        collapsed ? 'w-16' : 'w-56'
      )}
    >
      {/* Header — unified DOM; brand text + close button fade via opacity + max-width */}
      <div className="flex h-16 items-center px-3 gap-3">
        {/* Logo button: collapsed → opens sidebar; expanded → navigates to /dashboard */}
        <button
          onClick={() => collapsed ? setCollapsed(false) : router.push('/dashboard')}
          aria-label={collapsed ? 'Open sidebar' : 'Go to dashboard'}
          className="group relative flex-shrink-0 w-7 h-7 rounded-md"
        >
          <Logo
            size={28}
            className={cn(
              'absolute inset-0 transition-opacity duration-150',
              collapsed && 'group-hover:opacity-0'
            )}
          />
          {collapsed && (
            <div className="absolute inset-0 flex items-center justify-center transition-opacity duration-150 opacity-0 group-hover:opacity-100">
              <PanelLeft className="h-5 w-5 text-gray-600 dark:text-zinc-400" />
            </div>
          )}
        </button>

        {/* Brand text — link, fades in/out symmetric to width animation */}
        <Link
          href="/dashboard"
          className={cn(
            'flex flex-col min-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 ease-out',
            collapsed
              ? 'opacity-0 max-w-0 pointer-events-none delay-0'
              : 'opacity-100 max-w-[140px] delay-100'
          )}
        >
          <span className="text-base font-bold leading-none dark:text-white">eviStreams</span>
          <span className="text-xs text-gray-500 leading-none mt-0.5 dark:text-[#888888]">Medical AI</span>
        </Link>

        <div className="flex-1" />

        {/* Close button — visible only when expanded */}
        <button
          onClick={() => setCollapsed(true)}
          aria-label="Close sidebar"
          className={cn(
            'flex-shrink-0 flex items-center justify-center rounded-lg overflow-hidden text-gray-600 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-[#1a1a1a] transition-all duration-200 ease-out',
            collapsed
              ? 'opacity-0 max-w-0 p-0 pointer-events-none delay-0'
              : 'opacity-100 max-w-[36px] p-1.5 delay-100'
          )}
        >
          <PanelLeftClose className="h-5 w-5" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto overflow-x-hidden p-2">
        {allSections.map((section, sectionIndex) => (
          <div key={section.title} className={sectionIndex > 0 ? 'mt-6' : ''}>
            <h3
              className={cn(
                typography.nav.section,
                'px-3 overflow-hidden whitespace-nowrap transition-all duration-200 ease-out',
                collapsed
                  ? 'opacity-0 max-h-0 mb-0 delay-0'
                  : 'opacity-100 max-h-6 mb-2 delay-100'
              )}
            >
              {section.title}
            </h3>
            {sectionIndex > 0 && (
              <div
                className={cn(
                  'h-px bg-gray-100 mx-2 overflow-hidden dark:bg-[#2a2a2a] transition-all duration-200 ease-out',
                  collapsed
                    ? 'opacity-100 my-2 max-h-px delay-100'
                    : 'opacity-0 my-0 max-h-0 delay-0'
                )}
              />
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
                      'group relative flex items-center rounded px-3 py-2 transition-colors',
                      isActive
                        ? cn(typography.nav.itemActive, 'bg-gray-100 dark:bg-[#1a1a1a] dark:text-white')
                        : cn(typography.nav.item, 'hover:bg-gray-50 dark:text-zinc-400 dark:hover:bg-[#141414]'),
                      collapsed && 'justify-center'
                    )}
                  >
                    <Icon className="h-4 w-4 flex-shrink-0" />
                    <span
                      className={cn(
                        'truncate overflow-hidden transition-all duration-200 ease-out',
                        collapsed
                          ? 'opacity-0 max-w-0 ml-0 delay-0'
                          : 'opacity-100 max-w-[180px] ml-3 delay-100'
                      )}
                    >
                      {item.name}
                    </span>
                    {/* Badge rides the same fade as the label — a lone pill next
                        to an icon in the collapsed rail reads as an error. */}
                    {item.badge && (
                      <span
                        className={cn(
                          'overflow-hidden whitespace-nowrap rounded-full bg-gray-200 px-1.5 text-[10px] font-semibold leading-4 text-gray-600 transition-all duration-200 ease-out dark:bg-[#2a2a2a] dark:text-zinc-400',
                          collapsed
                            ? 'ml-0 max-w-0 px-0 opacity-0 delay-0'
                            : 'ml-auto max-w-[48px] opacity-100 delay-100',
                        )}
                      >
                        {item.badge}
                      </span>
                    )}
                    {collapsed && <NavTooltip label={item.name} side="right" />}
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

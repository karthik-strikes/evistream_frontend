'use client';

/**
 * Primary navigation rail — rebuilt Sep 26 2026 from
 * `zhandoffs/EviStreams Sidebar.dc.html` (README §1).
 *
 * Projects is the only workspace-level item; the divider below it is the
 * project boundary, and everything under it belongs to the project chosen in
 * the top-bar selector. With no current project the scoped block is replaced
 * by "No project selected · Choose a project →" — never disabled links.
 * Home is not in the rail; it lives in the top bar.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect, useCallback, type FocusEvent, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  FileText,
  FileCheck,
  LayoutGrid,
  PlayCircle,
  BarChart3,
  Edit,
  Settings,
  Loader2,
  PanelLeftClose,
  CheckSquare2,
  Shield,
  DollarSign,
} from 'lucide-react';
import { Logo } from '@/components/ui/logo';
import { ForestPlotIcon } from '@/components/ui/forest-plot-icon';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useProject } from '@/contexts/ProjectContext';
import { useProjectPermissions } from '@/hooks/useProjectPermissions';
import { useNavCounts, type NavCount, type NavCountKey } from '@/hooks/useNavCounts';

/** Lucide icons, plus any local SVG component taking the same className prop. */
type NavIcon = LucideIcon | React.ComponentType<{ className?: string }>;

// Workflow hue for the active bar and the collapsed count dot.
const WF = { docs: '#F0536B', ai: '#4F86F7', forms: '#F5A623', results: '#22B573', rob: '#0a0a0a', neutral: '#6b7280' } as const;
type Wf = keyof typeof WF;

interface NavigationItem {
  name: string;
  /** Static href, or built from the current project id. */
  href: string | ((projectId: string) => string);
  icon: NavIcon;
  wf: Wf;
  /** Single permission, or several — the item shows if the user holds ANY of them. */
  permission?: string | string[];
  countKey?: NavCountKey;
}

interface NavigationSection {
  key: string;
  title: string;
  items: NavigationItem[];
}

const WORKSPACE: NavigationSection = {
  key: 'ws',
  title: 'Workspace',
  items: [{ name: 'Projects', href: '/projects', icon: LayoutGrid, wf: 'neutral' }],
};

const SCOPED: NavigationSection[] = [
  {
    key: 'sources',
    title: 'Sources',
    items: [
      { name: 'Documents', href: '/documents', icon: FileText, wf: 'docs', permission: 'can_view_docs' },
      { name: 'Forms', href: '/forms', icon: FileCheck, wf: 'forms', permission: 'can_view_docs' },
    ],
  },
  {
    key: 'extraction',
    title: 'Extraction',
    items: [
      // A destination, not a command: the run action lives on the page.
      { name: 'AI extraction', href: '/extractions', icon: PlayCircle, wf: 'ai', permission: ['can_run_extractions', 'can_view_results'] },
      { name: 'Manual extraction', href: '/manual-extraction', icon: Edit, wf: 'forms', permission: 'can_run_manual_extractions', countKey: 'extraction' },
      { name: 'Consensus', href: '/consensus', icon: CheckSquare2, wf: 'results', permission: 'can_adjudicate', countKey: 'consensus' },
      { name: 'Results', href: '/results', icon: BarChart3, wf: 'results', permission: 'can_view_results' },
    ],
  },
  {
    key: 'appraisal',
    title: 'Appraisal & synthesis',
    items: [
      // Gated on EITHER permission (an array is OR): editing an assessment
      // needs a reviewer seat, so readers must see the link too.
      { name: 'Risk of bias', href: '/risk-of-bias', icon: Shield, wf: 'rob', permission: ['can_run_manual_extractions', 'can_adjudicate'], countKey: 'rob' },
      { name: 'Synthesis', href: '/synthesis', icon: ForestPlotIcon, wf: 'results', permission: 'can_view_results', countKey: 'synthesis' },
    ],
  },
  {
    key: 'ops',
    title: 'Operations',
    items: [
      { name: 'Usage', href: '/usage', icon: DollarSign, wf: 'neutral' },
      { name: 'Jobs', href: '/jobs', icon: Loader2, wf: 'ai', permission: 'can_view_results' },
    ],
  },
  {
    key: 'project',
    title: 'Project',
    items: [
      { name: 'Project settings', href: (pid) => `/projects/${pid}`, icon: Settings, wf: 'neutral' },
    ],
  },
];

const ROLE_LABEL: Record<string, string> = {
  admin: 'Admin', owner: 'Owner', manager: 'Manager', member: 'Member', viewer: 'Viewer',
};

function initialsOf(name: string): string {
  const parts = name.trim().split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase();
}

/** Tooltip suffix / aria-label state for a count. */
function countSuffix(raw: NavCount): string {
  if (typeof raw === 'number' && raw > 0) return `${raw} open for you`;
  if (raw === 'loading') return 'Counting your open items…';
  if (raw === 'error') return 'Work count unavailable';
  return '';
}

interface Tip { text: string; left: number; top: number }

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    const v = window.localStorage.getItem('evistream:sidebar-collapsed');
    return v === null ? true : v === '1';
  });
  const { isAdmin, currentUser } = useAuth();
  const { selectedProject, projects } = useProject();
  const perms = useProjectPermissions();
  const counts = useNavCounts();
  const [tip, setTip] = useState<Tip | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

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

  // A collapse/expand or navigation moves every item — drop a stale tooltip.
  useEffect(() => setTip(null), [collapsed, pathname]);

  const pid = selectedProject?.id ?? null;

  const allowed = (item: NavigationItem) => {
    if (!item.permission) return true;
    if (isAdmin || perms.isOwner) return true;
    const keys = Array.isArray(item.permission) ? item.permission : [item.permission];
    return keys.some(k => !!(perms as Record<string, unknown>)[k]);
  };

  const scoped: NavigationSection[] = pid
    ? [
        ...SCOPED.map(s => ({ ...s, items: s.items.filter(allowed) })).filter(s => s.items.length > 0),
        ...(isAdmin ? [{ key: 'admin', title: 'Administration', items: [{ name: 'Admin Panel', href: '/admin', icon: Shield, wf: 'neutral' as Wf }] }] : []),
      ]
    : (isAdmin ? [{ key: 'admin', title: 'Administration', items: [{ name: 'Admin Panel', href: '/admin', icon: Shield, wf: 'neutral' as Wf }] }] : []);

  const hrefOf = (item: NavigationItem) => (typeof item.href === 'function' ? item.href(pid ?? '') : item.href);

  const settingsHref = pid ? `/projects/${pid}` : null;
  const isActive = (item: NavigationItem) => {
    const href = hrefOf(item);
    if (item.name === 'Projects') {
      // Inspecting ANOTHER project's settings still belongs to Projects.
      return pathname === '/projects' || (pathname.startsWith('/projects/') && !(settingsHref && (pathname === settingsHref || pathname.startsWith(settingsHref + '/'))));
    }
    return pathname === href || pathname.startsWith(href + '/');
  };

  const showTip = useCallback((e: MouseEvent<HTMLElement> | FocusEvent<HTMLElement>, text: string | null) => {
    if (!text) { setTip(null); return; }
    const r = e.currentTarget.getBoundingClientRect();
    setTip({ text, left: r.right + 10, top: r.top + r.height / 2 });
  }, []);
  const hideTip = useCallback(() => setTip(null), []);

  const renderItem = (item: NavigationItem) => {
    const active = isActive(item);
    const Icon = item.icon;
    const raw: NavCount = item.countKey ? counts[item.countKey] : undefined;
    const count = typeof raw === 'number' && raw > 0 ? raw : 0;
    const suffix = item.countKey ? countSuffix(raw) : '';
    const label = suffix ? `${item.name} · ${suffix}` : item.name;
    // Collapsed: the whole label (with count). Expanded: only the states that
    // have no visible badge (loading / unavailable).
    const tipText = collapsed ? label : (raw === 'loading' || raw === 'error') ? suffix : null;
    const color = item.wf === 'rob' ? undefined : WF[item.wf];
    return (
      <div key={item.name} className="relative">
        <Link
          href={hrefOf(item)}
          aria-current={active ? 'page' : undefined}
          aria-label={label}
          onMouseEnter={e => showTip(e, tipText)}
          onMouseLeave={hideTip}
          onFocus={e => showTip(e, tipText)}
          onBlur={hideTip}
          className={cn(
            'relative flex items-center gap-3 whitespace-nowrap rounded-lg px-3 py-2 text-sm text-[#0a0a0a] transition-colors hover:bg-gray-100 dark:text-zinc-300 dark:hover:bg-[#1a1a1a]',
            active ? 'bg-gray-100 font-medium dark:bg-[#1a1a1a] dark:text-white' : 'font-normal',
            collapsed ? 'justify-center' : 'justify-start',
          )}
        >
          {active && (
            <span aria-hidden
              className={cn('absolute bottom-2 left-0 top-2 w-[3px] rounded-r-[3px]', item.wf === 'rob' && 'bg-[#0a0a0a] dark:bg-zinc-100')}
              style={color ? { background: color } : undefined} />
          )}
          <span className="relative inline-flex shrink-0">
            <Icon className="h-4 w-4 flex-shrink-0" />
            {collapsed && count > 0 && (
              <span aria-hidden
                className={cn('absolute -right-1 -top-[3px] box-content h-[7px] w-[7px] rounded-full border-[1.5px] border-[#f9fafb] dark:border-[#0a0a0a]', item.wf === 'rob' && 'bg-[#0a0a0a] dark:bg-zinc-100')}
                style={color ? { background: color } : undefined} />
            )}
          </span>
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1 overflow-hidden text-ellipsis">{item.name}</span>
              {count > 0 && (
                <span aria-hidden
                  className="rounded-full bg-gray-200 px-1.5 text-[11px] font-semibold leading-[18px] tabular-nums text-gray-700 dark:bg-[#2a2a2a] dark:text-zinc-300">
                  {count}
                </span>
              )}
            </>
          )}
        </Link>
      </div>
    );
  };

  const groupHeader = (title: string) => (collapsed
    ? <div className="mx-2 mb-2 h-px bg-gray-200 dark:bg-[#2a2a2a]" />
    : <h3 className="m-0 mb-1.5 whitespace-nowrap px-3 text-xs font-semibold uppercase tracking-[.05em] text-gray-500 dark:text-zinc-500">{title}</h3>);

  const userName = currentUser?.full_name || currentUser?.email || '';
  const roleLine = pid
    ? (isAdmin ? 'Admin' : ROLE_LABEL[perms.role] ?? 'Member')
    : `Member of ${projects.length} project${projects.length === 1 ? '' : 's'}`;

  return (
    <aside
      aria-label="Sidebar"
      className={cn(
        'sticky top-0 flex h-screen flex-shrink-0 flex-col overflow-hidden border-r border-gray-200 bg-[#f9fafb] transition-[width] duration-200 ease-out dark:border-[#1a1a1a] dark:bg-[#0a0a0a]',
        collapsed ? 'w-16' : 'w-56',
      )}
    >
      {/* Header — the logo is the toggle in both widths; the brand is not a link. */}
      <div className="flex h-16 flex-shrink-0 items-center gap-3 px-3">
        <button
          type="button"
          onClick={() => setCollapsed(c => !c)}
          aria-label="Toggle sidebar (⌘\)"
          title="Toggle sidebar · ⌘\"
          aria-expanded={!collapsed}
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border-0 bg-transparent p-0"
        >
          <Logo size={28} />
        </button>
        {!collapsed && (
          <>
            <span className="flex min-w-0 flex-col whitespace-nowrap text-[#0a0a0a] dark:text-white">
              <span className="text-base font-bold leading-none">eviStreams</span>
              <span className="mt-[3px] text-xs leading-none text-gray-500 dark:text-[#888888]">Medical AI</span>
            </span>
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              aria-label="Close sidebar (⌘\)"
              title="Close sidebar · ⌘\"
              className="flex flex-shrink-0 items-center justify-center rounded-lg border-0 bg-transparent p-1.5 text-gray-600 hover:bg-gray-100 dark:text-zinc-400 dark:hover:bg-[#1a1a1a]"
            >
              <PanelLeftClose className="h-5 w-5" />
            </button>
          </>
        )}
      </div>

      {/* The nav scrolls on its own so the footer stays reachable at 200% zoom. */}
      <nav aria-label="Primary" className="flex min-h-0 flex-auto flex-col gap-4 overflow-y-auto overflow-x-hidden p-2">
        <div className="flex flex-col gap-0.5">
          {groupHeader(WORKSPACE.title)}
          {WORKSPACE.items.map(renderItem)}
        </div>

        {/* Project boundary */}
        <div className="flex flex-col gap-0.5">
          <div className={cn('h-px bg-gray-200 dark:bg-[#2a2a2a]', collapsed ? 'mx-2 mt-1' : 'mx-1 mt-1')} />
          {!pid && !collapsed && (
            <div className="px-3 pb-1 pt-3 text-[13px] leading-[18px] text-gray-500 dark:text-zinc-400">
              No project selected.{' '}
              <Link href="/projects" className="font-medium text-[#0a0a0a] underline underline-offset-2 dark:text-zinc-100">
                Choose a project →
              </Link>
            </div>
          )}
        </div>

        {scoped.map(section => (
          <div key={section.key} className="flex flex-col gap-0.5">
            {groupHeader(section.title)}
            {section.items.map(renderItem)}
          </div>
        ))}
      </nav>

      <div className="mt-auto flex-shrink-0 border-t border-[#eef0f2] p-2 dark:border-[#1a1a1a]">
        {collapsed ? (
          <div className="flex justify-center py-1.5">
            <span title={`${userName} · ${roleLine}`}
              className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-gray-200 text-[10px] font-semibold text-gray-700 dark:bg-[#2a2a2a] dark:text-zinc-300">
              {initialsOf(userName || '?')}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2.5 rounded-lg px-3 py-1.5">
            <span aria-hidden
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-200 text-[10px] font-semibold text-gray-700 dark:bg-[#2a2a2a] dark:text-zinc-300">
              {initialsOf(userName || '?')}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-xs font-medium text-[#0a0a0a] dark:text-zinc-100">{userName}</span>
              <span className="whitespace-nowrap text-[11px] text-gray-500 dark:text-zinc-500">{roleLine}</span>
            </span>
          </div>
        )}
      </div>

      {/* Tooltip via portal + fixed position so the scrolling nav never clips it. */}
      {mounted && tip && createPortal(
        <span role="tooltip"
          style={{ left: tip.left, top: tip.top }}
          className="pointer-events-none fixed z-[100] -translate-y-1/2 whitespace-nowrap rounded-md bg-[#111827] px-2 py-1 text-xs font-medium text-white shadow-[0_4px_12px_rgba(0,0,0,.15)]">
          {tip.text}
        </span>,
        document.body,
      )}
    </aside>
  );
}

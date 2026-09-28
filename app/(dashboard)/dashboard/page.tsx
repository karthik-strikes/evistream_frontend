'use client';

/**
 * Project Home — the home of the selected review project.
 *
 * Rebuilt from design handoff v3.1 (design_handoff_project_home/). Answers, in
 * order: what needs my attention, what can I continue, how far along each form
 * is. Two views (Project overview / My work); every section loads on its own
 * from /dashboard/home/{section}.
 *
 * The project comes ONLY from ProjectContext (the navbar selector). The old
 * page kept its own `viewProject`, so the numbers could describe one project
 * while actions and permissions used another (audit F1).
 */

import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import Link from 'next/link';
import { DashboardLayout } from '@/components/layout';
import { useProject } from '@/contexts/ProjectContext';
import { useAuth } from '@/contexts/AuthContext';
import { useProjectPermissions } from '@/hooks/useProjectPermissions';
import { cn } from '@/lib/utils';
import { useDashboardHome } from './_lib/useDashboardHome';
import { ContextStrip } from './_components/ContextStrip';
import { AttentionList } from './_components/AttentionList';
import { ContinueCard } from './_components/ContinueCard';
import { FormReviewTable } from './_components/FormReviewTable';
import { RobSummary, SynthesisSummary } from './_components/ModuleSummaries';
import { RecentActivity } from './_components/RecentActivity';
import { MyWorkView } from './_components/MyWorkView';
import { QuickActions, type QuickAction } from './_components/QuickActions';
import { relTime } from './_components/ui';

type Tab = 'overview' | 'mywork';
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Project overview' },
  { id: 'mywork', label: 'My work' },
];
const SCOPE_CLIP = 220;

const tabKey = (uid: string, pid: string) => `evistreams:dashboard-tab:${uid}:${pid}`;
function readTab(key: string): Tab | null {
  try { const v = localStorage.getItem(key); return v === 'overview' || v === 'mywork' ? v : null; } catch { return null; }
}
function writeTab(key: string, v: Tab) {
  try { localStorage.setItem(key, v); } catch { /* storage blocked — the choice just isn't remembered */ }
}

export default function DashboardPage() {
  const { selectedProject: project, projects, loading: projectsLoading } = useProject();
  const { currentUser } = useAuth();
  const perms = useProjectPermissions();
  const userId = currentUser?.id ? String(currentUser.id) : undefined;
  const pid = project?.id;
  const home = useDashboardHome(userId, pid);

  const readOnly = !!project?.archived_at;
  const isManager = perms.isOwner || perms.isAdmin || perms.role === 'manager' || perms.role === 'owner';

  // ── Default tab (§2): an explicit stored choice wins; otherwise wait for the
  // personal-work data, then My work if there are active assignments. Resolved
  // once per user+project — background refreshes never switch tabs.
  const [tab, setTab] = useState<Tab | null>(null);
  useEffect(() => { setTab(userId && pid ? readTab(tabKey(userId, pid)) : null); }, [userId, pid]);
  const workSettled = home.work.isSuccess || home.work.isError;
  useEffect(() => {
    if (tab || !workSettled) return;
    const w = home.work.data?.status === 'ready' ? home.work.data.data : null;
    setTab(w?.has_assignments ? 'mywork' : 'overview');
  }, [tab, workSettled, home.work.data]);
  const choose = (t: Tab) => { setTab(t); if (userId && pid) writeTab(tabKey(userId, pid), t); };

  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const order: Tab[] = ['overview', 'mywork'];
    const i = order.indexOf(tab ?? 'overview');
    let next: Tab | null = null;
    if (e.key === 'ArrowRight') next = order[(i + 1) % 2];
    else if (e.key === 'ArrowLeft') next = order[(i + 1) % 2];
    else if (e.key === 'Home') next = 'overview';
    else if (e.key === 'End') next = 'mywork';
    if (next) { e.preventDefault(); choose(next); document.getElementById(`tab-${next}`)?.focus(); }
  };

  // ── Quick actions, capability-filtered.
  const managerItems: QuickAction[] = pid ? [
    perms.can_upload_docs && { label: 'Upload documents', href: '/documents', color: '#F0536B' },
    perms.can_create_forms && { label: 'Create form', href: '/forms', color: '#F5A623' },
    perms.can_run_extractions && { label: 'Run extraction', href: '/extractions', color: '#4F86F7' },
    perms.can_manage_assignments && { label: 'Manage assignments', href: `/projects/${pid}?tab=assignments`, color: '#F5A623' },
    isManager && { label: 'Edit review scope', href: `/projects/${pid}?tab=scope`, color: '#9ca3af' },
  ].filter(Boolean) as QuickAction[] : [];
  const reviewerItems: QuickAction[] = [
    perms.can_run_manual_extractions && { label: 'Open my extraction queue', href: '/manual-extraction', color: '#F5A623' },
    perms.can_adjudicate && { label: 'Open consensus queue', href: '/consensus', color: '#22B573' },
    { label: 'Open RoB assessments', href: '/risk-of-bias?screen=dashboard', color: '#0a0a0a' },
  ].filter(Boolean) as QuickAction[];
  const asManager = managerItems.length > 0;

  // ── Scope line.
  const [scopeOpen, setScopeOpen] = useState(false);
  useEffect(() => setScopeOpen(false), [pid]);
  const scope = (project?.review_scope ?? '').trim();
  const long = scope.length > SCOPE_CLIP;
  const scopeText = !long || scopeOpen ? scope : `${scope.slice(0, SCOPE_CLIP).replace(/\s+\S*$/, '')}…`;

  // ── Freshness line; re-rendered every 30s so "just now" ages.
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick(n => n + 1), 30_000); return () => clearInterval(t); }, []);
  const freshness = home.updatedAt
    ? `Updated ${relTime(new Date(home.updatedAt).toISOString())}${home.polling ? ' · refreshes while runs are active' : ''}`
    : '';

  const canSetUp = isManager && !readOnly;
  const canEditForms = perms.can_create_forms && !readOnly;
  const canManageAssignments = perms.can_manage_assignments && !readOnly;

  const body = useMemo(() => {
    if (!pid) return null;
    if (tab === null) {
      return (
        <div aria-busy="true" className="flex flex-col gap-4">
          <div className="home-pulse h-24 rounded-xl border border-gray-200 bg-[#fafafa] dark:border-[#1f1f1f] dark:bg-[#111111]" />
          <div className="home-pulse h-[220px] rounded-xl border border-gray-200 bg-[#fafafa] dark:border-[#1f1f1f] dark:bg-[#111111]" />
        </div>
      );
    }
    if (tab === 'mywork') {
      return (
        <section role="tabpanel" id="panel-mywork" aria-labelledby="tab-mywork">
          <MyWorkView q={home.work} readOnly={readOnly} onShowOverview={() => choose('overview')} />
        </section>
      );
    }
    return (
      <section role="tabpanel" id="panel-overview" aria-labelledby="tab-overview" className="flex flex-col gap-6">
        <ContextStrip q={home.context} />
        <div className="flex flex-wrap items-stretch gap-4">
          <AttentionList q={home.work} readOnly={readOnly} />
          <ContinueCard q={home.work} readOnly={readOnly} />
        </div>
        <FormReviewTable q={home.forms} projectId={pid} canManageAssignments={canManageAssignments} canEditForms={canEditForms} />
        <div className="flex flex-wrap items-stretch gap-4">
          <RobSummary q={home.rob} canSetUp={canSetUp} />
          <SynthesisSummary q={home.synthesis} canSetUp={canSetUp} readOnly={readOnly} />
        </div>
        <RecentActivity q={home.activity} />
      </section>
    );
  }, [pid, tab, home, readOnly, canSetUp, canEditForms, canManageAssignments]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <DashboardLayout>
      <style>{`
        @keyframes home-pulse { 0%,100% { opacity: 1 } 50% { opacity: .45 } }
        .home-pulse { animation: home-pulse 1.6s ease-in-out infinite; }
        .home-page :focus-visible { outline: 2px solid #0a0a0a; outline-offset: 2px; }
        .dark .home-page :focus-visible { outline-color: #e4e4e7; }
        @media (prefers-reduced-motion: reduce) {
          .home-page *, .home-page *::before, .home-page *::after { animation: none !important; transition: none !important; }
        }
      `}</style>
      <div className="home-page mx-auto flex max-w-[1200px] flex-col gap-6 px-4 pb-10 pt-4 sm:px-6">
        {!pid ? (
          <div className="rounded-xl border border-gray-200 bg-white px-5 py-6 dark:border-[#1f1f1f] dark:bg-[#111111]">
            {projectsLoading ? (
              <div className="home-pulse h-4 w-1/3 rounded bg-gray-100 dark:bg-[#1f1f1f]" />
            ) : (
              <>
                <p className="m-0 text-[15px] font-semibold text-[#0a0a0a] dark:text-zinc-100">
                  {projects.length ? 'Select a project' : 'No projects yet'}
                </p>
                <p className="m-0 mt-1 text-[13px] text-gray-500 dark:text-zinc-400">
                  {projects.length ? 'Choose a project from the selector above to see its home.' : 'Create a project, or ask a project owner to invite you.'}{' '}
                  <Link href="/projects" className="font-medium text-[#0a0a0a] underline underline-offset-2 dark:text-zinc-100">Go to Projects</Link>
                </p>
              </>
            )}
          </div>
        ) : (
          <>
            <header className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 flex-[1_1_360px]">
                <div className="text-[11px] font-semibold uppercase tracking-[.08em] text-gray-500 dark:text-zinc-500">Project home</div>
                <h1 className="m-0 mt-1 text-[24px] font-bold leading-8 tracking-[-.015em] text-[#0a0a0a] dark:text-zinc-100">{project!.name}</h1>
                <p className="m-0 mt-1.5 max-w-[720px] text-[13px] leading-[18px] text-gray-500 [text-wrap:pretty] dark:text-zinc-400">
                  {scope ? (
                    <>
                      {scopeText}{' '}
                      {long && (
                        <button type="button" aria-expanded={scopeOpen} onClick={() => setScopeOpen(o => !o)}
                          className="border-0 bg-transparent p-0 text-[13px] font-medium text-[#0a0a0a] underline underline-offset-2 dark:text-zinc-100">
                          {scopeOpen ? 'Show less' : 'Show full scope'}
                        </button>
                      )}
                    </>
                  ) : (
                    <>
                      Review scope not set.{' '}
                      {isManager && !readOnly && (
                        <Link href={`/projects/${pid}?tab=scope`} className="font-medium text-[#0a0a0a] underline underline-offset-2 dark:text-zinc-100">Set review scope</Link>
                      )}
                    </>
                  )}
                </p>
                {readOnly && (
                  <p className="m-0 mt-2 inline-flex rounded-[6px] border border-[#cbd5e1] bg-[#f8fafc] px-2 py-0.5 text-[11px] font-medium text-[#475569] dark:border-slate-700 dark:bg-slate-800/30 dark:text-slate-300">
                    Archived · read-only
                  </p>
                )}
              </div>
              {!readOnly && (
                <QuickActions heading={asManager ? 'Manager actions' : 'Your queues'} items={asManager ? managerItems : reviewerItems} />
              )}
            </header>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div role="tablist" aria-label="Dashboard view" onKeyDown={onTabKey}
                className="flex w-full overflow-hidden rounded-[7px] border border-gray-200 sm:inline-flex sm:w-auto dark:border-[#2a2a2a]">
                {TABS.map((t, i) => {
                  const on = (tab ?? 'overview') === t.id && tab !== null;
                  return (
                    <button key={t.id} id={`tab-${t.id}`} type="button" role="tab" aria-selected={on}
                      aria-controls={`panel-${t.id}`} tabIndex={on || (tab === null && i === 0) ? 0 : -1}
                      onClick={() => choose(t.id)}
                      className={cn('min-w-0 flex-1 whitespace-nowrap px-3 py-2 text-[13px] font-medium transition-colors duration-150 sm:min-w-[140px] sm:flex-none sm:px-4',
                        i > 0 && 'border-l border-gray-200 dark:border-[#2a2a2a]',
                        on ? 'bg-[#0a0a0a] text-white dark:bg-zinc-100 dark:text-gray-900'
                          : 'bg-white text-gray-700 hover:bg-gray-50 dark:bg-[#111111] dark:text-zinc-300 dark:hover:bg-[#1a1a1a]')}>
                      {t.label}
                    </button>
                  );
                })}
              </div>
              {freshness && <span className="text-[12px] text-gray-400 dark:text-zinc-500">{freshness}</span>}
            </div>

            {body}
          </>
        )}
      </div>
    </DashboardLayout>
  );
}

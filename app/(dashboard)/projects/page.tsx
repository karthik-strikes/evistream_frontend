'use client';

/**
 * Projects — the workspace-level chooser: find, open, create, archive, restore,
 * and see where you have work.
 *
 * Built from `zhandoffs/EviStreams Projects.dc.html` (README §3). One click
 * model: **Open** selects the project and goes to its Home; **Settings /
 * Details** opens `/projects/<id>`. The name is plain text, every action is
 * always visible, and the work line / header counts / sort all come from ONE
 * definition — `work_kind` from `/dashboard/projects-summary`, derived from the
 * same payload Home's My work renders.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Plus, Search } from 'lucide-react';
import { DashboardLayout } from '@/components/layout';
import { useProject } from '@/contexts/ProjectContext';
import { useAuth } from '@/contexts/AuthContext';
import { projectsSummaryService, type ProjectCardSummary, type ProjectWorkKind } from '@/services/dashboard.service';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { ProjectMembersModal } from '@/components/project/ProjectMembersModal';

// ── Tokens (README "Shared tokens") ──────────────────────────────────────────

/** Role pills — navbar.tsx ROLE_BADGE_STYLES. */
const ROLE: Record<string, { label: string; bg: string; fg: string }> = {
  owner: { label: 'Owner', bg: '#fef3c7', fg: '#b45309' },
  manager: { label: 'Manager', bg: '#dbeafe', fg: '#1d4ed8' },
  member: { label: 'Member', bg: '#f3f4f6', fg: '#4b5563' },
  viewer: { label: 'Viewer', bg: '#dcfce7', fg: '#15803d' },
  admin: { label: 'Admin', bg: '#f3f4f6', fg: '#4b5563' },
};

const WF = { docs: '#F0536B', ai: '#4F86F7', forms: '#F5A623', results: '#22B573', rob: '#0a0a0a' } as const;
type Wf = keyof typeof WF;

const inputCls = 'h-[38px] w-full box-border rounded-[7px] border border-[#e5e7eb] bg-white px-3 text-[13px] text-[#0a0a0a] outline-none focus:border-[#0a0a0a] dark:border-[#2a2a2a] dark:bg-[#111111] dark:text-zinc-100 dark:focus:border-zinc-300';
const smallBtn = 'inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-[6px] px-2.5 text-[12px] no-underline';
const menuItem = 'flex w-full items-center gap-2 rounded-[6px] border-0 bg-transparent px-2.5 py-2 text-left text-[13px] text-[#0a0a0a] hover:bg-[#f3f4f6] focus:bg-[#f3f4f6] focus:outline-none dark:text-zinc-100 dark:hover:bg-[#1f1f1f] dark:focus:bg-[#1f1f1f]';

/** "12 min ago" · "3 h ago" · "3 d ago" · "4 mo ago" — the mock's scale. */
function rel(iso: string | null | undefined): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 60 * 24) return `${Math.round(m / 60)} h ago`;
  if (m < 60 * 24 * 30) return `${Math.round(m / 60 / 24)} d ago`;
  if (m < 60 * 24 * 365) return `${Math.round(m / 60 / 24 / 30)} mo ago`;
  return `${Math.round(m / 60 / 24 / 365)} y ago`;
}

const ts = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() || 0 : 0);

// ── Work line ────────────────────────────────────────────────────────────────

interface WorkItem { wf: Wf; text: string }

function workItems(s: ProjectCardSummary, kind: ProjectWorkKind): WorkItem[] {
  if (kind === 'personal') {
    const out: WorkItem[] = [];
    if (s.extraction_count) out.push({ wf: 'forms', text: `${s.extraction_count} extraction` });
    if (s.consensus_count) out.push({ wf: 'results', text: `${s.consensus_count} consensus` });
    if (s.rob_count) out.push({ wf: 'rob', text: `${s.rob_count} risk of bias` });
    if (s.synthesis_approval_count) {
      out.push({ wf: 'results', text: `${s.synthesis_approval_count} synthesis approval${s.synthesis_approval_count === 1 ? '' : 's'}` });
    }
    return out;
  }
  if (kind === 'attention') {
    return s.attention_labels.map(text => ({
      wf: /PDF/i.test(text) ? 'docs'
        : /extraction/i.test(text) ? 'ai'
        : /seat/i.test(text) ? 'results'
        : 'forms',
      text,
    }));
  }
  return [];
}

const WORK_LABEL: Record<ProjectWorkKind, string> = {
  personal: 'Your work', attention: 'Needs your attention', none: 'Status', viewonly: 'Access', archived: 'Status',
};
const WORK_TEXT: Partial<Record<ProjectWorkKind, string>> = {
  none: 'No work assigned to you', viewonly: 'View only · results and syntheses', archived: 'Archived · read-only',
};

function WorkLine({ kind, summary, loading, failed, onRetry }: {
  kind: ProjectWorkKind | null; summary: ProjectCardSummary | undefined;
  loading: boolean; failed: boolean; onRetry: () => void;
}) {
  const box = 'flex min-h-[36px] items-start gap-2.5 rounded-lg bg-[#fafafa] px-2.5 py-2 dark:bg-[#161616]';
  if (loading) {
    return (
      <div className={box}>
        <span aria-label="Loading work summary" className="proj-pulse mt-1 inline-block h-2.5 w-3/5 rounded bg-[#f3f4f6] dark:bg-[#1f1f1f]" />
      </div>
    );
  }
  if (failed || !kind) {
    return (
      <div className={box}>
        <span className="flex-1 text-[12px] leading-5 text-[#6b7280] dark:text-zinc-400">Work summary unavailable</span>
        <button type="button" onClick={onRetry}
          className="inline-flex h-[22px] items-center whitespace-nowrap rounded-[6px] border border-[#e5e7eb] bg-white px-2 text-[11px] font-medium text-[#0a0a0a] hover:bg-[#f9fafb] dark:border-[#2a2a2a] dark:bg-[#111111] dark:text-zinc-100">
          Retry
        </button>
      </div>
    );
  }
  const items = summary ? workItems(summary, kind) : [];
  const dots = items.length
    ? Array.from(new Set(items.map(i => i.wf))).slice(0, 3).map(wf => ({ color: WF[wf], border: WF[wf] }))
    : [{ color: 'transparent', border: '#d1d5db' }];
  const text = items.length ? items.map(i => i.text).join(' · ') : WORK_TEXT[kind] ?? '';
  const labelColor = kind === 'attention' ? 'text-[#c22d47] dark:text-rose-300'
    : kind === 'personal' ? 'text-[#0a0a0a] dark:text-zinc-100' : 'text-[#9ca3af] dark:text-zinc-500';
  return (
    <div className={box}>
      <span aria-hidden className="mt-1.5 inline-flex shrink-0 gap-[3px]">
        {dots.map((d, i) => (
          <span key={i} className="box-border h-2 w-2 rounded-[2px]" style={{ background: d.color, border: `1.5px solid ${d.border}` }} />
        ))}
      </span>
      <span className="min-w-0 flex-1 text-[12px] leading-4 text-[#4b5563] dark:text-zinc-400">
        <span className={cn('block text-[10px] font-semibold uppercase tracking-[.06em]', labelColor)}>{WORK_LABEL[kind]}</span>
        <span className="mt-px block">{text}</span>
      </span>
    </div>
  );
}

// ── Dialog shell (confirm + rename) ──────────────────────────────────────────

function Dialog({ labelledBy, describedBy, onCancel, children }: {
  labelledBy: string; describedBy?: string; onCancel: () => void; children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') { e.preventDefault(); onCancel(); return; }
    if (e.key !== 'Tab') return;
    // Trap focus inside the dialog.
    const els = Array.from(ref.current?.querySelectorAll<HTMLElement>('button, input, textarea, [tabindex]:not([tabindex="-1"])') ?? [])
      .filter(el => !el.hasAttribute('disabled'));
    if (!els.length) return;
    const first = els[0], last = els[els.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[rgba(10,10,10,.35)] p-4" onClick={onCancel}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={labelledBy} aria-describedby={describedBy}
        onClick={e => e.stopPropagation()} onKeyDown={onKey}
        className="flex w-full max-w-[420px] flex-col gap-2.5 rounded-xl border border-[#e5e7eb] bg-white p-5 shadow-[0_20px_60px_rgba(0,0,0,.15)] dark:border-[#2a2a2a] dark:bg-[#141414]">
        {children}
      </div>
    </div>
  );
}

const dialogCancel = 'inline-flex h-9 items-center rounded-[7px] border border-[#e5e7eb] bg-white px-3.5 text-[13px] font-medium text-[#0a0a0a] hover:bg-[#f9fafb] dark:border-[#2a2a2a] dark:bg-[#111111] dark:text-zinc-100';
const dialogOk = 'inline-flex h-9 items-center rounded-[7px] border-0 px-4 text-[13px] font-semibold text-white hover:opacity-85 disabled:opacity-50';

// ── Page ─────────────────────────────────────────────────────────────────────

type Confirm = { type: 'archive' | 'delete'; id: string } | null;

export default function ProjectsPage() {
  const { toast } = useToast();
  const router = useRouter();
  const { currentUser, isAdmin } = useAuth();
  const {
    projects: contextProjects, archivedProjects, selectedProject, setSelectedProject,
    createProject, updateProject, deleteProject, archiveProject, unarchiveProject,
  } = useProject();

  const [tab, setTab] = useState<'active' | 'archived'>('active');
  const [query, setQuery] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createDesc, setCreateDesc] = useState('');
  const [createError, setCreateError] = useState('');
  const [creating, setCreating] = useState(false);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState(false);
  const [rename, setRename] = useState<{ id: string; name: string; description: string } | null>(null);
  const [membersModalProject, setMembersModalProject] = useState<{ id: string; name: string } | null>(null);

  // Mock: gutters and search width shrink when the content column is < 560px.
  const colRef = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = colRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setNarrow(e.contentRect.width < 560));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const userId = currentUser?.id ? String(currentUser.id) : undefined;
  const summary = useQuery({
    queryKey: ['projects-summary', userId ?? null],
    queryFn: () => projectsSummaryService.getAll(),
    enabled: !!userId,
    staleTime: 30_000,
    retry: 1,
  });
  const byId = useMemo(
    () => new Map((summary.data?.projects ?? []).map(p => [p.project_id, p])),
    [summary.data],
  );

  const active = useMemo(() => contextProjects || [], [contextProjects]);
  const archived = useMemo(() => archivedProjects || [], [archivedProjects]);
  const totalNone = active.length === 0 && archived.length === 0;
  const canCreate = true; // any signed-in user may create a project (unchanged)

  // Rename/archive: owner, manager, admin, or the original creator.
  // Delete stays narrower — owners and admins only.
  const canManage = (p: any) =>
    isAdmin || p.user_id === currentUser?.id || p.my_role === 'owner' || p.my_role === 'manager';
  const canDelete = (p: any) =>
    isAdmin || p.user_id === currentUser?.id || p.my_role === 'owner';

  const kindOf = useCallback((p: any): ProjectWorkKind | null => {
    if (p.archived_at) return 'archived';
    const s = byId.get(p.id);
    return s && s.work_status === 'ready' ? s.work_kind : null;
  }, [byId]);

  // ── Sort: your work → needs attention → others, each by recent activity.
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rank = (p: any) => { const k = kindOf(p); return k === 'personal' ? 0 : k === 'attention' ? 1 : 2; };
    const activity = (p: any) => ts(byId.get(p.id)?.activity_at) || ts(p.created_at);
    let l = (tab === 'archived' ? archived : active).slice();
    l.sort((a: any, b: any) => tab === 'archived'
      ? ts(b.archived_at) - ts(a.archived_at)
      : (rank(a) - rank(b)) || (activity(b) - activity(a)));
    if (q) l = l.filter((p: any) => `${p.name} ${p.description ?? ''}`.toLowerCase().includes(q));
    return l;
  }, [tab, active, archived, query, byId, kindOf]);

  // Header counts derive from the same work_kind; while unknown they are
  // omitted, never shown as zero.
  const workKnown = summary.isSuccess;
  const withWork = active.filter((p: any) => kindOf(p) === 'personal').length;
  const withAttention = active.filter((p: any) => kindOf(p) === 'attention').length;
  const summaryLine = totalNone
    ? 'No projects yet. Create one to start a review.'
    : `${active.length} active${archived.length ? ` · ${archived.length} archived` : ''}`
      + (workKnown ? ` · your work in ${withWork}${withAttention ? ` · needs your attention in ${withAttention}` : ''}` : '');

  // ── Menu ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!menuId) return;
    document.querySelector<HTMLElement>(`[data-menu-for="${menuId}"] [role="menuitem"]`)?.focus();
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest('[role="menu"]') && !t.closest('[aria-haspopup="menu"]')) setMenuId(null);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuId]);

  const focusMenuBtn = (id: string) =>
    setTimeout(() => document.querySelector<HTMLElement>(`[data-menu-btn="${id}"]`)?.focus(), 0);

  const onMenuKey = (e: ReactKeyboardEvent<HTMLDivElement>, id: string) => {
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    const i = items.indexOf(document.activeElement as HTMLElement);
    let n: number | null = null;
    if (e.key === 'ArrowDown') n = (i + 1) % items.length;
    else if (e.key === 'ArrowUp') n = (i - 1 + items.length) % items.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = items.length - 1;
    else if (e.key === 'Tab') { setMenuId(null); return; }
    else if (e.key === 'Escape') { e.preventDefault(); setMenuId(null); focusMenuBtn(id); return; }
    if (n === null) return;
    e.preventDefault();
    items[n].focus();
  };

  // ── Tabs ─────────────────────────────────────────────────────────────────
  const pickTab = (t: 'active' | 'archived', focus?: boolean) => {
    setTab(t);
    if (focus) setTimeout(() => document.getElementById(t === 'active' ? 'tab-active' : 'tab-archived')?.focus(), 0);
  };
  // Restoring the last archived project hides the tab — don't strand the view on it.
  useEffect(() => { if (tab === 'archived' && archived.length === 0) setTab('active'); }, [tab, archived.length]);
  const onTabKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key) || archived.length === 0) return;
    e.preventDefault();
    pickTab(e.key === 'Home' ? 'active' : e.key === 'End' ? 'archived' : tab === 'active' ? 'archived' : 'active', true);
  };

  // ── Create ───────────────────────────────────────────────────────────────
  const openCreate = () => {
    setShowCreate(true); setCreateError(''); setTab('active');
    setTimeout(() => document.getElementById('create-name')?.focus(), 0);
  };
  const cancelCreate = () => {
    setShowCreate(false); setCreateName(''); setCreateDesc(''); setCreateError('');
    setTimeout(() => document.getElementById('new-project-btn')?.focus(), 0);
  };
  const submitCreate = async (e?: FormEvent) => {
    e?.preventDefault();
    const name = createName.trim();
    if (!name) { setCreateError('Project name is required.'); return; }
    if ([...active, ...archived].some((p: any) => p.name?.trim().toLowerCase() === name.toLowerCase())) {
      setCreateError('A project with this name already exists.');
      return;
    }
    setCreating(true);
    const previous = selectedProject;
    try {
      await createProject(name, createDesc.trim() || undefined);
      // The mock: success inserts the card at the top and selects nothing.
      // ProjectContext.createProject selects the new project, so put the
      // previous selection back.
      if (previous) setSelectedProject(previous);
      setShowCreate(false); setCreateName(''); setCreateDesc(''); setCreateError(''); setTab('active');
      summary.refetch();
      toast({ title: 'Project created', description: `“${name}” is ready. Open it to add documents and forms.`, variant: 'success' });
    } catch (err: any) {
      setCreateError(err?.message || 'Could not create the project.');
    } finally { setCreating(false); }
  };

  // ── Confirm flows ────────────────────────────────────────────────────────
  const askConfirm = (type: 'archive' | 'delete', id: string) => {
    setMenuId(null);
    setConfirm({ type, id });
    setTimeout(() => document.getElementById('confirm-cancel')?.focus(), 0);
  };
  const cancelConfirm = () => {
    const id = confirm?.id;
    setConfirm(null);
    if (id) focusMenuBtn(id);
  };
  const doConfirm = async () => {
    if (!confirm) return;
    const proj: any = [...active, ...archived].find((p: any) => p.id === confirm.id);
    setBusy(true);
    try {
      // Archive/delete of the current project: ProjectContext clears the
      // selection and its effect picks the first remaining active project.
      if (confirm.type === 'archive') {
        await archiveProject(confirm.id);
        toast({ title: 'Project archived', variant: 'success' });
      } else {
        await deleteProject(confirm.id);
        toast({ title: 'Project deleted', variant: 'success' });
      }
      setConfirm(null);
      summary.refetch();
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message ?? `Could not ${confirm.type} “${proj?.name ?? 'project'}”.`, variant: 'error' });
    } finally { setBusy(false); }
  };
  const restore = async (id: string) => {
    setMenuId(null);
    try {
      await unarchiveProject(id); // restore does not select
      toast({ title: 'Project restored', variant: 'success' });
      summary.refetch();
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message, variant: 'error' });
    }
  };
  const closeRename = () => { const id = rename?.id; setRename(null); if (id) focusMenuBtn(id); };
  const submitRename = async () => {
    if (!rename || !rename.name.trim()) return;
    setBusy(true);
    try {
      await updateProject(rename.id, { name: rename.name.trim(), description: rename.description.trim() || undefined });
      closeRename();
      toast({ title: 'Project renamed', variant: 'success' });
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message, variant: 'error' });
    } finally { setBusy(false); }
  };

  const confirmProj: any = confirm ? [...active, ...archived].find((p: any) => p.id === confirm.id) : null;
  const currentId = selectedProject && !selectedProject.archived_at ? selectedProject.id : null;

  const emptyMessage = list.length ? null
    : query.trim() ? `No projects match “${query}”.`
    : tab === 'active' ? (totalNone ? null : 'No active projects.')
    : 'No archived projects.';
  const showNewTile = tab === 'active' && canCreate && !query.trim();

  return (
    <DashboardLayout>
      <style>{`
        @keyframes proj-pulse { 0%,100% { opacity: 1 } 50% { opacity: .45 } }
        .proj-pulse { animation: proj-pulse 1.6s ease-in-out infinite; }
        .proj-page :focus-visible { outline: 2px solid #0a0a0a; outline-offset: 2px; }
        .dark .proj-page :focus-visible { outline-color: #e4e4e7; }
        @media (prefers-reduced-motion: reduce) {
          .proj-page *, .proj-page *::before, .proj-page *::after { animation: none !important; transition: none !important; }
        }
      `}</style>

      <div ref={colRef} className="proj-page pb-10 pt-4" style={{ paddingLeft: narrow ? 16 : 24, paddingRight: narrow ? 16 : 24 }}>
        <div className="mx-auto flex max-w-[1200px] flex-col gap-6 text-[#0a0a0a] dark:text-zinc-100">

          {/* ── Header ─────────────────────────────────────────────────── */}
          <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
            <div className="min-w-0 flex-[1_1_240px]">
              <div className="text-[11px] font-semibold uppercase tracking-[.08em] text-[#6b7280] dark:text-zinc-500">Workspace</div>
              <h1 className="m-0 mt-1 text-[24px] font-bold leading-8 tracking-[-.015em]">Projects</h1>
              <p className="m-0 mt-1.5 text-[13px] leading-[18px] text-[#6b7280] dark:text-zinc-400">{summaryLine}</p>
            </div>
            <div className="flex flex-none flex-nowrap items-center gap-2">
              <label className="relative block" style={{ width: narrow ? 160 : 240 }}>
                <span className="sr-only">Search projects</span>
                <Search aria-hidden className="pointer-events-none absolute left-[11px] top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#9ca3af]" />
                <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search projects"
                  className={cn(inputCls, 'pl-8 focus:border-[#9ca3af]')} />
              </label>
              {canCreate && (
                <button type="button" id="new-project-btn" onClick={openCreate} aria-expanded={showCreate} aria-controls="create-form"
                  className="inline-flex h-[38px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[7px] border-0 bg-[#0a0a0a] px-4 text-[13px] font-semibold text-white hover:bg-[#1f2937] dark:bg-zinc-100 dark:text-gray-900 dark:hover:bg-white">
                  <Plus aria-hidden className="h-3.5 w-3.5" strokeWidth={2.5} />New project
                </button>
              )}
            </div>
          </header>

          {/* ── Create a project ───────────────────────────────────────── */}
          {showCreate && (
            <form id="create-form" aria-labelledby="create-title" onSubmit={submitCreate}
              onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); cancelCreate(); } }}
              className="overflow-hidden rounded-xl border border-[#e5e7eb] bg-white dark:border-[#1f1f1f] dark:bg-[#111111]">
              <div aria-hidden className="h-[2px]" style={{ background: 'linear-gradient(90deg,#F0536B 0%,#F5A623 50%,#4F86F7 100%)' }} />
              <div className="flex flex-wrap gap-x-8 gap-y-5 px-6 pb-[22px] pt-5">
                <div className="min-w-0 max-w-[320px] flex-[1_1_220px]">
                  <div className="text-[11px] font-semibold uppercase tracking-[.08em] text-[#6b7280] dark:text-zinc-500">New project</div>
                  <h2 id="create-title" className="m-0 mt-1 text-[18px] font-semibold leading-[26px] tracking-[-.01em]">Create a project</h2>
                  <p className="m-0 mt-2 text-[13px] leading-[18px] text-[#6b7280] [text-wrap:pretty] dark:text-zinc-400">
                    A project holds one systematic review: its documents, extraction forms, reviewer allocations, risk-of-bias protocol and syntheses.
                  </p>
                  <ol className="m-0 mt-3 flex list-none flex-col gap-1.5 p-0 text-[12px] leading-4 text-[#6b7280] dark:text-zinc-400">
                    <li className="flex items-start gap-2">
                      <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#0a0a0a] text-[10px] font-semibold text-white dark:bg-zinc-100 dark:text-gray-900">1</span>
                      <span className="block min-w-0 flex-1"><span className="font-medium text-[#0a0a0a] dark:text-zinc-100">Name it</span> — you become the owner</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="box-border inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-[#d1d5db] text-[10px] font-semibold">2</span>
                      <span className="block min-w-0 flex-1">Add members and set the review scope in project settings</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="box-border inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-[#d1d5db] text-[10px] font-semibold">3</span>
                      <span className="block min-w-0 flex-1">Upload documents and create the first extraction form from Home</span>
                    </li>
                  </ol>
                </div>
                <div className="flex min-w-0 flex-[2_1_320px] flex-col gap-3.5">
                  <div>
                    <label htmlFor="create-name" className="mb-1.5 block text-[12px] font-medium text-[#374151] dark:text-zinc-300">
                      Project name <span aria-hidden className="text-[#c22d47]">*</span>
                    </label>
                    <input type="text" id="create-name" value={createName}
                      onChange={e => { setCreateName(e.target.value); setCreateError(''); }}
                      placeholder="e.g. Periodontal therapy and glycaemic control in type 2 diabetes"
                      aria-required="true" aria-invalid={!!createError} aria-describedby={createError ? 'create-error' : 'create-hint'}
                      className={cn(inputCls, createError && 'border-[#f9c4cd]')} />
                    {createError
                      ? <div id="create-error" role="alert" className="mt-1.5 text-[12px] text-[#c22d47]">{createError}</div>
                      : <div id="create-hint" className="mt-1.5 text-[12px] text-[#9ca3af]">Use the review question or a short title your team already uses. Shown in the project selector.</div>}
                  </div>
                  <div>
                    <label htmlFor="create-desc" className="mb-1.5 block text-[12px] font-medium text-[#374151] dark:text-zinc-300">
                      Description <span className="font-normal text-[#9ca3af]">(optional)</span>
                    </label>
                    <textarea id="create-desc" rows={2} value={createDesc} onChange={e => setCreateDesc(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitCreate(); } }}
                      placeholder="Population, intervention and primary outcome in one or two lines"
                      className={cn(inputCls, 'h-auto resize-y px-3 py-[9px] leading-[18px]')} />
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2">
                    <button type="submit" disabled={creating || !createName.trim()}
                      className="inline-flex h-[38px] items-center gap-1.5 whitespace-nowrap rounded-[7px] border-0 bg-[#0a0a0a] px-[18px] text-[13px] font-semibold text-white hover:bg-[#1f2937] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-gray-900">
                      {creating ? 'Creating…' : 'Create project'}
                    </button>
                    <button type="button" onClick={cancelCreate}
                      className="inline-flex h-[38px] items-center rounded-[7px] border border-[#e5e7eb] bg-white px-3.5 text-[13px] font-medium text-[#0a0a0a] hover:bg-[#f9fafb] dark:border-[#2a2a2a] dark:bg-[#111111] dark:text-zinc-100">
                      Cancel
                    </button>
                    <span className="ml-auto text-[12px] text-[#9ca3af]">Enter to create · Esc to cancel</span>
                  </div>
                </div>
              </div>
            </form>
          )}

          {/* ── List controls ──────────────────────────────────────────── */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div role="tablist" aria-label="Project list" onKeyDown={onTabKey}
              className="inline-flex overflow-hidden rounded-[7px] border border-[#e5e7eb] dark:border-[#2a2a2a]">
              <button type="button" role="tab" id="tab-active" aria-controls="panel-projects" aria-selected={tab === 'active'}
                tabIndex={tab === 'active' ? 0 : -1} onClick={() => pickTab('active')}
                className={cn('min-w-[120px] border-0 px-4 py-2 text-[13px] font-medium transition-colors duration-150',
                  tab === 'active' ? 'bg-[#0a0a0a] text-white dark:bg-zinc-100 dark:text-gray-900' : 'bg-white text-[#374151] dark:bg-[#111111] dark:text-zinc-300')}>
                Active · {active.length}
              </button>
              {archived.length > 0 && (
                <button type="button" role="tab" id="tab-archived" aria-controls="panel-projects" aria-selected={tab === 'archived'}
                  tabIndex={tab === 'archived' ? 0 : -1} onClick={() => pickTab('archived')}
                  className={cn('min-w-[120px] border-0 border-l border-[#e5e7eb] px-4 py-2 text-[13px] font-medium transition-colors duration-150 dark:border-[#2a2a2a]',
                    tab === 'archived' ? 'bg-[#0a0a0a] text-white dark:bg-zinc-100 dark:text-gray-900' : 'bg-white text-[#374151] dark:bg-[#111111] dark:text-zinc-300')}>
                  Archived · {archived.length}
                </button>
              )}
            </div>
            <span className="text-[12px] text-[#9ca3af]">
              {tab === 'active' ? 'Your work first, then needs attention, then by recent activity' : 'Most recently archived first'}
            </span>
          </div>

          {/* ── Cards ──────────────────────────────────────────────────── */}
          <div id="panel-projects" role="tabpanel" aria-labelledby={tab === 'active' ? 'tab-active' : 'tab-archived'} className="flex flex-col gap-4">
            {emptyMessage && (
              <div className="px-4 py-12 text-center text-[13px] text-[#6b7280] dark:text-zinc-400">{emptyMessage}</div>
            )}

            <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 320px), 1fr))' }}>
              {list.map((p: any) => {
                const isArchived = !!p.archived_at;
                const isLive = !isArchived;
                const isCurrent = !!currentId && p.id === currentId;
                const s = byId.get(p.id);
                const kind = kindOf(p);
                const role = ROLE[p.my_role] ?? ROLE.member;
                const manage = canManage(p);
                const activity = isArchived
                  ? `Archived ${rel(p.archived_at)}`
                  : `Activity ${rel(s?.activity_at || p.updated_at || p.created_at)}`;
                const workLoading = !isArchived && summary.isLoading;
                const workFailed = !isArchived && (summary.isError || (!!s && s.work_status === 'error') || (summary.isSuccess && !s));

                return (
                  <article key={p.id} aria-labelledby={`name-${p.id}`}
                    className="relative flex flex-col gap-3 rounded-xl border border-[#e5e7eb] bg-white px-[18px] pb-3.5 pt-4 dark:border-[#1f1f1f] dark:bg-[#111111]"
                    style={{ boxShadow: isCurrent ? '0 0 0 1px #0a0a0a' : 'none', opacity: isArchived ? 0.75 : 1 }}>
                    <div className="flex items-start gap-2.5">
                      <span aria-hidden
                        className={cn('inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[13px] font-semibold',
                          isCurrent ? 'bg-[#0a0a0a] text-white dark:bg-zinc-100 dark:text-gray-900' : 'bg-[#f3f4f6] text-[#374151] dark:bg-[#1f1f1f] dark:text-zinc-300')}>
                        {p.name.trim().charAt(0).toUpperCase() || '?'}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 id={`name-${p.id}`} className="m-0 text-[14px] font-semibold leading-5 [text-wrap:pretty]">{p.name}</h2>
                          {isCurrent && (
                            <span className="inline-flex items-center whitespace-nowrap rounded-[6px] border border-[#0a0a0a] bg-[#0a0a0a] px-2 py-px text-[11px] font-medium text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-gray-900">
                              Current
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center rounded-full px-2 py-px text-[10px] font-semibold uppercase tracking-[.06em]"
                            style={{ background: role.bg, color: role.fg }}>
                            {role.label}
                          </span>
                          {summary.isLoading && (
                            <span aria-label="Loading counts" className="proj-pulse inline-block h-2.5 w-[110px] rounded bg-[#f3f4f6] dark:bg-[#1f1f1f]" />
                          )}
                          {!summary.isLoading && s && (
                            <span className="text-[12px] text-[#6b7280] dark:text-zinc-400">
                              {s.documents.total} {s.documents.total === 1 ? 'record' : 'records'} · {s.forms.active} {s.forms.active === 1 ? 'form' : 'forms'}
                            </span>
                          )}
                          {!summary.isLoading && !s && (
                            <span className="text-[12px] text-[#9ca3af]">Counts unavailable</span>
                          )}
                        </div>
                      </div>

                      {manage && (
                        <div className="relative shrink-0">
                          <button type="button" data-menu-btn={p.id} aria-haspopup="menu" aria-expanded={menuId === p.id}
                            aria-label={`Options for ${p.name}`} onClick={() => setMenuId(menuId === p.id ? null : p.id)}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-[6px] border border-transparent bg-transparent text-[#6b7280] hover:border-[#e5e7eb] hover:bg-[#f3f4f6] dark:text-zinc-400 dark:hover:border-[#2a2a2a] dark:hover:bg-[#1a1a1a]">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                              <circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" />
                            </svg>
                          </button>
                          {menuId === p.id && (
                            <div role="menu" data-menu-for={p.id} aria-label="Project options" onKeyDown={e => onMenuKey(e, p.id)}
                              className="absolute right-0 top-8 z-50 flex w-[180px] flex-col rounded-lg border border-[#e5e7eb] bg-white p-1 shadow-[0_12px_40px_rgba(0,0,0,.1)] dark:border-[#2a2a2a] dark:bg-[#141414]">
                              {isArchived && (
                                <button type="button" role="menuitem" className={menuItem} onClick={() => restore(p.id)}>Restore</button>
                              )}
                              {isLive && (
                                <>
                                  <button type="button" role="menuitem" className={menuItem}
                                    onClick={() => { setMenuId(null); setRename({ id: p.id, name: p.name, description: p.description || '' }); setTimeout(() => document.getElementById('rename-name')?.focus(), 0); }}>
                                    Rename
                                  </button>
                                  <button type="button" role="menuitem" className={menuItem}
                                    onClick={() => { setMenuId(null); setMembersModalProject({ id: p.id, name: p.name }); }}>
                                    Members
                                  </button>
                                  <button type="button" role="menuitem" className={menuItem} onClick={() => askConfirm('archive', p.id)}>Archive…</button>
                                </>
                              )}
                              {canDelete(p) && (
                                <>
                                  <div className="my-1 h-px bg-[#f3f4f6] dark:bg-[#1f1f1f]" />
                                  <button type="button" role="menuitem"
                                    className={cn(menuItem, 'text-[#c22d47] hover:bg-[#fef1f3] focus:bg-[#fef1f3] dark:text-rose-300 dark:hover:bg-rose-950/30')}
                                    onClick={() => askConfirm('delete', p.id)}>
                                    Delete…
                                  </button>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {p.description && (
                      <p className="m-0 line-clamp-2 text-[13px] leading-[18px] text-[#4b5563] dark:text-zinc-400">{p.description}</p>
                    )}

                    <WorkLine kind={kind} summary={s} loading={workLoading} failed={workFailed} onRetry={() => summary.refetch()} />

                    <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
                      <span className="whitespace-nowrap text-[12px] text-[#9ca3af]">{activity}</span>
                      <div className="flex gap-1.5">
                        {isLive && (
                          <>
                            <Link href={`/projects/${p.id}`}
                              className={cn(smallBtn, 'border border-[#e5e7eb] bg-white font-medium text-[#0a0a0a] hover:bg-[#f9fafb] dark:border-[#2a2a2a] dark:bg-[#111111] dark:text-zinc-100 dark:hover:bg-[#1a1a1a]')}>
                              {manage ? 'Settings' : 'Details'}
                            </Link>
                            <button type="button"
                              onClick={() => { if (!isCurrent) setSelectedProject(p); router.push('/dashboard'); }}
                              className={cn(smallBtn, 'border-0 font-semibold hover:opacity-85',
                                isCurrent
                                  ? 'bg-[#0a0a0a] text-white dark:bg-zinc-100 dark:text-gray-900'
                                  : 'bg-white text-[#0a0a0a] shadow-[inset_0_0_0_1px_#e5e7eb] dark:bg-[#111111] dark:text-zinc-100 dark:shadow-[inset_0_0_0_1px_#2a2a2a]')}>
                              {isCurrent ? 'Go to Home' : 'Open'} <ArrowRight aria-hidden className="h-3 w-3" />
                            </button>
                          </>
                        )}
                        {isArchived && (
                          <Link href={`/projects/${p.id}`}
                            className={cn(smallBtn, 'border border-[#e5e7eb] bg-white font-medium text-[#0a0a0a] hover:bg-[#f9fafb] dark:border-[#2a2a2a] dark:bg-[#111111] dark:text-zinc-100')}>
                            View details (read-only) →
                          </Link>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}

              {showNewTile && (
                <button type="button" onClick={openCreate}
                  className="flex min-h-[160px] flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-[#d1d5db] bg-transparent text-[13px] font-medium text-[#9ca3af] hover:border-[#9ca3af] hover:bg-[#fafafa] hover:text-[#374151] dark:border-[#2a2a2a] dark:hover:bg-[#141414] dark:hover:text-zinc-200">
                  <Plus aria-hidden className="h-4 w-4" />
                  New project
                </button>
              )}
            </div>
          </div>

          <p className="m-0 max-w-[720px] text-[12px] text-[#9ca3af]">
            Open selects the project everywhere in the app, then goes to its Home. Archived projects are read-only, hidden from the project selector, and never become the current project.
          </p>
        </div>
      </div>

      {/* ── Confirm archive / delete ─────────────────────────────────────── */}
      {confirm && confirmProj && (
        <Dialog labelledBy="confirm-title" describedBy="confirm-desc" onCancel={cancelConfirm}>
          <h2 id="confirm-title" className="m-0 text-[16px] font-semibold">{confirm.type === 'delete' ? 'Delete project' : 'Archive project'}</h2>
          <p id="confirm-desc" className="m-0 text-[13px] leading-[18px] text-[#4b5563] dark:text-zinc-400">
            {confirm.type === 'delete'
              ? `Delete “${confirmProj.name}”? Documents, forms, results and syntheses are removed. This cannot be undone.`
              : `Archive “${confirmProj.name}”? It becomes read-only and is hidden from the project selector. Results stay viewable; you can restore it later.`
                + (confirmProj.id === currentId ? ' It is your current project, so the selector will move to another project.' : '')}
          </p>
          <div className="mt-1.5 flex justify-end gap-2">
            <button type="button" id="confirm-cancel" onClick={cancelConfirm} className={dialogCancel}>Cancel</button>
            <button type="button" onClick={doConfirm} disabled={busy} className={dialogOk}
              style={{ background: confirm.type === 'delete' ? '#c22d47' : '#0a0a0a' }}>
              {confirm.type === 'delete' ? 'Delete' : 'Archive'}
            </button>
          </div>
        </Dialog>
      )}

      {/* ── Rename ───────────────────────────────────────────────────────── */}
      {rename && (
        <Dialog labelledBy="rename-title" onCancel={closeRename}>
          <h2 id="rename-title" className="m-0 text-[16px] font-semibold">Rename project</h2>
          <form onSubmit={e => { e.preventDefault(); submitRename(); }} className="flex flex-col gap-2.5">
            <label htmlFor="rename-name" className="block text-[12px] font-medium text-[#374151] dark:text-zinc-300">Project name</label>
            <input id="rename-name" type="text" value={rename.name} onChange={e => setRename({ ...rename, name: e.target.value })} className={inputCls} />
            <label htmlFor="rename-desc" className="block text-[12px] font-medium text-[#374151] dark:text-zinc-300">
              Description <span className="font-normal text-[#9ca3af]">(optional)</span>
            </label>
            <textarea id="rename-desc" rows={2} value={rename.description} onChange={e => setRename({ ...rename, description: e.target.value })}
              className={cn(inputCls, 'h-auto resize-y px-3 py-[9px] leading-[18px]')} />
            <div className="mt-1.5 flex justify-end gap-2">
              <button type="button" onClick={closeRename} className={dialogCancel}>Cancel</button>
              <button type="submit" disabled={busy || !rename.name.trim()} className={dialogOk} style={{ background: '#0a0a0a' }}>Save</button>
            </div>
          </form>
        </Dialog>
      )}

      <ProjectMembersModal
        projectId={membersModalProject?.id ?? ''}
        projectName={membersModalProject?.name}
        isOpen={!!membersModalProject}
        onClose={() => setMembersModalProject(null)}
      />
    </DashboardLayout>
  );
}

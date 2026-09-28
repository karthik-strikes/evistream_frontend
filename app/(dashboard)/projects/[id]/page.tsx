'use client';

/**
 * Project settings — configure and manage ONE project (`/projects/<id>`).
 *
 * Built from zhandoffs/EviStreams Project Settings.dc.html. Never a second
 * overview: the old hub of Documents / Forms / Extractions count cards (which
 * duplicated Home) and the header icon buttons are gone. Existing section
 * components mount unchanged inside the Assignments / Vocabularies / Usage
 * tabs and behind "Edit scope".
 *
 * Identity (audit F1): this page INSPECTS the project in the URL; the navbar
 * selector keeps naming the SELECTED project. Only "Open project" changes the
 * selection. Capabilities come from the target project's /my-permissions, not
 * from ProjectContext (which describes the selected project).
 */

import { use, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { DashboardLayout } from '@/components/layout';
import { useProject } from '@/contexts/ProjectContext';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { assignmentsService, vocabulariesService } from '@/services';
import { projectMembersService } from '@/services/project-members.service';
import { robService } from '@/services/rob.service';
import { synthesisWorkspaceService } from '@/services/synthesis.service';
import type { AssignmentProgress, ProjectMember } from '@/types/api';
import { ProjectMembersModal } from '@/components/project/ProjectMembersModal';
import { ProjectCostSummary } from '@/components/project/ProjectCostSummary';
import { AssignmentsSection } from '@/components/project/sections/AssignmentsSection';
import { VocabulariesSection } from '@/components/project/sections/VocabulariesSection';
import { settingsCaps } from './_components/capabilities';
import { GeneralTab } from './_components/GeneralTab';
import { ScopeTab } from './_components/ScopeTab';
import { MembersTab, type Responsibilities, type SeatKey } from './_components/MembersTab';
import { ConfirmDialog, SettingsCard, StatePill } from './_components/settingsUi';

type Tab = 'general' | 'scope' | 'members' | 'assignments' | 'vocabularies' | 'usage';
const TAB_IDS: Tab[] = ['general', 'scope', 'members', 'assignments', 'vocabularies', 'usage'];
const TAB_LABEL: Record<Tab, string> = {
  general: 'General', scope: 'Review scope', members: 'Members',
  assignments: 'Assignments', vocabularies: 'Vocabularies', usage: 'Usage & cost',
};
/** Old hub deep links (`?tab=extractions`) land on General rather than 404-ing a tab. */
const LEGACY_TAB: Record<string, Tab> = { extractions: 'general' };

function parseTab(v: string | null): Tab | null {
  if (!v) return null;
  if ((TAB_IDS as string[]).includes(v)) return v as Tab;
  return LEGACY_TAB[v] ?? null;
}

export default function ProjectSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const { currentUser, isAdmin } = useAuth();
  const {
    projects, allProjects, selectedProject, setSelectedProject,
    updateProject, deleteProject, archiveProject, unarchiveProject, refreshProjects,
  } = useProject();

  // allProjects so an ARCHIVED project still resolves.
  const proj = allProjects.find(p => p.id === id) ?? null;
  const archived = !!proj?.archived_at;
  const isCurrent = !archived && selectedProject?.id === id;
  const userId = currentUser?.id ? String(currentUser.id) : undefined;

  // ── Capabilities for THIS project ──────────────────────────────────────────
  const permsQ = useQuery({
    queryKey: ['project-settings', 'perms', id, userId ?? null],
    queryFn: () => projectMembersService.getMyPermissions(id),
    enabled: !!proj && !!userId,
    staleTime: 30_000,
    retry: 1,
  });
  const caps = useMemo(
    () => (proj ? settingsCaps(proj, permsQ.data ?? null, { userId, globalAdmin: isAdmin }) : null),
    [proj, permsQ.data, userId, isAdmin],
  );

  // ── Data ───────────────────────────────────────────────────────────────────
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [membersState, setMembersState] = useState<'loading' | 'ready' | 'error'>('loading');
  const loadMembers = useCallback(() => {
    setMembersState('loading');
    projectMembersService.listMembers(id)
      .then(m => { setMembers(m); setMembersState('ready'); })
      .catch(() => setMembersState('error'));
  }, [id]);
  useEffect(() => { if (proj) loadMembers(); }, [id, !!proj]); // eslint-disable-line react-hooks/exhaustive-deps

  const [progress, setProgress] = useState<AssignmentProgress | null>(null);
  useEffect(() => { assignmentsService.getProgress(id).then(setProgress).catch(() => setProgress(null)); }, [id]);

  const [vocabularies, setVocabularies] = useState<any[]>([]);
  const [vocabLoaded, setVocabLoaded] = useState(false);
  useEffect(() => {
    setVocabLoaded(false);
    vocabulariesService.list(id).then(v => { setVocabularies(v); setVocabLoaded(true); }).catch(() => setVocabLoaded(false));
  }, [id]);

  // Extraction seats (manager-only endpoint) + RoB seats + synthesis approver.
  const canReadSeats = !!caps?.canManageAssignments;
  const assignQ = useQuery({
    queryKey: ['project-settings', 'assignments', id],
    queryFn: () => assignmentsService.getProjectAssignments(id),
    enabled: !!proj && canReadSeats && permsQ.isSuccess,
    staleTime: 30_000,
    retry: 1,
  });
  const robQ = useQuery({
    queryKey: ['project-settings', 'rob-protocol', id],
    queryFn: () => robService.getProtocol(id),
    enabled: !!proj,
    staleTime: 60_000,
    retry: 0,
  });
  const synQ = useQuery({
    queryKey: ['project-settings', 'syn-protocol', id],
    queryFn: () => synthesisWorkspaceService.getProtocol(id),
    enabled: !!proj,
    staleTime: 60_000,
    retry: 0,
  });

  const settled = (q: { isLoading: boolean; fetchStatus: string }) => !q.isLoading || q.fetchStatus === 'idle';
  const responsibilities: Responsibilities | null = useMemo(() => {
    if (membersState !== 'ready' || !permsQ.isSuccess) return null;
    if (!settled(robQ) || !settled(synQ) || (canReadSeats && !settled(assignQ))) return null;
    const map: Responsibilities = new Map();
    const add = (uid: string | null | undefined, s: SeatKey) => {
      if (!uid) return;
      if (!map.has(uid)) map.set(uid, new Set());
      map.get(uid)!.add(s);
    };
    for (const a of assignQ.data ?? []) {
      if (a.status === 'skipped') continue;
      add(a.reviewer_user_id, a.reviewer_role === 'reviewer_1' ? 'R1' : a.reviewer_role === 'reviewer_2' ? 'R2' : 'CR');
    }
    // Only a STORED protocol names seats; the default one has none.
    for (const uid of Object.values(robQ.data?.reviewers ?? {})) add(uid as string | null, 'RoB');
    add(synQ.data?.roles?.approver ?? null, 'AP');
    return map;
  }, [membersState, permsQ.isSuccess, robQ.data, robQ.isLoading, robQ.fetchStatus, synQ.data, synQ.isLoading, synQ.fetchStatus,
      assignQ.data, assignQ.isLoading, assignQ.fetchStatus, canReadSeats]); // eslint-disable-line react-hooks/exhaustive-deps

  const assignedPapers = assignQ.data ? new Set(assignQ.data.map(a => a.document_id)).size : null;

  // ── Tabs (URL is authoritative) ────────────────────────────────────────────
  const visibleTabs: Tab[] = useMemo(() => !caps ? ['general', 'scope'] : TAB_IDS.filter(t =>
    t === 'general' || t === 'scope'
    || (t === 'members' && caps.canViewMembers)
    || (t === 'assignments' && caps.canViewAssignments)
    || (t === 'vocabularies' && caps.canViewVocab)
    || (t === 'usage' && caps.canViewUsage)), [caps]);
  const requested = parseTab(searchParams.get('tab'));
  // Until capabilities load, keep a requested tab rather than bouncing to General.
  const tab: Tab = requested && (visibleTabs.includes(requested) || !permsQ.isSuccess) ? requested : 'general';

  const pickTab = (t: Tab, focus?: boolean) => {
    const qs = new URLSearchParams(searchParams.toString());
    qs.set('tab', t);
    router.replace(`${pathname}?${qs}`, { scroll: false });
    if (focus) setTimeout(() => document.getElementById(`tab-${t}`)?.focus(), 0);
  };
  const onTabKey = (e: KeyboardEvent<HTMLElement>) => {
    const keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const i = visibleTabs.indexOf(tab);
    const n = e.key === 'Home' ? 0 : e.key === 'End' ? visibleTabs.length - 1
      : (e.key === 'ArrowUp' || e.key === 'ArrowLeft') ? (i - 1 + visibleTabs.length) % visibleTabs.length
      : (i + 1) % visibleTabs.length;
    pickTab(visibleTabs[n], true);
  };

  // Content-width breakpoint (760px), not viewport: the sidebar changes it.
  const bodyRef = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(en => setNarrow(en[0].contentRect.width < 760));
    ro.observe(el);
    return () => ro.disconnect();
  }, [proj?.id]);

  const meta: Partial<Record<Tab, string | null>> = {
    scope: proj ? (proj.review_scope?.trim() ? '✓' : 'Not set') : null,
    members: membersState === 'ready' ? String(members.length) : null,
    assignments: assignedPapers !== null ? `${assignedPapers} paper${assignedPapers === 1 ? '' : 's'}` : null,
    vocabularies: vocabLoaded ? String(vocabularies.length) : null,
  };

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  const [notice, setNotice] = useState('');
  const [confirm, setConfirm] = useState<'archive' | 'delete' | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const movedSelection = useRef(false);
  const [showInvite, setShowInvite] = useState(false);

  // Archiving the current project moves the selection (ProjectContext picks the
  // next active project); say where it went.
  useEffect(() => {
    if (!movedSelection.current) return;
    if (selectedProject && selectedProject.id !== id) {
      movedSelection.current = false;
      setNotice(`This project was your current project. Your current project is now “${selectedProject.name}”.`);
    } else if (!selectedProject && projects.length === 0) {
      movedSelection.current = false;
      setNotice('This project was your current project. You have no other active project.');
    }
  }, [selectedProject, projects.length, id]);

  const ask = (kind: 'archive' | 'delete') => {
    opener.current = document.activeElement as HTMLElement | null;
    setTyped('');
    setConfirm(kind);
  };
  const cancelConfirm = useCallback(() => {
    setConfirm(null);
    setTyped('');
    setTimeout(() => opener.current?.focus(), 0);
  }, []);

  const doConfirm = async () => {
    if (!proj || !confirm) return;
    setBusy(true);
    try {
      if (confirm === 'archive') {
        const wasCurrent = isCurrent;
        await archiveProject(proj.id);
        setConfirm(null);
        if (wasCurrent) movedSelection.current = true;
        else setNotice('');
        toast({ title: 'Project archived', variant: 'success' });
      } else {
        await deleteProject(proj.id);
        setConfirm(null);
        toast({ title: 'Project deleted', variant: 'success' });
        router.push('/projects');
      }
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message || 'That change failed', variant: 'error' });
    } finally { setBusy(false); }
  };

  const restore = async () => {
    if (!proj) return;
    try {
      await unarchiveProject(proj.id);
      // Restore changes lifecycle only; it never selects the project.
      setNotice('Project restored. It is not your current project — use Open project to switch to it.');
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message || 'Failed to restore project', variant: 'error' });
    }
  };

  const openProject = () => {
    if (!proj) return;
    if (!isCurrent) setSelectedProject(proj);
    router.push('/dashboard');
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  const breadcrumb = (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-[12px] text-gray-500 dark:text-zinc-400">
      <Link href="/projects" className="whitespace-nowrap font-medium text-gray-500 no-underline hover:text-[#0a0a0a] dark:text-zinc-400 dark:hover:text-zinc-100">Projects</Link>
      <span aria-hidden>/</span>
      <span className="whitespace-nowrap font-medium text-[#0a0a0a] dark:text-zinc-100">Project settings</span>
    </nav>
  );

  if (!proj || !caps) {
    return (
      <DashboardLayout>
        <div className="mx-auto flex max-w-[1200px] flex-col gap-6 px-4 pb-10 pt-4 sm:px-6">
          {breadcrumb}
          <div className="rounded-xl border border-gray-200 bg-white px-5 py-8 text-center text-[13px] text-gray-500 dark:border-[#1f1f1f] dark:bg-[#111111] dark:text-zinc-400">
            {allProjects.length === 0 ? 'Loading project…' : 'Project not found, or you do not have access to it.'}
          </div>
        </div>
      </DashboardLayout>
    );
  }

  const existingSub: Partial<Record<Tab, string>> = {
    assignments: assignedPapers !== null
      ? `${assignedPapers} paper${assignedPapers === 1 ? '' : 's'} with extraction allocations · reviewer seats are assigned per paper`
      : 'Reviewer seats are assigned per paper',
    vocabularies: vocabLoaded
      ? `${vocabularies.length} controlled vocabular${vocabularies.length === 1 ? 'y' : 'ies'} used by form fields`
      : 'Controlled vocabularies used by form fields',
    usage: 'AI extraction spend for this project',
  };

  return (
    <DashboardLayout>
      <style>{`
        @keyframes settings-pulse { 0%,100% { opacity: 1 } 50% { opacity: .45 } }
        .settings-pulse { animation: settings-pulse 1.6s ease-in-out infinite; }
        .settings-page :focus-visible { outline: 2px solid #0a0a0a; outline-offset: 2px; }
        .dark .settings-page :focus-visible { outline-color: #e4e4e7; }
        @media (prefers-reduced-motion: reduce) {
          .settings-page *, .settings-page *::before, .settings-page *::after { animation: none !important; transition: none !important; }
        }
      `}</style>
      <div className="settings-page mx-auto flex max-w-[1200px] flex-col gap-6 px-4 pb-10 pt-4 sm:px-6">

        <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="min-w-0 flex-[1_1_320px]">
            {breadcrumb}
            <div className="mt-1.5 flex flex-wrap items-center gap-2.5">
              <h1 className="m-0 text-[24px] font-bold leading-8 tracking-[-.015em] text-[#0a0a0a] dark:text-zinc-100">{proj.name}</h1>
              {isCurrent && <StatePill kind="current" />}
              {!archived && !isCurrent && <StatePill kind="not_current" />}
              {archived && <StatePill kind="archived" />}
            </div>
            <p className="m-0 mt-1.5 max-w-[720px] text-[13px] leading-[18px] text-gray-500 [text-wrap:pretty] dark:text-zinc-400">
              {proj.description || 'No description.'}
            </p>
          </div>
          <div className="flex flex-none items-center gap-2">
            {archived ? (
              <span className="max-w-[260px] text-right text-[12px] text-gray-400 dark:text-zinc-500">
                Archived projects are inspected here. Module pages open only for the current project.
              </span>
            ) : (
              <button type="button" onClick={openProject}
                className="inline-flex h-[38px] items-center gap-1.5 whitespace-nowrap rounded-[7px] border-0 bg-[#0a0a0a] px-4 text-[13px] font-semibold text-white hover:bg-[#1f2937] dark:bg-zinc-100 dark:text-gray-900 dark:hover:bg-white">
                {isCurrent ? 'Go to Home' : 'Open project'} <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </header>

        {notice && (
          <div role="status" className="flex items-start gap-2.5 rounded-[10px] border border-[#cbd5e1] bg-[#f8fafc] px-3.5 py-2.5 text-[12.5px] leading-[18px] text-[#475569] dark:border-slate-700 dark:bg-slate-800/20 dark:text-slate-300">
            {notice}
          </div>
        )}

        <div ref={bodyRef} className={cn('flex items-start gap-6', narrow ? 'flex-col' : 'flex-row')}>
          <nav aria-label="Settings sections" role="tablist" aria-orientation={narrow ? 'horizontal' : 'vertical'} onKeyDown={onTabKey}
            className={cn('flex shrink-0 gap-0.5',
              narrow ? 'w-full flex-row flex-wrap border-b border-gray-100 pb-2 dark:border-[#1f1f1f]' : 'w-[200px] flex-col')}>
            {visibleTabs.map(t => {
              const on = tab === t;
              const m = meta[t];
              return (
                <button key={t} id={`tab-${t}`} type="button" role="tab" aria-selected={on} aria-controls="settings-panel"
                  tabIndex={on ? 0 : -1} onClick={() => pickTab(t)}
                  className={cn('flex items-center gap-2.5 whitespace-nowrap rounded-lg border-0 px-3 py-2 text-left text-[13px] text-[#0a0a0a] hover:bg-gray-100 dark:text-zinc-100 dark:hover:bg-[#1a1a1a]',
                    on ? 'bg-gray-100 font-semibold dark:bg-[#1a1a1a]' : 'bg-transparent font-normal')}>
                  <span className="flex-1">{TAB_LABEL[t]}</span>
                  {m && !narrow && <span className="text-[11px] font-medium tabular-nums text-gray-400 dark:text-zinc-500">{m}</span>}
                </button>
              );
            })}
          </nav>

          <div id="settings-panel" role="tabpanel" aria-labelledby={`tab-${tab}`} className="flex min-w-0 flex-1 flex-col gap-4 self-stretch">
            {tab === 'general' && (
              <GeneralTab
                project={proj}
                caps={caps}
                myRole={permsQ.data?.role ?? proj.my_role ?? null}
                members={members}
                membersLoaded={membersState === 'ready'}
                onSave={async (name, description) => { await updateProject(proj.id, { name, description: description || undefined }); }}
                onGoMembers={() => pickTab('members', true)}
                onArchive={() => ask('archive')}
                onRestore={restore}
                onDelete={() => ask('delete')}
              />
            )}

            {tab === 'scope' && (
              <ScopeTab project={proj} canEdit={caps.canEditScope} onScopeChange={() => { refreshProjects(); }} />
            )}

            {tab === 'members' && (
              <MembersTab
                projectId={id}
                members={members}
                loaded={membersState === 'ready'}
                loadFailed={membersState === 'error'}
                onRetry={loadMembers}
                onMembersChange={setMembers}
                canManage={caps.canManageMembers}
                canTransfer={caps.canTransferOwnership}
                responsibilities={responsibilities}
                responsibilitiesPartial={!canReadSeats}
                onInvite={() => setShowInvite(true)}
                onGoAssignments={() => pickTab('assignments', true)}
                onOwnerTransferred={() => { refreshProjects(); permsQ.refetch(); }}
              />
            )}

            {tab === 'assignments' && (
              <SettingsCard id="e1" title="Assignments" sub={existingSub.assignments}>
                <div className="p-4">
                  <AssignmentsSection projectId={id} progress={progress} onProgressChange={setProgress} />
                </div>
              </SettingsCard>
            )}

            {tab === 'vocabularies' && (
              <SettingsCard id="e1" title="Vocabularies" sub={existingSub.vocabularies}>
                <div className="p-4">
                  <VocabulariesSection projectId={id} vocabularies={vocabularies} onVocabulariesChange={setVocabularies} />
                </div>
              </SettingsCard>
            )}

            {tab === 'usage' && (
              <SettingsCard id="e1" title="Usage & cost" sub={existingSub.usage}>
                <div className="p-4">
                  <ProjectCostSummary projectId={id} />
                </div>
              </SettingsCard>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={!!confirm}
        title={confirm === 'delete' ? 'Delete project' : 'Archive project'}
        description={confirm === 'delete'
          ? `Delete “${proj.name}”? Documents, forms, results and syntheses are removed for all ${membersState === 'ready' ? `${members.length} ` : ''}members. This cannot be undone.`
          : `Archive “${proj.name}”? It becomes read-only for all members and is hidden from the project selector. Results stay viewable; you can restore it later.${isCurrent ? ' It is your current project, so your selection will move to another active project.' : ''}`}
        confirmLabel={confirm === 'delete' ? 'Delete project' : 'Archive'}
        danger={confirm === 'delete'}
        typeToConfirm={confirm === 'delete' ? proj.name : undefined}
        busy={busy}
        typed={typed}
        onTyped={setTyped}
        onCancel={cancelConfirm}
        onConfirm={doConfirm}
      />

      <ProjectMembersModal
        projectId={id}
        projectName={proj.name}
        isOpen={showInvite}
        onClose={() => { setShowInvite(false); loadMembers(); }}
      />
    </DashboardLayout>
  );
}

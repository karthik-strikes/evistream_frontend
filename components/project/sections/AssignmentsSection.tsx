'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

import {
  Users, UserPlus, Loader2, AlertTriangle, Search, ChevronsLeft, ChevronsRight,
  Plus, Minus, X, Scale, LayoutGrid,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { assignmentsService, formsService, projectMembersService, documentsService } from '@/services';
import type { AssignmentProgress, ProjectMember, Form, Document } from '@/types/api';
import { useToast } from '@/hooks/use-toast';
import { Avatar } from '@/components/ui/avatar';
import { AllocationsView } from './AllocationsView';
import { PermissionGate } from '@/components/ui/permission-gate';
import { useProjectPermissions } from '@/hooks/useProjectPermissions';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AssignmentsSectionProps {
  projectId: string;
  progress: AssignmentProgress | null;
  onProgressChange: (p: AssignmentProgress | null) => void;
}

type RoleKey = 'r1' | 'r2' | 'adj';
type ReviewerRoleValue = 'reviewer_1' | 'reviewer_2' | 'adjudicator';
type SplitEntry = { userId: string; share: number };
type SplitState = Record<RoleKey, SplitEntry[]>;

// ─── Constants ────────────────────────────────────────────────────────────────

const ROLE_DEFS: { key: RoleKey; tag: string; name: string; desc: string; api: ReviewerRoleValue }[] = [
  { key: 'r1',  tag: 'R1',  name: 'Reviewer 1',  desc: 'First independent extraction. Blind to R2.',   api: 'reviewer_1'  },
  { key: 'r2',  tag: 'R2',  name: 'Reviewer 2',  desc: 'Second independent extraction. Blind to R1.', api: 'reviewer_2'  },
  { key: 'adj', tag: 'Cons', name: 'Consensus reviewer', desc: 'Resolves R1 vs R2 disagreements.',     api: 'adjudicator' },
];

// Soft-tinted pills — colored text on 15% bg, matches MembersSection's ROLE_BADGE.
const ROLE_PILL: Record<RoleKey, string> = {
  r1:  'text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-400/15',
  r2:  'text-violet-600 dark:text-violet-400 bg-violet-100 dark:bg-violet-400/15',
  adj: 'text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-400/15',
};

// Tiny color dot (next to share row) — solid but small
const ROLE_DOT: Record<RoleKey, string> = {
  r1: 'bg-blue-500', r2: 'bg-violet-500', adj: 'bg-amber-500',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function displayName(m: ProjectMember): string {
  return m.full_name || m.email || 'Unknown';
}

function balanceEntries(list: SplitEntry[], total: number): SplitEntry[] {
  if (!list.length) return list;
  const per = Math.floor(total / list.length);
  const rem = total - per * list.length;
  return list.map((e, i) => ({ ...e, share: per + (i < rem ? 1 : 0) }));
}

function buildBulkPayload(
  role: ReviewerRoleValue,
  entries: SplitEntry[],
  docIds: string[],
): { document_id: string; reviewer_user_id: string; reviewer_role: ReviewerRoleValue }[] {
  const rows: { document_id: string; reviewer_user_id: string; reviewer_role: ReviewerRoleValue }[] = [];
  let cursor = 0;
  for (const entry of entries) {
    for (let i = 0; i < entry.share && cursor < docIds.length; i++, cursor++) {
      rows.push({ document_id: docIds[cursor], reviewer_user_id: entry.userId, reviewer_role: role });
    }
  }
  return rows;
}

// ─── Role pill (soft-tint) ────────────────────────────────────────────────────

function RoleTag({ role }: { role: RoleKey }) {
  const r = ROLE_DEFS.find(d => d.key === role)!;
  return (
    <span className={cn(
      'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold',
      ROLE_PILL[role],
    )}>
      {r.tag}
    </span>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function AssignmentsSection({ projectId, progress, onProgressChange }: AssignmentsSectionProps) {
  const { toast } = useToast();
  const perms = useProjectPermissions();
  const containerRef = useRef<HTMLDivElement>(null);

  const [loading, setLoading] = useState(true);

  // Data
  const [forms, setForms]         = useState<Form[]>([]);
  const [members, setMembers]     = useState<ProjectMember[]>([]);
  const [docIds, setDocIds]       = useState<string[]>([]);
  const [assignedDocIds, setAssignedDocIds] = useState<Set<string>>(new Set());

  // View tab
  const [view, setView] = useState<'create' | 'allocations'>('create');

  // Unified state — every role is a list of people with shares.
  // 1 person at full share = "same reviewer for all docs"; >1 person = "split workload".
  const [roleState, setRoleState]   = useState<SplitState>({ r1: [], r2: [], adj: [] });
  const [openAdd, setOpenAdd]       = useState<RoleKey | null>(null);
  const [addSearch, setAddSearch]   = useState('');

  // Allow same person across non-conflicting roles (R1+Adj or R2+Adj). Never R1=R2 for same doc.
  const [override, setOverride] = useState(false);

  const [assigning, setAssigning]         = useState(false);
  const [confirmReassign, setConfirmReassign] = useState(false);
  const [assignMode, setAssignMode] = useState<'new' | 'all'>('all');

  // ── Derived ──────────────────────────────────────────────────────────────

  const activeForms   = forms.filter(f => f.status === 'active');
  const docCount      = docIds.length;
  const formCount     = activeForms.length;
  const existingCount = progress?.total_assignments ?? 0;

  // Docs already allocated vs docs added since last run
  const alreadyAllocatedCount = docIds.filter(id => assignedDocIds.has(id)).length;
  const newUnallocatedCount   = docIds.filter(id => !assignedDocIds.has(id)).length;
  const hasExistingAllocations = assignedDocIds.size > 0;

  // Allocation target — only new papers in 'new' mode, all papers in 'all' mode.
  const targetDocIds = assignMode === 'new'
    ? docIds.filter(id => !assignedDocIds.has(id))
    : docIds;
  const targetCount = targetDocIds.length;

  // ── Load ─────────────────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    if (!perms.can_manage_assignments) {
      setLoading(false);
      return;
    }
    setLoading(true);

    // Each call is isolated — one 403/500 must not zero out every stat card.
    const [formsRes, membersRes, docsRes, progRes, existingRes] = await Promise.allSettled([
      formsService.getAll(projectId),
      projectMembersService.listMembers(projectId),
      documentsService.getAll(projectId),
      assignmentsService.getProgress(projectId),
      assignmentsService.getProjectAssignments(projectId),
    ]);

    setForms(formsRes.status === 'fulfilled' ? formsRes.value : []);
    setMembers(membersRes.status === 'fulfilled' ? membersRes.value : []);

    if (docsRes.status === 'fulfilled') {
      const completedDocs = (docsRes.value as Document[])
        .filter(d => d.processing_status === 'completed')
        .map(d => d.id);
      setDocIds(completedDocs);
    } else {
      setDocIds([]);
    }

    // A doc is "fully allocated" only when it has R1 + R2 + Adj rows. If a
    // cascade cleanup (e.g. demoting a member to viewer) wiped one role, the
    // doc must land in the "new papers" bucket so the missing slot can be
    // refilled — otherwise the leftover R2/Adj rows make it look covered.
    const rolesByDoc = new Map<string, Set<string>>();
    if (existingRes.status === 'fulfilled') {
      for (const a of existingRes.value as { document_id: string; reviewer_role: string }[]) {
        if (!rolesByDoc.has(a.document_id)) rolesByDoc.set(a.document_id, new Set());
        rolesByDoc.get(a.document_id)!.add(a.reviewer_role);
      }
    }
    const existingSet = new Set<string>();
    rolesByDoc.forEach((roles, docId) => {
      if (roles.has('reviewer_1') && roles.has('reviewer_2') && roles.has('adjudicator')) {
        existingSet.add(docId);
      }
    });
    setAssignedDocIds(existingSet);
    setAssignMode(existingSet.size > 0 ? 'new' : 'all');

    if (progRes.status === 'fulfilled' && progRes.value) onProgressChange(progRes.value);

    const failures: string[] = [];
    if (formsRes.status === 'rejected')    failures.push('forms');
    if (membersRes.status === 'rejected')  failures.push('members');
    if (docsRes.status === 'rejected')     failures.push('documents');
    if (progRes.status === 'rejected')     failures.push('progress');
    if (existingRes.status === 'rejected') failures.push('assignments');
    if (failures.length) {
      toast({
        title: 'Some data failed to load',
        description: `Could not load: ${failures.join(', ')}. Other sections still loaded.`,
        variant: 'error',
      });
    }

    setLoading(false);
  }, [projectId, onProgressChange, toast, perms.can_manage_assignments]);

  useEffect(() => { loadData(); }, [loadData]);

  // Auto-rebalance shares when the allocation target changes (mode toggle, doc list change).
  useEffect(() => {
    setRoleState(prev => {
      const r1Total = prev.r1.reduce((s, e) => s + e.share, 0);
      const r2Total = prev.r2.reduce((s, e) => s + e.share, 0);
      const adjTotal = prev.adj.reduce((s, e) => s + e.share, 0);
      // Only rebalance if a role's total doesn't match — avoids clobbering user-set splits unnecessarily.
      if (r1Total === targetCount && r2Total === targetCount && adjTotal === targetCount) return prev;
      return {
        r1: balanceEntries(prev.r1, targetCount),
        r2: balanceEntries(prev.r2, targetCount),
        adj: balanceEntries(prev.adj, targetCount),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetCount]);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpenAdd(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Role-list actions ────────────────────────────────────────────────────

  function setRole(role: RoleKey, entries: SplitEntry[]) {
    setRoleState(s => ({ ...s, [role]: entries }));
  }

  function roleTotal(role: RoleKey) {
    return roleState[role].reduce((s, e) => s + e.share, 0);
  }

  function handleAutoBalance(role: RoleKey) {
    setRole(role, balanceEntries(roleState[role], targetCount));
  }

  function handleStepShare(role: RoleKey, idx: number, delta: number) {
    setRoleState(prev => {
      const list = [...prev[role]];
      const otherTotal = list.reduce((s, e, i) => s + (i === idx ? 0 : e.share), 0);
      const max = targetCount - otherTotal;
      const next = Math.max(0, Math.min(list[idx].share + delta, max));
      list[idx] = { ...list[idx], share: next };
      return { ...prev, [role]: list };
    });
  }

  function handleRemove(role: RoleKey, idx: number) {
    setRole(role, roleState[role].filter((_, i) => i !== idx));
  }

  function handleAdd(role: RoleKey, userId: string) {
    if (roleState[role].find(e => e.userId === userId)) return;
    // If first person added, give them everything; else auto-rebalance.
    const next = [...roleState[role], { userId, share: 0 }];
    setRole(role, balanceEntries(next, targetCount));
    setOpenAdd(null);
  }

  // ── Blind-review conflict detection ──────────────────────────────────────

  // Documents where the same user is both R1 and R2 — never allowed.
  const blindConflictCount = (() => {
    const r1Pay = buildBulkPayload('reviewer_1', roleState.r1, targetDocIds);
    const r2Pay = buildBulkPayload('reviewer_2', roleState.r2, targetDocIds);
    if (!r1Pay.length || !r2Pay.length) return 0;
    const r1Map = new Map(r1Pay.map(a => [a.document_id, a.reviewer_user_id]));
    return r2Pay.filter(a => r1Map.get(a.document_id) === a.reviewer_user_id).length;
  })();

  // R1=R2 for ALL docs (single-mode form of the conflict)
  const allR1EqR2 =
    roleState.r1.length === 1 && roleState.r2.length === 1 &&
    roleState.r1[0].userId === roleState.r2[0].userId;

  // R1 / Adj or R2 / Adj overlap (allowed under override)
  const adjOverlap = (() => {
    const r1Users = new Set(roleState.r1.map(e => e.userId));
    const r2Users = new Set(roleState.r2.map(e => e.userId));
    const adjUsers = new Set(roleState.adj.map(e => e.userId));
    return [...adjUsers].some(u => r1Users.has(u) || r2Users.has(u));
  })();

  // ── Submit ────────────────────────────────────────────────────────────────

  function handleSubmitClick() {
    // 'all' mode overwrites existing — confirm first. 'new' mode is additive, no confirm.
    if (assignMode === 'all' && hasExistingAllocations) {
      setConfirmReassign(true);
    } else {
      doSubmit();
    }
  }

  async function doSubmit() {
    setConfirmReassign(false);
    setAssigning(true);
    try {
      const assignments = ROLE_DEFS.flatMap(r =>
        buildBulkPayload(r.api, roleState[r.key], targetDocIds),
      );
      const result = await assignmentsService.bulkCreate({ project_id: projectId, assignments });
      const prog = await assignmentsService.getProgress(projectId).catch(() => null);
      if (prog) onProgressChange(prog);
      // Refresh assigned doc IDs after new assignments — switch to 'new' mode now that everything is allocated.
      assignmentsService.getProjectAssignments(projectId).catch(() => []).then(rows => {
        const next = new Set<string>(rows.map((a: { document_id: string }) => a.document_id));
        setAssignedDocIds(next);
        if (next.size > 0) setAssignMode('new');
      });
      toast({ title: 'Assignments created', description: `${result.length} assignments created` });
    } catch (err) {
      // Surface the backend's actual reason — usually "user X lacks can_run_extractions"
      // or a blind-review conflict — rather than a generic message.
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        (err as Error)?.message ||
        'Failed to create assignments';
      toast({ title: 'Could not create assignments', description: detail, variant: 'error' });
    } finally {
      setAssigning(false);
    }
  }

  // ── Can submit ────────────────────────────────────────────────────────────

  const canSubmit = (() => {
    if (members.length < 2) return false;
    if (targetCount === 0) return false;               // nothing to assign
    if (blindConflictCount > 0) return false;          // hard block — never override
    if (adjOverlap && !override) return false;
    return ROLE_DEFS.every(r =>
      roleState[r.key].length > 0 && roleTotal(r.key) === targetCount,
    );
  })();

  const totalAssignments = ROLE_DEFS.reduce((s, r) => s + roleTotal(r.key), 0);

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <PermissionGate permission="can_manage_assignments">
    <div ref={containerRef} className="space-y-6">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-gray-900 dark:text-white">
            Assignments
          </h2>
          <p className="text-sm text-gray-400 dark:text-zinc-500 mt-0.5">
            {view === 'create'
              ? 'Add reviewers to each role. Add one person to cover all papers, or several to split the workload.'
              : 'See which papers each reviewer has been allocated across all roles.'}
          </p>
        </div>
        <div className="inline-flex bg-gray-100 dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a] rounded-lg p-0.5 flex-shrink-0">
          <button
            type="button"
            onClick={() => setView('create')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-all',
              view === 'create'
                ? 'bg-white dark:bg-[#2a2a2a] text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-500 dark:text-zinc-500 hover:text-gray-700 dark:hover:text-zinc-300',
            )}
          >
            <UserPlus className="h-3 w-3" />
            Create
          </button>
          <button
            type="button"
            onClick={() => setView('allocations')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-all',
              view === 'allocations'
                ? 'bg-white dark:bg-[#2a2a2a] text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-500 dark:text-zinc-500 hover:text-gray-700 dark:hover:text-zinc-300',
            )}
          >
            <LayoutGrid className="h-3 w-3" />
            Allocations
          </button>
        </div>
      </div>

      {view === 'allocations' && (
        <AllocationsView projectId={projectId} onSwitchToCreate={() => setView('create')} />
      )}

      {view === 'create' && (<>

      {/* ── Stats bar — neutral, hairline-divided ────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-gray-100 dark:bg-[#1f1f1f] rounded-xl overflow-hidden border border-gray-100 dark:border-[#1f1f1f]">
        {([
          { label: 'Documents',            value: docCount,       sub: 'Completed and assignable' },
          { label: 'Active forms',         value: formCount,      sub: 'Per assignment'           },
          { label: 'Project members',      value: members.length, sub: 'Available to assign'      },
          { label: 'Existing assignments', value: existingCount,  sub: 'Upserted on re-assign', accent: existingCount > 0 },
        ] as { label: string; value: number; sub: string; accent?: boolean }[]).map((s) => (
          <div key={s.label} className="bg-white dark:bg-[#111111] px-4 py-4">
            <p className="text-xs text-gray-400 dark:text-zinc-500 mb-1">{s.label}</p>
            <p className={cn('text-2xl font-bold tracking-tight tabular-nums', s.accent ? 'text-amber-500' : 'text-gray-900 dark:text-white')}>{s.value}</p>
            <p className="text-[11px] text-gray-400 dark:text-zinc-600 mt-0.5">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* ── Confirm re-assign dialog ───────────────────────────────────────── */}
      {confirmReassign && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setConfirmReassign(false)}>
          <div className="bg-white dark:bg-[#111111] rounded-2xl border border-gray-200 dark:border-[#1f1f1f] shadow-2xl p-6 max-w-sm w-full" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-400/15 flex items-center justify-center">
                <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              </div>
              <button type="button" onClick={() => setConfirmReassign(false)} className="text-gray-300 dark:text-zinc-600 hover:text-gray-500 p-1">
                <X className="h-4 w-4" />
              </button>
            </div>
            <h3 className="text-[14px] font-semibold text-gray-900 dark:text-white mb-1">Re-assign papers?</h3>
            <p className="text-[12.5px] text-gray-500 dark:text-zinc-400 mb-2 leading-relaxed">
              <strong className="text-gray-700 dark:text-zinc-200 tabular-nums">{alreadyAllocatedCount}</strong> paper{alreadyAllocatedCount !== 1 ? 's' : ''} already have assignments.
              Submitting will overwrite them with the new reviewer picks.
            </p>
            {newUnallocatedCount > 0 && (
              <p className="text-[12.5px] text-gray-500 dark:text-zinc-400 mb-5 leading-relaxed">
                <strong className="text-emerald-600 dark:text-emerald-400 tabular-nums">{newUnallocatedCount}</strong> new paper{newUnallocatedCount !== 1 ? 's' : ''} will also be assigned for the first time.
              </p>
            )}
            {newUnallocatedCount === 0 && <div className="mb-5" />}
            <div className="flex gap-2">
              <button type="button" onClick={() => setConfirmReassign(false)}
                className="flex-1 px-4 py-2 rounded-lg border border-gray-200 dark:border-[#2a2a2a] text-[12.5px] font-medium text-gray-600 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] transition-colors">
                Cancel
              </button>
              <button type="button" onClick={doSubmit} disabled={assigning}
                className="flex-1 px-4 py-2 rounded-lg bg-gray-900 dark:bg-white text-white dark:text-black text-[12.5px] font-semibold hover:bg-gray-700 dark:hover:bg-zinc-100 disabled:opacity-40 transition-colors flex items-center justify-center gap-2">
                {assigning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
                Yes, re-assign
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Existing allocations banner with mode toggle ──────────────────── */}
      {hasExistingAllocations && (
        <div className="border border-amber-200 dark:border-amber-900/60 bg-amber-50/60 dark:bg-amber-950/20 rounded-xl px-4 py-3 space-y-3">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 w-7 h-7 rounded-lg bg-amber-100 dark:bg-amber-400/15 flex items-center justify-center mt-0.5">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
            </div>
            <div className="flex-1 min-w-0 text-[12.5px] leading-relaxed">
              <span className="font-semibold text-gray-800 dark:text-zinc-200">
                <span className="tabular-nums">{alreadyAllocatedCount}</span> paper{alreadyAllocatedCount !== 1 ? 's' : ''} already allocated
                {newUnallocatedCount > 0 && <>, <span className="tabular-nums">{newUnallocatedCount}</span> new paper{newUnallocatedCount !== 1 ? 's' : ''} added since last run</>}.
              </span>{' '}
              <span className="text-amber-700 dark:text-amber-300">
                {assignMode === 'new'
                  ? newUnallocatedCount > 0
                    ? 'Existing assignments stay untouched — only the new papers will be assigned below.'
                    : 'No new papers to assign. Switch to "Re-assign everything" if you want to overwrite the existing picks.'
                  : 'Submitting will overwrite all existing reviewer picks.'}
              </span>
            </div>
          </div>

          {/* Mode toggle */}
          <div className="inline-flex bg-white/70 dark:bg-[#1a1a1a]/60 border border-amber-200/70 dark:border-amber-900/40 rounded-lg p-0.5">
            <button
              type="button"
              onClick={() => setAssignMode('new')}
              disabled={newUnallocatedCount === 0}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-all',
                assignMode === 'new'
                  ? 'bg-emerald-50 dark:bg-emerald-400/10 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-200/70 dark:ring-emerald-400/20'
                  : 'text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 disabled:opacity-30 disabled:cursor-not-allowed',
              )}
            >
              Assign new papers only
              <span className={cn('tabular-nums text-[11px]', assignMode === 'new' ? 'text-emerald-500/70 dark:text-emerald-400/70' : 'text-gray-400 dark:text-zinc-600')}>{newUnallocatedCount}</span>
            </button>
            <button
              type="button"
              onClick={() => setAssignMode('all')}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-all',
                assignMode === 'all'
                  ? 'bg-amber-50 dark:bg-amber-400/10 text-amber-700 dark:text-amber-300 ring-1 ring-amber-200/70 dark:ring-amber-400/20'
                  : 'text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300',
              )}
            >
              Re-assign everything
              <span className={cn('tabular-nums text-[11px]', assignMode === 'all' ? 'text-amber-500/70 dark:text-amber-400/70' : 'text-gray-400 dark:text-zinc-600')}>{docCount}</span>
            </button>
          </div>
        </div>
      )}

      {/* ── Scope summary ──────────────────────────────────────────────────── */}
      {docCount > 0 && formCount > 0 && (
        <div className="flex items-center gap-4 flex-wrap border border-gray-200 dark:border-[#1f1f1f] rounded-xl px-4 py-3 bg-white dark:bg-[#111111]">
          <span className="text-[12.5px] text-gray-400 dark:text-zinc-500">
            Each reviewer completes:
          </span>
          <div className="flex items-baseline gap-2 font-mono text-[13px] tabular-nums">
            <span className="text-[18px] font-bold text-gray-900 dark:text-white">{docCount}</span>
            <span className="text-gray-400">docs</span>
            <span className="text-gray-300 dark:text-zinc-600">×</span>
            <span className="text-[18px] font-bold text-gray-900 dark:text-white">{formCount}</span>
            <span className="text-gray-400">forms</span>
            <span className="text-gray-300 dark:text-zinc-600">=</span>
            <span className="inline-flex items-center gap-1.5 bg-gray-900 dark:bg-white text-white dark:text-gray-900 rounded-lg px-3 py-1">
              <span className="text-[15px] font-bold">{docCount * formCount}</span>
              <span className="text-[10.5px] opacity-70">form completions / reviewer</span>
            </span>
          </div>
        </div>
      )}

      {/* ── Hard block: <2 members ─────────────────────────────────────────── */}
      {members.length < 2 ? (
        <div className="border border-dashed border-gray-200 dark:border-[#2a2a2a] rounded-xl p-8 text-center bg-white dark:bg-[#111111]">
          <div className="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-gray-100 dark:bg-[#1a1a1a] mb-3">
            <Users className="h-5 w-5 text-gray-400" />
          </div>
          <h4 className="text-[14px] font-semibold text-gray-900 dark:text-white mb-1.5">
            You need at least 2 members to assign reviewers
          </h4>
          <p className="text-[12.5px] text-gray-500 dark:text-zinc-400 max-w-sm mx-auto">
            Dual-blind review needs an R1 and an R2. Invite collaborators to this project first.
          </p>
        </div>
      ) : (
        <>
          {/* ── R1 = R2 hard block ────────────────────────────────────────── */}
          {(allR1EqR2 || blindConflictCount > 0) && (
            <div className="flex items-start gap-2.5 border border-red-200 dark:border-red-900/60 bg-red-50/60 dark:bg-red-950/20 rounded-xl px-4 py-3">
              <AlertTriangle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-[12.5px] text-gray-700 dark:text-zinc-300">
                <strong>
                  {allR1EqR2
                    ? 'R1 and R2 cannot be the same person.'
                    : `${blindConflictCount} paper${blindConflictCount !== 1 ? 's' : ''} have the same person as both R1 and R2.`}
                </strong>{' '}
                Blind review requires R1 and R2 to be different people for every paper. This cannot be overridden.
              </p>
            </div>
          )}

          {/* ── Soft warning: <3 members ──────────────────────────────────── */}
          {members.length < 3 && (
            <div className="flex items-start gap-3 border border-amber-200 dark:border-amber-900/60 bg-amber-50/60 dark:bg-amber-950/20 rounded-xl p-4">
              <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-400/15 flex items-center justify-center">
                <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold text-gray-900 dark:text-white mb-0.5">
                  Only {members.length} project member{members.length !== 1 ? 's' : ''} — dual-blind review needs 3 distinct people
                </div>
                <p className="text-[12.5px] text-gray-600 dark:text-zinc-400">
                  You can still proceed by reusing one person across the consensus reviewer role, but they won&apos;t be a fully independent third opinion.
                </p>
                <label className="inline-flex items-center gap-2 mt-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    className="accent-amber-500 w-3.5 h-3.5 cursor-pointer"
                    checked={override}
                    onChange={e => setOverride(e.target.checked)}
                  />
                  <span className="text-[12.5px] text-gray-700 dark:text-zinc-300">
                    I understand — allow the consensus reviewer to also be R1 or R2
                  </span>
                </label>
              </div>
            </div>
          )}

          {/* ── Adjudicator overlap soft warning (override on) ──────────── */}
          {adjOverlap && override && !blindConflictCount && !allR1EqR2 && (
            <div className="flex items-start gap-2.5 border border-amber-200 dark:border-amber-900/60 bg-amber-50/60 dark:bg-amber-950/20 rounded-xl px-4 py-3">
              <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
              <p className="text-[12.5px] text-gray-600 dark:text-zinc-400">
                Consensus reviewer is also an R1 or R2 on some papers. They&apos;ll see both reviews when reaching consensus — proceed only if that&apos;s acceptable.
              </p>
            </div>
          )}

          {/* ── Reviewers heading ─────────────────────────────────────────── */}
          <div className="flex items-center justify-between">
            <h3 className="text-[10.5px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-500">
              Reviewers
            </h3>
            <span className="text-[11.5px] text-gray-400 dark:text-zinc-500">
              Tip: Add one person for &ldquo;same reviewer for all papers&rdquo;, or several to split the workload.
            </span>
          </div>

          {/* ── Role cards — neutral surface, soft-tint pills ─────────────── */}
          <div className="space-y-3">
            {ROLE_DEFS.map(r => {
              const list      = roleState[r.key];
              const total     = roleTotal(r.key);
              const remaining = targetCount - total;
              const isAddOpen = openAdd === r.key;

              return (
                <div
                  key={r.key}
                  className="border border-gray-200 dark:border-[#1f1f1f] rounded-xl bg-white dark:bg-[#111111] p-4"
                >
                  {/* Role header */}
                  <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <RoleTag role={r.key} />
                      <span className="text-[13px] font-semibold text-gray-900 dark:text-white">
                        {r.name}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleAutoBalance(r.key)}
                      disabled={list.length <= 1}
                      className="flex items-center gap-1.5 text-[11.5px] font-medium text-gray-500 dark:text-zinc-400 border border-gray-200 dark:border-[#2a2a2a] rounded-lg px-2.5 py-1 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      <Scale className="h-3 w-3" />
                      Distribute evenly
                    </button>
                  </div>
                  <p className="text-[12px] text-gray-400 dark:text-zinc-500 mb-3">
                    {r.desc}
                  </p>

                  {/* Distribution bar (only when >1 person) */}
                  {list.length > 1 && (
                    <div className="h-1 rounded-full bg-gray-100 dark:bg-[#1a1a1a] overflow-hidden flex mb-3">
                      {list.map((e) => {
                        const pct = targetCount ? (e.share / targetCount * 100) : 0;
                        return (
                          <div
                            key={e.userId}
                            style={{ flexBasis: `${pct}%` }}
                            className={cn('h-full transition-all', ROLE_DOT[r.key])}
                          />
                        );
                      })}
                      {remaining > 0 && targetCount > 0 && (
                        <div
                          style={{ flexBasis: `${remaining / targetCount * 100}%` }}
                          className="h-full bg-gray-100 dark:bg-[#1a1a1a]"
                        />
                      )}
                    </div>
                  )}

                  {/* Members list */}
                  {list.length > 0 && (
                    <div className="space-y-1.5 mb-3">
                      {list.map((entry, idx) => {
                        const member  = members.find(m => m.user_id === entry.userId);
                        if (!member) return null;
                        const pct    = targetCount ? Math.round(entry.share / targetCount * 100) : 0;
                        const canDec = entry.share > 0;
                        const canInc = remaining > 0;

                        return (
                          <div
                            key={entry.userId}
                            className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2.5 px-2.5 py-2 border border-gray-100 dark:border-[#1a1a1a] rounded-lg"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', ROLE_DOT[r.key])} />
                              <Avatar email={member.email} name={member.full_name} size="sm" />
                              <div className="min-w-0">
                                <div className="text-[12.5px] font-medium text-gray-800 dark:text-zinc-200 truncate">
                                  {displayName(member)}
                                </div>
                                <div className="text-[11px] text-gray-400 dark:text-zinc-500 truncate">
                                  {member.email}
                                </div>
                              </div>
                            </div>

                            {/* Stepper */}
                            {list.length > 1 ? (
                              <div className="flex items-center border border-gray-200 dark:border-[#2a2a2a] rounded-lg overflow-hidden">
                                {([[-5, ChevronsLeft, entry.share < 5], [-1, Minus, !canDec], [1, Plus, !canInc], [5, ChevronsRight, remaining < 5]] as [number, React.ComponentType<{ className?: string }>, boolean][]).map(([d, Icon, dis]) => (
                                  <button
                                    key={d}
                                    type="button"
                                    onClick={() => handleStepShare(r.key, idx, d)}
                                    disabled={dis}
                                    className="w-6 h-6 flex items-center justify-center text-gray-400 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                  >
                                    <Icon className={cn(d === -5 || d === 5 ? 'h-3 w-3' : 'h-2.5 w-2.5')} />
                                  </button>
                                ))}
                                <span className="font-mono text-[12px] font-semibold text-gray-800 dark:text-zinc-200 min-w-[48px] text-center px-1 border-l border-gray-200 dark:border-[#2a2a2a] tabular-nums">
                                  {entry.share}
                                </span>
                              </div>
                            ) : (
                              <span className="font-mono text-[12px] font-semibold text-gray-800 dark:text-zinc-200 tabular-nums px-2">
                                {entry.share} doc{entry.share !== 1 ? 's' : ''}
                              </span>
                            )}

                            {/* Percent */}
                            <span className="font-mono text-[11px] text-gray-400 dark:text-zinc-500 min-w-[32px] text-right tabular-nums">
                              {pct}%
                            </span>

                            {/* Remove */}
                            <button
                              type="button"
                              onClick={() => handleRemove(r.key, idx)}
                              className="w-6 h-6 flex items-center justify-center rounded text-gray-300 dark:text-zinc-600 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-500 transition-colors"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Add member */}
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => {
                        if (isAddOpen) { setOpenAdd(null); }
                        else { setOpenAdd(r.key); setAddSearch(''); }
                      }}
                      className="w-full flex items-center justify-center gap-1.5 text-[12.5px] font-medium text-gray-400 dark:text-zinc-500 border border-dashed border-gray-200 dark:border-[#2a2a2a] rounded-lg py-2 hover:bg-gray-50 dark:hover:bg-[#0d0d0d] hover:text-gray-600 dark:hover:text-zinc-300 transition-colors"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      {list.length === 0 ? `Add ${r.tag}` : `Add another ${r.tag}`}
                    </button>

                    {isAddOpen && (
                      <div className="absolute top-[calc(100%+6px)] left-0 right-0 bg-white dark:bg-[#111111] border border-gray-200 dark:border-[#1f1f1f] rounded-xl shadow-lg z-30 overflow-hidden">
                        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-100 dark:border-[#1a1a1a] sticky top-0 bg-white dark:bg-[#111111]">
                          <Search className="h-3 w-3 text-gray-400 flex-shrink-0" />
                          <input
                            autoFocus
                            value={addSearch}
                            onChange={e => setAddSearch(e.target.value)}
                            placeholder="Search members…"
                            className="flex-1 bg-transparent text-[13px] text-gray-900 dark:text-white outline-none placeholder-gray-400"
                          />
                        </div>
                        <div className="max-h-52 overflow-y-auto">
                          {(() => {
                            const lq = addSearch.toLowerCase();
                            const visible = members.filter(m =>
                              !addSearch.trim() ||
                              displayName(m).toLowerCase().includes(lq) ||
                              (m.email || '').toLowerCase().includes(lq),
                            );
                            if (visible.length === 0) {
                              return (
                                <div className="text-center text-[12.5px] text-gray-400 py-5">
                                  No members found
                                </div>
                              );
                            }
                            return visible.map(m => {
                              const alreadyAdded = !!list.find(e => e.userId === m.user_id);
                              return (
                                <div
                                  key={m.user_id}
                                  onClick={() => !alreadyAdded && handleAdd(r.key, m.user_id)}
                                  className={cn(
                                    'flex items-center gap-2.5 px-3 py-2.5 border-b border-gray-50 dark:border-[#0d0d0d] last:border-b-0',
                                    alreadyAdded
                                      ? 'opacity-40 cursor-not-allowed'
                                      : 'cursor-pointer hover:bg-gray-50 dark:hover:bg-[#1a1a1a]',
                                  )}
                                >
                                  <Avatar email={m.email} name={m.full_name} size="sm" />
                                  <div className="flex-1 min-w-0">
                                    <div className="text-[12.5px] font-medium text-gray-800 dark:text-zinc-200 truncate">
                                      {displayName(m)}
                                    </div>
                                    <div className="text-[11px] text-gray-400 truncate">{m.email}</div>
                                  </div>
                                  {alreadyAdded && (
                                    <span className="text-[11px] text-gray-400 font-mono flex-shrink-0">
                                      already added
                                    </span>
                                  )}
                                </div>
                              );
                            });
                          })()}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Coverage footer */}
                  <div className="mt-2.5 text-[11.5px] flex items-center gap-2">
                    {list.length === 0 ? (
                      <span className="text-gray-400">
                        No {r.key === 'adj' ? 'consensus reviewer' : r.tag} yet — add at least one person.
                      </span>
                    ) : remaining > 0 ? (
                      <>
                        <span className="text-amber-600 dark:text-amber-400 font-semibold">
                          {remaining} doc{remaining !== 1 ? 's' : ''} unassigned
                        </span>
                        <span className="text-gray-400">
                          · {list.length === 1 ? 'click Distribute evenly to give them all' : `${list.length} people sharing`}
                        </span>
                      </>
                    ) : remaining < 0 ? (
                      <span className="text-red-500 font-semibold">
                        Over-allocated by {-remaining}
                      </span>
                    ) : (
                      <>
                        <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                          ✓ All {targetCount} {assignMode === 'new' && hasExistingAllocations ? 'new ' : ''}docs covered
                        </span>
                        {list.length > 1 && (
                          <span className="text-gray-400">
                            · {list.length} people sharing this role
                          </span>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── Action bar ────────────────────────────────────────────────── */}
          <div className={cn(
            'flex items-center gap-3 px-4 py-3.5 border rounded-xl',
            canSubmit
              ? 'bg-white dark:bg-[#111111] border-gray-200 dark:border-[#1f1f1f]'
              : 'bg-gray-50 dark:bg-[#0d0d0d] border-gray-200 dark:border-[#1f1f1f]',
          )}>
            <div className="flex-1 min-w-0 text-[13px] text-gray-600 dark:text-zinc-400">
              {(() => {
                const missing = ROLE_DEFS.filter(r => roleState[r.key].length === 0).map(r => r.tag);
                if (missing.length) {
                  return (
                    <>
                      Add at least one person to:{' '}
                      <strong className="text-gray-700 dark:text-zinc-200">{missing.join(', ')}</strong>.
                    </>
                  );
                }
                if (targetCount === 0) {
                  return (
                    <span className="text-gray-500">
                      No new papers to assign. Switch to &ldquo;Re-assign everything&rdquo; in the banner above to overwrite existing picks.
                    </span>
                  );
                }
                const gaps = ROLE_DEFS.filter(r => roleTotal(r.key) !== targetCount);
                if (gaps.length) {
                  return (
                    <>
                      <span className="text-amber-600 dark:text-amber-400 font-medium">Coverage gap:</span>{' '}
                      {gaps.map(r => `${r.tag} (${targetCount - roleTotal(r.key)} unassigned)`).join(', ')}.
                    </>
                  );
                }
                if (blindConflictCount > 0 || allR1EqR2) {
                  return (
                    <span className="text-red-500 font-medium">
                      Resolve the R1/R2 conflict above before continuing.
                    </span>
                  );
                }
                const newOnly = assignMode === 'new' && hasExistingAllocations;
                return (
                  <>
                    Ready to {newOnly ? 'assign' : 'create'}{' '}
                    <strong className="text-gray-900 dark:text-white tabular-nums">{totalAssignments}</strong>{' '}
                    assignment{totalAssignments !== 1 ? 's' : ''} across{' '}
                    <strong className="text-gray-900 dark:text-white tabular-nums">{targetCount}</strong>{' '}
                    {newOnly ? 'new ' : ''}document{targetCount !== 1 ? 's' : ''}.
                  </>
                );
              })()}
            </div>

            <button
              type="button"
              onClick={handleSubmitClick}
              disabled={!canSubmit || assigning}
              className="flex items-center gap-1.5 text-xs font-semibold text-white dark:text-gray-900 bg-gray-900 dark:bg-white rounded-lg px-3 py-1.5 hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity whitespace-nowrap flex-shrink-0"
            >
              {assigning
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <UserPlus className="h-3.5 w-3.5" />}
              Create assignments
            </button>
          </div>
        </>
      )}
      </>)}
    </div>
    </PermissionGate>
  );
}

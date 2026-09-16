'use client';

/**
 * Assignments — set up who reads what.
 *
 * Two tabs: **Set up** walks the three decisions in order (team → split →
 * confirm), **Allocations** shows and edits what came out of it. The set-up
 * flow used to be one long page of role cards, a stats bar, a scope summary and
 * an action bar, with no indication of what to do first; the numbered steps are
 * the same three decisions, in the order you have to make them.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Users, Loader2, AlertTriangle, Search, Plus, Minus, X, Check,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { assignmentsService, formsService, projectMembersService, documentsService, projectsService } from '@/services';
import type { AssignmentProgress, ProjectMember, Form, Document, ReviewAssignment } from '@/types/api';
import { useToast } from '@/hooks/use-toast';
import { AllocationsView } from './AllocationsView';
import { PermissionGate } from '@/components/ui/permission-gate';
import { useProjectPermissions } from '@/hooks/useProjectPermissions';
import {
  ROLE_DEFS, ROLE_BY_KEY, RolePill, SegGroup, SegButton,
  ReviewerAvatar, memberDisplayName, canTakeRole,
  type ReviewerRoleKey,
} from './allocationShared';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AssignmentsSectionProps {
  projectId: string;
  /** Held by the project page for its own header; this section only writes it. */
  progress: AssignmentProgress | null;
  onProgressChange: (p: AssignmentProgress | null) => void;
}

type SplitEntry = { userId: string; share: number };
type SplitState = Record<ReviewerRoleKey, SplitEntry[]>;

const EMPTY_SPLIT: SplitState = { reviewer_1: [], reviewer_2: [], adjudicator: [] };

/** Shares get their own tint per person so the split bar reads as a split. */
const SEGMENT_FADE = ['', 'opacity-75', 'opacity-[0.55]', 'opacity-40', 'opacity-30'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function balanceEntries(list: SplitEntry[], total: number): SplitEntry[] {
  if (!list.length) return list;
  const per = Math.floor(total / list.length);
  const rem = total - per * list.length;
  return list.map((e, i) => ({ ...e, share: per + (i < rem ? 1 : 0) }));
}

function buildBulkPayload(role: ReviewerRoleKey, entries: SplitEntry[], docIds: string[]) {
  const rows: { document_id: string; reviewer_user_id: string; reviewer_role: ReviewerRoleKey }[] = [];
  let cursor = 0;
  for (const entry of entries) {
    for (let i = 0; i < entry.share && cursor < docIds.length; i++, cursor++) {
      rows.push({ document_id: docIds[cursor], reviewer_user_id: entry.userId, reviewer_role: role });
    }
  }
  return rows;
}

/**
 * Papers that hold all three roles. A cascade cleanup (demoting a member to
 * viewer, say) can wipe one role and leave the other two, and such a paper must
 * land back in the "needs reviewers" bucket rather than look covered.
 */
function fullyAssignedDocIds(rows: Pick<ReviewAssignment, 'document_id' | 'reviewer_role'>[]): Set<string> {
  const byDoc = new Map<string, Set<string>>();
  for (const a of rows) {
    if (!byDoc.has(a.document_id)) byDoc.set(a.document_id, new Set());
    byDoc.get(a.document_id)!.add(a.reviewer_role);
  }
  const out = new Set<string>();
  byDoc.forEach((roles, docId) => {
    if (ROLE_DEFS.every(r => roles.has(r.key))) out.add(docId);
  });
  return out;
}

function errorDetail(err: unknown, fallback: string): string {
  return (
    (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
    (err as Error)?.message ||
    fallback
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function AssignmentsSection({ projectId, onProgressChange }: AssignmentsSectionProps) {
  const { toast } = useToast();
  const perms = useProjectPermissions();
  const containerRef = useRef<HTMLDivElement>(null);

  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'setup' | 'allocations'>('setup');

  const [reviewSettings, setReviewSettings] = useState<{ blinding: 'none' | 'partial' | 'full'; hide_ai_results: boolean }>(
    { blinding: 'none', hide_ai_results: false },
  );
  // Which switch is mid-save — drives its spinner and disables the pair.
  const [savingPrivacyKey, setSavingPrivacyKey] = useState<'blinding' | 'hide_ai_results' | null>(null);

  const [forms, setForms]       = useState<Form[]>([]);
  const [members, setMembers]   = useState<ProjectMember[]>([]);
  const [docIds, setDocIds]     = useState<string[]>([]);
  const [assignedDocIds, setAssignedDocIds] = useState<Set<string>>(new Set());

  const [roleState, setRoleState] = useState<SplitState>(EMPTY_SPLIT);
  const [openAdd, setOpenAdd]     = useState<ReviewerRoleKey | null>(null);
  const [addSearch, setAddSearch] = useState('');
  const [override, setOverride]   = useState(false);

  const [assigning, setAssigning]             = useState(false);
  const [confirmReassign, setConfirmReassign] = useState(false);
  const [assignMode, setAssignMode]           = useState<'new' | 'all'>('all');
  const [successMsg, setSuccessMsg]           = useState('');

  // ── Derived ───────────────────────────────────────────────────────────────

  const activeForms = forms.filter(f => f.status === 'active');
  const formCount   = activeForms.length;
  const docCount    = docIds.length;

  const alreadyAllocatedCount = docIds.filter(id => assignedDocIds.has(id)).length;
  const newUnallocatedCount   = docIds.filter(id => !assignedDocIds.has(id)).length;
  const hasExistingAllocations = assignedDocIds.size > 0;

  const targetDocIds = assignMode === 'new' ? docIds.filter(id => !assignedDocIds.has(id)) : docIds;
  const targetCount  = targetDocIds.length;

  const roleTotal = (role: ReviewerRoleKey) => roleState[role].reduce((s, e) => s + e.share, 0);
  const memberOf   = (userId: string) => members.find(m => m.user_id === userId);

  // ── Load ──────────────────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    if (!perms.can_manage_assignments) { setLoading(false); return; }
    setLoading(true);

    // Isolated, so one 403/500 does not zero out every panel.
    const [formsRes, membersRes, docsRes, progRes, existingRes, projectRes] = await Promise.allSettled([
      formsService.getAll(projectId),
      projectMembersService.listMembers(projectId),
      documentsService.getAll(projectId),
      assignmentsService.getProgress(projectId),
      assignmentsService.getProjectAssignments(projectId),
      projectsService.getById(projectId),
    ]);

    setForms(formsRes.status === 'fulfilled' ? formsRes.value : []);
    setMembers(membersRes.status === 'fulfilled' ? membersRes.value : []);

    if (projectRes.status === 'fulfilled') {
      const rs = projectRes.value.review_settings;
      setReviewSettings({ blinding: rs?.blinding ?? 'none', hide_ai_results: rs?.hide_ai_results ?? false });
    }

    setDocIds(
      docsRes.status === 'fulfilled'
        ? (docsRes.value as Document[]).filter(d => d.processing_status === 'completed').map(d => d.id)
        : [],
    );

    const existing = existingRes.status === 'fulfilled'
      ? fullyAssignedDocIds(existingRes.value)
      : new Set<string>();
    setAssignedDocIds(existing);
    setAssignMode(existing.size > 0 ? 'new' : 'all');

    if (progRes.status === 'fulfilled' && progRes.value) onProgressChange(progRes.value);

    const failures = [
      formsRes.status === 'rejected' && 'forms',
      membersRes.status === 'rejected' && 'members',
      docsRes.status === 'rejected' && 'documents',
      progRes.status === 'rejected' && 'progress',
      existingRes.status === 'rejected' && 'assignments',
      projectRes.status === 'rejected' && 'review settings',
    ].filter(Boolean) as string[];
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

  // Rebalance when the target changes (mode toggle, new upload) — but never
  // clobber a split the user has already balanced by hand.
  useEffect(() => {
    setRoleState(prev => {
      if (ROLE_DEFS.every(r => prev[r.key].reduce((s, e) => s + e.share, 0) === targetCount)) return prev;
      return {
        reviewer_1:  balanceEntries(prev.reviewer_1, targetCount),
        reviewer_2:  balanceEntries(prev.reviewer_2, targetCount),
        adjudicator: balanceEntries(prev.adjudicator, targetCount),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetCount]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpenAdd(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Review settings ───────────────────────────────────────────────────────

  /**
   * Two independent switches, not one three-way choice. They map straight onto
   * the two orthogonal fields `blinding_service` already reads: `blinding`
   * ('partial' | 'none') is the reader-vs-reader blind, `hide_ai_results` is
   * the AI blind. The old dropdown coupled them — "Fully blind" was the only
   * way to hide AI — so "hide AI but let the readers compare" was unreachable.
   * 'full' is the legacy spelling of 'partial': read it, write 'partial'.
   */
  const blindReaders = reviewSettings.blinding !== 'none';
  const hideAiFromReviewers = reviewSettings.hide_ai_results === true;

  const savePrivacy = async (
    key: 'blinding' | 'hide_ai_results',
    patch: Partial<typeof reviewSettings>,
  ) => {
    const prev = reviewSettings;
    const merged = { ...prev, ...patch };
    // One switch at a time, but the endpoint replaces the whole object — so
    // send the merged pair, or flipping one would silently reset the other.
    const next = {
      blinding: (merged.blinding === 'none' ? 'none' : 'partial') as 'none' | 'partial',
      hide_ai_results: merged.hide_ai_results,
    };
    setReviewSettings(next);
    setSavingPrivacyKey(key);
    try {
      await projectsService.updateReviewSettings(projectId, next);
      toast({ title: 'Saved', description: 'Reviewer privacy updated.', variant: 'success' });
    } catch (err) {
      setReviewSettings(prev);
      toast({ title: 'Error', description: errorDetail(err, 'Failed to update review settings'), variant: 'error' });
    } finally {
      setSavingPrivacyKey(null);
    }
  };

  // ── Team + split actions ──────────────────────────────────────────────────

  const setRole = (role: ReviewerRoleKey, entries: SplitEntry[]) =>
    setRoleState(s => ({ ...s, [role]: entries }));

  const addPerson = (role: ReviewerRoleKey, userId: string) => {
    if (roleState[role].some(e => e.userId === userId)) return;
    setRole(role, balanceEntries([...roleState[role], { userId, share: 0 }], targetCount));
    setOpenAdd(null);
    setSuccessMsg('');
  };

  const removePerson = (role: ReviewerRoleKey, userId: string) => {
    setRole(role, balanceEntries(roleState[role].filter(e => e.userId !== userId), targetCount));
    setSuccessMsg('');
  };

  const stepShare = (role: ReviewerRoleKey, userId: string, delta: number) => {
    setRoleState(prev => {
      const list = prev[role];
      const others = list.reduce((s, e) => s + (e.userId === userId ? 0 : e.share), 0);
      const max = targetCount - others;
      return {
        ...prev,
        [role]: list.map(e =>
          e.userId === userId ? { ...e, share: Math.max(0, Math.min(e.share + delta, max)) } : e),
      };
    });
  };

  const setMode = (mode: 'new' | 'all') => {
    setAssignMode(mode);
    setSuccessMsg('');
    const total = mode === 'all' ? docCount : newUnallocatedCount;
    setRoleState(prev => ({
      reviewer_1:  balanceEntries(prev.reviewer_1, total),
      reviewer_2:  balanceEntries(prev.reviewer_2, total),
      adjudicator: balanceEntries(prev.adjudicator, total),
    }));
  };

  // ── Conflicts + readiness ─────────────────────────────────────────────────

  const r1Users = new Set(roleState.reviewer_1.map(e => e.userId));
  const r2Users = new Set(roleState.reviewer_2.map(e => e.userId));

  /** Papers where the same person would be both readers — never allowed. */
  const blindConflictCount = (() => {
    const r1 = buildBulkPayload('reviewer_1', roleState.reviewer_1, targetDocIds);
    const r2 = buildBulkPayload('reviewer_2', roleState.reviewer_2, targetDocIds);
    if (!r1.length || !r2.length) return 0;
    const byDoc = new Map(r1.map(a => [a.document_id, a.reviewer_user_id]));
    return r2.filter(a => byDoc.get(a.document_id) === a.reviewer_user_id).length;
  })();

  const conflictR1R2 = [...r1Users].some(u => r2Users.has(u)) || blindConflictCount > 0;
  const consOverlap  = !conflictR1R2
    && roleState.adjudicator.some(e => r1Users.has(e.userId) || r2Users.has(e.userId));

  const ineligible = ROLE_DEFS.flatMap(r =>
    roleState[r.key]
      .filter(e => !canTakeRole(memberOf(e.userId), r.key))
      .map(e => `${memberDisplayName(memberOf(e.userId))} (${r.name})`));

  const readiness: { ready: boolean; msg: string } = (() => {
    if (members.length < 2) return { ready: false, msg: '' };
    if (targetCount === 0) return { ready: false, msg: '' };
    const missing = ROLE_DEFS.filter(r => roleState[r.key].length === 0);
    if (missing.length) {
      return { ready: false, msg: `Add at least one person to: ${missing.map(r => r.name).join(', ')}.` };
    }
    if (conflictR1R2) {
      return { ready: false, msg: 'The same person cannot be both readers — fix step 1.' };
    }
    if (consOverlap && !override) {
      return { ready: false, msg: 'Your consensus reviewer is also a reader — tick the box in step 1 to allow it, or pick someone else.' };
    }
    if (ineligible.length) {
      return { ready: false, msg: `Missing permission: ${ineligible.join(', ')}. Remove them, or grant the permission under Members.` };
    }
    for (const r of ROLE_DEFS) {
      const gap = targetCount - roleTotal(r.key);
      if (gap !== 0) {
        return {
          ready: false,
          msg: gap > 0
            ? `${r.name} still has ${gap} of ${targetCount} papers unassigned — fix step 2.`
            : `${r.name} is over-allocated by ${-gap} papers — fix step 2.`,
        };
      }
    }
    return { ready: true, msg: '' };
  })();

  // ── Submit ────────────────────────────────────────────────────────────────

  const handleSubmitClick = () => {
    if (!readiness.ready) return;
    // 'all' overwrites existing picks — confirm. 'new' only fills gaps.
    if (assignMode === 'all' && hasExistingAllocations) setConfirmReassign(true);
    else doSubmit();
  };

  async function doSubmit() {
    setConfirmReassign(false);
    setAssigning(true);
    try {
      const assignments = ROLE_DEFS.flatMap(r => buildBulkPayload(r.key, roleState[r.key], targetDocIds));
      const result = await assignmentsService.bulkCreate({ project_id: projectId, assignments });

      const prog = await assignmentsService.getProgress(projectId).catch(() => null);
      if (prog) onProgressChange(prog);

      const rows = await assignmentsService.getProjectAssignments(projectId).catch(() => []);
      const covered = fullyAssignedDocIds(rows);
      setAssignedDocIds(covered);
      if (covered.size > 0) setAssignMode('new');

      setSuccessMsg(`${result.length} assignment${result.length !== 1 ? 's' : ''} created across ${targetCount} paper${targetCount !== 1 ? 's' : ''}.`);
      toast({ title: 'Assignments created', description: `${result.length} assignments created`, variant: 'success' });
    } catch (err) {
      // Surface the backend's reason — usually a missing permission or a blind conflict.
      toast({
        title: 'Could not create assignments',
        description: errorDetail(err, 'Failed to create assignments'),
        variant: 'error',
      });
    } finally {
      setAssigning(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  const showSteps = targetCount > 0 && members.length >= 2;

  return (
    <PermissionGate permission="can_manage_assignments">
    <div ref={containerRef} className="space-y-4">

      {/* ── Header ───────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-gray-900 dark:text-white">Assignments</h2>
          <p className="text-[13px] text-gray-400 dark:text-zinc-500 mt-0.5 max-w-[58ch]">
            {view === 'setup'
              ? 'Two people read every paper independently, and a third settles disagreements. Set up who does what here.'
              : 'What each reviewer has on their plate. Hand a paper to someone else in one click.'}
          </p>
        </div>
        <SegGroup className="flex-shrink-0">
          <SegButton active={view === 'setup'} onClick={() => setView('setup')}>Set up</SegButton>
          <SegButton active={view === 'allocations'} onClick={() => setView('allocations')}>Allocations</SegButton>
        </SegGroup>
      </div>

      {view === 'allocations' && (
        <AllocationsView projectId={projectId} onSwitchToCreate={() => setView('setup')} />
      )}

      {view === 'setup' && (<>

        {/* ── What is already allocated ─────────────────────────────────────── */}
        {/* One banner at a time: the mode choice only exists while there are new
            papers to choose between, and "Re-assign everything" carries its own
            warning once it is the mode in force. */}
        {hasExistingAllocations && (newUnallocatedCount > 0 || assignMode === 'all') && (
          <div className="rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/70 dark:bg-blue-950/20 px-4 py-3">
            <p className="text-[13px] text-gray-700 dark:text-zinc-300">
              <b className="font-semibold text-blue-800 dark:text-blue-300 tabular-nums">
                {alreadyAllocatedCount} paper{alreadyAllocatedCount !== 1 ? 's' : ''} already have reviewers.
              </b>{' '}
              {newUnallocatedCount > 0
                ? <><span className="tabular-nums">{newUnallocatedCount}</span> newer paper{newUnallocatedCount !== 1 ? 's' : ''} still need them.</>
                : 'You are about to replace all of them.'}
            </p>
            <div className="flex gap-2 mt-2.5 flex-wrap">
              {newUnallocatedCount > 0 && (
              <button
                type="button"
                onClick={() => setMode('new')}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-[12px] font-semibold border transition-colors',
                  assignMode === 'new'
                    ? 'border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-400/10 text-emerald-700 dark:text-emerald-300'
                    : 'border-gray-200 dark:border-[#2a2a2a] bg-white dark:bg-[#111111] text-gray-400 dark:text-zinc-500 hover:text-gray-700 dark:hover:text-zinc-300',
                )}
              >
                Assign the <span className="tabular-nums">{newUnallocatedCount}</span> new paper{newUnallocatedCount !== 1 ? 's' : ''}
              </button>
              )}
              <button
                type="button"
                onClick={() => setMode('all')}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-[12px] font-semibold border transition-colors',
                  assignMode === 'all'
                    ? 'border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-400/10 text-amber-700 dark:text-amber-300'
                    : 'border-gray-200 dark:border-[#2a2a2a] bg-white dark:bg-[#111111] text-gray-400 dark:text-zinc-500 hover:text-gray-700 dark:hover:text-zinc-300',
                )}
              >
                Re-assign all <span className="tabular-nums">{docCount}</span> papers
              </button>
            {assignMode === 'all' && newUnallocatedCount === 0 && (
              <button
                type="button"
                onClick={() => setMode('new')}
                className="px-3 py-1.5 rounded-lg text-[12px] font-semibold border border-gray-200 dark:border-[#2a2a2a] bg-white dark:bg-[#111111] text-gray-400 dark:text-zinc-500 hover:text-gray-700 dark:hover:text-zinc-300 transition-colors"
              >
                Leave them as they are
              </button>
            )}
            </div>
            {assignMode === 'all' && (
              <p className="text-[12px] text-amber-700 dark:text-amber-400 mt-2">
                This replaces every existing reviewer pick when you press Create.
              </p>
            )}
          </div>
        )}

        {/* ── Just created ──────────────────────────────────────────────────── */}
        {successMsg && (
          <div className="flex items-center justify-between gap-3 flex-wrap rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-950/20 px-4 py-3">
            <p className="text-[13px] font-medium text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
              <Check className="h-4 w-4 flex-shrink-0" />
              {successMsg}
            </p>
            <button
              type="button"
              onClick={() => setView('allocations')}
              className="text-[12px] font-semibold text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900/60 bg-white dark:bg-[#111111] rounded-lg px-3 py-1.5 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition-colors"
            >
              View allocations →
            </button>
          </div>
        )}

        {/* ── Nothing to do ─────────────────────────────────────────────────── */}
        {targetCount === 0 && members.length >= 2 && !successMsg && (
          <div className="flex items-center justify-between gap-3 flex-wrap rounded-xl border border-gray-200 dark:border-[#1f1f1f] bg-white dark:bg-[#111111] px-4 py-3">
            <p className="text-[13px] text-gray-600 dark:text-zinc-400">
              {docCount === 0
                ? 'No papers are ready for review yet — upload and process documents first.'
                : 'Every paper has its reviewers — there is nothing to assign right now.'}
            </p>
            {docCount > 0 && (
              <button
                type="button"
                onClick={() => setMode('all')}
                className="text-[12px] font-semibold text-gray-500 dark:text-zinc-400 border border-gray-200 dark:border-[#2a2a2a] rounded-lg px-3 py-1.5 hover:text-gray-900 dark:hover:text-white transition-colors"
              >
                Start over — re-assign everything
              </button>
            )}
          </div>
        )}

        {/* ── Hard block: fewer than two members ────────────────────────────── */}
        {members.length < 2 && (
          <div className="border border-dashed border-gray-200 dark:border-[#2a2a2a] rounded-xl p-8 text-center bg-white dark:bg-[#111111]">
            <div className="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-gray-100 dark:bg-[#1a1a1a] mb-3">
              <Users className="h-5 w-5 text-gray-400" />
            </div>
            <h4 className="text-[14px] font-semibold text-gray-900 dark:text-white mb-1.5">
              You need at least two people
            </h4>
            <p className="text-[12.5px] text-gray-500 dark:text-zinc-400 max-w-sm mx-auto">
              Every paper is read twice, independently, so the two readers have to be different people.
              Invite collaborators to this project first.
            </p>
          </div>
        )}

        {showSteps && (<>

          {/* ── Step 1 — the team ──────────────────────────────────────────── */}
          <StepCard
            n={1}
            title="Pick the review team"
            sub="Two people read every paper independently. A third settles any disagreements."
          >
            {ROLE_DEFS.map(role => {
              const list = roleState[role.key];
              const eligible = members.filter(m => canTakeRole(m, role.key));
              const blockedCount = members.length - eligible.length;
              const options = eligible.filter(m => !list.some(e => e.userId === m.user_id));
              const asChips = options.length <= 6;
              const isAddOpen = openAdd === role.key;

              return (
                <div key={role.key} className="border-t border-gray-100 dark:border-[#1a1a1a] pt-3.5 mt-3.5 first:border-t-0 first:pt-0 first:mt-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <RolePill role={role.key} />
                    <span className="text-[13.5px] font-semibold text-gray-900 dark:text-white">{role.name}</span>
                    <span className="text-[12.5px] text-gray-400 dark:text-zinc-500">{role.desc}</span>
                  </div>

                  <div className="flex gap-2 flex-wrap mt-2.5">
                    {list.map(entry => {
                      const m = memberOf(entry.userId);
                      const name = memberDisplayName(m);
                      return (
                        <span
                          key={entry.userId}
                          className="inline-flex items-center gap-2 pl-1 pr-2.5 py-1 rounded-full border border-gray-200 dark:border-[#2a2a2a] bg-white dark:bg-[#141414]"
                        >
                          <ReviewerAvatar userId={entry.userId} name={name} email={m?.email} size="xs" />
                          <span className="text-[12.5px] font-medium text-gray-800 dark:text-zinc-200">{name}</span>
                          <button
                            type="button"
                            onClick={() => removePerson(role.key, entry.userId)}
                            title={`Remove ${name}`}
                            className="text-gray-300 dark:text-zinc-600 hover:text-red-500 transition-colors"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      );
                    })}

                    {asChips ? options.map(m => (
                      <button
                        key={m.user_id}
                        type="button"
                        onClick={() => addPerson(role.key, m.user_id)}
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-dashed border-gray-300 dark:border-[#3a3a3a] text-[12.5px] font-medium text-gray-500 dark:text-zinc-400 hover:border-gray-400 dark:hover:border-zinc-500 hover:text-gray-900 dark:hover:text-white transition-colors"
                      >
                        <Plus className="h-3 w-3" />
                        {memberDisplayName(m)}
                      </button>
                    )) : (
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => { setOpenAdd(isAddOpen ? null : role.key); setAddSearch(''); }}
                          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-dashed border-gray-300 dark:border-[#3a3a3a] text-[12.5px] font-medium text-gray-500 dark:text-zinc-400 hover:border-gray-400 dark:hover:border-zinc-500 hover:text-gray-900 dark:hover:text-white transition-colors"
                        >
                          <Plus className="h-3 w-3" />
                          Add person
                        </button>
                        {isAddOpen && (
                          <div className="absolute top-[calc(100%+6px)] left-0 z-40 w-[280px] bg-white dark:bg-[#141414] border border-gray-200 dark:border-[#2a2a2a] rounded-xl shadow-xl overflow-hidden">
                            <div className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-100 dark:border-[#1f1f1f]">
                              <Search className="h-3 w-3 text-gray-400 flex-shrink-0" />
                              <input
                                autoFocus
                                value={addSearch}
                                onChange={e => setAddSearch(e.target.value)}
                                placeholder="Search members…"
                                className="flex-1 bg-transparent text-[13px] text-gray-900 dark:text-white outline-none placeholder-gray-400"
                              />
                            </div>
                            <div className="max-h-56 overflow-y-auto p-1">
                              {(() => {
                                const q = addSearch.trim().toLowerCase();
                                const shown = options.filter(m =>
                                  !q || memberDisplayName(m).toLowerCase().includes(q) || (m.email || '').toLowerCase().includes(q));
                                if (!shown.length) {
                                  return <p className="text-center text-[12.5px] text-gray-400 py-5">No members found</p>;
                                }
                                return shown.map(m => (
                                  <button
                                    key={m.user_id}
                                    type="button"
                                    onClick={() => addPerson(role.key, m.user_id)}
                                    className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-[#1f1f1f] text-left transition-colors"
                                  >
                                    <ReviewerAvatar userId={m.user_id} name={memberDisplayName(m)} email={m.email} size="sm" />
                                    <span className="min-w-0">
                                      <span className="block text-[12.5px] font-medium text-gray-800 dark:text-zinc-200 truncate">
                                        {memberDisplayName(m)}
                                      </span>
                                      <span className="block text-[11px] text-gray-400 truncate">{m.email}</span>
                                    </span>
                                  </button>
                                ));
                              })()}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {list.length === 0 && (
                    <p className="text-[12px] text-amber-600 dark:text-amber-400 mt-2">Add at least one person.</p>
                  )}
                  {blockedCount > 0 && (
                    <p className="text-[11.5px] text-gray-400 dark:text-zinc-500 mt-2">
                      {blockedCount} member{blockedCount !== 1 ? 's' : ''} can&apos;t take this role — they {role.blockedHint}.
                      A project manager can change that under Members.
                    </p>
                  )}
                </div>
              );
            })}

            {conflictR1R2 && (
              <div className="rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50/70 dark:bg-red-950/20 px-3.5 py-2.5 mt-3.5">
                <p className="text-[12.5px] text-red-800 dark:text-red-300">
                  <b className="font-semibold">The same person can&apos;t read a paper twice.</b>{' '}
                  {blindConflictCount > 0 && [...r1Users].every(u => !r2Users.has(u))
                    ? `${blindConflictCount} paper${blindConflictCount !== 1 ? 's' : ''} would land on one person as both readers — change the split in step 2.`
                    : 'Pick different people for the two reader roles.'}{' '}
                  This one cannot be overridden.
                </p>
              </div>
            )}

            {consOverlap && (
              <div className="rounded-lg border border-gray-200 dark:border-[#2a2a2a] bg-gray-50 dark:bg-[#0d0d0d] px-3.5 py-2.5 mt-3.5">
                <p className="text-[12.5px] text-gray-600 dark:text-zinc-400">
                  Your consensus reviewer is also one of the readers, so they&apos;ll see both reviews when settling disagreements.
                </p>
                <label className="inline-flex items-center gap-2 mt-1.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={override}
                    onChange={e => setOverride(e.target.checked)}
                    className="w-3.5 h-3.5 accent-gray-900 dark:accent-white cursor-pointer"
                  />
                  <span className="text-[12.5px] text-gray-700 dark:text-zinc-300">That&apos;s fine — allow it</span>
                </label>
              </div>
            )}
          </StepCard>

          {/* ── Step 2 — the split ─────────────────────────────────────────── */}
          <StepCard
            n={2}
            title="Split the papers"
            sub="Papers are split evenly by default. Adjust if someone should take more or fewer."
          >
            {ROLE_DEFS.every(r => roleState[r.key].length === 0) ? (
              <p className="text-[12.5px] text-gray-400 dark:text-zinc-500 mt-3">Add people in step 1 first.</p>
            ) : ROLE_DEFS.map(role => {
              const list = roleState[role.key];
              if (!list.length) return null;
              const total     = roleTotal(role.key);
              const remaining = targetCount - total;
              const multi     = list.length > 1;

              return (
                <div key={role.key} className="border-t border-gray-100 dark:border-[#1a1a1a] pt-3.5 mt-3.5">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <RolePill role={role.key} />
                      <span className="text-[13px] font-semibold text-gray-900 dark:text-white">{role.name}</span>
                    </div>
                    {multi && (
                      <button
                        type="button"
                        onClick={() => setRole(role.key, balanceEntries(list, targetCount))}
                        className="text-[11.5px] font-semibold text-gray-500 dark:text-zinc-400 border border-gray-200 dark:border-[#2a2a2a] rounded-lg px-2.5 py-1 hover:text-gray-900 dark:hover:text-white transition-colors"
                      >
                        Split evenly
                      </button>
                    )}
                  </div>

                  {multi && (
                    <div className="h-1.5 rounded-full bg-gray-100 dark:bg-[#1a1a1a] overflow-hidden flex mt-2.5">
                      {list.map((e, i) => (
                        <div
                          key={e.userId}
                          className={cn('h-full transition-all', role.dot, SEGMENT_FADE[i % SEGMENT_FADE.length])}
                          style={{ width: `${targetCount ? (e.share / targetCount) * 100 : 0}%` }}
                        />
                      ))}
                    </div>
                  )}

                  {list.map(entry => {
                    const m = memberOf(entry.userId);
                    const name = memberDisplayName(m);
                    const pct = targetCount ? Math.round((entry.share / targetCount) * 100) : 0;
                    return (
                      <div
                        key={entry.userId}
                        className="grid items-center gap-3 py-2"
                        style={{ gridTemplateColumns: '1fr auto auto' }}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <ReviewerAvatar userId={entry.userId} name={name} email={m?.email} size="sm" />
                          <span className="text-[13px] font-medium text-gray-800 dark:text-zinc-200 truncate">{name}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {multi && (
                            <button
                              type="button"
                              onClick={() => stepShare(role.key, entry.userId, -1)}
                              disabled={entry.share <= 0}
                              className="w-6 h-6 flex items-center justify-center rounded-md border border-gray-200 dark:border-[#2a2a2a] text-gray-500 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                            >
                              <Minus className="h-3 w-3" />
                            </button>
                          )}
                          <span className="text-[12.5px] font-semibold text-gray-800 dark:text-zinc-200 tabular-nums min-w-[72px] text-center">
                            {entry.share} paper{entry.share !== 1 ? 's' : ''}
                          </span>
                          {multi && (
                            <button
                              type="button"
                              onClick={() => stepShare(role.key, entry.userId, 1)}
                              disabled={remaining <= 0}
                              className="w-6 h-6 flex items-center justify-center rounded-md border border-gray-200 dark:border-[#2a2a2a] text-gray-500 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                            >
                              <Plus className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                        <span className="text-[11.5px] font-medium text-gray-400 dark:text-zinc-500 tabular-nums w-9 text-right">
                          {pct}%
                        </span>
                      </div>
                    );
                  })}

                  {remaining > 0 && (
                    <p className="text-[12px] font-medium text-amber-600 dark:text-amber-400">
                      <span className="tabular-nums">{remaining}</span> of {targetCount} papers still unassigned — press + or Split evenly.
                    </p>
                  )}
                  {remaining < 0 && (
                    <p className="text-[12px] font-medium text-red-600 dark:text-red-400">
                      Over-allocated by <span className="tabular-nums">{-remaining}</span> papers.
                    </p>
                  )}
                  {remaining === 0 && (
                    <p className="text-[12px] font-medium text-emerald-600 dark:text-emerald-400">
                      ✓ All {targetCount} papers covered
                    </p>
                  )}
                </div>
              );
            })}
          </StepCard>

          {/* ── Step 3 — confirm ───────────────────────────────────────────── */}
          <StepCard
            n={3}
            title="Confirm and create"
            sub={
              <>
                Each of the three roles covers <span className="tabular-nums">{targetCount}</span> paper{targetCount !== 1 ? 's' : ''} ×{' '}
                <span className="tabular-nums">{formCount}</span> form{formCount !== 1 ? 's' : ''} ={' '}
                <b className="font-semibold text-gray-900 dark:text-white tabular-nums">{targetCount * formCount} form completions</b>.
              </>
            }
          >
            {formCount === 0 && (
              <p className="text-[12.5px] font-medium text-amber-600 dark:text-amber-400 mb-3">
                This project has no active form yet, so reviewers will have nothing to fill in. You can still allocate the papers.
              </p>
            )}
            {readiness.msg && (
              <p className="text-[12.5px] font-medium text-amber-600 dark:text-amber-400 mb-3">{readiness.msg}</p>
            )}
            <button
              type="button"
              onClick={handleSubmitClick}
              disabled={!readiness.ready || assigning}
              className={cn(
                'inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-[13px] font-semibold transition-colors',
                readiness.ready
                  ? 'bg-gray-900 dark:bg-white text-white dark:text-black hover:bg-gray-700 dark:hover:bg-zinc-100'
                  : 'bg-gray-100 dark:bg-[#1a1a1a] text-gray-400 dark:text-zinc-600 cursor-not-allowed',
                assigning && 'opacity-60',
              )}
            >
              {assigning && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Create <span className="tabular-nums">{targetCount * ROLE_DEFS.length}</span> assignments
            </button>
          </StepCard>
        </>)}

        {/* ── Reviewer privacy ──────────────────────────────────────────────── */}
        <section className="border border-gray-200 dark:border-[#1f1f1f] rounded-xl bg-white dark:bg-[#111111] overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 dark:border-[#1f1f1f]">
            <h3 className="text-[13.5px] font-semibold text-gray-900 dark:text-white">Reviewer privacy</h3>
            <p className="text-[12.5px] text-gray-400 dark:text-zinc-500 mt-0.5 leading-relaxed">
              Applies to the whole project. Tie-breakers and project managers always see everything.
            </p>
          </div>

          <PrivacyToggle
            label="Blind the two readers to each other"
            description="Reviewer 1 and Reviewer 2 can't see each other's answers until both have finished."
            checked={blindReaders}
            saving={savingPrivacyKey === 'blinding'}
            disabled={savingPrivacyKey !== null}
            onChange={v => savePrivacy('blinding', { blinding: v ? 'partial' : 'none' })}
          />
          <PrivacyToggle
            label="Hide AI results from reviewers"
            description="Reviewers extract with no AI answers visible anywhere."
            checked={hideAiFromReviewers}
            saving={savingPrivacyKey === 'hide_ai_results'}
            disabled={savingPrivacyKey !== null}
            onChange={v => savePrivacy('hide_ai_results', { hide_ai_results: v })}
            last
          />
        </section>

        {/* ── Confirm re-assign everything ──────────────────────────────────── */}
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
              <h3 className="text-[14px] font-semibold text-gray-900 dark:text-white mb-1">Replace the existing picks?</h3>
              <p className="text-[12.5px] text-gray-500 dark:text-zinc-400 mb-5 leading-relaxed">
                <strong className="text-gray-700 dark:text-zinc-200 tabular-nums">{alreadyAllocatedCount}</strong> paper
                {alreadyAllocatedCount !== 1 ? 's' : ''} already have reviewers, and this replaces every one of those picks.
                Answers reviewers have already saved are kept.
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setConfirmReassign(false)}
                  className="flex-1 px-4 py-2 rounded-lg border border-gray-200 dark:border-[#2a2a2a] text-[12.5px] font-medium text-gray-600 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] transition-colors">
                  Cancel
                </button>
                <button type="button" onClick={doSubmit} disabled={assigning}
                  className="flex-1 px-4 py-2 rounded-lg bg-gray-900 dark:bg-white text-white dark:text-black text-[12.5px] font-semibold hover:bg-gray-700 dark:hover:bg-zinc-100 disabled:opacity-40 transition-colors flex items-center justify-center gap-2">
                  {assigning && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Yes, re-assign
                </button>
              </div>
            </div>
          </div>
        )}
      </>)}
    </div>
    </PermissionGate>
  );
}

// ─── Reviewer-privacy switch row ──────────────────────────────────────────────

function PrivacyToggle({
  label, description, checked, onChange, saving, disabled, last,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  saving: boolean;
  disabled: boolean;
  last?: boolean;
}) {
  return (
    <div className={cn(
      'flex items-start justify-between gap-6 px-5 py-4',
      !last && 'border-b border-gray-100 dark:border-[#1f1f1f]',
    )}>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium text-gray-900 dark:text-white">{label}</p>
        <p className="text-[12.5px] text-gray-400 dark:text-zinc-500 mt-0.5 leading-relaxed">{description}</p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0 pt-0.5">
        {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-300 dark:text-zinc-600" />}
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-label={label}
          disabled={disabled}
          onClick={() => onChange(!checked)}
          className={cn(
            'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            checked ? 'bg-emerald-600 dark:bg-emerald-500' : 'bg-gray-200 dark:bg-[#2a2a2a]',
          )}
        >
          <span
            className="inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform"
            style={{ transform: checked ? 'translateX(18px)' : 'translateX(2px)' }}
          />
        </button>
      </div>
    </div>
  );
}

// ─── Step card ────────────────────────────────────────────────────────────────

function StepCard({
  n, title, sub, children,
}: {
  n: number;
  title: string;
  sub: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="border border-gray-200 dark:border-[#1f1f1f] rounded-xl bg-white dark:bg-[#111111] p-5">
      <div className="flex items-start gap-3">
        <span className="w-[22px] h-[22px] mt-px rounded-full bg-gray-900 dark:bg-white text-white dark:text-black text-[11px] font-semibold inline-flex items-center justify-center flex-shrink-0">
          {n}
        </span>
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold text-gray-900 dark:text-white">{title}</h3>
          <p className="text-[12.5px] text-gray-400 dark:text-zinc-500 mt-0.5">{sub}</p>
        </div>
      </div>
      <div className="mt-3.5">{children}</div>
    </section>
  );
}

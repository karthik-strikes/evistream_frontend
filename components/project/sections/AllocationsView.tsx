'use client';

/**
 * Allocations — who is reading what.
 *
 * This is the container for both perspectives: the by-reviewer list lives here,
 * the by-paper grid is `AllocationsByPaperView`. Both read the same fetch and
 * the same search / status filter, because they used to each load their own copy
 * of the project's assignments and each carry their own search box, so the two
 * tabs disagreed about what was on screen.
 *
 * Edits apply immediately and offer an Undo. The previous version queued changes
 * behind a Save button in one view and applied them instantly in the other; a
 * queue that spans a tab switch is a queue people lose.
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Search, Loader2, Users, Trash2, AlertTriangle, X, ChevronRight, Undo2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { assignmentsService, documentsService, projectMembersService } from '@/services';
import type { ReviewAssignment, Document, ProjectMember } from '@/types/api';
import { useToast } from '@/hooks/use-toast';
import { buildLabelMap } from '@/lib/documentLabel';
import { useTagFilter } from '@/hooks/useTagFilter';
import { docMatchesQuery } from '@/lib/documentTags';
import { TagFilterBar } from '@/components/documents/DocumentTags';
import { AllocationsByPaperView } from './AllocationsByPaperView';
import {
  ROLE_DEFS, ROLE_BY_KEY, RolePill, SegGroup, SegButton, StatTiles, StatusPill,
  ReviewerAvatar, memberDisplayName, canTakeRole,
  type ReviewerRoleKey, type PaperStatusKey, type StatusFilter,
} from './allocationShared';

export type { StatusFilter };

// ─── Types ────────────────────────────────────────────────────────────────────

/** One reviewer change. `userId: null` clears the cell. */
export interface Move {
  docId: string;
  role: ReviewerRoleKey;
  userId: string | null;
}

interface Note {
  bad: boolean;
  text: string;
  /** Inverse moves, present only when the change can be taken back. */
  undo?: Move[];
}

interface ReviewerRow {
  key: string;
  userId: string;
  role: ReviewerRoleKey;
  name: string;
  email?: string;
  total: number;
  done: number;
  unfinished: number;
  pct: number;
  /** Papers left after search / status / tag filters. */
  papers: ReviewAssignment[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function cellKey(docId: string, role: ReviewerRoleKey) {
  return `${docId}:${role}`;
}

function errorDetail(err: unknown, fallback: string): string {
  return (
    (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
    (err as Error)?.message ||
    fallback
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function AllocationsView({
  projectId,
  onSwitchToCreate,
}: {
  projectId: string;
  onSwitchToCreate: () => void;
}) {
  const { toast } = useToast();
  const containerRef = useRef<HTMLDivElement>(null);

  const [loading, setLoading]         = useState(true);
  const [documents, setDocuments]     = useState<Document[]>([]);
  const [assignments, setAssignments] = useState<ReviewAssignment[]>([]);
  const [members, setMembers]         = useState<ProjectMember[]>([]);

  const [view, setView]                 = useState<'by-reviewer' | 'by-paper'>('by-reviewer');
  const [search, setSearch]             = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const { activeTags, toggleTag, clearTags, matchesTags } = useTagFilter();

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [bulkOpen, setBulkOpen] = useState<string | null>(null);
  const [note, setNote]         = useState<Note | null>(null);
  const [busy, setBusy]         = useState(false);

  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [confirmClearRow, setConfirmClearRow] = useState<ReviewerRow | null>(null);
  const [clearing, setClearing] = useState<string | null>(null);

  // ── Load ──────────────────────────────────────────────────────────────────

  const reload = useCallback(async () => {
    setLoading(true);
    const [docs, asg, mem] = await Promise.allSettled([
      documentsService.getAll(projectId),
      assignmentsService.getProjectAssignments(projectId),
      projectMembersService.listMembers(projectId),
    ]);
    setDocuments(docs.status === 'fulfilled' ? (docs.value as Document[]) : []);
    setAssignments(asg.status === 'fulfilled' ? asg.value : []);
    setMembers(mem.status === 'fulfilled' ? mem.value : []);
    if (docs.status === 'rejected' || asg.status === 'rejected' || mem.status === 'rejected') {
      toast({ title: 'Error', description: 'Some allocation data failed to load.', variant: 'error' });
    }
    setLoading(false);
  }, [projectId, toast]);

  useEffect(() => { reload(); }, [reload]);

  const refreshAssignments = useCallback(async () => {
    try {
      setAssignments(await assignmentsService.getProjectAssignments(projectId));
    } catch {
      /* the optimistic state stands until the next full reload */
    }
  }, [projectId]);

  // Close the open "Move all…" menu on an outside click.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setBulkOpen(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Indexes ───────────────────────────────────────────────────────────────

  const labels = useMemo(() => buildLabelMap(documents), [documents]);

  const memberById = useMemo(() => {
    const m = new Map<string, ProjectMember>();
    for (const x of members) m.set(x.user_id, x);
    return m;
  }, [members]);

  const cells = useMemo(() => {
    const m = new Map<string, ReviewAssignment>();
    for (const a of assignments) m.set(cellKey(a.document_id, a.reviewer_role), a);
    return m;
  }, [assignments]);

  const docById = useMemo(() => {
    const m = new Map<string, Document>();
    for (const d of documents) m.set(d.id, d);
    return m;
  }, [documents]);

  /**
   * The papers this screen is about: everything ready for review, plus anything
   * that already carries an assignment. Filtering to `completed` alone made
   * rows silently vanish when a paper was re-parsed after being allocated.
   */
  const papers = useMemo(() => {
    const assigned = new Set(assignments.map(a => a.document_id));
    return documents.filter(d => d.processing_status === 'completed' || assigned.has(d.id));
  }, [documents, assignments]);

  const formsPerPaper = useMemo(
    () => assignments.reduce((max, a) => Math.max(max, a.forms_total ?? 0), 0),
    [assignments],
  );

  const paperStatus = useCallback((docId: string): PaperStatusKey => {
    const mine = ROLE_DEFS.map(r => cells.get(cellKey(docId, r.key)));
    if (mine.some(a => !a)) return 'unassigned';
    const states = mine.map(a => a!.status);
    if (states.every(s => s === 'completed')) return 'completed';
    if (states.some(s => s !== 'pending')) return 'in_progress';
    return 'pending';
  }, [cells]);

  // ── Stats ─────────────────────────────────────────────────────────────────

  const stats = useMemo(() => {
    let assigned = 0, completed = 0, inProgress = 0;
    for (const d of papers) {
      const s = paperStatus(d.id);
      if (s !== 'unassigned') assigned++;
      if (s === 'completed') completed++;
      if (s === 'in_progress') inProgress++;
    }
    return {
      reviewers: new Set(assignments.map(a => a.reviewer_user_id)).size,
      assigned, completed, inProgress, total: papers.length,
    };
  }, [papers, assignments, paperStatus]);

  // ── Mutations ─────────────────────────────────────────────────────────────

  const optimistic = useCallback((list: ReviewAssignment[], moves: Move[]): ReviewAssignment[] => {
    let out = list;
    for (const m of moves) {
      const idx = out.findIndex(a => a.document_id === m.docId && a.reviewer_role === m.role);
      if (m.userId == null) {
        if (idx >= 0) out = [...out.slice(0, idx), ...out.slice(idx + 1)];
        continue;
      }
      const base = idx >= 0 ? out[idx] : null;
      const row: ReviewAssignment = {
        id: base?.id ?? `optimistic:${m.docId}:${m.role}`,
        project_id: projectId,
        document_id: m.docId,
        reviewer_role: m.role,
        reviewer_user_id: m.userId,
        // A move hands the paper to someone who has not started it.
        status: 'pending',
        assigned_by: base?.assigned_by ?? null,
        assigned_at: base?.assigned_at ?? new Date().toISOString(),
        started_at: null,
        completed_at: null,
        is_training: base?.is_training ?? false,
        document_filename: base?.document_filename ?? docById.get(m.docId)?.filename,
        document_label: base?.document_label ?? labels[m.docId],
        reviewer_name: memberDisplayName(memberById.get(m.userId)),
        forms_completed: 0,
        forms_total: base?.forms_total ?? formsPerPaper,
      };
      out = idx >= 0 ? out.map((a, i) => (i === idx ? row : a)) : [...out, row];
    }
    return out;
  }, [projectId, docById, labels, memberById, formsPerPaper]);

  const applyMoves = useCallback(async (
    moves: Move[],
    text: string,
    opts: { undoable?: boolean } = { undoable: true },
  ) => {
    if (!moves.length || busy) return;

    // The inverse, captured before anything changes.
    const undo: Move[] = moves.map(m => {
      const cur = cells.get(cellKey(m.docId, m.role));
      return { docId: m.docId, role: m.role, userId: cur?.reviewer_user_id ?? null };
    });
    const before = assignments;

    setBusy(true);
    setAssignments(prev => optimistic(prev, moves));
    try {
      const upserts = moves.filter(m => m.userId);
      if (upserts.length) {
        await assignmentsService.bulkCreate({
          project_id: projectId,
          assignments: upserts.map(m => ({
            document_id: m.docId,
            reviewer_user_id: m.userId!,
            reviewer_role: m.role,
          })),
        });
      }
      for (const m of moves.filter(x => !x.userId)) {
        const row = before.find(a => a.document_id === m.docId && a.reviewer_role === m.role);
        if (row && !row.id.startsWith('optimistic:')) await assignmentsService.deleteAssignment(row.id);
      }
      setNote({ bad: false, text, undo: opts.undoable ? undo : undefined });
      await refreshAssignments();
    } catch (err) {
      setAssignments(before);
      setNote({ bad: true, text: errorDetail(err, 'Could not save that change.') });
    } finally {
      setBusy(false);
    }
  }, [assignments, busy, cells, optimistic, projectId, refreshAssignments]);

  /** One cell. Rejects the two things the backend would reject, with the reason. */
  const move = useCallback((docId: string, role: ReviewerRoleKey, userId: string | null) => {
    const label = labels[docId] || docById.get(docId)?.filename || 'this paper';
    const def = ROLE_BY_KEY[role];

    if (userId) {
      const member = memberById.get(userId);
      const name = memberDisplayName(member);
      if (role !== 'adjudicator') {
        const otherRole: ReviewerRoleKey = role === 'reviewer_1' ? 'reviewer_2' : 'reviewer_1';
        if (cells.get(cellKey(docId, otherRole))?.reviewer_user_id === userId) {
          setNote({ bad: true, text: `${name} already reads “${label}” as the other reviewer — pick someone else.` });
          return;
        }
      }
      if (!canTakeRole(member, role)) {
        setNote({ bad: true, text: `${name} cannot take the ${def.name} role — they are missing that permission on this project.` });
        return;
      }
      applyMoves([{ docId, role, userId }], `“${label}” moved to ${name} (${def.tag}).`);
    } else {
      applyMoves([{ docId, role, userId: null }], `${def.tag} removed from “${label}”.`);
    }
  }, [applyMoves, cells, docById, labels, memberById]);

  /** Hand every unfinished paper in one (reviewer, role) to someone else. */
  const bulkMove = useCallback((row: ReviewerRow, toUserId: string) => {
    const to = memberById.get(toUserId);
    const toName = memberDisplayName(to);
    setBulkOpen(null);

    if (!canTakeRole(to, row.role)) {
      setNote({ bad: true, text: `${toName} cannot take the ${ROLE_BY_KEY[row.role].name} role — they are missing that permission on this project.` });
      return;
    }

    const mine = assignments.filter(a => a.reviewer_user_id === row.userId && a.reviewer_role === row.role);
    const moves: Move[] = [];
    let finished = 0, clash = 0;
    for (const a of mine) {
      if (a.status === 'completed') { finished++; continue; }
      if (row.role !== 'adjudicator') {
        const otherRole: ReviewerRoleKey = row.role === 'reviewer_1' ? 'reviewer_2' : 'reviewer_1';
        if (cells.get(cellKey(a.document_id, otherRole))?.reviewer_user_id === toUserId) { clash++; continue; }
      }
      moves.push({ docId: a.document_id, role: row.role, userId: toUserId });
    }

    if (!moves.length) {
      setNote({
        bad: true,
        text: clash
          ? `Nothing to move — ${toName} already reads those papers as the other reviewer.`
          : `Nothing to move — ${row.name} has no unfinished papers in this role.`,
      });
      return;
    }
    applyMoves(
      moves,
      `${moves.length} unfinished paper${moves.length !== 1 ? 's' : ''} moved from ${row.name} to ${toName}.`
        + (clash ? ` ${clash} stayed — ${toName} already reads them as the other reviewer.` : '')
        + (finished ? ` ${finished} already finished and stayed put.` : ''),
    );
  }, [applyMoves, assignments, cells, memberById]);

  const undoNote = useCallback(() => {
    if (!note?.undo) return;
    applyMoves(note.undo, 'Change undone.', { undoable: false });
  }, [applyMoves, note]);

  const clearAll = async () => {
    setClearing('all');
    try {
      const { deleted } = await assignmentsService.clearAssignments(projectId);
      setAssignments([]);
      setConfirmClearAll(false);
      setNote({ bad: false, text: `${deleted} allocation${deleted !== 1 ? 's' : ''} cleared.` });
    } catch (err) {
      toast({ title: 'Error', description: errorDetail(err, 'Failed to clear allocations'), variant: 'error' });
    } finally { setClearing(null); }
  };

  const clearRow = async (row: ReviewerRow) => {
    setClearing(row.key);
    try {
      await assignmentsService.clearAssignments(projectId, row.userId, row.role);
      setAssignments(prev => prev.filter(a => !(a.reviewer_user_id === row.userId && a.reviewer_role === row.role)));
      setConfirmClearRow(null);
      setNote({ bad: false, text: `${row.name} removed from ${ROLE_BY_KEY[row.role].name} on ${row.total} paper${row.total !== 1 ? 's' : ''}.` });
    } catch (err) {
      toast({ title: 'Error', description: errorDetail(err, 'Failed to remove reviewer'), variant: 'error' });
    } finally { setClearing(null); }
  };

  // ── By-reviewer rows ──────────────────────────────────────────────────────

  const q = search.trim().toLowerCase();
  const filtersActive = !!q || statusFilter !== 'all' || activeTags.length > 0;

  const paperPasses = useCallback((a: ReviewAssignment, nameMatches: boolean) => {
    const doc = docById.get(a.document_id);
    const docLabel = a.document_label || labels[a.document_id] || a.document_filename || '';
    if (!matchesTags(doc?.labels ?? [])) return false;
    if (q && !nameMatches && !docMatchesQuery(docLabel, doc?.labels ?? [], search)) return false;
    if (statusFilter !== 'all' && statusFilter !== 'unassigned' && a.status !== statusFilter) return false;
    if (statusFilter === 'unassigned') return false;   // an assignment always has a reviewer
    return true;
  }, [docById, labels, matchesTags, q, search, statusFilter]);

  const reviewerRows = useMemo(() => {
    const rows: ReviewerRow[] = [];
    for (const role of ROLE_DEFS) {
      const byUser = new Map<string, ReviewAssignment[]>();
      for (const a of assignments) {
        if (a.reviewer_role !== role.key) continue;
        if (!byUser.has(a.reviewer_user_id)) byUser.set(a.reviewer_user_id, []);
        byUser.get(a.reviewer_user_id)!.push(a);
      }
      byUser.forEach((list, userId) => {
        const member = memberById.get(userId);
        const name = member ? memberDisplayName(member) : (list[0].reviewer_name || 'Unknown');
        const nameMatches = !q || name.toLowerCase().includes(q);
        const done = list.filter(a => a.status === 'completed').length;
        rows.push({
          key: `${userId}|${role.key}`,
          userId, role: role.key, name, email: member?.email,
          total: list.length, done,
          unfinished: list.length - done,
          pct: list.length ? Math.round((done / list.length) * 100) : 0,
          papers: list
            .filter(a => paperPasses(a, nameMatches))
            .sort((a, b) =>
              (a.document_label || a.document_filename || '').localeCompare(b.document_label || b.document_filename || '')),
        });
      });
    }
    return rows.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name) || a.role.localeCompare(b.role));
  }, [assignments, memberById, paperPasses, q]);

  const visibleRows = useMemo(() => reviewerRows.filter(r => {
    if (!filtersActive) return true;
    if (r.papers.length > 0) return true;
    // A name search still shows the person, so you can see they have nothing left.
    return !!q && r.name.toLowerCase().includes(q) && statusFilter === 'all' && activeTags.length === 0;
  }), [reviewerRows, filtersActive, q, statusFilter, activeTags]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  const statusButtons: { key: StatusFilter; label: string }[] = view === 'by-paper'
    ? [
        { key: 'all',         label: 'All' },
        { key: 'unassigned',  label: 'Needs reviewers' },
        { key: 'pending',     label: 'Pending' },
        { key: 'in_progress', label: 'In progress' },
        { key: 'completed',   label: 'Completed' },
      ]
    : [
        { key: 'all',         label: 'All' },
        { key: 'pending',     label: 'Pending' },
        { key: 'in_progress', label: 'In progress' },
        { key: 'completed',   label: 'Completed' },
        ...(assignments.some(a => a.status === 'skipped') ? [{ key: 'skipped' as StatusFilter, label: 'Skipped' }] : []),
      ];

  return (
    <div ref={containerRef} className="space-y-4">

      {/* ── Stat tiles ───────────────────────────────────────────────────────── */}
      <StatTiles tiles={[
        { label: 'Reviewers', value: stats.reviewers, sub: 'with papers' },
        {
          label: 'Papers assigned',
          value: (
            <>
              {stats.assigned}
              <span className="text-[13px] font-medium text-gray-400 dark:text-zinc-500"> / {stats.total}</span>
            </>
          ),
          sub: 'all three roles filled',
        },
        { label: 'Completed',   value: stats.completed,  sub: 'papers fully done',  tone: 'emerald' },
        { label: 'In progress', value: stats.inProgress, sub: 'being reviewed now', tone: 'blue' },
      ]} />

      {/* ── Toolbar ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-2 border border-gray-200 dark:border-[#2a2a2a] rounded-lg px-3 py-1.5 bg-white dark:bg-[#0d0d0d] flex-1 min-w-[220px]">
          <Search className="h-3 w-3 text-gray-400 flex-shrink-0" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={view === 'by-paper' ? 'Search papers, reviewers or tags…' : 'Search reviewer or paper…'}
            className="flex-1 bg-transparent text-[12.5px] text-gray-900 dark:text-white outline-none placeholder-gray-400"
          />
          {search && (
            <button type="button" onClick={() => setSearch('')} className="text-gray-300 dark:text-zinc-600 hover:text-gray-500">
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        <SegGroup>
          {statusButtons.map(b => (
            <SegButton key={b.key} active={statusFilter === b.key} onClick={() => setStatusFilter(b.key)}>
              {b.label}
            </SegButton>
          ))}
        </SegGroup>

        <SegGroup>
          {/* Each perspective offers one status the other cannot honour, so a
              filter that would hide every row is dropped on the way across. */}
          <SegButton active={view === 'by-reviewer'} onClick={() => {
            setView('by-reviewer');
            if (statusFilter === 'unassigned') setStatusFilter('all');
          }}>By reviewer</SegButton>
          <SegButton active={view === 'by-paper'} onClick={() => {
            setView('by-paper');
            if (statusFilter === 'skipped') setStatusFilter('all');
          }}>By paper</SegButton>
        </SegGroup>

        <button
          type="button"
          onClick={() => setConfirmClearAll(true)}
          disabled={assignments.length === 0}
          className="flex items-center gap-1.5 text-[12px] font-medium text-gray-400 dark:text-zinc-500 border border-gray-200 dark:border-[#2a2a2a] rounded-lg px-2.5 py-1.5 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] hover:text-red-500 dark:hover:text-red-400 hover:border-red-200 dark:hover:border-red-900/50 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
        >
          <Trash2 className="h-3 w-3" />
          Clear all
        </button>
      </div>

      <TagFilterBar activeTags={activeTags} onToggleTag={toggleTag} onClear={clearTags} />

      {/* ── Change note with Undo ────────────────────────────────────────────── */}
      {note && (
        <div className={cn(
          'flex items-center justify-between gap-3 rounded-xl border px-4 py-2.5',
          note.bad
            ? 'border-red-200 dark:border-red-900/60 bg-red-50/70 dark:bg-red-950/20'
            : 'border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-950/20',
        )}>
          <p className={cn(
            'text-[12.5px] font-medium',
            note.bad ? 'text-red-700 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-300',
          )}>
            {note.text}
          </p>
          <div className="flex items-center gap-2 flex-shrink-0">
            {note.undo && (
              <button
                type="button"
                onClick={undoNote}
                disabled={busy}
                className="flex items-center gap-1.5 text-[11.5px] font-semibold text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900/60 bg-white dark:bg-[#111111] rounded-lg px-2.5 py-1 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 disabled:opacity-40 transition-colors"
              >
                <Undo2 className="h-3 w-3" />
                Undo
              </button>
            )}
            <button
              type="button"
              onClick={() => setNote(null)}
              className={cn('p-1', note.bad ? 'text-red-400 hover:text-red-600' : 'text-emerald-500 hover:text-emerald-700')}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* ── By paper ─────────────────────────────────────────────────────────── */}
      {view === 'by-paper' && (
        <AllocationsByPaperView
          papers={papers}
          labels={labels}
          cells={cells}
          members={members}
          search={search}
          statusFilter={statusFilter}
          activeTags={activeTags}
          onToggleTag={toggleTag}
          matchesTags={matchesTags}
          paperStatus={paperStatus}
          formsPerPaper={formsPerPaper}
          busy={busy}
          onMove={move}
        />
      )}

      {/* ── By reviewer ──────────────────────────────────────────────────────── */}
      {view === 'by-reviewer' && (
        assignments.length === 0 ? (
          <div className="border border-dashed border-gray-200 dark:border-[#2a2a2a] rounded-xl p-8 text-center bg-white dark:bg-[#111111]">
            <div className="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-gray-100 dark:bg-[#1a1a1a] mb-3">
              <Users className="h-5 w-5 text-gray-400" />
            </div>
            <h4 className="text-[14px] font-semibold text-gray-900 dark:text-white mb-1.5">No reviewers assigned yet</h4>
            <p className="text-[12.5px] text-gray-500 dark:text-zinc-400 max-w-sm mx-auto mb-3">
              Pick the review team on the Set up tab and every paper gets its two readers and a tie-breaker.
            </p>
            <button type="button" onClick={onSwitchToCreate}
              className="text-[12.5px] font-medium text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200 transition-colors">
              Go to Set up →
            </button>
          </div>
        ) : (
          <div className="border border-gray-200 dark:border-[#1f1f1f] rounded-xl bg-white dark:bg-[#111111] overflow-hidden">
            {visibleRows.length === 0 && (
              <p className="text-center text-[12.5px] text-gray-400 dark:text-zinc-500 py-10">
                No reviewers match your search.
              </p>
            )}
            {visibleRows.map((row, i) => {
              const isOpen = filtersActive ? row.papers.length > 0 : !!expanded[row.key];
              const menuOpen = bulkOpen === row.key;
              return (
                <div key={row.key} className={cn(i > 0 && 'border-t border-gray-100 dark:border-[#1a1a1a]')}>

                  {/* Reviewer row */}
                  <div
                    onClick={() => setExpanded(s => ({ ...s, [row.key]: !isOpen }))}
                    className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none hover:bg-gray-50 dark:hover:bg-[#0d0d0d] transition-colors"
                  >
                    <ReviewerAvatar userId={row.userId} name={row.name} email={row.email} size="md" />

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13.5px] font-semibold text-gray-900 dark:text-white truncate">{row.name}</span>
                        <RolePill role={row.role} />
                      </div>
                      <div className="text-[11.5px] text-gray-400 dark:text-zinc-500">
                        <span className="tabular-nums">{row.total}</span> paper{row.total !== 1 ? 's' : ''} · {ROLE_BY_KEY[row.role].name}
                      </div>
                    </div>

                    <div className="hidden sm:flex items-center gap-3 flex-shrink-0">
                      <div className="w-[110px] h-[5px] rounded-full bg-gray-100 dark:bg-[#1a1a1a] overflow-hidden">
                        <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${row.pct}%` }} />
                      </div>
                      <span className="text-[11.5px] font-medium text-gray-500 dark:text-zinc-400 tabular-nums whitespace-nowrap">
                        {row.done}/{row.total} done
                      </span>
                      <span className={cn(
                        'text-[11.5px] font-medium tabular-nums w-9 text-right',
                        row.pct === 100 ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400 dark:text-zinc-500',
                      )}>
                        {row.pct}%
                      </span>
                    </div>

                    {/* Move all… */}
                    <div className="relative flex-shrink-0">
                      <button
                        type="button"
                        title={`Move ${row.name}'s unfinished papers to someone else`}
                        onClick={e => { e.stopPropagation(); setBulkOpen(menuOpen ? null : row.key); }}
                        className="text-[11px] font-semibold text-gray-500 dark:text-zinc-400 border border-gray-200 dark:border-[#2a2a2a] rounded-lg px-2.5 py-1 whitespace-nowrap hover:text-gray-900 dark:hover:text-white hover:border-gray-300 dark:hover:border-[#3a3a3a] transition-colors"
                      >
                        Move all…
                      </button>
                      {menuOpen && (
                        <div
                          onClick={e => e.stopPropagation()}
                          className="absolute top-[calc(100%+4px)] right-0 z-40 min-w-[250px] bg-white dark:bg-[#141414] border border-gray-200 dark:border-[#2a2a2a] rounded-xl shadow-xl p-1"
                        >
                          <p className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-500 whitespace-nowrap">
                            Move {row.unfinished} unfinished paper{row.unfinished !== 1 ? 's' : ''} to
                          </p>
                          {members.filter(m => m.user_id !== row.userId).map(m => {
                            const eligible = canTakeRole(m, row.role);
                            const load = assignments.filter(a => a.reviewer_user_id === m.user_id && a.reviewer_role === row.role).length;
                            return (
                              <button
                                key={m.user_id}
                                type="button"
                                disabled={!eligible || busy}
                                onClick={() => bulkMove(row, m.user_id)}
                                className={cn(
                                  'w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors',
                                  eligible
                                    ? 'hover:bg-gray-50 dark:hover:bg-[#1f1f1f]'
                                    : 'opacity-40 cursor-not-allowed',
                                )}
                              >
                                <ReviewerAvatar userId={m.user_id} name={memberDisplayName(m)} email={m.email} size="xs" />
                                <span className="text-[12.5px] font-medium text-gray-800 dark:text-zinc-200 truncate">
                                  {memberDisplayName(m)}
                                </span>
                                <span className="ml-auto pl-3 text-[10.5px] text-gray-400 dark:text-zinc-500 whitespace-nowrap">
                                  {eligible ? `has ${load}` : 'no permission'}
                                </span>
                              </button>
                            );
                          })}
                          <button
                            type="button"
                            onClick={() => { setBulkOpen(null); setConfirmClearRow(row); }}
                            className="w-full text-left px-2 py-1.5 mt-1 border-t border-gray-100 dark:border-[#1f1f1f] text-[12px] font-medium text-red-600 dark:text-red-400 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                          >
                            Remove {row.name} from {ROLE_BY_KEY[row.role].tag}
                          </button>
                        </div>
                      )}
                    </div>

                    <ChevronRight
                      className={cn('h-3.5 w-3.5 text-gray-400 flex-shrink-0 transition-transform', isOpen && 'rotate-90')}
                    />
                  </div>

                  {/* Papers */}
                  {isOpen && (
                    <div className={cn(
                      'bg-gray-50/60 dark:bg-[#0d0d0d]/60 border-t border-gray-100 dark:border-[#1a1a1a]',
                      // 43 papers under one reviewer pushed every other reviewer
                      // off the bottom of the page.
                      row.papers.length > 12 && 'max-h-[460px] overflow-y-auto',
                    )}>
                      {row.papers.length === 0 ? (
                        <p className="py-3 pl-16 pr-4 text-[12px] text-gray-400 dark:text-zinc-500">
                          No papers match the current filters.
                        </p>
                      ) : row.papers.map(p => (
                        <div
                          key={p.id}
                          className="grid items-center gap-3 py-2 pl-16 pr-4 border-b border-gray-100 dark:border-[#1a1a1a] last:border-b-0"
                          style={{ gridTemplateColumns: '1fr 76px 104px 170px' }}
                        >
                          <span
                            title={p.document_filename || undefined}
                            className="text-[12.5px] text-gray-700 dark:text-zinc-300 truncate"
                          >
                            {p.document_label || labels[p.document_id] || p.document_filename || p.document_id}
                          </span>
                          <span className="text-[11px] font-medium text-gray-400 dark:text-zinc-500 tabular-nums whitespace-nowrap">
                            {p.forms_total > 0 ? `${p.forms_completed}/${p.forms_total} forms` : '—'}
                          </span>
                          <StatusPill status={p.status} />
                          <select
                            value={p.reviewer_user_id}
                            disabled={busy}
                            onChange={e => {
                              if (e.target.value !== p.reviewer_user_id) move(p.document_id, row.role, e.target.value);
                            }}
                            className="justify-self-end w-full text-[11.5px] bg-white dark:bg-[#141414] border border-gray-200 dark:border-[#2a2a2a] rounded-lg px-2 py-1 text-gray-700 dark:text-zinc-300 focus:outline-none disabled:opacity-50"
                          >
                            {members.map(m => (
                              <option key={m.user_id} value={m.user_id} disabled={!canTakeRole(m, row.role)}>
                                {memberDisplayName(m)}{canTakeRole(m, row.role) ? '' : ' — no permission'}
                              </option>
                            ))}
                            {!memberById.has(p.reviewer_user_id) && (
                              <option value={p.reviewer_user_id}>{p.reviewer_name || 'Unknown'} (former member)</option>
                            )}
                          </select>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )
      )}

      {/* ── Confirm: clear every allocation ──────────────────────────────────── */}
      {confirmClearAll && (
        <ConfirmDialog
          tone="danger"
          title="Clear all allocations?"
          body="Every reviewer allocation for this project will be deleted. Saved answers are kept, but you will have to allocate the papers again. This cannot be undone."
          confirmLabel="Clear all"
          busy={clearing === 'all'}
          onCancel={() => setConfirmClearAll(false)}
          onConfirm={clearAll}
        />
      )}

      {/* ── Confirm: remove one reviewer from one role ───────────────────────── */}
      {confirmClearRow && (
        <ConfirmDialog
          tone="neutral"
          title={`Remove ${confirmClearRow.name} from ${ROLE_BY_KEY[confirmClearRow.role].name}?`}
          body={`Their ${confirmClearRow.total} paper${confirmClearRow.total !== 1 ? 's' : ''} in this role will have no reviewer until you assign someone. Their other roles are untouched.`}
          confirmLabel="Remove"
          busy={clearing === confirmClearRow.key}
          onCancel={() => setConfirmClearRow(null)}
          onConfirm={() => clearRow(confirmClearRow)}
        />
      )}
    </div>
  );
}

// ─── Confirm dialog ───────────────────────────────────────────────────────────

function ConfirmDialog({
  tone, title, body, confirmLabel, busy, onCancel, onConfirm,
}: {
  tone: 'danger' | 'neutral';
  title: string;
  body: string;
  confirmLabel: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onCancel}>
      <div
        className="bg-white dark:bg-[#111111] rounded-2xl border border-gray-200 dark:border-[#1f1f1f] shadow-2xl p-6 max-w-sm w-full"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div className={cn(
            'w-10 h-10 rounded-xl flex items-center justify-center',
            tone === 'danger' ? 'bg-red-100 dark:bg-red-400/15' : 'bg-gray-100 dark:bg-[#1a1a1a]',
          )}>
            {tone === 'danger'
              ? <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
              : <Trash2 className="h-5 w-5 text-gray-500 dark:text-zinc-400" />}
          </div>
          <button type="button" onClick={onCancel} className="text-gray-300 dark:text-zinc-600 hover:text-gray-500 p-1">
            <X className="h-4 w-4" />
          </button>
        </div>
        <h3 className="text-[14px] font-semibold text-gray-900 dark:text-white mb-1">{title}</h3>
        <p className="text-[12.5px] text-gray-500 dark:text-zinc-400 mb-5 leading-relaxed">{body}</p>
        <div className="flex gap-2">
          <button type="button" onClick={onCancel}
            className="flex-1 px-4 py-2 rounded-lg border border-gray-200 dark:border-[#2a2a2a] text-[12.5px] font-medium text-gray-600 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] transition-colors">
            Cancel
          </button>
          <button type="button" onClick={onConfirm} disabled={busy}
            className="flex-1 px-4 py-2 rounded-lg bg-gray-900 dark:bg-white text-white dark:text-black text-[12.5px] font-semibold hover:bg-gray-700 dark:hover:bg-zinc-100 disabled:opacity-40 transition-colors flex items-center justify-center gap-2">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

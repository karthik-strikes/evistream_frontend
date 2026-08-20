'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Search, Loader2, Users, Trash2, AlertTriangle, X, ChevronDown, ChevronRight,
  UserCircle2, FileText,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { assignmentsService } from '@/services';
import type { ReviewAssignment } from '@/types/api';
import { AllocationsByPaperView } from './AllocationsByPaperView';
import { ROLE_COLORS } from '@/lib/reviewerColors';

// ─── Constants ────────────────────────────────────────────────────────────────

// Pastel palette — matches shared Avatar component (components/ui/avatar.tsx).
const AVATAR_COLORS = [
  'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300',
  'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
  'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',
];

// Role hues from lib/reviewerColors, so R2 is one colour app-wide (it was violet
// here and emerald in the extraction queue).
const ROLE_MAP = {
  reviewer_1:  { tag: 'R1',  pill: ROLE_COLORS.reviewer_1.pill },
  reviewer_2:  { tag: 'R2',  pill: ROLE_COLORS.reviewer_2.pill },
  adjudicator: { tag: 'Cons', pill: ROLE_COLORS.adjudicator.pill },
} as const;

type ReviewerRole = keyof typeof ROLE_MAP;
const ROLES_ORDERED: ReviewerRole[] = ['reviewer_1', 'reviewer_2', 'adjudicator'];

type StatusFilter = 'all' | 'pending' | 'in_progress' | 'completed' | 'skipped';

const STATUS_PILL: Record<string, string> = {
  completed:   'text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-400/15',
  in_progress: 'text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-400/15',
  pending:     'text-gray-500 dark:text-zinc-400 bg-gray-100 dark:bg-zinc-400/15',
  skipped:     'text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-400/15',
};

const STATUS_LABEL: Record<string, string> = {
  completed: 'Done', in_progress: 'In progress', pending: 'Pending', skipped: 'Skipped',
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface ReviewerGroup {
  userId: string;
  name: string;
  total: number;
  done: number;
  inProgress: number;
  roles: ReviewerRole[];
  byRole: Partial<Record<ReviewerRole, ReviewAssignment[]>>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function avatarColorClass(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffff;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function groupByReviewer(rows: ReviewAssignment[]): ReviewerGroup[] {
  const map = new Map<string, ReviewerGroup>();
  for (const row of rows) {
    if (!map.has(row.reviewer_user_id)) {
      map.set(row.reviewer_user_id, {
        userId: row.reviewer_user_id,
        name: row.reviewer_name || 'Unknown',
        total: 0, done: 0, inProgress: 0, roles: [], byRole: {},
      });
    }
    const g = map.get(row.reviewer_user_id)!;
    g.total++;
    if (row.status === 'completed') g.done++;
    if (row.status === 'in_progress') g.inProgress++;
    const role = row.reviewer_role as ReviewerRole;
    if (!g.byRole[role]) { g.byRole[role] = []; g.roles.push(role); }
    g.byRole[role]!.push(row);
  }
  return Array.from(map.values());
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function MemberAvatar({ userId, name, size = 'sm' }: { userId: string; name: string; size?: 'sm' | 'md' }) {
  const color = avatarColorClass(userId);
  const parts = (name || '?').trim().split(/\s+/);
  const initials = parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : (parts[0][0] || '?').toUpperCase();
  return (
    <div
      className={cn(
        'rounded-full flex items-center justify-center shrink-0 font-semibold select-none',
        size === 'md' ? 'w-9 h-9 text-xs' : 'w-7 h-7 text-[11px]',
        color,
      )}
      aria-hidden
    >
      {initials}
    </div>
  );
}

function RoleTag({ role }: { role: ReviewerRole }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold', ROLE_MAP[role].pill)}>
      {ROLE_MAP[role].tag}
    </span>
  );
}

function StatusPill({ status }: { status: string }) {
  return (
    <span className={cn(
      'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap',
      STATUS_PILL[status] ?? STATUS_PILL.pending,
    )}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

function FormsStrip({ completed, total }: { completed: number; total: number }) {
  if (!total) return null;
  return (
    <div className="flex items-center gap-[2px]">
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className={cn(
            'inline-block w-[6px] h-[10px] rounded-[2px]',
            i < completed
              ? 'bg-emerald-500 dark:bg-emerald-400'
              : 'bg-gray-200 dark:bg-zinc-700',
          )}
        />
      ))}
    </div>
  );
}

function statusDot(status: string) {
  if (status === 'completed')   return 'bg-emerald-500';
  if (status === 'in_progress') return 'bg-blue-500';
  if (status === 'skipped')     return 'bg-amber-400';
  return 'bg-gray-300 dark:bg-zinc-600';
}

// ─── Main component ───────────────────────────────────────────────────────────

export function AllocationsView({
  projectId,
  onSwitchToCreate,
}: {
  projectId: string;
  onSwitchToCreate: () => void;
}) {
  const [view, setView]         = useState<'by-reviewer' | 'by-paper'>('by-reviewer');
  const [loading, setLoading]   = useState(true);
  const [rows, setRows]         = useState<ReviewAssignment[]>([]);
  const [search, setSearch]     = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortBy, setSortBy]     = useState<'load' | 'completion' | 'name'>('load');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [allExpanded, setAllExpanded] = useState(false);

  const [confirmClearAll, setConfirmClearAll]   = useState(false);
  const [confirmClearUser, setConfirmClearUser] = useState<{ userId: string; name: string } | null>(null);
  const [clearing, setClearing] = useState<string | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    assignmentsService.getProjectAssignments(projectId)
      .then(setRows).catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => { reload(); }, [reload]);

  const handleClearAll = async () => {
    setClearing('all');
    try {
      await assignmentsService.clearAssignments(projectId);
      setRows([]);
      setConfirmClearAll(false);
    } finally { setClearing(null); }
  };

  const handleClearUser = async (userId: string) => {
    setClearing(userId);
    try {
      await assignmentsService.clearAssignments(projectId, userId);
      setRows(prev => prev.filter(r => r.reviewer_user_id !== userId));
      setConfirmClearUser(null);
    } finally { setClearing(null); }
  };

  // ── Derived ──────────────────────────────────────────────────────────────

  const allGroups = useMemo(() => groupByReviewer(rows), [rows]);

  const totalReviewers  = allGroups.length;
  const totalPapers     = rows.length;
  const totalDone       = rows.filter(r => r.status === 'completed').length;
  const totalInProgress = rows.filter(r => r.status === 'in_progress').length;
  const totalPending    = rows.filter(r => r.status === 'pending').length;
  const totalSkipped    = rows.filter(r => r.status === 'skipped').length;

  // Per-status counts for filter pills
  const filterCounts: Record<StatusFilter, number> = {
    all:         rows.length,
    pending:     totalPending,
    in_progress: totalInProgress,
    completed:   totalDone,
    skipped:     totalSkipped,
  };

  const formsTotal = rows[0]?.forms_total ?? 0;

  // Apply search + status filter to the flat row list, then re-group
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      const matchStatus = statusFilter === 'all' || r.status === statusFilter;
      const matchSearch = !q ||
        (r.reviewer_name || '').toLowerCase().includes(q) ||
        (r.document_label || r.document_filename || '').toLowerCase().includes(q);
      return matchStatus && matchSearch;
    });
  }, [rows, search, statusFilter]);

  const filteredGroups = useMemo(() => groupByReviewer(filteredRows), [filteredRows]);

  const visibleGroups = useMemo(() => {
    if (sortBy === 'load')       return [...filteredGroups].sort((a, b) => b.total - a.total);
    if (sortBy === 'completion') return [...filteredGroups].sort((a, b) => (b.total ? b.done / b.total : 0) - (a.total ? a.done / a.total : 0));
    return [...filteredGroups].sort((a, b) => a.name.localeCompare(b.name));
  }, [filteredGroups, sortBy]);

  function toggleExpand(uid: string) {
    setExpanded(prev => { const n = new Set(prev); if (n.has(uid)) n.delete(uid); else n.add(uid); return n; });
  }

  function toggleAll() {
    if (allExpanded) {
      setExpanded(new Set());
      setAllExpanded(false);
    } else {
      setExpanded(new Set(visibleGroups.map(g => g.userId)));
      setAllExpanded(true);
    }
  }

  // ── View toggle (shared across both perspectives) ─────────────────────────
  const viewToggle = (
    <div className="flex items-center justify-end">
      <div className="inline-flex bg-gray-100 dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a] rounded-lg p-0.5">
        <button
          type="button"
          onClick={() => setView('by-reviewer')}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-all',
            view === 'by-reviewer'
              ? 'bg-white dark:bg-[#2a2a2a] text-gray-900 dark:text-white shadow-sm'
              : 'text-gray-500 dark:text-zinc-500 hover:text-gray-700 dark:hover:text-zinc-300',
          )}
        >
          <UserCircle2 className="h-3 w-3" />
          By reviewer
        </button>
        <button
          type="button"
          onClick={() => setView('by-paper')}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-all',
            view === 'by-paper'
              ? 'bg-white dark:bg-[#2a2a2a] text-gray-900 dark:text-white shadow-sm'
              : 'text-gray-500 dark:text-zinc-500 hover:text-gray-700 dark:hover:text-zinc-300',
          )}
        >
          <FileText className="h-3 w-3" />
          By paper
        </button>
      </div>
    </div>
  );

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  // ── By-paper view (renders even when no assignments yet) ──────────────────
  if (view === 'by-paper') {
    return (
      <div className="space-y-6">
        {viewToggle}
        <AllocationsByPaperView projectId={projectId} />
      </div>
    );
  }

  // ── Empty (by-reviewer only) ──────────────────────────────────────────────
  if (rows.length === 0) {
    return (
      <div className="space-y-6">
        {viewToggle}
        <div className="border border-dashed border-gray-200 dark:border-[#2a2a2a] rounded-xl p-8 text-center bg-white dark:bg-[#111111]">
          <div className="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-gray-100 dark:bg-[#1a1a1a] mb-3">
            <Users className="h-5 w-5 text-gray-400" />
          </div>
          <h4 className="text-[14px] font-semibold text-gray-900 dark:text-white mb-1.5">No assignments yet</h4>
          <p className="text-[12.5px] text-gray-500 dark:text-zinc-400 max-w-sm mx-auto mb-3">
            Allocations will appear here once reviewers are assigned to papers.
          </p>
          <button type="button" onClick={onSwitchToCreate}
            className="text-[12.5px] font-medium text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200 transition-colors">
            Switch to Create →
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {viewToggle}

      {/* ── Confirm clear ALL ──────────────────────────────────────────────── */}
      {confirmClearAll && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setConfirmClearAll(false)}>
          <div className="bg-white dark:bg-[#111111] rounded-2xl border border-gray-200 dark:border-[#1f1f1f] shadow-2xl p-6 max-w-sm w-full" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <div className="w-10 h-10 rounded-xl bg-red-100 dark:bg-red-400/15 flex items-center justify-center">
                <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
              </div>
              <button type="button" onClick={() => setConfirmClearAll(false)} className="text-gray-300 dark:text-zinc-600 hover:text-gray-500 p-1"><X className="h-4 w-4" /></button>
            </div>
            <h3 className="text-[14px] font-semibold text-gray-900 dark:text-white mb-1">Clear all assignments?</h3>
            <p className="text-[12.5px] text-gray-500 dark:text-zinc-400 mb-5 leading-relaxed">
              Every reviewer allocation for this project will be deleted. You&apos;ll need to reassign from scratch. Cannot be undone.
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setConfirmClearAll(false)}
                className="flex-1 px-4 py-2 rounded-lg border border-gray-200 dark:border-[#2a2a2a] text-[12.5px] font-medium text-gray-600 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] transition-colors">
                Cancel
              </button>
              <button type="button" onClick={handleClearAll} disabled={clearing === 'all'}
                className="flex-1 px-4 py-2 rounded-lg bg-gray-900 dark:bg-white text-white dark:text-black text-[12.5px] font-semibold hover:bg-gray-700 dark:hover:bg-zinc-100 disabled:opacity-40 transition-colors flex items-center justify-center gap-2">
                {clearing === 'all' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                Clear all
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Confirm clear single reviewer ──────────────────────────────────── */}
      {confirmClearUser && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setConfirmClearUser(null)}>
          <div className="bg-white dark:bg-[#111111] rounded-2xl border border-gray-200 dark:border-[#1f1f1f] shadow-2xl p-6 max-w-sm w-full" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <div className="w-10 h-10 rounded-xl bg-gray-100 dark:bg-[#1a1a1a] flex items-center justify-center">
                <Trash2 className="h-5 w-5 text-gray-500 dark:text-zinc-400" />
              </div>
              <button type="button" onClick={() => setConfirmClearUser(null)} className="text-gray-300 dark:text-zinc-600 hover:text-gray-500 p-1"><X className="h-4 w-4" /></button>
            </div>
            <h3 className="text-[14px] font-semibold text-gray-900 dark:text-white mb-1">Remove {confirmClearUser.name}?</h3>
            <p className="text-[12.5px] text-gray-500 dark:text-zinc-400 mb-5 leading-relaxed">
              All paper allocations for this reviewer will be deleted. They can be reassigned from the Create tab.
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setConfirmClearUser(null)}
                className="flex-1 px-4 py-2 rounded-lg border border-gray-200 dark:border-[#2a2a2a] text-[12.5px] font-medium text-gray-600 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] transition-colors">
                Cancel
              </button>
              <button type="button" onClick={() => handleClearUser(confirmClearUser.userId)} disabled={clearing === confirmClearUser.userId}
                className="flex-1 px-4 py-2 rounded-lg bg-gray-900 dark:bg-white text-white dark:text-black text-[12.5px] font-semibold hover:bg-gray-700 dark:hover:bg-zinc-100 disabled:opacity-40 transition-colors flex items-center justify-center gap-2">
                {clearing === confirmClearUser.userId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                Remove
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Stats bar ─────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-gray-100 dark:bg-[#1f1f1f] rounded-xl overflow-hidden border border-gray-100 dark:border-[#1f1f1f]">
        {[
          { label: 'Reviewers',   value: totalReviewers,  sub: 'With allocations'  },
          { label: 'Papers',      value: totalPapers,     sub: 'Total assignments' },
          { label: 'Completed',   value: totalDone,       sub: 'Papers done'       },
          { label: 'In progress', value: totalInProgress, sub: 'Currently active', accent: totalInProgress > 0 },
        ].map(({ label, value, sub, accent }) => (
          <div key={label} className="bg-white dark:bg-[#111111] px-4 py-4">
            <p className="text-xs text-gray-400 dark:text-zinc-500 mb-1">{label}</p>
            <p className={cn('text-2xl font-bold tracking-tight tabular-nums', accent ? 'text-amber-500' : 'text-gray-900 dark:text-white')}>{value}</p>
            <p className="text-[11px] text-gray-400 dark:text-zinc-600 mt-0.5">{sub}</p>
          </div>
        ))}
      </div>

      {/* ── Subtitle ──────────────────────────────────────────────────────────── */}
      <p className="text-[12.5px] text-gray-500 dark:text-zinc-400">
        <span className="font-medium text-gray-700 dark:text-zinc-300 tabular-nums">{totalPapers}</span> paper{totalPapers !== 1 ? 's' : ''} across{' '}
        <span className="font-medium text-gray-700 dark:text-zinc-300 tabular-nums">{totalReviewers}</span> reviewer{totalReviewers !== 1 ? 's' : ''}{' '}
        · <span className="text-emerald-600 dark:text-emerald-400 font-medium tabular-nums">{totalDone} done</span>
        {totalInProgress > 0 && <> · <span className="text-blue-600 dark:text-blue-400 font-medium tabular-nums">{totalInProgress} in progress</span></>}
        {totalSkipped > 0 && <> · <span className="text-amber-600 dark:text-amber-400 font-medium tabular-nums">{totalSkipped} skipped</span></>}
      </p>

      {/* ── Toolbar: search + filter pills + controls ─────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Search */}
        <div className="flex items-center gap-2 border border-gray-200 dark:border-[#2a2a2a] rounded-lg px-3 py-1.5 bg-white dark:bg-[#0d0d0d] min-w-[200px]">
          <Search className="h-3 w-3 text-gray-400 flex-shrink-0" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search reviewer or paper…"
            className="flex-1 bg-transparent text-[12.5px] text-gray-900 dark:text-white outline-none placeholder-gray-400"
          />
        </div>

        {/* Status filter pills */}
        <div className="inline-flex bg-gray-100 dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a] rounded-lg p-0.5 flex-wrap gap-0.5">
          {((['all', 'pending', 'in_progress', 'completed'] as StatusFilter[]).concat(totalSkipped > 0 ? ['skipped'] : [])).map(f => (
            <button
              key={f}
              type="button"
              onClick={() => setStatusFilter(f)}
              className={cn(
                'px-2.5 py-1.5 rounded-md text-[12px] font-medium transition-all whitespace-nowrap',
                statusFilter === f
                  ? 'bg-white dark:bg-[#2a2a2a] text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 dark:text-zinc-500 hover:text-gray-700 dark:hover:text-zinc-300',
              )}
            >
              {f === 'all' ? 'All' : f === 'in_progress' ? 'In progress' : f.charAt(0).toUpperCase() + f.slice(1)}
              {' '}<span className="tabular-nums text-gray-400 dark:text-zinc-500">{filterCounts[f]}</span>
            </button>
          ))}
        </div>

        {/* Right-side controls */}
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={toggleAll}
            className="text-[12px] font-medium text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200 transition-colors whitespace-nowrap"
          >
            {allExpanded ? 'Collapse all' : 'Expand all'}
          </button>

          <div className="inline-flex bg-gray-100 dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a] rounded-lg p-0.5">
            {(['load', 'completion', 'name'] as const).map(opt => (
              <button key={opt} type="button" onClick={() => setSortBy(opt)}
                className={cn(
                  'px-2.5 py-1.5 rounded-md text-[12px] font-medium transition-all whitespace-nowrap',
                  sortBy === opt
                    ? 'bg-white dark:bg-[#2a2a2a] text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-500 dark:text-zinc-500 hover:text-gray-700 dark:hover:text-zinc-300',
                )}>
                {opt === 'load' ? 'Load' : opt === 'completion' ? 'Progress' : 'Name'}
              </button>
            ))}
          </div>

          <button type="button" onClick={() => setConfirmClearAll(true)}
            className="flex items-center gap-1.5 text-[12px] font-medium text-gray-400 dark:text-zinc-500 border border-gray-200 dark:border-[#2a2a2a] rounded-lg px-2.5 py-1.5 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] hover:text-red-500 dark:hover:text-red-400 hover:border-red-200 dark:hover:border-red-900/50 transition-all">
            <Trash2 className="h-3 w-3" />
            Clear all
          </button>
        </div>
      </div>

      {/* ── Queue table ────────────────────────────────────────────────────────── */}
      <div className="border border-gray-200 dark:border-[#1f1f1f] rounded-xl bg-white dark:bg-[#111111] overflow-hidden">

        {/* Column header */}
        <div className="grid items-center gap-3 px-4 py-2.5 bg-gray-50 dark:bg-[#0d0d0d] border-b border-gray-100 dark:border-[#1a1a1a]"
          style={{ gridTemplateColumns: '1fr 120px 110px 72px 32px' }}>
          <div className="text-[10.5px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-500">
            File
          </div>
          <div className="text-[10.5px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-500">
            Forms {formsTotal > 0 ? `(${formsTotal})` : ''}
          </div>
          <div className="text-[10.5px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-500">
            Status
          </div>
          <div className="text-[10.5px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-500 text-right">
            Done
          </div>
          <div />
        </div>

        {/* No results */}
        {visibleGroups.length === 0 && (
          <div className="text-center text-[13px] text-gray-400 dark:text-zinc-500 py-10">
            No results match your search or filter.
          </div>
        )}

        {/* Reviewer groups */}
        {visibleGroups.map((group, gi) => {
          const isOpen = expanded.has(group.userId);
          const pct = group.total ? Math.round((group.done / group.total) * 100) : 0;
          const inProgressPct = group.total ? Math.round((group.inProgress / group.total) * 100) : 0;
          // Papers for this group after filter
          const groupRows = filteredRows.filter(r => r.reviewer_user_id === group.userId);

          return (
            <div key={group.userId} className={cn(gi > 0 && 'border-t border-gray-100 dark:border-[#1a1a1a]')}>

              {/* Reviewer header row */}
              <div
                className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-[#0d0d0d] transition-colors cursor-pointer select-none"
                onClick={() => toggleExpand(group.userId)}
              >
                {isOpen
                  ? <ChevronDown className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                  : <ChevronRight className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />}

                <MemberAvatar userId={group.userId} name={group.name} size="sm" />

                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className="text-[13px] font-medium text-gray-800 dark:text-zinc-200 truncate">
                    {group.name}
                  </span>
                  {group.roles.map(r => <RoleTag key={r} role={r} />)}
                  <span className="text-[11.5px] text-gray-400 dark:text-zinc-500 flex-shrink-0">
                    · {group.total} paper{group.total !== 1 ? 's' : ''}
                  </span>
                </div>

                {/* Progress bar + fraction */}
                <div className="hidden sm:flex items-center gap-3 flex-shrink-0">
                  <div className="w-28 h-1.5 rounded-full bg-gray-100 dark:bg-[#1a1a1a] overflow-hidden flex">
                    {pct > 0 && <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />}
                    {inProgressPct > 0 && <div className="h-full bg-blue-400 opacity-60 transition-all" style={{ width: `${inProgressPct}%` }} />}
                  </div>
                  <span className="font-mono text-[11.5px] text-gray-400 dark:text-zinc-500 tabular-nums min-w-[52px] text-right">
                    {group.done}/{group.total}
                  </span>
                  <span className={cn(
                    'font-mono text-[11.5px] font-semibold tabular-nums min-w-[36px] text-right',
                    pct === 100 ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-500 dark:text-zinc-400',
                  )}>
                    {pct}%
                  </span>
                </div>

                {/* Per-reviewer trash */}
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); setConfirmClearUser({ userId: group.userId, name: group.name }); }}
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-300 dark:text-zinc-600 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-500 transition-colors flex-shrink-0"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Paper rows — grouped by role */}
              {isOpen && (
                <div className="border-t border-gray-100 dark:border-[#1a1a1a]">
                  {ROLES_ORDERED.filter(role => {
                    const roleRows = groupRows.filter(r => r.reviewer_role === role);
                    return roleRows.length > 0;
                  }).map((role, roleIdx) => {
                    const roleRows = groupRows.filter(r => r.reviewer_role === role);
                    return (
                      <div key={role}>
                        {/* Role sub-header */}
                        <div className={cn(
                          'flex items-center gap-2 px-8 py-1.5 bg-gray-50/60 dark:bg-[#0d0d0d]/60',
                          roleIdx > 0 && 'border-t border-gray-100 dark:border-[#1a1a1a]',
                        )}>
                          <RoleTag role={role} />
                          <span className="text-[11.5px] text-gray-400 dark:text-zinc-500">
                            {roleRows.length} paper{roleRows.length !== 1 ? 's' : ''}
                          </span>
                        </div>

                        {/* Paper rows */}
                        {roleRows.map((p) => (
                          <div
                            key={p.id}
                            className="grid items-center gap-3 px-4 py-2.5 border-t border-gray-100 dark:border-[#1a1a1a] hover:bg-gray-50/40 dark:hover:bg-[#0d0d0d]/40 transition-colors"
                            style={{ gridTemplateColumns: '1fr 120px 110px 72px 32px' }}
                          >
                            {/* File name + status dot */}
                            <div className="flex items-center gap-2.5 min-w-0 pl-4">
                              <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', statusDot(p.status))} />
                              <span className="text-[12.5px] text-gray-700 dark:text-zinc-300 truncate">
                                {p.document_label || p.document_filename || p.document_id}
                              </span>
                            </div>

                            {/* Forms strip */}
                            <div>
                              {p.forms_total > 0
                                ? <FormsStrip completed={p.forms_completed} total={p.forms_total} />
                                : <span className="text-[11px] text-gray-300 dark:text-zinc-700">—</span>}
                            </div>

                            {/* Status pill */}
                            <div>
                              <StatusPill status={p.status} />
                            </div>

                            {/* Done fraction */}
                            <div className="text-right">
                              {p.forms_total > 0
                                ? <span className="font-mono text-[11.5px] text-gray-500 dark:text-zinc-400 tabular-nums">
                                    {p.forms_completed}/{p.forms_total}
                                  </span>
                                : <span className="text-[11px] text-gray-300 dark:text-zinc-700">—</span>}
                            </div>

                            {/* Empty spacer (matches header) */}
                            <div />
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

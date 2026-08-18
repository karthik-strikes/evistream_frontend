'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Search, Loader2, Plus, X, Check, Save, Undo2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { assignmentsService, documentsService, projectMembersService } from '@/services';
import type { ReviewAssignment, Document, ProjectMember } from '@/types/api';
import { useToast } from '@/hooks/use-toast';
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

type ReviewerRole = 'reviewer_1' | 'reviewer_2' | 'adjudicator';

const ROLE_DEFS: { key: ReviewerRole; tag: string; label: string; pill: string; dot: string }[] = [
  { key: 'reviewer_1',  tag: 'R1',  label: 'Reviewer 1',  pill: ROLE_COLORS.reviewer_1.pill,  dot: ROLE_COLORS.reviewer_1.dot  },
  { key: 'reviewer_2',  tag: 'R2',  label: 'Reviewer 2',  pill: ROLE_COLORS.reviewer_2.pill,  dot: ROLE_COLORS.reviewer_2.dot  },
  { key: 'adjudicator', tag: 'Cons', label: 'Consensus reviewer', pill: ROLE_COLORS.adjudicator.pill, dot: ROLE_COLORS.adjudicator.dot },
];

type FilterKey = 'all' | 'incomplete' | 'no_r1' | 'no_r2' | 'no_adj';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function avatarColorClass(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffff;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function getInitials(name: string): string {
  const parts = (name || '?').trim().split(/\s+/);
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : (parts[0][0] || '?').toUpperCase();
}

function memberDisplayName(m: ProjectMember): string {
  return m.full_name || m.email || 'Unknown';
}

function MemberAvatar({ userId, name, size = 'sm' }: { userId: string; name: string; size?: 'xs' | 'sm' | 'md' }) {
  const color = avatarColorClass(userId);
  const sizeCls =
    size === 'md' ? 'w-9 h-9 text-xs'      :
    size === 'sm' ? 'w-7 h-7 text-[11px]'  :
    'w-[22px] h-[22px] text-[10px]';
  return (
    <div
      className={cn('rounded-full flex items-center justify-center shrink-0 font-semibold select-none', sizeCls, color)}
      aria-hidden
    >
      {getInitials(name)}
    </div>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface PaperRow {
  docId: string;
  filename: string;
  cells: Partial<Record<ReviewerRole, ReviewAssignment>>;
  filledForms: number;
  totalForms: number;
}

interface PendingChange {
  docId: string;
  role: ReviewerRole;
  userId: string;
}

// ─── Main component ───────────────────────────────────────────────────────────

export function AllocationsByPaperView({ projectId }: { projectId: string }) {
  const { toast } = useToast();
  const containerRef = useRef<HTMLDivElement>(null);

  const [loading, setLoading]         = useState(true);
  const [documents, setDocuments]     = useState<Document[]>([]);
  const [assignments, setAssignments] = useState<ReviewAssignment[]>([]);
  const [members, setMembers]         = useState<ProjectMember[]>([]);

  const [search, setSearch]   = useState('');
  const [filter, setFilter]   = useState<FilterKey>('all');
  const [pending, setPending] = useState<Map<string, PendingChange>>(new Map());
  const [picker, setPicker]   = useState<{ docId: string; role: ReviewerRole } | null>(null);
  const [pickerSearch, setPickerSearch] = useState('');
  const [saving, setSaving]   = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [docs, asg, mem] = await Promise.all([
        documentsService.getAll(projectId),
        assignmentsService.getProjectAssignments(projectId),
        projectMembersService.listMembers(projectId),
      ]);
      setDocuments((docs as Document[]).filter(d => d.processing_status === 'completed'));
      setAssignments(asg);
      setMembers(mem);
    } catch {
      toast({ title: 'Error', description: 'Failed to load allocations', variant: 'error' });
    } finally {
      setLoading(false);
    }
  }, [projectId, toast]);

  useEffect(() => { reload(); }, [reload]);

  // Close picker on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setPicker(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const memberById = useMemo(() => {
    const m = new Map<string, ProjectMember>();
    for (const x of members) m.set(x.user_id, x);
    return m;
  }, [members]);

  // Build paper rows: per document, the current R1/R2/Adj assignment.
  const rows: PaperRow[] = useMemo(() => {
    const byDoc = new Map<string, Partial<Record<ReviewerRole, ReviewAssignment>>>();
    for (const a of assignments) {
      if (!byDoc.has(a.document_id)) byDoc.set(a.document_id, {});
      byDoc.get(a.document_id)![a.reviewer_role as ReviewerRole] = a;
    }
    return documents.map(d => {
      const cells = byDoc.get(d.id) ?? {};
      const totalForms = Math.max(...Object.values(cells).map(a => a?.forms_total ?? 0), 0);
      const filledForms = Object.values(cells).reduce((s, a) => s + (a?.forms_completed ?? 0), 0);
      return { docId: d.id, filename: d.filename, cells, filledForms, totalForms };
    });
  }, [documents, assignments]);

  const formsPerRole = useMemo(() => {
    return Math.max(...assignments.map(a => a.forms_total ?? 0), 0);
  }, [assignments]);

  // Counts (based on raw current assignments, not pending)
  const counts = useMemo(() => {
    let total = rows.length;
    let complete = 0, noR1 = 0, noR2 = 0, noAdj = 0;
    for (const r of rows) {
      const r1 = !!r.cells.reviewer_1;
      const r2 = !!r.cells.reviewer_2;
      const adj = !!r.cells.adjudicator;
      if (!r1) noR1++;
      if (!r2) noR2++;
      if (!adj) noAdj++;
      const allDone =
        r.cells.reviewer_1?.status === 'completed' &&
        r.cells.reviewer_2?.status === 'completed' &&
        r.cells.adjudicator?.status === 'completed';
      if (allDone) complete++;
    }
    return { total, complete, incomplete: total - complete, noR1, noR2, noAdj };
  }, [rows]);

  // Filtered + searched
  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      if (q && !r.filename.toLowerCase().includes(q)) return false;
      const r1 = !!r.cells.reviewer_1;
      const r2 = !!r.cells.reviewer_2;
      const adj = !!r.cells.adjudicator;
      const allDone =
        r.cells.reviewer_1?.status === 'completed' &&
        r.cells.reviewer_2?.status === 'completed' &&
        r.cells.adjudicator?.status === 'completed';
      if (filter === 'incomplete' && allDone) return false;
      if (filter === 'no_r1' && r1) return false;
      if (filter === 'no_r2' && r2) return false;
      if (filter === 'no_adj' && adj) return false;
      return true;
    });
  }, [rows, search, filter]);

  // Effective reviewer for a (docId, role) — considers pending overrides.
  function effectiveReviewer(docId: string, role: ReviewerRole) {
    const key = `${docId}:${role}`;
    const p = pending.get(key);
    if (p) return { userId: p.userId, isPending: true, source: 'pending' as const };
    const a = rows.find(r => r.docId === docId)?.cells[role];
    if (a) return { userId: a.reviewer_user_id, isPending: false, source: 'saved' as const, assignment: a };
    return null;
  }

  function openPicker(docId: string, role: ReviewerRole) {
    setPicker({ docId, role });
    setPickerSearch('');
  }

  function applyPick(userId: string) {
    if (!picker) return;
    const key = `${picker.docId}:${picker.role}`;
    const existing = rows.find(r => r.docId === picker.docId)?.cells[picker.role];
    setPending(prev => {
      const next = new Map(prev);
      if (existing && existing.reviewer_user_id === userId) {
        next.delete(key); // picked the same person — no change
      } else {
        next.set(key, { docId: picker.docId, role: picker.role, userId });
      }
      return next;
    });
    setPicker(null);
  }

  function clearPending(docId: string, role: ReviewerRole) {
    const key = `${docId}:${role}`;
    setPending(prev => {
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
  }

  // Blind-review check across pending + saved: same user as R1 and R2 on the same paper.
  const blindConflicts = useMemo(() => {
    const conflicts = new Set<string>();
    for (const r of rows) {
      const r1 = pending.get(`${r.docId}:reviewer_1`)?.userId ?? r.cells.reviewer_1?.reviewer_user_id;
      const r2 = pending.get(`${r.docId}:reviewer_2`)?.userId ?? r.cells.reviewer_2?.reviewer_user_id;
      if (r1 && r2 && r1 === r2) conflicts.add(r.docId);
    }
    return conflicts;
  }, [rows, pending]);

  async function handleSave() {
    if (pending.size === 0) return;
    if (blindConflicts.size > 0) {
      toast({
        title: 'R1 and R2 conflict',
        description: `${blindConflicts.size} paper${blindConflicts.size !== 1 ? 's have' : ' has'} the same reviewer assigned as R1 and R2.`,
        variant: 'error',
      });
      return;
    }
    setSaving(true);
    try {
      const payload = Array.from(pending.values()).map(p => ({
        document_id: p.docId,
        reviewer_user_id: p.userId,
        reviewer_role: p.role,
      }));
      await assignmentsService.bulkCreate({ project_id: projectId, assignments: payload });
      toast({ title: 'Saved', description: `${payload.length} change${payload.length !== 1 ? 's' : ''} saved` });
      setPending(new Map());
      await reload();
    } catch {
      toast({ title: 'Error', description: 'Failed to save changes', variant: 'error' });
    } finally {
      setSaving(false);
    }
  }

  // Loading
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  const filterPills: { key: FilterKey; label: string; count: number }[] = [
    { key: 'all',        label: 'All',        count: counts.total      },
    { key: 'incomplete', label: 'Incomplete', count: counts.incomplete },
    { key: 'no_r1',      label: 'No R1',      count: counts.noR1       },
    { key: 'no_r2',      label: 'No R2',      count: counts.noR2       },
    { key: 'no_adj',     label: 'No Adj',     count: counts.noAdj      },
  ];

  return (
    <div ref={containerRef} className="space-y-4">

      {/* ── Inline stat strip (TOTAL · COMPLETE · MISSING …) ─────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3 border border-gray-200 dark:border-[#1f1f1f] bg-white dark:bg-[#111111] rounded-xl px-4 py-3">
        <div className="text-[12.5px] text-gray-500 dark:text-zinc-400">
          Reassign reviewers per paper, or fill in missing roles. Changes are queued until you save.
        </div>
        <div className="flex items-center gap-5 flex-wrap">
          <Stat label="Total"       value={counts.total} />
          <Stat label="Complete"    value={counts.complete} sub={counts.total ? `${Math.round(counts.complete / counts.total * 100)}%` : undefined} tone="emerald" />
          <Stat label="Missing R1"  value={counts.noR1}  tone={counts.noR1  > 0 ? 'amber' : undefined} />
          <Stat label="Missing R2"  value={counts.noR2}  tone={counts.noR2  > 0 ? 'amber' : undefined} />
          <Stat label="Missing Adj" value={counts.noAdj} tone={counts.noAdj > 0 ? 'amber' : undefined} />
        </div>
      </div>

      {/* ── Toolbar: search + filters + Save ─────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-2 border border-gray-200 dark:border-[#2a2a2a] rounded-lg px-3 py-1.5 bg-white dark:bg-[#0d0d0d] min-w-[220px]">
          <Search className="h-3 w-3 text-gray-400 flex-shrink-0" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search papers by filename…"
            className="flex-1 bg-transparent text-[12.5px] text-gray-900 dark:text-white outline-none placeholder-gray-400"
          />
        </div>

        <div className="inline-flex bg-gray-100 dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a] rounded-lg p-0.5 flex-wrap gap-0.5">
          {filterPills.map(p => (
            <button
              key={p.key}
              type="button"
              onClick={() => setFilter(p.key)}
              className={cn(
                'px-2.5 py-1.5 rounded-md text-[12px] font-medium transition-all whitespace-nowrap',
                filter === p.key
                  ? 'bg-white dark:bg-[#2a2a2a] text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 dark:text-zinc-500 hover:text-gray-700 dark:hover:text-zinc-300',
              )}
            >
              {p.label} <span className="tabular-nums text-gray-400 dark:text-zinc-500">{p.count}</span>
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {pending.size > 0 && (
            <button
              type="button"
              onClick={() => setPending(new Map())}
              className="flex items-center gap-1.5 text-[12px] font-medium text-gray-500 dark:text-zinc-400 border border-gray-200 dark:border-[#2a2a2a] rounded-lg px-2.5 py-1.5 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] transition-colors"
            >
              <Undo2 className="h-3 w-3" />
              Discard {pending.size}
            </button>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={pending.size === 0 || saving || blindConflicts.size > 0}
            className={cn(
              'flex items-center gap-1.5 text-[12px] font-semibold rounded-lg px-3 py-1.5 transition-colors',
              pending.size === 0 || blindConflicts.size > 0
                ? 'bg-gray-100 dark:bg-[#1a1a1a] text-gray-400 dark:text-zinc-600 cursor-not-allowed'
                : 'bg-gray-900 dark:bg-white text-white dark:text-black hover:bg-gray-700 dark:hover:bg-zinc-100',
              saving && 'opacity-60',
            )}
          >
            {saving
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : <Save className="h-3 w-3" />}
            {pending.size > 0 ? `Save ${pending.size} change${pending.size !== 1 ? 's' : ''}` : 'No changes'}
          </button>
        </div>
      </div>

      {/* ── Conflict banner ─────────────────────────────────────────────────── */}
      {blindConflicts.size > 0 && (
        <div className="flex items-start gap-2.5 border border-red-200 dark:border-red-900/60 bg-red-50/60 dark:bg-red-950/20 rounded-xl px-4 py-3">
          <span className="w-2 h-2 mt-1.5 rounded-full bg-red-500 flex-shrink-0" />
          <p className="text-[12.5px] text-gray-700 dark:text-zinc-300">
            <strong>{blindConflicts.size} paper{blindConflicts.size !== 1 ? 's' : ''} have the same person as R1 and R2.</strong>{' '}
            Blind review requires R1 ≠ R2 — fix these before saving.
          </p>
        </div>
      )}

      {/* ── Table ────────────────────────────────────────────────────────────── */}
      <div className="border border-gray-200 dark:border-[#1f1f1f] rounded-xl bg-white dark:bg-[#111111] overflow-hidden">
        {/* Column header */}
        <div
          className="grid items-center gap-3 px-4 py-2.5 bg-gray-50 dark:bg-[#0d0d0d] border-b border-gray-100 dark:border-[#1a1a1a]"
          style={{ gridTemplateColumns: '1fr 1.4fr 1.4fr 1.4fr 64px' }}
        >
          <div className="text-[10.5px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-500">Paper</div>
          <RoleHeader tag="R1"  label="Reviewer 1"  pill={ROLE_DEFS[0].pill} />
          <RoleHeader tag="R2"  label="Reviewer 2"  pill={ROLE_DEFS[1].pill} />
          <RoleHeader tag="Cons" label="Consensus reviewer" pill={ROLE_DEFS[2].pill} />
          <div className="text-[10.5px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-500 text-right">Filled</div>
        </div>

        {visibleRows.length === 0 && (
          <div className="text-center text-[13px] text-gray-400 dark:text-zinc-500 py-10">
            No papers match your search or filter.
          </div>
        )}

        {visibleRows.map((row, ri) => {
          const isConflict = blindConflicts.has(row.docId);
          return (
            <div
              key={row.docId}
              className={cn(
                'grid items-center gap-3 px-4 py-2.5 transition-colors',
                ri > 0 && 'border-t border-gray-100 dark:border-[#1a1a1a]',
                isConflict ? 'bg-red-50/40 dark:bg-red-950/10' : 'hover:bg-gray-50/40 dark:hover:bg-[#0d0d0d]/40',
              )}
              style={{ gridTemplateColumns: '1fr 1.4fr 1.4fr 1.4fr 64px' }}
            >
              {/* Paper */}
              <div className="flex items-center gap-2.5 min-w-0">
                <RoleDots row={row} pending={pending} />
                <span className="text-[12.5px] text-gray-700 dark:text-zinc-300 truncate font-mono">
                  {row.filename}
                </span>
              </div>

              {/* Reviewer cells */}
              {ROLE_DEFS.map(role => (
                <ReviewerCell
                  key={role.key}
                  docId={row.docId}
                  role={role.key}
                  roleTag={role.tag}
                  current={row.cells[role.key]}
                  pendingChange={pending.get(`${row.docId}:${role.key}`)}
                  memberById={memberById}
                  formsPerRole={formsPerRole}
                  onClick={() => openPicker(row.docId, role.key)}
                  onClearPending={() => clearPending(row.docId, role.key)}
                />
              ))}

              {/* Filled aggregate */}
              <div className="text-right">
                {row.totalForms > 0 ? (
                  <span className="font-mono text-[11.5px] text-gray-500 dark:text-zinc-400 tabular-nums">
                    {row.filledForms}/{row.totalForms * 3}
                  </span>
                ) : (
                  <span className="text-[11px] text-gray-300 dark:text-zinc-700">—</span>
                )}
              </div>
            </div>
          );
        })}

        {/* Footer hint */}
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-gray-100 dark:border-[#1a1a1a] bg-gray-50/60 dark:bg-[#0d0d0d]/40">
          <span className="text-[11.5px] text-gray-400 dark:text-zinc-500 tabular-nums">
            Showing {visibleRows.length} of {rows.length} papers
          </span>
          <span className="text-[11.5px] text-gray-400 dark:text-zinc-500">
            click any cell to edit · empty cells add new
          </span>
        </div>
      </div>

      {/* ── Picker popover ───────────────────────────────────────────────────── */}
      {picker && (
        <PickerPopover
          docId={picker.docId}
          role={picker.role}
          members={members}
          search={pickerSearch}
          onSearch={setPickerSearch}
          currentUserId={effectiveReviewer(picker.docId, picker.role)?.userId}
          onPick={applyPick}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Stat({ label, value, sub, tone }: { label: string; value: number; sub?: string; tone?: 'emerald' | 'amber' }) {
  const toneCls =
    tone === 'emerald' ? 'text-emerald-600 dark:text-emerald-400' :
    tone === 'amber'   ? 'text-amber-600 dark:text-amber-400'     :
    'text-gray-900 dark:text-white';
  return (
    <div className="flex flex-col items-end leading-tight">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-500">
        {label}
      </span>
      <div className="flex items-baseline gap-1.5">
        <span className={cn('text-[18px] font-bold tabular-nums', toneCls)}>{value}</span>
        {sub && <span className="text-[11px] text-gray-400 dark:text-zinc-500 tabular-nums">· {sub}</span>}
      </div>
    </div>
  );
}

function RoleHeader({ tag, label, pill }: { tag: string; label: string; pill: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={cn('inline-flex items-center rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold tracking-wide', pill)}>
        {tag}
      </span>
      <span className="text-[10.5px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-500">
        {label}
      </span>
    </div>
  );
}

function RoleDots({ row, pending }: { row: PaperRow; pending: Map<string, PendingChange> }) {
  return (
    <span className="flex items-center gap-0.5 flex-shrink-0">
      {ROLE_DEFS.map(r => {
        const has = !!row.cells[r.key] || pending.has(`${row.docId}:${r.key}`);
        const isPending = pending.has(`${row.docId}:${r.key}`);
        return (
          <span
            key={r.key}
            className={cn(
              'w-1.5 h-1.5 rounded-full',
              has
                ? isPending ? 'bg-blue-400' : 'bg-emerald-500'
                : 'bg-gray-200 dark:bg-zinc-700',
            )}
          />
        );
      })}
    </span>
  );
}

function ReviewerCell({
  docId, role, roleTag, current, pendingChange, memberById, formsPerRole, onClick, onClearPending,
}: {
  docId: string;
  role: ReviewerRole;
  roleTag: string;
  current?: ReviewAssignment;
  pendingChange?: PendingChange;
  memberById: Map<string, ProjectMember>;
  formsPerRole: number;
  onClick: () => void;
  onClearPending: () => void;
}) {
  const showingPending = !!pendingChange;
  const userId = pendingChange?.userId ?? current?.reviewer_user_id;
  const member = userId ? memberById.get(userId) : undefined;
  const name = member ? memberDisplayName(member) : (current?.reviewer_name ?? 'Unknown');

  if (!userId) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="group flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg border border-dashed border-gray-200 dark:border-[#2a2a2a] hover:border-gray-300 dark:hover:border-[#3a3a3a] hover:bg-gray-50 dark:hover:bg-[#0d0d0d] transition-colors text-left"
      >
        <span className="w-[22px] h-[22px] rounded-full border border-dashed border-gray-300 dark:border-[#3a3a3a] flex items-center justify-center flex-shrink-0">
          <Plus className="h-2.5 w-2.5 text-gray-400" />
        </span>
        <span className="text-[12px] text-gray-400 dark:text-zinc-500 italic group-hover:text-gray-600 dark:group-hover:text-zinc-300">
          Assign {roleTag}
        </span>
      </button>
    );
  }

  const completed = pendingChange ? 0 : (current?.forms_completed ?? 0);
  const total = formsPerRole;

  return (
    <div
      className={cn(
        'group flex items-center gap-2 px-2.5 py-1.5 rounded-lg border transition-colors cursor-pointer',
        showingPending
          ? 'border-blue-300 dark:border-blue-900/60 bg-blue-50/40 dark:bg-blue-950/20'
          : 'border-transparent hover:border-gray-200 dark:hover:border-[#2a2a2a] hover:bg-gray-50 dark:hover:bg-[#0d0d0d]',
      )}
      onClick={onClick}
    >
      <MemberAvatar userId={userId} name={name} size="xs" />
      <div className="flex-1 min-w-0 flex items-center gap-1.5">
        <span className="text-[12px] font-medium text-gray-800 dark:text-zinc-200 truncate">
          {name}
        </span>
      </div>
      {!showingPending && total > 0 && (
        <span className="hidden md:inline-flex items-center gap-1 flex-shrink-0">
          <span className="w-8 h-1 rounded-full bg-gray-100 dark:bg-[#1a1a1a] overflow-hidden">
            <span
              className="block h-full bg-emerald-500 transition-all"
              style={{ width: `${total ? (completed / total) * 100 : 0}%` }}
            />
          </span>
          <span className="font-mono text-[10.5px] text-gray-400 dark:text-zinc-500 tabular-nums">
            {completed}/{total}
          </span>
        </span>
      )}
      {showingPending && (
        <button
          type="button"
          onClick={e => { e.stopPropagation(); onClearPending(); }}
          className="w-5 h-5 rounded-full flex items-center justify-center text-blue-500 hover:bg-blue-100 dark:hover:bg-blue-900/40 flex-shrink-0"
          title="Discard pending change"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

function PickerPopover({
  docId, role, members, search, onSearch, currentUserId, onPick, onClose,
}: {
  docId: string;
  role: ReviewerRole;
  members: ProjectMember[];
  search: string;
  onSearch: (s: string) => void;
  currentUserId?: string;
  onPick: (userId: string) => void;
  onClose: () => void;
}) {
  const lq = search.toLowerCase();
  const visible = members.filter(m =>
    !lq ||
    memberDisplayName(m).toLowerCase().includes(lq) ||
    (m.email || '').toLowerCase().includes(lq),
  );
  const roleTag = ROLE_DEFS.find(r => r.key === role)!.tag;

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-[#111111] rounded-2xl border border-gray-200 dark:border-[#1f1f1f] shadow-2xl w-full max-w-sm overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-[#1a1a1a]">
          <div className="flex items-center gap-2">
            <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-semibold tracking-wide', ROLE_DEFS.find(r => r.key === role)!.pill)}>
              {roleTag}
            </span>
            <span className="text-[13px] font-semibold text-gray-900 dark:text-white">
              Choose {roleTag === 'Cons' ? 'consensus reviewer' : `reviewer ${roleTag.slice(1)}`}
            </span>
          </div>
          <button type="button" onClick={onClose} className="text-gray-300 dark:text-zinc-600 hover:text-gray-500 p-1">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-100 dark:border-[#1a1a1a]">
          <Search className="h-3 w-3 text-gray-400 flex-shrink-0" />
          <input
            autoFocus
            value={search}
            onChange={e => onSearch(e.target.value)}
            placeholder="Search members…"
            className="flex-1 bg-transparent text-[13px] text-gray-900 dark:text-white outline-none placeholder-gray-400"
          />
        </div>

        <div className="max-h-72 overflow-y-auto">
          {visible.length === 0 ? (
            <div className="text-center text-[12.5px] text-gray-400 py-6">No members found</div>
          ) : visible.map(m => {
            const isCurrent = m.user_id === currentUserId;
            return (
              <button
                key={m.user_id}
                type="button"
                onClick={() => onPick(m.user_id)}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 border-b border-gray-50 dark:border-[#0d0d0d] last:border-b-0 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] text-left transition-colors"
              >
                <MemberAvatar userId={m.user_id} name={memberDisplayName(m)} size="sm" />
                <div className="flex-1 min-w-0">
                  <div className="text-[12.5px] font-medium text-gray-800 dark:text-zinc-200 truncate">
                    {memberDisplayName(m)}
                  </div>
                  <div className="text-[11px] text-gray-400 truncate">{m.email}</div>
                </div>
                {isCurrent && <Check className="h-4 w-4 text-emerald-500 flex-shrink-0" />}
              </button>
            );
          })}
        </div>

        <div className="px-4 py-2.5 border-t border-gray-100 dark:border-[#1a1a1a] text-[11px] text-gray-400 dark:text-zinc-500">
          Pick will be queued. Save at the top to apply.
        </div>
        {/* docId/role exposed for screen readers via aria; values are also derived from picker state. */}
        <span className="sr-only">{docId} · {role}</span>
      </div>
    </div>
  );
}

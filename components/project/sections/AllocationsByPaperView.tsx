'use client';

/**
 * Allocations, by paper — one row per paper, one cell per role.
 *
 * Presentational: every byte of data and every mutation comes from
 * `AllocationsView`, which owns the fetch, the search box and the status
 * filter. This view used to fetch the project's assignments a second time and
 * keep its own search state, so the two allocation tabs could disagree about
 * what was on screen.
 *
 * Rows are paged. The live projects here carry 470+ papers, and rendering three
 * popover-bearing cells for every one of them made the tab visibly slow to open.
 */

import { useState, useEffect, useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ReviewAssignment, Document, ProjectMember } from '@/types/api';
import { DocumentTags } from '@/components/documents/DocumentTags';
import { docMatchesQuery } from '@/lib/documentTags';
import {
  ROLE_DEFS, ROLE_BY_KEY, StatusPill, ReviewerAvatar, memberDisplayName,
  canTakeRole, firstName,
  type ReviewerRoleKey, type PaperStatusKey, type StatusFilter,
} from './allocationShared';

const PAGE_SIZE = 25;

/** #, Paper, R1, R2, Cons, Status. */
const GRID = '30px minmax(0,1fr) 116px 116px 116px 112px';

interface Props {
  papers: Document[];
  labels: Record<string, string>;
  /** `${documentId}:${role}` → assignment. */
  cells: Map<string, ReviewAssignment>;
  members: ProjectMember[];
  search: string;
  statusFilter: StatusFilter;
  activeTags: string[];
  onToggleTag: (tag: string) => void;
  matchesTags: (labels: string[]) => boolean;
  paperStatus: (docId: string) => PaperStatusKey;
  formsPerPaper: number;
  busy: boolean;
  onMove: (docId: string, role: ReviewerRoleKey, userId: string | null) => void;
}

export function AllocationsByPaperView({
  papers, labels, cells, members, search, statusFilter,
  activeTags, onToggleTag, matchesTags, paperStatus, formsPerPaper, busy, onMove,
}: Props) {
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<{ docId: string; role: ReviewerRoleKey } | null>(null);

  const memberById = useMemo(() => {
    const m = new Map<string, ProjectMember>();
    for (const x of members) m.set(x.user_id, x);
    return m;
  }, [members]);

  /** How many papers each person already holds in each role. */
  const loads = useMemo(() => {
    const m = new Map<string, number>();
    cells.forEach(a => {
      const k = `${a.reviewer_user_id}:${a.reviewer_role}`;
      m.set(k, (m.get(k) ?? 0) + 1);
    });
    return m;
  }, [cells]);

  /** Position in the full paper list — a stable number that filters don't shift. */
  const numberOf = useMemo(() => {
    const m = new Map<string, number>();
    papers.forEach((d, i) => m.set(d.id, i + 1));
    return m;
  }, [papers]);
  const numWidth = String(papers.length).length;

  const visible = useMemo(() => papers.filter(d => {
    const docLabels = d.labels ?? [];
    if (!matchesTags(docLabels)) return false;
    if (search.trim()) {
      const label = labels[d.id] || d.filename || '';
      const reviewers = ROLE_DEFS
        .map(r => cells.get(`${d.id}:${r.key}`))
        .map(a => (a ? memberDisplayName(memberById.get(a.reviewer_user_id)) || a.reviewer_name || '' : ''))
        .join(' ');
      const q = search.trim().toLowerCase();
      if (!docMatchesQuery(label, docLabels, search) && !reviewers.toLowerCase().includes(q)) return false;
    }
    if (statusFilter !== 'all' && paperStatus(d.id) !== statusFilter) return false;
    return true;
  }), [papers, labels, cells, memberById, matchesTags, search, statusFilter, paperStatus]);

  const maxPage = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const safePage = Math.min(page, maxPage);
  const rows = visible.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // A narrowing filter must not leave you stranded on page 7 of 2.
  useEffect(() => { setPage(1); }, [search, statusFilter, activeTags]);
  // Closing the popover on a page change stops it hanging over an unrelated row.
  useEffect(() => { setOpen(null); }, [safePage]);

  return (
    <div className="space-y-3">
      {open && <div className="fixed inset-0 z-30" onClick={() => setOpen(null)} />}

      <div className="border border-gray-200 dark:border-[#1f1f1f] rounded-xl bg-white dark:bg-[#111111]">
       {/* The three role columns are fixed-width, so below ~900px the title
           column is what gives — it collapsed to nothing and the head labels
           overlapped. Scroll the grid instead of squeezing it. */}
       <div className="overflow-x-auto rounded-t-xl">
        <div className="min-w-[740px]">

        {/* Column head */}
        <div
          className="grid gap-3 px-4 py-2.5 bg-gray-50 dark:bg-[#0d0d0d] border-b border-gray-200 dark:border-[#1f1f1f] rounded-t-xl text-[10px] font-semibold uppercase tracking-wider"
          style={{ gridTemplateColumns: GRID }}
        >
          <span className="text-gray-400 dark:text-zinc-500">#</span>
          <span className="text-gray-400 dark:text-zinc-500">Paper</span>
          {ROLE_DEFS.map(r => (
            <span key={r.key} className={cn('truncate', r.text)}>
              {r.column}
            </span>
          ))}
          <span className="text-gray-400 dark:text-zinc-500">Status</span>
        </div>

        {rows.length === 0 && (
          <p className="text-center text-[12.5px] text-gray-400 dark:text-zinc-500 py-10">
            No papers match your search or filter.
          </p>
        )}

        {rows.map(doc => {
          const status = paperStatus(doc.id);
          return (
            <div
              key={doc.id}
              className="grid gap-3 items-center px-4 py-[7px] border-b border-gray-100 dark:border-[#1a1a1a] last:border-b-0 hover:bg-gray-50/60 dark:hover:bg-[#0d0d0d]/60 transition-colors"
              style={{ gridTemplateColumns: GRID }}
            >
              <span className="text-[10.5px] font-medium text-gray-300 dark:text-zinc-600 tabular-nums">
                {String(numberOf.get(doc.id) ?? 0).padStart(numWidth, '0')}
              </span>

              <div className="flex items-center gap-2 min-w-0">
                <span
                  title={doc.filename || undefined}
                  className="text-[12.5px] font-medium text-gray-800 dark:text-zinc-200 truncate"
                >
                  {labels[doc.id] || doc.filename || 'Untitled'}
                </span>
                <DocumentTags labels={doc.labels ?? []} activeTags={activeTags} onToggleTag={onToggleTag} />
              </div>

              {ROLE_DEFS.map(role => (
                <ReviewerCell
                  key={role.key}
                  role={role.key}
                  assignment={cells.get(`${doc.id}:${role.key}`)}
                  otherReader={
                    role.key === 'adjudicator'
                      ? undefined
                      : cells.get(`${doc.id}:${role.key === 'reviewer_1' ? 'reviewer_2' : 'reviewer_1'}`)?.reviewer_user_id
                  }
                  members={members}
                  memberById={memberById}
                  loads={loads}
                  formsPerPaper={formsPerPaper}
                  busy={busy}
                  isOpen={open?.docId === doc.id && open?.role === role.key}
                  onOpen={() => setOpen(o => (o?.docId === doc.id && o?.role === role.key ? null : { docId: doc.id, role: role.key }))}
                  onPick={userId => { setOpen(null); onMove(doc.id, role.key, userId); }}
                />
              ))}

              <StatusPill status={status} />
            </div>
          );
        })}
        </div>
       </div>

        {/* Pager */}
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-t border-gray-100 dark:border-[#1a1a1a] bg-gray-50/60 dark:bg-[#0d0d0d]/40 rounded-b-xl">
          <span className="text-[11.5px] text-gray-400 dark:text-zinc-500 tabular-nums">
            {visible.length === 0
              ? `0 of ${papers.length} papers`
              : `Showing ${(safePage - 1) * PAGE_SIZE + 1}–${Math.min(safePage * PAGE_SIZE, visible.length)} of ${visible.length} papers`}
            {visible.length !== papers.length && ` (filtered from ${papers.length})`}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-[11.5px] text-gray-400 dark:text-zinc-500">click a cell to reassign</span>
            {maxPage > 1 && (
              <>
                <button
                  type="button"
                  onClick={() => setPage(p => Math.max(1, Math.min(p, maxPage) - 1))}
                  disabled={safePage <= 1}
                  className="text-[11.5px] font-semibold text-gray-600 dark:text-zinc-300 border border-gray-200 dark:border-[#2a2a2a] rounded-lg px-2.5 py-1 hover:bg-white dark:hover:bg-[#1a1a1a] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  ← Prev
                </button>
                <span className="text-[11.5px] font-semibold text-gray-500 dark:text-zinc-400 tabular-nums">
                  {safePage} / {maxPage}
                </span>
                <button
                  type="button"
                  onClick={() => setPage(p => Math.min(maxPage, Math.min(p, maxPage) + 1))}
                  disabled={safePage >= maxPage}
                  className="text-[11.5px] font-semibold text-gray-600 dark:text-zinc-300 border border-gray-200 dark:border-[#2a2a2a] rounded-lg px-2.5 py-1 hover:bg-white dark:hover:bg-[#1a1a1a] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  Next →
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── One cell ─────────────────────────────────────────────────────────────────

function ReviewerCell({
  role, assignment, otherReader, members, memberById, loads,
  formsPerPaper, busy, isOpen, onOpen, onPick,
}: {
  role: ReviewerRoleKey;
  assignment?: ReviewAssignment;
  /** Whoever holds the opposite reader role on this paper — never offered here. */
  otherReader?: string;
  members: ProjectMember[];
  memberById: Map<string, ProjectMember>;
  loads: Map<string, number>;
  formsPerPaper: number;
  busy: boolean;
  isOpen: boolean;
  onOpen: () => void;
  onPick: (userId: string | null) => void;
}) {
  const userId = assignment?.reviewer_user_id;
  const member = userId ? memberById.get(userId) : undefined;
  const name = member ? memberDisplayName(member) : (assignment?.reviewer_name || 'Unknown');
  const done = (assignment?.forms_completed ?? 0) >= (assignment?.forms_total ?? formsPerPaper)
    && (assignment?.forms_total ?? 0) > 0;
  // Seats can now be taken by the reviewer themselves: the first two people to
  // extract an unallocated paper claim R1 and R2 on the spot. Those rows are
  // ordinary assignments and already show here, but they were indistinguishable
  // from a deliberate allocation — worth telling apart when you are looking at
  // who is actually covering what.
  const selfClaimed = !!assignment?.assigned_by
    && assignment.assigned_by === assignment.reviewer_user_id;

  return (
    <div className="relative min-w-0">
      {userId ? (
        <button
          type="button"
          onClick={onOpen}
          title={`${name} · ${assignment?.forms_completed ?? 0}/${assignment?.forms_total ?? formsPerPaper} forms${selfClaimed ? ' · picked this paper up themselves' : ''}`}
          className="group flex items-center gap-1.5 max-w-full -ml-1.5 px-1.5 py-[3px] rounded-lg hover:bg-gray-100 dark:hover:bg-[#1f1f1f] transition-colors"
        >
          <ReviewerAvatar userId={userId} name={name} email={member?.email} size="xs" />
          <span className="text-[12px] font-medium text-gray-700 dark:text-zinc-300 truncate">
            {firstName(name)}
          </span>
          {selfClaimed && (
            <span
              className="text-[10px] leading-none text-gray-400 dark:text-zinc-500 flex-shrink-0"
              title="Picked this paper up themselves — not allocated by a manager"
            >
              ⤴
            </span>
          )}
          {done && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" title="All forms done" />}
        </button>
      ) : (
        <button
          type="button"
          onClick={onOpen}
          className="inline-flex items-center border border-dashed border-gray-300 dark:border-[#3a3a3a] rounded-full px-2.5 py-[3px] text-[11.5px] font-medium text-gray-400 dark:text-zinc-500 hover:border-gray-400 dark:hover:border-zinc-500 hover:text-gray-700 dark:hover:text-zinc-300 transition-colors"
        >
          + Assign
        </button>
      )}

      {isOpen && (
        <div className="absolute top-[calc(100%+4px)] left-[-6px] z-40 min-w-[228px] bg-white dark:bg-[#141414] border border-gray-200 dark:border-[#2a2a2a] rounded-xl shadow-xl p-1">
          <p className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-500 whitespace-nowrap">
            {ROLE_BY_KEY[role].name}
          </p>
          {members.length === 0 && (
            <p className="px-2 py-2 text-[12px] text-gray-400 dark:text-zinc-500">No project members.</p>
          )}
          {members.map(m => {
            const isCurrent = m.user_id === userId;
            const clash = !!otherReader && otherReader === m.user_id;
            const eligible = canTakeRole(m, role);
            const blocked = clash || !eligible;
            const load = loads.get(`${m.user_id}:${role}`) ?? 0;
            return (
              <button
                key={m.user_id}
                type="button"
                disabled={blocked || busy || isCurrent}
                onClick={() => onPick(m.user_id)}
                className={cn(
                  'w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors',
                  blocked ? 'opacity-40 cursor-not-allowed'
                    : isCurrent ? 'bg-gray-50 dark:bg-[#1f1f1f] cursor-default'
                    : 'hover:bg-gray-50 dark:hover:bg-[#1f1f1f]',
                )}
              >
                <ReviewerAvatar userId={m.user_id} name={memberDisplayName(m)} email={m.email} size="xs" />
                <span className="text-[12.5px] font-medium text-gray-800 dark:text-zinc-200 truncate">
                  {memberDisplayName(m)}
                </span>
                <span className="ml-auto pl-3 text-[10.5px] text-gray-400 dark:text-zinc-500 whitespace-nowrap">
                  {isCurrent ? `current · ${load}` : clash ? 'other reader' : !eligible ? 'no permission' : `has ${load}`}
                </span>
              </button>
            );
          })}
          {userId && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onPick(null)}
              className="w-full text-left px-2 py-1.5 mt-1 border-t border-gray-100 dark:border-[#1f1f1f] text-[12px] font-medium text-red-600 dark:text-red-400 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-40 transition-colors"
            >
              Remove reviewer
            </button>
          )}
          {busy && (
            <div className="flex items-center gap-2 px-2 py-1.5 text-[11px] text-gray-400">
              <Loader2 className="h-3 w-3 animate-spin" /> saving…
            </div>
          )}
        </div>
      )}
    </div>
  );
}

'use client';

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, Info } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui';
import { cn, formatModelName } from '@/lib/utils';
import { auditService } from '@/services';
import { displayLabel } from '@/lib/absence';
import {
  cellProvenance, cellHistory, EVIDENCE_LABEL, TOUCH_VERB, touchShowsValue,
  type CellTouch,
} from '@/lib/provenance';
import type { Person } from '@/hooks/useProjectPeople';
import type { SeatResolver } from '@/lib/reviewerSeats';
import type { AuditEntry } from '@/types/api';
import { RoleTag, TimeAgo } from './ResultsPeople';
import { shortValue } from './activityCopy';

export interface CellHistoryTarget {
  resultId: string;
  documentId: string;
  /** Study label, e.g. "Raslan 2021". */
  paperLabel: string;
  /** Raw column name — the audit trail's `field_name`. */
  fieldName: string;
  /** Human label, e.g. "Dose (mg)". */
  fieldLabel: string;
  /** The cell envelope, with its `provenance` block. */
  raw: unknown;
  /** What the table shows in that cell. */
  displayValue: string;
  /** This cell across every AI run, newest first. The AI side's answer to the
   *  same question the provenance block answers for a human edit. */
  runHistory?: { runId: string; at: string; model: string | null; value: string }[];
}

/**
 * Who entered one cell, and what it said before.
 *
 * The design put this beside a field × paper grid as an inline 300px card. It
 * is a drawer here for the same reason `SourceEvidenceDrawer` is: the results
 * table is 14–18 columns wide and scrolls horizontally, so a column taken out
 * of the layout squeezes the thing you are reading. Same shell, one z-layer
 * below it, so opening a quote from inside this panel would stack correctly.
 *
 * Two sources, deliberately:
 *
 * - `cell.provenance` — the frozen baseline (`prior_value`, `prior_origin`) and
 *   the latest touch of each kind. Present on every human-touched cell.
 * - `audit_trail` — one row per save. Finer-grained, but only for saves made
 *   after the provenance work shipped, so older cells have provenance and no
 *   audit rows at all.
 *
 * **Neither is a full version history and this panel must not imply one.**
 * `audit_trail.old_value` is read off `provenance.prior_value`, which is the
 * ORIGINAL reading preserved through every subsequent edit — so a cell edited
 * 600 → 500 → 400 stores "was 600, is 400" and the 500 is gone. That is why the
 * baseline is drawn once, at the bottom, rather than as the "from" side of each
 * save, and why the footnote says so out loud.
 */
export function CellHistoryPanel({
  target,
  projectId,
  personOf,
  seatOf,
  onClose,
}: {
  target: CellHistoryTarget | null;
  projectId: string | undefined;
  /** Optional: an AI cell has no author to resolve, and the AI tab does not
   *  pass one. The human sections simply render nothing. */
  personOf?: (
    userId: string | null | undefined,
    fallback?: { name?: string | null; email?: string | null },
  ) => Person | null;
  /** Resolves the seat from `review_assignments` rather than the audit row's
   *  copy of `reviewer_role`, which goes stale like every other copy of it. */
  seatOf?: SeatResolver;
  onClose: () => void;
}) {
  const open = !!target;

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const { data: auditRows = [], isLoading, isFetched } = useQuery({
    queryKey: ['cell-history', target?.resultId, target?.fieldName, projectId],
    queryFn: () =>
      auditService
        .getEntityHistory('extraction_result', target!.resultId, projectId!)
        .catch(() => [] as AuditEntry[]),
    enabled: open && !!target?.resultId && !!projectId,
    staleTime: 30 * 1000,
  });

  const prov = cellProvenance(target?.raw);
  const fieldEdits = auditRows.filter(
    r => r.action === 'field_edited' && r.field_name === target?.fieldName,
  );
  // Provenance touches are the fallback for cells saved before audit rows
  // existed — and they carry the confirm/source events audit never logs
  // (an evidence-only save deliberately does not count as a field edit).
  const touches = cellHistory(prov, target?.raw && typeof target.raw === 'object'
    ? (target.raw as { value?: unknown }).value
    : target?.displayValue);
  const humanTouches = touches.filter(t => t.userId);
  const baseline = touches.find(t => !t.userId) ?? null;

  // Null for a reported value; "NR" / "NA" / the failure marker otherwise.
  const absenceLabel = target ? displayLabel(target.raw) : null;
  const evidence = prov?.evidence_state;

  return (
    <>
      <div
        onClick={onClose}
        className={cn(
          'fixed inset-0 z-[50] bg-black/15 transition-opacity duration-200 dark:bg-black/40',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      />
      <aside
        aria-hidden={!open}
        aria-label="Cell history"
        className={cn(
          'fixed right-0 top-0 z-[55] flex h-screen w-[420px] max-w-[96vw] flex-col',
          'border-l border-gray-200 bg-white shadow-2xl dark:border-[#1f1f1f] dark:bg-[#0f0f0f]',
          'transition-transform duration-300 ease-out',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <div className="shrink-0 border-b border-gray-100 px-5 pb-4 pt-5 dark:border-[#1a1a1a]">
          <div className="flex items-start justify-between gap-3">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-600">
              Cell history
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:text-zinc-500 dark:hover:bg-[#1f1f1f]"
            >
              <X size={14} />
            </button>
          </div>
          {target && (
            <>
              <p className="mt-2 text-xs text-gray-500 dark:text-zinc-400">
                {target.fieldLabel} · {target.paperLabel}
              </p>
              <div className="mt-1.5 flex items-start justify-between gap-3">
                <p className="min-w-0 break-words text-[17px] font-semibold leading-snug text-gray-900 dark:text-white">
                  {target.displayValue || '—'}
                </p>
                {absenceLabel && (
                  <Badge variant="neutral" className="mt-1 shrink-0">
                    {absenceLabel}
                  </Badge>
                )}
              </div>
              {evidence && (
                <p className="mt-2 text-[11px] text-gray-400 dark:text-zinc-500">
                  {EVIDENCE_LABEL[evidence] ?? evidence}
                </p>
              )}
            </>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-6 pt-2">
          {!target ? null : isLoading && fieldEdits.length === 0 ? (
            <p className="py-6 text-xs text-gray-400 dark:text-zinc-500">Loading history…</p>
          ) : fieldEdits.length === 0 && humanTouches.length === 0 && !baseline ? (
            <>
              <p className="py-4 text-xs text-gray-400 dark:text-zinc-500">
                No one has edited this cell. It is the AI&apos;s reading, untouched.
              </p>
              <RunHistory runs={target.runHistory} />
            </>
          ) : (
            <div className="flex flex-col">
              {/* Audit rows are the finer-grained source — one per save — so they
                  win whenever there are any. The provenance fallback waits for
                  the query to settle: rendering it while the fetch is in flight
                  showed one synthesised line and then replaced it with three
                  real ones, which reads as the panel changing its mind. */}
              {fieldEdits.length > 0 || !isFetched
                ? fieldEdits.map(r => (
                    <SaveRow
                      key={r.id}
                      at={r.created_at}
                      person={personOf?.(r.user_id, { name: r.user_name, email: r.user_email }) ?? null}
                      role={resolveSeat(seatOf, r.user_id, target.documentId,
                        (r.metadata ?? {})['reviewer_role'] ?? null)}
                      isDraft={!!(r.metadata ?? {})['is_partial']}
                      what={saveWording(r)}
                    />
                  ))
                : humanTouches
                    .slice()
                    .reverse()
                    .map((t, i) => (
                      <SaveRow
                        key={`${t.kind}-${t.at ?? i}`}
                        at={t.at}
                        person={personOf?.(t.userId) ?? null}
                        role={resolveSeat(seatOf, t.userId, target.documentId, t.role)}
                        isDraft={false}
                        what={touchWording(t)}
                      />
                    ))}

              {baseline && (
                <div className="flex items-start gap-2.5 border-t border-gray-100 py-3 dark:border-[#1a1a1a]">
                  <span className="mt-px flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-blue-100 text-[9px] font-semibold text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                    AI
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-gray-900 dark:text-white">
                      {baseline.kind === 'ai' ? 'AI extraction' : 'Earlier value'}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-600 dark:text-zinc-400">
                      first read{' '}
                      <span className="font-mono text-gray-700 dark:text-zinc-300">
                        {shortValue(baseline.value) ?? '—'}
                      </span>
                    </p>
                  </div>
                </div>
              )}

              <RunHistory runs={target.runHistory} />

              <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-gray-50 px-2.5 py-2 text-[11px] leading-relaxed text-gray-400 dark:bg-[#141414] dark:text-zinc-500">
                <Info className="mt-px h-3 w-3 shrink-0" />
                <span>
                  The first reading and the current value are both kept. Values in between are
                  not stored, so this is an edit log rather than a full version history.
                </span>
              </p>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

function SaveRow({
  at, person, role, isDraft, what,
}: {
  at: string | null;
  person: Person | null;
  role: string | null;
  isDraft: boolean;
  what: { verb: string; value: string | null };
}) {
  return (
    <div className="flex items-start gap-2.5 border-t border-gray-100 py-3 first:border-t-0 dark:border-[#1a1a1a]">
      {person ? (
        <Avatar email={person.avatarKey} name={person.name} size="xs" className="mt-px" />
      ) : (
        <span className="mt-px h-[22px] w-[22px] shrink-0 rounded-full bg-gray-100 dark:bg-[#1f1f1f]" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-semibold text-gray-900 dark:text-white">
            {person?.name ?? 'Unknown'}
          </span>
          <RoleTag role={role} />
          {isDraft && (
            <span
              title="Saved as a draft — an autosave, not a submitted answer"
              className="rounded bg-gray-100 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-gray-500 dark:bg-zinc-700/40 dark:text-zinc-400"
            >
              Draft
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-gray-600 dark:text-zinc-400">
          {what.verb}
          {what.value && (
            <>
              {' '}
              <span className="font-mono text-gray-700 dark:text-zinc-300">{what.value}</span>
            </>
          )}
        </p>
        {/* Relative only. `formatRelativeTime` already falls back to the
            absolute form past seven days, so printing both rendered the same
            string twice on any edit older than a week — which is most of them. */}
        <p className="mt-0.5 text-[11px] text-gray-400 dark:text-zinc-500">
          {at ? <TimeAgo at={at} /> : 'time not recorded'}
        </p>
      </div>
    </div>
  );
}

/**
 * What this cell has said across the AI runs, newest first.
 *
 * The AI analogue of the human edit log below it. It needs no stored history —
 * every run already keeps its own row, so this is read straight off the rows
 * the page has in hand. Renders nothing when there is only one run, because
 * "it has always said this" is not history.
 */
function RunHistory({
  runs,
}: {
  runs?: { runId: string; at: string; model: string | null; value: string }[];
}) {
  if (!runs || runs.length < 2) return null;
  return (
    <div className="mt-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-600">
        Across {runs.length} AI runs
      </p>
      <div className="mt-1">
        {runs.map((r, i) => {
          const changed = i < runs.length - 1 && runs[i + 1].value !== r.value;
          return (
            <div
              key={r.runId}
              className="flex items-start gap-2.5 border-t border-gray-100 py-2 dark:border-[#1a1a1a]"
            >
              <span
                className={cn(
                  'mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full',
                  changed ? 'bg-gray-900 dark:bg-zinc-100' : 'bg-gray-200 dark:bg-[#2a2a2a]',
                )}
                title={changed ? 'Changed in this run' : 'Same as the run before'}
              />
              <div className="min-w-0 flex-1">
                <p className="break-words font-mono text-xs text-gray-700 dark:text-zinc-300">
                  {r.value === '' ? '—' : r.value}
                </p>
                <p className="mt-0.5 text-[11px] text-gray-400 dark:text-zinc-500">
                  {r.model ? `${formatModelName(r.model)} · ` : ''}
                  <TimeAgo at={r.at} />
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function resolveSeat(
  seatOf: SeatResolver | undefined,
  userId: string | null | undefined,
  documentId: string | null | undefined,
  rowRole: string | null,
): string | null {
  return seatOf ? seatOf(userId, documentId, rowRole) : rowRole;
}

/** Wording for one `field_edited` audit row. */
function saveWording(r: AuditEntry): { verb: string; value: string | null } {
  const cols = (r.metadata ?? {})['columns'] as string[] | undefined;
  if (cols?.length) {
    return { verb: `filled ${cols.length} ${cols.length === 1 ? 'column' : 'columns'}`, value: null };
  }
  const to = shortValue(r.new_value);
  if (to) return { verb: 'saved', value: to };
  return { verb: 'cleared the value', value: null };
}

/** Wording for one provenance touch, used when no audit row exists. */
function touchWording(t: CellTouch): { verb: string; value: string | null } {
  return {
    verb: TOUCH_VERB[t.kind],
    value: touchShowsValue(t.kind) ? shortValue(t.value) : null,
  };
}

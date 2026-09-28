'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { HomeEnvelope, HomeFormRow, HomeForms, StageCell } from '@/types/home';
import { STAGE } from '../_lib/tokens';
import { Pill, Restricted, SeatBadge, SectionError, SkeletonRows, type HomeTone } from './ui';

type Q = { data?: HomeEnvelope<HomeForms>; isLoading: boolean; isError: boolean; refetch: () => void };

/** Rows shown before "Show more" — keeps the table scannable on big projects. */
const VISIBLE = 8;

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);

function Bar({ cell, fill, running }: { cell: StageCell; fill: string; running?: string }) {
  const d = cell.d || 1;
  const seg = (v: number) => `${Math.max(0, Math.min(100, (v / d) * 100))}%`;
  return (
    <div className="mt-1.5 flex h-1 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-[#1f1f1f]">
      <div className="h-full" style={{ width: seg(cell.n), background: fill }} />
      {!!cell.running && running && <div className="h-full" style={{ width: seg(cell.running), background: running }} />}
      {!!cell.failed && <div className="h-full" style={{ width: seg(cell.failed), background: STAGE.failed }} />}
    </div>
  );
}

function Stage({ cell, fill, running, href, seatLabel, assignHref }: {
  cell: StageCell | null; fill: string; running?: string; href?: string | null; seatLabel?: string; assignHref?: string | null;
}) {
  if (!cell) return <td className="px-4 py-3.5" />;
  if (cell.state === 'restricted') {
    return <td className="px-4 py-3.5 text-[12px] text-gray-500 dark:text-zinc-400">Hidden while blinded</td>;
  }
  if (cell.state === 'not_assigned') {
    return (
      <td className="px-4 py-3.5 text-[13px] text-gray-500 dark:text-zinc-400">
        Not assigned
        {assignHref && (
          <Link href={assignHref} className="ml-1.5 whitespace-nowrap text-[12px] font-medium text-[#0a0a0a] underline underline-offset-2 dark:text-zinc-100">
            Assign {seatLabel} →
          </Link>
        )}
      </td>
    );
  }
  const note = [cell.running ? `${cell.running} running` : null, cell.failed ? `${cell.failed} failed` : null].filter(Boolean).join(' · ');
  const body = (
    <>
      <div className="flex items-baseline gap-1">
        <span className="text-[16px] font-bold tabular-nums text-[#0a0a0a] dark:text-zinc-100">{cell.n}</span>
        <span className="text-[12px] text-gray-500 dark:text-zinc-400">/ {cell.d}</span>
        <span className="ml-auto text-[11px] tabular-nums text-gray-500 dark:text-zinc-400">{pct(cell.n, cell.d)}%</span>
      </div>
      <Bar cell={cell} fill={fill} running={running} />
      {note && <div className="mt-1 text-[11px] text-gray-500 dark:text-zinc-400">{note}</div>}
    </>
  );
  return (
    <td className="px-4 py-3.5 align-top">
      {href ? <Link href={href} className="block rounded-md no-underline hover:opacity-80">{body}</Link> : body}
    </td>
  );
}

const SETUP: Record<string, { tone: HomeTone; label: string; meta: string; action: string }> = {
  awaiting_review: { tone: 'amber', label: 'Awaiting review', meta: 'Extraction plan is ready for review', action: 'Review plan' },
  draft: { tone: 'gray', label: 'In setup', meta: 'Fields are still being defined', action: 'Continue setup' },
  generating: { tone: 'gray', label: 'Generating', meta: 'Extraction plan is being built', action: 'Open forms' },
  regenerating: { tone: 'gray', label: 'Generating', meta: 'Extraction plan is being rebuilt', action: 'Open forms' },
  failed: { tone: 'rose', label: 'Build failed', meta: 'The extraction plan could not be built', action: 'Open forms' },
};

function FormRow({ r, canManageAssignments, canEditForms, projectId }: {
  r: HomeFormRow; canManageAssignments: boolean; canEditForms: boolean; projectId: string;
}) {
  const nameCell = (
    <td className="px-4 py-3.5 align-top">
      <Link href={`/results?form_id=${encodeURIComponent(r.form_id)}&tab=ai`}
        className="text-[13px] font-medium text-[#0a0a0a] no-underline hover:underline dark:text-zinc-100">{r.form_name}</Link>
      <div className="text-[12px] text-gray-500 dark:text-zinc-400">Active{r.pilot_ready ? ' · pilot results ready' : ''}</div>
    </td>
  );
  if (r.status !== 'active') {
    const s = SETUP[r.status] ?? SETUP.draft;
    return (
      <tr className="border-t border-gray-100 bg-[#fafafa] dark:border-[#1f1f1f] dark:bg-[#0d0d0d]">
        <td className="px-4 py-3 text-[13px] font-medium text-[#0a0a0a] dark:text-zinc-100">{r.form_name}</td>
        <td colSpan={4} className="px-4 py-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <Pill tone={s.tone}>{s.label}</Pill>
            <span className="text-[12px] text-gray-500 dark:text-zinc-400">{s.meta}</span>
            {canEditForms && (
              <Link href="/forms"
                className="ml-auto inline-flex h-8 items-center rounded-[6px] border border-gray-200 bg-white px-3 text-[12px] font-medium text-[#0a0a0a] hover:bg-gray-50 dark:border-[#2a2a2a] dark:bg-[#111111] dark:text-zinc-100">
                {s.action}
              </Link>
            )}
          </div>
        </td>
      </tr>
    );
  }
  const manual = `/results?form_id=${encodeURIComponent(r.form_id)}&tab=manual`;
  const assign = canManageAssignments ? `/projects/${projectId}?tab=assignments` : null;
  return (
    <tr className="border-t border-gray-100 dark:border-[#1f1f1f]">
      {nameCell}
      <Stage cell={r.ai} fill={STAGE.ai.fill} running={STAGE.ai.running} href={`/results?form_id=${encodeURIComponent(r.form_id)}&tab=ai`} />
      <Stage cell={r.r1} fill={STAGE.reader.fill} href={manual} seatLabel="R1" assignHref={assign} />
      <Stage cell={r.r2} fill={STAGE.reader.fill} href={manual} seatLabel="R2" assignHref={assign} />
      <Stage cell={r.consensus} fill={STAGE.consensus.fill} href={`/consensus?form=${encodeURIComponent(r.form_id)}`} />
    </tr>
  );
}

export function FormReviewTable({ q, projectId, canManageAssignments, canEditForms }: {
  q: Q; projectId: string; canManageAssignments: boolean; canEditForms: boolean;
}) {
  const f = q.data?.status === 'ready' ? q.data.data : null;
  const p = f?.processing;
  const [expanded, setExpanded] = useState(false);
  useEffect(() => setExpanded(false), [projectId]);
  const rows = f?.rows ?? [];
  const hidden = Math.max(0, rows.length - VISIBLE);
  const shown = expanded ? rows : rows.slice(0, VISIBLE);
  return (
    <section aria-labelledby="forms-h" className="rounded-xl border border-gray-200 bg-white dark:border-[#1f1f1f] dark:bg-[#111111]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 px-4 py-3.5 dark:border-[#1f1f1f]">
        <div className="min-w-0">
          <h2 id="forms-h" className="m-0 text-[16px] font-semibold leading-6 text-[#0a0a0a] dark:text-zinc-100">Extraction and review by form</h2>
          {f && (
            <p className="m-0 mt-0.5 text-[12px] text-gray-500 dark:text-zinc-400">
              AI over {f.ai_eligible} eligible documents · R1, R2 and consensus over {f.allocated} allocated. Stages are independent; manual review does not require AI output.
            </p>
          )}
        </div>
        {p && (p.running + p.queued + p.failed > 0) && (
          <div className="flex items-center gap-2 whitespace-nowrap text-[12px] text-gray-600 dark:text-zinc-400">
            <span aria-hidden className="h-2 w-2 rounded-full bg-[#4F86F7]" />
            {p.running} run{p.running === 1 ? '' : 's'} active · {p.queued} queued
            {p.failed > 0 && <> · <Link href="/jobs" className="font-semibold text-[#c22d47] dark:text-rose-300">{p.failed} failed</Link></>}
          </div>
        )}
      </div>

      {q.isLoading && <SkeletonRows rows={5} />}
      {q.isError && <SectionError what="the per-form summary" onRetry={q.refetch} />}
      {q.data && q.data.status !== 'ready' && <Restricted message={q.data.message} />}

      {f && (
        <>
          {f.rows.length === 0 ? (
            <p className="m-0 px-4 py-4 text-[13px] text-gray-500 dark:text-zinc-400">
              No extraction forms yet.{canEditForms && <> <Link href="/forms" className="font-medium text-[#0a0a0a] underline underline-offset-2 dark:text-zinc-100">Create a form</Link></>}
            </p>
          ) : (
            <div role="region" aria-labelledby="forms-h" tabIndex={0} className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-left">
                <colgroup><col className="w-[24%]" /><col className="w-[19%]" /><col className="w-[19%]" /><col className="w-[19%]" /><col className="w-[19%]" /></colgroup>
                <thead>
                  <tr className="text-[11px] font-bold uppercase tracking-[.08em]">
                    <th scope="col" className={cn('px-4 py-2.5 font-bold', STAGE.form.head)}>Form</th>
                    <th scope="col" className={cn('px-4 py-2.5 font-bold', STAGE.ai.head)}>AI output</th>
                    <th scope="col" className={cn('px-4 py-2.5 font-bold', STAGE.reader.head)}>R1 saved</th>
                    <th scope="col" className={cn('px-4 py-2.5 font-bold', STAGE.reader.head)}>R2 saved</th>
                    <th scope="col" className={cn('px-4 py-2.5 font-bold', STAGE.consensus.head)}>Consensus</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map(r => (
                    <FormRow key={r.form_id} r={r} projectId={projectId}
                      canManageAssignments={canManageAssignments} canEditForms={canEditForms} />
                  ))}
                </tbody>
              </table>
              {hidden > 0 && (
                <button type="button" aria-expanded={expanded} onClick={() => setExpanded(e => !e)}
                  className="flex w-full items-center justify-center gap-1.5 border-0 border-t border-gray-100 bg-transparent px-4 py-2.5 text-[12px] font-medium text-gray-600 hover:bg-[#fafafa] hover:text-[#0a0a0a] dark:border-[#1f1f1f] dark:text-zinc-400 dark:hover:bg-[#161616] dark:hover:text-zinc-100">
                  {expanded ? 'Show fewer forms' : `Show ${hidden} more form${hidden === 1 ? '' : 's'}`}
                  <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-180')} />
                </button>
              )}
            </div>
          )}

          {(f.seats.length > 0 || f.additional_reviewers.saved_forms > 0) && (
            <div className="border-t border-gray-100 px-4 py-3 text-[12px] text-gray-600 dark:border-[#1f1f1f] dark:text-zinc-400">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-[.05em] text-gray-500 dark:text-zinc-500">Reviewer declarations</span>
                {f.additional_reviewers.saved_forms > 0 && (
                  <Link href="/results?tab=manual" className="text-[12px] text-gray-600 underline-offset-2 hover:underline dark:text-zinc-400">
                    Additional reviewers: {f.additional_reviewers.saved_forms} saved form{f.additional_reviewers.saved_forms === 1 ? '' : 's'} →
                  </Link>
                )}
              </div>
              <ul className="m-0 mt-2 flex list-none flex-col gap-1.5 p-0">
                {f.seats.map(s => (
                  <li key={`${s.seat}:${s.user_id}`} className="flex items-center gap-2">
                    <SeatBadge seat={s.seat} />
                    <span>
                      {s.name}: <b className="font-semibold text-[#0a0a0a] dark:text-zinc-100">{s.finished}</b> finished · {s.in_progress} in progress · {s.pending} pending · {s.skipped} skipped
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { HomeEnvelope, HomeWork } from '@/types/home';
import { continueTasks, seatRole, type ContinueTask } from '../_lib/continueTasks';
import { WF, wfText } from '../_lib/tokens';
import { SeatBadge, SectionError, SectionHeader, SkeletonRows, useIsDark } from './ui';

type Q = { data?: HomeEnvelope<HomeWork>; isLoading: boolean; isError: boolean; refetch: () => void };

function useTasks(q: Q) {
  const work = q.data?.status === 'ready' ? q.data.data : null;
  const tasks = useMemo(() => (work ? continueTasks(work) : []), [work]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  // A refresh that removes the chosen task falls back to the rule's pick.
  useEffect(() => { if (currentId && !tasks.some(t => t.id === currentId)) setCurrentId(null); }, [tasks, currentId]);
  const current = tasks.find(t => t.id === currentId) ?? tasks[0] ?? null;
  const others = tasks.filter(t => t !== current);
  return { work, tasks, current, others, setCurrentId };
}

function PrimaryLink({ href, className }: { href: string; className?: string }) {
  return (
    <Link href={href}
      className={cn('inline-flex h-[38px] items-center justify-center gap-1.5 whitespace-nowrap rounded-[7px] bg-[#0a0a0a] px-4 text-[13px] font-semibold text-white hover:bg-[#1f2937] dark:bg-zinc-100 dark:text-gray-900 dark:hover:bg-white', className)}>
      Continue <ArrowRight className="h-3.5 w-3.5" />
    </Link>
  );
}

function OthersPicker({ others, open, setOpen, pick }: {
  others: ContinueTask[]; open: boolean; setOpen: (v: boolean) => void; pick: (id: string) => void;
}) {
  if (!others.length) return null;
  return (
    <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}
      className="inline-flex items-center gap-1 border-0 bg-transparent p-0 text-[12px] text-gray-500 hover:text-[#0a0a0a] dark:text-zinc-400 dark:hover:text-zinc-100">
      {others.length} other resumable <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
    </button>
  );
}

function OthersList({ others, pick }: { others: ContinueTask[]; pick: (id: string) => void }) {
  return (
    <ul className="m-0 flex list-none flex-col p-0">
      {others.map(t => (
        <li key={t.id}>
          <button type="button" onClick={() => pick(t.id)}
            className="flex w-full items-center gap-2.5 border-0 border-t border-gray-100 bg-transparent px-4 py-2.5 text-left hover:bg-[#fafafa] dark:border-[#1f1f1f] dark:hover:bg-[#161616]">
            <SeatBadge seat={t.seat} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-[#0a0a0a] dark:text-zinc-100">{t.label}</span>
              <span className="block truncate text-[12px] text-gray-500 dark:text-zinc-400">{t.workflow} · {t.saved}</span>
            </span>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-gray-400" />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Overview's right-hand card. */
export function ContinueCard({ q, readOnly }: { q: Q; readOnly: boolean }) {
  const dark = useIsDark();
  const { work, tasks, current, others, setCurrentId } = useTasks(q);
  const [open, setOpen] = useState(false);
  const pick = (id: string) => { setCurrentId(id); setOpen(false); };

  if (readOnly) return null;

  // Manager without personal work: the top blocking item for the project.
  const next = !current && work ? work.attention[0] ?? null : null;
  if (work && !current && !next) return null;

  return (
    <section aria-labelledby="cont-h"
      className="flex min-w-0 flex-[1_1_280px] flex-col rounded-xl border border-gray-200 bg-white dark:border-[#1f1f1f] dark:bg-[#111111]">
      <SectionHeader id="cont-h" title={next ? 'Next for the project' : 'Continue your work'}
        right={current ? <span className="text-[12px] text-gray-500 dark:text-zinc-400">{tasks.length} resumable</span> : null} />
      {q.isLoading && <SkeletonRows rows={3} />}
      {q.isError && <SectionError what="your work" onRetry={q.refetch} />}

      {current && (
        <>
          <div className="flex flex-1 flex-col gap-1 p-4">
            <span className="text-[11px] font-bold uppercase tracking-[.1em]" style={{ color: wfText(current.wf, dark) }}>{current.eyebrow}</span>
            <span className="text-[18px] font-semibold leading-[26px] text-[#0a0a0a] dark:text-zinc-100">{current.label}</span>
            <span className="text-[13px] text-gray-600 dark:text-zinc-400">{current.workflow}</span>
            <span className="mt-1.5 flex items-center gap-2 text-[12px] text-gray-500 dark:text-zinc-400">
              <SeatBadge seat={current.seat} /> {seatRole(current.seat)} · {current.saved}
            </span>
            <PrimaryLink href={current.href} className="mt-4 w-full" />
            <div className="mt-2.5"><OthersPicker others={others} open={open} setOpen={setOpen} pick={pick} /></div>
          </div>
          {open && <OthersList others={others} pick={pick} />}
        </>
      )}

      {next && (
        <div className="flex flex-1 flex-col gap-1 p-4">
          <span className="text-[11px] font-bold uppercase tracking-[.1em]" style={{ color: wfText(next.workflow, dark) }}>Next step</span>
          <span className="text-[18px] font-semibold leading-[26px] text-[#0a0a0a] dark:text-zinc-100">{next.title}</span>
          <span className="text-[13px] text-gray-600 dark:text-zinc-400">{next.reason}</span>
          <Link href={next.href}
            className="mt-4 inline-flex h-[38px] w-full items-center justify-center gap-1.5 rounded-[7px] bg-[#0a0a0a] px-4 text-[13px] font-semibold text-white hover:bg-[#1f2937] dark:bg-zinc-100 dark:text-gray-900">
            {next.action} <ArrowRight className="h-3.5 w-3.5" />
          </Link>
          <p className="m-0 mt-2.5 text-[12px] text-gray-500 dark:text-zinc-400">You have no reviewer assignments in this project.</p>
        </div>
      )}
    </section>
  );
}

/** My work's full-width card with the workflow accent bar. */
export function ContinueWide({ q, readOnly }: { q: Q; readOnly: boolean }) {
  const dark = useIsDark();
  const { current, others, setCurrentId } = useTasks(q);
  const [open, setOpen] = useState(false);
  const pick = (id: string) => { setCurrentId(id); setOpen(false); };
  if (readOnly || !current) return null;
  return (
    <section aria-label="Continue your work"
      className="relative overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-[#1f1f1f] dark:bg-[#111111]">
      <span aria-hidden className="absolute inset-y-0 left-0 w-[3px]" style={{ background: current.wf === 'neutral' && dark ? '#e4e4e7' : WF[current.wf].color }} />
      <div className="flex flex-wrap items-center gap-4 py-4 pl-5 pr-4">
        <div className="min-w-0 flex-[1_1_320px]">
          <div className="text-[11px] font-bold uppercase tracking-[.1em]" style={{ color: wfText(current.wf, dark) }}>
            Continue · {current.eyebrow}
          </div>
          <div className="mt-1 text-[18px] font-semibold leading-[26px] text-[#0a0a0a] dark:text-zinc-100">
            {current.label} <span className="text-[14px] font-normal text-gray-500 dark:text-zinc-400">· {current.workflow}</span>
          </div>
          <div className="mt-1.5 flex items-center gap-2 text-[12px] text-gray-500 dark:text-zinc-400">
            <SeatBadge seat={current.seat} /> {seatRole(current.seat)} · {current.saved}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <PrimaryLink href={current.href} />
          <OthersPicker others={others} open={open} setOpen={setOpen} pick={pick} />
        </div>
      </div>
      {open && <OthersList others={others} pick={pick} />}
    </section>
  );
}

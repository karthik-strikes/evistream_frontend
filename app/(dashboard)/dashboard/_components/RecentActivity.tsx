'use client';

import Link from 'next/link';
import type { Activity } from '@/types/api';
import type { Workflow } from '@/types/home';
import { relTime, SectionError, Swatch } from './ui';

// Personal feed only — /activities is per-user. Never renamed "Team activity".
const KIND: Record<string, { wf: Workflow; href: string }> = {
  upload: { wf: 'documents', href: '/documents' },
  extraction: { wf: 'ai', href: '/extractions' },
  code_generation: { wf: 'forms', href: '/forms' },
  form_create: { wf: 'forms', href: '/forms' },
  export: { wf: 'consensus', href: '/results' },
  project_create: { wf: 'neutral', href: '/projects' },
};

export function RecentActivity({ q }: { q: { data?: Activity[]; isLoading: boolean; isError: boolean; refetch: () => void } }) {
  const rows = q.data ?? [];
  return (
    <section aria-labelledby="act-h">
      <div className="flex items-center justify-between gap-3 pb-1">
        <h2 id="act-h" className="m-0 text-[11px] font-semibold uppercase tracking-[.05em] text-gray-500 dark:text-zinc-500">Your recent activity</h2>
        <Link href="/activity" className="text-[12px] font-medium text-gray-500 hover:text-[#0a0a0a] dark:text-zinc-400 dark:hover:text-zinc-100">All activity</Link>
      </div>
      {q.isLoading && <div className="home-pulse mt-2 h-3 w-1/2 rounded bg-gray-100 dark:bg-[#1f1f1f]" />}
      {q.isError && <SectionError what="your recent activity" onRetry={q.refetch} className="mx-0" />}
      {!q.isLoading && !q.isError && rows.length === 0 && (
        <p className="m-0 py-2 text-[13px] text-gray-500 dark:text-zinc-400">No activity in this project yet.</p>
      )}
      <ul className="m-0 flex list-none flex-col p-0">
        {rows.map(a => {
          const k = KIND[a.action_type] ?? { wf: 'neutral' as Workflow, href: '/activity' };
          return (
            <li key={a.id} className="flex min-w-0 items-center gap-2.5 border-b border-gray-100 py-2 text-[13px] last:border-b-0 dark:border-[#1f1f1f]">
              <span className="scale-75"><Swatch wf={k.wf} /></span>
              <span className="shrink-0 text-gray-600 dark:text-zinc-400">{a.action}</span>
              <Link href={k.href} className="min-w-0 flex-1 truncate font-medium text-[#0a0a0a] no-underline hover:underline dark:text-zinc-100">
                {a.description}
              </Link>
              <span className="shrink-0 text-[12px] text-gray-400 dark:text-zinc-500">{relTime(a.created_at)}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

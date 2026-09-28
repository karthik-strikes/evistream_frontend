'use client';

import Link from 'next/link';
import type { HomeEnvelope, HomeWork } from '@/types/home';
import { Pill, Restricted, SectionError, SectionHeader, SkeletonRows, Swatch } from './ui';

const MAX = 5;

export function AttentionList({ q, readOnly }: {
  q: { data?: HomeEnvelope<HomeWork>; isLoading: boolean; isError: boolean; refetch: () => void };
  readOnly: boolean;
}) {
  const w = q.data?.status === 'ready' ? q.data.data : null;
  const items = w?.attention ?? [];
  const waiting = w?.waiting ?? [];

  return (
    <section aria-labelledby="attn-h"
      className="flex min-w-0 flex-[2_1_420px] flex-col rounded-xl border border-gray-200 bg-white dark:border-[#1f1f1f] dark:bg-[#111111]">
      <SectionHeader id="attn-h" title="Needs attention"
        right={items.length > MAX ? <span className="text-[12px] font-medium text-gray-500 dark:text-zinc-400">{`All ${items.length}`}</span> : null} />

      {q.isLoading && <SkeletonRows rows={4} />}
      {q.isError && <SectionError what="what needs attention" onRetry={q.refetch} />}
      {q.data && q.data.status !== 'ready' && <Restricted message={q.data.message} />}

      {w && (
        <>
          {items.length === 0 && waiting.length === 0 && (
            <p className="m-0 px-4 py-3.5 text-[13px] text-gray-500 dark:text-zinc-400">No actions needed here.</p>
          )}
          {items.length > 0 && (
            <ul className="m-0 flex list-none flex-col p-0">
              {items.slice(0, MAX).map(it => (
                <li key={it.id} className="border-b border-gray-100 last:border-b-0 dark:border-[#1f1f1f]">
                  <Link href={it.href}
                    className="flex items-center gap-3 px-4 py-[11px] text-[#0a0a0a] no-underline hover:bg-[#fafafa] dark:text-zinc-100 dark:hover:bg-[#161616]">
                    <Swatch wf={it.workflow} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium leading-[18px]">{it.title}</span>
                      <span className="block text-[12px] leading-4 text-gray-500 dark:text-zinc-400">{it.reason}</span>
                    </span>
                    {!readOnly && (
                      <span className="inline-flex h-7 items-center whitespace-nowrap rounded-[6px] border border-gray-200 bg-white px-2.5 text-[12px] font-medium dark:border-[#2a2a2a] dark:bg-[#111111]">
                        {it.action}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {items.length === 0 && waiting.length > 0 && (
            <p className="m-0 px-4 pt-3.5 text-[13px] text-gray-500 dark:text-zinc-400">No actions needed here.</p>
          )}
          {waiting.length > 0 && (
            <>
              <div className="px-4 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-[.05em] text-gray-400 dark:text-zinc-500">Waiting on others</div>
              <ul className="m-0 flex list-none flex-col p-0 pb-1.5">
                {waiting.map(x => (
                  <li key={x.id} className="flex items-center gap-3 px-4 py-2 text-gray-500 dark:text-zinc-400">
                    <Swatch wf={x.workflow} outline />
                    <span className="min-w-0 flex-1 text-[13px]">
                      <span className="font-medium text-gray-600 dark:text-zinc-300">{x.title}</span> <span>· {x.reason}</span>
                    </span>
                    <Pill tone="slate">Waiting · {x.who}</Pill>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}

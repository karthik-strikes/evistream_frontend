'use client';

import Link from 'next/link';
import type { CSSProperties } from 'react';
import type { HomeContext, HomeEnvelope, Workflow } from '@/types/home';
import { WF } from '../_lib/tokens';
import { plural, Restricted, SectionError, useIsDark } from './ui';

/**
 * Project context: Documents · Extraction forms · Processing.
 *
 * DELIBERATE OVERRIDE of dashboard-page-design.md §5 ("avoid animated
 * count-up/glow effects"): the product owner asked to keep the traffic-light
 * hover on these numbers. Hover only, no count-up, and `prefers-reduced-motion`
 * drops the transition. Don't "fix" it back to the doc.
 */
interface Cell { key: string; wf: Workflow; label: string; n: number; unit: string; sub: string; href: string }

function cells(c: HomeContext): Cell[] {
  const d = c.documents;
  const f = c.forms;
  const out: Cell[] = [
    {
      key: 'docs', wf: 'documents', label: 'Documents', n: d.total, unit: d.total === 1 ? 'record' : 'records',
      sub: [
        `${d.ready} ready for extraction`,
        d.need_source ? `${d.need_source} need source material` : null,
        d.metadata_only_accepted ? `${d.metadata_only_accepted} accepted metadata-only` : null,
        d.processing ? `${d.processing} processing` : null,
        d.failed ? `${d.failed} failed processing` : null,
      ].filter(Boolean).join(' · '),
      href: '/documents',
    },
    {
      key: 'forms', wf: 'forms', label: 'Extraction forms', n: f.active, unit: 'active',
      sub: [
        f.in_setup ? `${f.in_setup} in setup` : null,
        f.awaiting_review ? `${f.awaiting_review} awaiting plan review` : null,
        f.failed ? `${f.failed} failed to build` : null,
        'RoB forms tracked in their module',
      ].filter(Boolean).join(' · '),
      href: '/forms',
    },
  ];
  // Omitted when idle (§3B).
  if (c.processing) {
    const p = c.processing;
    out.push({
      key: 'proc', wf: 'ai', label: 'Processing', n: p.running, unit: 'running',
      sub: [`${p.queued} queued`, p.failed ? `${plural(p.failed, 'failed')}` : null].filter(Boolean).join(' · '),
      href: '/jobs',
    });
  }
  return out;
}

export function ContextStrip({ q }: { q: { data?: HomeEnvelope<HomeContext>; isLoading: boolean; isError: boolean; refetch: () => void } }) {
  const dark = useIsDark();
  return (
    <section aria-label="Project context"
      className="relative overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-[#1f1f1f] dark:bg-[#111111]">
      <style>{CONTEXT_GLOW_CSS}</style>
      <div aria-hidden className="h-[2px]" style={{ background: 'linear-gradient(90deg,#F0536B 0%,#F5A623 50%,#4F86F7 100%)' }} />

      {q.isLoading && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
          {[0, 1, 2].map(i => (
            <div key={i} className="flex h-24 flex-col gap-3 px-5 py-[18px]">
              <div className="home-pulse h-2.5 w-2/5 rounded bg-gray-100 dark:bg-[#1f1f1f]" />
              <div className="home-pulse h-6 w-[30%] rounded bg-gray-100 dark:bg-[#1f1f1f]" />
            </div>
          ))}
        </div>
      )}
      {q.isError && <SectionError what="project context" onRetry={q.refetch} />}
      {q.data && q.data.status !== 'ready' && <Restricted message={q.data.message} />}

      {q.data?.status === 'ready' && q.data.data && (
        <div className="flex flex-wrap gap-px bg-gray-100 dark:bg-[#1f1f1f]">
          {cells(q.data.data).map(c => {
            const t = WF[c.wf];
            const vars = {
              '--wf': t.color,
              '--wf-text': dark ? t.darkText : t.text,
              '--wf-tint': dark ? t.darkTint : t.tint,
              '--wf-glow': `${t.color}66`,
              '--wf-glow2': `${t.color}26`,
            } as CSSProperties;
            return (
              <Link key={c.key} href={c.href} style={vars}
                className="ctx-cell relative flex min-w-0 flex-[1_1_220px] flex-col gap-1.5 overflow-hidden bg-white px-5 pb-4 pt-[18px] text-[#0a0a0a] no-underline dark:bg-[#111111] dark:text-zinc-100">
                <span aria-hidden className="ctx-corner absolute left-2.5 top-2.5 h-2 w-2 border-l-[1.5px] border-t-[1.5px]" />
                <span aria-hidden className="ctx-corner absolute right-2.5 top-2.5 h-2 w-2 border-r-[1.5px] border-t-[1.5px]" />
                <span className="ctx-label text-[11px] font-bold uppercase tracking-[.12em]">{c.label}</span>
                <span className="flex flex-wrap items-baseline gap-2">
                  <span className="ctx-num text-[30px] font-extrabold leading-8 tracking-[-.03em] tabular-nums">{c.n}</span>
                  <span className="text-[13px] font-medium text-gray-700 dark:text-zinc-300">{c.unit}</span>
                </span>
                <span className="text-[12px] leading-4 text-gray-500 dark:text-zinc-400">{c.sub}</span>
                <span aria-hidden className="ctx-bar absolute inset-x-0 bottom-0 h-[2px]" />
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** Also used by the Projects page cards; `.glow-scope:hover` lights every
 *  number inside a hovered container, `.ctx-cell:hover` just the one cell. */
export const CONTEXT_GLOW_CSS = `
.ctx-cell {
  background-image: radial-gradient(#ececef 1px, transparent 1px);
  background-size: 14px 14px;
  transition: background-color .3s ease;
}
.dark .ctx-cell { background-image: radial-gradient(rgba(255,255,255,.06) 1px, transparent 1px); }
.ctx-label { color: var(--wf-text); }
.ctx-corner { border-color: var(--wf); opacity: .45; transition: opacity .3s ease; }
.ctx-num { transition: color .3s ease, text-shadow .3s ease; }
.ctx-bar { background: linear-gradient(90deg, transparent, var(--wf), transparent); opacity: 0; transition: opacity .35s ease; }
.ctx-cell:hover, .ctx-cell:focus-visible { background-color: var(--wf-tint); }
.ctx-cell:hover .ctx-num, .ctx-cell:focus-visible .ctx-num,
.glow-scope:hover .ctx-num, .glow-scope:focus-within .ctx-num {
  color: var(--wf-text);
  text-shadow: 0 0 22px var(--wf-glow), 0 0 44px var(--wf-glow2);
}
.ctx-cell:hover .ctx-corner, .ctx-cell:focus-visible .ctx-corner,
.glow-scope:hover .ctx-corner { opacity: 1; }
.ctx-cell:hover .ctx-bar, .ctx-cell:focus-visible .ctx-bar { opacity: 1; }
@media (prefers-reduced-motion: reduce) {
  .ctx-cell, .ctx-corner, .ctx-num, .ctx-bar { transition: none; }
}
`;

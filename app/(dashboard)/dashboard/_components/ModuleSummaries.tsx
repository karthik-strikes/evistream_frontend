'use client';

import Link from 'next/link';
import type { HomeEnvelope, HomeRob, HomeSynthesis, HomeSynthesisRow } from '@/types/home';
import { Pill, QuietLink, Restricted, SectionError, SectionHeader, SkeletonRows, SmallLinkButton, type HomeTone } from './ui';

type Q<T> = { data?: HomeEnvelope<T>; isLoading: boolean; isError: boolean; refetch: () => void };

function NotSetUp({ title, body, action, canSetUp }: { title: string; body: string; action: { href: string; label: string }; canSetUp: boolean }) {
  return (
    <div className="px-4 py-4 text-[13px]">
      <p className="m-0 font-medium text-[#0a0a0a] dark:text-zinc-100">{title}</p>
      <p className="m-0 mt-1 text-gray-500 dark:text-zinc-400">{body}</p>
      <p className="m-0 mt-2.5">
        {canSetUp
          ? <Link href={action.href} className="text-[13px] font-medium text-[#0a0a0a] underline underline-offset-2 dark:text-zinc-100">{action.label} →</Link>
          : <span className="text-[12px] text-gray-500 dark:text-zinc-400">A project manager sets this up.</span>}
      </p>
    </div>
  );
}

// ── Risk of bias ─────────────────────────────────────────────────────────────
// Operational progress only. Judgement colours stay in the RoB module.

export function RobSummary({ q, canSetUp }: { q: Q<HomeRob>; canSetUp: boolean }) {
  const r = q.data?.status === 'ready' ? q.data.data : null;
  const total = r?.targets_total ?? 0;
  const w = (n: number) => `${total ? Math.min(100, (n / total) * 100) : 0}%`;
  return (
    <section aria-labelledby="rob-h" className="flex min-w-0 flex-[1_1_340px] flex-col rounded-xl border border-gray-200 bg-white dark:border-[#1f1f1f] dark:bg-[#111111]">
      <SectionHeader id="rob-h" title="Risk of bias"
        right={r ? <Pill tone="neutral">RoB 2 · {r.scope === 'result' ? 'result' : 'outcome'} level</Pill> : null} />
      {q.isLoading && <SkeletonRows rows={4} />}
      {q.isError && <SectionError what="the risk-of-bias summary" onRetry={q.refetch} />}
      {q.data?.status === 'restricted' && <Restricted message={q.data.message} />}
      {q.data?.status === 'not_configured' && (
        <NotSetUp title="Risk of bias is not set up."
          body="Set the review protocol — scope, effect of interest and reviewers — before assessments can start."
          action={{ href: '/risk-of-bias?screen=protocol', label: 'Set up protocol' }} canSetUp={canSetUp} />
      )}
      {r && (
        <>
          <div className="px-4 pt-4">
            <div className="flex items-baseline gap-1.5">
              <span className="text-[16px] font-bold tabular-nums text-[#0a0a0a] dark:text-zinc-100">{r.both_complete} / {total}</span>
              <span className="text-[12px] text-gray-500 dark:text-zinc-400">targets with both reviewers complete</span>
            </div>
            <div className="mt-2 flex h-1 overflow-hidden rounded-full bg-gray-100 dark:bg-[#1f1f1f]">
              <div className="h-full bg-[#0a0a0a] dark:bg-zinc-200" style={{ width: w(r.both_complete) }} />
              <div className="h-full bg-[#94a3b8]" style={{ width: w(r.one_complete) }} />
            </div>
            <p className="m-0 mt-1.5 text-[11px] text-gray-500 dark:text-zinc-400">
              {r.studies} stud{r.studies === 1 ? 'y' : 'ies'} · light segment = one reviewer complete
            </p>
          </div>
          <dl className="m-0 flex flex-col px-4 py-3 text-[13px]">
            {([
              ['Waiting for R2 / R1', `${r.waiting_r2} / ${r.waiting_r1}`, null],
              ['Consensus decision needed', String(r.consensus_needed), r.consensus_needed ? '/risk-of-bias?screen=dashboard' : null],
              ['Held: unsupported design', String(r.held), r.held ? '/risk-of-bias?screen=mapping' : null],
            ] as const).map(([k, v, href]) => (
              <div key={k} className="flex items-center justify-between border-b border-gray-100 py-1.5 last:border-b-0 dark:border-[#1f1f1f]">
                <dt className="text-gray-600 dark:text-zinc-400">{k}</dt>
                <dd className="m-0 font-semibold tabular-nums text-[#0a0a0a] dark:text-zinc-100">
                  {href ? <Link href={href} className="no-underline hover:underline">{v} →</Link> : v}
                </dd>
              </div>
            ))}
          </dl>
          <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 px-4 py-3 text-[12px] text-gray-500 dark:border-[#1f1f1f] dark:text-zinc-400">
            <span>Operational progress only; judgements are shown in the module.</span>
            <QuietLink href="/risk-of-bias?screen=dashboard" className="text-[#0a0a0a] dark:text-zinc-100">Open assessments →</QuietLink>
          </div>
        </>
      )}
    </section>
  );
}

// ── Synthesis ────────────────────────────────────────────────────────────────

const STATE: Record<HomeSynthesisRow['state'], { tone: HomeTone; label: string }> = {
  needs_review: { tone: 'slate', label: 'Needs review' },
  awaiting: { tone: 'blue', label: 'Awaiting approval' },
  draft: { tone: 'gray', label: 'Draft' },
  in_progress: { tone: 'gray', label: 'In progress' },
  ready: { tone: 'green', label: 'Ready' },
  finalized: { tone: 'green', label: 'Finalized' },
};

const FRESH: Record<HomeSynthesisRow['freshness'], string> = {
  fresh: 'matches current source data',
  stale: 'source data changed',
  unverified: 'freshness unverified',
};

export function SynthesisSummary({ q, canSetUp, readOnly }: { q: Q<HomeSynthesis>; canSetUp: boolean; readOnly: boolean }) {
  const s = q.data?.status === 'ready' ? q.data.data : null;
  return (
    <section aria-labelledby="syn-h" className="flex min-w-0 flex-[1_1_340px] flex-col rounded-xl border border-gray-200 bg-white dark:border-[#1f1f1f] dark:bg-[#111111]">
      <SectionHeader id="syn-h" title="Synthesis" right={s ? <QuietLink href="/synthesis">Open syntheses</QuietLink> : null} />
      {q.isLoading && <SkeletonRows rows={3} />}
      {q.isError && <SectionError what="the synthesis summary" onRetry={q.refetch} />}
      {q.data?.status === 'restricted' && <Restricted message={q.data.message} />}
      {q.data?.status === 'not_configured' && (
        <NotSetUp title="Synthesis is not set up."
          body="Group comparable outcomes into a synthesis to run meta-analyses or structured summaries."
          action={{ href: '/synthesis', label: 'Create synthesis group' }} canSetUp={canSetUp} />
      )}
      {s && (
        <>
          <ul className="m-0 flex list-none flex-col p-0">
            {s.groups.map(g => {
              const st = STATE[g.state] ?? STATE.draft;
              const href = `/synthesis?screen=workspace&id=${encodeURIComponent(g.id)}`;
              const kind = g.branch === 'swim' ? 'Structured summary' : 'Meta-analysis';
              return (
                <li key={g.id} className="flex items-center gap-3 border-b border-gray-100 px-4 py-2.5 last:border-b-0 dark:border-[#1f1f1f]">
                  <span className="min-w-0 flex-1">
                    <Link href={href} className="block truncate text-[13px] font-medium text-[#0a0a0a] no-underline hover:underline dark:text-zinc-100">{g.title}</Link>
                    <span className="block text-[12px] text-gray-500 dark:text-zinc-400">
                      {kind}{g.version ? ` · v${g.version} saved · ${FRESH[g.freshness]}` : ''}
                    </span>
                  </span>
                  <Pill tone={st.tone}>{st.label}</Pill>
                  {g.can_approve && !readOnly && <SmallLinkButton href={`${href}&tab=results`} primary>Approve</SmallLinkButton>}
                </li>
              );
            })}
          </ul>
          <p className="m-0 mt-auto border-t border-gray-100 px-4 py-3 text-[12px] text-gray-400 dark:border-[#1f1f1f] dark:text-zinc-500">
            Statuses are saved-version states. Freshness against current source data is computed separately; &lsquo;unverified&rsquo; means that check has not completed.
          </p>
        </>
      )}
    </section>
  );
}

'use client';

/**
 * First visit — the checklist of review-level decisions RoB 2 judgments depend
 * on, each reflecting live state (the stored protocol and the candidate build),
 * each row carrying its own way forward. It is only shown until the protocol is
 * confirmed (page.tsx routes straight to the dashboard afterwards), so there is
 * no "confirmed" state to render here.
 */

import Link from 'next/link';
import type React from 'react';

import { cn } from '@/lib/utils';

import { DESIGN_LABEL, DESIGN_ORDER, TOOL_FOR_DESIGN, type StudyDesign } from '../_lib/robModel';
import { useRob } from '../_lib/useRobData';
import { mappingState, useRobBuild } from './ProtocolScreen';
import { useRobNav } from './robUi';

const EFFECT_LONG = {
  assignment: 'Assignment to intervention',
  adherence: 'Adhering to intervention',
  both: 'Both (chosen per assessment)',
} as const;

interface Step {
  title: string;
  desc: string;
  done: boolean;
  state: string;
  action?: { label: string; go: () => void };
  groups?: Array<{ key: string; count: number; design: string; tool: string; warn?: boolean }>;
}

function Arrow() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#d4d4d8" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

export function WelcomeScreen() {
  const rob = useRob();
  const { go } = useRobNav();
  const src = useRobBuild();
  const { protocol } = rob;

  const forms = src.forms;
  const needMap = forms.filter(f => mappingState(f) !== 'confirmed');
  const studies = rob.studies;
  const totalResults = rob.results.filter(r => r.state === 'active').length;

  const counts: Record<StudyDesign, number> = { parallel: 0, cluster: 0, crossover: 0, nrsi: 0 };
  let unconfirmedDesigns = 0;
  for (const s of studies) {
    const { design, confirmed: c } = rob.designOf(s.id);
    if (design) counts[design] += 1;
    if (!design || !c) unconfirmedDesigns += 1;
  }
  const groups: NonNullable<Step['groups']> = DESIGN_ORDER.filter(d => counts[d] > 0)
    .map(d => ({ key: d, count: counts[d], design: DESIGN_LABEL[d], tool: TOOL_FOR_DESIGN[d] }));
  if (unconfirmedDesigns) {
    groups.push({ key: 'unconfirmed', count: unconfirmedDesigns, design: 'awaiting reviewer confirmation', tool: 'at first assessment', warn: true });
  }

  const r1 = protocol.reviewers?.reviewer_1;
  const r2 = protocol.reviewers?.reviewer_2;
  const toProtocol = () => go({ screen: 'protocol' });

  const steps: Step[] = [
    {
      title: 'Result sources and column mapping',
      desc: `${forms.length} outcome form${forms.length === 1 ? '' : 's'} ticked as sources${needMap.length ? `; ${needMap.length} still need${needMap.length === 1 ? 's' : ''} its column mapping confirmed` : '; all mappings confirmed'}. Results are derived from these rows.`,
      done: !src.loading && needMap.length === 0,
      state: needMap.length ? `${needMap.length} to confirm` : 'Confirmed',
      action: needMap.length
        ? { label: 'Confirm mapping →', go: () => go({ screen: 'mapping', form: needMap[0].form_id }) }
        : { label: 'Review sources →', go: toProtocol },
    },
    {
      title: 'Study designs',
      desc: `${studies.length} studies. Each study’s design is confirmed by the reviewer at the start of its first assessment; the design picks the tool.`,
      done: studies.length > 0 && unconfirmedDesigns === 0,
      state: `${studies.length - unconfirmedDesigns} of ${studies.length} confirmed`,
      groups,
    },
    {
      title: 'Assessment scope',
      desc: 'Result scope (RoB 2 default) or outcome scope: one assessment per result, or one per outcome.',
      done: !!protocol.scope,
      state: protocol.scope ? (protocol.scope === 'outcome' ? 'Outcome' : 'Result') : 'Not set',
      action: { label: 'Set →', go: toProtocol },
    },
    {
      title: 'Effect of interest',
      desc: 'Assignment to intervention (ITT), adhering to intervention (per-protocol), or both. Drives the Domain 2 questions.',
      done: !!protocol.effect,
      state: protocol.effect ? EFFECT_LONG[protocol.effect] : 'Not set',
      action: { label: 'Set →', go: toProtocol },
    },
    {
      title: 'Reviewers',
      desc: 'Two independent reviewers, blinded to each other until both complete, plus a consensus reviewer for disagreements.',
      done: !!r1 && !!r2,
      state: r1 && r2 ? `${rob.nameOf(r1)} · ${rob.nameOf(r2)}` : 'Not set',
      action: { label: 'Assign →', go: toProtocol },
    },
  ];

  return (
    <div className="mx-auto mt-12 flex w-full max-w-[720px] flex-col gap-6 pb-16">
      <div className="flex flex-col gap-2">
        <span className="text-[12px] font-semibold uppercase tracking-[.05em] text-[#6b7280] dark:text-zinc-500">
          Risk of Bias · {rob.projectName || 'this project'}
        </span>
        <h2 className="m-0 text-[24px] font-bold tracking-[-.01em] text-[#0a0a0a] dark:text-zinc-100">
          Set the review protocol before assessing
        </h2>
        <p className="m-0 text-[14px] leading-[21px] text-[#6b7280] dark:text-zinc-400" style={{ textWrap: 'pretty' } as React.CSSProperties}>
          RoB 2 judgments depend on decisions made once for the whole review. All of them live on one screen, Review protocol; every assessment is then judged against the same rules and the choices are logged for the methods section.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-[#e5e7eb] bg-white dark:border-[#1f1f1f] dark:bg-[#111111]">
        {steps.map((w, i) => (
          <div key={w.title} className="border-b border-[#f3f4f6] dark:border-[#1a1a1a]">
            <div className="grid grid-cols-[28px_minmax(0,1fr)_auto_auto] items-center gap-3.5 px-5 py-3.5">
              <span className={cn('inline-flex h-[26px] w-[26px] items-center justify-center rounded-full border-[1.5px] text-[12px] font-semibold',
                w.done ? 'border-[#16a34a] bg-[#16a34a] text-white'
                  : 'border-[#e5e7eb] bg-white text-[#6b7280] dark:border-[#2a2a2a] dark:bg-transparent dark:text-zinc-400')}>
                {i + 1}
              </span>
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[14px] font-semibold text-[#0a0a0a] dark:text-zinc-100">{w.title}</span>
                <span className="text-[12px] leading-[17px] text-[#6b7280] dark:text-zinc-400">{w.desc}</span>
              </div>
              <span className={cn('whitespace-nowrap text-[12px] font-medium',
                w.done ? 'text-[#15803d] dark:text-emerald-400' : 'text-[#475569] dark:text-slate-400')}>
                {w.state}
              </span>
              {w.action ? (
                <button type="button" onClick={w.action.go}
                  className="cursor-pointer whitespace-nowrap rounded-[6px] border border-[#e5e7eb] bg-transparent px-2.5 py-[3px] text-[11px] font-medium text-[#374151] hover:bg-[#f9fafb] dark:border-[#2a2a2a] dark:text-zinc-300 dark:hover:bg-[#1a1a1a]">
                  {w.action.label}
                </button>
              ) : (
                <span className="whitespace-nowrap text-[11px] text-[#9ca3af] dark:text-zinc-500">At first assessment</span>
              )}
            </div>
            {w.groups && (
              <>
                <div className="mb-3.5 ml-[62px] mr-5 flex flex-wrap gap-2">
                  {w.groups.map(g => (
                    <div key={g.key}
                      className={cn('flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[12px]',
                        g.warn ? 'border-[#cbd5e1] bg-[#f8fafc] dark:border-slate-700 dark:bg-slate-800/20'
                          : 'border-[#e5e7eb] bg-white dark:border-[#2a2a2a] dark:bg-transparent')}>
                      <span className={cn('font-bold tabular-nums', g.warn ? 'text-[#475569] dark:text-slate-300' : 'text-[#111827] dark:text-zinc-100')}>{g.count}</span>
                      <span className="text-[#374151] dark:text-zinc-300">{g.design}</span>
                      <Arrow />
                      <span className={cn('font-semibold', g.warn ? 'text-[#475569] dark:text-slate-300' : 'text-[#111827] dark:text-zinc-100')}>{g.tool}</span>
                    </div>
                  ))}
                </div>
                <div className="mb-3.5 ml-[62px] mr-5 text-[11px] leading-4 text-[#9ca3af] dark:text-zinc-500">
                  The reviewer confirms each study’s design in the Preliminary step of that study’s first assessment. Nothing to do here.
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <button type="button" onClick={() => go({ screen: 'protocol' })}
          className="flex h-[38px] cursor-pointer items-center gap-1.5 rounded-[7px] border-none bg-[#0a0a0a] px-4 text-[13px] font-semibold text-white hover:bg-[#27272a] dark:bg-zinc-100 dark:text-gray-900 dark:hover:bg-white">
          Set up review protocol
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden><path d="m9 18 6-6-6-6" /></svg>
        </button>
        <span className="text-[12px] text-[#9ca3af] dark:text-zinc-500">About 2 minutes. Only a project admin can change it afterwards.</span>
      </div>

      <div className="flex items-center gap-3.5 rounded-xl border border-dashed border-[#d4d4d8] bg-[#fafafa] px-5 py-3.5 dark:border-[#2a2a2a] dark:bg-[#0d0d0d]">
        <div className="flex flex-1 flex-col gap-0.5">
          <span className="text-[13px] font-semibold text-[#0a0a0a] dark:text-zinc-100">
            {studies.length} studies · {totalResults} extracted results ready to assess
          </span>
          <span className="text-[12px] text-[#6b7280] dark:text-zinc-400">
            Results come from extraction. Add or correct outcomes, time points and comparisons there before assessing.
          </span>
        </div>
        <Link href="/manual-extraction" className="text-[12px] font-medium text-[#374151] underline dark:text-zinc-300">
          Open extractions
        </Link>
      </div>
    </div>
  );
}

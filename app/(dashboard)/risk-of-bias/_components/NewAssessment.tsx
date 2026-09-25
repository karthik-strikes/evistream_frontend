'use client';

/**
 * New assessment (README §4): the reviewer picks WHAT is assessed; how is set by
 * the review protocol and shown read-only beside it.
 *
 * Outcome scope → pick an outcome. Result scope → pick an outcome, then one of
 * its results. Nothing is written here — the Workspace creates the entry on its
 * first save.
 */

import { useEffect, useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useRob } from '../_lib/useRobData';
import {
  DESIGN_SHORT, SEAT_LABEL, TOOL_FOR_DESIGN, designAssessable, isOutcomeKey,
  outcomeTarget, resultTarget, targetTitle, type Target,
} from '../_lib/robModel';
import { Banner, BackLink, Eyebrow, OutlineButton, PrimaryButton, StatusPill, useRobNav } from './robUi';
import { isWaitingRow, resultLine, scopeOf, studyComparisons } from './dashboardModel';

function Radio({ on }: { on: boolean }) {
  return (
    <span className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-[1.5px]',
      on ? 'border-[#0a0a0a] dark:border-zinc-100' : 'border-gray-300 dark:border-zinc-600')}>
      {on && <span className="h-2 w-2 rounded-full bg-[#0a0a0a] dark:bg-zinc-100" />}
    </span>
  );
}

export function NewAssessment() {
  const rob = useRob();
  const { get, go } = useRobNav();
  const studyId = get('study') || rob.studies[0]?.id || '';
  const scope = scopeOf(rob);
  // Rows still waiting for a comparison cannot be assessed yet: the study's
  // comparisons are defined first, on the Comparisons screen.
  const needComps = studyComparisons(rob, studyId).needComps;
  const outcomes = rob.outcomesOfDoc(studyId)
    .map(o => ({ ...o, results: o.results.filter(r => !isWaitingRow(rob, r)) }))
    .filter(o => o.results.length > 0);
  const my = rob.myView(studyId);

  const [outcomeKey, setOutcomeKey] = useState('');
  const [resultId, setResultId] = useState('');

  // Preselect from `?target=` once the registry is in.
  const preset = get('target');
  useEffect(() => {
    if (!preset) return;
    if (isOutcomeKey(preset)) { setOutcomeKey(preset); setResultId(''); return; }
    const r = rob.resultById.get(preset);
    if (r) {
      setOutcomeKey(outcomes.find(o => o.results.some(x => x.id === r.id))?.key ?? '');
      setResultId(r.id);
    }
  }, [preset, rob.resultById, outcomes]);

  const selectedOutcome = outcomes.find(o => o.key === outcomeKey) ?? null;
  const target: Target | null = useMemo(() => {
    if (!selectedOutcome) return null;
    if (scope === 'outcome') return outcomeTarget(selectedOutcome);
    const r = selectedOutcome.results.find(x => x.id === resultId);
    return r ? resultTarget(r) : null;
  }, [selectedOutcome, scope, resultId]);

  const duplicate = !!(target && my?.assessments.has(target.id));
  const { design, confirmed } = rob.designOf(studyId);
  const designBlocked = confirmed && !designAssessable(design);
  const blockReason = !rob.canEdit
    ? 'Recording an assessment needs the "run manual extractions" permission.'
    : designBlocked ? `${TOOL_FOR_DESIGN[design!]} is not available yet, so this study cannot be assessed.`
      : !target ? (scope === 'outcome' ? 'Pick an outcome.' : 'Pick a result.')
        : duplicate ? 'You already assessed this target.' : '';

  const label = rob.labelOf(studyId);
  const seatWord = rob.mySeat ? `You are ${SEAT_LABEL[rob.mySeat]}` : 'No seat · recorded as an additional assessment';
  const effect = rob.protocol.effect;
  const effectText = effect === 'assignment' ? 'Assignment to intervention'
    : effect === 'adherence' ? 'Adhering to intervention'
      : effect === 'both' ? 'Both (chosen per assessment)' : 'Not set';
  const r = rob.protocol.reviewers ?? { reviewer_1: null, reviewer_2: null, adjudicator: null };
  const who = (id: string | null) => rob.nameOf(id);

  const start = () => {
    if (blockReason || !target) return;
    go({ screen: 'workspace', study: studyId, target: target.id, domain: 0, as: null });
  };

  const summaryMeta = target
    ? [target.kind === 'result' ? resultLine(target.result!) : target.outcomeTarget!.measurements.join(' · '),
      `RoB 2 · effect of ${rob.defaultEffect === 'adherence' ? 'adhering' : 'assignment'}`].filter(Boolean).join(' · ')
    : '';

  return (
    <div className="max-w-[1040px] pb-8">
      <BackLink onClick={() => go({ screen: 'dashboard', study: studyId, target: null })}>{label} · Risk of Bias</BackLink>
      <h2 className="mt-3 text-[20px] font-bold tracking-[-.01em] text-gray-900 dark:text-zinc-100">New assessment</h2>
      <p className="mt-1 text-[13px] text-gray-500 dark:text-zinc-400">
        {label} · {seatWord} · Pick the {scope === 'outcome' ? 'outcome' : 'result'} to assess; everything else is set at project level
      </p>

      <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-[300px_1fr]">
        {/* ── Protocol, read-only ─────────────────────────────────── */}
        <div>
          <Eyebrow className="mb-2">Review protocol</Eyebrow>
          <div className="rounded-xl border border-gray-200 bg-[#fafafa] px-4 py-4 dark:border-[#1f1f1f] dark:bg-[#0d0d0d]">
            <ProtoItem label="Tool" value={`${design ? TOOL_FOR_DESIGN[design] : 'RoB 2'} · guidance 2019-08-22`}
              note={design ? `Derived from study design: ${DESIGN_SHORT[design]}${confirmed ? '' : ' (not yet confirmed)'}` : 'Study design is confirmed in the first step of the assessment.'} />
            <ProtoItem label="Assessment scope" value={scope === 'outcome' ? 'Outcome' : 'Result'}
              note={scope === 'outcome'
                ? 'One judgment per outcome, attached to the outcome itself.'
                : 'One judgment per extracted result (outcome × time point × comparison).'} />
            <ProtoItem label="Effect of interest" value={effectText}
              note="Pre-specified in the protocol. It sets which Domain 2 questions are asked; the answers and judgment are still made per assessment, on each trial's own evidence." />
            <ProtoItem label="Reviewers"
              value={`${who(r.reviewer_1)} · ${who(r.reviewer_2)}${r.adjudicator ? ` · consensus reviewer ${who(r.adjudicator)}` : ''}`}
              note="Two independent reviewers, hidden from each other until both complete; the consensus reviewer resolves disagreements." />
            <div className="mt-3 border-t border-gray-200 pt-3 text-[11px] leading-4 text-gray-500 dark:border-[#1f1f1f] dark:text-zinc-500">
              Pre-specified in the protocol. Studies are judged against it, never re-configured to match what they report.{' '}
              <button type="button" onClick={() => go({ screen: 'protocol' })} className="underline hover:text-gray-900 dark:hover:text-zinc-100">Open review protocol</button>
            </div>
          </div>
        </div>

        {/* ── Target ──────────────────────────────────────────────── */}
        <div className="min-w-0">
          <Eyebrow className="mb-2">Target</Eyebrow>
          {needComps && (
            <Banner tone="slate" className="mb-3"
              action={<OutlineButton small onClick={() => go({ screen: 'comparisons', study: studyId, target: null })}>Define comparisons →</OutlineButton>}>
              This study has more than two arms and no comparison yet, so its rows cannot be assessed until the comparisons are defined.
            </Banner>
          )}
          {!outcomes.length ? (
            <div className="rounded-xl border border-gray-200 bg-white px-5 py-6 text-[13px] text-gray-500 dark:border-[#1f1f1f] dark:bg-[#111111] dark:text-zinc-400">
              {scope === 'outcome'
                ? 'This study has no outcomes yet. Outcomes come from extraction; add or correct them there.'
                : 'This study has no results yet. Results come from extraction; add or correct outcomes, time points and comparisons there.'}
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-[#1f1f1f] dark:bg-[#111111]">
              {outcomes.map(o => {
                const on = o.key === outcomeKey;
                const meta = [o.measurements.join(' · '),
                  scope === 'result' ? `${o.results.length} result${o.results.length === 1 ? '' : 's'}` : '',
                ].filter(Boolean).join(' · ');
                return (
                  <div key={o.key} className="border-b border-gray-100 last:border-b-0 dark:border-[#1a1a1a]">
                    <button type="button" onClick={() => { setOutcomeKey(o.key); if (!on) setResultId(''); }}
                      className={cn('flex w-full items-center gap-3 px-4 py-3 text-left',
                        on ? 'bg-gray-50 dark:bg-[#161616]' : 'hover:bg-gray-50 dark:hover:bg-[#161616]')}>
                      <Radio on={on} />
                      <span className="flex-1 truncate text-[14px] font-medium text-gray-900 dark:text-zinc-100">{o.outcome}</span>
                      {scope === 'outcome' && my?.assessments.has(o.key) && (
                        <span className="text-[11px] font-medium text-[#4338ca] dark:text-indigo-300">Assessed by you</span>
                      )}
                      <span className="truncate text-[12px] text-gray-400">{meta}</span>
                    </button>
                    {on && scope === 'result' && (
                      <div className="flex flex-col gap-2 px-4 pb-3 pl-11">
                        {o.results.map(res => {
                          const sel = res.id === resultId;
                          const mine = my?.assessments.has(res.id);
                          return (
                            <button key={res.id} type="button" onClick={() => setResultId(res.id)}
                              className={cn('flex items-start gap-3 rounded-[10px] border px-3.5 py-3 text-left transition-colors',
                                sel ? 'border-[#0a0a0a] dark:border-zinc-100' : 'border-gray-200 hover:border-gray-300 dark:border-[#2a2a2a]')}>
                              <span className="pt-0.5"><Radio on={sel} /></span>
                              <span className="min-w-0 flex-1">
                                <span className="flex flex-wrap items-baseline gap-2">
                                  <span className="text-[13px] font-semibold text-gray-900 dark:text-zinc-100">{res.timepoint || 'Time point not recorded'}</span>
                                  <span className="text-[12px] text-gray-500 dark:text-zinc-400">
                                    {res.contrast?.intervention ? `${res.contrast.intervention} vs ${res.contrast.comparator}` : 'Comparison not set'}
                                  </span>
                                </span>
                                {resultLine(res) && <span className="mt-0.5 block truncate text-[12px] text-gray-500 dark:text-zinc-500">{resultLine(res)}</span>}
                                {res.state === 'held' && (
                                  <span className="mt-1 block"><StatusPill tone="slate">Comparison needed · set it in the first step</StatusPill></span>
                                )}
                              </span>
                              {mine && <span className="shrink-0 text-[11px] font-medium text-[#4338ca] dark:text-indigo-300">Assessed by you</span>}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {duplicate && target && (
            <Banner tone="indigo" className="mt-3"
              action={<OutlineButton small onClick={() => go({ screen: 'workspace', study: studyId, target: target.id, domain: 0 })}>View existing</OutlineButton>}>
              <strong className="font-semibold">You already assessed this target.</strong> Open it to continue or review it; a target has one assessment per reviewer.
            </Banner>
          )}
          {designBlocked && (
            <Banner tone="slate" className="mt-3">
              This study is a {DESIGN_SHORT[design!].toLowerCase()}. {TOOL_FOR_DESIGN[design!]} is not available yet, so it cannot be assessed.
            </Banner>
          )}
        </div>
      </div>

      {/* ── Sticky footer ─────────────────────────────────────────── */}
      <div className="sticky bottom-4 mt-5 flex flex-wrap items-center gap-4 rounded-xl border border-gray-200 bg-white px-5 py-4 shadow-[0_-4px_20px_rgba(0,0,0,.04)] dark:border-[#1f1f1f] dark:bg-[#111111]">
        <div className="min-w-0 flex-1">
          <Eyebrow className="text-[10.5px] text-gray-400">This assessment will apply to</Eyebrow>
          <div className="mt-1 truncate text-[14px] font-semibold text-gray-900 dark:text-zinc-100">
            {target ? targetTitle(target) : <span className="font-normal text-gray-400">Nothing selected</span>}
          </div>
          {summaryMeta && <div className="mt-0.5 truncate text-[12px] text-gray-500 dark:text-zinc-500">{summaryMeta}</div>}
        </div>
        <OutlineButton onClick={() => go({ screen: 'dashboard', study: studyId, target: null })}>Cancel</OutlineButton>
        <span title={blockReason || undefined}>
          <PrimaryButton disabled={!!blockReason} onClick={start}>Start assessment <ChevronRight className="h-4 w-4" /></PrimaryButton>
        </span>
      </div>
    </div>
  );
}

function ProtoItem({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="mb-3.5 last:mb-0">
      <div className="text-[11px] text-gray-400 dark:text-zinc-500">{label}</div>
      <div className="mt-0.5 text-[13px] font-semibold text-gray-900 dark:text-zinc-100">{value}</div>
      <div className="mt-0.5 text-[11.5px] leading-4 text-gray-500 dark:text-zinc-500">{note}</div>
    </div>
  );
}

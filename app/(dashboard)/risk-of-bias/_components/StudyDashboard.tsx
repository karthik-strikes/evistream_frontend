'use client';

/**
 * Study dashboard (README §3): study list on the left; for the selected study,
 * its assessments and a traffic-light summary.
 *
 * The protocol scope decides what a target is: an outcome at outcome scope, a
 * result at result scope. Assessments of the other scope stay stored but are
 * never listed or counted. Every tile, card, list and the study list count the
 * same targets under one status (`TargetInfo.rowStatus`), so they always agree.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { BarChart3, Pencil, Plus, Search } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useRob } from '../_lib/useRobData';
import {
  DESIGN_SHORT, DOMAIN_SHORT, TOOL_FOR_DESIGN, designAssessable, finalJudgements, targetTitle,
  type Assessment, type AssessmentStatus, type Judgement, type Seat, type StudyDesign,
} from '../_lib/robModel';
import {
  Card, Eyebrow, Light, OutlineButton, PrimaryButton, ProgressBar, Segmented, SeatBadge,
  StatusPill, judgementText, judgementTextClass, useRobNav,
} from './robUi';
import {
  STATUS_WORD, consensusText, isWaitingRow, resultLine, scopeOf, seatStatusText, studyComparisons, studyProgress, studyTargets,
  targetInfo, type ConsensusState, type TargetInfo,
} from './dashboardModel';
import { outcomeTarget, resultTarget } from '../_lib/robModel';

type Filter = 'all' | 'complete' | 'progress' | 'none';
type SummaryView = 'consensus' | 'reviewer_1' | 'reviewer_2';

const ACCENT: Record<AssessmentStatus, string> = {
  complete: 'bg-[#16a34a]', progress: 'bg-[#3b82f6]', none: 'bg-gray-200 dark:bg-[#2a2a2a]',
};

function statusTone(s: AssessmentStatus) {
  return s === 'progress' ? 'blue' as const : s === 'complete' ? 'neutral' as const : 'gray' as const;
}

function consensusClass(c: ConsensusState): string {
  if (c === 'agreed' || c === 'resolved') return 'text-[#15803d] dark:text-emerald-400 font-medium';
  if (c === 'needed') return 'text-[#4338ca] dark:text-indigo-300 font-semibold';
  if (c === 'none') return 'text-gray-400 dark:text-zinc-500';
  return 'text-gray-500 dark:text-zinc-400';
}

function toolLabel(design: StudyDesign | null): string {
  return design ? TOOL_FOR_DESIGN[design] : 'RoB 2';
}

export function StudyDashboard() {
  const rob = useRob();
  const { get, go } = useRobNav();
  const [query, setQuery] = useState('');

  const studyId = get('study') && rob.studies.some(s => s.id === get('study'))
    ? get('study') : rob.studies[0]?.id ?? '';
  const tab = get('tab') === 'summary' ? 'summary' : 'assessments';

  const list = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rob.studies.filter(s => !needle || rob.labelOf(s.id).toLowerCase().includes(needle)
      || (s.title ?? s.filename ?? '').toLowerCase().includes(needle));
  }, [rob, query]);

  if (!rob.studies.length) {
    return (
      <div className="mx-auto mt-12 max-w-[720px]">
        <Card className="px-6 py-8 text-center">
          <div className="text-[15px] font-semibold text-gray-900 dark:text-zinc-100">Nothing to assess yet</div>
          <p className="mx-auto mt-2 max-w-[520px] text-[13px] leading-5 text-gray-500 dark:text-zinc-400">
            What is assessed comes from extraction. Once the outcome forms are ticked as result sources and their
            column mapping is confirmed, each study appears here.
          </p>
          <div className="mt-5 flex justify-center gap-2">
            {rob.canManage
              ? <PrimaryButton onClick={() => go({ screen: 'protocol' })}>Open review protocol</PrimaryButton>
              : <span className="text-[12px] text-gray-400">Ask a project admin to set up the result sources.</span>}
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-5">
      {/* ── Study list ─────────────────────────────────────────────── */}
      <aside className="sticky top-4 w-[236px] shrink-0">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-gray-400" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search studies..."
            className="h-[34px] w-full rounded-[7px] border border-gray-200 bg-white pl-8 pr-2 text-[13px] outline-none focus:border-gray-400 dark:border-[#2a2a2a] dark:bg-[#111111] dark:text-zinc-100" />
        </div>
        <div className="mt-2.5 flex max-h-[calc(100vh-220px)] flex-col gap-2 overflow-y-auto pr-0.5">
          {list.map(s => {
            const { done, total } = studyProgress(rob, s.id);
            const { design } = rob.designOf(s.id);
            const on = s.id === studyId;
            return (
              <button key={s.id} type="button" onClick={() => go({ study: s.id, tab: null, filter: null })}
                className={cn('rounded-[10px] border px-3 py-2.5 text-left transition-colors',
                  on ? 'border-gray-300 bg-gray-100 dark:border-zinc-600 dark:bg-[#1a1a1a]'
                    : 'border-gray-200 bg-white hover:border-gray-300 dark:border-[#1f1f1f] dark:bg-[#111111]')}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[13px] font-semibold text-gray-900 dark:text-zinc-100">{rob.labelOf(s.id)}</span>
                  <span className="shrink-0 text-[11px] text-gray-400">{done}/{total}</span>
                </div>
                <div className="mt-0.5 truncate text-[11px] text-gray-500 dark:text-zinc-500">
                  {design ? `${DESIGN_SHORT[design]} → ${TOOL_FOR_DESIGN[design]}` : 'Design not confirmed'}
                </div>
                <ProgressBar value={total ? done / total : 0} className="mt-2" />
              </button>
            );
          })}
          {!list.length && <div className="px-1 py-3 text-[12px] text-gray-400">No study matches.</div>}
        </div>
        <p className="mt-3 px-1 text-[11px] leading-4 text-gray-400 dark:text-zinc-500">
          Tool, assessment scope and effect of interest are project settings. Reviewers only pick the target.
        </p>
      </aside>

      {/* ── Main ───────────────────────────────────────────────────── */}
      <main className="min-w-0 flex-1">
        {studyId && <StudyMain studyId={studyId} tab={tab} />}
      </main>
    </div>
  );
}

function StudyMain({ studyId, tab }: { studyId: string; tab: 'assessments' | 'summary' }) {
  const rob = useRob();
  const { get, go } = useRobNav();
  const doc = rob.docById.get(studyId);
  const { design, confirmed } = rob.designOf(studyId);
  const blockedDesign = confirmed && !designAssessable(design);
  const comps = studyComparisons(rob, studyId);
  const citation = doc?.title || doc?.filename || '';
  const { all, stored } = useMemo(() => studyTargets(rob, studyId), [rob, studyId]);

  const newTitle = !rob.canEdit
    ? 'Recording an assessment needs the "run manual extractions" permission on this project.'
    : blockedDesign ? `${TOOL_FOR_DESIGN[design!]} is not available yet, so this study cannot be assessed.` : undefined;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[20px] font-bold tracking-[-.01em] text-gray-900 dark:text-zinc-100">{rob.labelOf(studyId)}</h2>
            <StatusPill>{toolLabel(design)}</StatusPill>
            <StatusPill tone={design ? 'neutral' : 'slate'}>{design ? DESIGN_SHORT[design] : 'Design not confirmed'}</StatusPill>
          </div>
          {citation && (
            <div title={citation} className="mt-1 max-w-[720px] truncate text-[12px] text-gray-500 dark:text-zinc-500">{citation}</div>
          )}
          <ReviewerLine />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {comps.needComps && (
            <button type="button" onClick={() => go({ screen: 'comparisons', study: studyId })}
              className="flex h-9 items-center gap-1.5 rounded-[7px] border border-[#cbd5e1] bg-[#f8fafc] px-3 text-[13px] font-semibold text-[#475569] dark:border-slate-700 dark:bg-slate-800/30 dark:text-slate-300">
              Comparisons needed · Define →
            </button>
          )}
          {comps.applies && comps.settled.length > 0 && (
            <OutlineButton onClick={() => go({ screen: 'comparisons', study: studyId })}>Comparisons · {comps.settled.length}</OutlineButton>
          )}
          <OutlineButton onClick={() => go({ screen: 'protocol' })}><Pencil className="h-3.5 w-3.5" />Review protocol</OutlineButton>
          <OutlineButton onClick={() => go({ screen: 'report', tab: null, filter: null })}><BarChart3 className="h-3.5 w-3.5" />Review summary</OutlineButton>
          <span title={newTitle}>
            <PrimaryButton disabled={!!newTitle} onClick={() => go({ screen: 'new', study: studyId, target: null })}>
              <Plus className="h-4 w-4" />New assessment
            </PrimaryButton>
          </span>
        </div>
      </div>

      {blockedDesign && (
        <div className="mt-3 rounded-[10px] border border-[#cbd5e1] bg-[#f8fafc] px-3.5 py-2.5 text-[12.5px] text-[#475569] dark:border-slate-700 dark:bg-slate-800/20 dark:text-slate-300">
          This study is a {DESIGN_SHORT[design!].toLowerCase()}. Its tool, {TOOL_FOR_DESIGN[design!]}, is not available yet,
          so it cannot be assessed. Judging it with the parallel-group questions would miss what that instrument asks.
        </div>
      )}

      <div className="mt-4 flex gap-6 border-b border-gray-200 dark:border-[#1f1f1f]">
        {(['assessments', 'summary'] as const).map(t => (
          <button key={t} type="button" onClick={() => go({ tab: t === 'assessments' ? null : t })}
            className={cn('-mb-px border-b-2 px-3 pb-2 text-[13px]',
              tab === t ? 'border-[#0a0a0a] font-semibold text-gray-900 dark:border-zinc-100 dark:text-zinc-100'
                : 'border-transparent text-gray-500 hover:text-gray-800 dark:text-zinc-400')}>
            {t === 'assessments' ? 'Assessments' : 'Summary'}
            {t === 'assessments' && <span className="ml-1.5 text-[11px] font-normal text-gray-400">{stored.length}</span>}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {tab === 'assessments'
          ? <AssessmentsTab studyId={studyId} all={all} stored={stored} filter={(get('filter') as Filter) || 'all'}
              blocked={blockedDesign || !rob.canEdit} />
          : <SummaryTab studyId={studyId} />}
      </div>
    </div>
  );
}

function ReviewerLine() {
  const rob = useRob();
  const r = rob.protocol.reviewers ?? { reviewer_1: null, reviewer_2: null, adjudicator: null };
  const who = (id: string | null) => (id && id === rob.currentUserId ? 'You' : rob.nameOf(id));
  if (!r.reviewer_1 && !r.reviewer_2 && !r.adjudicator) {
    return <div className="mt-2 text-[12px] text-[#475569] dark:text-slate-400">Reviewers not assigned in the review protocol.</div>;
  }
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-gray-600 dark:text-zinc-400">
      <span className="inline-flex items-center gap-1.5"><SeatBadge seat="reviewer_1" />{who(r.reviewer_1)}</span>
      <span className="inline-flex items-center gap-1.5"><SeatBadge seat="reviewer_2" />{who(r.reviewer_2)}</span>
      <span className="text-gray-400">· judgments hidden until both complete</span>
      {r.adjudicator && <span className="inline-flex items-center gap-1.5"><SeatBadge seat="adjudicator" />{who(r.adjudicator)}</span>}
    </div>
  );
}

// ── Assessments tab ──────────────────────────────────────────────────────────

function AssessmentsTab({ studyId, all, stored, filter, blocked }: {
  studyId: string; all: TargetInfo[]; stored: TargetInfo[]; filter: Filter; blocked: boolean;
}) {
  const rob = useRob();
  const { go } = useRobNav();
  const scope = scopeOf(rob);
  const comps = studyComparisons(rob, studyId);
  const isCR = rob.mySeat === 'adjudicator';
  // Every tile counts the same list under the same status, so they sum to All.
  const count = (st: AssessmentStatus) => all.filter(i => i.rowStatus === st).length;
  const tiles: Array<{ key: Filter; n: number; label: string; accent: string; color: string }> = [
    { key: 'all', n: all.length, label: 'All', accent: 'bg-[#0a0a0a] dark:bg-zinc-100', color: 'text-gray-900 dark:text-zinc-100' },
    { key: 'complete', n: count('complete'), label: 'Complete', accent: 'bg-[#16a34a]', color: 'text-[#15803d] dark:text-emerald-400' },
    { key: 'progress', n: count('progress'), label: 'In progress', accent: 'bg-[#3b82f6]', color: 'text-[#1d4ed8] dark:text-blue-300' },
    { key: 'none', n: count('none'), label: 'Not assessed', accent: 'bg-[#d4d4d8] dark:bg-zinc-600', color: 'text-gray-500 dark:text-zinc-400' },
  ];

  // Cards: every target someone has an assessment of. The list below: targets
  // nobody has touched — never both, so a target is shown once.
  const cards = stored.filter(i => filter === 'all' || i.rowStatus === filter);
  const untouched = all.filter(i => !i.stored);
  const showUntouched = filter === 'all' || filter === 'none';
  const unit = (n: number) => (scope === 'outcome' ? (n === 1 ? 'outcome' : 'outcomes') : (n === 1 ? 'result' : 'results'));

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-gray-200 bg-gray-200 dark:border-[#1f1f1f] dark:bg-[#1f1f1f] sm:grid-cols-4">
        {tiles.map(t => (
          <button key={t.key} type="button" onClick={() => go({ filter: t.key === 'all' ? null : t.key })}
            className={cn('relative px-5 py-4 text-left transition-colors',
              filter === t.key ? 'bg-gray-50 dark:bg-[#161616]' : 'bg-white hover:bg-gray-50 dark:bg-[#111111] dark:hover:bg-[#161616]')}>
            <span className={cn('absolute inset-x-0 top-0 h-[2px]', t.n === 0 ? 'bg-transparent' : t.accent)} />
            <div className={cn('text-[24px] font-bold leading-7', t.n === 0 ? 'text-[#d4d4d8] dark:text-zinc-600' : t.color)}>{t.n}</div>
            <div className="mt-1 text-[12px] text-gray-500 dark:text-zinc-400">{t.label}</div>
          </button>
        ))}
      </div>

      {cards.map(info => <AssessmentCard key={info.target.id} studyId={studyId} info={info} />)}

      {!cards.length && !comps.needComps && !(showUntouched && untouched.length) && (
        <div className="rounded-xl border border-gray-200 bg-white px-5 py-6 text-center text-[13px] text-gray-500 dark:border-[#1f1f1f] dark:bg-[#111111] dark:text-zinc-400">
          {filter === 'all' ? 'No assessments yet for this study.'
            : filter === 'none' ? `Every ${unit(1)} has been started.`
              : `No ${filter === 'complete' ? 'completed' : 'in-progress'} assessments.`}
        </div>
      )}

      {comps.needComps && (
        <div className="flex flex-col gap-1 rounded-[12px] border border-[#cbd5e1] bg-[#f8fafc] px-5 py-3.5 dark:border-slate-700 dark:bg-slate-800/20">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[12px] font-semibold uppercase tracking-[.05em] text-[#475569] dark:text-slate-300">
              Held · {comps.held.length} rows waiting for a comparison
            </div>
            <button type="button" onClick={() => go({ screen: 'comparisons', study: studyId })}
              className="rounded-[6px] border border-[#cbd5e1] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#475569] dark:border-slate-700 dark:bg-transparent dark:text-slate-300">
              Define comparisons →
            </button>
          </div>
          {comps.held.map(r => (
            <div key={r.id} className="flex flex-col gap-0.5 border-t border-[#cbd5e1] py-2 dark:border-slate-700">
              <span className="text-[13px] font-medium text-[#334155] dark:text-slate-300">{[r.outcome_domain, r.timepoint].filter(Boolean).join(' · ')}</span>
              <span className="text-[12px] text-[#475569] dark:text-slate-300">{r.population || 'Overall'} · comparison not yet defined</span>
            </div>
          ))}
        </div>
      )}

      {!comps.needComps && showUntouched && untouched.length > 0 && (
        <div className="rounded-xl border border-dashed border-gray-300 bg-[#fafafa] px-5 py-4 dark:border-zinc-700 dark:bg-[#0d0d0d]">
          <Eyebrow>Not yet assessed · {untouched.length} {unit(untouched.length)}</Eyebrow>
          <div className="mt-2 divide-y divide-gray-200 dark:divide-[#1f1f1f]">
            {untouched.map(info => {
              const t = info.target;
              const sub = t.kind === 'outcome' ? t.outcomeTarget!.measurements.join(' · ') : resultLine(t.result!);
              return (
                <div key={t.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-medium text-gray-900 dark:text-zinc-100">{targetTitle(t)}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[12px] text-gray-500 dark:text-zinc-500">
                      {sub && <span className="truncate">{sub}</span>}
                      {info.held && <StatusPill tone="slate">Comparison needed</StatusPill>}
                    </div>
                  </div>
                  {/* The consensus reviewer does not assess independently. */}
                  {isCR ? (
                    <span className="shrink-0 text-[11px] text-gray-400 dark:text-zinc-500">No reviewer has started</span>
                  ) : (
                    <AssessButton disabled={blocked} onClick={() => go({ screen: 'new', study: studyId, target: t.id })} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/** The black "Assess" action (prototype: 11px/600, padding 5px 10px, radius 6). */
function AssessButton({ disabled, onClick }: { disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick}
      className="shrink-0 rounded-[6px] border-none bg-[#0a0a0a] px-2.5 py-[5px] text-[11px] font-semibold text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-300 dark:bg-zinc-100 dark:text-gray-900 dark:disabled:bg-zinc-700">
      Assess
    </button>
  );
}

/** The card's outline action (prototype: 11px/500, padding 3px 10px, radius 6). */
function CardAction({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="rounded-[6px] border border-[#e5e7eb] bg-white px-2.5 py-[3px] text-[11px] font-medium text-[#111827] hover:bg-gray-50 dark:border-[#2a2a2a] dark:bg-[#111111] dark:text-zinc-100 dark:hover:bg-[#1a1a1a]">
      {children}
    </button>
  );
}

/** The first domain (1–5) where R1 and R2 disagree, else Overall (6). */
function firstOpenDomain(info: TargetInfo): number {
  const a = info.r1.view, b = info.r2.view;
  if (!a || !b) return 1;
  const i = [0, 1, 2, 3, 4].find(k => a.judgement[k] !== b.judgement[k]);
  return i === undefined ? 6 : i + 1;
}

function AssessmentCard({ studyId, info }: { studyId: string; info: TargetInfo }) {
  const rob = useRob();
  const { go } = useRobNav();
  const t = info.target;
  const shown = info.shownOverall;
  // "Resolve consensus" replaces Open once both readers completed and differ;
  // only the protocol's consensus reviewer (or a manager) may resolve.
  const canResolve = info.consensus === 'needed' && (rob.mySeat === 'adjudicator' || rob.canManage);
  const scopeWord = t.kind === 'outcome' ? 'Outcome scope' : 'Result scope';
  const effectWord = info.effect === 'adherence' ? 'Effect of adhering' : 'Effect of assignment';
  const openLabel = info.mine && !info.mine.complete ? 'Continue' : 'Open';
  const isReader = rob.mySeat === 'reviewer_1' || rob.mySeat === 'reviewer_2'
    || (!rob.mySeat && !rob.canManage);
  // A reader with no entry of their own assesses it from the card itself.
  const canAssess = !info.mine && isReader && rob.canEdit;
  const canOpen = !!info.mine || rob.canManage || rob.mySeat === 'adjudicator';
  const { design, confirmed } = rob.designOf(studyId);
  const assessBlocked = confirmed && !designAssessable(design);

  return (
    <div className="relative overflow-hidden rounded-xl border border-gray-200 bg-white transition-shadow hover:shadow-[0_4px_20px_rgba(0,0,0,.06)] dark:border-[#1f1f1f] dark:bg-[#111111]">
      <span className={cn('absolute inset-y-0 left-0 w-1', ACCENT[info.rowStatus])} />
      <div className="px-5 pb-3 pl-6 pt-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[14px] font-semibold text-gray-900 dark:text-zinc-100">{targetTitle(t)}</span>
              <StatusPill tone={statusTone(info.rowStatus)}>{STATUS_WORD[info.rowStatus]}</StatusPill>
              {info.held && <StatusPill tone="slate">Comparison needed</StatusPill>}
            </div>
            <div className="mt-1 text-[12px] text-gray-500 dark:text-zinc-500">
              {scopeWord} · {effectWord} · RoB 2 (2019-08-22)
              {t.kind === 'outcome' && ' · judged for the outcome as a whole'}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2.5 pt-0.5">
            <Light j={shown} size={26} />
            <span className={cn('text-[13px] font-medium', judgementTextClass(shown))}>{judgementText(shown)}</span>
          </div>
        </div>
      </div>
      <div className="mx-5 ml-6 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-gray-100 py-3 text-[12px] dark:border-[#1a1a1a]">
        <span className="inline-flex items-center gap-1.5 text-gray-600 dark:text-zinc-400"><SeatBadge seat="reviewer_1" />{seatStatusText(info.r1)}</span>
        <span className="inline-flex items-center gap-1.5 text-gray-600 dark:text-zinc-400"><SeatBadge seat="reviewer_2" />{seatStatusText(info.r2)}</span>
        <span className={consensusClass(info.consensus)}>Consensus · {consensusText(info.consensus)}</span>
        <span className="ml-auto flex gap-2">
          {canResolve ? (
            <CardAction onClick={() => go({ screen: 'consensus', study: studyId, target: t.id, domain: firstOpenDomain(info), as: null })}>
              Resolve consensus
            </CardAction>
          ) : canAssess ? (
            <AssessButton disabled={assessBlocked} onClick={() => go({ screen: 'new', study: studyId, target: t.id })} />
          ) : canOpen && (
            <CardAction
              onClick={() => go(info.mine
                ? { screen: 'workspace', study: studyId, target: t.id, domain: info.resumeDomain, as: null }
                : { screen: 'consensus', study: studyId, target: t.id, domain: 6, as: null })}>
              {openLabel}
            </CardAction>
          )}
        </span>
      </div>
    </div>
  );
}

// ── Summary tab ──────────────────────────────────────────────────────────────

interface SummaryCells {
  domains: (Judgement | null)[];
  overall: Judgement | null;
  /** Dashed with this note when nothing may be shown. */
  pending?: string;
}

function cellsFor(info: TargetInfo, view: SummaryView): SummaryCells {
  const empty = { domains: [null, null, null, null, null], overall: null };
  if (view === 'consensus') {
    if (info.consensusJudgement) return info.consensusJudgement;
    return { ...empty, pending: info.stored ? 'Consensus pending' : 'Not assessed' };
  }
  const seat = view === 'reviewer_1' ? info.r1 : info.r2;
  if (seat.view) return finalJudgements(seat.view as Assessment);
  if (seat.status !== 'none') return { ...empty, pending: 'Hidden until both reviewers complete' };
  return { ...empty, pending: 'Not assessed' };
}

function SummaryTab({ studyId }: { studyId: string }) {
  const rob = useRob();
  const [view, setView] = useState<SummaryView>('consensus');
  const outcomes = rob.outcomesOfDoc(studyId);
  // The protocol scope decides what a row IS. At outcome scope each outcome is
  // the target and no result rows are listed; at result scope the outcome is
  // just a heading over its results. Assessments of the other scope stay
  // stored but are not shown, and rows still waiting for a comparison are left
  // out (they are listed in the held box on the Assessments tab).
  const outcomeScope = scopeOf(rob) === 'outcome';
  const visibleOutcomes = outcomes.filter(o => o.results.some(r => !isWaitingRow(rob, r)));
  const other: Seat = rob.mySeat === 'reviewer_2' ? 'reviewer_1' : 'reviewer_2';
  const otherShort = other === 'reviewer_1' ? 'Reviewer 1' : 'Reviewer 2';

  const note = view === 'consensus'
    ? 'Consensus judgments are what the review reports. Rows without consensus show as pending.'
    : `${view === 'reviewer_1' ? 'Reviewer 1' : 'Reviewer 2'}'s own judgments. Each reviewer's judgments stay hidden from the other until both complete that assessment.`;

  const grid = 'grid grid-cols-[minmax(200px,1.6fr)_80px_repeat(6,52px)_110px_150px] items-center gap-x-2';

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <Segmented<SummaryView> value={view} onChange={setView}
          options={[{ value: 'consensus', label: 'Consensus' }, { value: 'reviewer_1', label: 'Reviewer 1' }, { value: 'reviewer_2', label: 'Reviewer 2' }]}
          className="[&>button]:min-w-0 [&>button]:px-3 [&>button]:py-1.5 [&>button]:text-[12px]" />
        <span className="min-w-0 flex-1 text-[12px] text-gray-500 dark:text-zinc-400">{note}</span>
        <span className="flex items-center gap-3 text-[11px] text-gray-500 dark:text-zinc-400">
          <span className="inline-flex items-center gap-1"><Light j="low" size={14} thin />Low</span>
          <span className="inline-flex items-center gap-1"><Light j="some" size={14} thin />Some concerns</span>
          <span className="inline-flex items-center gap-1"><Light j="high" size={14} thin />High</span>
        </span>
      </div>

      <div className="mt-3 overflow-x-auto rounded-xl border border-gray-200 bg-white dark:border-[#1f1f1f] dark:bg-[#111111]">
        <div className="min-w-[900px]">
          <div className={cn(grid, 'border-b border-gray-200 px-4 py-3 text-[10.5px] font-semibold uppercase tracking-[.05em] text-gray-500 dark:border-[#1f1f1f] dark:text-zinc-500')}>
            <span>Target</span><span>Scope</span>
            {DOMAIN_SHORT.map((d, i) => <span key={d} title={d} className="text-center">D{i + 1}</span>)}
            <span className="text-center">Overall</span>
            <span>{otherShort}</span>
            <span>Consensus</span>
          </div>
          {visibleOutcomes.map(o => {
            const outcomeInfo = targetInfo(rob, studyId, outcomeTarget(o));
            return (
              <div key={o.key}>
                <SummaryRow grid={grid} info={outcomeInfo} view={view} other={other} group
                  isTarget={outcomeScope}
                  title={o.outcome}
                  sub={[o.measurements.join(' · '), outcomeScope && !outcomeInfo.stored ? 'Not assessed' : ''].filter(Boolean).join(' · ')}
                  scopeLabel={outcomeScope ? 'Outcome' : ''} />
                {!outcomeScope && o.results.filter(r => !isWaitingRow(rob, r)).map(r => {
                  const info = targetInfo(rob, studyId, resultTarget(r));
                  return (
                    <SummaryRow key={r.id} grid={grid} info={info} view={view} other={other}
                      title={[r.timepoint, r.contrast?.intervention ? `${r.contrast.intervention} vs ${r.contrast.comparator}` : 'Comparison not set'].filter(Boolean).join(' · ')}
                      sub={info.stored ? r.estimate : 'Not assessed'} scopeLabel="Result" />
                  );
                })}
              </div>
            );
          })}
          {!visibleOutcomes.length && (
            <div className="px-4 py-6 text-center text-[13px] text-gray-500">
              {outcomeScope ? 'No outcomes for this study.' : 'No results for this study.'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryRow({ grid, info, view, other, group, isTarget, title, sub, scopeLabel }: {
  grid: string; info: TargetInfo; view: SummaryView; other: Seat; group?: boolean;
  /** Outcome rows only: this outcome is an assessment target (outcome scope, or stored). */
  isTarget?: boolean;
  title: string; sub: string; scopeLabel: string;
}) {
  // An outcome row that is not a target is just a heading.
  const showCells = !group || !!isTarget;
  const cells = showCells ? cellsFor(info, view) : null;
  const otherSeat = other === 'reviewer_1' ? info.r1 : info.r2;
  return (
    <div className={cn(grid, 'border-b border-gray-100 px-4 py-3 last:border-b-0 dark:border-[#1a1a1a]',
      group && 'bg-[#fafafa] dark:bg-[#0d0d0d]')}>
      <div className={cn('min-w-0', !group && 'pl-4')}>
        <div className={cn('truncate text-[13px] text-gray-900 dark:text-zinc-100', group ? 'font-semibold' : 'font-medium')}>{title}</div>
        {(sub || cells?.pending) && (
          <div className="mt-0.5 truncate text-[11px] text-gray-400 dark:text-zinc-500">
            {cells?.pending && cells.pending !== 'Not assessed' ? cells.pending : sub}
            
          </div>
        )}
      </div>
      <span className="text-[12px] text-gray-600 dark:text-zinc-400">{scopeLabel}</span>
      {cells ? (
        <>
          {cells.domains.map((j, i) => (
            <span key={i} className="flex justify-center"><Light j={j} size={22} muted={!!cells.pending && cells.pending !== 'Not assessed'} title={cells.pending && cells.pending !== 'Not assessed' ? cells.pending : `D${i + 1} · ${judgementText(j)}`} /></span>
          ))}
          <span className="flex justify-center"><Light j={cells.overall} size={22} muted={!!cells.pending && cells.pending !== 'Not assessed'} title={cells.pending && cells.pending !== 'Not assessed' ? cells.pending : `Overall · ${judgementText(cells.overall)}`} /></span>
          <span className="truncate text-[12px] text-gray-600 dark:text-zinc-400">
            {otherSeat.holder ? (otherSeat.status === 'none' ? (info.stored ? 'Not started' : '—') : STATUS_WORD[otherSeat.status]) : '—'}
          </span>
          <span className={cn('truncate text-[12px]', consensusClass(info.consensus))}>{consensusText(info.consensus)}</span>
        </>
      ) : (
        <>
          {Array.from({ length: 6 }).map((_, i) => <span key={i} />)}
          <span /><span />
        </>
      )}
    </div>
  );
}

'use client';

/**
 * The two repeating blocks of the workspace: a signalling-question card and a
 * judgement card. Both are presentational — every answer, route and suggestion
 * arrives computed by `rob2.ts` / `robModel.ts`.
 */

import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';
import { ANSWER_LABEL, ANSWER_ORDER, type AnswerCode, type RouteState, type SignallingQuestion } from '../../_lib/rob2';
import {
  DIRECTION_OPTIONS, JUDGEMENT_LABEL, type Direction, type Judgement,
} from '../../_lib/robModel';
import { Light, Pill, judgementTextClass } from '../robUi';

const NI_TOOLTIP = 'Use only when (i) insufficient details are reported for Probably yes / Probably no '
  + 'AND (ii) it would be unreasonable to answer Probably yes / Probably no in the circumstances of the trial.';

// ── Question card ────────────────────────────────────────────────────────────
//
// Markup mirrors the iteration-2 handoff card: 26px id column, text with a
// Guidance toggle top-right, response pills indented 38px, then (while asked)
// the linked quote and the support box.

/** Response pill, styled per the handoff (12px/500, 4px 12px, fully round). */
function AnswerPill({ label, on, muted, inactive, disabled, title, onClick }: {
  label: string; on: boolean; muted?: boolean; inactive: boolean; disabled: boolean;
  title?: string; onClick?: () => void;
}) {
  return (
    <button type="button" title={title} disabled={disabled}
      onClick={e => { e.stopPropagation(); onClick?.(); }}
      className={cn('rounded-full border px-3 py-1 text-[12px] font-medium',
        inactive || disabled ? 'cursor-not-allowed' : 'cursor-pointer',
        inactive
          ? 'border-[#f3f4f6] bg-white text-[#d4d4d8] dark:border-[#1a1a1a] dark:bg-[#111111] dark:text-zinc-700'
          : on
            ? muted
              ? 'border-[#d4d4d8] bg-[#f3f4f6] text-[#111827] dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100'
              : 'border-[#0a0a0a] bg-[#0a0a0a] text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-gray-900'
            : 'border-[#e5e7eb] bg-white text-[#374151] dark:border-[#2a2a2a] dark:bg-[#111111] dark:text-zinc-300')}>
      {label}
    </button>
  );
}

function InfoIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" />
    </svg>
  );
}

export function QuestionCard({
  question, prefix, route, value, onAnswer, support, onSupport, quote, onUnlink,
  readOnly, onFocus, guidance, guideOpen, onToggleGuide, aiSlot,
}: {
  question: SignallingQuestion;
  prefix: string;
  route: RouteState;
  value: AnswerCode | undefined;
  onAnswer: (code: AnswerCode | null) => void;
  support: string;
  onSupport: (text: string) => void;
  quote: { quote: string; locator: string } | null;
  onUnlink: () => void;
  readOnly: boolean;
  focused: boolean;
  onFocus: () => void;
  /** The Guidance note for this question under the assessment's effect. */
  guidance: string;
  guideOpen: boolean;
  onToggleGuide: () => void;
  /** The AI suggestion strip, when AI suggestions are on and ready. */
  aiSlot?: ReactNode;
}) {
  const asked = route === 'asked';
  const options = ANSWER_ORDER.filter(c => c !== 'NI' || question.noInformationOption !== false);
  const note = !asked
    ? (route === 'skipped' ? 'Not applicable' : 'Conditional · awaiting earlier answer')
    : value ? '' : 'Required';

  return (
    <div onClick={onFocus}
      className="flex flex-col gap-3 rounded-xl border border-[#e5e7eb] bg-white px-5 py-4 dark:border-[#1f1f1f] dark:bg-[#111111]"
      style={{ opacity: asked ? 1 : 0.6 }}>
      <div className="flex items-start gap-3">
        <span className="w-[26px] shrink-0 pt-0.5 text-[12px] font-semibold tabular-nums text-[#9ca3af] dark:text-zinc-500">{question.id}</span>
        <span className="flex flex-1 flex-col gap-1.5">
          <span className="flex items-start gap-2.5">
            <span className="flex-1 text-[14px] leading-[21px] text-[#111827] dark:text-zinc-100">
              {prefix ? `${prefix}: ${question.text}` : question.text}
            </span>
            {guidance && (
              <button type="button" onClick={e => { e.stopPropagation(); onToggleGuide(); }}
                className="inline-flex shrink-0 cursor-pointer items-center gap-1 whitespace-nowrap rounded-[6px] border border-[#e5e7eb] bg-transparent px-2 py-0.5 text-[11px] font-medium text-[#6b7280] hover:bg-[#f9fafb] dark:border-[#2a2a2a] dark:text-zinc-400 dark:hover:bg-[#1a1a1a]">
                <InfoIcon size={11} />{guideOpen ? 'Hide guidance' : 'Guidance'}
              </button>
            )}
          </span>
          {guideOpen && asked && guidance && (
            <span className="rounded-lg border border-[#e5e7eb] bg-[#fafafa] px-3 py-2 text-[12px] leading-[17px] text-[#374151] dark:border-[#242424] dark:bg-[#0d0d0d] dark:text-zinc-300">
              {guidance} <span className="text-[#9ca3af] dark:text-zinc-500">— RoB 2 guidance &amp; Cochrane FAQ</span>
            </span>
          )}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 pl-[38px]">
        {options.map(code => (
          <AnswerPill key={code}
            label={ANSWER_LABEL[code]}
            on={asked && value === code}
            muted={code === 'NI'}
            inactive={!asked}
            disabled={!asked || readOnly}
            title={code === 'NI' ? NI_TOOLTIP : undefined}
            onClick={() => onAnswer(value === code ? null : code)} />
        ))}
        {question.askedWhen && (
          // Set automatically when the condition is not met: "selected" while
          // routed out, greyed while the question is asked.
          <button type="button" disabled title="Set automatically when the condition is not met"
            className={cn('cursor-default rounded-full border px-3 py-1 text-[12px] font-medium',
              !asked
                ? 'border-[#d4d4d8] bg-[#f3f4f6] text-[#111827] dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100'
                : 'border-[#f3f4f6] bg-white text-[#d4d4d8] dark:border-[#1a1a1a] dark:bg-[#111111] dark:text-zinc-700')}>
            Not applicable
          </button>
        )}
        <span className={cn('ml-auto text-[11px]',
          note === 'Required' ? 'text-[#475569] dark:text-slate-400' : 'text-[#9ca3af] dark:text-zinc-500')}>
          {note}
        </span>
      </div>

      {aiSlot}

      {asked && (
        <div className="flex flex-col gap-2 pl-[38px]">
          {quote?.quote && (
            <div className="flex items-start gap-2.5 border-l-2 border-[#e5e7eb] px-3 py-1 text-[12px] italic leading-[17px] text-[#374151] dark:border-zinc-600 dark:text-zinc-300">
              <span className="min-w-0 flex-1">“{quote.quote}”</span>
              {quote.locator && <span className="whitespace-nowrap not-italic text-[#9ca3af] dark:text-zinc-500">{quote.locator}</span>}
              {!readOnly && (
                <button type="button" onClick={e => { e.stopPropagation(); onUnlink(); }}
                  className="whitespace-nowrap not-italic text-[#9ca3af] underline-offset-2 hover:underline dark:text-zinc-500">
                  Unlink
                </button>
              )}
            </div>
          )}
          <textarea
            value={support}
            readOnly={readOnly}
            onChange={e => onSupport(e.target.value)}
            onFocus={onFocus}
            placeholder="Support for this answer. Prefer a brief direct quotation from the report."
            className="min-h-[44px] w-full resize-y rounded-lg border border-[#e5e7eb] bg-white px-2.5 py-2 text-[12px] leading-[17px] text-[#111827] outline-none placeholder:text-gray-400 dark:border-[#2a2a2a] dark:bg-[#0d0d0d] dark:text-zinc-100 dark:placeholder:text-zinc-600"
          />
        </div>
      )}
    </div>
  );
}

// ── Judgement card ───────────────────────────────────────────────────────────

const CARD_BORDER: Record<Judgement, string> = {
  low: 'border-[#16a34a]',
  some: 'border-[#64748b]',
  high: 'border-[#dc2626]',
};

/** Severity order, for the overall's floor. */
const RANK: Record<Judgement, number> = { low: 0, some: 1, high: 2 };

export function JudgementCard({
  title, suggestion, value, onChange, direction, onDirection, rationale, onRationale,
  needsRationale, readOnly, note, footer, aiSlot, variant = 'domain', floor = null,
}: {
  title: string;
  suggestion: { severity: Judgement | null; reason: string };
  value: Judgement | null;
  onChange: (j: Judgement) => void;
  direction: Direction | '';
  onDirection: (d: Direction | '') => void;
  rationale: string;
  onRationale: (text: string) => void;
  needsRationale: boolean;
  readOnly: boolean;
  note?: ReactNode;
  footer: ReactNode;
  /** "AI suggests {judgment}" row, when AI suggestions are on and ready. */
  aiSlot?: ReactNode;
  /** The overall card: no header row, "Overall judgment" eyebrow, no Accept (per the handoff). */
  variant?: 'domain' | 'overall';
  /** Overall only: the worst domain judgement. Milder picks are disabled (RoB 2). */
  floor?: Judgement | null;
}) {
  const overall = variant === 'overall';
  const rationaleMissing = needsRationale && !rationale.trim();
  const tooLow = overall && !!value && !!floor && RANK[value] < RANK[floor];
  return (
    <div className={cn('rounded-xl border border-gray-200 bg-white dark:border-[#1f1f1f] dark:bg-[#111111]',
      overall ? 'flex flex-col gap-3.5 px-5 py-[18px]' : 'px-5 py-4')}>
      {!overall && (
        <div className="flex items-baseline justify-between gap-3">
          <div className="text-[14px] font-semibold text-gray-900 dark:text-zinc-100">{title}</div>
          <div className="text-[11px] text-gray-400 dark:text-zinc-500">Options defined by RoB 2 (2019)</div>
        </div>
      )}

      <div className={cn('flex flex-wrap items-center gap-3 rounded-[10px] border border-dashed',
        overall ? 'border-[#d4d4d8] bg-[#fafafa] px-3.5 py-2.5 dark:border-zinc-700 dark:bg-[#0d0d0d]'
          : 'mt-3 border-gray-300 px-4 py-3 dark:border-zinc-700')}>
        <span className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-[.05em] text-gray-500 dark:text-zinc-500">Algorithm suggests</span>
        <Light j={suggestion.severity} size={20} />
        <span className={cn('text-[13px] font-semibold', judgementTextClass(suggestion.severity))}>
          {suggestion.severity ? JUDGEMENT_LABEL[suggestion.severity] : 'Pending'}
        </span>
        <span className="min-w-0 flex-1 text-[12px] text-gray-500 dark:text-zinc-400">{suggestion.reason}</span>
        {!readOnly && !overall && (
          <button type="button" disabled={!suggestion.severity || value === suggestion.severity}
            onClick={() => suggestion.severity && onChange(suggestion.severity)}
            className="h-7 rounded-[6px] border border-gray-200 bg-white px-3 text-[12px] font-medium text-gray-900 hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-300 dark:border-[#2a2a2a] dark:bg-[#111111] dark:text-zinc-100 dark:disabled:text-zinc-600">
            {value && value === suggestion.severity ? 'Accepted' : 'Accept'}
          </button>
        )}
      </div>
      {note && <div className={cn('text-[12px] text-[#475569] dark:text-slate-400', !overall && 'mt-2')}>{note}</div>}
      {aiSlot && <div className={cn(!overall && 'mt-3')}>{aiSlot}</div>}

      <div className={cn(overall ? 'flex flex-col gap-2' : '')}>
        <div className={cn('text-[11px] font-semibold uppercase tracking-[.05em] text-gray-500 dark:text-zinc-500', !overall && 'mt-4')}>
          {overall ? 'Overall judgment' : 'Reviewer judgment'}
        </div>
        <div className={cn('grid grid-cols-1 gap-2 sm:grid-cols-3', !overall && 'mt-2')}>
          {(['low', 'some', 'high'] as Judgement[]).map(j => {
            const on = value === j;
            const belowFloor = overall && !!floor && RANK[j] < RANK[floor];
            return (
              <button key={j} type="button" disabled={readOnly || belowFloor} onClick={() => onChange(j)}
                title={belowFloor ? `The overall is at least as severe as the worst domain (${JUDGEMENT_LABEL[floor!]}).` : undefined}
                className={cn('flex items-center gap-2.5 rounded-[10px] border px-3.5 py-3 text-left text-[13px] font-semibold transition-colors disabled:cursor-not-allowed',
                  on ? cn('bg-gray-50 dark:bg-[#161616]', CARD_BORDER[j], 'border-[1.5px]')
                    : 'border-gray-200 bg-white hover:border-gray-300 dark:border-[#2a2a2a] dark:bg-[#111111]',
                  belowFloor && !on && 'opacity-40 hover:border-gray-200',
                  'text-gray-900 dark:text-zinc-100')}>
                <Light j={j} size={22} />
                <span className="flex-1">{JUDGEMENT_LABEL[j]}</span>
              </button>
            );
          })}
        </div>
        {tooLow && (
          <div className="text-[12px] font-medium text-[#475569] dark:text-slate-400">
            The overall cannot be milder than the worst domain ({JUDGEMENT_LABEL[floor!]}). Choose again.
          </div>
        )}
      </div>

      <div className={cn(overall ? 'flex flex-col gap-2' : '')}>
        <div className={cn('text-[11px] font-semibold uppercase tracking-[.05em] text-gray-500 dark:text-zinc-500', !overall && 'mt-4')}>
          Predicted direction of bias{' '}
          <span className="font-normal normal-case tracking-normal text-gray-400 dark:text-zinc-600">
            {overall ? 'optional' : 'optional · do not guess without a clear rationale'}
          </span>
        </div>
        <div className={cn('flex flex-wrap gap-1.5', !overall && 'mt-2')}>
          {DIRECTION_OPTIONS.map(([key, label]) => (
            <Pill key={key} on={direction === key} disabled={readOnly}
              className={overall ? 'px-3 py-1 text-[12px] font-medium' : undefined}
              onClick={() => onDirection(direction === key ? '' : key)}>
              {label}
            </Pill>
          ))}
        </div>
      </div>

      {overall && needsRationale && (
        <span className="text-[12px] font-medium text-[#475569] dark:text-slate-400">
          Your overall judgment differs from the algorithm. A rationale is required.
        </span>
      )}
      <textarea
        value={rationale}
        readOnly={readOnly}
        onChange={e => onRationale(e.target.value)}
        rows={overall ? undefined : 3}
        placeholder={overall ? 'Overall rationale, e.g. which domain drives the judgment'
          : needsRationale ? 'Why does your judgment differ from the algorithm? (required)' : 'Rationale for this judgment (optional)'}
        className={cn('w-full resize-y rounded-lg border bg-white text-gray-900 placeholder:text-gray-400 focus:outline-none dark:bg-[#0d0d0d] dark:text-zinc-100 dark:placeholder:text-zinc-600',
          overall ? 'min-h-[64px] px-2.5 py-2 text-[12px] leading-[17px]' : 'mt-4 px-3 py-2 text-[13px]',
          rationaleMissing ? 'border-[#64748b] focus:border-[#64748b]' : 'border-gray-200 focus:border-gray-400 dark:border-[#2a2a2a]')}
      />
      {!overall && needsRationale && (
        <div className="mt-1.5 text-[12px] text-[#475569] dark:text-slate-400">
          Your judgment differs from the algorithm. A rationale is required.
        </div>
      )}

      <div className={cn('flex items-center justify-between gap-3', overall ? 'pt-1' : 'mt-4')}>{footer}</div>
    </div>
  );
}

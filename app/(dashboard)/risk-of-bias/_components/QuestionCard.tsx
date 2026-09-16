'use client';

/**
 * One signalling question, with everything needed to answer it honestly.
 *
 * Four decisions are visible in this component, and each of them was a bug in
 * the screen it replaces.
 *
 * **The answer starts empty.** An AI draft is shown beside the buttons and is
 * applied only when the reviewer presses *Use suggestion*. Pre-filling the
 * radio buttons made the model's answer indistinguishable from a reviewer's the
 * moment the page reloaded — and that is the one distinction the whole dual-
 * review process rests on.
 *
 * **"Evidence not found" is not "No information".** The first is a fact about
 * retrieval; the second is a claim about the trial report, and only a person who
 * can see which sources were searched may make it. So the model never returns
 * `No information`, and the card says why the slot is empty.
 *
 * **A trial-level question is shown read-only here, not copied.** 1.1–1.3 and
 * 2.1–2.3 are about the trial, so they live in one place and every result of
 * that trial reads them. The card says so and offers the way back.
 *
 * **A question that routes out keeps no answer.** It is drawn struck through
 * with the rule that skipped it, and exports as `Not applicable` — never as a
 * blank that reads like an oversight.
 */

import { useState } from 'react';
import { Check, ChevronRight, Sparkles } from 'lucide-react';

import {
  ANSWER_LABEL, ANSWER_ORDER, isAsked,
  type AnswerCode, type Answers, type SignallingQuestion,
} from '../_lib/rob2';
import type { QuestionEvidence } from '../_lib/robSignalling';

export interface AiSuggestion {
  answer: AnswerCode;
  quote: string;
  locator: string;
  rationale: string;
}

interface Props {
  question: SignallingQuestion;
  /** The answers the routing is computed from — trial's six plus this result's. */
  merged: Answers;
  evidence?: QuestionEvidence;
  rationale: string;
  suggestion?: AiSuggestion | null;
  /** True when the model was asked this question and found nothing. */
  notFound?: boolean;
  /** True when this is one of the six and we are NOT on the trial screen. */
  fromTrial?: boolean;
  /** How many results of this trial read the trial-level answer. */
  siblingCount?: number;
  readOnly: boolean;
  showAi: boolean;
  onAnswer: (code: AnswerCode, origin: 'own' | 'ai') => void;
  onRationale: (text: string) => void;
  onEditTrial?: () => void;
  /** Analysis population of the result, shown on the questions that turn on it. */
  analysisPopulation?: string;
}

/** The four questions whose answer depends on which participants were analysed. */
const ANALYSIS_SENSITIVE = new Set(['2.6', '2.7', '3.1', '3.2']);

export function QuestionCard({
  question, merged, evidence, rationale, suggestion, notFound,
  fromTrial, siblingCount, readOnly, showAi,
  onAnswer, onRationale, onEditTrial, analysisPopulation,
}: Props) {
  const [showWhy, setShowWhy] = useState(false);
  const asked = isAsked(question, merged);
  const current = merged[question.id];
  const locked = readOnly || !!fromTrial;

  if (!asked) {
    return (
      <article className="border border-dashed border-gray-200 dark:border-[#242424] rounded-xl px-4 py-3 bg-gray-50/60 dark:bg-[#0d0d0d]">
        <div className="flex items-start gap-2.5">
          <span className="font-mono text-[11px] text-gray-400 dark:text-zinc-600 mt-0.5 w-8 flex-shrink-0">
            {question.id}
          </span>
          <span className="text-[13px] text-gray-400 dark:text-zinc-600 line-through decoration-gray-300 dark:decoration-zinc-700">
            {question.text}
          </span>
        </div>
        <div className="text-[11.5px] text-gray-500 dark:text-zinc-500 mt-1.5 ml-[42px] leading-relaxed">
          Not asked — {(question.routingNote ?? 'the answers above rule it out').replace(/\.$/, '')}.
          Stored as not applicable, never as a blank answer.
        </div>
      </article>
    );
  }

  const options = ANSWER_ORDER.filter(
    code => code !== 'NI' || question.noInformationOption !== false,
  );

  return (
    <article
      className={[
        'border rounded-xl px-4 py-3.5',
        fromTrial
          ? 'border-gray-200 dark:border-[#242424] bg-gray-50/60 dark:bg-[#0d0d0d]'
          : 'border-border dark:border-[#1f1f1f] bg-white dark:bg-[#111111]',
      ].join(' ')}
    >
      <div className="flex items-start gap-2.5">
        <span className="font-mono text-[11px] text-gray-400 dark:text-zinc-600 mt-1 w-8 flex-shrink-0">
          {question.id}
        </span>
        <span className="text-[13.5px] font-medium leading-snug dark:text-white">
          {question.text}
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5 mt-3 ml-[42px]" role="radiogroup"
           aria-label={`Answer to question ${question.id}`}>
        {options.map(code => {
          const on = current === code;
          return (
            <button
              key={code}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={locked}
              onClick={() => onAnswer(code, 'own')}
              className={[
                'text-[12px] font-semibold rounded-lg px-2.5 py-1.5 border transition-colors',
                on
                  ? 'border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-gray-900'
                  : 'border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-[#2a2a2a] dark:text-zinc-400 dark:hover:bg-[#1a1a1a]',
                locked && 'opacity-50 cursor-not-allowed',
              ].filter(Boolean).join(' ')}
            >
              {ANSWER_LABEL[code]}
            </button>
          );
        })}
      </div>

      {fromTrial && (
        <div className="flex items-center gap-2 flex-wrap mt-2.5 ml-[42px] text-[11.5px] text-gray-500 dark:text-zinc-500">
          <span>
            Answered once for this trial — all {siblingCount ?? 'its'} results read the same answer.
          </span>
          {onEditTrial && (
            <button
              type="button"
              onClick={onEditTrial}
              className="inline-flex items-center gap-1 font-semibold text-gray-700 dark:text-zinc-300 hover:underline"
            >
              Edit trial questions <ChevronRight className="h-3 w-3" />
            </button>
          )}
        </div>
      )}

      {!fromTrial && ANALYSIS_SENSITIVE.has(question.id) && analysisPopulation && (
        <div className="mt-2 ml-[42px] text-[11.5px] text-gray-500 dark:text-zinc-500">
          This result&rsquo;s analysis population: <strong className="font-semibold">{analysisPopulation}</strong>
        </div>
      )}

      {current === 'NI' && !fromTrial && (
        <div className="mt-2.5 ml-[42px] flex items-start gap-2 text-[11.5px] text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/5 border border-amber-200 dark:border-amber-900/50 rounded-lg px-2.5 py-2">
          <span aria-hidden className="font-bold">!</span>
          <span>
            &ldquo;No information&rdquo; is a finding about the trial report, not about the search.
            Recorded with the sources that had been searched when you answered.
          </span>
        </div>
      )}

      {showAi && !fromTrial && suggestion && (
        <div className="mt-3 ml-[42px] border border-gray-200 dark:border-[#242424] rounded-xl bg-gray-50/70 dark:bg-[#0d0d0d] px-3.5 py-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Sparkles className="h-3 w-3 text-gray-500 dark:text-zinc-500" />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-zinc-500">
              AI suggestion · {ANSWER_LABEL[suggestion.answer]}
            </span>
            <span className="text-[10.5px] font-mono text-gray-400 dark:text-zinc-600">
              {suggestion.quote ? 'quoted' : 'reasoned — no sentence to quote'}
            </span>
          </div>

          {suggestion.quote && (
            <>
              <div className="text-[12.5px] italic text-gray-700 dark:text-zinc-300 leading-relaxed mt-2 border-l-2 border-gray-300 dark:border-[#2a2a2a] pl-2.5">
                &ldquo;{suggestion.quote}&rdquo;
              </div>
              {suggestion.locator && (
                <div className="text-[11px] font-mono text-gray-400 dark:text-zinc-600 mt-1 pl-2.5">
                  {suggestion.locator}
                </div>
              )}
            </>
          )}

          {suggestion.rationale && (
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setShowWhy(v => !v)}
                className="text-[11px] font-semibold text-gray-500 dark:text-zinc-500 hover:underline"
              >
                {showWhy ? 'Hide reasoning' : 'Why the AI answered this way'}
              </button>
              {showWhy && (
                <p className="text-[12px] text-gray-600 dark:text-zinc-400 leading-relaxed mt-1.5">
                  {suggestion.rationale}
                </p>
              )}
            </div>
          )}

          <div className="mt-3">
            <button
              type="button"
              disabled={locked || current === suggestion.answer}
              onClick={() => onAnswer(suggestion.answer, 'ai')}
              className="inline-flex items-center gap-1.5 text-[12px] font-semibold rounded-lg px-3 py-1.5 border border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-gray-900 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {current === suggestion.answer
                ? <><Check className="h-3 w-3" /> Suggestion used</>
                : 'Use suggestion'}
            </button>
          </div>
        </div>
      )}

      {showAi && !fromTrial && !suggestion && notFound && (
        <div className="mt-3 ml-[42px] border border-dashed border-gray-200 dark:border-[#242424] rounded-xl px-3.5 py-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-3 w-3 text-gray-400 dark:text-zinc-600" />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-600">
              AI suggestion · evidence not found
            </span>
          </div>
          <p className="text-[12px] text-gray-500 dark:text-zinc-500 leading-relaxed mt-1.5">
            Nothing in the retrieved text answers this for <em>this result</em>. That is not the same
            as the trial report being silent — the answer may be in a table, a figure, the registry
            or the protocol. Only you can record <strong>No information</strong>.
          </p>
        </div>
      )}

      <div className="mt-3 ml-[42px]">
        {evidence?.quote && (
          <div className="flex items-start gap-2 border border-gray-200 dark:border-[#242424] rounded-lg px-2.5 py-2 mb-2">
            <div className="min-w-0 flex-1">
              <div className="text-[12px] italic text-gray-700 dark:text-zinc-300 leading-relaxed">
                &ldquo;{evidence.quote}&rdquo;
              </div>
              {evidence.locator && (
                <div className="text-[10.5px] font-mono text-gray-400 dark:text-zinc-600 mt-0.5">
                  {evidence.locator}
                </div>
              )}
            </div>
          </div>
        )}
        <textarea
          value={rationale}
          disabled={locked}
          onChange={e => onRationale(e.target.value)}
          rows={2}
          placeholder="Your reasoning — optional, and it travels to consensus"
          className="w-full text-[12.5px] border border-gray-200 dark:border-[#2a2a2a] rounded-lg px-2.5 py-2 bg-white dark:bg-[#0d0d0d] dark:text-zinc-200 focus:outline-none focus:border-gray-400 dark:focus:border-[#3a3a3a] disabled:opacity-50 resize-y"
        />
      </div>
    </article>
  );
}

export { ANSWER_LABEL };
export type { AnswerCode };

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
 * **A question that is not being asked is in one of two states, not one.**
 * Either the answers above it mean RoB 2 will never ask it — struck through,
 * with the rule that skipped it, exported as `Not applicable` — or a question
 * before it is still unanswered, in which case nothing has ruled it out and it
 * is simply *waiting*. Drawing the second as the first tells a reviewer a
 * question has been dismissed when it is about to reappear.
 */

import { useState } from 'react';
import { Check, ChevronRight, Sparkles } from 'lucide-react';

import {
  ANSWER_LABEL, ANSWER_ORDER,
  type AnswerCode, type Answers, type SignallingQuestion,
} from '../_lib/rob2';
import { questionState } from '../_lib/robQueue';
import { ANSWER, ANSWER_ON } from '../_lib/robSkin';
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
  /** Where the reviewer looked, and what it said. */
  source?: { reference: string; passage: string };
  onSource?: (next: { reference: string; passage: string }) => void;
  /** Set when this answer arrived by copying from another result. */
  origin?: { copiedFrom?: string; editedSince?: boolean };
  /** What to call the result it was copied from. */
  originLabel?: string;
  suggestion?: AiSuggestion | null;
  /** True when the model was asked this question and found nothing. */
  notFound?: boolean;
  /** True when this is one of the six and we are NOT on the trial screen. */
  fromTrial?: boolean;
  /** How many results of this trial read the trial-level answer. */
  siblingCount?: number;
  readOnly: boolean;
  showAi: boolean;
  /**
   * Take the answer back out.
   *
   * There was no way to unanswer: every option sets a value, so a reviewer who
   * clicked the wrong one could only pick a different wrong one. RoB 2 routes
   * on these answers, so an unintended "Probably yes" silently decides which
   * questions come next — "I have not answered this" has to be reachable.
   */
  onClear?: () => void;
  onAnswer: (code: AnswerCode, origin: 'own' | 'ai') => void;
  onRationale: (text: string) => void;
  onEditTrial?: () => void;
  /** Analysis population of the result, shown on the questions that turn on it. */
  analysisPopulation?: string;
}

/** The four questions whose answer depends on which participants were analysed. */
const ANALYSIS_SENSITIVE = new Set(['2.6', '2.7', '3.1', '3.2']);

export function QuestionCard({
  question, merged, evidence, rationale, source, onSource, origin, originLabel,
  suggestion, notFound, fromTrial, siblingCount, readOnly, showAi,
  onAnswer, onRationale, onEditTrial, analysisPopulation, onClear,
}: Props) {
  const [showWhy, setShowWhy] = useState(false);
  const [showEvidence, setShowEvidence] = useState(false);
  const state = questionState(question, merged);
  const current = merged[question.id];
  const locked = readOnly || !!fromTrial;

  // A waiting question renders nothing of its own — the domain says it once,
  // below its questions. One card each for 3.2, 3.3 and 3.4 is three lines of
  // the same sentence, and they push the question that CAN be answered up out
  // of sight.
  if (state === 'waiting') return null;

  if (state === 'skipped') {
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
        'rounded-[10px] border p-5 min-w-0',
        fromTrial
          ? 'border-gray-200 dark:border-[#242424] bg-gray-50 dark:bg-[#0d0d0d]'
          : 'border-gray-200 dark:border-[#1f1f1f] bg-white dark:bg-[#111111]',
      ].join(' ')}
    >
      <div className="flex items-start gap-2.5">
        <span className="text-[11px] font-bold tracking-[0.05em] text-gray-500 dark:text-zinc-500 mt-1 w-8 flex-shrink-0">
          {question.id}
        </span>
        <span className="text-[14px] font-semibold leading-relaxed text-gray-900 dark:text-white">
          {question.text}
        </span>
      </div>

      <div className="flex flex-wrap gap-[7px] mt-3.5 ml-[42px]" role="radiogroup"
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
                on ? ANSWER_ON : ANSWER,
                'transition-colors',
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

      {current && !readOnly && !fromTrial && onClear && (
        <div className="mt-2 ml-[42px]">
          <button
            type="button"
            onClick={onClear}
            className="text-[11.5px] font-semibold text-gray-500 dark:text-zinc-500 hover:text-gray-800 dark:hover:text-zinc-300 hover:underline"
          >
            Clear answer
          </button>
        </div>
      )}

      {current === 'NI' && !fromTrial && (
        <div className="mt-2.5 ml-[42px] flex items-start gap-2 text-[11.5px] text-gray-700 dark:text-zinc-300 bg-gray-50 dark:bg-gray-500/5 border border-gray-200 dark:border-[#2a2a2a] rounded-lg px-2.5 py-2">
          <span>
            &ldquo;No information&rdquo; is a finding about the trial report, not about the search.
            Recorded with the sources that had been searched when you answered.
          </span>
        </div>
      )}

      {showAi && !fromTrial && suggestion && (
        <div className="mt-3 ml-[42px] border border-gray-200 dark:border-[#242424] rounded-xl bg-gray-50 dark:bg-[#0d0d0d] px-3.5 py-3">
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
              <div className="text-[12.5px] italic text-gray-700 dark:text-zinc-300 leading-relaxed mt-2 border-l-2 border-gray-200 dark:border-[#2a2a2a] pl-2.5">
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

      {/* Where this answer came from, when it did not come from here. An answer
          that arrived by copy is a weaker claim than one somebody made looking
          at this result, and consensus has to be able to tell them apart. */}
      {origin?.copiedFrom && (
        <div className="mt-2 ml-[42px] text-[11.5px] text-gray-500 dark:text-zinc-500">
          {origin.editedSince
            ? <>Copied from <strong>{originLabel ?? 'another result'}</strong>, and edited since.</>
            : <>Copied from <strong>{originLabel ?? 'another result'}</strong>.</>}
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
        <button
          type="button"
          onClick={() => setShowEvidence(v => !v)}
          aria-expanded={showEvidence}
          className="text-[11.5px] font-semibold text-gray-500 dark:text-zinc-500 hover:underline"
        >
          Evidence &amp; reasoning
          {(source?.reference || source?.passage || rationale) && (
            <span className="ml-1 text-gray-400 dark:text-zinc-600">· recorded</span>
          )}
        </button>

        {showEvidence && (
          <div className="flex flex-col gap-2 mt-2">
            {/* Reasoning is prose. These two are the parts that can be checked:
                where the reviewer looked, and what it said. */}
            <input
              type="text"
              value={source?.reference ?? ''}
              disabled={locked || !onSource}
              onChange={e => onSource?.({
                reference: e.target.value, passage: source?.passage ?? '' })}
              placeholder="Where you looked — p.6 · Table 2, the protocol, the registry entry"
              aria-label={`Source reference for question ${question.id}`}
              className="w-full text-[12.5px] border border-gray-200 dark:border-[#2a2a2a] rounded-lg px-2.5 py-1.5 bg-white dark:bg-[#0d0d0d] dark:text-zinc-200 focus:outline-none disabled:opacity-50"
            />
            <textarea
              value={source?.passage ?? ''}
              disabled={locked || !onSource}
              rows={2}
              onChange={e => onSource?.({
                reference: source?.reference ?? '', passage: e.target.value })}
              placeholder="What it said, in the source's own words"
              aria-label={`Supporting passage for question ${question.id}`}
              className="w-full text-[12.5px] border border-gray-200 dark:border-[#2a2a2a] rounded-lg px-2.5 py-2 bg-white dark:bg-[#0d0d0d] dark:text-zinc-200 focus:outline-none disabled:opacity-50 resize-y"
            />
            <textarea
              value={rationale}
              disabled={locked}
              onChange={e => onRationale(e.target.value)}
              rows={2}
              placeholder="Your reasoning — optional, and it travels to consensus"
              aria-label={`Reasoning for question ${question.id}`}
              className="w-full text-[12.5px] border border-gray-200 dark:border-[#2a2a2a] rounded-lg px-2.5 py-2 bg-white dark:bg-[#0d0d0d] dark:text-zinc-200 focus:outline-none focus:border-gray-400 dark:focus:border-[#2a2a2a] disabled:opacity-50 resize-y"
            />
          </div>
        )}
      </div>
    </article>
  );
}

export { ANSWER_LABEL };
export type { AnswerCode };

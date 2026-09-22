'use client';

/**
 * The six questions that are about the trial, answered once.
 *
 * How a trial was randomised (1.1–1.3) and who knew the assignment (2.1–2.3)
 * cannot differ between its own outcomes, so asking them again for every result
 * is asking a reviewer the same question four times and inviting four answers.
 * They are answered here, first, and every result of the trial reads them.
 *
 * This screen comes *before* the results, and the queue routes through it. The
 * alternative — showing them inline on the first result and copying them onward
 * — was the earlier design; it left a reviewer looking at answers they had never
 * given, with a "↺ carried from R-0184" marker to explain it.
 */

import { TRIAL_QUESTIONS } from '../_lib/robIdentity';
import { ROB2_QUESTIONS, isAsked, type AnswerCode, type Answers } from '../_lib/rob2';
import type { QuestionEvidence } from '../_lib/robSignalling';
import { questionState } from '../_lib/robQueue';
import { QuestionCard, type AiSuggestion } from './QuestionCard';
import { RoutedBlock } from './RoutedBlock';

interface Props {
  studyLabel: string;
  /** Which comparison these answers belong to, said plainly. */
  contrastText: string;
  resultCount: number;
  answers: Answers;
  rationale: Record<string, string>;
  evidence: Record<string, QuestionEvidence>;
  suggestions: Record<string, AiSuggestion | null>;
  notFound: Set<string>;
  readOnly: boolean;
  showAi: boolean;
  saving: boolean;
  onAnswer: (id: string, code: AnswerCode, origin: 'own' | 'ai') => void;
  onClear: (id: string) => void;
  onRationale: (id: string, text: string) => void;
  onContinue: () => void;
  onBack: () => void;
}

export function TrialQuestions({
  studyLabel, contrastText, resultCount, answers, rationale, evidence, suggestions,
  notFound, readOnly, showAi, saving, onAnswer, onClear, onRationale, onContinue, onBack,
}: Props) {
  const questions = TRIAL_QUESTIONS
    .map(id => ROB2_QUESTIONS.find(q => q.id === id))
    .filter((q): q is NonNullable<typeof q> => !!q);

  const asked = questions.filter(q => isAsked(q, answers));
  const open = asked.filter(q => !answers[q.id]).map(q => q.id);
  // A question whose prerequisite is unanswered is not skipped — nothing has
  // ruled it out yet — so the count cannot claim to know the denominator.
  const waiting = questions.filter(q => !isAsked(q, answers) && !answers[q.id]).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="border border-gray-200 rounded-xl bg-white dark:bg-[#111111] dark:border-[#1f1f1f] px-4 py-4">
        <div className="flex items-start gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-mono uppercase tracking-[0.09em] text-gray-400 dark:text-zinc-600">
              Before the result assessment
            </div>
            <div className="text-[17px] font-bold tracking-tight dark:text-white">{studyLabel}</div>
            <div className="text-[12.5px] text-gray-600 dark:text-zinc-400 mt-0.5">{contrastText}</div>
            <p className="text-[12.5px] text-gray-500 dark:text-zinc-500 mt-1 leading-relaxed max-w-[76ch]">
              Randomisation (1.1–1.3) and awareness of the assigned intervention (2.1–2.3). These
              answers apply to {resultCount} result{resultCount === 1 ? '' : 's'} with this exact
              comparison. D2 also has result-specific questions, answered next.
            </p>
          </div>
          <div className="text-right flex-none">
            <div className="text-[9px] font-mono uppercase tracking-[0.09em] text-gray-400 dark:text-zinc-600">
              Applies to
            </div>
            <div className="text-[12.5px] font-mono text-gray-600 dark:text-zinc-400">
              {resultCount} result{resultCount === 1 ? '' : 's'}
            </div>
          </div>
        </div>
      </div>

      <div className="border border-gray-200 rounded-xl bg-white dark:bg-[#111111] dark:border-[#1f1f1f]">
        <div className="px-4 py-3.5 border-b border-gray-100 dark:border-[#1a1a1a]">
          <h2 className="text-[15px] font-semibold dark:text-white">Trial-level questions</h2>
          {/* The consequence, before the button that causes it. Confirming a
              change here reopens completed reviews of every result on this
              comparison — which the code has always done and the screen never
              mentioned, so a colleague's finished review could revert with no
              warning to the person who caused it. */}
          <p className="text-[11.5px] text-gray-500 dark:text-zinc-500 mt-1 leading-relaxed">
            Edits are kept as a draft until you confirm. Confirming applies them to
            {' '}{resultCount} result{resultCount === 1 ? '' : 's'} — and if the answers actually
            changed, any completed review resting on them reopens for its reviewer to re-check,
            keeping every answer it already held.
          </p>
        </div>

        <div className="px-4 py-4 flex flex-col gap-3">
          {questions.filter(q => questionState(q, answers) === 'asked').map(question => (
            <QuestionCard
              key={question.id}
              question={question}
              merged={answers}
              evidence={evidence[question.id]}
              rationale={rationale[question.id] ?? ''}
              suggestion={suggestions[question.id] ?? null}
              notFound={notFound.has(question.id)}
              readOnly={readOnly}
              showAi={showAi}
              onAnswer={(code, origin) => onAnswer(question.id, code, origin)}
              onClear={() => onClear(question.id)}
              onRationale={text => onRationale(question.id, text)}
            />
          ))}

          <RoutedBlock
            skipped={questions.filter(q => questionState(q, answers) === 'skipped')}
            waiting={questions.filter(q => questionState(q, answers) === 'waiting')}
          />
        </div>

        <div className="flex items-center gap-2.5 flex-wrap px-4 py-3 border-t border-gray-100 dark:border-[#1a1a1a] bg-gray-50 dark:bg-[#0d0d0d] rounded-b-xl">
          <span className="text-[11px] font-mono text-gray-500 dark:text-zinc-500">
            {open.length
              ? `${asked.length - open.length}/${asked.length} applicable answered · `
                + `${open.join(', ')} outstanding`
                + (waiting ? ' · answer the earlier questions to continue' : '')
              : `All answered · read by ${resultCount} result${resultCount === 1 ? '' : 's'} with this comparison`}
          </span>
          <span className="flex-1" />
          <button
            type="button"
            onClick={onBack}
            className="text-[12.5px] font-semibold rounded-lg border border-gray-200 dark:border-[#2a2a2a] px-3 py-1.5 text-gray-600 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-[#1a1a1a]"
          >
            ← Back · keep draft
          </button>
          <button
            type="button"
            disabled={open.length > 0 || readOnly || saving}
            onClick={onContinue}
            className="text-[12.5px] font-semibold rounded-lg px-3 py-1.5 border border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-gray-900 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {open.length ? 'Answer these to continue' : 'Confirm & continue to result →'}
          </button>
        </div>
      </div>
    </div>
  );
}

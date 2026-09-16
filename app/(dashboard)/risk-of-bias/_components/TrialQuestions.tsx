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
import { QuestionCard, type AiSuggestion } from './QuestionCard';

interface Props {
  studyLabel: string;
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
  onRationale: (id: string, text: string) => void;
  onContinue: () => void;
  onBack: () => void;
}

export function TrialQuestions({
  studyLabel, resultCount, answers, rationale, evidence, suggestions, notFound,
  readOnly, showAi, saving, onAnswer, onRationale, onContinue, onBack,
}: Props) {
  const questions = TRIAL_QUESTIONS
    .map(id => ROB2_QUESTIONS.find(q => q.id === id))
    .filter((q): q is NonNullable<typeof q> => !!q);

  const open = questions.filter(q => isAsked(q, answers) && !answers[q.id]).map(q => q.id);

  return (
    <div className="flex flex-col gap-4">
      <div className="border border-border rounded-xl bg-white dark:bg-[#111111] dark:border-[#1f1f1f] px-4 py-4">
        <div className="flex items-start gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="text-[17px] font-bold tracking-tight dark:text-white">{studyLabel}</div>
            <p className="text-[12.5px] text-gray-500 dark:text-zinc-500 mt-0.5">
              Randomisation (1.1–1.3) and awareness of the assigned intervention (2.1–2.3). Six
              questions about the trial itself, answered once.
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

      <div className="border border-border rounded-xl bg-white dark:bg-[#111111] dark:border-[#1f1f1f]">
        <div className="px-4 py-3.5 border-b border-gray-100 dark:border-[#1a1a1a]">
          <h2 className="text-[15px] font-semibold dark:text-white">Trial-level questions</h2>
        </div>

        <div className="px-4 py-4 flex flex-col gap-3">
          {questions.map(question => (
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
              onRationale={text => onRationale(question.id, text)}
            />
          ))}
        </div>

        <div className="flex items-center gap-2.5 flex-wrap px-4 py-3 border-t border-gray-100 dark:border-[#1a1a1a] bg-gray-50/70 dark:bg-[#0d0d0d] rounded-b-xl">
          <span className="text-[11px] font-mono text-gray-500 dark:text-zinc-500">
            {open.length
              ? `${open.length} unanswered — ${open.join(', ')}`
              : `All six answered · read by all ${resultCount} result${resultCount === 1 ? '' : 's'}`}
          </span>
          <span className="flex-1" />
          <button
            type="button"
            onClick={onBack}
            className="text-[12.5px] font-semibold rounded-lg border border-gray-200 dark:border-[#2a2a2a] px-3 py-1.5 text-gray-600 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-[#1a1a1a]"
          >
            ← Back to queue
          </button>
          <button
            type="button"
            disabled={open.length > 0 || readOnly || saving}
            onClick={onContinue}
            className="text-[12.5px] font-semibold rounded-lg px-3 py-1.5 border border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-gray-900 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {open.length ? 'Answer the six to continue' : 'Confirm & go to results →'}
          </button>
        </div>
      </div>
    </div>
  );
}

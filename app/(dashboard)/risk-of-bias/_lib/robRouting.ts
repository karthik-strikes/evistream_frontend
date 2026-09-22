/**
 * Whether RoB 2 is asking a question, given the answers so far.
 *
 * Extracted from `robQueue.ts` (22 Sep 2026) so that the TRIAL gate can use it
 * too. It could not before: `robQueue` imports `robIdentity`, so `robIdentity`
 * importing back would have been a cycle — and the result was two answers to
 * one question. `trialOutstanding` counted all six trial questions flat, so a
 * reviewer who answered 2.1 and 2.2 "No" — which is exactly what makes RoB 2
 * skip 2.3 — was told forever that 2.3 was still missing, and D1 and D2 stayed
 * gated on an answer the instrument will never ask for. `writeTrial` had been
 * dropping that answer correctly the whole time.
 *
 * Depends only on the instrument, so nothing can import it in a circle.
 */

import { ROB2_QUESTIONS, type AnswerCode, type Answers, type SignallingQuestion } from './rob2';

/**
 * Where a question stands right now — and there are three states, not two.
 *
 *  · `asked`    — RoB 2 is asking it, and it counts toward progress.
 *  · `waiting`  — a question BEFORE it has no answer yet, so whether it will be
 *                 asked is not yet known. It is not "not applicable", and
 *                 showing it as such tells a reviewer it has been ruled out
 *                 when nothing has ruled it out.
 *  · `skipped`  — the answers above it mean RoB 2 will not ask it at all.
 *
 * The middle state is the one the screen kept getting wrong: 3.2-3.4 before 3.1
 * is answered are *pending*, and they reappear the moment 3.1 says they should.
 */
export type QuestionState = 'asked' | 'waiting' | 'skipped';

export function questionState(
  question: SignallingQuestion, answers: Answers,
): QuestionState {
  if (!question.askedWhen) return 'asked';
  if (question.askedWhen(answers)) return 'asked';
  // The routing said no. Is that settled, or is it waiting on something?
  return dependsOnUnanswered(question, answers) ? 'waiting' : 'skipped';
}

/**
 * Does this question's routing turn on a question nobody has answered?
 *
 * Asked by trying the routing again with each earlier question filled in: if
 * ANY answer to an unanswered predecessor would bring this question back, it is
 * waiting rather than ruled out. Brute force over five answers and at most 21
 * predecessors — a few hundred evaluations, once per render.
 */
function dependsOnUnanswered(
  question: SignallingQuestion, answers: Answers,
): boolean {
  const earlier = ROB2_QUESTIONS.filter(
    q => q.id < question.id && !answers[q.id]);
  for (const missing of earlier) {
    for (const code of ['Y', 'PY', 'PN', 'N', 'NI'] as AnswerCode[]) {
      if (question.askedWhen?.({ ...answers, [missing.id]: code })) return true;
    }
  }
  return false;
}

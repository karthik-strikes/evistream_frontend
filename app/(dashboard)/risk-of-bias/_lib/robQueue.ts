/**
 * The assessment queue: what is left to do, per study and per result.
 *
 * One rule shapes this file. **There is no such thing as one risk-of-bias
 * judgement for a paper.** RoB 2 judges a numerical result, and a trial that
 * reports pain relief at 6 hours and adverse events at 24 hours has two
 * judgements that are allowed to differ. So a study row here shows the *spread*
 * across its results — "▲1 !2 ✓1 across 4" — and never a single label. Rolling
 * them up to one worst-case dot was the old grid's design, and it is how a
 * reviewer comes to believe a study is at high risk when one of its six results
 * is.
 *
 * Pure — no React, no services.
 */

import {
  ROB2_QUESTIONS, ROB2_SIGNALLING, judgeDomain, judgeOverall,
  type AnswerCode, type Answers, type Severity, type SignallingQuestion,
} from './rob2';
import { mergedAnswers, shortLabel, trialKey, type ResultIdentity } from './robIdentity';
// Re-exported so the existing importers of `questionState` keep working; the
// definition moved out only so the trial gate could share it.
import { questionState } from './robRouting';

export { questionState, type QuestionState } from './robRouting';
import type { ResultAssessment, TrialRecord } from './robStore';

/**
 * The symbol beside a judgement, so it is never carried by colour alone.
 *
 * `none` has NO symbol on purpose. A dash is not a judgement — it was read as
 * one, and "– Not yet judged" puts a mark in front of the absence of a mark.
 * An empty circle says the same thing without claiming to be a state.
 */
export const SEVERITY_GLYPH: Record<Severity, string> = {
  low: '✓', some: '!', high: '▲', none: '',
};

export const SEVERITY_SHORT: Record<Severity, string> = {
  low: 'Low', some: 'Some concerns', high: 'High',
  // "Not yet judged", not "Not assessed": the answers may well be in — what is
  // missing is a judgement, and the two read as different amounts of work.
  none: 'Not yet judged',
};

/**
 * Where a result stands for THIS reviewer, and what is stopping them.
 *
 * Ordered by what a reviewer does about it, which is also the order the filters
 * run in: something is blocking, or nobody owns it, or the trial answers come
 * first, or it is simply work in progress, or it is done.
 *
 * `blocked` and `trial_needed` are separate on purpose. Both mean "not yet", but
 * one is somebody else's decision and the other is the reviewer's own next step.
 */
/**
 * How far one result has got — and only that.
 *
 * `unassigned` used to be in here. A reviewer seat is
 * `UNIQUE(project_id, document_id, reviewer_role)` — a fact about the whole
 * STUDY, for every form in the project — and it gates nothing here, because
 * editing is gated on the permission. Ranked above the real states it masked
 * them: a reviewer holding no seat saw every row of every study read
 * "Unassigned · Assign yourself to begin" instead of what was left to do.
 * The seat is `StudyGroup.seat`, said once per study, and changed on the
 * Assignments screen that owns the table.
 */
export type ResultProgress =
  | 'blocked'        // held — a comparison or a duplicate nobody has settled
  | 'agreed'         // adjudicated: the reviewers' disagreement is settled
  | 'trial_needed'   // the six trial questions for this comparison are open
  | 'stale'          // the identity changed under a review already made
  | 'not_started'    // ready, and nobody has answered anything yet
  | 'in_progress'
  | 'complete';

export const PROGRESS_LABEL: Record<ResultProgress, string> = {
  blocked: 'Blocked',
  agreed: 'Consensus agreed',
  stale: 'Review changes',
  trial_needed: 'Trial answers needed',
  // Separate from `in_progress` because they are different asks: one is
  // "pick this up", the other is "finish what you started", and a queue that
  // calls both "In progress" cannot be scanned for either.
  not_started: 'Not started',
  in_progress: 'In progress',
  complete: 'Your review complete',
};

export interface QueueResult {
  result: ResultIdentity;
  label: string;
  /**
   * A short handle for this result within its study — K1, K2, Z1.
   *
   * Reviewers refer to results out loud and in writing, and a uuid cannot be
   * said in a sentence while "the second one, K2" can. Derived from the study
   * label and the result's position, so it is stable for as long as the study's
   * result list is.
   */
  /** Five domain judgements — the reviewer's override, else the derived one. */
  severities: Severity[];
  /** The overall judgement, or 'none' while any domain is unjudged. */
  overall: Severity;
  progress: ResultProgress;
  /** One line saying what to do about it, when there is something to do. */
  blocker: string;
  /** True when the identity changed after this assessment was made. */
  stale: boolean;
}

export interface StudyGroup {
  documentId: string;
  label: string;
  /** The six trial questions are declared done for this study. */
  trialComplete: boolean;
  /** Reviewer seat on this study, or null — without one everything is read-only. */
  seat: string | null;
  results: QueueResult[];
  /** Counts by overall judgement, for the spread marker. */
  spread: Record<Severity, number>;
}

/** Severity per domain for one assessment, overrides included. */
export function severitiesOf(
  assessment: ResultAssessment, merged: Answers,
): Severity[] {
  return ROB2_SIGNALLING.map((_, i) =>
    assessment.overrides[i] ?? judgeDomain(i, merged) ?? 'none');
}

/** The overall judgement shown for one assessment. */
export function overallOf(
  assessment: ResultAssessment, severities: Severity[],
): Severity {
  if (assessment.overallOverride) return assessment.overallOverride;
  // Any unjudged domain leaves the overall blank rather than optimistic. An
  // assessment three questions from finished is not "low risk so far".
  if (severities.some(s => s === 'none')) return 'none';
  return judgeOverall(severities).severity ?? 'none';
}

/**
 * Answered and applicable, and whether more questions may yet appear.
 *
 * `mayGrow` is why the queue says "5/12 applicable answered · more may apply".
 * Counting all 22 gives a bar that never fills, because most conditional
 * questions route out; counting only today's applicable ones, with no hint that
 * the total can rise, makes a reviewer think they are nearly done when a single
 * answer is about to add four more questions.
 */
export function progressOf(merged: Answers): {
  answered: number; applicable: number; mayGrow: boolean;
} {
  let answered = 0;
  let applicable = 0;
  let mayGrow = false;
  for (const domain of ROB2_SIGNALLING) {
    for (const question of domain.questions) {
      const state = questionState(question, merged);
      if (state === 'waiting') mayGrow = true;
      if (state !== 'asked') continue;
      applicable += 1;
      if (merged[question.id]) answered += 1;
    }
  }
  return { answered, applicable, mayGrow };
}

export interface QueueInput {
  results: ResultIdentity[];
  /** `study:contrast` → the reviewer's trial-level record for that comparison. */
  trialByComparison: Map<string, TrialRecord>;
  /** result id → the reviewer's assessment of it. */
  assessmentByResult: Map<string, ResultAssessment>;
  /** document id → study label ("Raslan 2021"). */
  labels: Record<string, string>;
  /** document id → the seat this reviewer holds, when they hold one. */
  seats: Map<string, string>;
  /**
   * Documents whose adjudication is finished.
   *
   * Consensus is saved per (document, form) and the risk-of-bias record holds
   * every result of that document in ONE row, so a completed adjudication
   * genuinely covers all of them — which is the only reason a document-level
   * fact may be shown on a result-level row.
   */
  agreedDocuments?: Set<string>;
}

/**
 * Group the project's results by study, in the order a reviewer works through
 * them: study by study, because the six trial questions are answered once and
 * doing them per result would ask the same thing four times.
 */
export function buildQueue(input: QueueInput): StudyGroup[] {
  const byDocument = new Map<string, ResultIdentity[]>();
  for (const result of input.results) {
    const list = byDocument.get(result.document_id) ?? [];
    list.push(result);
    byDocument.set(result.document_id, list);
  }

  const groups: StudyGroup[] = [];
  for (const [documentId, results] of byDocument) {
    const seat = input.seats.get(documentId) ?? null;
    const spread: Record<Severity, number> = { low: 0, some: 0, high: 0, none: 0 };

    const rows = results.map<QueueResult>((result, index) => {
      // Trial answers belong to a COMPARISON, so two results of one study can
      // legitimately be at different stages.
      const trial = input.trialByComparison.get(trialKey(result));
      const assessment = input.assessmentByResult.get(result.id);
      const merged = mergedAnswers(trial?.answers ?? {}, assessment?.answers ?? {});
      const severities = assessment
        ? severitiesOf(assessment, merged)
        : (['none', 'none', 'none', 'none', 'none'] as Severity[]);
      const overall = assessment ? overallOf(assessment, severities) : 'none';
      const counts = progressOf(merged);
      spread[overall] += 1;

      // A result whose identity changed after the assessment was made. The
      // assessment is not thrown away and not silently re-pointed — it is
      // flagged, and a person decides.
      const stale = !!assessment && assessment.resultVersion !== null
        && typeof result.version === 'number'
        && assessment.resultVersion < result.version;

      const progress: ResultProgress = result.state === 'held'
        ? 'blocked'
        : input.agreedDocuments?.has(result.document_id)
          ? 'agreed'
          : assessment?.complete
            ? 'complete'
            : !trial?.complete
              ? 'trial_needed'
                // Ranked below `complete`, as the instrument's own workspace
                // ranks it — so a finished review still reads as finished.
                // `stale` stays on the row as well, which is what keeps that
                // case visible at all.
              : stale ? 'stale'
                : counts.answered > 0 ? 'in_progress' : 'not_started';

      return {
        result,
        label: shortLabel(result),
        severities,
        overall,
        progress,
        blocker: progress === 'blocked'
          ? (result.contrast ? 'Waiting on a duplicate decision' : 'Comparison needed')
          : progress === 'trial_needed' ? 'Answer the trial questions first'
            : '',
        stale,
      };
    });

    rows.sort((a, b) => a.label.localeCompare(b.label));

    groups.push({
      documentId,
      label: input.labels[documentId] ?? documentId,
      trialComplete: rows.length > 0 && rows.every(
        r => r.progress !== 'trial_needed'),
      seat,
      results: rows,
      spread,
    });
  }

  groups.sort((a, b) => a.label.localeCompare(b.label));
  return groups;
}

/** One line summarising a study's results, for the group row. */
export function spreadText(spread: Record<Severity, number>, total: number): string {
  const parts: string[] = [];
  for (const severity of ['high', 'some', 'low', 'none'] as Severity[]) {
    if (!spread[severity]) continue;
    const glyph = SEVERITY_GLYPH[severity];
    parts.push(glyph ? `${glyph} ${spread[severity]}` : `${spread[severity]} not yet judged`);
  }
  return `${parts.join('  ')}  across ${total}`;
}

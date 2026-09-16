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
  ROB2_SIGNALLING, judgeDomain, judgeOverall, type Answers, type Severity,
} from './rob2';
import { mergedAnswers, shortLabel, type ResultIdentity } from './robIdentity';
import type { ResultAssessment, TrialRecord } from './robStore';

export const SEVERITY_GLYPH: Record<Severity, string> = {
  low: '✓', some: '!', high: '▲', none: '–',
};

export const SEVERITY_SHORT: Record<Severity, string> = {
  low: 'Low', some: 'Some concerns', high: 'High', none: 'Not assessed',
};

/** Where an assessment has got to. Declared by a person, never inferred. */
export type ResultProgress = 'untouched' | 'in_progress' | 'complete' | 'held';

export interface QueueResult {
  result: ResultIdentity;
  label: string;
  /** Five domain judgements — the reviewer's override, else the derived one. */
  severities: Severity[];
  /** The overall judgement, or 'none' while any domain is unjudged. */
  overall: Severity;
  progress: ResultProgress;
  /** How many applicable questions have answers, and how many there are. */
  answered: number;
  applicable: number;
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

/** Answered / applicable across all 22, given the trial's answers and this result's. */
export function progressOf(merged: Answers): { answered: number; applicable: number } {
  let answered = 0;
  let applicable = 0;
  for (const domain of ROB2_SIGNALLING) {
    for (const question of domain.questions) {
      if (!isAskedSafe(question, merged)) continue;
      applicable += 1;
      if (merged[question.id]) answered += 1;
    }
  }
  return { answered, applicable };
}

function isAskedSafe(
  question: { askedWhen?: (a: Answers) => boolean }, answers: Answers,
): boolean {
  return question.askedWhen ? question.askedWhen(answers) : true;
}

export interface QueueInput {
  results: ResultIdentity[];
  /** document id → the reviewer's trial-level record. */
  trialByDocument: Map<string, TrialRecord>;
  /** result id → the reviewer's assessment of it. */
  assessmentByResult: Map<string, ResultAssessment>;
  /** document id → study label ("Raslan 2021"). */
  labels: Record<string, string>;
  /** document id → the seat this reviewer holds, when they hold one. */
  seats: Map<string, string>;
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
    const trial = input.trialByDocument.get(documentId);
    const spread: Record<Severity, number> = { low: 0, some: 0, high: 0, none: 0 };

    const rows = results.map<QueueResult>(result => {
      const assessment = input.assessmentByResult.get(result.id);
      const merged = mergedAnswers(trial?.answers ?? {}, assessment?.answers ?? {});
      const severities = assessment
        ? severitiesOf(assessment, merged)
        : (['none', 'none', 'none', 'none', 'none'] as Severity[]);
      const overall = assessment ? overallOf(assessment, severities) : 'none';
      const counts = progressOf(merged);
      spread[overall] += 1;

      return {
        result,
        label: shortLabel(result),
        severities,
        overall,
        progress: result.state === 'held'
          ? 'held'
          : assessment?.complete
            ? 'complete'
            : counts.answered > 0 ? 'in_progress' : 'untouched',
        answered: counts.answered,
        applicable: counts.applicable,
        // A result whose identity changed after the assessment was made. The
        // assessment is not thrown away and not silently re-pointed — it is
        // flagged, and a person decides.
        stale: !!assessment && assessment.resultVersion !== null
          && typeof result.version === 'number'
          && assessment.resultVersion < result.version,
      };
    });

    rows.sort((a, b) => a.label.localeCompare(b.label));

    groups.push({
      documentId,
      label: input.labels[documentId] ?? documentId,
      trialComplete: !!trial?.complete,
      seat: input.seats.get(documentId) ?? null,
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
    if (spread[severity]) parts.push(`${SEVERITY_GLYPH[severity]} ${spread[severity]}`);
  }
  return `${parts.join('  ')}  across ${total}`;
}

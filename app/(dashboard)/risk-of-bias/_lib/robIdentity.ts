/**
 * What a risk-of-bias assessment is about, and where each answer is stored.
 *
 * Two ideas live here, and they are the same idea seen from two sides.
 *
 * **A result has eight slots.** RoB 2 assesses one numerical estimate, not a
 * paper. Two results of one trial can share study, contrast, outcome domain and
 * timepoint and still be different results — a responder proportion and a mean,
 * or an intention-to-treat estimate and a per-protocol one. The page this
 * replaces keyed on `outcome · timepoint · comparison`, under which all of
 * those collapse into one.
 *
 * **Six of the 22 questions are about the trial, not the result.** How it was
 * randomised (1.1-1.3) and who knew the assignment (2.1-2.3) cannot differ
 * between a trial's own outcomes, so they are answered once per study and every
 * result of that study reads the same answers. Everything from 2.4 on is
 * result-specific: 2.4 asks whether deviations affected *this* outcome, and
 * 2.6/2.7 turn on *this* result's analysis population — modified ITT for one
 * result and complete case for another of the same trial.
 *
 * That split is not a convenience. Copying the six between assessments was the
 * earlier design, and it meant provenance to chase, two records to keep in step,
 * and a reviewer wondering why an answer they never gave was already filled in.
 * One stored answer, read by every result, has none of those.
 *
 * Mirrored by `backend/utils/rob2_engine.py:TRIAL_LEVEL_QUESTIONS`, and pinned
 * by `zscripts/check_rob2_mirror.py`. Pure — no React, no services — so the
 * check scripts can import it under bare Node.
 */

import { ROB2_QUESTIONS, type AnswerCode, type Answers } from './rob2';
import { questionState } from './robRouting';

/** The six questions answered once per study. */
export const TRIAL_QUESTIONS: readonly string[] = ['1.1', '1.2', '1.3', '2.1', '2.2', '2.3'];

export function isTrialQuestion(id: string): boolean {
  return TRIAL_QUESTIONS.includes(id);
}

// ── The result ───────────────────────────────────────────────────────────────

export interface Contrast {
  id: string;
  intervention: string;
  comparator: string;
  canonical_key?: string | null;
  state?: string;
}

export interface ResultIdentity {
  id: string;
  document_id: string;
  contrast?: Contrast | null;
  population: string;
  outcome_domain: string;
  measurement: string;
  timepoint: string;
  analysis_population: string;
  analysis: string;
  estimate: string;
  version?: number;
  state?: string;
}

/**
 * A comparison is DIRECTED, so it is rendered from two fields rather than
 * stored as one string. Swapping them inverts every estimate that points here.
 */
export function contrastLabel(contrast?: Contrast | null): string {
  if (!contrast || !contrast.intervention) return '—';
  return `${contrast.intervention} vs ${contrast.comparator}`;
}

/**
 * Which set of trial answers this result reads — study AND comparison.
 *
 * 2.1-2.3 ask who knew the assigned intervention, and in a trial running three
 * drugs against placebo one arm can be double-blind and another open-label. One
 * set per trial would make a reviewer give a single answer to two different
 * truths. Every result of the same comparison still shares one set; that is the
 * point of answering them once.
 *
 * A result whose comparison is not settled has no scope yet and falls back to
 * the study, which is where these answers lived before they were scoped.
 */
export function trialKey(
  result: Pick<ResultIdentity, 'document_id' | 'contrast'>,
): string {
  return `${result.document_id}:${result.contrast?.id ?? ''}`;
}

/**
 * The one-line name of a result, for a queue row or a header.
 *
 * The measurement is in the name, not dropped as a detail. A responder
 * proportion and a mean pain score, same outcome and same timepoint, are two
 * different results with two different answers to question 4.1 — and without
 * the measurement two queue rows read identically, which is precisely the
 * confusion this page exists to remove.
 */
/**
 * How a recorded absence should read on screen.
 *
 * A trial that says "not applicable" and a trial that simply never reported it
 * are different facts, and both are different from a value nobody extracted.
 * The corpus records all three as terse tokens; showing the token is showing
 * our storage format, and showing nothing at all quietly merges the three.
 *
 * An empty string IS the third case — nothing was extracted — and stays blank,
 * because writing "not reported" over it would assert something about the paper
 * that nobody checked.
 */
export function absenceLabel(value: string | null | undefined): string {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const upper = text.toUpperCase();
  if (upper === 'NA' || upper === 'N.A.' || upper === 'NOT APPLICABLE') {
    return 'Not applicable (NA)';
  }
  if (upper === 'NR' || upper === 'N/R' || upper === 'NOT REPORTED') {
    return 'Not reported (NR)';
  }
  return text;
}

export function shortLabel(result: ResultIdentity): string {
  const parts = [result.outcome_domain];
  if (result.measurement) parts.push(result.measurement);
  if (result.timepoint) parts.push(result.timepoint);
  if (result.contrast?.intervention) parts.push(contrastLabel(result.contrast));
  // "Overall" is the written default, not a finding — saying it on every row
  // would bury the subgroup results that actually differ.
  if (result.population && !/^overall$/i.test(result.population)) {
    parts.push(result.population);
  }
  return parts.join(' · ');
}

/**
 * A result's name in a queue row, where the study header already carries the
 * comparison.
 *
 * Saying "vs Placebo" on all six rows under a header that says it once buries
 * the thing that actually differs between them — the outcome, the timepoint and
 * how it was measured. `shortLabel` keeps the comparison because it is used
 * where there is no header to carry it.
 */
export function rowLabel(result: ResultIdentity): {
  title: string; detail: string;
} {
  const title = [result.outcome_domain, absenceLabel(result.timepoint)]
    .filter(Boolean).join(' · ');
  const detail = [
    result.measurement,
    // A subgroup is a real difference between two rows; "Overall" is what we
    // wrote when no source form recorded a population.
    result.population && !/^overall$/i.test(result.population) ? result.population : '',
  ].filter(Boolean).join(' · ');
  return { title: title || 'Result', detail };
}

export interface IdentitySlot {
  label: string;
  value: string;
  /** A short marker: the contrast id, `default`, `verbatim`, `inferred`. */
  tag?: string;
  /** True when the value is a written default rather than something recorded. */
  isDefault?: boolean;
}

/**
 * Every slot, for the assessment header.
 *
 * Shown in full rather than behind an expander: a reviewer who cannot see which
 * estimate they are judging can answer question 5.2 about the wrong one.
 */
export function identitySlots(result: ResultIdentity,
                              measurementInferred = false): IdentitySlot[] {
  const isDefaultPopulation = /^overall$/i.test(result.population || '');
  return [
    { label: 'Contrast',
      value: result.contrast
        ? `${result.contrast.intervention} → ${result.contrast.comparator}`
        : 'not resolved',
      tag: result.contrast?.id?.slice(0, 8) },
    { label: 'Population', value: result.population || 'Overall',
      tag: isDefaultPopulation ? 'default' : 'declared', isDefault: isDefaultPopulation },
    { label: 'Outcome domain', value: result.outcome_domain },
    { label: 'Measurement', value: result.measurement || 'not recorded',
      tag: measurementInferred ? 'inferred' : undefined, isDefault: measurementInferred },
    { label: 'Timepoint', value: result.timepoint || 'not recorded', tag: 'verbatim' },
    { label: 'Analysis population', value: result.analysis_population || 'not recorded' },
    { label: 'Analysis', value: result.analysis || 'not recorded' },
    { label: 'Effect estimate', value: result.estimate || 'not recorded' },
  ];
}

// ── Merging the two answer stores ────────────────────────────────────────────

/**
 * The answer set the algorithm sees: the trial's six, plus this result's own.
 *
 * The result's answers win on a collision. That can only happen for a question
 * that moved between the two levels, and in that case the more specific record
 * is the one somebody answered about this estimate.
 */
export function mergedAnswers(trial: Answers, result: Answers): Answers {
  const out: Answers = {};
  for (const id of Object.keys(trial)) out[id] = trial[id];
  for (const id of Object.keys(result)) out[id] = result[id];
  return out;
}

/** Split an incoming answer map by where each question is stored. */
export function splitAnswers(answers: Answers): { trial: Answers; result: Answers } {
  const trial: Answers = {};
  const result: Answers = {};
  for (const id of Object.keys(answers)) {
    const code = answers[id] as AnswerCode | undefined;
    if (!code) continue;
    if (isTrialQuestion(id)) trial[id] = code;
    else result[id] = code;
  }
  return { trial, result };
}

/**
 * Which trial questions RoB 2 is still waiting on — routing included.
 *
 * Not "which of the six have no answer". 2.3 is asked only when 2.1 or 2.2 says
 * somebody was aware of the assigned intervention; answer both "No" and the
 * instrument never asks it, `writeTrial` drops any answer to it, and a flat
 * count then reports it missing forever. That left D1 and D2 gated behind a
 * question that could not be answered, with "Answer them now" offering to take
 * the reviewer somewhere that had nothing to ask.
 *
 * A question whose routing turns on one nobody has answered yet is NOT listed:
 * it is `waiting`, and what is actually outstanding is the question before it.
 */
export function trialOutstanding(trial: Answers): string[] {
  return TRIAL_QUESTIONS.filter((id) => {
    if (trial[id]) return false;
    const question = ROB2_QUESTIONS.find((q) => q.id === id);
    // Unknown id: fall back to the flat reading rather than silently passing.
    return question ? questionState(question, trial) === 'asked' : true;
  });
}

/** Whether every trial question this trial is ASKED has an answer. */
export function trialComplete(trial: Answers): boolean {
  return trialOutstanding(trial).length === 0;
}

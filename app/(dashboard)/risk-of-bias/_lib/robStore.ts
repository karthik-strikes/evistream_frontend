/**
 * Storage constants for the RoB 2 form.
 *
 * Answers live in `extraction_results.extracted_data` on the RoB 2 form: one
 * record per person per document, one entry per assessment in the repeating
 * `risk_of_bias_assessments` field. The reading and writing of that record is
 * `robModel.ts` (schema 3); this file only names the columns and root keys, so
 * the reader, the writer and the check scripts spell them one way.
 *
 * The Sep 15 per-result page kept its readers and writers here; they were
 * retired with that page (Sep 24 2026).
 */

/**
 * The repeating field holding one entry per assessed result, in forms built from
 * the preset. A form built by hand may call it something else, so every function
 * here takes the name from the bound form and falls back to this only when the
 * form does not say.
 */
export const ASSESSMENT_TABLE = 'risk_of_bias_assessments';

/** Which result an entry is about. Stable; the outcome name is not. */
export const RESULT_ID_COLUMN = 'result_id';

/** The identity version this assessment was made against. */
export const RESULT_VERSION_COLUMN = 'result_version';

/** Human-readable name of the result, kept so an export reads as prose. */
export const RESULT_LABEL_COLUMN = 'outcome_assessed';

/**
 * Bookkeeping that is not an answer: which domains the reviewer confirmed,
 * whether they declared the assessment complete, any overrides and why.
 *
 * One named key rather than a dozen loose ones, so a reader of the raw JSON can
 * see at a glance which fields are the instrument's and which are ours.
 */
export const META_COLUMN = 'rob_workflow';

/**
 * A source reference and supporting passage per answer, as JSON.
 *
 * The rationale column already holds prose. This holds the two things prose
 * cannot be searched or checked for: WHERE the reviewer looked, and WHAT it
 * said. An assessment whose evidence is only a paragraph of reasoning cannot be
 * audited without re-reading the paper.
 */
export const EVIDENCE_COLUMN = 'rob_evidence';

/**
 * Where an answer came from, when it was not typed here.
 *
 * Copying answers between results of one trial is legitimate and common — D1
 * rarely differs — but an answer that arrived by copy is a weaker claim than
 * one somebody made looking at this result, and consensus needs to know which
 * it is reading. The record survives later edits: it says the answer was copied
 * AND that it has since been changed, because "edited after copying" is a
 * different thing again from either.
 */
export const PROVENANCE_COLUMN = 'rob_provenance';

export interface AnswerEvidence {
  /** Where the reviewer looked — "p.6 · Table 2", a registry id, a protocol. */
  reference: string;
  /** What it said, in the source's own words. */
  passage: string;
}

export interface AnswerOrigin {
  /** The result this answer was copied from, if it was. */
  copiedFrom?: string;
  copiedAt?: string;
  /** True once somebody changed it after the copy. */
  editedSince?: boolean;
}

/** Root keys. The instrument is recorded on every record it produced. */
export const ROOT_INSTRUMENT = 'rob_instrument';
export const ROOT_INSTRUMENT_VERSION = 'rob_instrument_version';
export const ROOT_TRIAL_DESIGN = 'rob_trial_design';
export const ROOT_EFFECT = 'rob_effect_of_interest';
export const ROOT_TRIAL_DONE = 'rob_trial_questions_complete';

/**
 * Trial answers, keyed by the comparison they are about.
 *
 * **Scoped to study AND comparison, not to the study alone.** 2.1-2.3 ask who
 * knew the assigned intervention; in a trial running three drugs against
 * placebo, one arm can be double-blind and another open-label, so one set of
 * answers per trial would force a reviewer to give one answer for two different
 * truths. Every result of the SAME comparison still shares one set — which is
 * the whole point — but a different comparison of the same trial gets its own.
 *
 * Records written before this existed keep their answers in the root columns,
 * and `readTrial` still reads them when the map has no entry. Nothing is
 * migrated in place: an old record is read where it lies and rewritten into the
 * map the first time somebody saves.
 */
export const ROOT_TRIAL_BY_COMPARISON = 'rob_trial';

export const INSTRUMENT_VERSION = '2019-08-22';

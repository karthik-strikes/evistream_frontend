/**
 * The *input* side of absence: what a reviewer typing into a box meant.
 *
 * Deliberately not `canonicalAbsenceLabel` from `lib/absence.ts`. That function
 * reads *stored* data, where a guess is the least-bad option available, and it
 * folds `'N/A'` into NR. At the keyboard there is a better option than guessing:
 * ask. `lib/absence.ts` is the comparator's vocabulary and has a Python mirror
 * in `backend/utils/absence.py` — it must not learn this distinction, so the
 * distinction lives here instead.
 *
 * Why `'N/A'` matters enough to warrant a module: it is the single most
 * ambiguous token in the set. Most clinicians write it for *not applicable*;
 * `lib/absence.ts:56` classifies it as *not reported*. Those are different
 * findings about a study, and the old behaviour resolved it silently — the
 * input was disabled and blanked, and on re-save the stored text changed from
 * "N/A" to "NR".
 */

import { canonicalAbsenceLabel } from '@/lib/absence';

/** Typed text that can only mean "the paper is silent on this". */
const UNAMBIGUOUS_NR = new Set([
  'NR', 'N/R', 'NOT REPORTED', 'NOT_REPORTED', 'NOT-REPORTED',
]);

/** Typed text that can only mean "this cannot apply to this study". */
const UNAMBIGUOUS_NA = new Set([
  'NA', 'N.A.', 'NOT APPLICABLE', 'NOT_APPLICABLE', 'NOT-APPLICABLE',
]);

/**
 * Reads as either, so the reviewer is asked rather than guessed at.
 *
 * Everything else is excluded, and each for its own reason:
 *   `''`      not an answer at all — blank must keep meaning "not yet filled"
 *   `'None'`  a substantive finding — a study with no funding reported its funding
 *   `'0'`     a number
 *   `'-'`     a legal prefix of `-3.2`; prompting mid-keystroke is intolerable
 */
const AMBIGUOUS = new Set(['N/A', 'N.A']);

function token(value: any): string | null {
  return typeof value === 'string' ? value.trim().toUpperCase() : null;
}

/** NR / NA for text that admits exactly one reading, else null. */
export function unambiguousAbsenceLabel(value: any): 'NR' | 'NA' | null {
  const t = token(value);
  if (t === null) return null;
  if (UNAMBIGUOUS_NA.has(t)) return 'NA';
  if (UNAMBIGUOUS_NR.has(t)) return 'NR';
  return null;
}

/** True when the reviewer must be asked which absence they meant. */
export function needsAbsenceDisambiguation(value: any): boolean {
  const t = token(value);
  return t !== null && AMBIGUOUS.has(t);
}

/**
 * Does this option list already declare the author's own spelling of a token?
 *
 * The form author's vocabulary outranks the generic affordance: a RoB2
 * signalling question that declares "Not applicable" as a real answer must show
 * it once, in the author's wording, not twice in two spellings.
 *
 * Uses the *stored* classifier on purpose, unlike everything above it. An author
 * writing "N/A" into their option list has made a deliberate, durable choice and
 * there is nobody to ask at render time — so here, folding is right.
 */
export function hasDeclaredAbsence(
  options: string[] | undefined | null,
  token: 'NR' | 'NA',
): boolean {
  return (options ?? []).some(o => canonicalAbsenceLabel(o) === token);
}

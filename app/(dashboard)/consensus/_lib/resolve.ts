/**
 * What gets saved for one field, and why.
 *
 * This is the whole point of the module: `final_value` and `resolution_source`
 * used to be computed by two independent decision trees over the same state
 * (`resolveFieldValue` and a ternary chain inside `handleSubmit`), and both put
 * the "these sources already agree" short-circuit *first*. Three of the audit's
 * highest-severity bugs came straight out of that:
 *
 *   1. Overriding an agreed field was silently discarded — the short-circuit
 *      returned the agreed value before anything looked at the reviewer's
 *      decision, and the source was stamped `agreed`.
 *   2. "Needs correction" with an empty box saved the AI value the reviewer had
 *      just flagged as wrong, via `f.legacyCorrection || f.sources.ai || null`.
 *      That `||` chain also turned a legitimate `0` or `false` into `null`.
 *   3. A single-source field inside a dual-reviewer document was stamped
 *      `resolution_source: 'custom'`, because the ternary chain only knew five
 *      decisions and everything else fell through to the default.
 *
 * So there is now exactly one function, `resolveField`, returning the value and
 * its provenance together — they cannot disagree because they are computed once.
 *
 * No React imports on purpose. The repo has no frontend test runner (which is
 * also why `lib/quote-match.ts` is written as pure functions), so the only way to
 * check a decision table is to exercise it directly.
 */

import { NR_LABEL, NA_LABEL, canonicalAbsenceLabel } from '@/lib/absence';
import { unambiguousAbsenceLabel } from '../../manual-extraction/_lib/absenceInput';

/** What the reviewer chose for a field. */
export type Decision =
  | 'agreed'           // leave the matching sources alone
  | 'accept_ai'
  | 'accept_r1'
  | 'accept_r2'
  | 'accept_majority'  // take the value the majority of sources agree on
  | 'custom'           // type a value
  | 'nr'               // the paper does not report this
  | 'na'               // this cannot apply to this study
  | 'correct'          // single-source card: the one value shown is right
  | 'incorrect';       // single-source card: it is wrong, here is the fix

/**
 * How the field was settled, as stored in `field_resolutions[*].resolution_source`
 * and validated by the backend's `ResolutionSource` Literal. This is the
 * provenance of `final_value` for `data_cleaning_service` and every export, so a
 * wrong label silently poisons any later audit of who decided what.
 */
export type ResolutionSource =
  | 'agreed'
  | 'ai'
  | 'reviewer_1'
  | 'reviewer_2'
  | 'majority'
  | 'suggestion'       // legacy alias for 'majority'; nothing can have written it
  | 'custom'
  | 'not_reported'
  | 'not_applicable';

export type SourceKey = 'ai' | 'r1' | 'r2';

const SOURCE_OF: Record<SourceKey, Extract<ResolutionSource, 'ai' | 'reviewer_1' | 'reviewer_2'>> = {
  ai: 'ai',
  r1: 'reviewer_1',
  r2: 'reviewer_2',
};

/** The slice of a field's state that resolution depends on. */
export interface ResolvableField {
  sources: { ai?: any; r1?: any; r2?: any };
  /** True when ≥2 present sources matched, computed at load time. */
  agreed: boolean;
  suggestion?: { value: any; source: string; reason: string };
  decision: Decision | string | null;
  customValue: any;
  legacyCorrection: string;
  /**
   * The field's declared options, so a form author's own spelling of an absence
   * ("Not applicable" on a RoB2 signalling question) is recognised as the claim
   * it is without being rewritten to the generic token.
   */
  options?: string[] | null;
}

/**
 * Which absence, if any, a value asserts — `null` when it is an ordinary answer
 * or when the text is ambiguous.
 *
 * This is what lets one control write every kind of answer. The reviewer picks
 * or types into the value editor; the provenance is *derived* from what they
 * entered rather than asserted by which button they happened to press. Before
 * this, "not reported" was reachable two ways that stored two different records.
 *
 * Ambiguity is deliberately not resolved here: `'N/A'` returns null and stays a
 * plain custom value. The reviewer is asked at the keyboard instead
 * (`_lib/absenceInput.ts`), so nothing is ever silently reinterpreted at rest.
 */
function absenceSourceOf(value: any, options?: string[] | null): ResolutionSource | null {
  const declared = (options ?? []).find(
    o => typeof value === 'string' && o.trim().toLowerCase() === value.trim().toLowerCase(),
  );
  const label = unambiguousAbsenceLabel(declared ?? value);
  if (label === 'NR') return 'not_reported';
  if (label === 'NA') return 'not_applicable';
  return null;
}

export interface Resolution {
  finalValue: any;
  source: ResolutionSource;
  /** Whether this counts toward the agreed tally, i.e. nobody had to intervene. */
  agreed: boolean;
}

/**
 * Nothing was recorded here.
 *
 * NR and NA are deliberately NOT empty: they are answers a reviewer gave. This
 * mirrors `is_unfilled` in the backend's `utils/value_compare.py` — an unfilled
 * cell is not a claim about the paper, while an explicit reporting gap is.
 * Distinct from `fieldIsEmpty` in `lib/absence.ts`, which folds NR *into* empty
 * because it answers a different question (coverage, not agreement).
 */
export function isUnfilled(v: any): boolean {
  if (v === null || v === undefined) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'string') return v.trim() === '';
  return false;
}

/** First source that actually recorded something, in AI → R1 → R2 order. */
function firstPresent(sources: ResolvableField['sources']): { key: SourceKey; value: any } | null {
  for (const key of ['ai', 'r1', 'r2'] as SourceKey[]) {
    const value = sources[key];
    if (value !== undefined && !isUnfilled(value)) return { key, value };
  }
  return null;
}

/**
 * The single resolver. Precedence matters: **an explicit decision always beats
 * `agreed`**. That ordering is the fix for bug 1 — the reviewer opened an agreed
 * field and overrode it on purpose, so the override is the answer.
 */
export function resolveField(f: ResolvableField): Resolution {
  const d = f.decision;

  // ── Explicit decisions, in precedence order ──
  if (d === 'custom') {
    // The value decides its own provenance. Whatever the reviewer entered is
    // stored verbatim — a declared "Not applicable" keeps that wording rather
    // than being rewritten to "NA" — while the source records the claim.
    return {
      finalValue: f.customValue,
      source: absenceSourceOf(f.customValue, f.options) ?? 'custom',
      agreed: false,
    };
  }
  if (d === 'nr') {
    return { finalValue: NR_LABEL, source: 'not_reported', agreed: false };
  }
  if (d === 'na') {
    return { finalValue: NA_LABEL, source: 'not_applicable', agreed: false };
  }
  if (d === 'accept_ai' || d === 'accept_r1' || d === 'accept_r2') {
    const key = d.slice('accept_'.length) as SourceKey;
    // `?? null`, never `||`: a source whose value is 0 or false recorded a
    // finding, and `||` would replace it with null.
    return { finalValue: f.sources[key] ?? null, source: SOURCE_OF[key], agreed: false };
  }
  if ((d === 'accept_majority' || d === 'accept_suggestion') && f.suggestion) {
    return { finalValue: f.suggestion.value, source: 'majority', agreed: false };
  }
  if (d === 'correct') {
    // Bug 3: name the source that was actually present. Stamping 'custom' here
    // claimed a human typed a value when they had only confirmed one.
    const present = firstPresent(f.sources);
    return {
      finalValue: present ? present.value : null,
      source: present ? SOURCE_OF[present.key] : 'custom',
      agreed: false,
    };
  }
  if (d === 'incorrect') {
    // Bug 2: never fall back to the value the reviewer just called wrong. With
    // no correction typed there is no answer, and `null` says so honestly.
    // `canSubmit` refuses to submit in that state, so it should be unreachable.
    const corrected = (f.legacyCorrection ?? '').trim();
    if (corrected === '') return { finalValue: null, source: 'custom', agreed: false };
    // The fourth write path, and it used to stamp 'custom' unconditionally — so
    // a reviewer correcting a field to "not reported" was recorded as having
    // typed a value.
    return {
      finalValue: f.legacyCorrection,
      source: absenceSourceOf(f.legacyCorrection, f.options) ?? 'custom',
      agreed: false,
    };
  }

  // ── No explicit decision: the sources already agreed ──
  if (f.agreed || d === 'agreed') {
    const present = firstPresent(f.sources);
    return { finalValue: present ? present.value : null, source: 'agreed', agreed: true };
  }

  return { finalValue: null, source: 'custom', agreed: false };
}

/**
 * Is this field ready to submit?
 *
 * `custom` and `incorrect` both need their text box filled in. The `incorrect`
 * half is bug 2's other end: submission used to be allowed with an empty box,
 * and the resolver then quietly saved the rejected value.
 */
export function isFieldResolved(f: ResolvableField): boolean {
  if (f.agreed && (f.decision === null || f.decision === 'agreed')) return true;
  if (f.decision === null) return false;
  if (f.decision === 'custom') return !isUnfilled(f.customValue);
  if (f.decision === 'incorrect') return !isUnfilled(f.legacyCorrection);
  return true;
}

/**
 * Turn a stored `resolution_source` back into the decision that produced it, so
 * reopening a saved document restores what the adjudicator chose.
 *
 * This is bug 3b, the worst of the set and live until now: `ai` and `majority`
 * had no branch here, so a field resolved by accepting AI came back with
 * `decision === null`, `canSubmit()` returned false, and **the document could
 * never be re-saved**. Every member of the union is handled now.
 *
 * `finalValue` is consulted only for the legacy `custom` shape, where NR and NA
 * used to be smuggled through `custom` with a sentinel string instead of getting
 * their own source. Rows stored that way still round-trip.
 */
export function decisionFromResolutionSource(
  source: string | null | undefined,
  finalValue: any,
): { decision: Decision; customValue?: any } | null {
  switch (source) {
    case 'agreed':
      return { decision: 'agreed' };
    case 'ai':
      return { decision: 'accept_ai' };
    case 'reviewer_1':
      return { decision: 'accept_r1' };
    case 'reviewer_2':
      return { decision: 'accept_r2' };
    case 'majority':
    case 'suggestion':
      return { decision: 'accept_majority' };
    // Absence restores into the value editor, not into a decision of its own.
    // The dedicated NR/NA buttons are gone — absence is expressed by entering it
    // as the answer — so `decision: 'nr'` would leave the reviewer looking at a
    // "Not reported" pill with no visible control. Combined with the derivation
    // in `resolveField`, this is a fixpoint: not_reported → custom/"NR" →
    // not_reported, with the stored value untouched.
    case 'not_reported':
      return { decision: 'custom', customValue: NR_LABEL };
    case 'not_applicable':
      return { decision: 'custom', customValue: NA_LABEL };
    case 'custom':
      // Including legacy rows that smuggled absence through `custom` with an
      // "NR"/"NA" value: they restore as exactly the text that was stored, and
      // `resolveField` re-derives the source on the way back out. Nothing is
      // rewritten, which is what stops a stored "N/A" from silently becoming
      // "NR" on a no-op reopen-and-resave.
      return { decision: 'custom', customValue: finalValue ?? '' };
    default:
      return null;
  }
}

/**
 * Which source keys a decision counts as "picked", so a source box can render
 * selected. `accept_majority` highlights every source that agrees with the
 * majority value, since that is what the reviewer endorsed.
 */
export function pickedSourceKeys(f: ResolvableField, matches: (a: any, b: any) => boolean): SourceKey[] {
  const d = f.decision;
  if (d === 'accept_ai') return ['ai'];
  if (d === 'accept_r1') return ['r1'];
  if (d === 'accept_r2') return ['r2'];
  if ((d === 'accept_majority' || d === 'accept_suggestion') && f.suggestion) {
    return (['ai', 'r1', 'r2'] as SourceKey[]).filter(
      k => f.sources[k] !== undefined && matches(f.sources[k], f.suggestion!.value),
    );
  }
  if (d === 'correct') {
    const present = firstPresent(f.sources);
    return present ? [present.key] : [];
  }
  return [];
}

/** Short human label for a settled field's status pill. */
export function resolutionLabel(source: ResolutionSource): string {
  switch (source) {
    case 'agreed': return 'Agreed';
    case 'ai': return 'AI';
    case 'reviewer_1': return 'R1';
    case 'reviewer_2': return 'R2';
    case 'majority':
    case 'suggestion': return 'Majority';
    case 'not_reported': return 'Not reported';
    case 'not_applicable': return 'Not applicable';
    case 'custom': return 'Custom';
  }
}

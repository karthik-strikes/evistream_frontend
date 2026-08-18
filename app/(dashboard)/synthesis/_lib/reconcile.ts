/**
 * Reconcile inconsistent declared values before anything is pooled.
 *
 * Two jobs, both of which exist because extracted columns carry whatever the
 * papers said rather than a controlled vocabulary:
 *
 *  1. **Harmonizing timepoints.** `followup_timepoint` is free text on real
 *     forms, so "6 hours", "6 hrs" and "360 minutes" are three different values
 *     and rows that belong in one meta-analysis silently fail to pool.
 *  2. **Agreeing effect direction.** Pooling a "higher is better" scale with a
 *     "higher is worse" one cancels real effects against each other.
 *
 * The governing rule for both: **a suggestion here changes nothing until it is
 * confirmed.** Merging two timepoints that are genuinely different produces a
 * plot with more studies in it that looks entirely correct — the same class of
 * silent corruption as coercing NR to 0. So suggestions are computed
 * conservatively, applied only once ticked, and a merge is never proposed on
 * string similarity: "6 hours" and "8 hours" differ by one character.
 */

// ── Shared ───────────────────────────────────────────────────────────────────

export const KEEP = '__keep';
export const EXCLUDE = '__exclude';

/** A raw value to merge into, or KEEP / EXCLUDE. */
export type HarmonizeChoice = string;
export type Harmonization = Record<string, HarmonizeChoice>;

export type DirectionChoice = 'use' | 'reverse';
export type Directions = Record<string, DirectionChoice>;

/** Which rows the reviewer has ticked. Untidied suggestions stay inert. */
export type Confirmations = Record<string, boolean>;

export interface ValueTally {
  raw: string;
  rows: number;
  documents: number;
}

/** Distinct non-empty values of one column, with row and document counts. */
export function tallyValues(
  rows: Array<Record<string, any>>,
  column: string | null | undefined,
): ValueTally[] {
  if (!column) return [];
  const counts = new Map<string, { rows: number; docs: Set<string> }>();
  for (const row of rows) {
    const raw = String(row[column] ?? '').trim();
    if (!raw) continue;
    if (!counts.has(raw)) counts.set(raw, { rows: 0, docs: new Set() });
    const entry = counts.get(raw)!;
    entry.rows += 1;
    entry.docs.add(String(row._documentId ?? ''));
  }
  return [...counts.entries()]
    .map(([raw, v]) => ({ raw, rows: v.rows, documents: v.docs.size }))
    .sort((a, b) => b.rows - a.rows || a.raw.localeCompare(b.raw));
}

// ── Timepoint harmonization ──────────────────────────────────────────────────

const UNIT_MINUTES: Record<string, number> = {
  m: 1, min: 1, mins: 1, minute: 1, minutes: 1,
  h: 60, hr: 60, hrs: 60, hour: 60, hours: 60,
  d: 1440, day: 1440, days: 1440,
  wk: 10080, week: 10080, weeks: 10080,
};

/**
 * Minutes, when the whole value is unambiguously one quantity and one unit.
 *
 * Deliberately strict. "6 hours", "6 hrs", "6h" and "360 minutes" all resolve;
 * "up to 24 hours", "6–8 hours", "day 1" and a bare "6" all return null, because
 * each of those means something a merge would destroy. Returning null costs the
 * reviewer a manual choice; guessing costs them a wrong meta-analysis.
 */
export function normalizeDuration(text: string): number | null {
  const cleaned = String(text ?? '').trim().toLowerCase().replace(/\.$/, '');
  const match = /^(\d+(?:[.,]\d+)?)\s*([a-z]+)$/.exec(cleaned);
  if (!match) return null;
  const amount = Number(match[1].replace(',', '.'));
  const factor = UNIT_MINUTES[match[2]];
  if (!Number.isFinite(amount) || factor === undefined) return null;
  return amount * factor;
}

/** Human wording for why a merge is proposed. */
function mergeReason(canonical: string, minutes: number): string {
  const asHours = minutes / 60;
  const pretty = Number.isInteger(asHours) ? `${asHours} h` : `${minutes} min`;
  return `same duration as "${canonical}" (${pretty})`;
}

export interface HarmonizeSuggestion {
  choices: Harmonization;
  /** Only the rows where a merge is proposed — these are the ones needing a ✓. */
  reasons: Record<string, string>;
}

/**
 * Propose merges purely on unit-normalized equality.
 *
 * Values that normalize to the same number of minutes form a group; the variant
 * with the most rows becomes the canonical spelling and the rest are proposed to
 * merge into it. Anything that does not normalize, or that normalizes uniquely,
 * is left alone with no suggestion at all — it needs no confirmation because
 * nothing was inferred about it.
 */
export function suggestHarmonization(values: ValueTally[]): HarmonizeSuggestion {
  const byMinutes = new Map<number, ValueTally[]>();
  for (const v of values) {
    const minutes = normalizeDuration(v.raw);
    if (minutes === null) continue;
    if (!byMinutes.has(minutes)) byMinutes.set(minutes, []);
    byMinutes.get(minutes)!.push(v);
  }

  const choices: Harmonization = {};
  const reasons: Record<string, string> = {};
  for (const v of values) choices[v.raw] = KEEP;

  for (const [minutes, group] of byMinutes) {
    if (group.length < 2) continue;
    // Most rows wins; ties broken by the longer spelling, which is usually the
    // fully written one ("6 hours" over "6 hrs").
    const canonical = [...group].sort(
      (a, b) => b.rows - a.rows || b.raw.length - a.raw.length,
    )[0];
    for (const v of group) {
      if (v.raw === canonical.raw) continue;
      choices[v.raw] = canonical.raw;
      reasons[v.raw] = mergeReason(canonical.raw, minutes);
    }
  }

  return { choices, reasons };
}

/**
 * The value a row should be grouped under, or null when it is excluded.
 *
 * An unconfirmed choice is ignored entirely: the raw value passes through
 * unchanged, so the analysis behaves exactly as it did before the suggestion
 * appeared. That is what makes an amber row genuinely inert.
 */
export function canonicalValue(
  raw: string,
  choices: Harmonization,
  confirmed: Confirmations,
): string | null {
  const choice = choices[raw];
  if (!choice || choice === KEEP) return raw;
  if (!confirmed[raw]) return raw;
  if (choice === EXCLUDE) return null;
  return choice;
}

/** True when at least one merge or exclusion is actually in force. */
export function harmonizationIsActive(
  choices: Harmonization,
  confirmed: Confirmations,
): boolean {
  return Object.entries(choices).some(
    ([raw, choice]) => choice !== KEEP && confirmed[raw],
  );
}

// ── Effect direction ─────────────────────────────────────────────────────────

const HIGHER_IS_WORSE =
  /pain|ache|severity|symptom|disabilit|depress|anxiet|discomfort|swell|trismus|edema|oedema|analgesic consumption|rescue|adverse/i;
const HIGHER_IS_BETTER =
  /relief|improve|satisfact|function|quality|\bqol\b|success|efficacy|comfort|global impression/i;

export type ScaleDirection = 'worse' | 'better' | 'unknown';

export interface ScaleTally {
  scale: string;
  studies: number;
  direction: ScaleDirection;
  note: string;
}

const DIRECTION_NOTE: Record<ScaleDirection, string> = {
  worse: 'higher = worse',
  better: 'higher = better',
  unknown: 'direction unclear',
};

/** Read a scale's polarity from its name. A guess, and labelled as one. */
export function classifyScaleDirection(scale: string): ScaleDirection {
  const name = String(scale ?? '');
  const worse = HIGHER_IS_WORSE.test(name);
  const better = HIGHER_IS_BETTER.test(name);
  // Both or neither is genuinely ambiguous — "pain relief" contains each — so
  // say so rather than letting regex ordering decide.
  if (worse === better) return 'unknown';
  return worse ? 'worse' : 'better';
}

export function tallyScales(values: ValueTally[]): ScaleTally[] {
  return values.map(v => {
    const direction = classifyScaleDirection(v.raw);
    return { scale: v.raw, studies: v.documents, direction, note: DIRECTION_NOTE[direction] };
  });
}

export interface DirectionSuggestion {
  choices: Directions;
  /** Only scales proposed for reversal — the rows that need a ✓. */
  reasons: Record<string, string>;
  /** The polarity everything is being aligned to, when one could be determined. */
  reference: ScaleDirection;
}

/**
 * Align every scale to whichever polarity most studies already use.
 *
 * Weighted by study count, not by number of distinct scales, so one obscure
 * reversed instrument cannot flip the whole analysis. Scales whose direction
 * could not be read are left as-is with no suggestion — an unknown polarity is
 * a question for the reviewer, not something to resolve by coin toss.
 */
export function suggestDirections(scales: ScaleTally[]): DirectionSuggestion {
  const weight = { worse: 0, better: 0 };
  for (const s of scales) {
    if (s.direction === 'worse') weight.worse += s.studies;
    else if (s.direction === 'better') weight.better += s.studies;
  }

  const choices: Directions = {};
  const reasons: Record<string, string> = {};
  for (const s of scales) choices[s.scale] = 'use';

  if (weight.worse === 0 || weight.better === 0) {
    // Nothing to reconcile: every readable scale already points the same way.
    return { choices, reasons, reference: weight.worse > 0 ? 'worse' : weight.better > 0 ? 'better' : 'unknown' };
  }

  const reference: ScaleDirection = weight.worse >= weight.better ? 'worse' : 'better';
  for (const s of scales) {
    if (s.direction === 'unknown' || s.direction === reference) continue;
    choices[s.scale] = 'reverse';
    reasons[s.scale] =
      `${s.note}, but most studies here use "${DIRECTION_NOTE[reference]}" scales`;
  }
  return { choices, reasons, reference };
}

/** Whether this study's effect should be negated. Unconfirmed ⇒ never. */
export function shouldFlipSign(
  scale: string,
  choices: Directions,
  confirmed: Confirmations,
): boolean {
  return choices[scale] === 'reverse' && !!confirmed[scale];
}

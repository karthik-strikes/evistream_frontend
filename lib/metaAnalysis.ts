/**
 * Meta-analysis math for the Synthesis screen.
 *
 * Pure functions — no React, no knowledge of extraction-result shapes, and no
 * imports at all. Callers hand in study arms that have already been mapped out
 * of the extracted data and get back per-study effects, the pooled estimate and
 * the heterogeneity statistics.
 *
 * Three contracts the UI depends on:
 *
 *  1. `y`/`v` are ALWAYS on the analysis scale (log for ratio measures) while
 *     `est`/`lo`/`hi` are ALWAYS on the display scale. Never mix them.
 *  2. Weights are the weights actually used for pooling — random-effects
 *     weights when the random-effects model is selected — so they always sum
 *     to 100%.
 *  3. No study is ever silently dropped. Anything that cannot yield an estimate
 *     comes back in `notEstimable` with a reason, and the caller prints it in
 *     the inclusion ledger. A study must never vanish between "matched the
 *     comparison" and "appeared in the plot".
 */

import { chiSquareUpperP, normalTwoSidedP, studentTCritical } from './distributions';
import {
  correlationEffectAndSE, correlationInverse, fitProportionGlmm, proportionEffectAndSE,
  proportionInverse, wilsonCI, type ProportionMethod,
} from './singleGroupMeta';

/**
 * HR, RATIO and DIFF exist only for studies that arrive as an already-computed
 * effect (an adjusted odds ratio, a hazard ratio, a rate ratio) — nothing in
 * this file can derive them from arm data, and `effectOf` refuses if asked to.
 * RATIO/DIFF are the generic escapes for a measure this app has no name for;
 * they carry no arithmetic of their own beyond which scale they live on.
 */
export type EffectMeasure =
  | 'RR' | 'OR' | 'RD' | 'MD' | 'SMD' | 'HR' | 'RATIO' | 'DIFF'
  /** A single group's proportion — a prevalence or event rate, with no comparator. */
  | 'PROP'
  /** A correlation, pooled on Fisher's z. */
  | 'R';
/**
 * `mh` and `peto` are fixed-effect methods for BINARY arm data only, and they
 * exist for the case inverse-variance pooling handles badly: rare events. Both
 * work from the raw counts, so neither needs the 0.5 continuity correction that
 * IV pooling requires just to compute a log ratio at all — and a correction
 * applied to a handful of events is exactly where IV estimates go wrong.
 *
 * Peto is OR-only by construction (it is a one-step score estimator around the
 * null); MH covers OR and RR. `poolingMethodRefusal` names the combination when
 * a caller asks for one that cannot be computed, instead of quietly pooling
 * something else.
 */
export type PoolingModel = 'random' | 'fixed' | 'mh' | 'peto';

export const EFFECT_LABEL: Record<EffectMeasure, string> = {
  RR: 'Risk Ratio',
  OR: 'Odds Ratio',
  RD: 'Risk Difference',
  MD: 'Mean Difference',
  SMD: 'Std. Mean Difference',
  HR: 'Hazard Ratio',
  RATIO: 'Ratio (as reported)',
  DIFF: 'Difference (as reported)',
  PROP: 'Proportion',
  R: 'Correlation',
};

export const MODEL_LABEL: Record<PoolingModel, string> = {
  random: 'Random effects (DerSimonian–Laird)',
  fixed: 'Fixed effect (inverse variance)',
  mh: 'Fixed effect (Mantel–Haenszel)',
  peto: "Fixed effect (Peto's odds ratio)",
};

export const MODEL_SHORT: Record<PoolingModel, string> = {
  random: 'Random effects',
  fixed: 'Fixed effect (IV)',
  mh: 'Fixed effect (M–H)',
  peto: 'Fixed effect (Peto)',
};

/** Which pooling methods can be computed for a given measure and data shape. */
export function poolingMethodsFor(measure: EffectMeasure, hasArms: boolean): PoolingModel[] {
  const base: PoolingModel[] = ['random', 'fixed'];
  if (!hasArms || !isBinaryMeasure(measure)) return base;
  if (measure === 'RD') return base;
  return measure === 'OR' ? [...base, 'mh', 'peto'] : [...base, 'mh'];
}

export const DICHOTOMOUS_MEASURES: EffectMeasure[] = ['RR', 'OR', 'RD'];
export const CONTINUOUS_MEASURES: EffectMeasure[] = ['MD', 'SMD'];

/**
 * Measures a pre-computed effect can be pooled as. Ordered ratios-then-
 * differences, because that is the order a reviewer scans for their measure.
 */
export const PRECOMPUTED_MEASURES: EffectMeasure[] = [
  'OR', 'RR', 'HR', 'RATIO', 'MD', 'SMD', 'RD', 'DIFF',
];

/** The only measure a proportion corpus can be pooled as, and likewise a correlation. */
export const PROPORTION_MEASURES: EffectMeasure[] = ['PROP'];
export const CORRELATION_MEASURES: EffectMeasure[] = ['R'];

/** Measures this file can compute from arm data. */
const ARM_MEASURES = new Set<EffectMeasure>([...DICHOTOMOUS_MEASURES, ...CONTINUOUS_MEASURES]);

/** Ratio measures are pooled on the log scale and plotted on a log axis. */
export function isRatioMeasure(m: EffectMeasure): boolean {
  return m === 'RR' || m === 'OR' || m === 'HR' || m === 'RATIO';
}

/**
 * Measures describing ONE group rather than a contrast between two.
 *
 * The distinction runs through the whole screen: a prevalence has no comparator
 * column, no "favours" direction, and — for a proportion — no null value at all,
 * so a plot that drew a reference line at 0 or 1 would be inventing a hypothesis
 * the analysis never made.
 */
export function isSingleGroupMeasure(m: EffectMeasure): boolean {
  return m === 'PROP' || m === 'R';
}

/**
 * Whether "no effect" is a meaningful position on this measure's axis.
 *
 * A correlation has one (zero). A prevalence does not: 0% is not a null
 * hypothesis, it is the end of the scale.
 */
export function hasNullValue(m: EffectMeasure): boolean {
  return m !== 'PROP';
}

/** Measures computed from event counts rather than means. */
export function isBinaryMeasure(m: EffectMeasure): boolean {
  return m === 'RR' || m === 'OR' || m === 'RD';
}

/**
 * The value at which the effect is null — 1 for ratios, 0 for differences and for
 * a correlation. NaN for a proportion, which has no null; callers must check
 * `hasNullValue` rather than plotting this.
 */
export function nullValue(m: EffectMeasure): number {
  if (!hasNullValue(m)) return NaN;
  return isRatioMeasure(m) ? 1 : 0;
}

// ── Inputs ───────────────────────────────────────────────────────────────────

export interface BinaryArm {
  events: number;
  total: number;
}

export interface ContinuousArm {
  mean: number;
  sd: number;
  n: number;
}

export type Arm = BinaryArm | ContinuousArm;

export function isBinaryArm(a: Arm): a is BinaryArm {
  return (a as BinaryArm).events !== undefined;
}

/**
 * A study that reported only its effect, not the arms behind it — an adjusted
 * OR out of a regression, a hazard ratio, a difference with a published CI.
 *
 * `y` and `se` are on the ANALYSIS scale (log for a ratio measure), already
 * converted by whoever read the columns; this file does no transforming of its
 * own, because the scale a paper printed in is a fact about the source and
 * belongs with the code that read it. `reported` keeps the source's own numbers
 * so the plot and the evidence drawer can show what the paper actually said.
 */
export interface PrecomputedEffect {
  y: number;
  se: number;
  reported: {
    est: number;
    lo: number | null;
    hi: number | null;
    se: number | null;
    /** The scale the source printed on, not the scale `y` is on. */
    scale: 'natural' | 'log';
    /** Which column the SE came from. `se-delta` used SE/estimate. */
    derivedFrom: 'ci' | 'se' | 'se-delta';
  };
}

interface MetaStudyCommon {
  /** Stable identity for React keys and hover state. */
  key: string;
  label: string;
  documentId: string;
  /**
   * This study's scale runs the opposite way to the rest of the analysis, so its
   * effect is negated before pooling. Set only after a reviewer confirms the
   * direction — pooling a "higher is better" scale with a "higher is worse" one
   * silently cancels real effects against each other.
   */
  flipSign?: boolean;
  /** Free-form passthrough the evidence drawer reads; never used in the math. */
  evidence?: Record<string, unknown>;
}

/** A study whose arms were extracted, so any arm-based measure can be derived. */
export interface ArmStudy extends MetaStudyCommon {
  treatment: Arm;
  comparator: Arm;
  precomputed?: undefined;
  proportion?: undefined;
  correlation?: undefined;
}

/** A study that arrived as an effect estimate with its own precision. */
export interface EffectStudy extends MetaStudyCommon {
  precomputed: PrecomputedEffect;
  treatment?: undefined;
  comparator?: undefined;
  proportion?: undefined;
  correlation?: undefined;
}

/** One group's count of events out of a total — a prevalence or event rate. */
export interface ProportionStudy extends MetaStudyCommon {
  proportion: { events: number; total: number };
  treatment?: undefined;
  comparator?: undefined;
  precomputed?: undefined;
  correlation?: undefined;
}

/** One study's correlation and the sample it came from. */
export interface CorrelationStudy extends MetaStudyCommon {
  correlation: { r: number; n: number };
  treatment?: undefined;
  comparator?: undefined;
  precomputed?: undefined;
  proportion?: undefined;
}

export type MetaStudy = ArmStudy | EffectStudy | ProportionStudy | CorrelationStudy;

export function isPrecomputedStudy(s: {
  precomputed?: PrecomputedEffect;
}): s is { precomputed: PrecomputedEffect } {
  return !!s.precomputed;
}

export type NotEstimableReason =
  | 'zero_events_both_arms'
  | 'zero_variance'
  | 'non_positive_total'
  | 'invalid_numbers'
  | 'wrong_arm_type'
  | 'proportion_out_of_range'
  | 'correlation_out_of_range'
  | 'sample_too_small';

export const NOT_ESTIMABLE_TEXT: Record<NotEstimableReason, string> = {
  zero_events_both_arms: 'zero events in both arms — no effect estimable',
  zero_variance: 'variance is zero or undefined — no confidence interval estimable',
  non_positive_total: 'an arm total is zero or negative — no effect estimable',
  invalid_numbers: 'the mapped values are not usable numbers',
  wrong_arm_type: 'this effect measure needs a different kind of data than the columns provide',
  proportion_out_of_range:
    'the events and total do not describe a proportion — events must be between zero and the total',
  correlation_out_of_range:
    'the correlation is not strictly between -1 and 1, so Fisher’s z is infinite and it cannot be pooled',
  sample_too_small:
    'fewer than four observations — a correlation’s variance is 1/(n−3), so four is the minimum that '
    + 'can enter a pool',
};

// ── Outputs ──────────────────────────────────────────────────────────────────

export interface StudyEffect {
  key: string;
  label: string;
  documentId: string;
  /** Present for arm-based studies; absent when the effect was pre-computed. */
  treatment?: Arm;
  comparator?: Arm;
  /** Present instead of arms when the study reported only its effect. */
  precomputed?: PrecomputedEffect;
  /** Present for a single-group proportion — the counts behind it. */
  proportion?: { events: number; total: number };
  /** Present for a correlation — r and the sample it came from. */
  correlation?: { r: number; n: number };
  evidence?: Record<string, unknown>;
  /** Effect on the analysis scale (log for ratio measures). */
  y: number;
  /** Variance of `y`. */
  v: number;
  /** Display-scale point estimate and 95% CI. */
  est: number;
  lo: number;
  hi: number;
  /** Pooling weight as a percentage of the total. */
  weightPct: number;
  /** 0.5 was added to every cell because this study had a zero cell. */
  corrected: boolean;
}

export interface NotEstimableStudy {
  study: MetaStudy;
  reason: NotEstimableReason;
}

export type HeterogeneityLabel = 'Low' | 'Moderate' | 'Substantial' | 'Considerable';

export interface MetaResult {
  measure: EffectMeasure;
  model: PoolingModel;
  studies: StudyEffect[];
  notEstimable: NotEstimableStudy[];
  /** Null when fewer than MIN_POOLABLE studies contribute. */
  pooled: { est: number; lo: number; hi: number; mu: number; se: number } | null;
  /**
   * 95% prediction interval — random-effects only, and only with 3+ studies.
   * `df` (= k − 2) and `t` are carried so the plot can say what the width rests
   * on: at small k the multiplier, not the data, is most of the interval.
   */
  prediction: { lo: number; hi: number; df: number; t: number } | null;
  /**
   * Hartung–Knapp–Sidik–Jonkman interval for the same pooled estimate.
   *
   * Random-effects only, and never a replacement for `pooled`: it is the same
   * point estimate with an interval that stops pretending tau-squared was known
   * rather than estimated from k studies. Shown beside the standard interval so
   * a reviewer can see how much of the standard interval's confidence came from
   * that assumption.
   */
  hksj: {
    est: number;
    lo: number;
    hi: number;
    /** HKSJ standard error, sqrt(q / sum of weights). */
    se: number;
    /** The variance-inflation factor q. Below 1 the interval can come out narrower. */
    q: number;
    t: number;
    df: number;
    /** True when this interval is narrower than the standard one (q well below 1). */
    narrower: boolean;
  } | null;
  heterogeneity: {
    q: number;
    df: number;
    p: number;
    i2: number;
    tau2: number;
    label: HeterogeneityLabel;
  } | null;
  overallEffect: { z: number; p: number } | null;
  /** Column totals for the "Total (95% CI)" row. */
  totals: { treatment: string; comparator: string };
  correctedCount: number;
  /**
   * Set when the requested pooling method cannot be computed for this measure or
   * this data shape. `pooled` is null in that case: the alternative would be
   * pooling by some other method under the selected method's name.
   */
  poolingMethodRefusal: string | null;
  /**
   * Set when the corpus is sparse enough that inverse-variance pooling with a
   * continuity correction is the wrong tool — the correction is then doing much
   * of the work. Advice only; the reviewer chooses the method.
   */
  sparseDataWarning: string | null;
  /**
   * Present when a proportion corpus was pooled by the one-stage GLMM. A
   * one-stage fit has no Cochran's Q and no I² — `tau2` is its own direct
   * estimate of between-study variance, on the logit scale — so `heterogeneity`
   * is null and this stands in its place.
   */
  glmm: {
    tau2: number;
    /** True when the SE fell back from the likelihood curvature to a conservative approximation. */
    seFallback: boolean;
  } | null;
  /** Which proportion transform produced this result. Null unless the measure is PROP. */
  proportionMethod: ProportionMethod | null;
  /**
   * The pooled effect translated into absolute terms, for a ratio measure over
   * binary arms. Null whenever that translation is not defined.
   */
  absolute: AbsoluteEffect | null;
}

/**
 * A relative effect said in absolute terms — the row a GRADE summary-of-findings
 * table leads with, and the one a relative effect alone cannot answer.
 *
 * `comparatorRisk` is the assumed risk without treatment. It defaults to this
 * corpus's own pooled comparator event rate, because that is the one figure the
 * data itself supports; a reviewer applying the result to a different population
 * overrides it.
 */
export interface AbsoluteEffect {
  comparatorRisk: number;
  /** Whether the risk came from the corpus or was supplied. */
  riskSource: 'corpus' | 'supplied';
  treatmentRisk: number;
  /** Risk difference, treatment minus comparator, and its interval. */
  riskDifference: number;
  rdLo: number;
  rdHi: number;
  /** Per 1000 patients, rounded the way a SoF table prints it. */
  per1000: number;
  per1000Lo: number;
  per1000Hi: number;
  /**
   * Number needed to treat for one additional beneficial (NNTB) or harmful
   * (NNTH) outcome. Null when the risk-difference interval spans zero: the
   * reciprocal passes through infinity partway across, so no single interval is
   * meaningful (Altman 1998).
   */
  nnt: number | null;
  nntKind: 'benefit' | 'harm';
  nntLo: number | null;
  nntHi: number | null;
}

/**
 * Pooling fewer than three studies is not meaningful, so the plot shows the
 * individual studies and suppresses the diamond rather than printing a pooled
 * number nobody should quote.
 */
export const MIN_POOLABLE = 3;

// ── Effect calculation ───────────────────────────────────────────────────────

const CONTINUITY = 0.5;

interface RawEffect {
  y: number;
  v: number;
  corrected: boolean;
}

function binaryEffect(
  t: BinaryArm,
  c: BinaryArm,
  measure: EffectMeasure,
): RawEffect | NotEstimableReason {
  if (![t.events, t.total, c.events, c.total].every(Number.isFinite)) return 'invalid_numbers';
  if (t.total <= 0 || c.total <= 0) return 'non_positive_total';
  if (t.events < 0 || c.events < 0 || t.events > t.total || c.events > c.total) {
    return 'invalid_numbers';
  }

  if (measure === 'RD') {
    const p1 = t.events / t.total;
    const p2 = c.events / c.total;
    const v = (p1 * (1 - p1)) / t.total + (p2 * (1 - p2)) / c.total;
    if (!(v > 0)) return 'zero_variance';
    return { y: p1 - p2, v, corrected: false };
  }

  // Ratio measures. A trial with no events in either arm carries no information
  // about a ratio, so it is excluded rather than corrected into existence.
  if (t.events === 0 && c.events === 0) return 'zero_events_both_arms';

  const hasZeroCell =
    t.events === 0 || c.events === 0 || t.total - t.events === 0 || c.total - c.events === 0;
  const k = hasZeroCell ? CONTINUITY : 0;
  const e1 = t.events + k;
  const n1 = t.total + 2 * k;
  const e2 = c.events + k;
  const n2 = c.total + 2 * k;

  if (measure === 'RR') {
    const y = Math.log(e1 / n1 / (e2 / n2));
    const v = 1 / e1 - 1 / n1 + 1 / e2 - 1 / n2;
    if (!Number.isFinite(y) || !(v > 0)) return 'zero_variance';
    return { y, v, corrected: hasZeroCell };
  }

  // OR
  const y = Math.log((e1 / (n1 - e1)) / (e2 / (n2 - e2)));
  const v = 1 / e1 + 1 / (n1 - e1) + 1 / e2 + 1 / (n2 - e2);
  if (!Number.isFinite(y) || !(v > 0)) return 'zero_variance';
  return { y, v, corrected: hasZeroCell };
}

function continuousEffect(
  t: ContinuousArm,
  c: ContinuousArm,
  measure: EffectMeasure,
): RawEffect | NotEstimableReason {
  if (![t.mean, t.sd, t.n, c.mean, c.sd, c.n].every(Number.isFinite)) return 'invalid_numbers';
  if (t.n <= 0 || c.n <= 0) return 'non_positive_total';
  if (t.sd < 0 || c.sd < 0) return 'invalid_numbers';

  if (measure === 'MD') {
    const v = (t.sd * t.sd) / t.n + (c.sd * c.sd) / c.n;
    if (!(v > 0)) return 'zero_variance';
    return { y: t.mean - c.mean, v, corrected: false };
  }

  // SMD — Hedges' g, i.e. Cohen's d with the small-sample correction applied.
  const dfPooled = t.n + c.n - 2;
  if (dfPooled <= 0) return 'non_positive_total';
  const sp = Math.sqrt(((t.n - 1) * t.sd * t.sd + (c.n - 1) * c.sd * c.sd) / dfPooled);
  if (!(sp > 0)) return 'zero_variance';
  const d = (t.mean - c.mean) / sp;
  const j = 1 - 3 / (4 * dfPooled - 1);
  const g = j * d;
  const v = (t.n + c.n) / (t.n * c.n) + (g * g) / (2 * (t.n + c.n));
  if (!(v > 0)) return 'zero_variance';
  return { y: g, v, corrected: false };
}

function precomputedEffect(
  p: PrecomputedEffect,
): RawEffect | NotEstimableReason {
  if (!Number.isFinite(p.y) || !Number.isFinite(p.se)) return 'invalid_numbers';
  if (!(p.se > 0)) return 'zero_variance';
  return { y: p.y, v: p.se * p.se, corrected: false };
}

function effectOf(
  study: MetaStudy,
  measure: EffectMeasure,
  proportionMethod: ProportionMethod,
): RawEffect | NotEstimableReason {
  if (isPrecomputedStudy(study)) {
    const effect = precomputedEffect(study.precomputed);
    if (typeof effect === 'string' || !study.flipSign) return effect;
    return { ...effect, y: -effect.y };
  }

  // A proportion. Under the GLMM there is no per-study (effect, SE) to pool —
  // the model works from the counts — but a per-study transform is still needed
  // to place the row on the plot, and the logit is the GLMM's own scale.
  if (measure === 'PROP') {
    if (!study.proportion) return 'wrong_arm_type';
    const { events, total } = study.proportion;
    const t = proportionEffectAndSE(
      events, total, proportionMethod === 'glmm' ? 'logit' : proportionMethod,
    );
    if (!t) return total > 0 ? 'proportion_out_of_range' : 'non_positive_total';
    if (!(t.se > 0)) return 'zero_variance';
    return { y: t.y, v: t.se * t.se, corrected: t.corrected };
  }

  if (measure === 'R') {
    if (!study.correlation) return 'wrong_arm_type';
    const { r, n } = study.correlation;
    if (!Number.isFinite(r) || !Number.isFinite(n)) return 'invalid_numbers';
    if (Math.abs(r) >= 1) return 'correlation_out_of_range';
    if (n < 4) return 'sample_too_small';
    const t = correlationEffectAndSE(r, n);
    if (!t || !(t.se > 0)) return 'zero_variance';
    const eff = { y: t.y, v: t.se * t.se, corrected: false };
    return study.flipSign ? { ...eff, y: -eff.y } : eff;
  }

  if (!study.treatment || !study.comparator) return 'wrong_arm_type';
  // Only the measures derivable from arms. Asking for a hazard ratio out of
  // event counts is a mapping mistake, and inventing one from the 2x2 would be
  // worse than refusing.
  if (!ARM_MEASURES.has(measure)) return 'wrong_arm_type';
  const armsAreBinary = isBinaryArm(study.treatment) && isBinaryArm(study.comparator);
  if (armsAreBinary !== isBinaryMeasure(measure)) return 'wrong_arm_type';
  const effect = armsAreBinary
    ? binaryEffect(study.treatment as BinaryArm, study.comparator as BinaryArm, measure)
    : continuousEffect(study.treatment as ContinuousArm, study.comparator as ContinuousArm, measure);
  if (typeof effect === 'string' || !study.flipSign) return effect;
  // A reversed scale measures the same thing in the opposite direction, so only
  // the sign turns over. The variance is untouched — Var(−y) = Var(y) — which is
  // why the interval mirrors and the study's weight does not move.
  return { ...effect, y: -effect.y };
}

// ── Distributions ────────────────────────────────────────────────────────────

/**
 * Re-exported so every existing caller keeps its import, but the closed-form
 * approximations that used to live here (Abramowitz & Stegun erf, and
 * Wilson–Hilferty for chi-square) are gone: they were accurate mid-distribution
 * and wrong at the 0.05 boundary readers quote. `lib/distributions.ts` computes
 * both from jStat's own CDFs, and owns the t distribution this file needs for
 * the prediction interval.
 */
export { chiSquareUpperP, normalTwoSidedP } from './distributions';

function heterogeneityLabel(i2: number): HeterogeneityLabel {
  if (i2 < 25) return 'Low';
  if (i2 < 50) return 'Moderate';
  if (i2 < 75) return 'Substantial';
  return 'Considerable';
}

// ── Pooling ──────────────────────────────────────────────────────────────────

function armTotals(studies: StudyEffect[]): { treatment: string; comparator: string } {
  if (studies.length === 0) return { treatment: '—', comparator: '—' };

  // A single-group corpus has one column of data, not two: events out of a total
  // for a proportion, and a sample size for a correlation.
  if (studies.every(s => s.proportion)) {
    const events = studies.reduce((a, s) => a + s.proportion!.events, 0);
    const total = studies.reduce((a, s) => a + s.proportion!.total, 0);
    return { treatment: `${events}/${total}`, comparator: '—' };
  }
  if (studies.every(s => s.correlation)) {
    const n = studies.reduce((a, s) => a + s.correlation!.n, 0);
    return { treatment: String(n), comparator: '—' };
  }

  // A pre-computed effect has no arms to total, and a column of totals that
  // silently covered only some of the plotted studies would be a lie about the
  // corpus — so the totals row goes blank as soon as one study lacks arms.
  if (studies.some(s => !s.treatment || !s.comparator)) return { treatment: '—', comparator: '—' };
  if (isBinaryArm(studies[0].treatment!)) {
    const sum = (pick: (s: StudyEffect) => BinaryArm) => {
      const e = studies.reduce((a, s) => a + pick(s).events, 0);
      const n = studies.reduce((a, s) => a + pick(s).total, 0);
      return `${e}/${n}`;
    };
    return {
      treatment: sum(s => s.treatment as BinaryArm),
      comparator: sum(s => s.comparator as BinaryArm),
    };
  }
  const total = (pick: (s: StudyEffect) => ContinuousArm) =>
    String(studies.reduce((a, s) => a + pick(s).n, 0));
  return {
    treatment: total(s => s.treatment as ContinuousArm),
    comparator: total(s => s.comparator as ContinuousArm),
  };
}

interface CountStudy {
  a: number; b: number; c: number; d: number; n: number;
}

/** The raw 2x2 of a study, or null if it has no binary arms. */
function countsOf(study: MetaStudy): CountStudy | null {
  if (isPrecomputedStudy(study)) return null;
  const t = study.treatment;
  const c = study.comparator;
  if (!t || !c || !isBinaryArm(t) || !isBinaryArm(c)) return null;
  const counts = {
    a: t.events, b: t.total - t.events,
    c: c.events, d: c.total - c.events,
    n: t.total + c.total,
  };
  if (!Object.values(counts).every(Number.isFinite) || counts.n <= 0) return null;
  return counts;
}

/**
 * Mantel–Haenszel pooling, from the raw counts.
 *
 * OR_MH = sum(a·d/n) / sum(b·c/n), with the Robins–Breslow–Greenland (1986)
 * variance of ln(OR_MH) — the same variance R's `mantelhaen.test` reports.
 * RR_MH = sum(a(c+d)/n) / sum(c(a+b)/n), with the Greenland–Robins (1985)
 * variance. Neither needs a continuity correction, which is the whole reason to
 * reach for this over inverse variance when events are rare.
 *
 * Weights are the method's own: b·c/n for the odds ratio, c(a+b)/n for the risk
 * ratio. A study contributing nothing to the numerator and denominator — a
 * double-zero table — therefore gets zero weight rather than a corrected one.
 */
function mantelHaenszel(
  studies: CountStudy[],
  measure: 'OR' | 'RR',
): { y: number; se: number; weights: number[] } | null {
  if (studies.length === 0) return null;

  if (measure === 'OR') {
    const R = studies.map(s => (s.a * s.d) / s.n);
    const S = studies.map(s => (s.b * s.c) / s.n);
    const sumR = R.reduce((x, v) => x + v, 0);
    const sumS = S.reduce((x, v) => x + v, 0);
    if (!(sumR > 0) || !(sumS > 0)) return null;

    // Robins–Breslow–Greenland.
    const P = studies.map(s => (s.a + s.d) / s.n);
    const Q = studies.map(s => (s.b + s.c) / s.n);
    const t1 = studies.reduce((x, _s, i) => x + P[i] * R[i], 0) / (2 * sumR * sumR);
    const t2 = studies.reduce((x, _s, i) => x + P[i] * S[i] + Q[i] * R[i], 0) / (2 * sumR * sumS);
    const t3 = studies.reduce((x, _s, i) => x + Q[i] * S[i], 0) / (2 * sumS * sumS);
    const v = t1 + t2 + t3;
    if (!(v > 0)) return null;
    return { y: Math.log(sumR / sumS), se: Math.sqrt(v), weights: S };
  }

  const R = studies.map(s => (s.a * (s.c + s.d)) / s.n);
  const S = studies.map(s => (s.c * (s.a + s.b)) / s.n);
  const sumR = R.reduce((x, v) => x + v, 0);
  const sumS = S.reduce((x, v) => x + v, 0);
  if (!(sumR > 0) || !(sumS > 0)) return null;

  // Greenland–Robins.
  const num = studies.reduce((x, s) => {
    const n1 = s.a + s.b;
    const n2 = s.c + s.d;
    return x + ((n1 * n2 * (s.a + s.c) - s.a * s.c * s.n) / (s.n * s.n));
  }, 0);
  const v = num / (sumR * sumS);
  if (!(v > 0)) return null;
  return { y: Math.log(sumR / sumS), se: Math.sqrt(v), weights: S };
}

/**
 * Peto's odds ratio — a one-step score estimator around the null.
 *
 * psi = exp(sum(a - E) / sum(V)), Var(ln psi) = 1 / sum(V), where E and V are
 * each table's expected count and hypergeometric variance under no effect. It
 * needs no correction and is the least biased option for very rare events with
 * balanced arms — and the most biased when the arms are unbalanced or the effect
 * is large, which is why `sparseDataWarning` recommends it only in the first case.
 */
function petoOddsRatio(
  studies: CountStudy[],
): { y: number; se: number; weights: number[] } | null {
  if (studies.length === 0) return null;
  let sumOE = 0;
  const V: number[] = [];
  for (const s of studies) {
    const n1 = s.a + s.b;
    const n2 = s.c + s.d;
    const events = s.a + s.c;
    const expected = (n1 * events) / s.n;
    const variance = (n1 * n2 * events * (s.n - events)) / (s.n * s.n * (s.n - 1));
    if (!Number.isFinite(expected) || !Number.isFinite(variance)) return null;
    sumOE += s.a - expected;
    V.push(variance);
  }
  const sumV = V.reduce((x, v) => x + v, 0);
  if (!(sumV > 0)) return null;
  return { y: sumOE / sumV, se: Math.sqrt(1 / sumV), weights: V };
}

/**
 * Patients needed to treat for one additional event, from a risk difference.
 *
 * Rounded UP — you cannot treat 20.4 patients — but the reciprocal has to be
 * de-fuzzed first: 1/0.05 is 20.000000000000004 in binary floating point, and a
 * bare ceiling turns an exact 20 into 21. Off by one in a summary-of-findings
 * table is exactly the kind of error a reader spots and a tool should not make.
 * Exported so that rule is testable on its own, since whether the float lands
 * above or below the integer depends on arithmetic upstream of here.
 */
export function numberNeededToTreat(riskDifference: number): number | null {
  if (!Number.isFinite(riskDifference) || Math.abs(riskDifference) <= 1e-9) return null;
  return Math.ceil(Number((1 / Math.abs(riskDifference)).toFixed(6)));
}

/**
 * Absolute effect from a pooled ratio and an assumed comparator risk.
 *
 * The relative effect is applied to the assumed risk (RR directly; OR through
 * the odds), and the interval is carried through the same transformation — so the
 * absolute interval is the relative one restated, not a new estimate with its own
 * uncertainty about the baseline. That is the standard GRADE construction, and
 * its assumption (the baseline is known) is why `riskSource` is reported.
 */
function absoluteEffect(
  measure: EffectMeasure,
  pooled: { est: number; lo: number; hi: number },
  comparatorRisk: number,
  riskSource: 'corpus' | 'supplied',
): AbsoluteEffect | null {
  if (!(comparatorRisk > 0) || !(comparatorRisk < 1)) return null;
  if (measure !== 'RR' && measure !== 'OR') return null;

  const apply = (ratio: number): number => {
    if (!Number.isFinite(ratio) || ratio <= 0) return NaN;
    if (measure === 'RR') return Math.min(1, comparatorRisk * ratio);
    const odds = (comparatorRisk / (1 - comparatorRisk)) * ratio;
    return odds / (1 + odds);
  };

  const treatmentRisk = apply(pooled.est);
  const riskLo = apply(pooled.lo);
  const riskHi = apply(pooled.hi);
  if (![treatmentRisk, riskLo, riskHi].every(Number.isFinite)) return null;

  const rd = treatmentRisk - comparatorRisk;
  const rdLo = Math.min(riskLo, riskHi) - comparatorRisk;
  const rdHi = Math.max(riskLo, riskHi) - comparatorRisk;

  // Altman 1998: a reciprocal across an interval containing zero passes through
  // infinity, so the NNT interval is withheld rather than printed inverted.
  const spansNull = rdLo <= 0 && rdHi >= 0;
  const nnt = numberNeededToTreat(rd);
  const bounds = spansNull || !nnt
    ? { lo: null, hi: null }
    : {
        lo: numberNeededToTreat(Math.max(Math.abs(rdLo), Math.abs(rdHi))),
        hi: numberNeededToTreat(Math.min(Math.abs(rdLo), Math.abs(rdHi))),
      };

  return {
    comparatorRisk,
    riskSource,
    treatmentRisk,
    riskDifference: rd,
    rdLo,
    rdHi,
    per1000: Math.round(rd * 1000),
    per1000Lo: Math.round(rdLo * 1000),
    per1000Hi: Math.round(rdHi * 1000),
    nnt,
    nntKind: rd < 0 ? 'benefit' : 'harm',
    nntLo: bounds.lo,
    nntHi: bounds.hi,
  };
}

export interface MetaOptions {
  /**
   * Assumed comparator-arm risk for the absolute-effect translation. Omitted
   * means "use this corpus's own pooled comparator event rate", which is the only
   * baseline the data itself supports.
   */
  comparatorRisk?: number | null;
  /**
   * How a proportion corpus is pooled. Only read when the measure is PROP.
   * Defaults to the one-stage GLMM, which needs no continuity correction.
   */
  proportionMethod?: ProportionMethod;
}

export function runMetaAnalysis(
  input: MetaStudy[],
  measure: EffectMeasure,
  model: PoolingModel,
  options: MetaOptions = {},
): MetaResult {
  const usable: Array<{ study: MetaStudy; eff: RawEffect }> = [];
  const notEstimable: NotEstimableStudy[] = [];

  const proportionMethod: ProportionMethod = options.proportionMethod ?? 'glmm';

  for (const study of input) {
    const eff = effectOf(study, measure, proportionMethod);
    if (typeof eff === 'string') notEstimable.push({ study, reason: eff });
    else usable.push({ study, eff });
  }

  const k = usable.length;
  /**
   * From the pooling scale back to the scale a reader thinks in. One function,
   * used for every bound, so a study's interval, the diamond and the prediction
   * interval can never end up on different scales.
   */
  const toDisplay = (value: number): number => {
    if (isRatioMeasure(measure)) return Math.exp(value);
    if (measure === 'PROP') return proportionInverse(value, proportionMethod);
    if (measure === 'R') return correlationInverse(value);
    return value;
  };

  // Fixed-effect pass — needed for Q whichever model is selected.
  const wFixed = usable.map(u => 1 / u.eff.v);
  const swFixed = wFixed.reduce((a, w) => a + w, 0);
  const yFixed = k > 0 ? usable.reduce((a, u, i) => a + wFixed[i] * u.eff.y, 0) / swFixed : NaN;
  const q = k > 0 ? usable.reduce((a, u, i) => a + wFixed[i] * (u.eff.y - yFixed) ** 2, 0) : 0;
  const df = k - 1;

  // DerSimonian–Laird between-study variance.
  let tau2 = 0;
  if (model === 'random' && df > 0) {
    const c = swFixed - wFixed.reduce((a, w) => a + w * w, 0) / swFixed;
    tau2 = c > 0 ? Math.max(0, (q - df) / c) : 0;
  }

  // Inverse-variance weights, which are also the fallback for everything the
  // count-based methods below cannot weight.
  const wIV = usable.map(u => 1 / (u.eff.v + tau2));
  const swIV = wIV.reduce((a, w) => a + w, 0);
  const muIV = k > 0 ? usable.reduce((a, u, i) => a + wIV[i] * u.eff.y, 0) / swIV : NaN;
  const seIV = k > 0 ? 1 / Math.sqrt(swIV) : NaN;

  // Count-based fixed-effect methods. They pool from the raw 2x2s, so they need
  // every usable study to have binary arms; a corpus that mixes in a
  // pre-computed effect cannot be pooled this way at all, and saying so is
  // better than pooling the subset that can.
  const counts = usable.map(u => countsOf(u.study));
  const countBased = model === 'mh' || model === 'peto';
  let poolingMethodRefusal: string | null = null;
  let countResult: { y: number; se: number; weights: number[] } | null = null;

  if (countBased) {
    if (k === 0) {
      countResult = null;
    } else if (counts.some(c => c === null)) {
      poolingMethodRefusal =
        `${MODEL_LABEL[model]} pools from the 2×2 counts, and at least one study here has no arm `
        + `counts to pool — it reported an effect estimate directly. Use inverse variance for this corpus.`;
    } else if (model === 'peto' && measure !== 'OR') {
      poolingMethodRefusal =
        `Peto's method estimates an odds ratio only. Switch the measure to OR, or pool by `
        + `Mantel–Haenszel or inverse variance.`;
    } else if (model === 'mh' && measure !== 'OR' && measure !== 'RR') {
      poolingMethodRefusal =
        `Mantel–Haenszel pooling here is defined for a risk ratio or an odds ratio. `
        + `Use inverse variance for ${EFFECT_LABEL[measure]}.`;
    } else {
      const solid = counts as CountStudy[];
      countResult = model === 'peto'
        ? petoOddsRatio(solid)
        : mantelHaenszel(solid, measure as 'OR' | 'RR');
      if (!countResult) {
        poolingMethodRefusal =
          `${MODEL_LABEL[model]} cannot be computed from these counts — every study would carry zero `
          + `weight, which happens when no study has events in both directions. Use inverse variance.`;
      }
    }
  }

  /**
   * One-stage GLMM for a proportion corpus: the model works from the raw counts,
   * so it replaces the pooled estimate the way Mantel–Haenszel does, and it needs
   * no continuity correction even for a study reporting 0% or 100%.
   *
   * Its weights are approximate by nature — a one-stage fit has no explicit
   * per-study weight — so each study is given its share of 1/(v_i + tau2) with
   * v_i the study's own logit variance. That is the weighting the model implies,
   * and it is what the marker sizes on the plot then mean.
   */
  const glmmRequested = measure === 'PROP' && proportionMethod === 'glmm';
  let glmmFit: { tau2: number; seFallback: boolean } | null = null;
  let glmmResult: { y: number; se: number; weights: number[] } | null = null;
  if (glmmRequested && k > 0) {
    const countsForGlmm = usable.map(u => u.study.proportion).filter(
      (c): c is { events: number; total: number } => !!c,
    );
    if (countsForGlmm.length === k) {
      const fit = fitProportionGlmm(countsForGlmm, model === 'random');
      if (fit) {
        glmmFit = { tau2: fit.tau2, seFallback: fit.seFallback };
        glmmResult = {
          y: fit.mu,
          se: fit.se,
          weights: usable.map(u => 1 / (u.eff.v + fit.tau2)),
        };
      } else {
        poolingMethodRefusal =
          'The one-stage binomial model did not converge on these counts. Pool by the arcsine or '
          + 'logit transform instead — both are two-stage and always computable.';
      }
    } else {
      poolingMethodRefusal =
        'The one-stage binomial model pools raw counts, and at least one study here has none. '
        + 'Pool by the arcsine or logit transform instead.';
    }
  }

  const usingCounts = countBased && !!countResult && !poolingMethodRefusal;
  const usingGlmm = glmmRequested && !!glmmResult && !poolingMethodRefusal;
  const wPool = usingCounts ? countResult!.weights : usingGlmm ? glmmResult!.weights : wIV;
  const swPool = wPool.reduce((a, w) => a + w, 0);
  const mu = usingCounts ? countResult!.y : usingGlmm ? glmmResult!.y : muIV;
  const se = usingCounts ? countResult!.se : usingGlmm ? glmmResult!.se : seIV;

  const studies: StudyEffect[] = usable.map((u, i) => {
    const halfWidth = 1.96 * Math.sqrt(u.eff.v);
    /**
     * Under the one-stage model a study has no interval of its own to
     * back-transform — and back-transforming its logit interval would reintroduce
     * the continuity correction the model exists to avoid. A Wilson interval on
     * the raw counts is used for the row instead, which is exact-ish at 0% and
     * 100% and never leaves [0, 1]. The diamond still comes from the model.
     */
    const wilson = usingGlmm && u.study.proportion
      ? wilsonCI(u.study.proportion.events, u.study.proportion.total)
      : null;
    return {
      key: u.study.key,
      label: u.study.label,
      documentId: u.study.documentId,
      treatment: u.study.treatment,
      comparator: u.study.comparator,
      precomputed: u.study.precomputed,
      proportion: u.study.proportion,
      correlation: u.study.correlation,
      evidence: u.study.evidence,
      y: u.eff.y,
      v: u.eff.v,
      est: wilson && u.study.proportion
        ? u.study.proportion.events / u.study.proportion.total
        : toDisplay(u.eff.y),
      lo: wilson ? wilson.lo : toDisplay(u.eff.y - halfWidth),
      hi: wilson ? wilson.hi : toDisplay(u.eff.y + halfWidth),
      weightPct: (wPool[i] / swPool) * 100,
      /**
       * Under the one-stage model nothing was corrected: the logit transform is
       * used only to place the row, and even that is superseded by the Wilson
       * interval above. Reporting a correction that no number depends on would be
       * a footnote about the implementation, not about the data.
       */
      corrected: usingGlmm ? false : u.eff.corrected,
    };
  });

  const poolable = k >= MIN_POOLABLE && !poolingMethodRefusal
    && (!countBased || usingCounts) && (!glmmRequested || usingGlmm);
  const pooled = poolable
    ? { est: toDisplay(mu), lo: toDisplay(mu - 1.96 * se), hi: toDisplay(mu + 1.96 * se), mu, se }
    : null;

  // Higgins, Thompson & Spiegelhalter (2009): the interval a *future* study is
  // expected to fall in is mu ± t_{k-2} · sqrt(tau2 + SE^2). The t multiplier is
  // not decoration — tau2 was estimated from these same k studies, and pretending
  // it is known (z = 1.96) makes the interval too narrow by 18% at k = 10 and by
  // more than a factor of 2 at k = 4, which is inside the range this screen pools.
  const piDf = k - 2;
  const piT = studentTCritical(piDf);
  const tau2ForPrediction = usingGlmm ? glmmFit!.tau2 : tau2;
  const prediction =
    poolable && model === 'random' && df > 0 && Number.isFinite(piT)
      ? {
          lo: toDisplay(mu - piT * Math.sqrt(tau2ForPrediction + se * se)),
          hi: toDisplay(mu + piT * Math.sqrt(tau2ForPrediction + se * se)),
          df: piDf,
          t: piT,
        }
      : null;

  /**
   * HKSJ: replace the model-based variance 1/sum(w*) with the weighted spread of
   * the studies around the pooled estimate, q = sum(w*(y - mu)^2)/(k-1), and
   * refer it to t on k-1 df. With few studies or high heterogeneity that is
   * usually a wider — and better-covering — interval than the standard z one.
   *
   * When q < 1 the studies agree with the model more closely than the model
   * expects and HKSJ can come out NARROWER, which is a known wart rather than a
   * bug; the original method is reported as published and the UI flags it, since
   * silently flooring it at the standard variance ("modified HKSJ") would be
   * reporting a method nobody cited.
   */
  const hksjDf = k - 1;
  const hksjT = studentTCritical(hksjDf);
  let hksj: MetaResult['hksj'] = null;
  if (poolable && model === 'random' && hksjDf >= 1 && Number.isFinite(hksjT)
    && !usingCounts && !usingGlmm) {
    const qHk = usable.reduce((a, u, i) => a + wPool[i] * (u.eff.y - mu) ** 2, 0) / hksjDf;
    const seHk = Math.sqrt(qHk / swPool);
    if (Number.isFinite(seHk) && seHk > 0) {
      hksj = {
        est: toDisplay(mu),
        lo: toDisplay(mu - hksjT * seHk),
        hi: toDisplay(mu + hksjT * seHk),
        se: seHk,
        q: qHk,
        t: hksjT,
        df: hksjDf,
        narrower: hksjT * seHk < 1.96 * se,
      };
    }
  }

  const i2 = df > 0 && q > 0 ? Math.max(0, ((q - df) / q) * 100) : 0;
  const heterogeneity =
    poolable && df > 0 && !usingGlmm
      ? { q, df, p: chiSquareUpperP(q, df), i2, tau2, label: heterogeneityLabel(i2) }
      : null;

  /**
   * A Z test against the null. Suppressed for a proportion, where there is no
   * null: mu/se would be testing whether the prevalence is 50% on the logit
   * scale, which is not a hypothesis anyone posed.
   */
  const z = poolable && hasNullValue(measure) ? mu / se : NaN;
  const overallEffect = poolable && Number.isFinite(z) ? { z, p: normalTwoSidedP(z) } : null;

  /**
   * Rare events: the point at which the 0.5 correction inverse variance needs is
   * doing much of the arithmetic. Cochrane's guidance is to prefer a count-based
   * method there, and Peto specifically when the arms are also balanced — so the
   * recommendation names whichever of the two actually applies.
   */
  let sparseDataWarning: string | null = null;
  if (!countBased && poolable && isBinaryMeasure(measure) && measure !== 'RD') {
    const solid = counts.filter((c): c is CountStudy => c !== null);
    if (solid.length === counts.length && solid.length > 0) {
      const events = solid.reduce((x, c) => x + c.a + c.c, 0);
      const total = solid.reduce((x, c) => x + c.n, 0);
      const rate = total > 0 ? events / total : 1;
      const zeroCells = solid.filter(c => c.a === 0 || c.b === 0 || c.c === 0 || c.d === 0).length;
      if (rate < 0.01 || zeroCells > 0) {
        const balanced = solid.every(c => {
          const n1 = c.a + c.b;
          const n2 = c.c + c.d;
          const ratio = n1 > 0 && n2 > 0 ? Math.max(n1, n2) / Math.min(n1, n2) : Infinity;
          return ratio <= 1.5;
        });
        const why = rate < 0.01
          ? `events are rare here (${(rate * 100).toFixed(2)}% of participants)`
          : `${zeroCells} ${zeroCells === 1 ? 'study has' : 'studies have'} a zero cell`;
        const suggestion = measure === 'OR' && balanced
          ? `Peto's odds ratio or Mantel–Haenszel`
          : `Mantel–Haenszel`;
        sparseDataWarning =
          `Inverse-variance pooling needs a 0.5 continuity correction to compute a ratio at all, and `
          + `${why} — so that correction is carrying real weight. ${suggestion} pools the raw counts `
          + `instead and needs no correction.`;
      }
    }
  }

  /**
   * The comparator risk the absolute effect is stated against: this corpus's own
   * pooled comparator event rate unless the reviewer supplied one.
   */
  const suppliedRisk = options.comparatorRisk;
  const corpusRisk = (() => {
    const solid = counts.filter((c): c is CountStudy => c !== null);
    if (solid.length === 0) return null;
    const events = solid.reduce((x, c) => x + c.c, 0);
    const total = solid.reduce((x, c) => x + c.c + c.d, 0);
    return total > 0 ? events / total : null;
  })();
  const riskForAbsolute = suppliedRisk != null && Number.isFinite(suppliedRisk)
    ? suppliedRisk
    : corpusRisk;
  const absolute = pooled && riskForAbsolute != null
    ? absoluteEffect(
        measure, pooled, riskForAbsolute,
        suppliedRisk != null && Number.isFinite(suppliedRisk) ? 'supplied' : 'corpus',
      )
    : null;

  return {
    measure,
    model,
    studies,
    notEstimable,
    pooled,
    prediction,
    hksj,
    poolingMethodRefusal,
    sparseDataWarning,
    glmm: usingGlmm ? glmmFit : null,
    proportionMethod: measure === 'PROP' ? proportionMethod : null,
    absolute,
    heterogeneity,
    overallEffect,
    totals: armTotals(studies),
    correctedCount: studies.filter(s => s.corrected).length,
  };
}

// ── Plot axis ────────────────────────────────────────────────────────────────

export interface PlotAxis {
  log: boolean;
  min: number;
  max: number;
  /** Tick values in display units, ascending. */
  ticks: number[];
  /** Map a display value onto 0–100 across the plot column. */
  toX: (v: number) => number;
  /** Position of the no-effect line, as a percentage. */
  nullX: number;
}

/** Conventional forest-plot ladder for ratio axes. */
const RATIO_LADDER = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100];

/**
 * Choose an axis that contains every plotted interval. Ratio measures get the
 * conventional symmetric log axis; difference measures get a linear axis
 * centred on zero so "no effect" stays mid-column, as in the design.
 *
 * Values outside the axis are clamped to 1%/99% by `toX` rather than allowed to
 * escape the column, so a single wild CI cannot flatten every other study.
 */
export function buildAxis(result: MetaResult): PlotAxis {
  const values: number[] = [];
  for (const s of result.studies) values.push(s.lo, s.hi, s.est);
  if (result.pooled) values.push(result.pooled.lo, result.pooled.hi);

  /**
   * A proportion lives on [0, 1] and has no null: the axis is the scale itself,
   * padded to the data so a corpus clustered at 2% is readable, and never allowed
   * outside the bounds a proportion can take. `nullX` is parked off-axis at -1 —
   * `hasNullValue` is the flag callers check, and a negative position means a
   * renderer that ignored it draws nothing visible rather than a line at zero.
   */
  if (result.measure === 'PROP') {
    const finite = values.filter(v => Number.isFinite(v));
    const dataMin = finite.length ? Math.min(...finite) : 0;
    const dataMax = finite.length ? Math.max(...finite) : 1;
    const pad = Math.max((dataMax - dataMin) * 0.1, 0.02);
    const min = Math.max(0, dataMin - pad);
    const max = Math.min(1, dataMax + pad);
    const span = max - min || 1;
    const step = span > 0.5 ? 0.25 : span > 0.2 ? 0.1 : span > 0.08 ? 0.05 : 0.01;
    const ticks: number[] = [];
    for (let t = Math.ceil(min / step) * step; t <= max + 1e-9; t += step) {
      ticks.push(Number(t.toFixed(6)));
    }
    return {
      log: false,
      min,
      max,
      ticks: ticks.length >= 2 ? ticks : [min, max],
      toX: v => Math.min(99, Math.max(1, ((v - min) / span) * 100)),
      nullX: -1,
    };
  }

  /** A correlation is bounded at -1 and 1, and its null is the middle. */
  if (result.measure === 'R') {
    return {
      log: false,
      min: -1,
      max: 1,
      ticks: [-1, -0.5, 0, 0.5, 1],
      toX: v => Math.min(99, Math.max(1, ((v + 1) / 2) * 100)),
      nullX: 50,
    };
  }

  if (isRatioMeasure(result.measure)) {
    const finite = values.filter(v => Number.isFinite(v) && v > 0);
    const dataMin = finite.length ? Math.min(...finite) : 0.5;
    const dataMax = finite.length ? Math.max(...finite) : 2;
    // Widen symmetrically so the null line stays centred.
    const reach = Math.max(1 / Math.min(dataMin, 1), Math.max(dataMax, 1));
    const max = RATIO_LADDER.find(t => t >= reach && t > 1) ?? 100;
    const min = 1 / max;
    const lMin = Math.log(min);
    const span = Math.log(max) - lMin;
    return {
      log: true,
      min,
      max,
      ticks: RATIO_LADDER.filter(t => t >= min && t <= max),
      toX: v => (v > 0 ? Math.min(99, Math.max(1, ((Math.log(v) - lMin) / span) * 100)) : 1),
      nullX: ((0 - lMin) / span) * 100,
    };
  }

  const finite = values.filter(Number.isFinite);
  const reach = finite.length ? Math.max(...finite.map(Math.abs)) : 1;
  const safeReach = reach > 0 ? reach : 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(safeReach)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * magnitude).find(s => s >= safeReach) ?? safeReach;
  const max = step;
  const min = -step;
  return {
    log: false,
    min,
    max,
    ticks: [min, min / 2, 0, max / 2, max],
    toX: v => Math.min(99, Math.max(1, ((v - min) / (max - min)) * 100)),
    nullX: 50,
  };
}

// ── Formatting ───────────────────────────────────────────────────────────────

/** Compact tick text: 0.5 not 0.50, 2 not 2.00, 0.001 not 1e-3. */
export function formatTick(v: number): string {
  if (v === 0) return '0';
  const abs = Math.abs(v);
  if (abs >= 100) return v.toFixed(0);
  if (abs >= 1) return String(Number(v.toFixed(2)));
  return String(Number(v.toPrecision(2)));
}

/** Point estimate with CI, formatted the way the forest table shows it. */
/** Trim a number for display without dragging in a formatter dependency. */
function short(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  const dp = abs >= 100 ? 1 : abs >= 1 ? 2 : 3;
  return String(+v.toFixed(dp));
}

/** One arm as the plot's data column shows it. */
export function armCellText(arm?: Arm): string {
  if (!arm) return '—';
  return isBinaryArm(arm) ? `${arm.events}/${arm.total}` : String(arm.n);
}

/**
 * The two data columns beside a study's label.
 *
 * An arm-based study shows its arms. A study that arrived as an effect has no
 * arms to show, so it shows what the source actually reported and how precise it
 * said that was — which is the honest content of those columns for it, rather
 * than two dashes that make it look like data went missing.
 */
export function studyDataCells(s: StudyEffect): { left: string; right: string } {
  if (s.proportion) {
    const { events, total } = s.proportion;
    return { left: `${events}/${total}`, right: `${((events / total) * 100).toFixed(1)}%` };
  }
  if (s.correlation) {
    return { left: short(s.correlation.r), right: `n = ${s.correlation.n}` };
  }
  if (s.precomputed) {
    const r = s.precomputed.reported;
    const right =
      r.lo != null && r.hi != null ? `${short(r.lo)}–${short(r.hi)}`
      : r.se != null ? `SE ${short(r.se)}`
      : `SE ${short(s.precomputed.se)}`;
    return { left: short(r.est), right };
  }
  return { left: armCellText(s.treatment), right: armCellText(s.comparator) };
}

export function formatEffect(est: number, lo: number, hi: number): string {
  return `${est.toFixed(2)} (${lo.toFixed(2)} to ${hi.toFixed(2)})`;
}

/**
 * The same, but in the units the measure is read in — a proportion as a
 * percentage, because "0.02 (0.01 to 0.04)" is a prevalence nobody says out loud.
 */
export function formatMeasured(
  measure: EffectMeasure,
  est: number,
  lo: number,
  hi: number,
): string {
  if (measure !== 'PROP') return formatEffect(est, lo, hi);
  const pct = (v: number) => `${(v * 100).toFixed(v < 0.1 ? 2 : 1)}%`;
  return `${pct(est)} (${pct(lo)} to ${pct(hi)})`;
}

/**
 * An absolute effect in words, without misrepresenting its interval.
 *
 * Two traps this exists to avoid. First, an interval that spans no difference has
 * one bound on each side, and printing the two magnitudes ("55 to 124") reads as
 * though both pointed the same way — so each bound carries its own direction word.
 * Second, a risk difference below one per thousand has an NNT in the tens of
 * thousands, which is arithmetically true and rhetorically absurd; it is withheld
 * with the reason instead.
 */
export function describeAbsolute(a: AbsoluteEffect): {
  headline: string;
  interval: string;
  nnt: string | null;
} {
  const word = (v: number) => (v < 0 ? 'fewer' : 'more');
  const per1000 = Math.abs(a.per1000);
  const headline = per1000 < 1
    ? 'fewer than 1 per 1000 either way'
    : `${per1000} ${word(a.per1000)} per 1000`;

  // Ordered low bound first on the risk scale, so "fewer" always precedes "more".
  const loFirst = a.per1000Lo <= a.per1000Hi
    ? [a.per1000Lo, a.per1000Hi]
    : [a.per1000Hi, a.per1000Lo];
  const interval = `${Math.abs(loFirst[0])} ${word(loFirst[0])} to ${Math.abs(loFirst[1])} ${word(loFirst[1])}`;

  const nnt = a.nnt == null || per1000 < 1
    ? null
    : `NNT${a.nntKind === 'benefit' ? 'B' : 'H'} ${a.nnt}`
      + (a.nntLo != null && a.nntHi != null ? ` (${a.nntLo} to ${a.nntHi})` : '');

  return { headline, interval, nnt };
}

/**
 * How the effect column is headed. A measure code is right for a contrast — every
 * reader of a forest plot knows RR — but "PROP" is not a word, and a correlation
 * column is headed r.
 */
export function measureColumnLabel(measure: EffectMeasure): string {
  if (measure === 'PROP') return 'Proportion';
  if (measure === 'R') return 'r';
  return measure;
}

/** One tick, in the measure's own units. */
export function formatMeasuredTick(measure: EffectMeasure, v: number): string {
  if (measure !== 'PROP') return formatTick(v);
  const pct = v * 100;
  return `${Number(pct.toFixed(pct < 10 ? 1 : 0))}%`;
}

/** p-values below the displayed precision read as "< 0.001", never "0.000". */
export function formatP(p: number): string {
  if (!Number.isFinite(p)) return '—';
  return p < 0.001 ? '< 0.001' : p.toFixed(3);
}

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

export type EffectMeasure = 'RR' | 'OR' | 'RD' | 'MD' | 'SMD';
export type PoolingModel = 'random' | 'fixed';

export const EFFECT_LABEL: Record<EffectMeasure, string> = {
  RR: 'Risk Ratio',
  OR: 'Odds Ratio',
  RD: 'Risk Difference',
  MD: 'Mean Difference',
  SMD: 'Std. Mean Difference',
};

export const MODEL_LABEL: Record<PoolingModel, string> = {
  random: 'Random effects (DerSimonian–Laird)',
  fixed: 'Fixed effect (inverse variance)',
};

export const MODEL_SHORT: Record<PoolingModel, string> = {
  random: 'Random effects',
  fixed: 'Fixed effect',
};

export const DICHOTOMOUS_MEASURES: EffectMeasure[] = ['RR', 'OR', 'RD'];
export const CONTINUOUS_MEASURES: EffectMeasure[] = ['MD', 'SMD'];

/** Ratio measures are pooled on the log scale and plotted on a log axis. */
export function isRatioMeasure(m: EffectMeasure): boolean {
  return m === 'RR' || m === 'OR';
}

/** Measures computed from event counts rather than means. */
export function isBinaryMeasure(m: EffectMeasure): boolean {
  return m === 'RR' || m === 'OR' || m === 'RD';
}

/** The value at which the effect is null — 1 for ratios, 0 for differences. */
export function nullValue(m: EffectMeasure): number {
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

export interface MetaStudy {
  /** Stable identity for React keys and hover state. */
  key: string;
  label: string;
  documentId: string;
  treatment: Arm;
  comparator: Arm;
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

export type NotEstimableReason =
  | 'zero_events_both_arms'
  | 'zero_variance'
  | 'non_positive_total'
  | 'invalid_numbers'
  | 'wrong_arm_type';

export const NOT_ESTIMABLE_TEXT: Record<NotEstimableReason, string> = {
  zero_events_both_arms: 'zero events in both arms — no effect estimable',
  zero_variance: 'variance is zero or undefined — no confidence interval estimable',
  non_positive_total: 'an arm total is zero or negative — no effect estimable',
  invalid_numbers: 'the mapped values are not usable numbers',
  wrong_arm_type: 'this effect measure needs a different kind of data than the columns provide',
};

// ── Outputs ──────────────────────────────────────────────────────────────────

export interface StudyEffect {
  key: string;
  label: string;
  documentId: string;
  treatment: Arm;
  comparator: Arm;
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
  /** 95% prediction interval — random-effects only, and only with 3+ studies. */
  prediction: { lo: number; hi: number } | null;
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

function effectOf(study: MetaStudy, measure: EffectMeasure): RawEffect | NotEstimableReason {
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

/** Abramowitz & Stegun 7.1.26 — max error 1.5e-7, ample for a displayed p. */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-a * a);
  return sign * y;
}

/** Two-sided normal tail probability for a Z statistic. */
export function normalTwoSidedP(z: number): number {
  if (!Number.isFinite(z)) return NaN;
  return Math.max(0, 1 - erf(Math.abs(z) / Math.SQRT2));
}

/** Upper-tail chi-square probability via the Wilson–Hilferty transform. */
export function chiSquareUpperP(q: number, df: number): number {
  if (df <= 0) return NaN;
  if (q <= 0) return 1;
  const t = Math.cbrt(q / df);
  const m = 1 - 2 / (9 * df);
  const s = Math.sqrt(2 / (9 * df));
  const z = (t - m) / s;
  const phi = 0.5 * (1 + erf(z / Math.SQRT2));
  return Math.min(1, Math.max(0, 1 - phi));
}

function heterogeneityLabel(i2: number): HeterogeneityLabel {
  if (i2 < 25) return 'Low';
  if (i2 < 50) return 'Moderate';
  if (i2 < 75) return 'Substantial';
  return 'Considerable';
}

// ── Pooling ──────────────────────────────────────────────────────────────────

function armTotals(studies: StudyEffect[]): { treatment: string; comparator: string } {
  if (studies.length === 0) return { treatment: '—', comparator: '—' };
  if (isBinaryArm(studies[0].treatment)) {
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

export function runMetaAnalysis(
  input: MetaStudy[],
  measure: EffectMeasure,
  model: PoolingModel,
): MetaResult {
  const usable: Array<{ study: MetaStudy; eff: RawEffect }> = [];
  const notEstimable: NotEstimableStudy[] = [];

  for (const study of input) {
    const eff = effectOf(study, measure);
    if (typeof eff === 'string') notEstimable.push({ study, reason: eff });
    else usable.push({ study, eff });
  }

  const k = usable.length;
  const toDisplay = (value: number) => (isRatioMeasure(measure) ? Math.exp(value) : value);

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

  const wPool = usable.map(u => 1 / (u.eff.v + tau2));
  const swPool = wPool.reduce((a, w) => a + w, 0);
  const mu = k > 0 ? usable.reduce((a, u, i) => a + wPool[i] * u.eff.y, 0) / swPool : NaN;
  const se = k > 0 ? 1 / Math.sqrt(swPool) : NaN;

  const studies: StudyEffect[] = usable.map((u, i) => {
    const halfWidth = 1.96 * Math.sqrt(u.eff.v);
    return {
      key: u.study.key,
      label: u.study.label,
      documentId: u.study.documentId,
      treatment: u.study.treatment,
      comparator: u.study.comparator,
      evidence: u.study.evidence,
      y: u.eff.y,
      v: u.eff.v,
      est: toDisplay(u.eff.y),
      lo: toDisplay(u.eff.y - halfWidth),
      hi: toDisplay(u.eff.y + halfWidth),
      weightPct: (wPool[i] / swPool) * 100,
      corrected: u.eff.corrected,
    };
  });

  const poolable = k >= MIN_POOLABLE;
  const pooled = poolable
    ? { est: toDisplay(mu), lo: toDisplay(mu - 1.96 * se), hi: toDisplay(mu + 1.96 * se), mu, se }
    : null;

  const prediction =
    poolable && model === 'random' && df > 0
      ? {
          lo: toDisplay(mu - 1.96 * Math.sqrt(tau2 + se * se)),
          hi: toDisplay(mu + 1.96 * Math.sqrt(tau2 + se * se)),
        }
      : null;

  const i2 = df > 0 && q > 0 ? Math.max(0, ((q - df) / q) * 100) : 0;
  const heterogeneity =
    poolable && df > 0
      ? { q, df, p: chiSquareUpperP(q, df), i2, tau2, label: heterogeneityLabel(i2) }
      : null;

  const z = poolable ? mu / se : NaN;
  const overallEffect = poolable && Number.isFinite(z) ? { z, p: normalTwoSidedP(z) } : null;

  return {
    measure,
    model,
    studies,
    notEstimable,
    pooled,
    prediction,
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
export function formatEffect(est: number, lo: number, hi: number): string {
  return `${est.toFixed(2)} (${lo.toFixed(2)} to ${hi.toFixed(2)})`;
}

/** p-values below the displayed precision read as "< 0.001", never "0.000". */
export function formatP(p: number): string {
  if (!Number.isFinite(p)) return '—';
  return p < 0.001 ? '< 0.001' : p.toFixed(3);
}

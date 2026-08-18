/**
 * Diagnostics — the stress tests a reviewer runs against a pooled result.
 *
 * Everything here is a pure function of studies that are already on the plot,
 * and every one of them re-uses `runMetaAnalysis` rather than reimplementing the
 * pooling. That matters: a leave-one-out row that disagreed with the forest plot
 * because the two used different code would be worse than no diagnostics at all.
 *
 * Two of these tests are unreliable on small corpora, and both are gated with the
 * reason shown rather than quietly rendered. A diagnostic that invites
 * over-reading is a diagnostic that produces false confidence.
 */

import {
  chiSquareUpperP,
  isRatioMeasure,
  MIN_POOLABLE,
  normalTwoSidedP,
  runMetaAnalysis,
  type EffectMeasure,
  type MetaResult,
  type MetaStudy,
  type PoolingModel,
} from '@/lib/metaAnalysis';

/**
 * Omitting one study from three leaves two, which `MIN_POOLABLE` correctly
 * refuses to pool — so the table would be entirely blank. Four is the smallest
 * corpus where leave-one-out says anything.
 */
export const MIN_LEAVE_ONE_OUT = MIN_POOLABLE + 1;

/**
 * Cochrane's guidance is not to interpret funnel-plot asymmetry tests with fewer
 * than ten studies: below that the test has almost no power and a "significant"
 * result is as likely to be noise as bias.
 */
export const MIN_ASYMMETRY_TEST = 10;

// ── Leave-one-out ────────────────────────────────────────────────────────────

export interface LeaveOneOutRow {
  key: string;
  label: string;
  /** Pooled estimate with this study omitted, or null if too few remain. */
  est: number | null;
  lo: number | null;
  hi: number | null;
  i2: number | null;
  /** How far omitting it moves the pooled estimate, on the analysis scale. */
  shift: number;
  mostInfluential: boolean;
}

export interface LeaveOneOutResult {
  rows: LeaveOneOutRow[];
  mostInfluentialLabel: string | null;
  /** Pooled estimate with everything in, for comparison. */
  baseline: { est: number; lo: number; hi: number };
}

/**
 * Re-pool with each study left out in turn.
 *
 * The influence measure is the shift in the pooled effect on the **analysis**
 * scale (log for ratio measures), because a 0.1 shift means the same thing at
 * RR 0.5 and RR 5 there, and wildly different things on the display scale.
 */
export function leaveOneOut(
  studies: MetaStudy[],
  measure: EffectMeasure,
  model: PoolingModel,
): LeaveOneOutResult | null {
  if (studies.length < MIN_LEAVE_ONE_OUT) return null;
  const all = runMetaAnalysis(studies, measure, model);
  if (!all.pooled) return null;

  const rows: LeaveOneOutRow[] = studies.map((s, i) => {
    const without = runMetaAnalysis(studies.filter((_, j) => j !== i), measure, model);
    const pooled = without.pooled;
    return {
      key: s.key,
      label: s.label,
      est: pooled ? pooled.est : null,
      lo: pooled ? pooled.lo : null,
      hi: pooled ? pooled.hi : null,
      i2: without.heterogeneity ? without.heterogeneity.i2 : null,
      shift: pooled ? Math.abs(pooled.mu - all.pooled!.mu) : 0,
      mostInfluential: false,
    };
  });

  let mostIndex = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].est !== null && (mostIndex === -1 || rows[i].shift > rows[mostIndex].shift)) {
      mostIndex = i;
    }
  }
  if (mostIndex >= 0) rows[mostIndex].mostInfluential = true;

  return {
    rows,
    mostInfluentialLabel: mostIndex >= 0 ? rows[mostIndex].label : null,
    baseline: { est: all.pooled.est, lo: all.pooled.lo, hi: all.pooled.hi },
  };
}

// ── Subgroups ────────────────────────────────────────────────────────────────

export interface SubgroupRow {
  name: string;
  k: number;
  est: number | null;
  lo: number | null;
  hi: number | null;
  i2: number | null;
  /** False when the group has too few studies to pool — shown, never dropped. */
  poolable: boolean;
}

export interface SubgroupResult {
  rows: SubgroupRow[];
  /** Between-group heterogeneity, when at least two groups could be pooled. */
  test: { q: number; df: number; p: number } | null;
  /** Groups that exist but are too small to contribute to the test. */
  unpoolable: number;
}

/**
 * Pool within each subgroup, then test whether the subgroups differ.
 *
 * `Q_between = Σ wg (μg − μ̄)²` with `df = G − 1`. The design's fixture used
 * `normP(√Q)`, which is exactly right for two groups but silently wrong for
 * three or more; `chiSquareUpperP` gives the same answer at df = 1 and stays
 * correct beyond it.
 *
 * Groups too small to pool are still listed with their study count. Dropping
 * them would make the subgroups look like they account for every study when
 * they do not.
 */
export function subgroupAnalysis(
  studies: MetaStudy[],
  measure: EffectMeasure,
  model: PoolingModel,
  groupOf: (study: MetaStudy) => string,
): SubgroupResult {
  const groups = new Map<string, MetaStudy[]>();
  for (const s of studies) {
    const name = groupOf(s) || '(not reported)';
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name)!.push(s);
  }

  const pooled: Array<{ mu: number; se: number }> = [];
  const rows: SubgroupRow[] = [];

  for (const [name, members] of groups) {
    const r = runMetaAnalysis(members, measure, model);
    if (r.pooled) {
      pooled.push({ mu: r.pooled.mu, se: r.pooled.se });
      rows.push({
        name,
        k: r.studies.length,
        est: r.pooled.est,
        lo: r.pooled.lo,
        hi: r.pooled.hi,
        i2: r.heterogeneity ? r.heterogeneity.i2 : 0,
        poolable: true,
      });
    } else {
      rows.push({
        name, k: r.studies.length,
        est: null, lo: null, hi: null, i2: null, poolable: false,
      });
    }
  }

  rows.sort((a, b) => b.k - a.k || a.name.localeCompare(b.name));

  let test: SubgroupResult['test'] = null;
  if (pooled.length >= 2) {
    const w = pooled.map(p => 1 / (p.se * p.se));
    const sw = w.reduce((a, b) => a + b, 0);
    const muBar = pooled.reduce((a, p, i) => a + w[i] * p.mu, 0) / sw;
    const q = pooled.reduce((a, p, i) => a + w[i] * (p.mu - muBar) ** 2, 0);
    const df = pooled.length - 1;
    test = { q, df, p: chiSquareUpperP(q, df) };
  }

  return { rows, test, unpoolable: rows.filter(r => !r.poolable).length };
}

// ── Funnel plot and Egger's test ─────────────────────────────────────────────

export interface FunnelPoint {
  key: string;
  label: string;
  /** Display-scale effect — map through the plot axis to position it. */
  effect: number;
  /** Standard error on the analysis scale; the vertical axis. */
  se: number;
}

export interface EggerResult {
  intercept: number;
  se: number;
  t: number;
  p: number;
  /**
   * False below MIN_ASYMMETRY_TEST studies. The numbers are still returned so
   * the reason can name them, but they must not be read as evidence.
   */
  interpretable: boolean;
}

export interface FunnelResult {
  points: FunnelPoint[];
  /** Widest standard error, padded — the bottom of the vertical axis. */
  maxSe: number;
  /** Apex and base of the 95% pseudo-confidence region, on the display scale. */
  pseudo: { apex: number; lo: number; hi: number } | null;
  egger: EggerResult | null;
}

/**
 * Funnel geometry plus Egger's regression test for small-study effects.
 *
 * Egger regresses the standard normal deviate (`y/se`) on precision (`1/se`);
 * an intercept away from zero means small studies report systematically
 * different effects from large ones, which is what publication bias looks like.
 * It is not proof of bias — genuine clinical heterogeneity produces the same
 * pattern — so the caller words it as a suggestion.
 */
export function funnelAndEgger(result: MetaResult): FunnelResult {
  const points: FunnelPoint[] = result.studies.map(s => ({
    key: s.key,
    label: s.label,
    effect: s.est,
    se: Math.sqrt(s.v),
  }));

  const ses = points.map(p => p.se).filter(Number.isFinite);
  const maxSe = ses.length ? Math.max(...ses) * 1.1 : 1;

  const toDisplay = (v: number) => (isRatioMeasure(result.measure) ? Math.exp(v) : v);
  const pseudo = result.pooled
    ? {
        apex: toDisplay(result.pooled.mu),
        lo: toDisplay(result.pooled.mu - 1.96 * maxSe),
        hi: toDisplay(result.pooled.mu + 1.96 * maxSe),
      }
    : null;

  const egger = eggerTest(result);
  return { points, maxSe, pseudo, egger };
}

function eggerTest(result: MetaResult): EggerResult | null {
  const n = result.studies.length;
  // Ordinary least squares needs at least one residual degree of freedom.
  if (n < 3) return null;

  const x = result.studies.map(s => 1 / Math.sqrt(s.v));
  const y = result.studies.map(s => s.y / Math.sqrt(s.v));
  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;
  const sxx = x.reduce((a, v) => a + (v - meanX) ** 2, 0);
  if (!(sxx > 0)) return null;

  const sxy = x.reduce((a, v, i) => a + (v - meanX) * (y[i] - meanY), 0);
  const slope = sxy / sxx;
  const intercept = meanY - slope * meanX;

  const rss = y.reduce((a, v, i) => a + (v - intercept - slope * x[i]) ** 2, 0);
  const sumXSquared = x.reduce((a, v) => a + v * v, 0);
  const se = Math.sqrt((rss / (n - 2)) * (sumXSquared / (n * sxx)));
  if (!(se > 0)) return null;

  const t = intercept / se;
  return {
    intercept,
    se,
    t,
    p: normalTwoSidedP(t),
    interpretable: n >= MIN_ASYMMETRY_TEST,
  };
}

/**
 * The reference distributions the synthesis screen reads p-values and interval
 * widths off of.
 *
 * Every function here decides something a reviewer acts on — whether
 * heterogeneity is "significant", whether a funnel plot is asymmetric, how wide
 * a prediction interval is — so each one is computed from jStat's own CDF /
 * quantile rather than a closed-form approximation. The approximations that
 * used to live in `metaAnalysis.ts` were accurate in the middle of the
 * distribution and wrong exactly at the threshold people quote: Wilson–Hilferty
 * returns 0.0472 for χ²(1) = 3.841, which is 0.0500. At df = 1 — the
 * two-subgroup Q_between case — that is the difference between printing
 * "p < 0.05" and not.
 *
 * These are the only distributions in the app. Anything new that needs one
 * belongs here too, so there is one place to audit.
 */
import jStat from 'jstat';

/** Upper-tail probability of a chi-square statistic: P(X² ≥ q). */
export function chiSquareUpperP(q: number, df: number): number {
  if (!Number.isFinite(q) || !Number.isFinite(df) || df <= 0) return NaN;
  if (q <= 0) return 1;
  return clampP(1 - jStat.chisquare.cdf(q, df));
}

/** Two-sided normal tail probability for a Z statistic. */
export function normalTwoSidedP(z: number): number {
  if (!Number.isFinite(z)) return NaN;
  return clampP(2 * (1 - jStat.normal.cdf(Math.abs(z), 0, 1)));
}

/**
 * Two-sided tail probability for a t statistic on `df` residual degrees of
 * freedom. A statistic estimated from k studies is not a Z, and reading it off
 * the normal understates its p-value — at the ten-study floor this app gates
 * funnel asymmetry on, t = 2.31 on 8 df is p = 0.0497, not the 0.021 the normal
 * would report.
 */
export function studentTTwoSidedP(t: number, df: number): number {
  if (!Number.isFinite(t) || !Number.isFinite(df) || df <= 0) return NaN;
  return clampP(2 * (1 - jStat.studentt.cdf(Math.abs(t), df)));
}

/**
 * Two-sided critical value of t at `level` coverage — t_{df, (1+level)/2}.
 * Falls back to nothing: with df ≤ 0 there is no interval to draw, and NaN
 * propagates to a suppressed one rather than a plausible-looking wrong width.
 */
export function studentTCritical(df: number, level = 0.95): number {
  if (!Number.isFinite(df) || df <= 0) return NaN;
  if (!(level > 0 && level < 1)) return NaN;
  return jStat.studentt.inv(1 - (1 - level) / 2, df);
}

function clampP(p: number): number {
  if (!Number.isFinite(p)) return NaN;
  return Math.min(1, Math.max(0, p));
}

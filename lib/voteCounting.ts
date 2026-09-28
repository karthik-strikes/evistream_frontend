/**
 * Vote counting by direction of effect — the structured-synthesis (SWiM) fallback
 * when studies cannot be pooled.
 *
 * Three rules, from the Cochrane Handbook §12.2.2 and the SWiM guideline:
 *
 *  1. Direction is read from the POINT ESTIMATE, never from statistical
 *     significance. Counting "significant" studies is the discredited form of
 *     vote counting: it conflates imprecision with absence of effect.
 *  2. A study with no usable estimate is `nodata` and is left out of every
 *     denominator — it is not evidence either way.
 *  3. The summary is a proportion with a Wilson interval and an exact two-sided
 *     sign test against 0.5. A study whose estimate sits exactly on the null
 *     (`none`) counts in the denominator but not as a success.
 *
 * Pure functions, no React, no imports beyond the Wilson interval and nothing to
 * do with how the estimate was read.
 */

import { wilsonCI } from './singleGroupMeta';

export type Direction = 'benefit' | 'harm' | 'none' | 'nodata';

/**
 * The direction a point estimate points in.
 *
 * `lowerIsBenefit` is the outcome's orientation: true for a harm outcome such as
 * mortality (RR < 1 favours treatment), false for a good outcome such as
 * response. A missing or non-finite estimate — or a measure with no null value
 * (NaN) — is `nodata`.
 */
export function directionOf(est: number | null, nullValue: number, lowerIsBenefit: boolean): Direction {
  if (est == null || !Number.isFinite(est) || !Number.isFinite(nullValue)) return 'nodata';
  if (est === nullValue) return 'none';
  const below = est < nullValue;
  return below === lowerIsBenefit ? 'benefit' : 'harm';
}

/** ln C(n, k), summed rather than via factorials so large n cannot overflow. */
function logChoose(n: number, k: number): number {
  const m = Math.min(k, n - k);
  let s = 0;
  for (let i = 1; i <= m; i++) s += Math.log(n - m + i) - Math.log(i);
  return s;
}

/**
 * Exact two-sided sign test: x successes out of n under Binomial(n, ½).
 * p = min(1, 2 · min(P(X ≤ x), P(X ≥ x))) — the same p R's binom.test returns
 * at p = 0.5, where the distribution is symmetric.
 */
export function signTestTwoSided(x: number, n: number): number {
  if (!Number.isInteger(x) || !Number.isInteger(n) || n < 0 || x < 0 || x > n) return NaN;
  if (n === 0) return 1;
  const ln2n = n * Math.log(2);
  const pmf = (k: number) => Math.exp(logChoose(n, k) - ln2n);
  let lower = 0;
  for (let k = 0; k <= x; k++) lower += pmf(k);
  let upper = 0;
  for (let k = x; k <= n; k++) upper += pmf(k);
  return Math.min(1, 2 * Math.min(lower, upper));
}

export interface VoteCount {
  /** Every study handed in, including those with no data. */
  k: number;
  /** Studies with a direction (benefit, harm or none) — the denominator. */
  withDirection: number;
  /** Studies pointing in the `success` direction. */
  success: number;
  /** Studies left out of the denominator for want of an estimate. */
  nodata: number;
  /** Wilson 95% interval for success / withDirection; null with no denominator. */
  wilson: [number, number] | null;
  /** Exact two-sided sign test of success out of withDirection; null with no denominator. */
  p: number | null;
}

/** Count directions for one outcome class. No cross-class overall test exists, deliberately. */
export function voteCount(dirs: Direction[], success: 'benefit' | 'harm'): VoteCount {
  const nodata = dirs.filter(d => d === 'nodata').length;
  const withDirection = dirs.length - nodata;
  const hits = dirs.filter(d => d === success).length;
  const w = withDirection > 0 ? wilsonCI(hits, withDirection) : null;
  return {
    k: dirs.length,
    withDirection,
    success: hits,
    nodata,
    wilson: w ? [w.lo, w.hi] : null,
    p: withDirection > 0 ? signTestTwoSided(hits, withDirection) : null,
  };
}

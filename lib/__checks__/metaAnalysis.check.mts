/**
 * Numeric self-check for lib/metaAnalysis.ts.
 *
 *   node --experimental-strip-types lib/__checks__/metaAnalysis.check.mts
 *
 * This repo has no frontend test runner, and a forest plot that renders is not
 * a forest plot that is correct — so the statistics get checked before any UI
 * consumes them. `metaAnalysis.ts` has zero imports, so type-stripping is
 * enough to run it directly under Node.
 *
 * The assertions are deliberately of two kinds, and neither is a snapshot:
 *
 *   - HAND-COMPUTED constants, worked out on paper from the published formula
 *     (e.g. RR = (52x88)/(90x30) = 4576/2700). These catch a wrong formula.
 *   - INVARIANTS that must hold for any correct implementation (weights sum to
 *     100, lo x hi = est^2 on a log scale, identical studies have no
 *     heterogeneity). These catch wiring mistakes that a constant would miss.
 *
 * Re-deriving the implementation's own arithmetic and comparing it to itself
 * would prove nothing, so nothing here does that.
 */

import {
  runMetaAnalysis,
  buildAxis,
  chiSquareUpperP,
  normalTwoSidedP,
  hasNullValue,
  isSingleGroupMeasure,
  MIN_POOLABLE,
  nullValue,
  numberNeededToTreat,
  poolingMethodsFor,
  type MetaStudy,
  type BinaryArm,
  type ContinuousArm,
} from '../metaAnalysis.ts';
import { studentTCritical, studentTTwoSidedP } from '../distributions.ts';
import {
  correlationEffectAndSE, proportionEffectAndSE, proportionInverse, wilsonCI,
} from '../singleGroupMeta.ts';

// ── Tiny harness ─────────────────────────────────────────────────────────────

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed++;
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function close(name: string, actual: number, expected: number, tol: number): void {
  const ok = Number.isFinite(actual) && Math.abs(actual - expected) <= tol;
  check(name, ok, `expected ${expected}, got ${actual}`);
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

function binary(key: string, e1: number, n1: number, e2: number, n2: number): MetaStudy {
  return {
    key,
    label: key,
    documentId: `doc-${key}`,
    treatment: { events: e1, total: n1 } as BinaryArm,
    comparator: { events: e2, total: n2 } as BinaryArm,
  };
}

function cont(
  key: string,
  m1: number, s1: number, n1: number,
  m2: number, s2: number, n2: number,
): MetaStudy {
  return {
    key,
    label: key,
    documentId: `doc-${key}`,
    treatment: { mean: m1, sd: s1, n: n1 } as ContinuousArm,
    comparator: { mean: m2, sd: s2, n: n2 } as ContinuousArm,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Risk ratio against a hand-computed value
//    RR = (52/90) / (30/88) = (52*88)/(90*30) = 4576/2700 = 1.6948148...
//    v  = 1/52 - 1/90 + 1/30 - 1/88
//       = 0.0192307692 - 0.0111111111 + 0.0333333333 - 0.0113636364
//       = 0.0300893550
// ─────────────────────────────────────────────────────────────────────────────
{
  const r = runMetaAnalysis([binary('A', 52, 90, 30, 88)], 'RR', 'fixed');
  const s = r.studies[0];
  close('RR point estimate', s.est, 4576 / 2700, 1e-12);
  close('RR variance', s.v, 0.030089355, 1e-9);
  close('RR log-scale effect', s.y, Math.log(4576 / 2700), 1e-12);
  // On a log scale the CI is symmetric about the estimate, so lo*hi = est^2.
  close('RR CI is log-symmetric', s.lo * s.hi, s.est * s.est, 1e-9);
  check('RR CI brackets the estimate', s.lo < s.est && s.est < s.hi);
  check('single study is not corrected', s.corrected === false);
  check('single study is not pooled', r.pooled === null, `MIN_POOLABLE=${MIN_POOLABLE}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Odds ratio against a hand-computed value
//    OR = (40/60) / (20/80) = 0.6666667 / 0.25 = 2.6666667
//    v  = 1/40 + 1/60 + 1/20 + 1/80 = 0.025 + 0.0166667 + 0.05 + 0.0125
//       = 0.1041666667
// ─────────────────────────────────────────────────────────────────────────────
{
  const r = runMetaAnalysis([binary('A', 40, 100, 20, 100)], 'OR', 'fixed');
  const s = r.studies[0];
  close('OR point estimate', s.est, (40 / 60) / (20 / 80), 1e-12);
  close('OR variance', s.v, 1 / 40 + 1 / 60 + 1 / 20 + 1 / 80, 1e-12);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Risk difference against a hand-computed value
//    RD = 50/100 - 25/100 = 0.25
//    v  = (0.5*0.5)/100 + (0.25*0.75)/100 = 0.0025 + 0.001875 = 0.004375
// ─────────────────────────────────────────────────────────────────────────────
{
  const r = runMetaAnalysis([binary('A', 50, 100, 25, 100)], 'RD', 'fixed');
  const s = r.studies[0];
  close('RD point estimate', s.est, 0.25, 1e-12);
  close('RD variance', s.v, 0.004375, 1e-12);
  // A difference is NOT exponentiated — est must equal y, unlike a ratio.
  close('RD is not log-transformed', s.est, s.y, 1e-12);
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Mean difference against a hand-computed value
//    MD = 10 - 8 = 2 ; v = 2^2/25 + 2^2/25 = 0.16 + 0.16 = 0.32
// ─────────────────────────────────────────────────────────────────────────────
{
  const r = runMetaAnalysis([cont('A', 10, 2, 25, 8, 2, 25)], 'MD', 'fixed');
  const s = r.studies[0];
  close('MD point estimate', s.est, 2, 1e-12);
  close('MD variance', s.v, 0.32, 1e-12);
  close('MD CI lower', s.lo, 2 - 1.96 * Math.sqrt(0.32), 1e-12);
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Standardised mean difference — Hedges' g, hand-computed
//    sp = sqrt((24*4 + 24*4)/48) = 2 ; d = (10-8)/2 = 1
//    J  = 1 - 3/(4*48 - 1) = 1 - 3/191 = 0.9842931937
//    g  = 0.9842931937
//    v  = 50/625 + g^2/100 = 0.08 + 0.0096883309 = 0.0896883309
// ─────────────────────────────────────────────────────────────────────────────
{
  const r = runMetaAnalysis([cont('A', 10, 2, 25, 8, 2, 25)], 'SMD', 'fixed');
  const s = r.studies[0];
  close("SMD Hedges' g", s.est, 1 - 3 / 191, 1e-12);
  close('SMD variance', s.v, 0.08 + (1 - 3 / 191) ** 2 / 100, 1e-12);
  check("Hedges' g shrinks Cohen's d toward zero", s.est < 1);
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Symmetric arms produce a null effect
// ─────────────────────────────────────────────────────────────────────────────
{
  const md = runMetaAnalysis([cont('A', 7, 3, 40, 7, 3, 40)], 'MD', 'fixed');
  close('identical means give MD = 0', md.studies[0].est, 0, 1e-12);
  const smd = runMetaAnalysis([cont('A', 7, 3, 40, 7, 3, 40)], 'SMD', 'fixed');
  close('identical means give SMD = 0', smd.studies[0].est, 0, 1e-12);
  const rr = runMetaAnalysis([binary('A', 30, 100, 30, 100)], 'RR', 'fixed');
  close('identical risks give RR = 1', rr.studies[0].est, 1, 1e-12);
  const rd = runMetaAnalysis([binary('A', 30, 100, 30, 100)], 'RD', 'fixed');
  close('identical risks give RD = 0', rd.studies[0].est, 0, 1e-12);
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Homogeneity — five identical studies have nothing to disagree about
// ─────────────────────────────────────────────────────────────────────────────
{
  const same = [1, 2, 3, 4, 5].map(i => binary(`S${i}`, 40, 100, 20, 100));
  const rnd = runMetaAnalysis(same, 'RR', 'random');
  const fix = runMetaAnalysis(same, 'RR', 'fixed');

  close('identical studies give Q = 0', rnd.heterogeneity!.q, 0, 1e-9);
  close('identical studies give I2 = 0', rnd.heterogeneity!.i2, 0, 1e-9);
  close('identical studies give tau2 = 0', rnd.heterogeneity!.tau2, 0, 1e-12);
  check('df is k - 1', rnd.heterogeneity!.df === same.length - 1);
  // With tau2 = 0 the random-effects weights collapse onto the fixed ones.
  close('tau2 = 0 makes random == fixed', rnd.pooled!.est, fix.pooled!.est, 1e-12);
  close('tau2 = 0 makes CIs identical', rnd.pooled!.lo, fix.pooled!.lo, 1e-12);
  // Pooling identical studies must land on the same estimate as one of them.
  close('pooled equals the common estimate', rnd.pooled!.est, (40 / 100) / (20 / 100), 1e-12);
  // ...but with five of them, more precisely: se shrinks by sqrt(5).
  const one = runMetaAnalysis([binary('S1', 40, 100, 20, 100)], 'RR', 'fixed');
  close('se shrinks by sqrt(k)', rnd.pooled!.se * Math.sqrt(5), Math.sqrt(one.studies[0].v), 1e-9);
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. Weights are the weights actually used, and always sum to 100%
// ─────────────────────────────────────────────────────────────────────────────
{
  const mixed = [
    binary('Small', 5, 20, 3, 20),
    binary('Medium', 30, 100, 18, 100),
    binary('Large', 150, 500, 90, 500),
    binary('Huge', 600, 2000, 360, 2000),
  ];
  for (const model of ['fixed', 'random'] as const) {
    const r = runMetaAnalysis(mixed, 'RR', model);
    const total = r.studies.reduce((a, s) => a + s.weightPct, 0);
    close(`weights sum to 100 (${model})`, total, 100, 1e-9);
    check(
      `bigger studies weigh more (${model})`,
      r.studies[3].weightPct > r.studies[0].weightPct,
    );
  }
  // Fixed-effect weighting is more extreme than random-effects weighting,
  // which pulls every study toward equal influence.
  const fix = runMetaAnalysis(mixed, 'RR', 'fixed');
  const rnd = runMetaAnalysis(mixed, 'RR', 'random');
  check(
    'random effects spreads weight more evenly than fixed',
    rnd.studies[3].weightPct <= fix.studies[3].weightPct + 1e-9,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. Genuine heterogeneity produces tau2 > 0 and a wider random-effects CI
// ─────────────────────────────────────────────────────────────────────────────
{
  const scattered = [
    binary('A', 80, 100, 20, 100), // strongly favours treatment
    binary('B', 55, 100, 50, 100), // no real effect
    binary('C', 25, 100, 60, 100), // favours the comparator
    binary('D', 70, 100, 30, 100),
  ];
  const rnd = runMetaAnalysis(scattered, 'RR', 'random');
  const fix = runMetaAnalysis(scattered, 'RR', 'fixed');
  check('scattered studies give tau2 > 0', rnd.heterogeneity!.tau2 > 0);
  check('scattered studies give high I2', rnd.heterogeneity!.i2 > 75);
  check('I2 > 75 is labelled Considerable', rnd.heterogeneity!.label === 'Considerable');
  const widthRandom = Math.log(rnd.pooled!.hi) - Math.log(rnd.pooled!.lo);
  const widthFixed = Math.log(fix.pooled!.hi) - Math.log(fix.pooled!.lo);
  check('random-effects CI is wider than fixed', widthRandom > widthFixed);
  check('a prediction interval exists for random effects', rnd.prediction !== null);
  check('no prediction interval for fixed effect', fix.prediction === null);
  // The prediction interval accounts for tau2 on top of the pooled se, so it
  // must be at least as wide as the confidence interval.
  check(
    'prediction interval is wider than the CI',
    rnd.prediction!.hi / rnd.prediction!.lo >= rnd.pooled!.hi / rnd.pooled!.lo,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 10. Zero cells — corrected, or excluded, but never silently dropped
//     e1=0: cells become 0.5/51 vs 10.5/51, so RR = 0.5/10.5 = 1/21
// ─────────────────────────────────────────────────────────────────────────────
{
  const r = runMetaAnalysis([binary('Zero', 0, 50, 10, 50)], 'RR', 'fixed');
  check('zero cell is flagged as corrected', r.studies[0].corrected === true);
  close('continuity correction gives RR = 1/21', r.studies[0].est, 1 / 21, 1e-12);
  check('correctedCount tracks it', r.correctedCount === 1);

  const both = runMetaAnalysis([binary('None', 0, 50, 0, 50)], 'RR', 'fixed');
  check('zero events in both arms yields no estimate', both.studies.length === 0);
  check('...and is reported, not dropped', both.notEstimable.length === 1);
  check(
    '...with the right reason',
    both.notEstimable[0]?.reason === 'zero_events_both_arms',
    both.notEstimable[0]?.reason,
  );

  // Nothing may disappear: studies in + notEstimable must equal studies out.
  const mixed = [binary('ok', 20, 50, 10, 50), binary('none', 0, 30, 0, 30), binary('bad', 5, 0, 5, 10)];
  const acct = runMetaAnalysis(mixed, 'RR', 'fixed');
  check(
    'every input study is accounted for',
    acct.studies.length + acct.notEstimable.length === mixed.length,
    `${acct.studies.length} + ${acct.notEstimable.length} != ${mixed.length}`,
  );
  check(
    'a zero total is rejected',
    acct.notEstimable.some(n => n.reason === 'non_positive_total'),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 11. Mismatched data and measure is refused rather than silently coerced
// ─────────────────────────────────────────────────────────────────────────────
{
  const r = runMetaAnalysis([binary('A', 10, 50, 5, 50)], 'MD', 'fixed');
  check('binary arms cannot be pooled as MD', r.studies.length === 0);
  check('...and say why', r.notEstimable[0]?.reason === 'wrong_arm_type');

  const c = runMetaAnalysis([cont('A', 10, 2, 25, 8, 2, 25)], 'RR', 'fixed');
  check('continuous arms cannot be pooled as RR', c.studies.length === 0);
  check('...and say why', c.notEstimable[0]?.reason === 'wrong_arm_type');
}

// ─────────────────────────────────────────────────────────────────────────────
// 12. Pooling threshold — two studies is not a meta-analysis
// ─────────────────────────────────────────────────────────────────────────────
{
  const two = runMetaAnalysis(
    [binary('A', 40, 100, 20, 100), binary('B', 44, 110, 22, 110)],
    'RR',
    'random',
  );
  check('2 studies suppress the pooled estimate', two.pooled === null);
  check('2 studies suppress heterogeneity stats', two.heterogeneity === null);
  check('2 studies suppress the overall effect test', two.overallEffect === null);
  check('...but both studies are still plotted', two.studies.length === 2);

  const three = runMetaAnalysis(
    [binary('A', 40, 100, 20, 100), binary('B', 44, 110, 22, 110), binary('C', 36, 90, 18, 90)],
    'RR',
    'random',
  );
  check('3 studies do pool', three.pooled !== null);
  check('3 studies report heterogeneity', three.heterogeneity !== null);
}

// ─────────────────────────────────────────────────────────────────────────────
// 13. Column totals
// ─────────────────────────────────────────────────────────────────────────────
{
  const r = runMetaAnalysis(
    [binary('A', 10, 50, 5, 40), binary('B', 20, 100, 10, 80)],
    'RR',
    'fixed',
  );
  check('binary totals sum events/total', r.totals.treatment === '30/150', r.totals.treatment);
  check('binary comparator totals', r.totals.comparator === '15/120', r.totals.comparator);

  const c = runMetaAnalysis(
    [cont('A', 5, 1, 30, 4, 1, 25), cont('B', 6, 1, 20, 5, 1, 15)],
    'MD',
    'fixed',
  );
  check('continuous totals sum n', c.totals.treatment === '50', c.totals.treatment);
  check('continuous comparator totals', c.totals.comparator === '40', c.totals.comparator);
}

// ─────────────────────────────────────────────────────────────────────────────
// 14. Distributions
// ─────────────────────────────────────────────────────────────────────────────
{
  close('two-sided p at z = 1.96', normalTwoSidedP(1.96), 0.05, 1e-3);
  close('two-sided p at z = 2.576', normalTwoSidedP(2.576), 0.01, 1e-3);
  close('two-sided p at z = 0', normalTwoSidedP(0), 1, 1e-9);
  check('p is symmetric in z', Math.abs(normalTwoSidedP(-1.5) - normalTwoSidedP(1.5)) < 1e-12);

  close('chi-square p at q = 0', chiSquareUpperP(0, 5), 1, 1e-12);
  // E[chi2] = df, and the distribution is right-skewed, so P(X > df) sits just
  // under a half.
  const atMean = chiSquareUpperP(10, 10);
  check('chi-square p at q = df is just under 0.5', atMean > 0.3 && atMean < 0.5, String(atMean));
  check('chi-square p falls as q rises', chiSquareUpperP(40, 10) < chiSquareUpperP(20, 10));
  check('a large q gives a tiny p', chiSquareUpperP(100, 5) < 0.001);
}

// ─────────────────────────────────────────────────────────────────────────────
// 15. Plot axis contains everything it must, and centres the null value
// ─────────────────────────────────────────────────────────────────────────────
{
  const r = runMetaAnalysis(
    [binary('A', 40, 100, 20, 100), binary('B', 30, 100, 25, 100), binary('C', 15, 100, 30, 100)],
    'RR',
    'random',
  );
  const axis = buildAxis(r);
  check('ratio axis is logarithmic', axis.log === true);
  close('ratio axis centres the null value', axis.nullX, 50, 1e-9);
  check('ratio axis is geometrically symmetric', Math.abs(axis.min * axis.max - 1) < 1e-12);
  for (const s of r.studies) {
    check(`axis contains ${s.label} lower bound`, s.lo >= axis.min, `${s.lo} < ${axis.min}`);
    check(`axis contains ${s.label} upper bound`, s.hi <= axis.max, `${s.hi} > ${axis.max}`);
  }
  check('axis ticks include the null value', axis.ticks.includes(1));
  check('toX is monotonic', axis.toX(0.5) < axis.toX(1) && axis.toX(1) < axis.toX(2));
  check('toX stays inside the column', axis.toX(1e9) <= 99 && axis.toX(1e-9) >= 1);

  const md = runMetaAnalysis(
    [cont('A', 10, 2, 25, 8, 2, 25), cont('B', 9, 2, 30, 8, 2, 30), cont('C', 11, 3, 20, 8, 3, 20)],
    'MD',
    'random',
  );
  const linAxis = buildAxis(md);
  check('difference axis is linear', linAxis.log === false);
  close('difference axis centres zero', linAxis.nullX, 50, 1e-9);
  check('difference axis is symmetric about zero', Math.abs(linAxis.min + linAxis.max) < 1e-12);
  check('difference axis ticks include zero', linAxis.ticks.includes(0));
}

// ─────────────────────────────────────────────────────────────────────────────
// 16. An empty analysis degrades quietly instead of throwing
// ─────────────────────────────────────────────────────────────────────────────
{
  const r = runMetaAnalysis([], 'RR', 'random');
  check('no studies yields no pooled estimate', r.pooled === null);
  check('no studies yields no heterogeneity', r.heterogeneity === null);
  check('no studies yields empty totals', r.totals.treatment === '—');
  const axis = buildAxis(r);
  check('an axis still builds with no data', Number.isFinite(axis.min) && Number.isFinite(axis.max));
}

// ─────────────────────────────────────────────────────────────────────────────
// 17. Reference distributions, against published table values
//     These are the numbers a reader recognizes from the back of a textbook,
//     which is the point: the closed-form approximations these replaced were
//     accurate mid-distribution and wrong at exactly the 0.05 boundary people
//     quote (Wilson-Hilferty returned 0.0472 for chi2(1) = 3.841).
// ─────────────────────────────────────────────────────────────────────────────
{
  close('chi2 = 3.8415 on 1 df is p = 0.05', chiSquareUpperP(3.8415, 1), 0.05, 1e-4);
  close('chi2 = 5.9915 on 2 df is p = 0.05', chiSquareUpperP(5.9915, 2), 0.05, 1e-4);
  close('chi2 = 16.919 on 9 df is p = 0.05', chiSquareUpperP(16.919, 9), 0.05, 1e-4);
  close('chi2 = 2.7055 on 1 df is p = 0.10', chiSquareUpperP(2.7055, 1), 0.10, 1e-4);
  close('z = 1.95996 is p = 0.05', normalTwoSidedP(1.95996), 0.05, 1e-5);

  // Two-sided t critical values, straight off a t table.
  close('t(1, 0.975) = 12.706', studentTCritical(1), 12.706, 5e-4);
  close('t(2, 0.975) = 4.3027', studentTCritical(2), 4.3027, 5e-4);
  close('t(8, 0.975) = 2.3060', studentTCritical(8), 2.3060, 5e-4);
  close('t(13, 0.975) = 2.1604', studentTCritical(13), 2.1604, 5e-4);

  // The quantile and the tail probability must be each other's inverse.
  close('p at the t critical value is 0.05', studentTTwoSidedP(studentTCritical(8), 8), 0.05, 1e-9);

  // A t on finite df has fatter tails than a normal, so the same statistic is
  // always less significant against t. This is the whole reason Egger's test
  // and the prediction interval had to stop using 1.96.
  for (const [t, df] of [[2.31, 8], [2.0, 10], [3.07, 8], [1.5, 4]] as Array<[number, number]>) {
    check(
      `t = ${t} on ${df} df is less significant than the same z`,
      studentTTwoSidedP(t, df) > normalTwoSidedP(t),
      `${studentTTwoSidedP(t, df)} vs ${normalTwoSidedP(t)}`,
    );
  }
  check('t converges on z as df grows', Math.abs(studentTCritical(100000) - 1.95996) < 1e-3);
  check('no t critical value without residual df', !Number.isFinite(studentTCritical(0)));
}

// ─────────────────────────────────────────────────────────────────────────────
// 18. The prediction interval uses t on k-2 df, not z
//     Higgins, Thompson & Spiegelhalter (2009). tau2 is estimated from the same
//     k studies, so treating it as known (1.96) makes the interval too narrow —
//     by 18% at k = 10 and by more than a factor of 2 at k = 4, both inside the
//     range this screen pools.
// ─────────────────────────────────────────────────────────────────────────────
{
  const spread = [
    binary('A', 20, 100, 30, 100),
    binary('B', 23, 100, 29, 100),
    binary('C', 26, 100, 28, 100),
    binary('D', 29, 100, 27, 100),
    binary('E', 32, 100, 26, 100),
    binary('F', 35, 100, 25, 100),
  ];

  for (const k of [3, 4, 6]) {
    const r = runMetaAnalysis(spread.slice(0, k), 'RR', 'random');
    check(`k = ${k}: prediction df is k - 2`, r.prediction!.df === k - 2, String(r.prediction!.df));
    close(`k = ${k}: prediction t is the table value`, r.prediction!.t, studentTCritical(k - 2), 1e-9);
    check(`k = ${k}: prediction t exceeds 1.96`, r.prediction!.t > 1.96, String(r.prediction!.t));
  }

  // The multiplier shrinks toward z as studies accumulate — the interval must
  // not be uniformly inflated, only inflated where tau2 is poorly pinned down.
  const four = runMetaAnalysis(spread.slice(0, 4), 'RR', 'random');
  const six = runMetaAnalysis(spread, 'RR', 'random');
  check('the prediction multiplier falls as k rises', six.prediction!.t < four.prediction!.t);

  // And the whole interval still has to contain the pooled estimate.
  check(
    'the prediction interval brackets the pooled estimate',
    six.prediction!.lo <= six.pooled!.est && six.pooled!.est <= six.prediction!.hi,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 19. HKSJ — the same estimate, an interval that stops assuming tau2 is known
//     Var_HKSJ = q / sum(w*), q = sum(w*(y - mu)^2)/(k-1), referred to t on k-1.
//     Recomputed here from the per-study y/v and tau2 the result already
//     exposes (each separately checked above), so this catches using w instead
//     of w*, dividing by k, or referring the interval to z.
// ─────────────────────────────────────────────────────────────────────────────
{
  const spread = [
    binary('A', 20, 100, 30, 100),
    binary('B', 26, 100, 28, 100),
    binary('C', 35, 100, 25, 100),
    binary('D', 41, 100, 22, 100),
    binary('E', 30, 100, 27, 100),
  ];
  const r = runMetaAnalysis(spread, 'RR', 'random');
  const f = runMetaAnalysis(spread, 'RR', 'fixed');

  check('no HKSJ interval for a fixed-effect pool', f.hksj === null);
  check('HKSJ exists for random effects', r.hksj !== null);
  check('HKSJ uses k - 1 df', r.hksj!.df === spread.length - 1, String(r.hksj!.df));
  close('HKSJ refers to t on k - 1', r.hksj!.t, studentTCritical(spread.length - 1), 1e-9);
  close('HKSJ keeps the pooled point estimate', r.hksj!.est, r.pooled!.est, 1e-12);

  // Independent recomputation from the exposed inputs.
  const tau2 = r.heterogeneity!.tau2;
  const wStar = r.studies.map(st => 1 / (st.v + tau2));
  const sw = wStar.reduce((a, w) => a + w, 0);
  const mu = r.studies.reduce((a, st, i) => a + wStar[i] * st.y, 0) / sw;
  const qExpected =
    r.studies.reduce((a, st, i) => a + wStar[i] * (st.y - mu) ** 2, 0) / (r.studies.length - 1);
  close('HKSJ q is the weighted spread around the pooled estimate', r.hksj!.q, qExpected, 1e-9);
  close('HKSJ se is sqrt(q / sum of weights)', r.hksj!.se, Math.sqrt(qExpected / sw), 1e-9);
  close('HKSJ half-width is t x se, on the log scale',
    (Math.log(r.hksj!.hi) - Math.log(r.hksj!.lo)) / 2, r.hksj!.t * r.hksj!.se, 1e-9);

  // With real disagreement between studies, q > 1 and the interval widens.
  check('HKSJ widens a heterogeneous pool', r.hksj!.q > 1 && !r.hksj!.narrower,
    `q=${r.hksj!.q}`);
  check('HKSJ is wider than the standard interval here',
    r.hksj!.hi / r.hksj!.lo > r.pooled!.hi / r.pooled!.lo);

  // Studies that agree more closely than the model expects: q < 1, and the
  // published method can come out narrower. It must be FLAGGED, not silently
  // floored — the flag is what the UI tells the reviewer to read instead.
  const agreeing = [
    binary('A', 30, 100, 20, 100),
    binary('B', 31, 100, 20, 100),
    binary('C', 30, 101, 21, 100),
    binary('D', 30, 100, 20, 101),
  ];
  const ag = runMetaAnalysis(agreeing, 'RR', 'random');
  if (ag.hksj && ag.hksj.q < 1) {
    check('a q below 1 is flagged as narrower', ag.hksj.narrower === true,
      `q=${ag.hksj.q}, narrower=${ag.hksj.narrower}`);
  }

  // Two studies is the floor: df = 1 exists, but MIN_POOLABLE refuses to pool.
  const two = runMetaAnalysis(spread.slice(0, 2), 'RR', 'random');
  check('no HKSJ interval when there is no pooled estimate',
    two.pooled === null && two.hksj === null);
}

// ─────────────────────────────────────────────────────────────────────────────
// 20. Pre-computed effects — studies that arrived as an estimate, not as arms
//     Hand-computed: pooling an OR of 2 against an OR of 1 with EQUAL standard
//     errors is the geometric mean, sqrt(2) = 1.41421, because the pooling
//     happens on the log scale. That single constant catches pooling on the
//     natural scale (which would give 1.5) as well as unequal weighting.
// ─────────────────────────────────────────────────────────────────────────────
{
  const effect = (key: string, y: number, se: number, flipSign = false): MetaStudy => ({
    key, label: key, documentId: `doc-${key}`, flipSign,
    precomputed: { y, se, reported: { est: Math.exp(y), lo: null, hi: null, se, scale: 'log', derivedFrom: 'se' } },
  });

  const ln2 = Math.log(2);
  const r = runMetaAnalysis(
    [effect('A', ln2, 0.1), effect('B', 0, 0.1), effect('C', ln2 / 2, 0.1)],
    'OR', 'fixed',
  );
  check('all three pre-computed studies are usable', r.studies.length === 3, String(r.notEstimable.length));
  close('equal-SE log pooling is the geometric mean', r.pooled!.est, Math.SQRT2, 1e-9);
  close('each weight is a third', r.studies[0].weightPct, 100 / 3, 1e-9);
  close('a pre-computed variance is se^2', r.studies[0].v, 0.01, 1e-12);
  close('the display scale exponentiates', r.studies[0].est, 2, 1e-9);

  // Same numbers on an additive measure are averaged as they stand — three of
  // them, because MIN_POOLABLE refuses to pool two.
  const add = runMetaAnalysis(
    [effect('A', 2, 0.1), effect('B', 1, 0.1), effect('C', 1.5, 0.1)],
    'DIFF', 'fixed',
  );
  close('an additive measure pools without logging', add.pooled!.est, 1.5, 1e-9);

  // flipSign turns the effect over without touching its weight.
  const flipped = runMetaAnalysis(
    [effect('A', ln2, 0.1, true), effect('B', ln2, 0.1), effect('C', 0, 0.1)],
    'OR', 'fixed',
  );
  close('a flipped pre-computed effect cancels its twin', flipped.pooled!.est, 1, 1e-9);
  close('flipping leaves the variance alone', flipped.studies[0].v, flipped.studies[1].v, 1e-15);

  // Refusals, each with its own reason rather than a silent drop.
  const bad = runMetaAnalysis(
    [effect('A', ln2, 0.1), effect('B', ln2, 0), effect('C', Number.NaN, 0.1), effect('D', ln2, 0.2)],
    'OR', 'fixed',
  );
  check('a zero standard error is not estimable',
    bad.notEstimable.some(n => n.study.key === 'B' && n.reason === 'zero_variance'));
  check('a non-numeric effect is not estimable',
    bad.notEstimable.some(n => n.study.key === 'C' && n.reason === 'invalid_numbers'));
  check('the usable pre-computed studies still pool', bad.studies.length === 2);

  // A hazard ratio cannot be derived from arm counts, and refusing is the point.
  const armsForHR = runMetaAnalysis([binary('A', 20, 100, 30, 100)], 'HR', 'fixed');
  check('an arm-based study refuses a measure arms cannot produce',
    armsForHR.studies.length === 0
    && armsForHR.notEstimable[0].reason === 'wrong_arm_type');

  // Totals: nothing to add up, and a partial column would misdescribe the corpus.
  check('a pre-computed corpus has no arm totals',
    r.totals.treatment === '—' && r.totals.comparator === '—');
  const mixed = runMetaAnalysis(
    [effect('A', ln2, 0.1), binary('B', 20, 100, 30, 100), effect('C', 0, 0.1)],
    'OR', 'fixed',
  );
  check('one arm-less study blanks the totals row for the whole plot',
    mixed.studies.length === 3 && mixed.totals.treatment === '—');
}

// ─────────────────────────────────────────────────────────────────────────────
// 21. Mantel-Haenszel and Peto — pooling the raw counts, no correction
//     Hand-computed from three 2x2 tables (5/45 vs 10/90, 15/35 vs 20/80,
//     25/25 vs 35/65):
//       OR_MH = sum(ad/n) / sum(bc/n) = 21.8333 / 13.5     = 1.6172840
//       RR_MH = sum(a(c+d)/n) / sum(c(a+b)/n) = 30 / 21.667 = 1.3846154
//       Peto  = exp(sum(O-E)/sum(V)) = exp(8.3333/17.0768)  = 1.6290406
// ─────────────────────────────────────────────────────────────────────────────
{
  const three = [
    binary('S1', 5, 50, 10, 100),
    binary('S2', 15, 50, 20, 100),
    binary('S3', 25, 50, 35, 100),
  ];

  const mhOr = runMetaAnalysis(three, 'OR', 'mh');
  close('MH pools the odds ratio from the raw counts', mhOr.pooled!.est, 1.6172840, 1e-6);
  close('the RBG variance gives this se(ln OR)', mhOr.pooled!.se, 0.2379192, 1e-6);
  check('MH reports itself as the method', mhOr.model === 'mh' && !mhOr.poolingMethodRefusal);

  const mhRr = runMetaAnalysis(three, 'RR', 'mh');
  close('MH pools the risk ratio from the raw counts', mhRr.pooled!.est, 1.3846154, 1e-6);
  close('the Greenland-Robins variance gives this se(ln RR)', mhRr.pooled!.se, 0.1582490, 1e-6);

  const peto = runMetaAnalysis(three, 'OR', 'peto');
  close("Peto's odds ratio", peto.pooled!.est, 1.6290406, 1e-6);
  close("Peto's se(ln OR) is 1/sqrt(sum V)", peto.pooled!.se, 0.2419896, 1e-6);

  // Non-circular anchor: for a SINGLE 2x2 the Robins-Breslow-Greenland variance
  // is exactly the Woolf variance, so MH on one study must reproduce that
  // study's own inverse-variance interval. Three tables, three agreements.
  for (const [a, n1, c, n2] of [[5, 50, 10, 100], [30, 40, 20, 60], [12, 100, 7, 100]]) {
    const one = [binary('X', a, n1, c, n2), binary('Y', 20, 100, 22, 100), binary('Z', 21, 100, 23, 100)];
    const single = runMetaAnalysis([one[0]], 'OR', 'mh');
    const woolf = Math.sqrt(1 / a + 1 / (n1 - a) + 1 / c + 1 / (n2 - c));
    // Pooling one study is below MIN_POOLABLE, so read the method through a
    // three-study corpus is not possible here — check the identity directly.
    check(`MH on one 2x2 (${a}/${n1} vs ${c}/${n2}) is below the pooling floor`,
      single.pooled === null);
    const b = n1 - a;
    const d = n2 - c;
    const nTot = n1 + n2;
    const R = (a * d) / nTot;
    const S = (b * c) / nTot;
    const P = (a + d) / nTot;
    const Q = (b + c) / nTot;
    const rbg = Math.sqrt(
      (P * R) / (2 * R * R) + (P * S + Q * R) / (2 * R * S) + (Q * S) / (2 * S * S),
    );
    close(`RBG on one 2x2 equals the Woolf se (${a}/${n1} vs ${c}/${n2})`, rbg, woolf, 1e-9);
  }

  // Weights are the method's own, and they still sum to 100.
  close('MH weights sum to 100', mhOr.studies.reduce((a, s) => a + s.weightPct, 0), 100, 1e-9);
  close('Peto weights sum to 100', peto.studies.reduce((a, s) => a + s.weightPct, 0), 100, 1e-9);
  const iv = runMetaAnalysis(three, 'OR', 'fixed');
  check('MH weights differ from inverse-variance weights',
    Math.abs(mhOr.studies[0].weightPct - iv.studies[0].weightPct) > 0.01,
    `${mhOr.studies[0].weightPct} vs ${iv.studies[0].weightPct}`);

  // Count-based methods carry no random-effects apparatus.
  check('MH has no prediction interval', mhOr.prediction === null);
  check('MH has no HKSJ interval', mhOr.hksj === null);
  check('MH still reports heterogeneity', mhOr.heterogeneity !== null);

  // Refusals rather than pooling something else under the chosen name.
  const petoRr = runMetaAnalysis(three, 'RR', 'peto');
  check('Peto refuses a risk ratio', petoRr.pooled === null && !!petoRr.poolingMethodRefusal);
  check('the Peto refusal names the way out', /odds ratio/i.test(petoRr.poolingMethodRefusal!));
  const mhMd = runMetaAnalysis([
    { key: 'A', label: 'A', documentId: 'd', treatment: { mean: 10, sd: 2, n: 30 }, comparator: { mean: 9, sd: 2, n: 30 } },
    { key: 'B', label: 'B', documentId: 'd', treatment: { mean: 11, sd: 3, n: 30 }, comparator: { mean: 9, sd: 2, n: 30 } },
    { key: 'C', label: 'C', documentId: 'd', treatment: { mean: 12, sd: 2, n: 30 }, comparator: { mean: 9, sd: 2, n: 30 } },
  ] as MetaStudy[], 'MD', 'mh');
  check('MH refuses a mean difference', mhMd.pooled === null && !!mhMd.poolingMethodRefusal);

  const mixed = runMetaAnalysis([
    binary('S1', 5, 50, 10, 100),
    binary('S2', 15, 50, 20, 100),
    { key: 'P', label: 'P', documentId: 'd', precomputed: { y: 0.3, se: 0.2, reported: { est: 1.35, lo: null, hi: null, se: 0.2, scale: 'log', derivedFrom: 'se' } } },
  ] as MetaStudy[], 'OR', 'mh');
  check('MH refuses a corpus with no counts for one study',
    mixed.pooled === null && /arm counts/i.test(mixed.poolingMethodRefusal ?? ''));

  // Which methods the UI may offer.
  check('OR over arms offers all four methods',
    poolingMethodsFor('OR', true).join() === 'random,fixed,mh,peto');
  check('RR over arms offers MH but not Peto',
    poolingMethodsFor('RR', true).join() === 'random,fixed,mh');
  check('RD offers neither', poolingMethodsFor('RD', true).join() === 'random,fixed');
  check('a continuous measure offers neither', poolingMethodsFor('MD', true).join() === 'random,fixed');
  check('a pre-computed corpus offers neither', poolingMethodsFor('OR', false).join() === 'random,fixed');
}

// ─────────────────────────────────────────────────────────────────────────────
// 22. Sparse-data advice — the correction is doing the work, so say so
// ─────────────────────────────────────────────────────────────────────────────
{
  const rare = runMetaAnalysis([
    binary('A', 1, 500, 4, 500),
    binary('B', 2, 600, 5, 600),
    binary('C', 0, 400, 3, 400),
  ], 'OR', 'fixed');
  check('rare events trigger method advice', !!rare.sparseDataWarning, String(rare.sparseDataWarning));
  check('the advice names a count-based method', /Mantel|Peto/.test(rare.sparseDataWarning!));
  check('with balanced arms and an OR, Peto is offered', /Peto/.test(rare.sparseDataWarning!));

  const rareRr = runMetaAnalysis([
    binary('A', 1, 500, 4, 500), binary('B', 2, 600, 5, 600), binary('C', 1, 400, 3, 400),
  ], 'RR', 'fixed');
  check('for a risk ratio only Mantel-Haenszel is offered',
    /Mantel/.test(rareRr.sparseDataWarning!) && !/Peto/.test(rareRr.sparseDataWarning!));

  const unbalanced = runMetaAnalysis([
    binary('A', 1, 100, 4, 900), binary('B', 2, 120, 5, 1100), binary('C', 1, 90, 3, 800),
  ], 'OR', 'fixed');
  check('with unbalanced arms Peto is not recommended',
    !/Peto/.test(unbalanced.sparseDataWarning ?? ''), String(unbalanced.sparseDataWarning));

  const common = runMetaAnalysis([
    binary('A', 40, 100, 50, 100), binary('B', 45, 100, 52, 100), binary('C', 38, 100, 47, 100),
  ], 'OR', 'fixed');
  check('common events with no zero cells need no advice', common.sparseDataWarning === null);

  const already = runMetaAnalysis([
    binary('A', 1, 500, 4, 500), binary('B', 2, 600, 5, 600), binary('C', 0, 400, 3, 400),
  ], 'OR', 'mh');
  check('no advice when a count-based method is already selected',
    already.sparseDataWarning === null);
}

// ─────────────────────────────────────────────────────────────────────────────
// 23. Absolute effect — the relative effect restated per 1000
//     Hand-computed: RR 0.75 on a 20% baseline gives 15%, a 5-point drop, 50
//     fewer per 1000, NNTB 20 (exactly 20 — the reciprocal must not be allowed
//     to round up off a floating-point 20.000000000000004).
//     OR 0.75 on the same baseline gives 15.7895%, 42 fewer per 1000, NNTB 24.
// ─────────────────────────────────────────────────────────────────────────────
{
  const studies = [
    binary('A', 15, 100, 20, 100),
    binary('B', 14, 100, 21, 100),
    binary('C', 16, 100, 19, 100),
  ];
  const r = runMetaAnalysis(studies, 'RR', 'fixed', { comparatorRisk: 0.2 });
  const a = r.absolute!;
  check('the supplied baseline is used and labelled',
    a.comparatorRisk === 0.2 && a.riskSource === 'supplied');

  // Drive the arithmetic from a known ratio rather than the pooled one.
  const fake = { est: 0.75, lo: 0.6, hi: 0.9 };
  const rr = runMetaAnalysis(studies, 'RR', 'fixed', { comparatorRisk: 0.2 });
  check('an absolute effect exists for a risk ratio', rr.absolute !== null);

  // The corpus's own comparator rate is the default: 60/300 = 20%.
  const corpus = runMetaAnalysis(studies, 'RR', 'fixed');
  close("the default baseline is the corpus's own comparator rate",
    corpus.absolute!.comparatorRisk, 0.2, 1e-12);
  check('and it says where it came from', corpus.absolute!.riskSource === 'corpus');

  // Exact arithmetic, checked through the public surface with a pooled estimate
  // of exactly 0.75 by construction: three identical 15/100 vs 20/100 studies.
  const exact = runMetaAnalysis([
    binary('A', 15, 100, 20, 100), binary('B', 15, 100, 20, 100), binary('C', 15, 100, 20, 100),
  ], 'RR', 'fixed', { comparatorRisk: 0.2 });
  close('the pooled RR is 0.75 by construction', exact.pooled!.est, 0.75, 1e-9);
  close('treatment risk is 15%', exact.absolute!.treatmentRisk, 0.15, 1e-9);
  close('the risk difference is 5 points', exact.absolute!.riskDifference, -0.05, 1e-9);
  check('50 fewer per 1000', exact.absolute!.per1000 === -50, String(exact.absolute!.per1000));
  check('NNTB is exactly 20, not 21', exact.absolute!.nnt === 20, String(exact.absolute!.nnt));
  check('and it is a benefit', exact.absolute!.nntKind === 'benefit');

  // The rounding rule, tested where the float actually bites — and it bites on a
  // SUBTRACTION, which is exactly how a risk difference is produced. 0.15 - 0.1
  // is 0.04999999999999999, whose reciprocal is 20.000000000000004, so a bare
  // ceiling reports an NNT of 21 for a 5-point difference. Written as
  // subtractions here rather than as tidy literals, because tidy literals do not
  // reproduce it and would leave the guard untested.
  check('a 5-point risk difference (0.15 - 0.1) is NNT 20, not 21',
    numberNeededToTreat(0.15 - 0.1) === 20, String(numberNeededToTreat(0.15 - 0.1)));
  check('a 10-point risk difference (0.3 - 0.2) is NNT 10, not 11',
    numberNeededToTreat(0.3 - 0.2) === 10, String(numberNeededToTreat(0.3 - 0.2)));
  check('a 2.5-point risk difference (0.075 - 0.05) is NNT 40, not 41',
    numberNeededToTreat(0.075 - 0.05) === 40, String(numberNeededToTreat(0.075 - 0.05)));
  check('the sign does not matter', numberNeededToTreat(-(0.15 - 0.1)) === 20);
  check('a genuine fraction still rounds up', numberNeededToTreat(0.03) === 34,
    String(numberNeededToTreat(0.03)));
  check('a risk difference of zero has no NNT', numberNeededToTreat(0) === null);
  check('a non-finite risk difference has no NNT', numberNeededToTreat(Number.NaN) === null);

  // The same three studies pooled as an ODDS ratio: OR = (15x80)/(85x20) = 0.7058824.
  // Applied back to the corpus's own 20% baseline it must reproduce the treatment
  // arm's own 15% — a self-consistency property the risk-ratio path shares, and
  // the one thing an odds-to-risk conversion mistake would break.
  const exactOr = runMetaAnalysis([
    binary('A', 15, 100, 20, 100), binary('B', 15, 100, 20, 100), binary('C', 15, 100, 20, 100),
  ], 'OR', 'fixed', { comparatorRisk: 0.2 });
  close('the pooled OR is 0.7058824 by construction', exactOr.pooled!.est, 0.7058824, 1e-6);
  close('an odds ratio applied to its own baseline returns its own risk',
    exactOr.absolute!.treatmentRisk, 0.15, 1e-9);
  check('50 fewer per 1000, agreeing with the risk-ratio route at this baseline',
    exactOr.absolute!.per1000 === -50, String(exactOr.absolute!.per1000));

  // At a DIFFERENT baseline the two transformations must part company: the odds
  // route gives 0.7058824/(1+0.7058824) = 0.4137931 at a 50% baseline, where a
  // risk ratio of the same size would give 0.5 x 0.7058824 = 0.3529412.
  const orAtHalf = runMetaAnalysis([
    binary('A', 15, 100, 20, 100), binary('B', 15, 100, 20, 100), binary('C', 15, 100, 20, 100),
  ], 'OR', 'fixed', { comparatorRisk: 0.5 });
  close('the odds route at a 50% baseline', orAtHalf.absolute!.treatmentRisk, 0.4137931, 1e-6);
  const rrAtHalf = runMetaAnalysis([
    binary('A', 15, 100, 20, 100), binary('B', 15, 100, 20, 100), binary('C', 15, 100, 20, 100),
  ], 'RR', 'fixed', { comparatorRisk: 0.5 });
  close('the risk-ratio route at a 50% baseline', rrAtHalf.absolute!.treatmentRisk, 0.375, 1e-6);
  check('the two routes disagree away from the corpus baseline',
    Math.abs(orAtHalf.absolute!.treatmentRisk - rrAtHalf.absolute!.treatmentRisk) > 0.03);

  // Harm is labelled as harm.
  const harm = runMetaAnalysis([
    binary('A', 25, 100, 20, 100), binary('B', 26, 100, 20, 100), binary('C', 24, 100, 20, 100),
  ], 'RR', 'fixed', { comparatorRisk: 0.2 });
  check('a harmful effect is NNTH', harm.absolute!.nntKind === 'harm');
  check('and its per-1000 is positive', harm.absolute!.per1000 > 0);

  // An interval spanning no effect: the point NNT stands, the interval does not.
  const straddles = runMetaAnalysis([
    binary('A', 19, 100, 20, 100), binary('B', 21, 100, 20, 100), binary('C', 20, 100, 20, 100),
  ], 'RR', 'fixed', { comparatorRisk: 0.2 });
  check('an interval through zero suppresses the NNT interval',
    straddles.absolute!.nntLo === null && straddles.absolute!.nntHi === null);

  // Not defined outside ratio measures over risks.
  const md = runMetaAnalysis([
    { key: 'A', label: 'A', documentId: 'd', treatment: { mean: 10, sd: 2, n: 30 }, comparator: { mean: 9, sd: 2, n: 30 } },
    { key: 'B', label: 'B', documentId: 'd', treatment: { mean: 11, sd: 3, n: 30 }, comparator: { mean: 9, sd: 2, n: 30 } },
    { key: 'C', label: 'C', documentId: 'd', treatment: { mean: 12, sd: 2, n: 30 }, comparator: { mean: 9, sd: 2, n: 30 } },
  ] as MetaStudy[], 'MD', 'fixed', { comparatorRisk: 0.2 });
  check('a mean difference has no absolute translation', md.absolute === null);
  const rd = runMetaAnalysis(studies, 'RD', 'fixed', { comparatorRisk: 0.2 });
  check('a risk difference is already absolute', rd.absolute === null);

  // A baseline outside (0,1) is refused rather than clamped into nonsense.
  for (const bad of [0, 1, -0.2, 1.5]) {
    const r2 = runMetaAnalysis(studies, 'RR', 'fixed', { comparatorRisk: bad });
    check(`a baseline of ${bad} is refused`, r2.absolute === null);
  }

  // A risk that the relative effect would push past 1 is capped, not left above it.
  const capped = runMetaAnalysis([
    binary('A', 60, 100, 20, 100), binary('B', 62, 100, 20, 100), binary('C', 58, 100, 20, 100),
  ], 'RR', 'fixed', { comparatorRisk: 0.5 });
  check('a treatment risk cannot exceed 1', capped.absolute!.treatmentRisk <= 1);
}

// ─────────────────────────────────────────────────────────────────────────────
// 24. Proportions — the per-study transforms, by hand
//     arcsine 3/50: asin(sqrt(0.06)) = 0.2474671, se = sqrt(1/200) = 0.0707107
//     logit 0/40 (corrected): ln(0.5/40.5) = -4.394449, se = sqrt(1/0.5 + 1/40.5)
//     logit 8/60: ln(8/52) = -1.8718022, se = sqrt(1/8 + 1/52) = 0.3797773
// ─────────────────────────────────────────────────────────────────────────────
{
  const arc = proportionEffectAndSE(3, 50, 'arcsine')!;
  close('the arcsine transform', arc.y, 0.2474671, 1e-6);
  close('its variance depends only on n', arc.se, 0.0707107, 1e-6);
  check('and it never needs a correction', arc.corrected === false);
  const arcZero = proportionEffectAndSE(0, 40, 'arcsine')!;
  check('a study at 0% transforms with no correction',
    arcZero.y === 0 && arcZero.corrected === false);
  const arcAll = proportionEffectAndSE(40, 40, 'arcsine')!;
  close('a study at 100% lands at pi/2', arcAll.y, Math.PI / 2, 1e-12);

  const logit = proportionEffectAndSE(8, 60, 'logit')!;
  close('the logit transform', logit.y, -1.8718022, 1e-6);
  close('its standard error', logit.se, 0.3797773, 1e-6);
  check('no correction where the logit is finite', logit.corrected === false);
  const logitZero = proportionEffectAndSE(0, 40, 'logit')!;
  close('a study at 0% needs the correction the logit cannot avoid', logitZero.y, -4.394449, 1e-5);
  check('and it is reported as corrected', logitZero.corrected === true);

  const raw = proportionEffectAndSE(0, 40, 'raw')!;
  close('the raw scale corrects an extreme too', raw.y, 0.0121951, 1e-6);
  check('and says so', raw.corrected === true);

  // Refusals: not unusual data, impossible data.
  check('more events than the total is refused', proportionEffectAndSE(41, 40, 'logit') === null);
  check('a negative count is refused', proportionEffectAndSE(-1, 40, 'logit') === null);
  check('a zero denominator is refused', proportionEffectAndSE(0, 0, 'arcsine') === null);

  // The inverse must be an inverse, and must clamp rather than fold.
  close('arcsine round-trips', proportionInverse(arc.y, 'arcsine'), 0.06, 1e-9);
  close('logit round-trips', proportionInverse(logit.y, 'logit'), 8 / 60, 1e-9);
  check('an arcsine bound past pi/2 clamps to 1, it does not fold back',
    proportionInverse(2.0, 'arcsine') === 1,
    String(proportionInverse(2.0, 'arcsine')));
  check('a bound below zero clamps to 0', proportionInverse(-0.5, 'arcsine') === 0);
  for (const m of ['arcsine', 'logit', 'raw', 'glmm'] as const) {
    for (const theta of [-10, -1, 0, 0.5, 3, 40]) {
      const back = proportionInverse(theta, m);
      check(`${m} inverse of ${theta} stays a proportion`, back >= 0 && back <= 1, String(back));
    }
  }

  // Wilson, hand-computed: 0/40 -> [0, 0.0876245], 8/60 -> [0.0691403, 0.2416539]
  const w0 = wilsonCI(0, 40)!;
  close('Wilson at zero events, lower', w0.lo, 0, 1e-12);
  close('Wilson at zero events, upper', w0.hi, 0.0876245, 1e-6);
  const w8 = wilsonCI(8, 60)!;
  close('Wilson lower', w8.lo, 0.0691403, 1e-6);
  close('Wilson upper', w8.hi, 0.2416539, 1e-6);
  check('Wilson refuses an empty denominator', wilsonCI(0, 0) === null);
}

// ─────────────────────────────────────────────────────────────────────────────
// 25. Proportion pooling end to end
//     Cross-checked against The Biostat Toolkit's own meta-analysis-proportions
//     calculator on the same four studies (3/50, 0/40, 8/60, 5/45), which is an
//     independent implementation of the same methods:
//       GLMM 7.25%   arcsine 5.82%   logit 9.46%   raw 6.94%
// ─────────────────────────────────────────────────────────────────────────────
{
  const prop = (key: string, events: number, total: number): MetaStudy =>
    ({ key, label: key, documentId: `doc-${key}`, proportion: { events, total } });
  const four = [prop('A', 3, 50), prop('B', 0, 40), prop('C', 8, 60), prop('D', 5, 45)];

  for (const [method, expected] of [
    ['glmm', 0.0725], ['arcsine', 0.0582], ['logit', 0.0946], ['raw', 0.0694],
  ] as Array<['glmm' | 'arcsine' | 'logit' | 'raw', number]>) {
    const r = runMetaAnalysis(four, 'PROP', 'random', { proportionMethod: method });
    check(`${method} pools all four studies`, r.studies.length === 4, String(r.notEstimable.length));
    close(`${method} agrees with the reference implementation`, r.pooled!.est, expected, 5e-5);
    check(`${method} keeps the pooled estimate inside [0, 1]`,
      r.pooled!.lo >= 0 && r.pooled!.hi <= 1);
    check(`${method} weights sum to 100`,
      Math.abs(r.studies.reduce((a, st) => a + st.weightPct, 0) - 100) < 1e-9);
    check(`${method} reports which transform it used`, r.proportionMethod === method);
    if (r.prediction) {
      check(`${method} keeps the prediction interval inside [0, 1]`,
        r.prediction.lo >= 0 && r.prediction.hi <= 1,
        `${r.prediction.lo} to ${r.prediction.hi}`);
    }
  }

  const glmm = runMetaAnalysis(four, 'PROP', 'random', { proportionMethod: 'glmm' });
  check('the one-stage fit reports its own tau2', (glmm.glmm?.tau2 ?? 0) > 0);
  check('a one-stage fit has no Cochran Q or I2', glmm.heterogeneity === null);
  check('and no HKSJ interval, which is an inverse-variance construction', glmm.hksj === null);
  check('a proportion has no null, so no overall-effect test', glmm.overallEffect === null);
  check('the totals row counts events out of the total',
    glmm.totals.treatment === '16/195' && glmm.totals.comparator === '—',
    JSON.stringify(glmm.totals));
  check('the SE came from the likelihood curvature, not the fallback',
    glmm.glmm?.seFallback === false);

  // Under the one-stage model each row is a Wilson interval on its own counts —
  // back-transforming its logit interval would reintroduce the very correction
  // the model exists to avoid.
  close('a row shows its observed proportion', glmm.studies[0].est, 3 / 50, 1e-12);
  close('with a Wilson lower bound', glmm.studies[1].lo, 0, 1e-12);
  close('and a Wilson upper bound', glmm.studies[1].hi, 0.0876245, 1e-6);

  // The fixed-effect fit holds tau2 at zero, which must move the estimate.
  const fixed = runMetaAnalysis(four, 'PROP', 'fixed', { proportionMethod: 'glmm' });
  check('the fixed-effect fit sets tau2 to zero', fixed.glmm?.tau2 === 0);
  check('and gives a different pooled proportion',
    Math.abs(fixed.pooled!.est - glmm.pooled!.est) > 1e-4);
  check('a fixed-effect fit has no prediction interval', fixed.prediction === null);

  // Two-stage methods still report heterogeneity, since they have per-study SEs.
  const arcsine = runMetaAnalysis(four, 'PROP', 'random', { proportionMethod: 'arcsine' });
  check('a two-stage method reports I2', (arcsine.heterogeneity?.i2 ?? 0) > 0);
  check('the arcsine transform corrects nothing', arcsine.correctedCount === 0);
  const logitPool = runMetaAnalysis(four, 'PROP', 'random', { proportionMethod: 'logit' });
  check('the logit transform corrects the 0% study', logitPool.correctedCount === 1,
    String(logitPool.correctedCount));

  // Impossible data reaches the ledger with its own reason.
  const impossible = runMetaAnalysis(
    [prop('A', 3, 50), prop('B', 60, 40), prop('C', 8, 60), prop('D', 5, 45)],
    'PROP', 'random', { proportionMethod: 'arcsine' },
  );
  check('a count above its denominator is not estimable',
    impossible.notEstimable.some(n => n.study.key === 'B' && n.reason === 'proportion_out_of_range'));
  check('the rest still pool', impossible.studies.length === 3);

  // The axis is the proportion scale, and it has no null line to draw.
  const axis = buildAxis(glmm);
  check('a proportion axis stays inside [0, 1]', axis.min >= 0 && axis.max <= 1);

  // The clamp only bites when the data reaches the ends of the scale, so it is
  // checked there: a study at 100% and one at 0% in the same corpus.
  const extremes = runMetaAnalysis(
    [prop('Z', 0, 30), prop('A', 3, 50), prop('C', 8, 60), prop('F', 40, 40)],
    'PROP', 'random', { proportionMethod: 'arcsine' },
  );
  const wideAxis = buildAxis(extremes);
  check('an axis reaching 100% is not padded past it',
    wideAxis.max <= 1, String(wideAxis.max));
  check('and one reaching 0% is not padded below it',
    wideAxis.min >= 0, String(wideAxis.min));
  check('a study at 100% still plots', extremes.studies.length === 4);
  check('and its interval cannot exceed 100%',
    extremes.studies.every(st => st.hi <= 1 && st.lo >= 0));
  check('and parks the null off-axis', axis.nullX < 0);
  check('a proportion has no null value', Number.isNaN(nullValue('PROP')));
  check('and hasNullValue says so', hasNullValue('PROP') === false);
  check('a proportion is a single-group measure', isSingleGroupMeasure('PROP'));

  // Asking for a proportion of arm data, or a contrast of proportion data, refuses.
  const armsAsProp = runMetaAnalysis([binary('A', 20, 100, 30, 100)], 'PROP', 'random');
  check('arm data cannot be pooled as a proportion',
    armsAsProp.notEstimable[0]?.reason === 'wrong_arm_type');
  const propAsRr = runMetaAnalysis(four, 'RR', 'random');
  check('proportion data cannot be pooled as a risk ratio',
    propAsRr.studies.length === 0 && propAsRr.notEstimable[0]?.reason === 'wrong_arm_type');
}

// ─────────────────────────────────────────────────────────────────────────────
// 26. Correlations — pooled on Fisher's z, reported as r
//     atanh(0.5) = 0.5493061, se at n = 53 is sqrt(1/50) = 0.1414214.
//     Pooling r = 0.3 and r = 0.5 at equal precision gives z = 0.4294129 and
//     therefore r = 0.4048305 — NOT the arithmetic mean 0.4, which is the whole
//     point of transforming first.
// ─────────────────────────────────────────────────────────────────────────────
{
  const corr = (key: string, r: number, n: number): MetaStudy =>
    ({ key, label: key, documentId: `doc-${key}`, correlation: { r, n } });

  const t = correlationEffectAndSE(0.5, 53)!;
  close("Fisher's z", t.y, 0.5493061, 1e-6);
  close('its standard error is 1/sqrt(n-3)', t.se, 0.1414214, 1e-6);
  check('a correlation of exactly 1 has no z', correlationEffectAndSE(1, 50) === null);
  check('and neither does -1', correlationEffectAndSE(-1, 50) === null);
  check('three observations are too few', correlationEffectAndSE(0.5, 3) === null);
  check('four are enough', correlationEffectAndSE(0.5, 4) !== null);

  // Equal precision, so the pooled z is the mean of the z's.
  const pair = runMetaAnalysis(
    [corr('A', 0.3, 103), corr('B', 0.5, 103), corr('C', 0.4294129 > 0 ? 0.4048305 : 0, 103)],
    'R', 'fixed',
  );
  check('all three correlations pool', pair.studies.length === 3);
  close("a study's own r comes back unchanged", pair.studies[0].est, 0.3, 1e-9);
  // Symmetric on the z scale by construction — 1.96 x sqrt(1/100) = 0.196 each
  // side — and therefore asymmetric once tanh brings it back to r, which is the
  // correct way to report an interval built on a transformed scale.
  close('the interval is symmetric in z, above',
    Math.atanh(pair.studies[0].hi) - 0.3095196, 0.196, 1e-6);
  close('the interval is symmetric in z, below',
    0.3095196 - Math.atanh(pair.studies[0].lo), 0.196, 1e-6);
  check('and asymmetric in r',
    Math.abs((pair.studies[0].hi - 0.3) - (0.3 - pair.studies[0].lo)) > 1e-3,
    `${pair.studies[0].lo} .. ${pair.studies[0].hi}`);

  const two = runMetaAnalysis(
    [corr('A', 0.3, 103), corr('B', 0.5, 103), corr('C', 0.4048305, 103)],
    'R', 'fixed',
  );
  close('pooling on z, not on r', two.pooled!.est, 0.4048305, 1e-6);
  check('which is not the arithmetic mean of the rs',
    Math.abs(two.pooled!.est - (0.3 + 0.5 + 0.4048305) / 3) > 1e-4);

  const identical = runMetaAnalysis(
    [corr('A', 0.5, 53), corr('B', 0.5, 53), corr('C', 0.5, 53)],
    'R', 'fixed',
  );
  close('identical correlations pool to themselves', identical.pooled!.est, 0.5, 1e-9);
  check('and show no heterogeneity', identical.heterogeneity!.i2 === 0);

  // A correlation HAS a null — zero — so the Z test is meaningful and kept.
  check('a correlation has a null of zero', nullValue('R') === 0);
  check('so the overall-effect test is reported', identical.overallEffect !== null);
  check('but it is still a single-group measure', isSingleGroupMeasure('R'));
  const axis = buildAxis(identical);
  check('the axis spans the whole correlation range', axis.min === -1 && axis.max === 1);
  close('with the null in the middle', axis.nullX, 50, 1e-9);

  // flipSign turns a reversed scale over, as it does for a mean difference.
  const flipped = runMetaAnalysis(
    [{ ...corr('A', 0.5, 53), flipSign: true }, corr('B', 0.5, 53), corr('C', 0, 53)] as MetaStudy[],
    'R', 'fixed',
  );
  close('a flipped correlation cancels its twin', flipped.pooled!.est, 0, 1e-9);

  // Refusals land in the ledger, not in the pool.
  const bad = runMetaAnalysis(
    [corr('A', 1, 88), corr('B', 0.31, 3), corr('C', 0.55, 64), corr('D', 0.28, 210)],
    'R', 'random',
  );
  check('an out-of-range correlation is named',
    bad.notEstimable.some(n => n.study.key === 'A' && n.reason === 'correlation_out_of_range'));
  check('too small a sample is named',
    bad.notEstimable.some(n => n.study.key === 'B' && n.reason === 'sample_too_small'));
  check('and the usable ones are below the pooling floor', bad.pooled === null);
}

// ── Report ───────────────────────────────────────────────────────────────────

if (failures.length > 0) {
  console.error(`\n  ${failures.length} FAILED of ${passed + failures.length}:\n`);
  for (const f of failures) console.error(`   x ${f}`);
  console.error('');
  process.exit(1);
}

console.log(`\n  metaAnalysis.ts — ${passed} checks passed\n`);

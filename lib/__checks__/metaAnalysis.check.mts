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
  MIN_POOLABLE,
  type MetaStudy,
  type BinaryArm,
  type ContinuousArm,
} from '../metaAnalysis.ts';

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

// ── Report ───────────────────────────────────────────────────────────────────

if (failures.length > 0) {
  console.error(`\n  ${failures.length} FAILED of ${passed + failures.length}:\n`);
  for (const f of failures) console.error(`   x ${f}`);
  console.error('');
  process.exit(1);
}

console.log(`\n  metaAnalysis.ts — ${passed} checks passed\n`);

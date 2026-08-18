/**
 * Numeric self-check for the Synthesis diagnostics and value reconciliation.
 *
 *   node --experimental-strip-types --import ./lib/__checks__/register-alias.mjs \
 *        lib/__checks__/diagnostics.check.mts
 *
 * Two things are being guarded here.
 *
 * The diagnostics are *interpretations* of a pooled result, so the danger is
 * subtler than a wrong number: a leave-one-out table that disagreed with the
 * forest plot, or an Egger test rendered on four studies, would produce
 * confident-looking conclusions with nothing behind them.
 *
 * The reconciliation is worse. Merging two timepoints that are genuinely
 * different yields a plot with MORE studies in it and no visible defect at all.
 * So the merge tests below are as much about what must NOT merge as what must.
 */

import {
  canonicalValue,
  classifyScaleDirection,
  EXCLUDE,
  harmonizationIsActive,
  KEEP,
  normalizeDuration,
  shouldFlipSign,
  suggestDirections,
  suggestHarmonization,
  tallyScales,
  tallyValues,
} from '../../app/(dashboard)/synthesis/_lib/reconcile.ts';
import {
  funnelAndEgger,
  leaveOneOut,
  MIN_ASYMMETRY_TEST,
  MIN_LEAVE_ONE_OUT,
  subgroupAnalysis,
} from '../../app/(dashboard)/synthesis/_lib/diagnostics.ts';
import {
  runMetaAnalysis,
  type BinaryArm,
  type ContinuousArm,
  type MetaStudy,
} from '../metaAnalysis.ts';

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

function close(name: string, actual: number, expected: number, tol: number): void {
  check(name, Number.isFinite(actual) && Math.abs(actual - expected) <= tol,
    `expected ${expected}, got ${actual}`);
}

const binary = (key: string, e1: number, n1: number, e2: number, n2: number,
                extra: Partial<MetaStudy> = {}): MetaStudy => ({
  key, label: key, documentId: `doc-${key}`,
  treatment: { events: e1, total: n1 } as BinaryArm,
  comparator: { events: e2, total: n2 } as BinaryArm,
  ...extra,
});

const cont = (key: string, m1: number, s1: number, n1: number,
              m2: number, s2: number, n2: number,
              extra: Partial<MetaStudy> = {}): MetaStudy => ({
  key, label: key, documentId: `doc-${key}`,
  treatment: { mean: m1, sd: s1, n: n1 } as ContinuousArm,
  comparator: { mean: m2, sd: s2, n: n2 } as ContinuousArm,
  ...extra,
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Duration normalization — strict on purpose
// ─────────────────────────────────────────────────────────────────────────────
{
  for (const [text, minutes] of [
    ['6 hours', 360], ['6 hrs', 360], ['6 hr', 360], ['6h', 360], ['6 h', 360],
    ['360 minutes', 360], ['360 min', 360], ['1 day', 1440], ['24 hours', 1440],
    ['2 weeks', 20160], ['1.5 hours', 90], ['6 HOURS', 360], ['6 hours.', 360],
  ] as const) {
    close(`"${text}" normalizes`, normalizeDuration(text) ?? NaN, minutes, 1e-9);
  }

  // Everything a merge would destroy must refuse to normalize.
  for (const text of [
    'up to 24 hours',   // a window, not a point
    '6-8 hours',        // a range
    '6 to 8 hours',
    'day 1',            // ordinal, not a duration
    '6',                // no unit at all
    'baseline',
    'end of treatment',
    'NR',
    '',
    '6 fortnights',     // unknown unit
  ]) {
    check(`"${text}" refuses to normalize`, normalizeDuration(text) === null,
      String(normalizeDuration(text)));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Harmonization suggests merges only on equal duration
// ─────────────────────────────────────────────────────────────────────────────
{
  const values = [
    { raw: '6 hours', rows: 31, documents: 20 },
    { raw: '6 hrs', rows: 4, documents: 4 },
    { raw: '360 minutes', rows: 2, documents: 2 },
    { raw: '24 hours', rows: 8, documents: 7 },
    { raw: '8 hours', rows: 5, documents: 5 },
    { raw: 'up to 24 hours', rows: 3, documents: 3 },
  ];
  const { choices, reasons } = suggestHarmonization(values);

  check('the commonest spelling becomes canonical', choices['6 hours'] === KEEP);
  check('"6 hrs" merges into "6 hours"', choices['6 hrs'] === '6 hours', choices['6 hrs']);
  check('"360 minutes" merges into "6 hours"', choices['360 minutes'] === '6 hours',
    choices['360 minutes']);
  // The whole point of the exercise:
  check('"8 hours" NEVER merges', choices['8 hours'] === KEEP, choices['8 hours']);
  check('"24 hours" NEVER merges', choices['24 hours'] === KEEP, choices['24 hours']);
  check('"up to 24 hours" is left alone', choices['up to 24 hours'] === KEEP,
    choices['up to 24 hours']);
  check('a non-normalizing value gets no suggestion', !('up to 24 hours' in reasons));
  check('only the merges carry a reason', Object.keys(reasons).length === 2,
    JSON.stringify(Object.keys(reasons)));
  check('the reason names the target', reasons['6 hrs'].includes('6 hours'), reasons['6 hrs']);

  // Nothing to merge ⇒ nothing suggested at all.
  const distinct = suggestHarmonization([
    { raw: '6 hours', rows: 3, documents: 3 },
    { raw: '12 hours', rows: 3, documents: 3 },
  ]);
  check('distinct durations produce no suggestions',
    Object.keys(distinct.reasons).length === 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. A suggestion is INERT until confirmed
// ─────────────────────────────────────────────────────────────────────────────
{
  const choices = { '6 hrs': '6 hours', '6 hours': KEEP, 'bad row': EXCLUDE };

  check('an unconfirmed merge does nothing',
    canonicalValue('6 hrs', choices, {}) === '6 hrs');
  check('a confirmed merge applies',
    canonicalValue('6 hrs', choices, { '6 hrs': true }) === '6 hours');
  check('an unconfirmed exclusion does nothing',
    canonicalValue('bad row', choices, {}) === 'bad row');
  check('a confirmed exclusion removes the row',
    canonicalValue('bad row', choices, { 'bad row': true }) === null);
  check('KEEP passes the raw value through',
    canonicalValue('6 hours', choices, { '6 hours': true }) === '6 hours');
  check('an unknown value passes through untouched',
    canonicalValue('never seen', choices, {}) === 'never seen');

  check('nothing is active before confirmation', !harmonizationIsActive(choices, {}));
  check('one confirmation activates it',
    harmonizationIsActive(choices, { '6 hrs': true }));
  check('confirming a KEEP does not count as active',
    !harmonizationIsActive({ a: KEEP }, { a: true }));
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Value tallies count rows and documents separately
// ─────────────────────────────────────────────────────────────────────────────
{
  const rows = [
    { _documentId: 'd1', t: '6 hours' },
    { _documentId: 'd1', t: '6 hours' },
    { _documentId: 'd2', t: '6 hours' },
    { _documentId: 'd3', t: '' },
    { _documentId: 'd4', t: '24 hours' },
  ];
  const tally = tallyValues(rows, 't');
  check('blank values are not tallied', tally.length === 2, JSON.stringify(tally));
  check('the commonest sorts first', tally[0].raw === '6 hours');
  check('rows are counted', tally[0].rows === 3, String(tally[0].rows));
  check('documents are counted separately', tally[0].documents === 2, String(tally[0].documents));
  check('no column yields nothing', tallyValues(rows, null).length === 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Effect direction
// ─────────────────────────────────────────────────────────────────────────────
{
  check('a pain scale reads as higher-is-worse',
    classifyScaleDirection('VAS pain 0-100') === 'worse');
  check('an improvement scale reads as higher-is-better',
    classifyScaleDirection('Global improvement 1-7') === 'better');
  // "pain relief" contains both cues — refusing to guess is the right answer.
  check('an ambiguous name is not guessed',
    classifyScaleDirection('pain relief score') === 'unknown');
  check('an unrecognised name is not guessed',
    classifyScaleDirection('Wong-Baker FACES') === 'unknown');

  const scales = tallyScales([
    { raw: 'VAS pain 0-100', rows: 18, documents: 18 },
    { raw: 'SF-MPQ pain total', rows: 5, documents: 5 },
    { raw: 'Global improvement 1-7', rows: 3, documents: 3 },
    { raw: 'Wong-Baker FACES', rows: 2, documents: 2 },
  ]);
  const { choices, reasons, reference } = suggestDirections(scales);
  check('the majority polarity becomes the reference', reference === 'worse', reference);
  check('majority scales are used as-is', choices['VAS pain 0-100'] === 'use');
  check('the minority scale is proposed for reversal',
    choices['Global improvement 1-7'] === 'reverse', choices['Global improvement 1-7']);
  check('an unknown scale is never flipped on a guess',
    choices['Wong-Baker FACES'] === 'use', choices['Wong-Baker FACES']);
  check('only the reversal carries a reason', Object.keys(reasons).length === 1,
    JSON.stringify(Object.keys(reasons)));

  // All one direction ⇒ nothing to reconcile.
  const aligned = suggestDirections(tallyScales([
    { raw: 'VAS pain', rows: 5, documents: 5 },
    { raw: 'severity index', rows: 3, documents: 3 },
  ]));
  check('an already-aligned set suggests nothing',
    Object.keys(aligned.reasons).length === 0);

  check('an unconfirmed reversal is inert', !shouldFlipSign('Global improvement 1-7', choices, {}));
  check('a confirmed reversal applies',
    shouldFlipSign('Global improvement 1-7', choices, { 'Global improvement 1-7': true }));
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. flipSign negates the effect and mirrors the interval, leaving weight alone
// ─────────────────────────────────────────────────────────────────────────────
{
  const plain = runMetaAnalysis([cont('A', 10, 2, 25, 8, 2, 25)], 'MD', 'fixed').studies[0];
  const flipped = runMetaAnalysis(
    [cont('A', 10, 2, 25, 8, 2, 25, { flipSign: true })], 'MD', 'fixed',
  ).studies[0];

  close('the estimate is negated', flipped.est, -plain.est, 1e-12);
  close('the interval mirrors (lower)', flipped.lo, -plain.hi, 1e-12);
  close('the interval mirrors (upper)', flipped.hi, -plain.lo, 1e-12);
  close('the variance is untouched', flipped.v, plain.v, 1e-12);
  close('the weight is untouched', flipped.weightPct, plain.weightPct, 1e-12);

  // Flipping one of two opposed studies makes them agree instead of cancelling.
  const opposed = [
    cont('up', 10, 2, 30, 8, 2, 30),
    cont('down', 8, 2, 30, 10, 2, 30),
    cont('up2', 10, 2, 30, 8, 2, 30),
  ];
  const cancelled = runMetaAnalysis(opposed, 'MD', 'fixed');
  const reconciled = runMetaAnalysis(
    opposed.map(s => (s.key === 'down' ? { ...s, flipSign: true } : s)), 'MD', 'fixed',
  );
  check('opposed scales dilute the estimate',
    Math.abs(cancelled.pooled!.est) < Math.abs(reconciled.pooled!.est),
    `${cancelled.pooled!.est} vs ${reconciled.pooled!.est}`);
  close('reconciled studies agree exactly', reconciled.pooled!.est, 2, 1e-12);
  check('and heterogeneity collapses',
    reconciled.heterogeneity!.i2 < cancelled.heterogeneity!.i2);
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Leave-one-out
// ─────────────────────────────────────────────────────────────────────────────
{
  const identical = [1, 2, 3, 4, 5].map(i => binary(`S${i}`, 40, 100, 20, 100));
  const loo = leaveOneOut(identical, 'RR', 'random')!;
  check('leave-one-out runs at k=5', loo !== null);
  check('a row per study', loo.rows.length === 5);
  for (const r of loo.rows) {
    close(`omitting ${r.label} does not move identical studies`, r.shift, 0, 1e-9);
    close(`...and the estimate holds`, r.est!, loo.baseline.est, 1e-9);
  }

  // One outlier must be flagged as the most influential.
  const withOutlier = [
    binary('A', 40, 100, 20, 100),
    binary('B', 41, 100, 21, 100),
    binary('C', 39, 100, 19, 100),
    binary('Outlier', 10, 100, 60, 100),
  ];
  const flagged = leaveOneOut(withOutlier, 'RR', 'random')!;
  check('the outlier is flagged', flagged.mostInfluentialLabel === 'Outlier',
    String(flagged.mostInfluentialLabel));
  check('exactly one row is flagged',
    flagged.rows.filter(r => r.mostInfluential).length === 1);
  // Removing the outlier should also collapse heterogeneity.
  const outlierRow = flagged.rows.find(r => r.label === 'Outlier')!;
  const otherRow = flagged.rows.find(r => r.label === 'A')!;
  check('omitting the outlier lowers I2', outlierRow.i2! < otherRow.i2!,
    `${outlierRow.i2} vs ${otherRow.i2}`);

  // Each row must equal a direct pooling of the remaining studies — the table
  // and the plot must never be able to disagree.
  const direct = runMetaAnalysis(withOutlier.filter(s => s.key !== 'Outlier'), 'RR', 'random');
  close('a row equals pooling the rest directly', outlierRow.est!, direct.pooled!.est, 1e-12);

  check('leave-one-out is suppressed below the threshold',
    leaveOneOut(withOutlier.slice(0, MIN_LEAVE_ONE_OUT - 1), 'RR', 'random') === null);
  check('...and MIN_LEAVE_ONE_OUT is above MIN_POOLABLE', MIN_LEAVE_ONE_OUT === 4);
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. Subgroups
// ─────────────────────────────────────────────────────────────────────────────
{
  const same = [
    binary('a1', 40, 100, 20, 100, { evidence: { g: 'X' } }),
    binary('a2', 40, 100, 20, 100, { evidence: { g: 'X' } }),
    binary('a3', 40, 100, 20, 100, { evidence: { g: 'X' } }),
    binary('b1', 40, 100, 20, 100, { evidence: { g: 'Y' } }),
    binary('b2', 40, 100, 20, 100, { evidence: { g: 'Y' } }),
    binary('b3', 40, 100, 20, 100, { evidence: { g: 'Y' } }),
  ];
  const g = (s: MetaStudy) => String((s.evidence as any)?.g ?? '');
  const identicalGroups = subgroupAnalysis(same, 'RR', 'random', g);
  check('both groups pool', identicalGroups.rows.length === 2
    && identicalGroups.rows.every(r => r.poolable));
  close('identical subgroups give Q_between = 0', identicalGroups.test!.q, 0, 1e-9);
  check('...and df = G - 1', identicalGroups.test!.df === 1);
  close('...and p = 1', identicalGroups.test!.p, 1, 1e-6);

  const different = [
    binary('a1', 80, 100, 20, 100, { evidence: { g: 'X' } }),
    binary('a2', 78, 100, 21, 100, { evidence: { g: 'X' } }),
    binary('a3', 82, 100, 19, 100, { evidence: { g: 'X' } }),
    binary('b1', 22, 100, 20, 100, { evidence: { g: 'Y' } }),
    binary('b2', 21, 100, 21, 100, { evidence: { g: 'Y' } }),
    binary('b3', 20, 100, 19, 100, { evidence: { g: 'Y' } }),
  ];
  const split = subgroupAnalysis(different, 'RR', 'random', g);
  check('separated subgroups give a large Q', split.test!.q > 10, String(split.test!.q));
  check('...and a small p', split.test!.p < 0.01, String(split.test!.p));

  // A group too small to pool is listed, not dropped.
  const lopsided = subgroupAnalysis([
    ...same.slice(0, 3),
    binary('lonely', 40, 100, 20, 100, { evidence: { g: 'Z' } }),
  ], 'RR', 'random', g);
  check('an unpoolable group is still listed', lopsided.rows.length === 2);
  check('...and marked unpoolable', lopsided.unpoolable === 1);
  check('...with its study count intact',
    lopsided.rows.find(r => r.name === 'Z')!.k === 1);
  check('...and contributes no test', lopsided.test === null);
  // Every study must appear in exactly one group.
  check('subgroups account for every study',
    lopsided.rows.reduce((a, r) => a + r.k, 0) === 4);

  const missing = subgroupAnalysis(
    [binary('x', 40, 100, 20, 100)], 'RR', 'random', () => '',
  );
  check('a blank group value is labelled, not dropped',
    missing.rows[0].name === '(not reported)', missing.rows[0].name);
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. Funnel plot and Egger's test
// ─────────────────────────────────────────────────────────────────────────────
{
  // A symmetric funnel: same effect at every precision.
  const symmetric = [
    binary('big1', 400, 1000, 200, 1000),
    binary('big2', 401, 1000, 201, 1000),
    binary('mid1', 40, 100, 20, 100),
    binary('mid2', 41, 100, 21, 100),
    binary('small1', 8, 20, 4, 20),
    binary('small2', 9, 20, 5, 20),
  ];
  const symResult = runMetaAnalysis(symmetric, 'RR', 'random');
  const sym = funnelAndEgger(symResult);
  check('a point per study', sym.points.length === 6);
  check('the widest SE sets the axis', sym.maxSe > Math.max(...sym.points.map(p => p.se)));
  check('the pseudo-CI is centred on the pooled estimate',
    Math.abs(sym.pseudo!.apex - symResult.pooled!.est) < 1e-9);
  check('the pseudo-CI widens both ways',
    sym.pseudo!.lo < sym.pseudo!.apex && sym.pseudo!.apex < sym.pseudo!.hi);
  check('a symmetric funnel gives a small Egger intercept',
    Math.abs(sym.egger!.intercept) < 1, String(sym.egger!.intercept));

  // An asymmetric funnel: the small studies report much larger effects.
  const asymmetric = [
    binary('big1', 400, 1000, 380, 1000),
    binary('big2', 401, 1000, 379, 1000),
    binary('mid1', 45, 100, 40, 100),
    binary('mid2', 44, 100, 41, 100),
    binary('small1', 16, 20, 5, 20),
    binary('small2', 17, 20, 4, 20),
  ];
  const asym = funnelAndEgger(runMetaAnalysis(asymmetric, 'RR', 'random'));
  check('an asymmetric funnel gives a larger intercept',
    Math.abs(asym.egger!.intercept) > Math.abs(sym.egger!.intercept),
    `${asym.egger!.intercept} vs ${sym.egger!.intercept}`);

  // The gate is the point: six studies is not enough to read this.
  check('Egger is not interpretable below the threshold',
    sym.egger!.interpretable === false);
  check('...and the threshold is 10', MIN_ASYMMETRY_TEST === 10);

  const twelve = Array.from({ length: 12 }, (_, i) =>
    binary(`S${i}`, 40 + i, 100, 20, 100));
  const big = funnelAndEgger(runMetaAnalysis(twelve, 'RR', 'random'));
  check('Egger becomes interpretable at 12 studies', big.egger!.interpretable === true);

  // Too few studies for a regression at all.
  const tiny = funnelAndEgger(runMetaAnalysis(symmetric.slice(0, 2), 'RR', 'random'));
  check('two studies yield no Egger test', tiny.egger === null);
  check('...but still yield funnel points', tiny.points.length === 2);
  check('...and no pseudo-CI without a pooled estimate', tiny.pseudo === null);
}

// ── Report ───────────────────────────────────────────────────────────────────

if (failures.length > 0) {
  console.error(`\n  ${failures.length} FAILED of ${passed + failures.length}:\n`);
  for (const f of failures) console.error(`   x ${f}`);
  console.error('');
  process.exit(1);
}

console.log(`\n  diagnostics.ts + reconcile.ts — ${passed} checks passed\n`);

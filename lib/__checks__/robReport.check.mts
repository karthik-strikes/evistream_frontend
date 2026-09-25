/**
 * Self-check for the Risk of Bias Review summary: agreement statistics, the
 * CSV exports and the two SVG figures.
 *
 *   node --experimental-strip-types --import ./lib/__checks__/register-alias.mjs \
 *        lib/__checks__/robReport.check.mts
 *
 * Kappa is pinned against a PUBLISHED worked example rather than against
 * itself: the classic three-category diagnosis example in Fleiss, *Statistical
 * Methods for Rates and Proportions* (Fleiss 1981; Fleiss, Levin & Paik 2003,
 * ch. 18) — two raters classifying 100 subjects as psychotic / neurotic /
 * organic, κ = 0.68. The linear-weighted
 * value for the same table (0.7222) was worked by hand from the weights
 * 1, ½, 0 and cross-checked with scikit-learn's `cohen_kappa_score(...,
 * weights='linear')`, which gives 0.722222.
 *
 * The edge cases are the ones that would be wrong SILENTLY: kappa printed as 0
 * or 1 when it is undefined, a statistic reported from one pair, a hedge
 * ("Probably yes") counted as disagreeing with "Yes" in the lenient figure, a
 * rationale beginning with "=" run as a spreadsheet formula, and an ampersand
 * in a study label that makes the SVG unopenable.
 */

import {
  CATEGORY, collapseAnswer, csvCell, distribution, formatKappa, interRater, kappaFromPairs,
  kappaFromTable, kappaStrength, longCsv, signallingText, toCsv, wideCsv,
  type AgreementSide, type ReportRow,
} from '../../app/(dashboard)/risk-of-bias/_lib/robReport.ts';
import { marker, summaryBarsSvg, trafficLightSvg } from '../../app/(dashboard)/risk-of-bias/_lib/robFigures.ts';
import { EMPTY_D1, emptyAssessment, type Assessment, type Judgement } from '../../app/(dashboard)/risk-of-bias/_lib/robModel.ts';

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

const near = (a: number | null, b: number, tol = 1e-4) => a !== null && Math.abs(a - b) < tol;

// ─────────────────────────────────────────────────────────────────────────────
// 1. Kappa against the published worked example
// ─────────────────────────────────────────────────────────────────────────────
{
  const fleiss = [
    [75, 1, 4],
    [5, 4, 1],
    [0, 0, 10],
  ];
  const k = kappaFromTable(fleiss);
  check('Fleiss table: n = 100', k.n === 100);
  check('Fleiss table: observed agreement .89', near(k.agreement, 0.89));
  // p_e = .80·.80 + .10·.05 + .10·.15 = .66; κ = (.89 − .66) / .34
  check('Fleiss table: κ = 0.6765 (published .68)', near(k.kappa, 0.23 / 0.34), String(k.kappa));
  check('Fleiss table: linear-weighted κ = 0.7222', near(k.weightedKappa, 0.195 / 0.27), String(k.weightedKappa));

  // The same table as pairs gives the same numbers.
  const pairs: Array<[number, number]> = [];
  fleiss.forEach((row, i) => row.forEach((c, j) => { for (let x = 0; x < c; x++) pairs.push([i, j]); }));
  const kp = kappaFromPairs(pairs);
  check('pairs and table agree', near(kp.kappa, k.kappa!) && near(kp.weightedKappa, k.weightedKappa!));
  // Kappa does not care which reviewer is called A.
  const flipped = kappaFromPairs(pairs.map(([a, b]) => [b, a]));
  check('kappa is symmetric in the two raters', near(flipped.kappa, k.kappa!) && near(flipped.weightedKappa, k.weightedKappa!));
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Edge cases
// ─────────────────────────────────────────────────────────────────────────────
{
  const perfect = kappaFromPairs([[0, 0], [1, 1], [2, 2], [0, 0]]);
  check('perfect agreement over several categories: κ = 1', near(perfect.kappa, 1) && near(perfect.weightedKappa, 1));
  check('perfect agreement: 100%', near(perfect.agreement, 1));

  // Both said Low every time: p_o = p_e = 1, κ = 0/0.
  const oneCat = kappaFromPairs([[0, 0], [0, 0], [0, 0]]);
  check('all one category: κ undefined, not 0 or 1', oneCat.kappa === null && oneCat.weightedKappa === null);
  check('all one category: agreement still 100%', near(oneCat.agreement, 1));
  check('undefined kappa prints as —', formatKappa(oneCat.kappa) === '—');

  const empty = kappaFromPairs([]);
  check('no pairs: nothing reported', empty.n === 0 && empty.kappa === null && empty.agreement === null);

  // Systematic disagreement is worse than chance.
  const opposite = kappaFromPairs([[0, 2], [2, 0], [0, 2], [2, 0]]);
  check('opposite judgements: κ < 0', opposite.kappa !== null && opposite.kappa < 0);
  check('opposite judgements read as Poor', kappaStrength(opposite.kappa) === 'Poor');

  // With two categories the linear weights are 1/0, so weighted = unweighted.
  const two = kappaFromPairs([[0, 0], [0, 1], [1, 1], [1, 1], [1, 0], [0, 0]], 2);
  check('k = 2: weighted κ equals unweighted', near(two.weightedKappa, two.kappa!));

  // Adjacent disagreements earn partial credit; far ones do not.
  const adjacent = kappaFromPairs([[0, 1], [1, 2], [0, 0], [1, 1], [2, 2]]);
  const far = kappaFromPairs([[0, 2], [2, 0], [0, 0], [1, 1], [2, 2]]);
  check('near misses weigh less than far misses', adjacent.weightedKappa! > far.weightedKappa!);

  check('Landis & Koch bands',
    kappaStrength(0.1) === 'Slight' && kappaStrength(0.3) === 'Fair' && kappaStrength(0.5) === 'Moderate'
    && kappaStrength(0.7) === 'Substantial' && kappaStrength(0.9) === 'Almost perfect'
    && kappaStrength(0.2) === 'Slight' && kappaStrength(0.8) === 'Substantial' && kappaStrength(null) === '');
  check('category order is Low < Some < High', CATEGORY.low < CATEGORY.some && CATEGORY.some < CATEGORY.high);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Agreement over assessments
// ─────────────────────────────────────────────────────────────────────────────

function assessment(id: string, js: Array<Judgement | null>, overall: Judgement | null, answers: Record<string, string> = {}): Assessment {
  const a = emptyAssessment({ id, kind: 'result' }, 'assignment', []);
  a.judgement = js.slice(0, 5);
  a.overall = overall;
  a.answers = answers as Assessment['answers'];
  a.complete = true;
  return a;
}

const side = (a: Assessment, d1Answers: Record<string, string> = {}): AgreementSide =>
  ({ entry: a, d1: { ...EMPTY_D1, answers: d1Answers as AgreementSide['d1']['answers'] } });

{
  check('Y≡PY, N≡PN, NI stays itself',
    collapseAnswer('PY') === 'Y' && collapseAnswer('PN') === 'N' && collapseAnswer('NI') === 'NI' && collapseAnswer('Y') === 'Y');

  const single = interRater([[side(assessment('r1', ['low', 'low', 'low', 'low', 'low'], 'low')),
    side(assessment('r1', ['low', 'low', 'low', 'low', 'low'], 'low'))]]);
  check('one pair: not enough pairs, nothing reported',
    single.every(d => d.n === 1 && d.kappa === null && d.agreement === null && d.strength === ''));

  const pairs: Array<[AgreementSide, AgreementSide]> = [
    [side(assessment('a', ['low', 'some', 'low', 'low', 'high'], 'high', { '2.1': 'Y', '2.2': 'PN' }), { '1.1': 'Y', '1.2': 'Y', '1.3': 'N' }),
      side(assessment('a', ['low', 'some', 'some', 'low', 'high'], 'high', { '2.1': 'PY', '2.2': 'N' }), { '1.1': 'Y', '1.2': 'PY', '1.3': 'N' })],
    [side(assessment('b', ['some', 'low', null, 'low', 'low'], 'some'), { '1.1': 'Y' }),
      side(assessment('b', ['some', 'low', 'low', 'high', 'low'], 'high'), { '1.1': 'NI' })],
    [side(assessment('c', ['low', 'low', 'low', 'low', 'low'], 'low')),
      side(assessment('c', ['low', 'low', 'low', 'low', 'low'], 'low'))],
  ];
  const stats = interRater(pairs);
  check('six rows: D1–D5 + Overall', stats.length === 6 && stats[5].domain === 5);
  check('D1: 3 pairs, all agree', stats[0].n === 3 && near(stats[0].agreement, 1));
  check('a domain one reviewer left empty drops out of that domain only', stats[2].n === 2 && stats[3].n === 3);
  check('D4: 2 of 3 agree', near(stats[3].agreement, 2 / 3));
  check('Overall: 2 of 3 agree', near(stats[5].agreement, 2 / 3));
  // D1 signalling: pair a 1.1 Y/Y, 1.2 Y/PY, 1.3 N/N; pair b 1.1 Y/NI → 4 compared.
  check('D1 signalling counts questions both answered', stats[0].signalling.n === 4, String(stats[0].signalling.n));
  check('D1 signalling exact = 2/4', near(stats[0].signalling.exact, 0.5));
  check('D1 signalling lenient = 3/4 (Y≡PY, but Y vs NI still differs)', near(stats[0].signalling.collapsed, 0.75));
  check('D2 signalling: hedges agree leniently, not exactly',
    stats[1].signalling.n === 2 && near(stats[1].signalling.exact, 0) && near(stats[1].signalling.collapsed, 1));
  check('Overall has no signalling questions', stats[5].signalling.n === 0 && stats[5].signalling.exact === null);
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. CSV
// ─────────────────────────────────────────────────────────────────────────────

function row(over: Partial<ReportRow> = {}): ReportRow {
  return {
    documentId: 'doc1', studyLabel: 'Smith & Jones 2019', citation: 'A "quoted", title', targetId: 't1',
    kind: 'result', title: 'Pain · 24 weeks · Drug A vs Placebo', outcome: 'Pain', measurement: 'VAS',
    timepoint: '24 weeks', analysisPopulation: 'ITT', analysis: 'ANCOVA', comparison: 'Drug A vs Placebo',
    effect: 'assignment', domains: [null, null, null, null, null], overall: null, entry: null, d1: null,
    source: 'Final', reviewer: '', status: 'Not assessed', complete: false, completedAt: null, ...over,
  };
}

{
  check('CSV quotes commas and doubles quotes', csvCell('a, "b"') === '"a, ""b"""');
  check('CSV defuses a formula', csvCell('=SUM(A1)') === "'=SUM(A1)" && csvCell('+1') === "'+1");
  check('CSV leaves a hyphen alone', csvCell('-2') === '-2');
  const csv = toCsv(['a'], [['é']]);
  check('CSV starts with a UTF-8 BOM', csv.charCodeAt(0) === 0xfeff);
  check('CSV uses CRLF', csv.includes('\r\n'));

  const entry = assessment('t1', ['low', 'some', 'low', 'low', 'high'], 'high', { '2.1': 'Y', '2.2': 'N' });
  entry.rationale[4] = '=not a formula';
  entry.support = { '2.1': 'Open label' };
  entry.quotes = { '2.1': { quote: 'Participants were aware', locator: '4' } };
  const d1 = { ...EMPTY_D1, answers: { '1.1': 'Y', '1.2': 'PY', '1.3': 'N' } as AgreementSide['d1']['answers'] };
  const judged = row({ entry, d1, domains: [...entry.judgement], overall: 'high', complete: true, completedAt: '2026-09-20T10:00:00Z', status: 'Complete' });
  const long = longCsv([judged, row()]);
  const lines = long.replace(/^﻿/, '').trim().split('\r\n');
  check('long CSV: 6 lines per target + header', lines.length === 1 + 12, String(lines.length));
  check('long CSV: D1 signalling answers', long.includes('1.1=Y; 1.2=PY; 1.3=N'));
  check('long CSV: quote with page', long.includes('2.1: ""Participants were aware"" (p. 4)'));
  check('long CSV: support text', long.includes('2.1: Open label'));
  check('long CSV: rationale formula defused', long.includes("'=not a formula"));
  check('long CSV: completion date', long.includes('2026-09-20'));
  check('long CSV: an Overall line per target', lines.filter(l => l.includes(',Overall,')).length === 2);
  // 2.1 = N and 2.2 = N route 2.3 out (asked only if Y/PY/NI to 2.1 or 2.2).
  const routed = assessment('t9', [null, null, null, null, null], null, { '2.1': 'N', '2.2': 'N' });
  check('signalling text marks routed-out questions NA', signallingText(routed, d1, 1).includes('2.3=NA'), signallingText(routed, d1, 1));
  check('signalling text marks unanswered asked questions —', signallingText(entry, d1, 1).includes('2.3=—'), signallingText(entry, d1, 1));

  const wide = wideCsv([judged, row()]);
  const wlines = wide.replace(/^﻿/, '').trim().split('\r\n');
  check('wide CSV: one line per target', wlines.length === 3);
  check('wide CSV: D1..D5 + Overall columns', wlines[0].includes('D1,D2,D3,D4,D5,Overall'));
  check('wide CSV: judgement words', wlines[1].includes('Low risk of bias,Some concerns,Low risk of bias,Low risk of bias,High risk of bias,High risk of bias'));
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Figures
// ─────────────────────────────────────────────────────────────────────────────
{
  const rows = [
    row({ domains: ['low', 'some', 'high', null, 'low'], overall: 'high' }),
    row({ targetId: 't2', title: 'Nausea', domains: ['low', 'low', 'low', 'low', 'low'], overall: 'low' }),
    row({ documentId: 'doc2', studyLabel: 'Polat 2005b', targetId: 't3' }),
  ];
  const tl = trafficLightSvg(rows, { targetHeading: 'Result', footer: 'RoB 2 · Final' });
  check('traffic light escapes ampersands', tl.svg.includes('Smith &amp; Jones') && !tl.svg.includes('Smith & Jones'));
  check('traffic light draws no NaN', !tl.svg.includes('NaN'));
  check('traffic light: 18 markers + 4 legend markers', (tl.svg.match(/<circle/g) ?? []).length === 22);
  check('traffic light has positive size', tl.width > 0 && tl.height > 0);
  check('no amber/yellow/orange in the figure', !/#(fffbeb|fde68a|fcd34d|fef3c7|f59e0b|d97706|b45309|92400e|78350f)|amber|yellow|orange/i.test(tl.svg));
  check('Some concerns marker is slate', marker(0, 0, 'some').includes('#64748b'));
  check('Low marker carries a vertical stroke (+)', (marker(0, 0, 'low').match(/<line/g) ?? []).length === 2);
  check('Some marker carries one stroke (−)', (marker(0, 0, 'some').match(/<line/g) ?? []).length === 1);
  check('Not judged marker is hollow', marker(0, 0, null).includes('fill="#ffffff"') && !marker(0, 0, null).includes('<line'));

  const dist = distribution(rows);
  check('distribution: n = targets, per domain', dist.every(d => d.n === 3 && d.low + d.some + d.high + d.none === 3));
  check('distribution: Overall counts', dist[5].high === 1 && dist[5].low === 1 && dist[5].none === 1);
  const bars = summaryBarsSvg(dist, { footer: 'Unweighted' });
  check('bars draw no NaN', !bars.svg.includes('NaN'));
  check('bars label n', bars.svg.includes('n = 3'));
  const emptyBars = summaryBarsSvg(distribution([]), { footer: '' });
  check('bars with no rows draw no NaN', !emptyBars.svg.includes('NaN'));
}

// ── Report ───────────────────────────────────────────────────────────────────

if (failures.length > 0) {
  console.error(`\n  ${failures.length} FAILED of ${passed + failures.length}:\n`);
  for (const f of failures) console.error(`   x ${f}`);
  console.error('');
  process.exit(1);
}

console.log(`\n  RoB 2 review summary (kappa, CSV, figures) — ${passed} checks passed\n`);

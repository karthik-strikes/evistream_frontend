/**
 * Self-check for the judgment-support layer: the plain-English reading, the
 * methods panel's selection of formulas, per-trial fragility, and the design
 * guards.
 *
 *   node --experimental-strip-types --import ./lib/__checks__/register-alias.mjs \
 *        lib/__checks__/phase3.check.mts
 *
 * These three are prose and policy rather than arithmetic, which makes them EASIER
 * to get quietly wrong: a sentence that says "no effect" instead of "compatible
 * with no effect", a methods panel advertising a between-study variance the
 * analysis never estimated, a guard that stays silent when it could not run. Each
 * of those is checked here as a claim about the output text, not as a snapshot.
 */

import {
  describeAbsolute, runMetaAnalysis, type BinaryArm, type MetaStudy,
} from '../metaAnalysis.ts';
import { plainReading } from '../../app/(dashboard)/synthesis/_lib/plainReading.ts';
import { methodsFormulas, methodsNotation } from '../../app/(dashboard)/synthesis/_lib/methodsText.ts';
import {
  fisherExactTwoSidedP, fragilityOf, fragilitySummary, fragilityTable,
} from '../../app/(dashboard)/synthesis/_lib/fragility.ts';
import {
  classifyDesign, designGuards, type DesignCategory,
} from '../../app/(dashboard)/synthesis/_lib/designGuards.ts';

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

const binary = (key: string, e1: number, n1: number, e2: number, n2: number): MetaStudy => ({
  key, label: key, documentId: `doc-${key}`,
  treatment: { events: e1, total: n1 } as BinaryArm,
  comparator: { events: e2, total: n2 } as BinaryArm,
});

const CTX = { outcomeLabel: 'Implant failure', comparisonLabel: 'Immediate vs delayed' };
const text = (r: Parameters<typeof plainReading>[0]) => plainReading(r, CTX).join(' ');

// ─────────────────────────────────────────────────────────────────────────────
// 1. The reading must not overstate
// ─────────────────────────────────────────────────────────────────────────────
{
  // An interval spanning the null.
  const straddles = runMetaAnalysis(
    [binary('A', 19, 100, 20, 100), binary('B', 21, 100, 20, 100), binary('C', 20, 100, 20, 100)],
    'RR', 'random',
  );
  const t = text(straddles);
  check('a null-spanning interval is called compatible with no effect',
    t.includes('compatible with no effect'));
  check('and never asserts there is none',
    !/\bno effect\.|\bshows no effect|\bno difference between/.test(t), t.slice(0, 160));
  check('and says so explicitly', t.includes('not the same as evidence that there is none'));

  // A clear effect.
  const clear = runMetaAnalysis(
    [binary('A', 10, 100, 30, 100), binary('B', 12, 100, 32, 100), binary('C', 8, 100, 28, 100)],
    'RR', 'random',
  );
  const c = text(clear);
  check('a decisive interval is reported as excluding no difference',
    c.includes('excludes no difference'));
  check('a risk ratio is restated as a percentage change', /\d+% lower/.test(c), c.slice(0, 200));
  check('the measure and interval are both given', /Risk Ratio 0\.\d+, 95% CI/.test(c));

  // An odds ratio must NOT be restated as a change in risk.
  const or = runMetaAnalysis(
    [binary('A', 10, 100, 30, 100), binary('B', 12, 100, 32, 100), binary('C', 8, 100, 28, 100)],
    'OR', 'random',
  );
  const o = text(or);
  check('an odds ratio talks about odds', o.includes('odds of'));
  check('and is not converted to a risk change', !/% lower \(Odds/.test(o), o.slice(0, 200));

  // Below the pooling floor, and with nothing at all.
  const two = runMetaAnalysis([binary('A', 10, 100, 30, 100), binary('B', 12, 100, 32, 100)], 'RR', 'random');
  const twoText = text(two);
  check('two studies produce no pooled sentence', twoText.includes('fewer than the 3'));
  check('and say why that is deliberate', twoText.includes('more authority than it earns'));
  check('an empty analysis is explained',
    text(runMetaAnalysis([], 'RR', 'random')).includes('Nothing was pooled'));

  // A refusal is reported as such rather than silently omitted.
  const refused = runMetaAnalysis(
    [binary('A', 10, 100, 30, 100), binary('B', 12, 100, 32, 100), binary('C', 8, 100, 28, 100)],
    'RR', 'peto',
  );
  check('a refused method is stated in the reading',
    text(refused).includes('No pooled estimate was produced'));

  // Heterogeneity, prediction interval and small-k caveats appear only when due.
  const heterogeneous = runMetaAnalysis(
    [binary('A', 10, 100, 30, 100), binary('B', 40, 100, 20, 100), binary('C', 25, 100, 24, 100)],
    'RR', 'random',
  );
  const h = text(heterogeneous);
  check('substantial heterogeneity is named', /Heterogeneity was (substantial|considerable)/i.test(h));
  check('and its consequence spelled out', h.includes('describes them loosely'));
  check('the prediction interval is explained as such',
    h.includes('A future study in a similar population'));
  check('a small corpus is flagged', h.includes('estimated imprecisely'));

  const fixed = runMetaAnalysis(
    [binary('A', 10, 100, 30, 100), binary('B', 12, 100, 32, 100), binary('C', 8, 100, 28, 100)],
    'RR', 'fixed',
  );
  const f = text(fixed);
  check('a fixed-effect reading claims no prediction interval', !f.includes('A future study'));
  check('and no between-study variance', !f.includes('τ²'));

  // "0% higher" is not a finding, and an interval spanning no difference has one
  // bound on each side — printing two magnitudes would read as though both
  // pointed the same way.
  const flat = runMetaAnalysis(
    [binary('A', 19, 100, 20, 100), binary('B', 21, 100, 20, 100), binary('C', 20, 100, 20, 100)],
    'RR', 'random', { comparatorRisk: 0.2 },
  );
  const flatText = text(flat);
  check('a pooled estimate on the null is called essentially unchanged',
    flatText.includes('essentially unchanged'));
  check('and never reported as a 0% change', !/0% (higher|lower)/.test(flatText), flatText.slice(0, 200));
  check('a straddling absolute interval carries a direction on each bound',
    /\d+ fewer to \d+ more/.test(flatText), flatText.slice(-220));
  check('and a negligible difference reports no NNT',
    flatText.includes('too small to express usefully'));
  check('describing it as fewer than 1 per 1000 either way',
    flatText.includes('fewer than 1 per 1000 either way'));

  // The same three properties, at the shared formatter.
  const describedFlat = describeAbsolute(flat.absolute!);
  check('the formatter suppresses a meaningless NNT', describedFlat.nnt === null);
  check('and never sorts an interval by magnitude',
    describedFlat.interval.includes('fewer to') && describedFlat.interval.includes('more'));
  const describedClear = describeAbsolute(runMetaAnalysis(
    [binary('A', 10, 100, 30, 100), binary('B', 12, 100, 32, 100), binary('C', 8, 100, 28, 100)],
    'RR', 'random', { comparatorRisk: 0.3 },
  ).absolute!);
  check('a real effect keeps its NNT', describedClear.nnt !== null);
  check('and reads in one direction', /^\d+ fewer per 1000$/.test(describedClear.headline),
    describedClear.headline);
  check('with both interval bounds on that side',
    !describedClear.interval.includes('more'), describedClear.interval);

  // The absolute effect, when it exists.
  const withAbsolute = runMetaAnalysis(
    [binary('A', 10, 100, 30, 100), binary('B', 12, 100, 32, 100), binary('C', 8, 100, 28, 100)],
    'RR', 'random', { comparatorRisk: 0.3 },
  );
  const a = text(withAbsolute);
  check('the absolute effect is stated per 1000', /\d+ fewer per 1000/.test(a));
  check('with its baseline named', a.includes('comparator risk of 30.0%'));
  check('and an NNT in plain words', /one additional benefit for every \d+ patients/.test(a));

  // Single-group measures get their own wording, with no direction language.
  const prop = runMetaAnalysis([
    { key: 'A', label: 'A', documentId: 'd1', proportion: { events: 12, total: 150 } },
    { key: 'B', label: 'B', documentId: 'd2', proportion: { events: 8, total: 120 } },
    { key: 'C', label: 'C', documentId: 'd3', proportion: { events: 22, total: 180 } },
  ] as MetaStudy[], 'PROP', 'random', { proportionMethod: 'glmm' });
  const p = text(prop);
  check('a prevalence is read as a prevalence', /prevalence was \d+\.\d%/.test(p), p.slice(0, 160));
  check('with no talk of effect or difference', !/no effect|difference/.test(p), p.slice(0, 200));
  check('and it says the pooled value is an average across studies',
    p.includes('not a value any one of them reported'));
  check('the one-stage tau squared is reported', p.includes('one-stage model estimated'));

  const corr = runMetaAnalysis([
    { key: 'A', label: 'A', documentId: 'd1', correlation: { r: 0.42, n: 88 } },
    { key: 'B', label: 'B', documentId: 'd2', correlation: { r: 0.31, n: 120 } },
    { key: 'C', label: 'C', documentId: 'd3', correlation: { r: 0.55, n: 64 } },
  ] as MetaStudy[], 'R', 'random');
  const cr = text(corr);
  check('a correlation is read as one', /r = 0\.\d+/.test(cr));
  check('its strength is labelled as a convention',
    cr.includes("Cohen's conventional bands"));
  check('and the direction is named', /positive association/.test(cr));
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. The methods panel shows what was used, not what exists
// ─────────────────────────────────────────────────────────────────────────────
{
  const studies = [
    binary('A', 10, 100, 30, 100), binary('B', 12, 100, 32, 100),
    binary('C', 8, 100, 28, 100), binary('D', 14, 100, 26, 100),
  ];
  const label = (r: Parameters<typeof methodsFormulas>[0]) => methodsFormulas(r).map(f => f.label).join(' | ');
  const latex = (r: Parameters<typeof methodsFormulas>[0]) => methodsFormulas(r).map(f => f.latex).join(' ');

  const random = runMetaAnalysis(studies, 'RR', 'random');
  check('a random-effects pool shows DerSimonian–Laird', label(random).includes('DerSimonian'));
  check('and the prediction interval formula', label(random).includes('Prediction interval'));
  check('and HKSJ, which it computed', label(random).includes('Hartung'));
  check('with random-effects weights', latex(random).includes('w_i^{*}'));

  const fixed = runMetaAnalysis(studies, 'RR', 'fixed');
  check('a fixed-effect pool hides tau squared', !label(fixed).includes('DerSimonian'));
  check('and hides the prediction interval', !label(fixed).includes('Prediction interval'));
  check('and hides HKSJ', !label(fixed).includes('Hartung'));
  check('showing fixed weights instead', !latex(fixed).includes('w_i^{*}'));

  const mh = runMetaAnalysis(studies, 'OR', 'mh');
  check('a Mantel–Haenszel pool shows its own estimator', label(mh).includes('Mantel'));
  check('and not inverse-variance weights', !label(mh).includes('Inverse-variance'));
  check('naming the RBG variance for an odds ratio',
    methodsFormulas(mh).some(f => f.note.includes('Robins–Breslow–Greenland')));
  const mhRr = runMetaAnalysis(studies, 'RR', 'mh');
  check('and Greenland–Robins for a risk ratio',
    methodsFormulas(mhRr).some(f => f.note.includes('Greenland–Robins')));

  const peto = runMetaAnalysis(studies, 'OR', 'peto');
  check('a Peto pool shows Peto', label(peto).includes('Peto'));
  check('with its bias caveat in the note',
    methodsFormulas(peto).some(f => f.note.includes('most biased')));

  const glmm = runMetaAnalysis([
    { key: 'A', label: 'A', documentId: 'd1', proportion: { events: 12, total: 150 } },
    { key: 'B', label: 'B', documentId: 'd2', proportion: { events: 0, total: 120 } },
    { key: 'C', label: 'C', documentId: 'd3', proportion: { events: 22, total: 180 } },
  ] as MetaStudy[], 'PROP', 'random', { proportionMethod: 'glmm' });
  check('a one-stage fit shows the binomial-normal model', label(glmm).includes('One-stage'));
  check('and its back-transformation', label(glmm).includes('Back-transformation'));
  check('and no inverse-variance weights', !label(glmm).includes('Inverse-variance'));

  const arcsine = runMetaAnalysis([
    { key: 'A', label: 'A', documentId: 'd1', proportion: { events: 12, total: 150 } },
    { key: 'B', label: 'B', documentId: 'd2', proportion: { events: 0, total: 120 } },
    { key: 'C', label: 'C', documentId: 'd3', proportion: { events: 22, total: 180 } },
  ] as MetaStudy[], 'PROP', 'random', { proportionMethod: 'arcsine' });
  check('the arcsine panel warns about the clamp',
    methodsFormulas(arcsine).some(f => f.note.includes('fold onto the wrong side')));

  // Notation covers the symbols in the formulas, and nothing it did not use.
  const notation = methodsNotation(random).map(n => n.symbol).join(' ');
  check('notation defines tau squared where it was estimated', notation.includes('\\tau^2'));
  check('and Q and I squared', notation.includes('Q') && notation.includes('I^2'));
  const fixedNotation = methodsNotation(fixed).map(n => n.symbol).join(' ');
  check('but not for a fixed-effect pool', !fixedNotation.includes('\\tau^2'));
  const mhNotation = methodsNotation(mh).map(n => n.symbol).join(' ');
  check('a count-based pool defines its cells', mhNotation.includes('a_i'));
  check('and does not define weights it never formed', !mhNotation.includes('w_i'));
  check('every notation entry has a meaning',
    methodsNotation(random).every(n => n.meaning.length > 10));
  check('every formula has a note', methodsFormulas(random).every(f => f.note.length > 20));
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Fragility — Fisher's exact against R, then the index against the toolkit
//    R: fisher.test(matrix(c(3,1,1,3),2)) gives p = 0.4857.
//    The Biostat Toolkit's fragility-index calculator gives, for 10/100 vs
//    22/100, FI = 1 and FQ = 0.005; for 30/40 vs 20/60, FI = 13, FQ = 0.13.
// ─────────────────────────────────────────────────────────────────────────────
{
  close("Fisher's exact matches R on the classic 3/1/1/3 table",
    fisherExactTwoSidedP(3, 1, 1, 3), 0.4857143, 1e-6);
  close('and on a larger table', fisherExactTwoSidedP(10, 90, 22, 78), 0.0326923, 1e-6);
  check('a degenerate table has no p', Number.isNaN(fisherExactTwoSidedP(0, 0, 5, 5)));

  const one = fragilityOf(10, 90, 22, 78);
  check('the reference table is fragile at 1', one.kind === 'fragile' && one.index === 1,
    JSON.stringify(one));
  if (one.kind === 'fragile') {
    close('with the quotient the reference reports', one.quotient, 0.005, 1e-9);
    check('and the flip takes p past 0.05', one.finalP >= 0.05);
  }
  const thirteen = fragilityOf(30, 10, 20, 40);
  check('a robust table needs 13 flips', thirteen.kind === 'fragile' && thirteen.index === 13,
    JSON.stringify(thirteen));

  const notSig = fragilityOf(20, 80, 22, 78);
  check('a non-significant table has no index, and says so',
    notSig.kind === 'not_significant');
  check('non-integer counts are not applicable',
    fragilityOf(10.5, 90, 22, 78).kind === 'not_applicable');
  check('an empty arm is not applicable', fragilityOf(0, 0, 22, 78).kind === 'not_applicable');

  // The table accounts for every plotted study, including shapes it cannot judge.
  const mixed = runMetaAnalysis([
    binary('Sig', 10, 100, 30, 100),
    binary('NotSig', 20, 100, 22, 100),
    {
      key: 'Pre', label: 'Pre', documentId: 'd',
      precomputed: { y: 0.2, se: 0.1, reported: { est: 1.22, lo: null, hi: null, se: 0.1, scale: 'log', derivedFrom: 'se' } },
    },
  ] as MetaStudy[], 'OR', 'random');
  const rows = fragilityTable(mixed.studies);
  check('every plotted study gets a row', rows.length === mixed.studies.length);
  check('a study with no 2x2 is marked not applicable',
    rows.find(r => r.key === 'Pre')?.outcome.kind === 'not_applicable');
  check('a significant trial gets an index',
    rows.find(r => r.key === 'Sig')?.outcome.kind === 'fragile');
  check('a non-significant one is named as such',
    rows.find(r => r.key === 'NotSig')?.outcome.kind === 'not_significant');

  const summary = fragilitySummary(rows) ?? '';
  check('the summary counts the significant trials', summary.includes('1 of 3'));
  check('and reports a median and a minimum', /median fragility index is \d+/.test(summary),
    summary);
  const noneSig = fragilitySummary(fragilityTable(runMetaAnalysis(
    [binary('A', 20, 100, 22, 100), binary('B', 21, 100, 22, 100), binary('C', 20, 100, 21, 100)],
    'OR', 'random',
  ).studies)) ?? '';
  check('a corpus with no significant trial says that plainly',
    noneSig.includes('No contributing trial reached significance'));
  check('and explains that this is what pooling is for',
    noneSig.includes('what a meta-analysis is for'));
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Design guards — against the vocabularies these forms actually use
//    ('Parallel group' / 'Split mouth', 'RCT' / 'quasi-RCT' / 'other',
//     'In vitro' / 'In vivo' / 'Human/Clinical')
// ─────────────────────────────────────────────────────────────────────────────
{
  const cases: Array<[string, DesignCategory]> = [
    ['Parallel group', 'randomised'],
    ['RCT', 'randomised'],
    ['randomised controlled trial', 'randomised'],
    ['Split mouth', 'within_person'],
    ['split-mouth', 'within_person'],
    ['Crossover trial', 'within_person'],
    ['quasi-RCT', 'quasi_randomised'],
    ['non-randomised comparison', 'quasi_randomised'],
    ['Prospective cohort', 'cohort'],
    ['retrospective registry review', 'cohort'],
    ['case-control', 'case_control'],
    ['Case control study', 'case_control'],
    ['cross-sectional survey', 'cross_sectional'],
    ['In vitro', 'preclinical'],
    ['In vivo', 'preclinical'],
    ['animal model', 'preclinical'],
    ['', 'unclear'],
    ['unclear', 'unclear'],
    ['other', 'unclear'],
  ];
  for (const [raw, expected] of cases) {
    check(`"${raw || '(blank)'}" reads as ${expected}`, classifyDesign(raw) === expected,
      classifyDesign(raw));
  }
  // The overlaps that make ordering matter.
  check('quasi-RCT is not read as randomised just because it contains RCT',
    classifyDesign('quasi-RCT') === 'quasi_randomised');
  check('a split-mouth RCT is read as within-person, not parallel',
    classifyDesign('Split mouth RCT') === 'within_person');

  const studies = runMetaAnalysis(
    [binary('Aziz', 10, 100, 30, 100), binary('Brenner', 12, 100, 32, 100),
     binary('Cho', 8, 100, 28, 100), binary('Duarte', 14, 100, 26, 100)],
    'RR', 'random',
  ).studies;

  // No design information at all: the check must say it could not run.
  const none = designGuards(studies, {}, 'RR');
  check('with no design values the check reports nothing to check', none.tallies === null);
  check('and raises no guards', none.guards.length === 0);

  // A risk ratio over case-control studies is the classic blocking error.
  const cc = designGuards(studies, {
    'doc-Aziz': 'case-control', 'doc-Brenner': 'case-control',
    'doc-Cho': 'Prospective cohort', 'doc-Duarte': 'Prospective cohort',
  }, 'RR');
  check('a case-control RR is blocking',
    cc.guards.some(g => g.severity === 'blocking' && g.title.includes('case-control')));
  check('and names the studies', cc.guards[0]?.studies.includes('Aziz') === true);
  const ccOr = designGuards(studies, {
    'doc-Aziz': 'case-control', 'doc-Brenner': 'case-control',
    'doc-Cho': 'Prospective cohort', 'doc-Duarte': 'Prospective cohort',
  }, 'OR');
  check('the same corpus as an odds ratio is not blocked',
    !ccOr.guards.some(g => g.title.includes('cannot be estimated')));

  // Split-mouth pooled as parallel — the error this corpus can actually make.
  const splitMixed = designGuards(studies, {
    'doc-Aziz': 'Split mouth', 'doc-Brenner': 'Parallel group',
    'doc-Cho': 'Parallel group', 'doc-Duarte': 'Parallel group',
  }, 'RR');
  const sm = splitMixed.guards.find(g => g.title.includes('Within-person'));
  check('a split-mouth study among parallel ones is flagged', !!sm);
  check('as a caution, since it is pooled alongside them', sm?.severity === 'caution');
  check('and the reason is the double-counting',
    sm?.detail.includes('counts each patient twice') === true);
  const allSplit = designGuards(studies, {
    'doc-Aziz': 'Split mouth', 'doc-Brenner': 'Split mouth',
    'doc-Cho': 'split-mouth', 'doc-Duarte': 'Split mouth',
  }, 'RR');
  const allSm = allSplit.guards.find(g => g.title.includes('Within-person'));
  check('an all-split-mouth corpus is a note rather than a caution',
    allSm?.severity === 'note');
  check('and says the interval is still too narrow',
    allSm?.detail.includes('narrower than the design supports') === true);

  // Preclinical mixed with clinical.
  const preclinical = designGuards(studies, {
    'doc-Aziz': 'In vitro', 'doc-Brenner': 'Human/Clinical',
    'doc-Cho': 'RCT', 'doc-Duarte': 'RCT',
  }, 'RR');
  check('preclinical plus clinical is blocking',
    preclinical.guards.some(g => g.severity === 'blocking' && g.title.includes('Preclinical')));

  // Randomised with non-randomised.
  const mixedRandom = designGuards(studies, {
    'doc-Aziz': 'RCT', 'doc-Brenner': 'RCT',
    'doc-Cho': 'quasi-RCT', 'doc-Duarte': 'Prospective cohort',
  }, 'RR');
  check('randomised with non-randomised is a caution',
    mixedRandom.guards.some(g => g.severity === 'caution' && g.title.includes('non-randomised')));

  // A clean corpus raises nothing.
  const clean = designGuards(studies, {
    'doc-Aziz': 'RCT', 'doc-Brenner': 'RCT', 'doc-Cho': 'RCT', 'doc-Duarte': 'RCT',
  }, 'RR');
  check('one design family and a suitable measure raises no guard', clean.guards.length === 0);
  check('but still tallies what it saw', clean.tallies?.length === 1);
  check('and counts every study', clean.tallies?.[0]?.studies.length === 4);

  // Partial coverage is itself reported.
  const partial = designGuards(studies, {
    'doc-Aziz': 'RCT', 'doc-Brenner': 'RCT',
  }, 'RR');
  check('studies with no design are counted as unknown', partial.unknownStudies.length === 2);
  check('and that gap is raised as a note',
    partial.guards.some(g => g.title.includes('no design recorded')));
  check('and attributed to the extraction, not the studies',
    partial.guards.find(g => g.title.includes('no design recorded'))?.detail
      .includes('gap in the extraction') === true);
}

// ── Report ───────────────────────────────────────────────────────────────────

if (failures.length > 0) {
  console.error(`\n  ${failures.length} FAILED of ${passed + failures.length}:\n`);
  for (const f of failures) console.error(`   x ${f}`);
  console.error('');
  process.exit(1);
}

console.log(`\n  reading + methods + fragility + design guards — ${passed} checks passed\n`);

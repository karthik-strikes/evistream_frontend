/**
 * Numeric self-check for the Synthesis data layer.
 *
 *   node --experimental-strip-types --import ./lib/__checks__/register-alias.mjs \
 *        lib/__checks__/buildStudies.check.mts
 *
 * This is the second-riskiest file in the feature after the statistics: it pairs
 * arms, reads numbers out of messy extracted text, converts reported spreads
 * into standard deviations, and decides what to exclude. Every one of those is
 * a place where a study could silently vanish or a wrong number could reach the
 * plot looking perfectly plausible.
 *
 * The invariant under test throughout: pairings in == studies out + exclusions
 * out. Nothing disappears.
 */

import {
  buildPairings,
  buildStudies,
  classifyVariability,
  detectArmLabelColumns,
  detectComparisonColumn,
  facetsOf,
  groupExclusions,
  parseNumber,
  toStandardDeviation,
  type Pairing,
} from '../../app/(dashboard)/synthesis/_lib/buildStudies.ts';
import { EXCLUDE, KEEP } from '../../app/(dashboard)/synthesis/_lib/reconcile.ts';
import type { Mapping } from '../../app/(dashboard)/synthesis/_lib/mapping.ts';
import type { BinaryArm, ContinuousArm } from '../metaAnalysis.ts';
import type { LongFormatRow } from '../longFormatTransform.ts';

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

const row = (doc: string, paper: string, values: Record<string, unknown>): LongFormatRow => ({
  _paperFilename: `${paper}.pdf`,
  _resultId: `res-${doc}`,
  _documentId: doc,
  _rawCells: {},
  Paper: paper,
  'Ref ID': '',
  ...values,
});

const confirmed = (cols: Record<string, string>): Mapping =>
  Object.fromEntries(
    Object.entries(cols).map(([k, v]) => [k, { col: v, status: 'confirmed' as const }]),
  ) as Mapping;

// ─────────────────────────────────────────────────────────────────────────────
// 1. parseNumber respects the absence vocabulary rather than coercing to zero
// ─────────────────────────────────────────────────────────────────────────────
{
  const ok = parseNumber(undefined, '42');
  check('a plain number parses', ok.ok && ok.value === 42);
  const comma = parseNumber(undefined, '1,234');
  check('thousands separators parse', comma.ok && comma.value === 1234);
  const pct = parseNumber(undefined, '37%');
  check('a trailing percent sign parses', pct.ok && pct.value === 37);
  const dec = parseNumber(undefined, ' 3.5 ');
  check('surrounding whitespace parses', dec.ok && dec.value === 3.5);

  for (const [text, reason] of [
    ['NR', 'not_reported'],
    ['not reported', 'not_reported'],
    ['N/A', 'not_reported'],
    ['NA', 'not_applicable'],
    ['not applicable', 'not_applicable'],
    ['', 'blank'],
    ['⚠', 'extraction_failed'],
    ['see table 3', 'unparseable'],
  ] as const) {
    const r = parseNumber(undefined, text);
    check(`"${text}" is refused as ${reason}`, !r.ok && r.reason === reason,
      r.ok ? 'parsed as a number' : r.reason);
  }
  // The whole point: an absence must never become a count.
  const nr = parseNumber(undefined, 'NR');
  check('NR does not become 0', !nr.ok);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Variability classification and conversion
// ─────────────────────────────────────────────────────────────────────────────
{
  check('SD is recognised', classifyVariability('Standard deviation') === 'SD');
  check('SE is recognised', classifyVariability('Standard error') === 'SE');
  check('CI is recognised', classifyVariability('95% CI') === 'CI');
  check('IQR is recognised', classifyVariability('Interquartile range') === 'IQR');
  check('range is recognised', classifyVariability('Range (max & min)') === 'RANGE');
  check('NA is recognised', classifyVariability('NA') === 'NA');
  check('an unknown measure is not guessed', classifyVariability('wibble') === 'UNKNOWN');

  // SD = SE x sqrt(N): 2.5 x sqrt(64) = 20
  const se = toStandardDeviation('2.5', 'SE', 64, 'convert');
  check('SE converts', se.ok, se.ok ? '' : se.reason);
  if (se.ok) close('SD = SE x sqrt(N)', se.sd, 20, 1e-12);

  // SD = sqrt(N) x (upper - lower) / 3.92: sqrt(100) x (3.4 - 1.2) / 3.92
  const ci = toStandardDeviation('1.2 to 3.4', 'CI', 100, 'convert');
  check('a CI written as text converts', ci.ok, ci.ok ? '' : ci.reason);
  if (ci.ok) close('SD from a 95% CI', ci.sd, (10 * 2.2) / 3.92, 1e-12);

  // The same interval in other notations must give the same answer.
  for (const text of ['1.2–3.4', '1.2 - 3.4', '(1.2, 3.4)', '1.2 to 3.4']) {
    const alt = toStandardDeviation(text, 'CI', 100, 'convert');
    check(`CI notation "${text}" parses`, alt.ok && Math.abs(alt.sd - (10 * 2.2) / 3.92) < 1e-9);
  }

  // SD ~ IQR / 1.35
  const iqr = toStandardDeviation('10 to 19', 'IQR', 50, 'approximate');
  if (iqr.ok) close('SD from an IQR', iqr.sd, 9 / 1.35, 1e-12);
  // SD ~ range / 4
  const range = toStandardDeviation('4 to 20', 'RANGE', 50, 'approximate');
  if (range.ok) close('SD from a range', range.sd, 16 / 4, 1e-12);

  const excluded = toStandardDeviation('2.5', 'SE', 64, 'exclude');
  check('excluding a measure reports it', !excluded.ok && excluded.reason === 'variability_excluded');
  const junk = toStandardDeviation('not stated', 'SD', 40, 'use');
  check('unparseable variability is reported', !junk.ok && junk.reason === 'variability_unusable');
  const oneSided = toStandardDeviation('3.4', 'CI', 100, 'convert');
  check('a CI with only one bound is refused', !oneSided.ok,
    'a one-sided CI cannot give a width');
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Wide layout — one row is already one comparison
// ─────────────────────────────────────────────────────────────────────────────
{
  const rows = [
    row('d1', 'Bailey 2013', { outcome: 'Pain relief', timepoint: '6 h', comparison: 'Ibuprofen vs Placebo', arm1_events: '52', arm1_n: '90', arm2_events: '30', arm2_n: '88' }),
    row('d2', 'Cooper 2014', { outcome: 'Pain relief', timepoint: '6 h', comparison: 'Ibuprofen vs Placebo', arm1_events: '38', arm1_n: '75', arm2_events: '22', arm2_n: '70' }),
    row('d3', 'Daniels 2011', { outcome: 'Adverse events', timepoint: '24 h', comparison: 'Ibuprofen vs Placebo', arm1_events: '9', arm1_n: '110', arm2_events: '4', arm2_n: '105' }),
  ];
  const mapping = confirmed({
    events_treatment: 'arm1_events', total_treatment: 'arm1_n',
    events_comparator: 'arm2_events', total_comparator: 'arm2_n',
    outcome: 'outcome', timepoint: 'timepoint',
  });
  const { pairings, excluded, multiArm } = buildPairings(
    rows, mapping, 'wide', '', 'comparison', { treatment: null, comparator: null },
  );
  check('wide gives one pairing per row', pairings.length === 3);
  check('wide excludes nothing structurally', excluded.length === 0);
  check('wide has no shared comparator', multiArm.length === 0);

  const f = facetsOf(pairings);
  check('outcomes are faceted', f.outcomes.length === 2);
  check('the commonest outcome sorts first', f.outcomes[0].value === 'Pain relief');
  close('outcome counts documents', f.outcomes[0].documents, 2, 0);
  check('timepoint follows outcome here', f.timepointFollowsOutcome === true);
  check('the derived timepoint is right', f.timepointByOutcome['Pain relief'] === '6 h');

  const built = buildStudies(pairings, {
    kind: 'dichotomous', layout: 'wide', mapping,
    variabilityMeasureColumn: null, centralTendencyMeasureColumn: null,
    variabilityActions: {}, centralTendencyActions: {},
  });
  check('all three become studies', built.studies.length === 3);
  const first = built.studies[0].treatment as BinaryArm;
  check('the treatment arm reads correctly', first.events === 52 && first.total === 90);
  const firstC = built.studies[0].comparator as BinaryArm;
  check('the comparator arm reads correctly', firstC.events === 30 && firstC.total === 88);
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Long layout — rows are arms and must be paired, including 3-arm trials
// ─────────────────────────────────────────────────────────────────────────────
{
  const rows = [
    // A two-arm study
    row('d1', 'Bailey 2013', { intervention: 'Ibuprofen 400 mg', outcome_type: 'Pain relief at 6 hours', n_analyzed: '90', events_n: '52' }),
    row('d1', 'Bailey 2013', { intervention: 'Placebo', outcome_type: 'Pain relief at 6 hours', n_analyzed: '88', events_n: '30' }),
    // A three-arm study sharing one placebo arm
    row('d2', 'Hersh 2018', { intervention: 'Ibuprofen 400 mg', outcome_type: 'Pain relief at 6 hours', n_analyzed: '120', events_n: '71' }),
    row('d2', 'Hersh 2018', { intervention: 'Ibuprofen 200 mg', outcome_type: 'Pain relief at 6 hours', n_analyzed: '118', events_n: '60' }),
    row('d2', 'Hersh 2018', { intervention: 'Placebo', outcome_type: 'Pain relief at 6 hours', n_analyzed: '118', events_n: '48' }),
    // A study with no comparator arm at all
    row('d3', 'Orphan 2020', { intervention: 'Ibuprofen 400 mg', outcome_type: 'Pain relief at 6 hours', n_analyzed: '40', events_n: '25' }),
  ];
  const mapping = confirmed({
    value: 'events_n', denominator: 'n_analyzed', arm: 'intervention', outcome: 'outcome_type',
  });
  const { pairings, excluded, multiArm } = buildPairings(
    rows, mapping, 'long', 'Placebo', null, { treatment: null, comparator: null },
  );

  check('two-arm and three-arm studies both pair', pairings.length === 3,
    `got ${pairings.length}`);
  check('the unpairable study is excluded', excluded.length === 1);
  check('...with the right reason', excluded[0]?.reason === 'no_comparator_row');
  check('...and is named', excluded[0]?.label === 'Orphan 2020');
  check('the three-arm trial is flagged', multiArm.length === 1 && multiArm[0].arms === 2,
    JSON.stringify(multiArm));
  check('...and named', multiArm[0]?.label === 'Hersh 2018');

  // The shared placebo arm must be the SAME arm in both of its comparisons —
  // that is the whole point of flagging it.
  const hersh = pairings.filter(p => p.label === 'Hersh 2018');
  check('both Hersh comparisons share one comparator row',
    hersh.length === 2 && hersh[0].comparatorRow === hersh[1].comparatorRow);
  check('both Hersh comparisons are marked as sharing', hersh.every(p => p.sharedComparator));
  check('each Hersh comparison names its own treatment arm',
    new Set(hersh.map(p => p.comparison)).size === 2, JSON.stringify(hersh.map(p => p.comparison)));

  const built = buildStudies(pairings, {
    kind: 'dichotomous', layout: 'long', mapping,
    variabilityMeasureColumn: null, centralTendencyMeasureColumn: null,
    variabilityActions: {}, centralTendencyActions: {},
  });
  check('every pairing becomes a study', built.studies.length === 3);
  const bailey = built.studies.find(s => s.label === 'Bailey 2013')!;
  check('long treatment arm reads correctly',
    (bailey.treatment as BinaryArm).events === 52 && (bailey.treatment as BinaryArm).total === 90);
  check('long comparator arm reads correctly',
    (bailey.comparator as BinaryArm).events === 30 && (bailey.comparator as BinaryArm).total === 88);

  // Nothing may vanish between pairing and plotting.
  check('pairings in == studies + exclusions out',
    built.studies.length + built.excluded.length === pairings.length);
}

// ─────────────────────────────────────────────────────────────────────────────
// 4b. An unmapped timepoint collapses every timepoint into one group. Taking an
//     arbitrary comparator row would pair a 6-hour treatment arm against a
//     2-hour placebo arm and put a wrong number on the plot, so the group must
//     be refused instead. Regression for the "49 treatment arms" ledger bug.
// ─────────────────────────────────────────────────────────────────────────────
{
  const rows = [
    row('d1', 'Multi 2020', { intervention: 'Ibuprofen', outcome_type: 'Pain relief', followup: '2 h', n_analyzed: '50', events_n: '20' }),
    row('d1', 'Multi 2020', { intervention: 'Placebo',   outcome_type: 'Pain relief', followup: '2 h', n_analyzed: '50', events_n: '10' }),
    row('d1', 'Multi 2020', { intervention: 'Ibuprofen', outcome_type: 'Pain relief', followup: '6 h', n_analyzed: '50', events_n: '30' }),
    row('d1', 'Multi 2020', { intervention: 'Placebo',   outcome_type: 'Pain relief', followup: '6 h', n_analyzed: '50', events_n: '12' }),
  ];
  const base = { value: 'events_n', denominator: 'n_analyzed', arm: 'intervention', outcome: 'outcome_type' };

  // Timepoint NOT mapped — two placebo rows collapse into one group.
  const loose = buildPairings(rows, confirmed(base), 'long', 'Placebo', null,
    { treatment: null, comparator: null });
  check('an ambiguous group produces no pairings', loose.pairings.length === 0,
    `${loose.pairings.length} pairings`);
  check('...and is reported rather than guessed at',
    loose.excluded.some(e => e.reason === 'ambiguous_grouping'),
    JSON.stringify(loose.excluded.map(e => e.reason)));
  check('...and claims no multi-arm sharing', loose.multiArm.length === 0);

  // Timepoint mapped — the same rows now pair correctly, 2h with 2h, 6h with 6h.
  const tight = buildPairings(rows, confirmed({ ...base, timepoint: 'followup' }), 'long',
    'Placebo', null, { treatment: null, comparator: null });
  check('mapping the timepoint resolves it', tight.pairings.length === 2,
    `${tight.pairings.length} pairings`);
  check('...with nothing excluded', tight.excluded.length === 0);
  check('...and no false multi-arm claim', tight.multiArm.length === 0);
  const built = buildStudies(tight.pairings, {
    kind: 'dichotomous', layout: 'long', mapping: confirmed({ ...base, timepoint: 'followup' }),
    variabilityMeasureColumn: null, centralTendencyMeasureColumn: null,
    variabilityActions: {}, centralTendencyActions: {},
  });
  const at6 = built.studies.find(s => (s.evidence as any).timepoint === '6 h')!;
  check('the 6 h arm pairs with the 6 h control',
    (at6.treatment as BinaryArm).events === 30 && (at6.comparator as BinaryArm).events === 12,
    JSON.stringify([at6.treatment, at6.comparator]));

  // Each group carries its own identity so the ledger can filter to the selection.
  check('pairings carry a group key', tight.pairings.every(p => !!p.groupKey));
  check('different timepoints are different groups',
    new Set(tight.pairings.map(p => p.groupKey)).size === 2);
}

// ─────────────────────────────────────────────────────────────────────────────
// 4c. A genuine multi-arm trial is tagged per GROUP, not per document — one
//     paper reporting two outcomes must not report its arms twice.
// ─────────────────────────────────────────────────────────────────────────────
{
  const rows = [
    row('d1', 'Three-arm 2019', { intervention: 'Ibu 400', outcome_type: 'Relief', n_analyzed: '50', events_n: '30' }),
    row('d1', 'Three-arm 2019', { intervention: 'Ibu 200', outcome_type: 'Relief', n_analyzed: '50', events_n: '25' }),
    row('d1', 'Three-arm 2019', { intervention: 'Placebo',  outcome_type: 'Relief', n_analyzed: '50', events_n: '10' }),
    row('d1', 'Three-arm 2019', { intervention: 'Ibu 400', outcome_type: 'Nausea', n_analyzed: '50', events_n: '5' }),
    row('d1', 'Three-arm 2019', { intervention: 'Ibu 200', outcome_type: 'Nausea', n_analyzed: '50', events_n: '4' }),
    row('d1', 'Three-arm 2019', { intervention: 'Placebo',  outcome_type: 'Nausea', n_analyzed: '50', events_n: '2' }),
  ];
  const m = confirmed({ value: 'events_n', denominator: 'n_analyzed', arm: 'intervention', outcome: 'outcome_type' });
  const r = buildPairings(rows, m, 'long', 'Placebo', null, { treatment: null, comparator: null });
  check('two outcomes give two multi-arm notes', r.multiArm.length === 2,
    `${r.multiArm.length} notes`);
  check('each note counts only its own arms', r.multiArm.every(x => x.arms === 2),
    JSON.stringify(r.multiArm.map(x => x.arms)));
  check('notes are keyed by group, so they can be filtered',
    new Set(r.multiArm.map(x => x.groupKey)).size === 2);
  // Selecting one outcome must leave exactly one note.
  const relief = r.pairings.filter(p => p.outcome === 'Relief');
  const shown = r.multiArm.filter(x => relief.some(p => p.groupKey === x.groupKey));
  check('filtering to one outcome shows one note', shown.length === 1, `${shown.length} shown`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 4d. Harmonization merges synonym timepoints into one group — the whole point
//     being that "6 hrs" rows currently fail to pool with "6 hours" rows.
// ─────────────────────────────────────────────────────────────────────────────
{
  const rows = [
    row('d1', 'Alpha 2019', { arm: 'Drug',    out: 'Relief', tp: '6 hours',     ev: '30', n: '50' }),
    row('d1', 'Alpha 2019', { arm: 'Placebo', out: 'Relief', tp: '6 hours',     ev: '10', n: '50' }),
    row('d2', 'Beta 2020',  { arm: 'Drug',    out: 'Relief', tp: '6 hrs',       ev: '32', n: '50' }),
    row('d2', 'Beta 2020',  { arm: 'Placebo', out: 'Relief', tp: '6 hrs',       ev: '11', n: '50' }),
    row('d3', 'Gamma 2021', { arm: 'Drug',    out: 'Relief', tp: '360 minutes', ev: '28', n: '50' }),
    row('d3', 'Gamma 2021', { arm: 'Placebo', out: 'Relief', tp: '360 minutes', ev: '12', n: '50' }),
    row('d4', 'Delta 2022', { arm: 'Drug',    out: 'Relief', tp: '8 hours',     ev: '25', n: '50' }),
    row('d4', 'Delta 2022', { arm: 'Placebo', out: 'Relief', tp: '8 hours',     ev: '13', n: '50' }),
  ];
  const m = confirmed({ value: 'ev', denominator: 'n', arm: 'arm', outcome: 'out', timepoint: 'tp' });
  const call = (h?: any) => buildPairings(rows, m, 'long', 'Placebo', null,
    { treatment: null, comparator: null }, h);

  // Without harmonization the three spellings are three separate timepoints.
  const raw = call();
  check('unharmonized spellings stay separate',
    new Set(raw.pairings.map(p => p.timepoint)).size === 4,
    JSON.stringify([...new Set(raw.pairings.map(p => p.timepoint))]));

  const choices = {
    '6 hours': KEEP, '6 hrs': '6 hours', '360 minutes': '6 hours', '8 hours': KEEP,
  };

  // Suggested but unconfirmed changes nothing at all.
  const inert = call({ choices, confirmed: {} });
  check('an unconfirmed merge leaves grouping untouched',
    new Set(inert.pairings.map(p => p.timepoint)).size === 4);

  const merged = call({ choices, confirmed: { '6 hrs': true, '360 minutes': true } });
  const times = new Set(merged.pairings.map(p => p.timepoint));
  check('confirmed merges collapse to two timepoints', times.size === 2,
    JSON.stringify([...times]));
  check('the canonical spelling survives', times.has('6 hours'));
  check('8 hours is still its own timepoint', times.has('8 hours'));
  check('every pairing survives the merge', merged.pairings.length === 4);
  check('merging introduces no ambiguity', merged.excluded.length === 0,
    JSON.stringify(merged.excluded.map(e => e.reason)));

  // Three studies now share one timepoint, so they can actually be pooled.
  const at6 = merged.pairings.filter(p => p.timepoint === '6 hours');
  check('three studies now share the 6-hour timepoint', at6.length === 3);
  const built = buildStudies(at6, {
    kind: 'dichotomous', layout: 'long', mapping: m,
    variabilityMeasureColumn: null, centralTendencyMeasureColumn: null,
    variabilityActions: {}, centralTendencyActions: {},
  });
  check('...and they pool', built.studies.length === 3);

  // Excluding a value removes its rows and names them.
  const dropped = call({
    choices: { ...choices, '8 hours': EXCLUDE },
    confirmed: { '8 hours': true },
  });
  check('an excluded timepoint removes its pairings',
    dropped.pairings.every(p => p.timepoint !== '8 hours'));
  check('...and reports the study by name',
    dropped.excluded.some(e => e.reason === 'harmonization_excluded' && e.label === 'Delta 2022'),
    JSON.stringify(dropped.excluded.map(e => [e.label, e.reason])));
}

// ─────────────────────────────────────────────────────────────────────────────
// 4e. Effect direction reaches the study as flipSign, and only when confirmed
// ─────────────────────────────────────────────────────────────────────────────
{
  const rows = [
    row('d1', 'Reversed 2020', { arm: 'Drug', out: 'X', scale: 'Global improvement 1-7', mean: '20', sd: '4', n: '30' }),
    row('d1', 'Reversed 2020', { arm: 'Placebo', out: 'X', scale: 'Global improvement 1-7', mean: '10', sd: '4', n: '30' }),
  ];
  const m = confirmed({ value: 'mean', variability: 'sd', denominator: 'n', arm: 'arm', outcome: 'out' });
  const { pairings } = buildPairings(rows, m, 'long', 'Placebo', null,
    { treatment: null, comparator: null });
  const opts = {
    kind: 'continuous' as const, layout: 'long' as const, mapping: m,
    variabilityMeasureColumn: null, centralTendencyMeasureColumn: null,
    variabilityActions: {}, centralTendencyActions: {},
    scaleColumn: 'scale',
    directions: { 'Global improvement 1-7': 'reverse' as const },
  };

  // A form with no variability_measure column must still pool: the mapped
  // variability column is taken as an SD rather than excluded as "undeclared".
  const unconfirmed = buildStudies(pairings, opts);
  check('no measure column still yields a study', unconfirmed.studies.length === 1,
    JSON.stringify(unconfirmed.excluded.map(e => e.reason)));
  check('an unconfirmed reversal does not flip the study',
    unconfirmed.studies[0].flipSign === false, String(unconfirmed.studies[0].flipSign));

  const applied = buildStudies(pairings, {
    ...opts, directionsConfirmed: { 'Global improvement 1-7': true },
  });
  check('a confirmed reversal flips the study', applied.studies[0].flipSign === true);
  check('the scale is carried for the panel to group on',
    (applied.studies[0].evidence as any).scale === 'Global improvement 1-7');
  check('the treatment row rides along for subgrouping',
    !!(applied.studies[0].evidence as any).row);
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Long + continuous — the units resolution
// ─────────────────────────────────────────────────────────────────────────────
{
  const rows = [
    row('d1', 'Kim 2019', { intervention: 'Drug', outcome_type: 'VAS', n_analyzed: '64', central_tendency_measure: 'Mean', central_tendency: '30', variability_measure: 'Standard error', variability: '2.5' }),
    row('d1', 'Kim 2019', { intervention: 'Placebo', outcome_type: 'VAS', n_analyzed: '64', central_tendency_measure: 'Mean', central_tendency: '40', variability_measure: 'Standard error', variability: '2.5' }),
    row('d2', 'Osei 2021', { intervention: 'Drug', outcome_type: 'VAS', n_analyzed: '50', central_tendency_measure: 'Median', central_tendency: '28', variability_measure: 'Interquartile range', variability: '10 to 19' }),
    row('d2', 'Osei 2021', { intervention: 'Placebo', outcome_type: 'VAS', n_analyzed: '50', central_tendency_measure: 'Median', central_tendency: '38', variability_measure: 'Interquartile range', variability: '10 to 19' }),
    row('d3', 'Tanaka 2018', { intervention: 'Drug', outcome_type: 'VAS', n_analyzed: '40', central_tendency_measure: 'Mean', central_tendency: '31', variability_measure: 'NA', variability: 'NA' }),
    row('d3', 'Tanaka 2018', { intervention: 'Placebo', outcome_type: 'VAS', n_analyzed: '40', central_tendency_measure: 'Mean', central_tendency: '39', variability_measure: 'NA', variability: 'NA' }),
  ];
  const mapping = confirmed({
    value: 'central_tendency', variability: 'variability', denominator: 'n_analyzed',
    arm: 'intervention', outcome: 'outcome_type',
  });
  const { pairings } = buildPairings(
    rows, mapping, 'long', 'Placebo', null, { treatment: null, comparator: null },
  );
  check('continuous long pairs each study', pairings.length === 3);

  const opts = {
    kind: 'continuous' as const, layout: 'long' as const, mapping,
    variabilityMeasureColumn: 'variability_measure',
    centralTendencyMeasureColumn: 'central_tendency_measure',
    variabilityActions: { 'Standard error': 'convert' as const, 'Interquartile range': 'approximate' as const, NA: 'exclude' as const },
    centralTendencyActions: { Median: 'approximate' as const },
  };
  const built = buildStudies(pairings, opts);
  check('SE and IQR studies survive, NA does not', built.studies.length === 2,
    `${built.studies.length} studies`);
  // The NA study reports `not_applicable`, NOT `variability_excluded`. Its
  // variability value is literally "NA", so the paper declared no spread —
  // blaming the reviewer's units choice would be misleading, because changing
  // that choice cannot bring this study back.
  check('the NA study is reported as a declared absence',
    built.excluded.some(e => e.reason === 'not_applicable'),
    JSON.stringify(built.excluded.map(e => e.reason)));
  check('nothing vanishes', built.studies.length + built.excluded.length === pairings.length);

  // The real `variability_excluded` path: a usable number whose measure the
  // reviewer chose to exclude. Changing that choice WOULD bring it back.
  const byChoice = buildStudies(pairings, {
    ...opts,
    variabilityActions: { ...opts.variabilityActions, 'Standard error': 'exclude' as const },
  });
  check('excluding a measure with usable values reports the choice',
    byChoice.excluded.some(e => e.reason === 'variability_excluded'),
    JSON.stringify(byChoice.excluded.map(e => e.reason)));
  check('...and that study leaves the analysis', byChoice.studies.length === 1);

  const kim = built.studies.find(s => s.label === 'Kim 2019')!;
  close('SE converted to SD in situ', (kim.treatment as ContinuousArm).sd, 2.5 * 8, 1e-12);
  close('the mean is unchanged', (kim.treatment as ContinuousArm).mean, 30, 1e-12);

  // Excluding medians moves the IQR study out of the analysis.
  const strict = buildStudies(pairings, {
    ...opts,
    centralTendencyActions: { Median: 'exclude' as const },
  });
  check('excluding medians drops that study', strict.studies.length === 1);
  check('...and reports why', strict.excluded.some(e => e.reason === 'median_excluded'));
  check('...without losing it', strict.studies.length + strict.excluded.length === pairings.length);

  // Choosing "use as-is" takes the SE number at face value as an SD.
  const asIs = buildStudies(pairings, {
    ...opts,
    variabilityActions: { ...opts.variabilityActions, 'Standard error': 'use' as const },
  });
  const kimAsIs = asIs.studies.find(s => s.label === 'Kim 2019')!;
  close('"use as-is" takes the number unchanged', (kimAsIs.treatment as ContinuousArm).sd, 2.5, 1e-12);
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. A missing or absent value takes only its own study out
// ─────────────────────────────────────────────────────────────────────────────
{
  const rows = [
    row('d1', 'Good 2013', { outcome: 'X', arm1_events: '52', arm1_n: '90', arm2_events: '30', arm2_n: '88' }),
    row('d2', 'Absent 2014', { outcome: 'X', arm1_events: 'NR', arm1_n: '75', arm2_events: '22', arm2_n: '70' }),
    row('d3', 'Text 2011', { outcome: 'X', arm1_events: 'see table', arm1_n: '110', arm2_events: '41', arm2_n: '105' }),
    row('d4', 'Blank 2012', { outcome: 'X', arm1_events: '', arm1_n: '60', arm2_events: '18', arm2_n: '58' }),
  ];
  const mapping = confirmed({
    events_treatment: 'arm1_events', total_treatment: 'arm1_n',
    events_comparator: 'arm2_events', total_comparator: 'arm2_n', outcome: 'outcome',
  });
  const { pairings } = buildPairings(rows, mapping, 'wide', '', null, { treatment: null, comparator: null });
  const built = buildStudies(pairings, {
    kind: 'dichotomous', layout: 'wide', mapping,
    variabilityMeasureColumn: null, centralTendencyMeasureColumn: null,
    variabilityActions: {}, centralTendencyActions: {},
  });
  check('only the good study is included', built.studies.length === 1);
  check('the other three are each reported', built.excluded.length === 3);
  const reasons = new Set(built.excluded.map(e => e.reason));
  check('NR is distinguished from unreadable', reasons.has('not_reported') && reasons.has('unparseable'));
  check('a blank is its own reason', reasons.has('blank'));
  check('the offending column is named', built.excluded.every(e => e.column === 'arm1_events'));

  const groups = groupExclusions(built.excluded);
  check('exclusions group by reason', groups.length === 3);
  check('every group carries readable text', groups.every(g => g.text.length > 0));
  check('grouping loses nothing',
    groups.reduce((a, g) => a + g.studies.length, 0) === built.excluded.length);
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Column detection
// ─────────────────────────────────────────────────────────────────────────────
{
  check('an exact comparison column wins',
    detectComparisonColumn(['comparison', 'outcome', 'timepoint']) === 'comparison');
  check('comparison_label is found',
    detectComparisonColumn(['comparison_label', 'outcome']) === 'comparison_label');
  check('no comparison column is honest about it',
    detectComparisonColumn(['outcome', 'timepoint']) === null);
  check('an ambiguous match is refused',
    detectComparisonColumn(['comparison_a', 'comparison_b']) === null);

  const arms = detectArmLabelColumns(['arm1_label', 'arm1_events', 'arm2_label', 'arm2_events']);
  check('the treatment label column is found', arms.treatment === 'arm1_label');
  check('the comparator label column is found', arms.comparator === 'arm2_label');
  const none = detectArmLabelColumns(['events_n', 'n_analyzed']);
  check('no arm labels is honest about it', none.treatment === null && none.comparator === null);
}

// ── Report ───────────────────────────────────────────────────────────────────

if (failures.length > 0) {
  console.error(`\n  ${failures.length} FAILED of ${passed + failures.length}:\n`);
  for (const f of failures) console.error(`   x ${f}`);
  console.error('');
  process.exit(1);
}

console.log(`\n  buildStudies.ts — ${passed} checks passed\n`);

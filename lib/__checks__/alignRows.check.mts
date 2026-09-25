/**
 * Self-check for consensus table-row alignment (consensus/_lib/alignRows.ts).
 *
 *   node --experimental-strip-types --import ./lib/__checks__/register-alias.mjs \
 *        lib/__checks__/alignRows.check.mts
 *
 * The invariant under test: when a usable key exists, row order never decides
 * correspondence; rows are joined automatically only on a complete key unique
 * within each source; anything incomplete, duplicated or merely similar waits
 * for the reviewer.
 */

import assert from 'node:assert/strict';
import {
  alignTableRows,
  applyManualPairs,
  automaticChoice,
  buildConsensusRows,
  canPair,
  differingColumns,
  isBlankKeyCell,
  type AlignedRecord,
} from '../../app/(dashboard)/consensus/_lib/alignRows.ts';

let n = 0;
function check(name: string, fn: () => void) {
  fn();
  n++;
  console.log(`ok  ${name}`);
}

const cell = (value: any, extra: Record<string, any> = {}) => ({ value, source_text: `quote for ${value}`, status: 'reported', ...extra });
const arm = (name: any, n_rand: any = 92, dose: any = '440 mg') => ({ arm_name: cell(name), dose: cell(dose), n_randomized: cell(n_rand) });

const KEY = [{ field_name: 'arm_name' }];
const KEY2 = [{ field_name: 'arm_name' }, { field_name: 'dose' }];
const COLS = [{ field_name: 'arm_name' }, { field_name: 'dose' }, { field_name: 'n_randomized' }];

const summary = (recs: AlignedRecord[]) =>
  recs.map(r => `${r.alignment}[${(['ai', 'r1', 'r2'] as const).filter(s => r.members[s]).map(s => `${s}#${r.members[s]!.rowIndex}`).join(' ')}]`);

check('same rows, same order → every record joined across all three', () => {
  const t = [arm('Naproxen'), arm('Acetaminophen'), arm('Placebo')];
  const recs = alignTableRows({ ai: t, r1: t, r2: t }, KEY);
  assert.deepEqual(summary(recs), ['key[ai#0 r1#0 r2#0]', 'key[ai#1 r1#1 r2#1]', 'key[ai#2 r1#2 r2#2]']);
});

check('Kiersch: R2 lists Placebo first → Naproxen still joins R1 #1 with R2 #2', () => {
  const ai = [arm('Naproxen'), arm('Acetaminophen'), arm('Placebo')];
  const r2 = [arm('Placebo'), arm('Naproxen'), arm('Acetaminophen')];
  const recs = alignTableRows({ ai, r1: ai, r2 }, KEY);
  assert.deepEqual(summary(recs), ['key[ai#0 r1#0 r2#1]', 'key[ai#1 r1#1 r2#2]', 'key[ai#2 r1#2 r2#0]']);
  for (const r of recs) assert.equal(differingColumns(r, COLS).size, 0, 'reordering created a conflict');
});

check('all three in different orders → still aligned', () => {
  const recs = alignTableRows({
    ai: [arm('A'), arm('B'), arm('C')],
    r1: [arm('C'), arm('A'), arm('B')],
    r2: [arm('B'), arm('C'), arm('A')],
  }, KEY);
  assert.deepEqual(summary(recs), ['key[ai#0 r1#1 r2#2]', 'key[ai#1 r1#2 r2#0]', 'key[ai#2 r1#0 r2#1]']);
});

check('row in AI + R1 only → one record, R2 missing (not two unmatched rows)', () => {
  const recs = alignTableRows({ ai: [arm('Naproxen'), arm('Placebo')], r1: [arm('Naproxen'), arm('Placebo')], r2: [arm('Naproxen')] }, KEY);
  assert.deepEqual(summary(recs), ['key[ai#0 r1#0 r2#0]', 'key[ai#1 r1#1]']);
  assert.equal(automaticChoice(recs[1], COLS, ['ai', 'r1', 'r2']), null, 'a missing row must be decided');
});

check('row only R2 found → one R2-only record, after the others', () => {
  const recs = alignTableRows({ ai: [arm('Naproxen')], r1: [arm('Naproxen')], r2: [arm('Ibuprofen'), arm('Naproxen')] }, KEY);
  assert.deepEqual(summary(recs), ['key[ai#0 r1#0 r2#1]', 'key[r2#0]']);
});

check('duplicate key in one source → whole bucket ambiguous, nothing auto-joined', () => {
  const recs = alignTableRows({
    ai: [arm('Ibuprofen'), arm('Ibuprofen')],
    r1: [arm('Ibuprofen')],
    r2: [arm('Ibuprofen')],
  }, KEY);
  assert.deepEqual(summary(recs), ['ambiguous[ai#0]', 'ambiguous[ai#1]', 'ambiguous[r1#0]', 'ambiguous[r2#0]']);
});

check('a wider key separates doses that a name-only key would collide', () => {
  const recs = alignTableRows({
    ai: [arm('Ibuprofen', 90, '200 mg'), arm('Ibuprofen', 91, '400 mg')],
    r1: [arm('Ibuprofen', 91, '400 mg'), arm('Ibuprofen', 90, '200 mg')],
  }, KEY2);
  assert.deepEqual(summary(recs), ['key[ai#0 r1#1]', 'key[ai#1 r1#0]']);
});

check('empty / NR / NA key cells are one "blank" token and still match', () => {
  // Built by hand: `arm(..., undefined)` would take the default dose.
  const withDose = (dose: any) => ({ ...arm('Ibuprofen', 90), dose });
  const blanks = [cell('NR'), cell(''), cell(null), null, undefined, 'NR', 'NA',
    { value: 'NA', status: 'not_reported' },   // how the manual form stores a typed NA
    { value: 'NR', status: 'not_reported' }, { value: 'NA', status: 'not_applicable' }];
  for (const a of blanks) for (const b of blanks) {
    const recs = alignTableRows({ ai: [withDose(a)], r1: [withDose(b)] }, KEY2);
    assert.deepEqual(summary(recs), ['key[ai#0 r1#0]'], `${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
    assert.deepEqual(recs[0].blankKeyCells, ['dose']);
  }
  // A blank never matches a value.
  const recs = alignTableRows({ ai: [withDose('NR')], r1: [withDose(cell('400 mg'))] }, KEY2);
  assert.equal(recs.length, 2);
});

check('failed key cell, or an all-blank key → stands alone', () => {
  const withDose = (dose: any) => ({ ...arm('Ibuprofen', 90), dose });
  for (const failed of [{ value: '400 mg', status: 'error' }, { value: '', status: 'missing' }]) {
    const recs = alignTableRows({ ai: [withDose(failed)], r1: [withDose(failed)] }, KEY2);
    assert.deepEqual(summary(recs), ['incomplete-key[ai#0]', 'incomplete-key[r1#0]']);
  }
  const empty = { arm_name: cell('NR'), dose: cell(''), n_randomized: cell(1) };
  assert.deepEqual(summary(alignTableRows({ ai: [empty], r1: [empty] }, KEY2)), ['incomplete-key[ai#0]', 'incomplete-key[r1#0]']);
});

check('blanks do not defeat the duplicate guard', () => {
  const withDose = (dose: any) => ({ ...arm('Ibuprofen', 90), dose });
  const recs = alignTableRows({ ai: [withDose('NR'), withDose('NA')], r1: [withDose('NR')] }, KEY2);
  assert.deepEqual(summary(recs), ['ambiguous[ai#0]', 'ambiguous[ai#1]', 'ambiguous[r1#0]']);
});

check('0 in a key is a value, never blank', () => {
  assert.equal(isBlankKeyCell(cell(0)), false);
  assert.equal(isBlankKeyCell(0), false);
  const recs = alignTableRows({ ai: [arm('A', 1, 0)], r1: [arm('A', 1, '0')] }, KEY2);
  assert.deepEqual(summary(recs), ['key[ai#0 r1#0]'], '"0" and 0 are one value');
  assert.equal(alignTableRows({ ai: [arm('A', 1, 0)], r1: [arm('A', 1, 'NR')] }, KEY2).length, 2, '0 is not blank');
});

check('live Kiersch 1994 key values: reordered, NR/NA-swapped rows still join', () => {
  // Key columns and cell shapes copied from the live dichotomous_outcomes rows
  // (form e1dee8b4…, R2), including the NR/NA mix and leading spaces.
  const K = ['adverse_effect', 'followup_timepoint', 'intervention', 'intervention_detail', 'outcome_other', 'outcome_type', 'population_type']
    .map(field_name => ({ field_name }));
  const nr = (v: string) => ({ value: v, status: 'not_reported' });
  const rep = (v: string) => ({ value: v, status: 'reported' });
  const row = (ae: any, tp: any, iv: string, det: string, oo: any, ot: string) => ({
    adverse_effect: ae, followup_timepoint: tp, intervention: rep(iv), intervention_detail: rep(det),
    outcome_other: oo, outcome_type: rep(ot), population_type: rep('Surgical tooth extraction (third molar / wisdom teeth)'),
  });
  const r2 = [
    row(nr('NA'), rep('6 hours'), 'Naproxen 400-440 mg', ' Naproxen sodium', nr('NA'), 'Rescue analgesia at 6 hours'),
    row(rep('Nausea'), nr('NR'), 'Naproxen 400-440 mg', ' Naproxen sodium', nr('NA'), 'Adverse effects'),
    row(rep('Headache'), nr('NA'), 'Naproxen 400-440 mg', ' Naproxen sodium', nr('NR'), 'Adverse effects'),
    row(rep(' Nausea'), nr('NA'), 'Acetaminophen 500-1,000 mg', 'Acetaminophen', nr('NR'), 'Adverse effects'),
  ];
  const ai = [
    row(rep('Nausea'), nr('NA'), 'Acetaminophen 500-1,000 mg', 'Acetaminophen', nr('NA'), 'Adverse effects'),
    row(rep('Headache'), nr('NR'), 'Naproxen 400-440 mg', 'Naproxen sodium', nr('NA'), 'Adverse effects'),
    row(nr('NR'), rep('6 hours'), 'Naproxen 400-440 mg', 'Naproxen sodium', nr('NR'), 'Rescue analgesia at 6 hours'),
    row(rep('nausea'), nr('NR'), 'Naproxen 400-440 mg', 'Naproxen sodium', nr('NR'), 'Adverse effects'),
  ];
  const recs = alignTableRows({ ai, r2 }, K);
  assert.deepEqual(summary(recs), ['key[ai#0 r2#3]', 'key[ai#1 r2#2]', 'key[ai#2 r2#0]', 'key[ai#3 r2#1]']);
  // R1's live rows put the paper's prose into adverse_effect: different
  // records, so they must stay "only R1".
  const r1 = [row(rep('most of the events (>90%) were of mild or moderate severity.'), nr('NR'), 'Naproxen 400-440 mg', 'Naproxen 440mg', nr('NA'), 'Adverse effects')];
  assert.equal(alignTableRows({ r1, r2 }, K).filter(r => r.members.r1 && r.members.r2).length, 0);
});

check('case / edge whitespace in a key → same record (compareKey rules)', () => {
  const recs = alignTableRows({ ai: [arm('Naproxen')], r1: [arm('  NAPROXEN ')] }, KEY);
  assert.deepEqual(summary(recs), ['key[ai#0 r1#0]']);
});

check('similar-looking but unequal keys → never merged', () => {
  const recs = alignTableRows({ ai: [arm('Naproxen')], r1: [arm('Naproxen')], r2: [arm('Naproxen sodium')] }, KEY);
  assert.deepEqual(summary(recs), ['key[ai#0 r1#0]', 'key[r2#0]']);
});

check('envelope cells key by value, not "[object Object]"', () => {
  const recs = alignTableRows({ ai: [arm('A'), arm('B')], r1: [arm('B'), arm('A')] }, KEY);
  assert.equal(recs.length, 2, 'distinct arms collapsed into one key');
});

check('manual pairing moves a row; a row can belong to only one record', () => {
  const base = alignTableRows({ ai: [arm('Naproxen')], r1: [arm('Naproxen')], r2: [arm('Naproxen sodium')] }, KEY);
  assert.equal(canPair(base[0], base[1]), true);
  const paired = applyManualPairs(base, [['ai:0', 'r1:0', 'r2:0']]);
  assert.deepEqual(summary(paired), ['manual[ai#0 r1#0 r2#0]']);
  // A second group claiming r2:0 is dropped whole.
  const twice = applyManualPairs(base, [['ai:0', 'r2:0'], ['r1:0', 'r2:0']]);
  assert.deepEqual(summary(twice), ['manual[ai#0 r2#0]', 'key[r1#0]']);
  // Two rows from one source can never form a record.
  const recs = alignTableRows({ ai: [arm('X'), arm('X')] }, KEY);
  assert.deepEqual(summary(applyManualPairs(recs, [['ai:0', 'ai:1']])), ['ambiguous[ai#0]', 'ambiguous[ai#1]']);
  assert.equal(canPair(recs[0], recs[1]), false);
  // Stale refs (not in this snapshot) are ignored.
  assert.deepEqual(summary(applyManualPairs(base, [['ai:0', 'r2:9']])), summary(base));
});

check('resolving an ambiguous bucket by hand', () => {
  const base = alignTableRows({ ai: [arm('Ibuprofen'), arm('Ibuprofen', 50)], r1: [arm('Ibuprofen')], r2: [arm('Ibuprofen')] }, KEY);
  const paired = applyManualPairs(base, [['ai:0', 'r1:0', 'r2:0']]);
  assert.deepEqual(summary(paired), ['manual[ai#0 r1#0 r2#0]', 'ambiguous[ai#1]']);
});

check('no key configured → positional, explicitly unverified', () => {
  const recs = alignTableRows({ ai: [arm('A'), arm('B')], r1: [arm('B')] }, []);
  assert.deepEqual(summary(recs), ['positional-unverified[ai#0 r1#0]', 'positional-unverified[ai#1]']);
  assert.ok(recs.every(r => r.alignment !== 'key'));
});

check('source that reported the whole table NR is not "missing" per record', () => {
  // The caller leaves the NR source out of rowsBySource and presentSources.
  const recs = alignTableRows({ ai: [arm('A')], r1: [arm('A')] }, KEY);
  assert.equal(automaticChoice(recs[0], COLS, ['ai', 'r1']), 'ai');
});

check('one differing cell inside a joined record → exactly that cell', () => {
  const recs = alignTableRows({ ai: [arm('A', 92)], r1: [arm('A', 92)], r2: [arm('A', 89)] }, KEY);
  assert.deepEqual([...differingColumns(recs[0], COLS)], ['n_randomized']);
  assert.equal(automaticChoice(recs[0], COLS, ['ai', 'r1', 'r2']), null);
});

check('failed cell never counts as agreement', () => {
  const a = arm('A'); const b = { ...arm('A'), n_randomized: { value: '92', status: 'error' } };
  const recs = alignTableRows({ ai: [a], r1: [b] }, KEY);
  assert.deepEqual([...differingColumns(recs[0], COLS)], ['n_randomized']);
});

check('built table uses the sources’ own row objects, evidence intact', () => {
  const ai = [arm('A'), arm('B')]; const r2 = [arm('B', 80), arm('A')];
  const recs = alignTableRows({ ai, r2 }, KEY);
  const rows = buildConsensusRows(recs, r => (r.identity === 'b' ? 'r2' : 'ai'))!;
  assert.equal(rows[0], ai[0]);
  assert.equal(rows[1], r2[0]);
  assert.equal(rows[1].n_randomized.source_text, 'quote for 80');
  assert.deepEqual(buildConsensusRows(recs, r => (r.identity === 'b' ? 'exclude' : 'ai')), [ai[0]]);
  assert.equal(buildConsensusRows(recs, () => null), null, 'undecided record must block the build');
});

console.log(`\n${n} checks passed`);

/**
 * Self-check for the three-step consensus model (consensus/_lib/entities.ts).
 *
 *   node --experimental-strip-types --import ./lib/__checks__/register-alias.mjs \
 *        lib/__checks__/entities.check.mts
 *
 * Invariants: a proposal is never applied without a decision; a clearly
 * different identity (other dose, other timepoint, other arm) is never
 * proposed; no source row disappears; final rows only exist once every match
 * and issue is settled, and they are built from the sources' own cells.
 */

import assert from 'node:assert/strict';
import {
  acceptProposal,
  buildTableModel,
  cellSimilarity,
  emptyTableState,
  rejectProposal,
  rowSimilarity,
  setCellPick,
  setInclude,
  setExclude,
  markDuplicate,
  markNotDuplicate,
  matchCandidates,
  rejectMatch,
  reconsiderMatch,
  pairRecords,
  refsOf,
} from '../../app/(dashboard)/consensus/_lib/entities.ts';

let n = 0;
function check(name: string, fn: () => void) {
  fn();
  n++;
  console.log(`ok  ${name}`);
}

const cell = (value: any) => ({ value, source_text: `quote for ${value}`, status: 'reported' });
const row = (arm: string, outcome: string, tp: string, mean: any) => ({
  arm: cell(arm), outcome: cell(outcome), timepoint: cell(tp), mean: cell(mean),
});
const COLS = [{ field_name: 'arm' }, { field_name: 'outcome' }, { field_name: 'timepoint' }, { field_name: 'mean' }];
const KEY = ['arm', 'outcome', 'timepoint'];
const absence = (v: any) => (v === 'NR' ? 'NR' : v === 'NA' ? 'NA' : null);
const spec = { field_name: 'x' };

check('unit spellings fold: 6 h ~ 6 hours ~ 6-hour', () => {
  assert.ok(cellSimilarity(cell('6 h'), cell('6 hours'), spec) >= 0.9);
  assert.ok(cellSimilarity(cell('6-hour'), cell('6 h'), spec) >= 0.9);
});

check('disjoint numbers block: 2 h vs 6 h, 220 mg vs 440 mg', () => {
  assert.equal(cellSimilarity(cell('2 h'), cell('6 h'), spec), 0);
  assert.equal(cellSimilarity(cell('Naproxen 220 mg'), cell('Naproxen 440 mg'), spec), 0);
});

check('acronym matches its spelled-out form', () => {
  assert.ok(cellSimilarity(cell('SPID'), cell('Summed pain intensity difference'), spec) >= 0.9);
});

check('a different arm vetoes the whole row even when the rest agrees', () => {
  const cols = KEY.map(field_name => ({ field_name }));
  assert.equal(rowSimilarity(row('Naproxen', 'SPID', '6 h', 1), row('Placebo', 'SPID', '6 h', 1), cols), 0);
});

check('Kiersch: near-identical rows are PROPOSED, not merged', () => {
  const sources = {
    r1: [row('Naproxen 400-440 mg', 'SPID', '6 hours', 3.4)],
    r2: [row('Naproxen sodium 440 mg', 'SPID', '6 h', 3.8)],
    ai: [row('Naproxen 440 mg', 'Summed pain intensity difference', '6 hours', 3.4)],
  };
  const m = buildTableModel('t', COLS, KEY, sources, emptyTableState(), absence);
  assert.equal(m.entities.length, 3, 'three separate records until someone decides');
  assert.ok(m.proposals.length >= 1);
  assert.equal(m.finalRows, null);
  assert.ok(m.entities.every(e => e.status === 'needs_review' || e.status === 'unmatched'));
});

check('accepting proposals, then picking the conflicting mean, yields one final row', () => {
  const sources = {
    r1: [row('Naproxen 440 mg', 'SPID', '6 hours', 3.4)],
    r2: [row('Naproxen sodium 440 mg', 'SPID', '6 h', 3.8)],
  };
  let s = emptyTableState();
  let m = buildTableModel('t', COLS, KEY, sources, s, absence);
  assert.equal(m.proposals.length, 1);
  s = acceptProposal(s, m.proposals[0]);
  m = buildTableModel('t', COLS, KEY, sources, s, absence);
  assert.equal(m.entities.length, 1);
  assert.equal(m.entities[0].status, 'confirmed');
  const open = m.issues.filter(i => !i.resolved).map(i => (i as any).column).sort();
  assert.deepEqual(open, ['arm', 'mean', 'timepoint']);
  const rid = m.entities[0].rec.id;
  s = setCellPick(s, rid, 'arm', { from: 'r1' });
  s = setCellPick(s, rid, 'timepoint', { from: 'r1' });
  s = setCellPick(s, rid, 'mean', { from: 'custom', value: '3.5' });
  m = buildTableModel('t', COLS, KEY, sources, s, absence);
  assert.equal(m.counts.openIssues, 0);
  assert.equal(m.finalRows!.length, 1);
  assert.equal(m.finalRows![0].mean.value, '3.5');
  assert.equal(m.finalRows![0].arm.source_text, 'quote for Naproxen 440 mg', 'picked cell keeps its evidence');
  assert.deepEqual(m.provenance![0].rows, { r1: 1, r2: 1 });
  assert.equal(m.provenance![0].cells.mean, 'custom');
  assert.equal(m.provenance![0].cells.outcome, 'agreed');
});

check('keep separate: both rows survive as their own results and ask include/exclude', () => {
  const sources = {
    r1: [row('Naproxen 440 mg', 'SPID', '6 hours', 3.4)],
    r2: [row('Naproxen sodium 440 mg', 'SPID', '6 h', 3.8)],
  };
  let s = emptyTableState();
  let m = buildTableModel('t', COLS, KEY, sources, s, absence);
  s = rejectProposal(s, m.proposals[0]);
  m = buildTableModel('t', COLS, KEY, sources, s, absence);
  assert.equal(m.proposals.length, 0);
  assert.equal(m.entities.length, 2);
  assert.ok(m.entities.every(e => e.status === 'kept_separate'));
  assert.equal(m.issues.filter(i => i.kind === 'record').length, 2);
  s = setInclude(s, m.entities[0].rec.id, true);
  s = setInclude(s, m.entities[1].rec.id, false);
  m = buildTableModel('t', COLS, KEY, sources, s, absence);
  assert.equal(m.finalRows!.length, 1);
  assert.equal(m.provenance!.length, 2, 'the excluded row is still accounted for');
  assert.equal(m.provenance!.filter(p => !p.included).length, 1);
});

check('exact key join across sources needs nothing; all-agree table finalises at once', () => {
  const r = [row('Placebo', 'SPID', '6 h', 1.7), row('Naproxen', 'SPID', '6 h', 3.4)];
  const m = buildTableModel('t', COLS, KEY, { r1: r, r2: [...r].reverse(), ai: r }, emptyTableState(), absence);
  assert.equal(m.counts.aligned, 2);
  assert.equal(m.proposals.length, 0);
  assert.equal(m.issues.length, 0);
  assert.equal(m.finalRows!.length, 2);
});

check('three timepoints of one outcome stay three results', () => {
  const r = ['2 h', '4 h', '6 h'].map(tp => row('Naproxen', 'SPID', tp, 1));
  const m = buildTableModel('t', COLS, KEY, { r1: r, r2: r.slice(0, 2) }, emptyTableState(), absence);
  assert.equal(m.entities.length, 3);
  assert.equal(m.proposals.length, 0, '6 h (R1 only) must not be proposed against anything');
  const lone = m.entities.find(e => e.missing.length);
  assert.equal(lone!.status, 'unmatched');
});

check('a source reporting the table NR counts as lacking every row', () => {
  const r = [row('Placebo', 'SPID', '6 h', 1.7)];
  const m = buildTableModel('t', COLS, KEY, { r1: r, r2: 'NR' }, emptyTableState(), absence);
  assert.deepEqual(m.absentSources, { r2: 'NR' });
  assert.deepEqual(m.entities[0].missing, ['r2']);
  assert.equal(m.issues[0].kind, 'record');
});

check('no key: positional line-up is a question, and splitting keeps both rows', () => {
  const r1 = [{ a: cell('x'), b: cell('1') }];
  const r2 = [{ a: cell('y'), b: cell('2') }];
  const cols = [{ field_name: 'a' }, { field_name: 'b' }];
  let s = emptyTableState();
  let m = buildTableModel('t', cols, [], { r1, r2 }, s, absence);
  assert.equal(m.proposals[0].kind, 'positional');
  assert.equal(m.finalRows, null);
  s = rejectProposal(s, m.proposals[0]);
  m = buildTableModel('t', cols, [], { r1, r2 }, s, absence);
  assert.equal(m.entities.length, 2);
});

check('legacy whole-table pick reproduces the saved table', () => {
  const r1 = [row('Placebo', 'SPID', '6 h', 1.7), row('Naproxen', 'SPID', '6 h', 3.4)];
  const r2 = [row('Placebo', 'SPID', '6 h', 1.9)];
  const s = { ...emptyTableState(), legacyPick: 'r1' as const };
  const m = buildTableModel('t', COLS, KEY, { r1, r2 }, s, absence);
  assert.equal(m.counts.openIssues, 0);
  assert.equal(m.finalRows!.length, 2);
  assert.equal(m.finalRows!.find(x => x.arm.value === 'Placebo')!.mean.value, 1.7);
});

// ── Methodology handoff edge cases (Sep 28 2026) ──

check('same-source identical rows are suggested as a duplicate; "they are different" is remembered', () => {
  const r = row('Placebo', 'SPID', '6 h', 1.7);
  const sources = { r1: [r, { ...r }], r2: [row('Placebo', 'SPID', '6 h', 1.7)] };
  let s = emptyTableState();
  let m = buildTableModel('t', COLS, KEY, sources, s, absence);
  assert.equal(m.duplicateSuggestions.length >= 1, true);
  const d = m.duplicateSuggestions[0];
  assert.equal(d.source, 'r1');
  s = markNotDuplicate(s, d.id);
  m = buildTableModel('t', COLS, KEY, sources, s, absence);
  assert.ok(!m.duplicateSuggestions.some(x => x.id === d.id), 'answered pair is not asked again');
});

check('near duplicate with a different timepoint is NOT suggested', () => {
  const sources = { r1: [row('Placebo', 'SPID', '6 h', 1.7), row('Placebo', 'SPID', '2 h', 1.7)] };
  const m = buildTableModel('t', COLS, KEY, sources, emptyTableState(), absence);
  assert.equal(m.duplicateSuggestions.length, 0);
});

check('marking the suggested duplicate keeps both rows accounted for', () => {
  const r = row('Placebo', 'SPID', '6 h', 1.7);
  const sources = { r1: [r, { ...r }] };
  let s = emptyTableState();
  let m = buildTableModel('t', COLS, KEY, sources, s, absence);
  const d = m.duplicateSuggestions[0];
  s = markDuplicate(s, d.repeat, d.keep);
  s = setInclude(s, d.keep.id, true);
  m = buildTableModel('t', COLS, KEY, sources, s, absence);
  assert.equal(m.finalRows!.length, 1);
  assert.equal(m.provenance!.length, 2);
  assert.equal(m.provenance!.find(p => !p.included)!.excluded_reason, 'duplicate');
});

check('find a match is group-aware: an R2 row is ranked against an R1 + AI result, vetoes score 0', () => {
  const base = [row('Naproxen 440 mg', 'SPID', '6 h', 3.4), row('Placebo', 'SPID', '6 h', 1.7)];
  const sources = { r1: base, ai: base, r2: [row('Naproxen sodium 440 mg', 'SPID', '6 hours', 3.8)] };
  const s = emptyTableState();
  const m = buildTableModel('t', COLS, KEY, sources, s, absence);
  const r2 = m.entities.find(e => e.rec.members.r2)!;
  const cands = matchCandidates(m, r2.rec, s);
  assert.equal(cands.length, 2, 'both R1 + AI results are candidates');
  assert.ok(cands[0].rec.members.r1 && cands[0].rec.members.ai, 'the candidate is the whole group');
  assert.ok(cands[0].score > 0.5);
  assert.equal(cands[1].score, 0, 'placebo is vetoed against naproxen');
});

check('rejecting a candidate records it; reconsider restores it; neither excludes a row', () => {
  const sources = { r1: [row('Naproxen 440 mg', 'SPID', '6 h', 3.4)], r2: [row('Naproxen sodium 440 mg', 'SPID', '6 h', 3.8)] };
  let s = emptyTableState();
  let m = buildTableModel('t', COLS, KEY, sources, s, absence);
  const [a, b] = m.entities.map(e => e.rec);
  s = rejectMatch(s, a, b);
  m = buildTableModel('t', COLS, KEY, sources, s, absence);
  const c = matchCandidates(m, a, s)[0];
  assert.equal(c.rejected, true);
  assert.equal(m.proposals.length, 0, 'the proposal is suppressed');
  assert.equal(m.entities.length, 2, 'both rows still there');
  s = reconsiderMatch(s, c.pairId);
  m = buildTableModel('t', COLS, KEY, sources, s, absence);
  assert.equal(matchCandidates(m, a, s)[0].rejected, false);
  assert.equal(m.proposals.length, 1, 'the proposal is back');
});

check('attaching a third source to an existing pair yields one R1 + R2 + AI result', () => {
  const sources = {
    r1: [row('Naproxen 440 mg', 'SPID', '6 h', 3.4)],
    ai: [row('Naproxen 440 mg', 'SPID', '6 h', 3.4)],
    r2: [row('Naproxen sodium 440 mg', 'SPID', '6 hours', 3.8)],
  };
  let s = emptyTableState();
  let m = buildTableModel('t', COLS, KEY, sources, s, absence);
  const group = m.entities.find(e => e.rec.members.r1 && e.rec.members.ai)!;
  const r2 = m.entities.find(e => e.rec.members.r2)!;
  s = pairRecords(s, r2.rec, group.rec);
  m = buildTableModel('t', COLS, KEY, sources, s, absence);
  assert.equal(m.entities.length, 1);
  assert.deepEqual(Object.keys(m.entities[0].rec.members).sort(), ['ai', 'r1', 'r2']);
});

check('a left-out result keeps its reason in provenance', () => {
  const sources = { r1: [row('Placebo', 'SPID', '6 h', 1.7)], r2: [row('Naproxen', 'SPID', '6 h', 3.4)] };
  let s = emptyTableState();
  let m = buildTableModel('t', COLS, KEY, sources, s, absence);
  const [a, b] = m.entities;
  s = setExclude(s, a.rec.id, 'not_relevant');
  s = setInclude(s, b.rec.id, true);
  m = buildTableModel('t', COLS, KEY, sources, s, absence);
  assert.equal(m.provenance!.find(p => p.record_id === a.rec.id)!.excluded_reason, 'not_relevant');
  assert.equal(refsOf(m.entities[0].rec).length, 1);
});

console.log(`\n${n} checks passed (incl. methodology edge cases)`);

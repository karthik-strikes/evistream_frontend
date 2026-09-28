/**
 * Real-data check for the consensus model: Kiersch 1994, "Acute Dental Pain —
 * Dichotomous Outcomes" (Analgesics Calibration). The only live paper with
 * R1 + R2 + AI rows in one table (as of 28 Sep 2026). Values and statuses are
 * copied verbatim from extraction_results; quotes and pages are left out.
 *
 *   node --experimental-strip-types --import ./lib/__checks__/register-alias.mjs \
 *        lib/__checks__/entities.kiersch.check.mts
 *
 * What it covers: mismatched row counts (3 / 18 / 15), a 7-column key with
 * NR / NA / blank mixed in, two timepoints (6 h vs 12 h), results only one
 * source has (R1's lumped adverse-event rows), synonyms that must NOT be
 * proposed (somnolence vs Drowsiness), no source row disappearing, and NR
 * staying distinct from blank in the final rows.
 */

import assert from 'node:assert/strict';
import {
  acceptProposal,
  buildTableModel,
  duplicateCandidates,
  emptyTableState,
  markDuplicate,
  refsOf,
  rejectProposal,
  setCellPick,
  setInclude,
  valueOptions,
  type TableConsensusState,
} from '../../app/(dashboard)/consensus/_lib/entities.ts';

let n = 0;
function check(name: string, fn: () => void) {
  fn();
  n++;
  console.log(`ok  ${name}`);
}

import { AI, c, LONG, NA, NR, PLA, R1, R2, row } from './fixtures_kiersch.mts';

const COLS = ['population_type', 'intervention', 'intervention_detail', 'outcome_type', 'outcome_other', 'followup_timepoint', 'n_analyzed', 'adverse_effect', 'adverse_effect_definition', 'events_n', 'events_pct']
  .map(field_name => ({ field_name }));
const KEY = ['adverse_effect', 'followup_timepoint', 'intervention', 'intervention_detail', 'outcome_other', 'outcome_type', 'population_type'];
const SOURCES = { r1: R1, r2: R2, ai: AI };
const absence = (v: any) => (v === 'NR' ? 'NR' : v === 'NA' ? 'NA' : null);
const build = (s: TableConsensusState) => buildTableModel('dichotomous_outcomes', COLS, KEY, SOURCES, s, absence);

const v = (cell: any) => String(cell?.value ?? '').trim().toLowerCase();
const label = (e: any) => refsOf(e.rec).map(r => `${r.source}:${v(r.row.intervention).split(' ')[0]}/${v(r.row.outcome_type).slice(0, 6)}/${v(r.row.adverse_effect).slice(0, 12)}`).join(' + ');

/** Every source row sits in exactly one entity. */
function assertAllRowsAccounted(m: ReturnType<typeof build>) {
  const seen = new Map<string, number>();
  for (const e of m.entities) for (const r of refsOf(e.rec)) seen.set(`${r.source}:${r.rowIndex}`, (seen.get(`${r.source}:${r.rowIndex}`) ?? 0) + 1);
  assert.equal(seen.size, R1.length + R2.length + AI.length, 'every source row is represented');
  assert.ok([...seen.values()].every(x => x === 1), 'no source row appears twice');
}

let initial = build(emptyTableState());

check('row counts 3 / 18 / 15 are reported per source; nothing is auto-merged', () => {
  assert.deepEqual(initial.rowCounts, { ai: 15, r1: 3, r2: 18 });
  assertAllRowsAccounted(initial);
  assert.equal(initial.finalRows, null);
});

check('proposals pair the same arm + outcome + event, across 6 h / NR / NA / 12 h spellings', () => {
  for (const p of initial.proposals) {
    const [a, b] = [refsOf(p.a)[0].row, refsOf(p.b!)[0].row];
    assert.equal(v(a.intervention), v(b.intervention), `same arm: ${label({ rec: p.a })} vs ${label({ rec: p.b })}`);
    assert.equal(v(a.outcome_type), v(b.outcome_type), 'same outcome');
  }
  const rescue = initial.proposals.filter(p => v(refsOf(p.a)[0].row.outcome_type).startsWith('rescue'));
  assert.equal(rescue.length, 3, 'one rescue-analgesia proposal per arm');
});

check('synonyms and lumped rows are never proposed: somnolence ≠ Drowsiness, R1 summary rows stand alone', () => {
  const proposed = new Set(initial.proposals.flatMap(p => [p.a.id, p.b!.id]));
  for (const e of initial.entities) {
    const ae = v(refsOf(e.rec)[0].row.adverse_effect);
    if (ae === 'somnolence' || ae === 'drowsiness') assert.ok(!proposed.has(e.rec.id), `${label(e)} was proposed`);
    if (refsOf(e.rec)[0].source === 'r1') assert.ok(!proposed.has(e.rec.id), 'R1 lumped row was proposed');
  }
});

check('accepting every proposal: rows still all accounted for; one-source results ask include', () => {
  let s = emptyTableState();
  for (let i = 0; i < 40; i++) {
    const m = build(s);
    if (!m.proposals.length) break;
    s = acceptProposal(s, m.proposals[0]);
  }
  const m = build(s);
  assertAllRowsAccounted(m);
  assert.equal(m.proposals.length, 0);
  const record = m.issues.filter(i => i.kind === 'record');
  assert.ok(record.length >= 3, 'R1 rows at least');
  // Two-source results (R2 + AI) missing R1 still need a decision — never auto-included.
  const twoSource = m.entities.filter(e => refsOf(e.rec).length === 2);
  assert.ok(twoSource.length > 0 && twoSource.every(e => e.askInclude), 'R1 missing → adjudicator decides');
});

check('NR stays distinct from blank and from NA in the final rows', () => {
  let s = emptyTableState();
  for (let i = 0; i < 40; i++) { const m = build(s); if (!m.proposals.length) break; s = acceptProposal(s, m.proposals[0]); }
  let m = build(s);
  // Decide everything: include all, pick R2 for every conflicting cell.
  for (const e of m.entities) if (e.askInclude) s = setInclude(s, e.rec.id, true);
  m = build(s);
  for (const i of m.issues) if (i.kind === 'cell') {
    const e = m.entities.find(x => x.rec.id === i.recordId)!;
    const from = e.rec.members.r2 ? 'r2' : refsOf(e.rec)[0].source;
    s = setCellPick(s, i.recordId, i.column, { from });
  }
  m = build(s);
  assert.equal(m.counts.openIssues, 0);
  assert.equal(m.finalRows!.length, m.entities.length);
  const placeboR1 = m.finalRows!.find(r => r.intervention.value === PLA && r.adverse_effect.value === LONG)!;
  assert.deepEqual(placeboR1.intervention_detail, c('', 'not_reported'), 'a blank-with-status cell is kept verbatim');
  assert.equal(placeboR1.events_n.status, 'not_reported');
  assert.equal(placeboR1.outcome_other.status, 'not_applicable', 'NA is not rewritten to NR');
  assertAllRowsAccounted(m);
  assert.equal(m.provenance!.length, m.entities.length);
});

check('a matched rescue row offers each distinct value once, agreeing sources grouped', () => {
  let s = emptyTableState();
  const p = initial.proposals.find(x => v(refsOf(x.a)[0].row.outcome_type).startsWith('rescue') && v(refsOf(x.a)[0].row.intervention).startsWith('naproxen'))!;
  s = acceptProposal(s, p);
  const m = build(s);
  const e = m.entities.find(x => x.rec.members.r2 && x.rec.members.ai && v(x.rec.members.r2.row.outcome_type).startsWith('rescue'))!;
  const opts = valueOptions(e.rec, { field_name: 'n_analyzed' });
  assert.equal(opts.length, 1, 'both say 92');
  const ev = valueOptions(e.rec, { field_name: 'events_n' });
  assert.deepEqual(ev.map(o => o.sources), [['ai'], ['r2']], 'NR vs 41.40 are two options');
});

check('rejecting a proposal keeps both rows as separate results', () => {
  const p = initial.proposals[0];
  const m = build(rejectProposal(emptyTableState(), p));
  assert.ok(!m.proposals.some(x => x.id === p.id));
  assert.ok(m.entities.some(e => e.rec.id === p.a.id && e.status === 'kept_separate'));
  assertAllRowsAccounted(m);
});

// ── Duplicates: synthetic, because no live paper has a same-source duplicate ──

check('mark as duplicate: excluded with reason, points at the representative, row still accounted for', () => {
  const dup = { ...R2[5] }; // R2 typed "Naproxen · Headache" twice
  const sources = { r1: R1, r2: [...R2, dup], ai: AI };
  const b = (s: TableConsensusState) => buildTableModel('t', COLS, KEY, sources, s, absence);
  let s = emptyTableState();
  let m = b(s);
  const dupEnt = m.entities.find(e => e.rec.members.r2?.rowIndex === R2.length)!;
  assert.ok(dupEnt, 'the duplicate row is a result of its own');
  const cands = duplicateCandidates(m, dupEnt.rec);
  const rep = cands.find(r => r.members.r2?.rowIndex === 5)!;
  assert.ok(rep, 'its twin is offered as the representative');
  s = markDuplicate(s, dupEnt.rec, rep);
  m = b(s);
  const now = m.entities.find(e => e.rec.id === dupEnt.rec.id)!;
  assert.equal(now.status, 'duplicate');
  assert.equal(now.askInclude, false);
  assert.ok(!m.issues.some(i => i.recordId === dupEnt.rec.id), 'no issue for a duplicate');
  // settle the rest — matching the representative afterwards must keep the mark
  for (let i = 0; i < 40; i++) { const x = b(s); if (!x.proposals.length) break; s = acceptProposal(s, x.proposals[0]); }
  m = b(s);
  for (const e of m.entities) if (e.askInclude) s = setInclude(s, e.rec.id, true);
  m = b(s);
  for (const i of m.issues) if (i.kind === 'cell') s = setCellPick(s, i.recordId, i.column, { from: 'ai' });
  m = b(s);
  assert.equal(m.counts.openIssues, 0);
  const prov = m.provenance!.find(p => p.record_id === dupEnt.rec.id)!;
  assert.equal(prov.included, false);
  assert.equal(prov.excluded_reason, 'duplicate');
  assert.ok(prov.duplicate_of);
  assert.equal(m.finalRows!.length, m.entities.length - 1);
});

check('a duplicate mark whose representative disappeared is ignored, not a silent drop', () => {
  const s = { ...emptyTableState(), duplicates: { [initial.entities[0].rec.id]: 'r2:999' } };
  const m = build(s);
  assert.notEqual(m.entities[0].status, 'duplicate');
});

check('multiple doses of one drug never propose each other', () => {
  const d = (dose: string) => row({ intervention: `Naproxen ${dose}`, outcome_type: 'Adverse effects', followup_timepoint: '6 h', intervention_detail: dose, adverse_effect: 'Nausea', adverse_effect_definition: NR(), outcome_other: NA(), n_analyzed: '50', events_n: '3', events_pct: '6' });
  const m = buildTableModel('t', COLS, KEY, { r1: [d('220 mg')], r2: [d('440 mg')] }, emptyTableState(), absence);
  assert.equal(m.proposals.length, 0);
  assert.equal(m.entities.length, 2);
});

console.log('\nproposals on the live paper:');
for (const p of initial.proposals) console.log(`  ${Math.round((p.confidence ?? 0) * 100)}%  ${label({ rec: p.a })}  ⇄  ${label({ rec: p.b })}`);
console.log(`unmatched: ${initial.entities.filter(e => e.status === 'unmatched').length}, results: ${initial.entities.length}`);
console.log(`\n${n} checks passed`);

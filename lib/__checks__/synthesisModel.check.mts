/**
 * Self-check for the Synthesis workspace model.
 *
 *   node --experimental-strip-types --import ./lib/__checks__/register-alias.mjs \
 *        lib/__checks__/synthesisModel.check.mts
 *
 * `_lib/synthesisModel.ts` turns stored decisions + extracted rows into every
 * status the workspace shows. The rules under test are the gates of SPEC §2:
 * eligibility (label, comparison, window, NR → unknown), the structured
 * selection rule, source review of AI-only rows, transformations as confirmed
 * decisions, run staleness, the audit and the derived lifecycle — plus the
 * design mock's deadlocks, which must NOT reproduce (a rejected row resolves;
 * the prespecified derived-SD sensitivity runs itself; a partial run is
 * possible but never finalizable).
 */

import {
  analysesOf, analysisStatuses, auditPasses, auditRows, computeRunOutputs, deriveModel, deriveStatus,
  evaluateCandidate, poolingOf, readAs, resultRef, runConfigOf, runMeta, staleDiff, studiesFromDataset,
  validateDefault, weeksOf, labelRef, studyRef, transformRef, PRESET_REF, SWIM_GROUPING_REF,
  analysisConfigKey, orientStudy, resultRefsOf, rowContentFingerprint,
  type ModelInput,
} from '../../app/(dashboard)/synthesis/_lib/synthesisModel.ts';
import { datasetHash } from '../../app/(dashboard)/synthesis/_lib/datasetHash.ts';
import { buildSwim } from '../../app/(dashboard)/synthesis/_lib/swim.ts';
import type { LongFormatRow } from '../longFormatTransform.ts';
import type {
  SynthesisDecision, SynthesisGroup, SynthesisRun, SynthesisSourceForm, SynthesisTarget, PlannedAnalysis,
} from '../../services/synthesis.service.ts';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function close(name: string, a: number | null | undefined, b: number, tol = 1e-9): void {
  check(name, a !== null && a !== undefined && Number.isFinite(a) && Math.abs(a - b) <= tol, `expected ${b}, got ${a}`);
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

let seq = 0;
function dec(kind: SynthesisDecision['kind'], target_ref: string, value: Record<string, unknown>, reason: string | null = 'because'): SynthesisDecision {
  seq++;
  return { id: `d${seq}`, group_id: 'g1', kind, target_ref, value, reason, by: 'u1', by_name: 'K. Reddy', at: `2026-09-25T10:${String(seq).padStart(2, '0')}:00Z`, revoked_at: null, provenance: null };
}

function wideRow(doc: string, label: string, o: Partial<Record<string, string>>, type: 'ai' | 'manual' | 'consensus' = 'consensus'): LongFormatRow {
  const base: Record<string, string> = {
    outcome: 'Pain VAS', timepoint: '12 weeks', comparison: 'Drug A vs placebo', scale: 'Pain VAS 0-10',
    mean_t: '4.1', sd_t: '2.3', n_t: '88', mean_c: '6.5', sd_c: '2.5', n_c: '86', ...o,
  };
  return { ...base, Paper: label, _paperFilename: `${label}.pdf`, _resultId: `r-${doc}-${type}`, _documentId: doc, _extractionType: type, _rawCells: {} } as LongFormatRow;
}

const wideForm: SynthesisSourceForm = {
  form_id: 'f1', field_name: 'outcomes', kind: 'continuous', layout: 'wide', effect_scale: 'natural',
  mapping: {
    outcome: 'outcome', timepoint: 'timepoint',
    mean_treatment: 'mean_t', sd_treatment: 'sd_t', n_treatment: 'n_t',
    mean_comparator: 'mean_c', sd_comparator: 'sd_c', n_comparator: 'n_c',
  },
  comparator_value: null, units: {}, confirmed_by: 'u1', confirmed_at: '2026-09-20T00:00:00Z',
};

const target: SynthesisTarget = {
  outcome: 'Pain intensity', outcome_labels: ['Pain VAS'], definition: '',
  comparison: { intervention: 'Drug A', comparator: 'placebo', orientation: 'intervention_minus_comparator', sign_convention: 'negative_favours_intervention' },
  population: 'Adults', window: { lo: 10, hi: 14, unit: 'weeks', rule: '10–14 weeks inclusive' },
  selection_rule: { prefer_instrument: [], timepoint_rule: 'closest_to', timepoint_target_weeks: 12, population_rule: null, tie_break: 'needs_decision' },
  mid: { value: 1, scale: '0–10', source: null }, measure_preference: null, source_form_id: 'f1',
};

const group = (patch: Partial<SynthesisGroup> = {}): SynthesisGroup => ({
  id: 'g1', project_id: 'p1', title: 'Pain', branch: 'ma', target,
  target_confirmed_by: 'u1', target_confirmed_at: '2026-09-21T00:00:00Z', protocol_version: 1,
  created_by: 'u1', created_at: '', updated_at: '', ...patch,
});

const columns = ['outcome', 'timepoint', 'comparison', 'scale', 'mean_t', 'sd_t', 'n_t', 'mean_c', 'sd_c', 'n_c', 'design'];

function input(rows: LongFormatRow[], decisions: SynthesisDecision[] = [], patch: Partial<ModelInput> = {}): ModelInput {
  return {
    group: group(), decisions, sourceForm: wideForm, rows, columns,
    defaults: [{ kind: 'continuous', measure: 'MD', preset: { model: 'random', tau2: 'reml', ci: 'hk' } }],
    designByDocument: {}, subgroupColumns: [], ...patch,
  };
}

const smith = wideRow('smith', 'Smith 2024', {});
const jones = wideRow('jones', 'Jones 2023', { mean_t: '3.2', sd_t: '2.6', n_t: '71', mean_c: '6.8', sd_c: '2.9', n_c: '70' });
const okafor = wideRow('okafor', 'Okafor 2022', { timepoint: '84 days', mean_t: '4.8', sd_t: '2.2', n_t: '98', mean_c: '6.3', sd_c: '2.1', n_c: '101' });
const khan = wideRow('khan', 'Khan 2021', { timepoint: '24 weeks', mean_t: '4.4', n_t: '60', mean_c: '6.1', n_c: '62' });
const weber = wideRow('weber', 'Weber 2025', { timepoint: 'NR', mean_t: '4.3', mean_c: '6.2' });
const garcia = wideRow('garcia', 'Garcia 2019', { outcome: 'Pain relief', scale: 'Relief score 0-10', mean_t: '6.1', mean_c: '3.3' });
const nausea = wideRow('nguyen', 'Nguyen 2021', { outcome: 'Nausea' });
const rossi = wideRow('rossi', 'Rossi 2023', { mean_t: '5.1', mean_c: '6.0' }, 'ai');
const other = wideRow('lee', 'Lee 2022', { comparison: 'Drug B vs placebo' });

// ── 1. Timepoints ────────────────────────────────────────────────────────────
{
  close('12 weeks', weeksOf('12 weeks'), 12);
  close('84 days = 12 weeks', weeksOf('84 days'), 12);
  close('week 12', weeksOf('Week 12'), 12);
  close('12-week follow-up', weeksOf('12-week follow-up'), 12);
  close('3 months', weeksOf('3 months'), 13.035, 1e-3);
  check('NR is unknown', weeksOf('NR') === null);
  check('a range is unknown', weeksOf('6–8 weeks') === null);
  check('end of treatment is unknown', weeksOf('end of treatment') === null);
  check('a bare number is unknown', weeksOf('12') === null);
}

// ── 2. Candidate eligibility ─────────────────────────────────────────────────
{
  const m = deriveModel(input([smith, okafor, khan, weber, garcia, nausea, other]));
  const byDoc = (d: string) => m.studies.find(s => s.documentId === d)!;
  check('direct label inside the window is eligible', byDoc('smith').eligibility === 'eligible');
  check('84 days is inside 10–14 weeks', byDoc('okafor').eligibility === 'eligible');
  check('24 weeks is outside the window', byDoc('khan').eligibility === 'not_eligible'
    && byDoc('khan').candidates[0].reasonCode === 'outside_window');
  check('NR timepoint → needs decision, never auto-matched', byDoc('weber').eligibility === 'needs_decision'
    && byDoc('weber').candidates[0].reasonCode === 'timepoint_unknown');
  check('related free-text label → needs instrument decision', byDoc('garcia').need === 'instrument');
  check('unrelated outcome is not a candidate', !m.studies.some(s => s.documentId === 'nguyen') && m.unrelatedRows === 1);
  check('different comparison is not eligible', byDoc('lee').eligibility === 'not_eligible'
    && byDoc('lee').candidates[0].reasonCode === 'comparison_mismatch');
  check('pending decisions are blocking', m.blocking.some(b => b.ref === studyRef('weber')) && m.blocking.some(b => b.ref === studyRef('garcia')));
  check('only ready studies enter the dataset', m.dataset.map(r => r.document_id).sort().join() === 'okafor,smith');
  const eng = m.transformations.find(t => t.documentId === 'okafor' && t.kind === 'timepoint_normalisation');
  check('84 days carries an engine timepoint normalisation', !!eng && eng.state === 'engine');

  // Decisions resolve them.
  const khanRef = resultRef(byDoc('khan').candidates[0]);
  const weberRef = resultRef(byDoc('weber').candidates[0]);
  const m2 = deriveModel(input([smith, okafor, khan, weber, garcia, other], [
    dec('deviation', khanRef, { include: true }),
    dec('eligibility', weberRef, { include: true }),
    dec('instrument_match', labelRef('Pain relief'), { accepted: false }),
  ]));
  const b2 = (d: string) => m2.studies.find(s => s.documentId === d)!;
  check('a window deviation includes Khan', b2('khan').eligibility === 'eligible' && b2('khan').deviation);
  check('an include decision resolves the NR timepoint', b2('weber').eligibility === 'eligible');
  check('rejecting the construct makes Garcia not eligible', b2('garcia').eligibility === 'not_eligible');
  check('no blocking eligibility left', !m2.blocking.some(b => b.kind === 'eligibility' || b.kind === 'instrument'));

  const m3 = deriveModel(input([garcia, smith], [dec('instrument_match', labelRef('Pain relief'), { accepted: true })]));
  const g3 = m3.studies.find(s => s.documentId === 'garcia')!;
  check('accepting the construct makes Garcia eligible', g3.eligibility === 'eligible' && g3.selected!.matchedByDecision);
  check('the scale direction reversal is then proposed', g3.transformations.some(t => t.kind === 'reverse_direction' && t.state === 'open'));
  const ambiguous = wideRow('garcia', 'Garcia 2019', { outcome: 'Pain relief', scale: 'Pain relief 0-10' });
  const m3c = deriveModel(input([ambiguous, smith], [dec('instrument_match', labelRef('Pain relief'), { accepted: true, reversed: true })]));
  check('an ambiguous scale is reversed only when the construct decision says so',
    m3c.studies.find(s => s.documentId === 'garcia')!.transformations.some(t => t.kind === 'reverse_direction' && t.state === 'open'));
  const m3d = deriveModel(input([ambiguous, smith], [dec('instrument_match', labelRef('Pain relief'), { accepted: true })]));
  check('an ambiguous scale is never reversed on a guess',
    !m3d.studies.find(s => s.documentId === 'garcia')!.transformations.some(t => t.kind === 'reverse_direction'));
  const m3b = deriveModel(input([garcia, smith]));
  const g3b = m3b.studies.find(s => s.documentId === 'garcia')!;
  check('before the construct decision the reversal is blocked', g3b.transformations.some(t => t.kind === 'reverse_direction' && t.state === 'blocked'));

  // A revoked decision is no longer in force.
  const revoked = { ...dec('deviation', khanRef, { include: true }), revoked_at: '2026-09-25T11:00:00Z' };
  const m4 = deriveModel(input([khan], [revoked]));
  check('a revoked deviation stops applying', m4.studies[0].eligibility === 'not_eligible');

  // Orientation.
  const rev = wideRow('park', 'Park 2020', { comparison: 'placebo vs Drug A' });
  const cand = evaluateCandidate({
    key: 'k', groupKey: 'k', documentId: 'park', label: 'Park 2020', outcome: 'Pain VAS', timepoint: '12 weeks',
    comparison: 'placebo vs Drug A', treatmentRow: rev, comparatorRow: rev, sharedComparator: false,
  }, target, []);
  check('comparator-first contrast is asked, not flipped', cand?.eligibility === 'needs_decision' && cand.reasonCode === 'orientation');
}

// ── 3. Selection rule ────────────────────────────────────────────────────────
{
  const j10 = wideRow('jones', 'Jones 2023', { timepoint: '10 weeks' });
  const j12 = wideRow('jones', 'Jones 2023', { timepoint: '12 weeks' });
  const j14 = wideRow('jones', 'Jones 2023', { timepoint: '14 weeks' });
  const m = deriveModel(input([j10, j12, j14]));
  const s = m.studies[0];
  check('engine picks the timepoint closest to 12 weeks', s.selectedBy === 'engine_rule' && s.selected?.timepoint === '12 weeks');
  check('one effect per study', m.dataset.length === 1);

  const tieA = wideRow('jones', 'Jones 2023', { timepoint: '11 weeks' });
  const tieB = wideRow('jones', 'Jones 2023', { timepoint: '13 weeks' });
  const mt = deriveModel(input([tieA, tieB]));
  check('an exact tie is your decision', mt.studies[0].need === 'tie' && mt.studies[0].eligibility === 'needs_decision');
  const pick = resultRef(mt.studies[0].candidates.find(c => c.timepoint === '13 weeks')!);
  const mt2 = deriveModel(input([tieA, tieB], [dec('eligibility', studyRef('jones'), { selected: pick })]));
  check('a human selection resolves the tie', mt2.studies[0].selectedBy === 'human_decision' && mt2.studies[0].selected?.timepoint === '13 weeks');

  const latest = { ...target, selection_rule: { ...target.selection_rule, timepoint_rule: 'latest' as const } };
  const ml = deriveModel(input([j10, j12, j14], [], { group: group({ target: latest }) }));
  check('latest rule picks 14 weeks', ml.studies[0].selected?.timepoint === '14 weeks');
  const vas = wideRow('jones', 'Jones 2023', { outcome: 'Pain VAS' });
  const nrs = wideRow('jones', 'Jones 2023', { outcome: 'Pain NRS' });
  const pref = { ...target, outcome_labels: ['Pain VAS', 'Pain NRS'], selection_rule: { ...target.selection_rule, prefer_instrument: ['NRS', 'VAS'] } };
  const mp = deriveModel(input([vas, nrs], [], { group: group({ target: pref }) }));
  check('preferred instrument outranks the timepoint', mp.studies[0].selected?.outcome === 'Pain NRS');
}

// ── 4. Source review ─────────────────────────────────────────────────────────
{
  const m = deriveModel(input([smith, rossi]));
  const r = m.studies.find(s => s.documentId === 'rossi')!;
  check('AI-only row starts unreviewed', r.sourceReview === 'unreviewed' && r.readiness === 'source_unreviewed');
  check('unreviewed row is outside the dataset', !m.dataset.some(d => d.document_id === 'rossi'));
  check('unreviewed row blocks', m.blocking.some(b => b.kind === 'source_review'));
  check('no transformation offered before review', r.transformations.length === 0);

  const rossiFp = r.sourceFingerprint;
  check('a study exposes the fingerprint its review binds to', typeof rossiFp === 'string' && rossiFp.length > 0);
  const acc = deriveModel(input([smith, rossi], [dec('source_review', studyRef('rossi'), { state: 'accepted', result_id: rossi._resultId, row_fingerprint: rossiFp })]));
  check('accept as-is admits the row', acc.dataset.some(d => d.document_id === 'rossi') && acc.blocking.length === 0);

  const stale = deriveModel(input([smith, rossi], [dec('source_review', studyRef('rossi'), { state: 'accepted', result_id: 'an-older-row' })]));
  check('acceptance of a different row is stale', stale.studies.find(s => s.documentId === 'rossi')!.sourceReview === 'unreviewed');

  const rej = deriveModel(input([smith, rossi], [dec('source_review', studyRef('rossi'), { state: 'rejected', result_id: rossi._resultId })]));
  const rr = rej.studies.find(s => s.documentId === 'rossi')!;
  check('a rejected row is resolved and excluded (mock deadlock fixed)', rr.readiness === 'excluded' && !rej.dataset.some(d => d.document_id === 'rossi')
    && !rej.blocking.some(b => b.ref === studyRef('rossi')));

  const req = deriveModel(input([smith, rossi], [dec('source_review', studyRef('rossi'), { state: 'correction_requested', result_id: rossi._resultId })]));
  check('a requested correction still blocks', req.blocking.some(b => b.ref === studyRef('rossi')));
  const fixed = wideRow('rossi', 'Rossi 2023', { mean_t: '5.3', mean_c: '6.0' }, 'manual');
  const done = deriveModel(input([smith, fixed], [dec('source_review', studyRef('rossi'), { state: 'correction_requested', result_id: rossi._resultId })]));
  const dr = done.studies.find(s => s.documentId === 'rossi')!;
  check('the corrected human row resolves the study', dr.sourceReview === 'corrected' && done.dataset.some(d => d.document_id === 'rossi'));
}

// ── 5. Transformations ───────────────────────────────────────────────────────
{
  const longForm: SynthesisSourceForm = {
    form_id: 'f2', field_name: 'arms', kind: 'continuous', layout: 'long',
    mapping: { arm: 'arm', outcome: 'outcome', timepoint: 'timepoint', value: 'value', variability: 'variability', denominator: 'n' },
    comparator_value: 'Placebo', units: {}, confirmed_by: 'u1', confirmed_at: '2026-09-20T00:00:00Z',
  };
  const arm = (doc: string, a: string, v: string, sd: string, measure: string, n: string, type: 'consensus' | 'ai' = 'consensus'): LongFormatRow => ({
    arm: a, outcome: 'Pain VAS', timepoint: '12 weeks', value: v, variability: sd, variability_measure: measure, n,
    Paper: doc, _paperFilename: doc, _resultId: `r-${doc}`, _documentId: doc, _extractionType: type, _rawCells: {},
  } as LongFormatRow);
  const rows = [
    arm('lee', 'Drug A', '4.2', '0.31', 'SE', '60'), arm('lee', 'Placebo', '6.6', '0.34', 'SE', '58'),
    arm('smith', 'Drug A', '4.1', '2.3', 'SD', '88'), arm('smith', 'Placebo', '6.5', '2.5', 'SD', '86'),
  ];
  const cols = ['arm', 'outcome', 'timepoint', 'value', 'variability', 'variability_measure', 'n'];
  const base = { sourceForm: longForm, columns: cols, group: group({ target: { ...target, source_form_id: 'f2', comparison: { ...target.comparison, intervention: '', comparator: '' } } }) };
  const m = deriveModel(input(rows, [], base));
  const lee = m.studies.find(s => s.documentId === 'lee')!;
  const t = lee.transformations.find(x => x.kind === 'se_to_sd');
  check('SE → SD is proposed for Lee', !!t && t.state === 'open');
  check('Lee needs transformation and is not in the dataset', lee.readiness === 'needs_transformation' && !m.dataset.some(d => d.document_id === 'lee'));
  check('Smith (SD reported) needs nothing', m.studies.find(s => s.documentId === 'smith')!.readiness === 'ready');
  const hashBefore = datasetHash(JSON.parse(JSON.stringify(m.dataset)));
  const conv = dec('transformation', transformRef('lee', 'se_to_sd'), { kind: 'se_to_sd', confirmed: true, fingerprint: t!.fingerprint });
  const m2 = deriveModel(input(rows, [conv], base));
  const lee2 = m2.dataset.find(d => d.document_id === 'lee');
  check('confirmed conversion admits Lee', !!lee2);
  check('Lee is marked derived', !!lee2?.derived);
  close('SD = SE × √n', (lee2?.arms?.treatment as any)?.sd, 0.31 * Math.sqrt(60), 1e-9);
  check('the decision id travels with the row', (lee2?.transformations ?? []).length === 1);
  const hashAfter = datasetHash(JSON.parse(JSON.stringify(m2.dataset)));
  check('confirming a transformation changes the dataset hash', hashBefore !== hashAfter);
  check('the same inputs give the same hash', hashAfter === datasetHash(JSON.parse(JSON.stringify(deriveModel(input(rows, [conv], base)).dataset))));

  // Rescale 0–100 → 0–10, applied only once confirmed; the raw row is untouched.
  const park = wideRow('park', 'Park 2020', { scale: 'Pain VAS 0-100', mean_t: '44', sd_t: '20', mean_c: '63', sd_c: '22' });
  const mr = deriveModel(input([smith, jones, park]));
  const pr = mr.studies.find(s => s.documentId === 'park')!;
  check('a rescale is proposed for the 0–100 study', pr.transformations.some(x => x.kind === 'rescale' && x.factor === 0.1));
  const rescaleFp = pr.transformations.find(x => x.kind === 'rescale')!.fingerprint;
  const mr2 = deriveModel(input([smith, jones, park], [dec('transformation', transformRef('park', 'rescale'), { confirmed: true, fingerprint: rescaleFp })]));
  close('confirmed rescale divides the mean by 10', (mr2.dataset.find(d => d.document_id === 'park')?.arms?.treatment as any)?.mean, 4.4, 1e-12);
  check('the raw extracted row is never overwritten', park.mean_t === '44');

  // Cluster design effect needs ICC + m and is its own transformation.
  const ng = wideRow('nguyen', 'Nguyen 2021', {});
  const mc = deriveModel(input([ng], [], { designByDocument: { nguyen: 'Cluster RCT' } }));
  check('cluster design → design-effect transformation asking for ICC', mc.studies[0].transformations.some(x => x.kind === 'cluster_design_effect' && x.needsInput === 'icc'));
  const clFp = mc.studies[0].transformations.find(x => x.kind === 'cluster_design_effect')!.fingerprint;
  const mc2 = deriveModel(input([ng], [dec('transformation', transformRef('nguyen', 'cluster_design_effect'), { confirmed: true, icc: 0.02, m: 10, fingerprint: clFp })], { designByDocument: { nguyen: 'Cluster RCT' } }));
  close('n_eff = n / (1 + (m−1)·ICC)', (mc2.dataset[0]?.arms?.treatment as any)?.n, 88 / 1.18, 1e-9);
  check('randomised n is kept beside effective n', mc2.dataset[0]?.n_randomised === 174 && Math.abs((mc2.dataset[0]?.n_effective ?? 0) - 174 / 1.18) < 1e-9);
}

// ── 6. Runs, snapshots and staleness ─────────────────────────────────────────
{
  const rows = [smith, jones, okafor, wideRow('park', 'Park 2020', { mean_t: '4.4', sd_t: '2.0', mean_c: '6.3', sd_c: '2.2' }), wideRow('lee', 'Lee 2022', { mean_t: '4.2', mean_c: '6.6' })];
  const m = deriveModel(input(rows));
  const cfg = runConfigOf(m, target);
  check('protocol preset is REML + HK', cfg.tau2 === 'reml' && cfg.ci === 'hk' && cfg.model === 'random');
  const dataset = JSON.parse(JSON.stringify(m.dataset));
  const snap = studiesFromDataset(dataset);
  const a = readAs(runMeta(m.datasetStudies, cfg));
  const b = readAs(runMeta(snap, cfg));
  close('snapshot reproduces the live pooled estimate', b.pooled?.est, a.pooled!.est, 1e-12);
  close('snapshot reproduces the HK interval', b.pooled?.lo, a.pooled!.lo, 1e-12);
  check('HK interval is the one read', a.hksj !== null && a.pooled!.lo === a.hksj!.lo);
  check('k = 5 reports a prediction interval', b.prediction !== null);

  const analyses = analysesOf([{ id: 'p', analysis_type: 'Primary', description: 'Primary', field: null },
    { id: 's1', analysis_type: 'Sensitivity', description: 'Exclude derived SDs', field: 'exclude_derived_sd' },
    { id: 'sg', analysis_type: 'Subgroup', description: 'By dose', field: 'dose_group' }] as PlannedAnalysis[], []);
  const outs = computeRunOutputs(m.datasetStudies, cfg, analyses);
  check('the planned derived-SD sensitivity is computed automatically', !!outs.sensitivities.exclude_derived_sd);
  check('run outputs carry k', outs.k === 5);
  const hash = datasetHash(dataset);
  const run: SynthesisRun = {
    id: 'run1', group_id: 'g1', n: 1, dataset_hash: hash, dataset, config: cfg as any, outputs: outs as any,
    partial: false, omitted: [], engine_version: 'x', by: 'u1', at: '2026-09-25T12:00:00Z',
  };
  const st = analysisStatuses(analyses, run, []);
  check('derived-SD sensitivity counts as run (mock deadlock fixed)', st.find(x => x.id === 's1')!.status === 'run');
  check('a subgroup with no data is pending, not silently run', st.find(x => x.id === 'sg')!.status === 'pending');
  const st2 = analysisStatuses(analyses, run, [dec('analysis_not_run', 'analysis:sg', {}, 'no dose field extracted')]);
  check('not-run with reason resolves it', st2.find(x => x.id === 'sg')!.status === 'not_run');

  check('fresh run is not stale', !staleDiff(run, dataset, hash, cfg).stale);
  const m2 = deriveModel(input([...rows, wideRow('weber', 'Weber 2025', { mean_t: '4.3', mean_c: '6.2' })]));
  const ds2 = JSON.parse(JSON.stringify(m2.dataset));
  const diff = staleDiff(run, ds2, datasetHash(ds2), cfg);
  check('an added study makes the run stale with a diff', diff.stale && diff.added.includes('Weber 2025'));
  const diffCfg = staleDiff(run, dataset, hash, { ...cfg, model: 'fixed' });
  check('a configuration change makes the run stale', diffCfg.stale && diffCfg.configChanged.length === 1);
  // The stored dataset comes back from JSONB with its object keys reordered.
  const reorder = (x: unknown): unknown => Array.isArray(x) ? x.map(reorder)
    : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x as Record<string, unknown>).reverse().map(([k, v]) => [k, reorder(v)])) : x;
  const jsonbRun = { ...run, dataset: reorder(dataset) as typeof dataset };
  const diffJ = staleDiff(jsonbRun, ds2, datasetHash(ds2), cfg);
  check('key order from JSONB does not report unchanged rows as changed', diffJ.changed.length === 0 && diffJ.added.includes('Weber 2025'),
    diffJ.changed.join(', '));

  // Deviation preset.
  const md = deriveModel(input(rows, [dec('deviation', PRESET_REF, { preset: { model: 'fixed', tau2: 'dl', ci: 'z' } })]));
  check('a logged preset deviation is the preset in force', md.preset.model === 'fixed' && !!md.presetDeviation);

  // Audit + status.
  const pooled = [dec('pooling', 'group', { decision: 'pool' })];
  const ctx = (latestRun: SynthesisRun | null, decisions: SynthesisDecision[], statuses = st2) => ({
    model: m, currentHash: hash, latestRun, diff: staleDiff(latestRun, dataset, hash, cfg), branch: 'ma' as const,
    decisions, analyses: statuses, robMissing: [],
  });
  check('no pooling decision blocks the audit', !auditPasses(auditRows(ctx(run, []))));
  check('audit passes with everything recorded', auditPasses(auditRows(ctx(run, pooled))));
  check('a pending planned analysis blocks', !auditPasses(auditRows(ctx(run, pooled, st))));
  check('a partial run never passes', !auditPasses(auditRows(ctx({ ...run, partial: true }, pooled))));
  check('no run blocks', !auditPasses(auditRows(ctx(null, pooled))));
  const swimCtx = { ...ctx(run, [dec('pooling', 'group', { decision: 'do_not_pool' })]), branch: 'swim' as const };
  check('after a switch to SWiM, the meta-analysis run does not pass the run row',
    auditRows(swimCtx).find(r => r.id === 'run')!.ok === false);
  const swimRun = { ...run, config: { ...(run.config as object), branch: 'swim' } as any };
  check('a SWiM run passes the run row on the SWiM branch',
    auditRows({ ...swimCtx, latestRun: swimRun }).find(r => r.id === 'run')!.ok === true);
  check('server branch-change record counts as a pooling decision', poolingOf([dec('pooling', 'group', { branch: 'swim', previous: 'ma' })]).choice === 'do_not_pool');

  check('status: draft before confirmation', deriveStatus({ targetConfirmed: false, blockingCount: 1, runs: 0, versions: [], currentHash: hash }).key === 'draft');
  check('status: ready when nothing blocks', deriveStatus({ targetConfirmed: true, blockingCount: 0, runs: 0, versions: [], currentHash: hash }).key === 'ready');
  check('status: in progress after a run', deriveStatus({ targetConfirmed: true, blockingCount: 0, runs: 1, versions: [], currentHash: hash }).key === 'in_progress');
  const v = { n: 1, status: 'finalized' as const, dataset_hash: hash, superseded_by: null };
  check('status: finalized v1', deriveStatus({ targetConfirmed: true, blockingCount: 0, runs: 1, versions: [v], currentHash: hash }).label === 'Finalized v1');
  check('status: awaiting approval', deriveStatus({ targetConfirmed: true, blockingCount: 0, runs: 1, versions: [{ ...v, status: 'awaiting' }], currentHash: hash }).key === 'awaiting');
  check('status: needs review once the hash moves', deriveStatus({ targetConfirmed: true, blockingCount: 0, runs: 1, versions: [v], currentHash: 'other' }).key === 'needs_review');
  const vMa = { ...v, bundle: { branch: 'ma' } };
  check('status: a version frozen as a meta-analysis needs review after a switch to SWiM',
    deriveStatus({ targetConfirmed: true, blockingCount: 0, runs: 1, versions: [vMa], currentHash: hash, branch: 'swim' }).key === 'needs_review');
  check('status: same branch stays finalized',
    deriveStatus({ targetConfirmed: true, blockingCount: 0, runs: 1, versions: [vMa], currentHash: hash, branch: 'ma' }).label === 'Finalized v1');
}

// ── 7. Presets and SWiM ──────────────────────────────────────────────────────
{
  check('RR with Peto is refused', !validateDefault({ kind: 'dichotomous', measure: 'RR', preset: { model: 'peto', tau2: 'dl', ci: 'z' } }).ok);
  check('HK on a common-effect model is refused', !validateDefault({ kind: 'continuous', measure: 'MD', preset: { model: 'fixed', tau2: 'dl', ci: 'hk' } }).ok);
  check('MD under REML + HK is valid', validateDefault({ kind: 'continuous', measure: 'MD', preset: { model: 'random', tau2: 'reml', ci: 'hk' } }).ok);
  check('OR measure for continuous data is refused', !validateDefault({ kind: 'continuous', measure: 'OR', preset: { model: 'random', tau2: 'reml', ci: 'hk' } }).ok);

  const m = deriveModel(input([smith, jones, okafor, wideRow('x', 'Xu 2020', { mean_t: '7', mean_c: '5' })]));
  const sw = buildSwim({
    studies: m.datasetStudies, noData: [{ ref: 'study:z', documentId: 'z', label: 'Zed 2019', group: '' }],
    measure: 'MD', lowerIsBenefit: true, groupOf: () => 'All', success: 'benefit',
  });
  const all = sw.groups.find(g => g.name === 'All')!;
  check('SWiM: direction from the point estimate', all.count.success === 3 && all.count.withDirection === 4);
  check('SWiM: no-data study listed but outside denominators', sw.overall.nodata === 1 && sw.overall.withDirection === 4);
}

// ── 8. Comparator-first results are turned to the target contrast ───────────
{
  // Repro: "placebo vs Drug A", placebo mean 6, Drug A mean 4 → MD must be −2 for "Drug A vs placebo".
  const pk = wideRow('park', 'Park 2020', { comparison: 'placebo vs Drug A', mean_t: '6', sd_t: '2', n_t: '50', mean_c: '4', sd_c: '2', n_c: '50' });
  const m0 = deriveModel(input([pk]));
  const c0 = m0.studies[0].candidates[0];
  check('comparator-first row is flagged reversed', c0.reversed && c0.reasonCode === 'orientation');
  const m1 = deriveModel(input([pk], [dec('eligibility', c0.ref, { include: true })]));
  const row = m1.dataset[0];
  check('accepted orientation admits the study', !!row);
  close('arms swapped: treatment is Drug A (mean 4)', (row?.arms?.treatment as any)?.mean, 4);
  close('arms swapped: comparator is placebo (mean 6)', (row?.arms?.comparator as any)?.mean, 6);
  const r1 = runMeta(m1.datasetStudies, runConfigOf(m1, target));
  close('MD reads −2, not +2', r1.studies[0]?.est, -2, 1e-9);

  // Dichotomous: RR inverts.
  const bin = { key: 'b', label: 'B', documentId: 'b', treatment: { events: 20, total: 100 }, comparator: { events: 10, total: 100 } } as any;
  const ob = orientStudy(bin, 'RR');
  check('events / totals swap with the arms', ob.treatment!.events === 10 && ob.comparator!.events === 20);
  const rrBefore = runMeta([bin], { ...runConfigOf(m1, target), measure: 'RR', model: 'fixed' }).studies[0]?.est;
  const rrAfter = runMeta([ob], { ...runConfigOf(m1, target), measure: 'RR', model: 'fixed' }).studies[0]?.est;
  close('RR inverts (2 → 0.5)', rrAfter, 1 / (rrBefore ?? NaN), 1e-9);

  // Effect-only, ratio reported on the natural scale: y negated, est inverted, CI bounds swapped.
  const pre = { key: 'p', label: 'P', documentId: 'p', precomputed: { y: Math.log(2), se: 0.2, reported: { est: 2, lo: 1.5, hi: 3, se: null, scale: 'natural', derivedFrom: 'ci' } } } as any;
  const op = orientStudy(pre, 'HR' as any);
  close('log effect negated', op.precomputed!.y, -Math.log(2), 1e-12);
  close('ratio est inverted', op.precomputed!.reported.est, 0.5, 1e-12);
  close('lower bound = 1 / upper', op.precomputed!.reported.lo, 1 / 3, 1e-12);
  close('upper bound = 1 / lower', op.precomputed!.reported.hi, 1 / 1.5, 1e-12);
  const preMd = { key: 'q', label: 'Q', documentId: 'q', precomputed: { y: 2, se: 0.5, reported: { est: 2, lo: 1, hi: 3, se: 0.5, scale: 'natural', derivedFrom: 'se' } } } as any;
  const oq = orientStudy(preMd, 'MD');
  check('difference negated with CI swapped', oq.precomputed!.y === -2 && oq.precomputed!.reported.est === -2
    && oq.precomputed!.reported.lo === -3 && oq.precomputed!.reported.hi === -1);
  check('an intervention-first row is never swapped', !deriveModel(input([smith])).studies[0].selected!.reversed);
}

// ── 9. Tied rows keep distinct identities ────────────────────────────────────
{
  const a = wideRow('jones', 'Jones 2023', { mean_t: '4' });
  const b = wideRow('jones', 'Jones 2023', { mean_t: '8' });
  const m = deriveModel(input([a, b]));
  const [ca, cb] = m.studies[0].candidates;
  check('same labels, distinct ids', ca.ref !== cb.ref && ca.legacyRef === cb.legacyRef);
  check('tied rows need a decision', m.studies[0].need === 'tie');
  const pick8 = m.studies[0].candidates.find(c => c.pairing.treatmentRow.mean_t === '8')!.ref;
  const m2 = deriveModel(input([a, b], [dec('eligibility', studyRef('jones'), { selected: pick8 })]));
  check('selecting the mean-8 row selects the mean-8 row', m2.studies[0].selected?.pairing.treatmentRow.mean_t === '8');
  close('and the dataset carries mean 8', (m2.dataset[0]?.arms?.treatment as any)?.mean, 8);
  const m3 = deriveModel(input([b, a], [dec('eligibility', studyRef('jones'), { selected: pick8 })]));
  check('ids are stable when the rows come back in another order', m3.studies[0].selected?.pairing.treatmentRow.mean_t === '8');
  const legacy = deriveModel(input([a, b], [dec('eligibility', studyRef('jones'), { selected: resultRef(ca) })]));
  check('an old label-only selection over tied rows is flagged ambiguous, not resolved to the first',
    legacy.studies[0].selected === null && legacy.studies[0].need === 'tie' && /same labels/.test(legacy.studies[0].eligibilityReason));
  const lone = deriveModel(input([a, wideRow('jones', 'Jones 2023', { timepoint: '13 weeks' })], [dec('eligibility', studyRef('jones'), { selected: resultRef(ca) })]));
  check('an old selection still resolves when unambiguous', lone.studies[0].selectedBy === 'human_decision' && lone.studies[0].selected?.timepoint === '12 weeks');
  const dup = { ...a, _resultId: 'other' } as LongFormatRow;
  const refs = [...resultRefsOf(deriveModel(input([a, dup])).studies[0].candidates.map(c => c.pairing)).values()];
  check('byte-identical rows still get distinct ids', new Set(refs).size === 2);
  check('row fingerprint ignores bookkeeping fields', rowContentFingerprint([a]) === rowContentFingerprint([dup]));
}

// ── 10. Staleness covers every analysis dependency ───────────────────────────
{
  const rows = [smith, jones, okafor];
  const m = deriveModel(input(rows));
  const analyses = analysesOf([{ id: 'p', analysis_type: 'Primary', description: '', field: null },
    { id: 'r', analysis_type: 'Sensitivity', description: '', field: 'exclude_high_rob' }] as PlannedAnalysis[], []);
  const cfg = runConfigOf(m, target, { decisions: [], analyses, robHigh: new Set(['smith', 'not-in-dataset']), robAssessed: true });
  check('rob inputs are limited to dataset studies', JSON.stringify(cfg.rob_high) === '["smith"]');
  const dataset = JSON.parse(JSON.stringify(m.dataset));
  const hash = datasetHash(dataset);
  const run = { dataset, dataset_hash: hash, config: JSON.parse(JSON.stringify(cfg)) } as SynthesisRun;
  check('same config is not stale', !staleDiff(run, dataset, hash, cfg).stale);
  const stale = (name: string, c: typeof cfg, r = run) => {
    const d = staleDiff(r, dataset, hash, c);
    check(`${name} → stale`, d.stale && d.configChanged.length >= 1, d.text);
    check(`${name} → config key differs`, analysisConfigKey(r.config) !== analysisConfigKey(c, { branch: r.config.branch === 'swim' ? 'swim' : 'ma' }));
  };
  stale('proportion method', { ...cfg, proportion_method: 'arcsine' });
  stale('direction convention', { ...cfg, lower_is_benefit: !cfg.lower_is_benefit });
  stale('MID', { ...cfg, mid: 2 });
  stale('analyses', { ...cfg, analyses: [...(cfg.analyses ?? []), 'Subgroup:dose'] });
  stale('risk-of-bias judgements', { ...cfg, rob_high: [] });
  stale('risk-of-bias assessed', { ...cfg, rob_assessed: false });
  stale('τ² method', { ...cfg, tau2: 'dl' });
  stale('CI method', { ...cfg, ci: 'z' });
  const swimRun = { ...run, config: { ...run.config, branch: 'swim', grouping: '__outcome', success: 'benefit' } } as SynthesisRun;
  check('SWiM run with the recorded grouping is fresh', !staleDiff(swimRun, dataset, hash, cfg).stale);
  const grouped = runConfigOf(m, target, { decisions: [dec('pooling', SWIM_GROUPING_REF, { grouping: 'dose', success: 'benefit' })], analyses, robHigh: new Set(['smith']), robAssessed: true });
  stale('SWiM grouping', grouped, swimRun);
  const harm = runConfigOf(m, target, { decisions: [dec('pooling', SWIM_GROUPING_REF, { grouping: '__outcome', success: 'harm' })], analyses, robHigh: new Set(['smith']), robAssessed: true });
  stale('SWiM success direction', harm, swimRun);

  // Things that change no number stay fresh.
  const fixedRun = { ...run, config: { ...run.config, model: 'fixed', ci: 'z' } } as SynthesisRun;
  check('τ² under a common-effect model is not a change', !staleDiff(fixedRun, dataset, hash, { ...cfg, model: 'fixed', ci: 'z', tau2: 'dl' }).stale);
  const noRobPlan = runConfigOf(m, target, { analyses: [], robHigh: new Set(['smith']), robAssessed: true });
  const noRobRun = { ...run, config: JSON.parse(JSON.stringify(noRobPlan)) } as SynthesisRun;
  check('RoB changes without a RoB sensitivity are not a change', !staleDiff(noRobRun, dataset, hash, { ...noRobPlan, rob_high: [] }).stale);
  const oldRun = { ...run, config: { measure: cfg.measure, model: cfg.model, tau2: cfg.tau2, ci: cfg.ci, mid: cfg.mid, proportion_method: cfg.proportion_method, lower_is_benefit: cfg.lower_is_benefit } } as SynthesisRun;
  check('a run recorded before the new fields is not stale for lacking them', !staleDiff(oldRun, dataset, hash, cfg).stale);
  check('config key ignores key order and preset_source', analysisConfigKey({ ...cfg, preset_source: 'deviation' }) === analysisConfigKey(JSON.parse(JSON.stringify(cfg))));
}

// ── 11. The saved variability-measure column is used ─────────────────────────
{
  const longForm: SynthesisSourceForm = {
    form_id: 'f3', field_name: 'arms', kind: 'continuous', layout: 'long',
    mapping: { arm: 'arm', outcome: 'outcome', timepoint: 'timepoint', value: 'value', variability: 'variability', denominator: 'n' },
    comparator_value: 'Placebo', units: { variabilityMeasureColumn: 'spread_kind' }, confirmed_by: 'u1', confirmed_at: '2026-09-20T00:00:00Z',
  };
  const arm = (a: string, v: string, sd: string, n: string): LongFormatRow => ({
    arm: a, outcome: 'Pain VAS', timepoint: '12 weeks', value: v, variability: sd, spread_kind: 'SE', n,
    Paper: 'lee', _paperFilename: 'lee', _resultId: 'r-lee', _documentId: 'lee', _extractionType: 'consensus', _rawCells: {},
  } as LongFormatRow);
  const rows = [arm('Drug A', '4.2', '0.31', '60'), arm('Placebo', '6.6', '0.34', '58')];
  const cols = ['arm', 'outcome', 'timepoint', 'value', 'variability', 'spread_kind', 'n'];
  const tgt = { ...target, source_form_id: 'f3', comparison: { ...target.comparison, intervention: '', comparator: '' } };
  const base = { sourceForm: longForm, columns: cols, group: group({ target: tgt }) };
  const m = deriveModel(input(rows, [], base));
  check('the saved column is the one read', m.variabilityMeasureColumn === 'spread_kind');
  const t = m.studies[0].transformations.find(x => x.kind === 'se_to_sd');
  check('SE in an oddly named column → SE → SD proposed', !!t && t.state === 'open');
  const m2 = deriveModel(input(rows, [dec('transformation', transformRef('lee', 'se_to_sd'), { confirmed: true, fingerprint: t?.fingerprint })], base));
  close('and applied once confirmed', (m2.dataset[0]?.arms?.treatment as any)?.sd, 0.31 * Math.sqrt(60), 1e-9);
  const mNo = deriveModel(input(rows, [], { ...base, sourceForm: { ...longForm, units: {} } }));
  check('without a saved column the heuristic is the fallback', mNo.variabilityMeasureColumn === null);
  const mGone = deriveModel(input(rows, [], { ...base, sourceForm: { ...longForm, units: { variabilityMeasureColumn: 'no_such_column' } } }));
  check('a saved column that no longer exists falls back', mGone.variabilityMeasureColumn === null);
}

// ── 12. Approvals bind to what was approved ──────────────────────────────────
{
  const m = deriveModel(input([smith, rossi]));
  const fp = m.studies.find(s => s.documentId === 'rossi')!.sourceFingerprint;
  const accept = dec('source_review', studyRef('rossi'), { state: 'accepted', result_id: rossi._resultId, row_fingerprint: fp });
  const edited = wideRow('rossi', 'Rossi 2023', { mean_t: '9.9', mean_c: '6.0' }, 'ai');
  check('same record id, same _resultId', edited._resultId === rossi._resultId);
  const me = deriveModel(input([smith, edited], [accept]));
  const re = me.studies.find(s => s.documentId === 'rossi')!;
  check('a changed row invalidates the acceptance', re.sourceReview === 'unreviewed' && re.sourceReviewStale && !me.dataset.some(d => d.document_id === 'rossi'));
  const old = deriveModel(input([smith, rossi], [dec('source_review', studyRef('rossi'), { state: 'accepted', result_id: rossi._resultId })]));
  check('an acceptance without a fingerprint needs re-review', old.studies.find(s => s.documentId === 'rossi')!.sourceReview === 'unreviewed');

  const longForm: SynthesisSourceForm = {
    form_id: 'f2', field_name: 'arms', kind: 'continuous', layout: 'long',
    mapping: { arm: 'arm', outcome: 'outcome', timepoint: 'timepoint', value: 'value', variability: 'variability', denominator: 'n' },
    comparator_value: 'Placebo', units: {}, confirmed_by: 'u1', confirmed_at: '2026-09-20T00:00:00Z',
  };
  const arm = (a: string, v: string, sd: string, n: string): LongFormatRow => ({
    arm: a, outcome: 'Pain VAS', timepoint: '12 weeks', value: v, variability: sd, variability_measure: 'SE', n,
    Paper: 'lee', _paperFilename: 'lee', _resultId: 'r-lee', _documentId: 'lee', _extractionType: 'consensus', _rawCells: {},
  } as LongFormatRow);
  const cols = ['arm', 'outcome', 'timepoint', 'value', 'variability', 'variability_measure', 'n'];
  const base = { sourceForm: longForm, columns: cols, group: group({ target: { ...target, source_form_id: 'f2', comparison: { ...target.comparison, intervention: '', comparator: '' } } }) };
  const rows = [arm('Drug A', '4.2', '0.31', '60'), arm('Placebo', '6.6', '0.34', '58')];
  const t = deriveModel(input(rows, [], base)).studies[0].transformations.find(x => x.kind === 'se_to_sd')!;
  const conf = dec('transformation', t.ref, { kind: 'se_to_sd', confirmed: true, fingerprint: t.fingerprint });
  check('confirmed against these inputs', deriveModel(input(rows, [conf], base)).studies[0].transformations.find(x => x.kind === 'se_to_sd')!.state === 'confirmed');
  const changed = [arm('Drug A', '4.2', '0.45', '60'), arm('Placebo', '6.6', '0.34', '58')];
  const tc = deriveModel(input(changed, [conf], base)).studies[0];
  const tt = tc.transformations.find(x => x.kind === 'se_to_sd')!;
  check('changed inputs invalidate the confirmation', tt.state === 'open' && tt.approvalStale && tc.readiness === 'needs_transformation');
  const legacyConf = dec('transformation', t.ref, { kind: 'se_to_sd', confirmed: true });
  const tl = deriveModel(input(rows, [legacyConf], base)).studies[0].transformations.find(x => x.kind === 'se_to_sd')!;
  check('a confirmation without a fingerprint needs re-confirming', tl.state === 'open' && tl.approvalStale);
}

// ── Report ───────────────────────────────────────────────────────────────────

if (failures.length > 0) {
  console.error(`\n  ${failures.length} FAILED of ${passed + failures.length}:\n`);
  for (const f of failures) console.error(`   x ${f}`);
  console.error('');
  process.exit(1);
}
console.log(`\n  synthesisModel.ts — ${passed} checks passed\n`);

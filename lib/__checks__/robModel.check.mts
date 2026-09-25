/**
 * Self-check for the rebuilt Risk of Bias model (robModel.ts) and the
 * effect-of-adhering pathway added to rob2.ts.
 *
 *   node --experimental-strip-types --import ./lib/__checks__/register-alias.mjs \
 *        lib/__checks__/robModel.check.mts
 *
 * Pins: Table 8 (adhering) row by row; a schema-3 save reads back identically;
 * a Sep 15 record (2.1–2.3 in the per-comparison trial zone, overrides only)
 * reads forward without losing answers or judgements; D1 lives once per study.
 */

import {
  judgeDomainFor, routeAllFor, suggestDomain, type Answers,
} from '../../app/(dashboard)/risk-of-bias/_lib/rob2.ts';
import {
  EMPTY_D1 as EMPTY_D1_FOR_CHECK, derive, emptyAssessment, outcomeKeyOf, readRecord, writeRecord, type StudyD1,
} from '../../app/(dashboard)/risk-of-bias/_lib/robModel.ts';
import { bindSignalling } from '../../app/(dashboard)/risk-of-bias/_lib/robSignalling.ts';
import { bindForm } from '../../app/(dashboard)/risk-of-bias/_lib/robAdapter.ts';
import { presetFormFields, ROB2 } from '../../app/(dashboard)/risk-of-bias/_lib/robTools.ts';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) { failures++; console.log(`FAIL ${label} ${detail}`); } else console.log(`ok   ${label}`);
};

// ── Table 8 · effect of adhering ────────────────────────────────────────────
const adh = { effect: 'adherence' as const };
const J = (a: Answers, opts: any = adh) => judgeDomainFor(1, a, opts);
check('adh: both blinded, no failures/non-adherence → Low',
  J({ '2.1': 'N', '2.2': 'PN', '2.4': 'N', '2.5': 'PN' }) === 'low');
check('adh: aware, NPIs balanced, no failures → Low',
  J({ '2.1': 'Y', '2.2': 'N', '2.3': 'PY', '2.4': 'N', '2.5': 'N' }) === 'low');
check('adh: blinded, implementation failure, appropriate analysis → Some',
  J({ '2.1': 'N', '2.2': 'N', '2.4': 'PY', '2.5': 'N', '2.6': 'Y' }) === 'some');
check('adh: blinded, non-adherence NI, inappropriate analysis → High',
  J({ '2.1': 'N', '2.2': 'N', '2.4': 'N', '2.5': 'NI', '2.6': 'N' }) === 'high');
check('adh: aware, NPIs unbalanced, appropriate analysis → Some',
  J({ '2.1': 'PY', '2.2': 'N', '2.3': 'N', '2.4': 'N', '2.5': 'N', '2.6': 'PY' }) === 'some');
check('adh: aware, NPIs NI, 2.6 NI → High',
  J({ '2.1': 'NI', '2.2': 'N', '2.3': 'NI', '2.4': 'N', '2.5': 'N', '2.6': 'NI' }) === 'high');
check('adh: 2.6 not asked when no deviation',
  routeAllFor({ '2.1': 'N', '2.2': 'N', '2.4': 'N', '2.5': 'N' }, adh)['2.6'] === 'skipped');
check('adh: 2.6 waits on unanswered 2.5',
  routeAllFor({ '2.1': 'N', '2.2': 'N', '2.4': 'N' }, adh)['2.6'] === 'waiting');
check('adh: 2.3 skipped when blinded',
  routeAllFor({ '2.1': 'N', '2.2': 'N' }, adh)['2.3'] === 'skipped');
check('adh: only non-adherence addressed → 2.3/2.4 skipped',
  (() => { const r = routeAllFor({ '2.1': 'Y', '2.2': 'Y' }, { effect: 'adherence', deviations: ['nonadherence'] }); return r['2.3'] === 'skipped' && r['2.4'] === 'skipped' && r['2.5'] === 'asked'; })());
check('adh: incomplete → null', J({ '2.1': 'N' }) === null);
check('assignment path unchanged (2.1/2.2 N, 2.6 Y → Low)',
  judgeDomainFor(1, { '2.1': 'N', '2.2': 'N', '2.6': 'Y' }) === 'low');
check('2.7 never asked under adhering', routeAllFor({ '2.6': 'N' }, adh)['2.7'] === 'skipped');
check('suggestion carries a reason', !!suggestDomain(0, { '1.1': 'Y', '1.2': 'Y', '1.3': 'N' }).reason);

// ── Storage round trip ──────────────────────────────────────────────────────
const fields = presetFormFields(ROB2) as any[];
const bound = bindForm({ id: 'f', form_name: 'RoB', fields } as any)!;
const table = fields.find(f => f.field_name === 'risk_of_bias_assessments');
const binding = bindSignalling(table.subform_fields);
check('preset binds', !!bound && binding.usable);
const ctx = { binding, effect: 'assignment' as const, deviations: ['nonprotocol', 'implementation', 'nonadherence'] as any };
const domains = bound.domains.filter(d => !d.extra);

const study: StudyD1 = { answers: { '1.1': 'Y', '1.2': 'Y', '1.3': 'N' }, support: { '1.1': 'computer-generated' }, quotes: {} };
const a = emptyAssessment({ id: 'r1', kind: 'result', label: 'Pain · 6 h' }, 'assignment', ctx.deviations);
Object.assign(a.answers, { '2.1': 'N', '2.2': 'N', '2.6': 'Y', '3.1': 'Y', '4.1': 'N', '4.2': 'N', '4.3': 'N', '5.1': 'Y', '5.2': 'N', '5.3': 'N' });
a.judgement = ['low', 'low', 'low', 'high', 'low'];
a.rationale[3] = 'assessor unblinded in practice';
a.overall = 'high'; a.complete = true; a.prelimConfirmed = true; a.sourcesObtained = ['article'];
a.quotes['3.1'] = { quote: 'All 120 completed', locator: 'p.4' };

const o = emptyAssessment({ id: outcomeKeyOf('  Pain '), kind: 'outcome', label: 'Pain' }, 'adherence', ['nonadherence']);
o.answers['2.1'] = 'N'; o.answers['2.2'] = 'N'; o.answers['2.5'] = 'Y';

let data = writeRecord(undefined, binding, { assessment: a, study, domains, tool: bound.tool, tableField: bound.tableField! });
data = writeRecord(data, binding, { assessment: o, study, domains, tool: bound.tool, tableField: bound.tableField! });
const back = readRecord(data, ctx, bound.tableField!);
const ra = back.assessments.get('r1')!;
check('D1 read once per study', back.d1.answers['1.2'] === 'Y' && back.d1.support['1.1'] === 'computer-generated');
check('D1 not stored in the entry', !('1.1' in ra.answers));
check('entry answers round-trip', ra.answers['2.6'] === 'Y' && ra.answers['5.3'] === 'N');
check('judgements round-trip', JSON.stringify(ra.judgement) === JSON.stringify(a.judgement) && ra.overall === 'high');
check('rationale + quote + prelim round-trip', ra.rationale[3] === a.rationale[3] && ra.quotes['3.1']?.quote === 'All 120 completed' && ra.sourcesObtained[0] === 'article');
check('override needs rationale (D4 differs)', derive(back.d1, ra).needsRationale[3] === true && derive(back.d1, ra).canComplete);
const ro = back.assessments.get('outcome:pain');
check('outcome target stored as its own entry', !!ro && ro.kind === 'outcome' && ro.effect === 'adherence' && ro.deviations.join() === 'nonadherence');
check('outcome entry does not touch the result entry', back.assessments.size === 2);

// ── Legacy (Sep 15) record reads forward ────────────────────────────────────
const legacy: any = {
  rob_trial: { c1: { d1_1: 'Yes', d1_2: 'Probably yes', d1_3: 'No', d2_1: 'No', d2_2: 'No' } },
  risk_of_bias_assessments: [{
    result_id: 'r9', outcome_assessed: 'Pain · 6 h',
    d2_1: 'Yes', // stale copy from the older design — must lose to the trial zone
    d2_6: 'Yes', d3_1: 'Yes', d4_1: 'No', d4_2: 'No', d4_3: 'No', d5_1: 'Yes', d5_2: 'No', d5_3: 'No',
    rob_workflow: JSON.stringify({ confirmed: [true, true, true, true, true], complete: true, overrides: { '3': 'some' }, override_why: { '3': 'x' } }),
  }],
};
const lv = readRecord(legacy, { ...ctx, contrastIdOf: () => 'c1' });
const la = lv.assessments.get('r9')!;
check('legacy D1 from the comparison zone', lv.d1.answers['1.2'] === 'PY');
check('legacy 2.1 from the trial zone, not the stale entry copy', la.answers['2.1'] === 'N');
check('legacy confirmed → derived judgement; override kept', la.judgement[0] === 'low' && la.judgement[3] === 'some' && la.rationale[3] === 'x');
check('legacy complete → overall derived', la.complete && la.overall === 'some');

// ── Server-shaped record (every root key enveloped by the provenance merge) ──
const wrap = (v: any) => ({ value: v, status: 'reported', provenance: { origin: 'human_authored' }, source_text: '' });
const served: any = {};
for (const [k, v] of Object.entries(data)) {
  served[k] = k === 'risk_of_bias_assessments'
    ? wrap((v as any[]).map(row => Object.fromEntries(Object.entries(row).map(([c, x]) => [c, wrap(x)]))))
    : wrap(v);
}
const sv = readRecord(served, ctx, bound.tableField!);
check('enveloped rob_schema still reads as schema 3', sv.assessments.get('r1')?.legacy === false && sv.d1.answers['1.2'] === 'Y');
check('enveloped entries read back', sv.assessments.size === 2 && sv.assessments.get('r1')?.answers['2.6'] === 'Y');
const again = writeRecord(served, binding, { assessment: sv.assessments.get('r1')!, study: sv.d1, domains, tool: bound.tool, tableField: bound.tableField! });
check('re-save posts the table as a BARE list', Array.isArray(again.risk_of_bias_assessments) && again.risk_of_bias_assessments.length === 2);
const legacyServed: any = { rob_trial: wrap(legacy.rob_trial), risk_of_bias_assessments: wrap(legacy.risk_of_bias_assessments) };
const lsv = readRecord(legacyServed, { ...ctx, contrastIdOf: () => 'c1' });
check('enveloped legacy rob_trial map is read', lsv.d1.answers['1.2'] === 'PY' && lsv.assessments.get('r9')?.answers['2.1'] === 'N');

// ── Audit fixes (Sep 24): judgeable domains, overall floor, locator kept ─────
{
  const bare = emptyAssessment({ id: 'x', kind: 'outcome', label: 'x' }, 'assignment', []);
  bare.prelimConfirmed = true;
  bare.judgement = ['low', 'some', 'some', 'high', 'some'];
  bare.overall = 'high'; bare.overallRationale = 'r';
  const dd = derive(EMPTY_D1_FOR_CHECK, bare);
  check('B2: judgements with no answers are not ready', dd.judgeable.every(x => !x) && !dd.domainReady.some(Boolean) && !dd.canComplete);
}
{
  const full = { ...a, answers: { ...a.answers }, judgement: [...a.judgement] as any };
  full.overall = 'some'; full.overallRationale = 'milder';
  const dd = derive(study, full);
  check('B3: overall milder than worst domain blocks completion', dd.worstDomain === 'high' && dd.overallTooLow && !dd.canComplete);
  full.overall = 'high';
  check('B3: overall at the worst domain is allowed', !derive(study, full).overallTooLow);
  const noPrelim = { ...full, prelimConfirmed: false };
  check('B2: completion needs Preliminary confirmed', !derive(study, noPrelim).canComplete);
}
{
  const cell: any = (data as any).risk_of_bias_assessments.find((r: any) => r.result_id === 'r1')?.d3_1;
  check('B4: locator stored as an object the server keeps', !!cell && typeof cell === 'object' && cell.source_location && typeof cell.source_location === 'object' && cell.source_location.label === 'p.4');
  check('B4: locator reads back', ra.quotes['3.1']?.locator === 'p.4');
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);

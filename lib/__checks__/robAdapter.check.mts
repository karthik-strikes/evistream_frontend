/**
 * Self-check for the risk-of-bias instrument and adapter.
 *
 *   node --experimental-strip-types --import ./lib/__checks__/register-alias.mjs \
 *        lib/__checks__/robAdapter.check.mts
 *
 * Run against the **real** form files in `zforms/`, not against fixtures. The
 * whole reason this layer exists is that those six forms disagree with each
 * other, so a fixture that agrees with itself would prove nothing. The previous
 * implementation read forms directly and could see three of the six; the first
 * assertion below is that all six now bind.
 *
 * Two properties matter more than the rest:
 *   - a hedged judgment ("Probably Low") must never read as clean ("Low"),
 *   - writing must refuse an ambiguous mapping rather than pick one.
 */

import { readdirSync, readFileSync } from 'node:fs';
import {
  bindForm,
  type BoundForm,
} from '../../app/(dashboard)/risk-of-bias/_lib/robAdapter.ts';
import {
  presetFormFields, ROB1, ROB2, ROBINS_I, toCanonicalJudgment, toFormOption,
} from '../../app/(dashboard)/risk-of-bias/_lib/robTools.ts';
import { rowsOf } from '../../app/(dashboard)/risk-of-bias/_lib/robForm.ts';
import type { Form } from '../../types/api.ts';

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

// ── Load every real risk-of-bias form ────────────────────────────────────────

const ROOT = '/home/ubuntu/evistream/zforms';
const realForms: Array<{ file: string; form: Form }> = [];
for (const dir of readdirSync(ROOT)) {
  let files: string[] = [];
  try { files = readdirSync(`${ROOT}/${dir}`); } catch { continue; }
  for (const file of files) {
    if (!/rob|risk_of_bias/i.test(file)) continue;
    const raw = JSON.parse(readFileSync(`${ROOT}/${dir}/${file}`, 'utf8'));
    if (!raw || Array.isArray(raw) || !raw.fields) continue;
    realForms.push({ file, form: { id: file, form_name: raw.form_name ?? file, fields: raw.fields } as Form });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Every real form binds — the failure that prompted this rework
// ─────────────────────────────────────────────────────────────────────────────

const bounds = new Map<string, BoundForm>();
{
  check('the corpus has the six known RoB forms', realForms.length === 6, String(realForms.length));

  for (const { file, form } of realForms) {
    const bound = bindForm(form);
    check(`${file} binds to an instrument`, bound !== null);
    if (bound) bounds.set(file, bound);
  }
  check('ALL SIX FORMS BIND', bounds.size === realForms.length,
    `${bounds.size} of ${realForms.length}`);

  // Tool detection must tell the RoB 1 forms from the RoB 2 ones.
  const expectTool: Record<string, string> = {
    'acute_dental_pain_risk_of_bias.json': 'rob2',
    'corticosteroids_risk_of_bias.json': 'rob2',
    'local_anesthetics_risk_of_bias.json': 'rob2',
    'rob2_parallel_trial.json': 'rob2',
    'cd010266_risk_of_bias.json': 'rob1',
    'cd004714_risk_of_bias.json': 'rob1',
  };
  for (const [file, want] of Object.entries(expectTool)) {
    const bound = bounds.get(file);
    check(`${file} is recognised as ${want}`, bound?.tool.id === want, bound?.tool.id);
  }

  // Flat vs table storage, both supported.
  check('a table-shaped form reports its table',
    bounds.get('acute_dental_pain_risk_of_bias.json')?.tableField === 'risk_of_bias_assessments');
  check('a flat form reports no table',
    bounds.get('cd010266_risk_of_bias.json')?.tableField === null);
  check('a table form finds its outcome columns',
    (bounds.get('acute_dental_pain_risk_of_bias.json')?.outcomeColumns.length ?? 0) === 2);
  check('a flat form has no outcome dimension',
    (bounds.get('cd010266_risk_of_bias.json')?.outcomeColumns.length ?? 0) === 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Domains come from the instrument, in the instrument's order
// ─────────────────────────────────────────────────────────────────────────────
{
  const adp = bounds.get('acute_dental_pain_risk_of_bias.json')!;
  check('RoB 2 always shows five canonical domains',
    adp.domains.filter(d => !d.extra).length === 5);
  check('...with canonical codes', adp.domains.filter(d => !d.extra).map(d => d.code).join(',') === 'D1,D2,D3,D4,D5');
  check('...with published names, not the form\'s column names',
    adp.domains[0].name === 'Randomization process', adp.domains[0].name);
  check('...bound to the form\'s columns',
    adp.domains[0].column === 'domain1_randomization_judgment', String(adp.domains[0].column));
  check('...and paired with _justification',
    adp.domains[0].rationaleColumn === 'domain1_randomization_justification');

  // The RoB 1 form names its companion column `_reason`, not `_justification`.
  const legacy = bounds.get('cd010266_risk_of_bias.json')!;
  check('a _reason column is found as the rationale',
    legacy.domains.find(d => d.code === 'I1')?.rationaleColumn === 'random_sequence_generation_reason',
    String(legacy.domains.find(d => d.code === 'I1')?.rationaleColumn));
  check('RoB 1 binds its seven items', legacy.domains.filter(d => !d.extra && d.column).length >= 6,
    String(legacy.domains.filter(d => !d.extra && d.column).length));

  // The proper RoB 2 form uses `_support`, and its signalling questions must not
  // be mistaken for domain judgments.
  const proper = bounds.get('rob2_parallel_trial.json')!;
  check('a _support column is found as the rationale',
    proper.domains.find(d => d.code === 'D1')?.rationaleColumn === 'domain1_support',
    String(proper.domains.find(d => d.code === 'D1')?.rationaleColumn));
  check('signalling questions are NOT bound as domains',
    proper.domains.every(d => !/^d\d+_\d+/.test(d.column ?? '')),
    JSON.stringify(proper.domains.map(d => d.column)));

  // The SIGNALLING guard is unreachable on today's corpus, because the real
  // signalling questions (`d1_1_allocation_sequence_random`) don't contain the
  // word "judgment" and are already excluded. A form that named them
  // `d1_1_..._judgment` WOULD reach it, so the guard is exercised deliberately
  // here rather than left as untested defensive code.
  const withSignalling = bindForm({
    id: 'sig', form_name: 'RoB 2 with signalling',
    fields: [
      { field_name: 'd1_1_allocation_sequence_judgment', field_type: 'select', options: ['Yes', 'No'] },
      { field_name: 'd1_2_allocation_concealed_judgment', field_type: 'select', options: ['Yes', 'No'] },
      { field_name: 'domain1_randomization_judgment', field_type: 'select', options: [...ROB2.judgments] },
      { field_name: 'domain1_randomization_support', field_type: 'text' },
      { field_name: 'domain3_missing_data_judgment', field_type: 'select', options: [...ROB2.judgments] },
    ],
  } as unknown as Form);
  check('a signalling question is never bound as a domain',
    withSignalling?.domains.every(d => !/^d\d+_\d+/.test(d.column ?? '')) === true,
    JSON.stringify(withSignalling?.domains.map(d => d.column)));
  check('...so D1 binds the real domain column instead',
    withSignalling?.domains.find(d => d.code === 'D1')?.column === 'domain1_randomization_judgment',
    String(withSignalling?.domains.find(d => d.code === 'D1')?.column));
  check('...and signalling questions are not surfaced as extra domains either',
    withSignalling?.domains.every(d => !d.extra) === true,
    JSON.stringify(withSignalling?.domains.filter(d => d.extra).map(d => d.column)));

  // A domain a form adds beyond the instrument is kept, flagged, not dropped.
  const extra = bounds.get('cd004714_risk_of_bias.json')!;
  check('a non-standard extra domain is surfaced, not silently dropped',
    extra.domains.some(d => d.extra), JSON.stringify(extra.domains.map(d => d.code)));
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Conformance — which forms actually speak their tool's vocabulary
// ─────────────────────────────────────────────────────────────────────────────
{
  const proper = bounds.get('rob2_parallel_trial.json')!;
  check('the properly built RoB 2 form is conforming', proper.conforming === true);
  check('...because it declares the tool\'s own judgments',
    proper.domains.find(d => d.code === 'D1')?.needsTranslation === false);

  const adp = bounds.get('acute_dental_pain_risk_of_bias.json')!;
  check('the four-level form is NOT conforming', adp.conforming === false);
  const d1 = adp.domains.find(d => d.code === 'D1')!;
  check('...its domain needs translation', d1.needsTranslation === true);
  // Two of its options mean "Some concerns", so that judgment cannot be stored.
  check('...and "Some concerns" is unwritable in it',
    d1.unwritable.includes('Some concerns'), JSON.stringify(d1.unwritable));
  check('...while Low and High remain writable',
    !d1.unwritable.includes('Low risk of bias') && !d1.unwritable.includes('High risk of bias'),
    JSON.stringify(d1.unwritable));
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Reading is lossy only in the safe direction
// ─────────────────────────────────────────────────────────────────────────────
{
  const c = (raw: string) => toCanonicalJudgment(raw, ROB2);
  check('"Low" reads as low', c('Low') === 'Low risk of bias');
  check('"High" reads as high', c('High') === 'High risk of bias');
  // THE property: hedged must never read as clean.
  check('"Probably Low" does NOT read as low', c('Probably Low') === 'Some concerns',
    String(c('Probably Low')));
  check('"Probably High" reads as some concerns', c('Probably High') === 'Some concerns');
  check('the tool\'s own wording passes through', c('Some concerns') === 'Some concerns');
  check('"Low risk of bias" passes through', c('Low risk of bias') === 'Low risk of bias');
  check('an empty judgment reads as nothing', c('') === null);
  check('unrecognised wording reads as nothing rather than a guess',
    c('banana') === null, String(c('banana')));
  check('"No information" is preserved where the tool has it',
    toCanonicalJudgment('No information', ROBINS_I) === 'No information');

  // RoB 1's own vocabulary.
  check('RoB1 "Unclear risk" maps to its middle', toCanonicalJudgment('Unclear', ROB1) === 'Unclear risk');
  check('RoB1 "Low risk" maps to its best', toCanonicalJudgment('Low risk', ROB1) === 'Low risk');
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Writing refuses to guess
// ─────────────────────────────────────────────────────────────────────────────
{
  const fourLevel = ['Low', 'Probably Low', 'Probably High', 'High'];
  const low = toFormOption('Low risk of bias', fourLevel, ROB2);
  check('Low maps to the form\'s single low option',
    !!low && 'option' in low && low.option === 'Low', JSON.stringify(low));
  const high = toFormOption('High risk of bias', fourLevel, ROB2);
  check('High maps to the form\'s single high option',
    !!high && 'option' in high && high.option === 'High', JSON.stringify(high));

  // THE property: two options mean the same thing, so it must refuse.
  const some = toFormOption('Some concerns', fourLevel, ROB2);
  check('Some concerns REFUSES rather than picking one of two',
    !!some && 'ambiguous' in some, JSON.stringify(some));
  check('...and names both candidates',
    !!some && 'ambiguous' in some && some.ambiguous.length === 2, JSON.stringify(some));

  // A conforming form stores everything verbatim.
  for (const j of ROB2.judgments) {
    const target = toFormOption(j, ROB2.judgments, ROB2);
    check(`a conforming form stores "${j}" verbatim`,
      !!target && 'option' in target && target.option === j);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. The preset produces a form that needs no translation at all
// ─────────────────────────────────────────────────────────────────────────────
{
  for (const tool of [ROB2, ROBINS_I, ROB1]) {
    const generated = { id: 'gen', form_name: 'x', fields: presetFormFields(tool) } as unknown as Form;
    const bound = bindForm(generated);
    check(`the ${tool.id} preset binds to itself`, bound?.tool.id === tool.id, bound?.tool.id);
    check(`the ${tool.id} preset covers every domain`,
      bound?.coverage === tool.domains.length, `${bound?.coverage} of ${tool.domains.length}`);
    check(`the ${tool.id} preset needs no translation`, bound?.conforming === true);
    check(`the ${tool.id} preset adds no extra domains`,
      bound?.domains.every(d => !d.extra) === true);
    check(`the ${tool.id} preset can store every judgment`,
      bound?.domains.every(d => d.unwritable.length === 0) === true,
      JSON.stringify(bound?.domains.map(d => d.unwritable)));
    check(`the ${tool.id} preset pairs every domain with a rationale`,
      bound?.domains.every(d => !!d.rationaleColumn) === true);
    check(`the ${tool.id} preset stores one row per outcome`,
      bound?.tableField === 'risk_of_bias_assessments' && bound.outcomeColumns.length === 1);
  }
}

// ── Report ───────────────────────────────────────────────────────────────────

if (failures.length > 0) {
  console.error(`\n  ${failures.length} FAILED of ${passed + failures.length}:\n`);
  for (const f of failures) console.error(`   x ${f}`);
  console.error('');
  process.exit(1);
}

console.log(`\n  robTools.ts + robAdapter.ts — ${passed} checks passed (against 6 real forms)\n`);

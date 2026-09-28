/**
 * Runs the SHARED conditional-question cases against the TypeScript mirror.
 *
 *   node --experimental-strip-types --import ./lib/__checks__/register-alias.mjs \
 *        lib/__checks__/fieldConditions.check.mts
 *
 * The same file is run by backend/tests/test_field_conditions.py against
 * utils/field_conditions.py. If this fails and pytest passes (or the reverse),
 * the two evaluators disagree — fix the mirror, not the case.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { evaluate, evaluateRow, validateConditions, dependentsOf, renameReferences, connectCondition, disconnectCondition, reorderForConditions } from '../fieldConditions.ts';

const here = dirname(fileURLToPath(import.meta.url));
const CASES = JSON.parse(readFileSync(resolve(here, '../../../backend/tests/fixtures/field_conditions_cases.json'), 'utf8'));
const FORMS = CASES.forms;
const fieldsOf = (c: any) => c.fields ?? FORMS[c.form];

let failures = 0;
function same(a: unknown, b: unknown, what: string) {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (ok) console.log(`  ok   ${what}`);
  else { failures++; console.error(`  FAIL ${what}\n       expected ${JSON.stringify(b)}\n       got      ${JSON.stringify(a)}`); }
}
const pick = (o: Record<string, any>, keys: string[]) => Object.fromEntries(keys.map(k => [k, o[k]]));

console.log('\nevaluate');
for (const c of CASES.evaluate) {
  same(pick(evaluate(fieldsOf(c), c.answers), Object.keys(c.expect)), c.expect, c.name);
}
console.log('\nevaluateRow');
for (const c of CASES.evaluate_row) {
  const fields = fieldsOf(c);
  const table = fields.find((f: any) => f.field_name === c.table);
  const states = evaluate(fields, c.answers);
  same(pick(evaluateRow(table, c.row, c.answers, states, fields), Object.keys(c.expect)), c.expect, c.name);
}
console.log('\nvalidateConditions');
for (const c of CASES.validate) same(validateConditions(fieldsOf(c)), c.expect, c.name);

console.log('\nreferences');
same(dependentsOf(FORMS.table, 'design'), ['periods → washout_days'], 'column dependents of a top-level field');
{
  const out = renameReferences(FORMS.ae, 'ae_reported', 'any_ae');
  same(out.find((f: any) => f.field_name === 'ae_types').condition.field, 'any_ae', 'rename rewrites references');
  same(FORMS.ae.find((f: any) => f.field_name === 'ae_types').condition.field, 'ae_reported', 'input untouched');
}

console.log('\nlogic map: connect / disconnect');
{
  const base: any[] = [
    { field_name: 'notes', field_type: 'text' },
    { field_name: 'ae_types', field_type: 'text' },
    { field_name: 'ae_reported', field_type: 'select', options: ['Yes', 'No', 'NR'] },
    { field_name: 'events', field_type: 'array', key_columns: ['arm'], subform_fields: [
      { field_name: 'arm', field_type: 'text' },
      { field_name: 'outcome', field_type: 'text' },
      { field_name: 'severity', field_type: 'select', options: ['Mild', 'Serious'] } ] },
  ];
  const r1 = connectCondition(base, { field: 'ae_reported', value: 'Yes' }, { field: 'ae_types' });
  const f1 = r1.fields!;
  same(f1.map(f => f.field_name), ['notes', 'ae_reported', 'ae_types', 'events'], 'follow-up moved below its parent');
  same(f1.find(f => f.field_name === 'ae_types')!.condition, { field: 'ae_reported', op: 'equals', values: ['Yes'] }, 'rule written');
  same(validateConditions(f1), [], 'result is valid');
  same(/Moved Ae Types below Ae Reported/.test(r1.note || ''), true, 'says it moved it');
  const f2 = connectCondition(f1, { field: 'ae_reported', value: 'NR' }, { field: 'ae_types' }).fields!;
  same(f2.find(f => f.field_name === 'ae_types')!.condition, { field: 'ae_reported', op: 'in', values: ['Yes', 'NR'] }, 'second answer widens to "is one of"');
  same(connectCondition(f2, { field: 'ae_types', value: 'x' }, { field: 'ae_reported' }).error !== undefined, true, 'loop refused');
  const row = connectCondition(f2, { field: 'events', column: 'severity', value: 'Serious' }, { field: 'events', column: 'outcome' });
  const cols = row.fields!.find(f => f.field_name === 'events')!.subform_fields!.map((c: any) => c.field_name);
  same(cols, ['arm', 'severity', 'outcome'], 'column follow-up moved right of its parent column');
  same((row.fields!.find(f => f.field_name === 'events')!.subform_fields as any[])[2].condition.from, 'row', 'same-row rule');
  same(/identifies a row/.test(connectCondition(f2, { field: 'events', column: 'severity', value: 'Mild' }, { field: 'events', column: 'arm' }).error || ''), true, 'key column refused');
  same(/own table/.test(connectCondition(f2, { field: 'events', column: 'severity', value: 'Mild' }, { field: 'notes' }).error || ''), true, 'column cannot unlock outside its table');
  const d1 = disconnectCondition(f2, { field: 'ae_types' }, 'NR');
  same(d1.find(f => f.field_name === 'ae_types')!.condition, { field: 'ae_reported', op: 'equals', values: ['Yes'] }, 'remove one answer');
  same(disconnectCondition(d1, { field: 'ae_types' }, 'Yes').find(f => f.field_name === 'ae_types')!.condition, null, 'removing the last answer clears the rule (null)');
  same(reorderForConditions(base).map(f => f.field_name), base.map(f => f.field_name), 'no rules = order untouched');
}

console.log(failures === 0 ? '\nAll field-condition checks passed.\n' : `\n${failures} check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);

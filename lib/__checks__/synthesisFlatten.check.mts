/**
 * Self-check: a synthesis source form flattens the table its mapping was made
 * against, not whichever one the relationship heuristic prefers.
 *
 *   node --experimental-strip-types --import ./lib/__checks__/register-alias.mjs \
 *        lib/__checks__/synthesisFlatten.check.mts
 *
 * The backend suggestion picks the widest table; `classifyFields` picks by join
 * relationship. When they disagree, the mapping named columns of one table while
 * the rows came from another — every mapped column read blank.
 */

import { fieldsForFlattening } from '../../app/(dashboard)/synthesis/_lib/mapping.ts';
import { classifyFields, transformToLongFormat } from '../longFormatTransform.ts';
import type { FormField } from '../../types/api.ts';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

const f = (field_name: string, extra: Partial<FormField> = {}): FormField =>
  ({ field_name, field_type: 'text', ...extra } as FormField);
const table = (field_name: string, cols: string[]): FormField =>
  f(field_name, { field_type: 'array', subform_fields: cols.map(c => f(c)) } as Partial<FormField>);

// "arms" (4 columns) shares arm_name with "outcomes" (3 columns): the join
// heuristic picks arms as deepest, the widest-table suggestion also picks arms.
// "baseline" (5 columns, no shared key) is a separate table.
const arms = table('arms', ['arm_name', 'n', 'dose', 'route']);
const outcomes = table('outcomes', ['arm_name', 'mean', 'sd']);
const baseline = table('baseline', ['age', 'sex', 'bmi', 'weight', 'height']);
const fields = [f('design'), arms, outcomes, baseline];
const heuristic = classifyFields(fields).deepestTableField?.field_name;

check('no field name keeps the heuristic', fieldsForFlattening(fields, null) === fields);
check('an unknown field name keeps the heuristic', fieldsForFlattening(fields, 'gone') === fields);
check('a flat field name keeps the heuristic', fieldsForFlattening(fields, 'design') === fields);
check('the heuristic choice keeps the full list (joins intact, dataset unchanged)',
  fieldsForFlattening(fields, heuristic) === fields, String(heuristic));

for (const name of ['arms', 'outcomes', 'baseline']) {
  const chosen = classifyFields(fieldsForFlattening(fields, name)).deepestTableField?.field_name;
  check(`naming "${name}" flattens "${name}"`, chosen === name, String(chosen));
}
const onlyBaseline = fieldsForFlattening(fields, 'baseline');
check('flat fields survive', onlyBaseline.some(x => x.field_name === 'design'));

const results = [{
  id: 'r1', document_id: 'd1',
  extracted_data: {
    design: 'RCT',
    arms: [{ arm_name: 'A', n: 10, dose: 1, route: 'po' }],
    outcomes: [{ arm_name: 'A', mean: 1, sd: 2 }],
    baseline: [{ age: 50, sex: 'F', bmi: 25, weight: 70, height: 160 }, { age: 51, sex: 'M', bmi: 26, weight: 80, height: 170 }],
  },
}];
const long = transformToLongFormat(results, onlyBaseline, { d1: { id: 'd1', filename: 'x.pdf' } });
check('rows come from the named table', long.rows.length === 2 && String(long.rows[1].age) === '51',
  JSON.stringify(long.rows.map(r => r.age)));

if (failures.length) {
  console.error(`\n  ${failures.length} FAILED of ${passed + failures.length}:\n`);
  for (const m of failures) console.error(`   x ${m}`);
  process.exit(1);
}
console.log(`\n  synthesis flattening — ${passed} checks passed\n`);

/**
 * Self-check for the long-format value flattening.
 *
 *   node --experimental-strip-types --import ./lib/__checks__/register-alias.mjs \
 *        lib/__checks__/longFormatScalar.check.mts
 *
 * These rows feed the Results table AND the CSV/JSON exports, so a value that
 * cannot be flattened is not a cosmetic problem — it ships. The first case is
 * the real one: 68 live AI cells held an object where the spec declared a
 * scalar and rendered the literal "[object Object]" everywhere.
 */

import { extractScalar, transformToLongFormat, tableAbsenceLabel } from '../longFormatTransform.ts';

let failures = 0;
function eq(actual: unknown, expected: unknown, what: string) {
  if (actual === expected) {
    console.log(`  ok   ${what}`);
  } else {
    failures++;
    console.error(`  FAIL ${what}\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`);
  }
}

console.log('\nAn object-valued envelope must never render "[object Object]"');
{
  const cell = {
    value: { histopathology_positive: 72, histopathology_negative: 26 },
    source_text: 'Table 2',
  };
  const out = extractScalar(cell);
  eq(out.includes('[object Object]'), false, 'no "[object Object]" anywhere');
  eq(out, 'histopathology_positive: 72; histopathology_negative: 26', 'flattened as key: value pairs');
}

console.log('\nNested one level deeper still reads');
{
  const cell = { value: { 'Total (%)': { Dysplastic: '39.13%', Nondysplastic: '60.87%' } } };
  eq(
    extractScalar(cell),
    'Total (%): Dysplastic: 39.13%; Nondysplastic: 60.87%',
    'recurses rather than bailing to [object Object]',
  );
}

console.log('\nThe shapes that already worked must keep working');
{
  eq(extractScalar(null), '', 'null');
  eq(extractScalar(undefined), '', 'undefined');
  eq(extractScalar('Brazil'), 'Brazil', 'bare string');
  eq(extractScalar(42), '42', 'bare number');
  eq(extractScalar(false), 'false', 'bare boolean');
  eq(extractScalar({ value: 'oral' }), 'oral', 'plain envelope');
  eq(extractScalar({ value: null }), '', 'envelope with no value');
  eq(extractScalar({ value: 0 }), '0', 'zero is a value, not an absence');
  eq(extractScalar({ value: '' }), '', 'empty string');
}

console.log('\nAbsence still wins over the value');
{
  // statusDisplay runs before the value is read, so an NR cell says NR even if
  // some stale payload is still sitting in `value`.
  eq(extractScalar({ value: 'stale', status: 'not_reported' }), 'NR', 'not_reported');
  eq(extractScalar({ value: 'stale', status: 'not_applicable' }), 'NA', 'not_applicable');
}

console.log('\nA whole-table verdict reaches every column (was blank → shown as "NR")');
{
  const fields: any[] = [
    { field_name: 'country', field_type: 'text' },
    { field_name: 'adverse_events', field_type: 'array', subform_fields: [
      { field_name: 'ae_type', field_type: 'text' }, { field_name: 'ae_n', field_type: 'number' } ] },
  ];
  const docs = { d1: { id: 'd1', filename: 'Raslan 2021.pdf' } };
  const run = (table: any) => transformToLongFormat(
    [{ id: 'r1', document_id: 'd1', extracted_data: { country: { value: 'US', status: 'reported' }, adverse_events: table } }],
    fields as any, docs as any,
  ).rows;

  const na = run({ value: 'NA', source_text: '', status: 'not_applicable' });
  eq(na.length, 1, 'one row for the paper');
  eq(na[0].ae_type, 'NA', 'NA envelope → "NA" in ae_type');
  eq(na[0].ae_n, 'NA', 'NA envelope → "NA" in ae_n');
  eq(na[0].country, 'US', 'flat field untouched');
  eq((na[0] as any)._rawCells.ae_type?.status, 'not_applicable', 'raw cell carries the table envelope');

  eq(run({ value: 'NR', status: 'not_reported' })[0].ae_type, 'NR', 'NR envelope → "NR"');
  eq(run({ value: 'NR', status: 'missing' })[0].ae_type, '⚠', 'failed table → failure marker, not NR');
  eq(run('NA')[0].ae_type, 'NA', 'legacy bare "NA" string → "NA"');
  eq(run({ value: [], status: 'reported' })[0].ae_type, '', 'empty row list stays blank');
  eq(run(undefined)[0].ae_type, '', 'absent field stays blank');
  eq(run({ value: [{ ae_type: { value: 'Nausea' }, ae_n: { value: 3 } }] })[0].ae_type, 'Nausea', 'real rows unchanged');
  eq(tableAbsenceLabel({ value: [{}] }), '', 'row list is not a verdict');
}

console.log('\nA parent table that is NA as a whole labels its columns on every child row');
{
  const fields: any[] = [
    { field_name: 'arms', field_type: 'array', subform_fields: [
      { field_name: 'arm', field_type: 'text' }, { field_name: 'dose', field_type: 'text' } ] },
    { field_name: 'outcomes', field_type: 'array', subform_fields: [
      { field_name: 'arm', field_type: 'text' }, { field_name: 'outcome', field_type: 'text' },
      { field_name: 'n', field_type: 'number' } ] },
  ];
  const rows = transformToLongFormat(
    [{ id: 'r1', document_id: 'd1', extracted_data: {
      arms: { value: 'NA', status: 'not_applicable' },
      outcomes: { value: [{ arm: { value: 'A' }, outcome: { value: 'Pain' }, n: { value: 10 } }] },
    } }],
    fields as any, { d1: { id: 'd1', filename: 'x.pdf' } } as any,
  ).rows;
  eq(rows[0].outcome, 'Pain', 'child row kept');
  eq(rows[0].dose, 'NA', 'parent-only column says NA, not blank');
}

console.log(failures === 0 ? '\nAll long-format flattening checks passed.\n' : `\n${failures} check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);

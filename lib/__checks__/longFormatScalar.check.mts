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

import { extractScalar } from '../longFormatTransform.ts';

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

console.log(failures === 0 ? '\nAll long-format flattening checks passed.\n' : `\n${failures} check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);

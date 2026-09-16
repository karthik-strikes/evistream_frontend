/**
 * Self-check for the vocabulary-independent risk-of-bias primitives.
 *
 *   node --experimental-strip-types --import ./lib/__checks__/register-alias.mjs \
 *        lib/__checks__/robForm.check.mts
 *
 * The instrument and the form binding are checked in `robAdapter.check.mts`
 * against the six real forms, and the algorithm in `rob2.check.mts`. What is
 * left here is reading a stored cell: the `{value, source_text}` envelope and
 * the two shapes a repeating table is stored in — neither of which depends on
 * which tool is in use.
 */

import {
  cellValue,
  rowsOf,
} from '../../app/(dashboard)/risk-of-bias/_lib/robForm.ts';

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Reading a stored cell
// ─────────────────────────────────────────────────────────────────────────────
{
  const wrapped = {
    assessments: { value: [{ a: 1 }], source_text: 'x', status: 'reported' },
  };
  check('the {value:[...]} envelope unwraps', rowsOf(wrapped, 'assessments').length === 1);
  check('a legacy bare array still reads',
    rowsOf({ assessments: [{ a: 1 }, { a: 2 }] }, 'assessments').length === 2);
  check('a missing table reads as no rows', rowsOf({}, 'assessments').length === 0);
  check('an NR table reads as no rows',
    rowsOf({ assessments: { value: 'NR' } }, 'assessments').length === 0);
  check('an undefined record reads as no rows', rowsOf(undefined, 'assessments').length === 0);

  check('a wrapped cell unwraps', cellValue({ c: { value: 'Low', source_text: 's' } }, 'c') === 'Low');
  check('a bare cell reads', cellValue({ c: 'High' }, 'c') === 'High');
  check('a numeric cell reads as text', cellValue({ c: 2013 }, 'c') === '2013');
  check('a null cell reads empty', cellValue({ c: null }, 'c') === '');
  check('a null-valued envelope reads empty', cellValue({ c: { value: null } }, 'c') === '');
  check('a missing column reads empty', cellValue({ c: 'x' }, 'other') === '');
  check('a null column reads empty', cellValue({ c: 'x' }, null) === '');
  check('whitespace is trimmed', cellValue({ c: '  Low  ' }, 'c') === 'Low');
}

// ── Report ───────────────────────────────────────────────────────────────────

if (failures.length > 0) {
  console.error(`\n  ${failures.length} FAILED of ${passed + failures.length}:\n`);
  for (const f of failures) console.error(`   x ${f}`);
  console.error('');
  process.exit(1);
}

console.log(`\n  robForm.ts primitives — ${passed} checks passed\n`);

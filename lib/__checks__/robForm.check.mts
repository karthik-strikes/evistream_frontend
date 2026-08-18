/**
 * Self-check for the vocabulary-independent risk-of-bias primitives.
 *
 *   node --experimental-strip-types --import ./lib/__checks__/register-alias.mjs \
 *        lib/__checks__/robForm.check.mts
 *
 * The instrument, the form binding and the judgment translation are checked in
 * `robAdapter.check.mts` against the six real forms. What is left here is the
 * shared scale, the overall rule, envelope reading, and where a study sits in
 * the dual-review pipeline — none of which depend on which tool is in use.
 */

import {
  assessmentStatus,
  cellValue,
  overallSeverity,
  rowsOf,
  type Severity,
} from '../../app/(dashboard)/risk-of-bias/_lib/robForm.ts';

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Overall — worst domain wins, and incomplete never reads as Low
// ─────────────────────────────────────────────────────────────────────────────
{
  const all = (s: Severity[]) => overallSeverity(s);
  check('all low gives low', all(['low', 'low', 'low', 'low', 'low']) === 'low');
  check('one concern makes it a concern', all(['low', 'some', 'low']) === 'some');
  check('one high makes it high', all(['low', 'some', 'high', 'low']) === 'high');
  check('high beats concerns', all(['some', 'high', 'some']) === 'high');
  check('order does not matter', all(['high', 'low']) === all(['low', 'high']));

  // The safety property: a half-finished assessment must not look clean.
  check('an unassessed domain makes the overall unassessed',
    all(['low', 'low', 'none', 'low']) === 'none');
  check('unassessed wins even over high', all(['high', 'none']) === 'none');
  check('no domains at all is unassessed', all([]) === 'none');
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Reading extraction records
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

// ─────────────────────────────────────────────────────────────────────────────
// 3. Status through the dual-review pipeline
// ─────────────────────────────────────────────────────────────────────────────
{
  const st = (o: Partial<Parameters<typeof assessmentStatus>[0]>) => assessmentStatus({
    hasAi: false, hasR1: false, hasR2: false, hasAdjudication: false, agreementPct: null, ...o,
  });

  check('nothing at all is not assessed', st({}) === 'none');
  check('only an AI pass is a draft', st({ hasAi: true }) === 'draft');
  check('one reviewer is awaiting the other', st({ hasAi: true, hasR1: true }) === 'awaiting');
  check('R2 alone also awaits', st({ hasR2: true }) === 'awaiting');
  check('both reviewers agreeing is agreed',
    st({ hasR1: true, hasR2: true, agreementPct: 100 }) === 'agreed');
  check('both reviewers disagreeing is a conflict',
    st({ hasR1: true, hasR2: true, agreementPct: 80 }) === 'conflict');
  check('adjudication settles it whatever came before',
    st({ hasR1: true, hasR2: true, agreementPct: 20, hasAdjudication: true }) === 'agreed');
  // Unknown agreement must not be invented into a conflict.
  check('unknown agreement with both reviewers is not a conflict',
    st({ hasR1: true, hasR2: true, agreementPct: null }) === 'agreed');
}

// ── Report ───────────────────────────────────────────────────────────────────

if (failures.length > 0) {
  console.error(`\n  ${failures.length} FAILED of ${passed + failures.length}:\n`);
  for (const f of failures) console.error(`   x ${f}`);
  console.error('');
  process.exit(1);
}

console.log(`\n  robForm.ts primitives — ${passed} checks passed\n`);

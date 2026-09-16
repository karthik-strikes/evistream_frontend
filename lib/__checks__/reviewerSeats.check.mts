/**
 * Self-check for the seat resolver.
 *
 *   node --experimental-strip-types --import ./lib/__checks__/register-alias.mjs \
 *        lib/__checks__/reviewerSeats.check.mts
 *
 * The case that motivated it is the first one below, taken from the live
 * Analgesics Calibration project: a reviewer assigned R2 on both papers, two of
 * whose saved rows carry a stale NULL role. Results showed "Extra", Allocations
 * showed "R2", and the user was right that they contradicted each other.
 */

import { buildSeatResolver } from '../reviewerSeats.ts';

let failures = 0;
function eq(actual: unknown, expected: unknown, what: string) {
  if (actual === expected) {
    console.log(`  ok   ${what}`);
  } else {
    failures++;
    console.error(`  FAIL ${what}\n       expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const ESTHER = 'esther';
const REHAM = 'reham';
const KIERSCH = 'doc-kiersch';
const ZELENAKAS = 'doc-zelenakas';

console.log('\nThe live contradiction: assigned R2, row says NULL');
{
  const seat = buildSeatResolver([
    { reviewer_user_id: ESTHER, document_id: KIERSCH, reviewer_role: 'reviewer_2' },
    { reviewer_user_id: ESTHER, document_id: ZELENAKAS, reviewer_role: 'reviewer_2' },
    { reviewer_user_id: REHAM, document_id: KIERSCH, reviewer_role: 'reviewer_1' },
  ]);
  eq(seat(ESTHER, KIERSCH, null), 'reviewer_2', 'stale NULL row resolves to the assigned seat');
  eq(seat(ESTHER, ZELENAKAS, 'reviewer_2'), 'reviewer_2', 'a row that already agrees is unchanged');
  eq(seat(REHAM, KIERSCH, null), 'reviewer_1', 'the other reader resolves to their own seat');
  eq(
    seat(ESTHER, KIERSCH, 'reviewer_1'),
    'reviewer_2',
    'the assignment beats a row label that disagrees with it',
  );
}

console.log('\nGenuinely seatless work stays "Extra"');
{
  const seat = buildSeatResolver([]);
  eq(seat('nobody', KIERSCH, null), null, 'no assignments anywhere → null, so the chip says Extra');
  eq(seat('nobody', KIERSCH, 'reviewer_1'), 'reviewer_1', 'with no assignment the row label is all we have');
}

console.log('\nFalling back across papers');
{
  const seat = buildSeatResolver([
    { reviewer_user_id: ESTHER, document_id: KIERSCH, reviewer_role: 'reviewer_2' },
  ]);
  eq(
    seat(ESTHER, 'some-unassigned-doc', null),
    'reviewer_2',
    'one seat project-wide answers for a paper with no assignment',
  );
  eq(seat(ESTHER, null, null), 'reviewer_2', 'and answers when no paper is named at all');
}

console.log('\nAmbiguity is not guessed at');
{
  const seat = buildSeatResolver([
    { reviewer_user_id: ESTHER, document_id: KIERSCH, reviewer_role: 'reviewer_1' },
    { reviewer_user_id: ESTHER, document_id: ZELENAKAS, reviewer_role: 'adjudicator' },
  ]);
  eq(seat(ESTHER, KIERSCH, null), 'reviewer_1', 'an exact per-paper match still wins');
  eq(
    seat(ESTHER, 'third-doc', 'adjudicator'),
    'adjudicator',
    'two seats project-wide → defer to the row rather than pick one',
  );
  eq(seat(ESTHER, 'third-doc', null), null, 'two seats and no row label → say nothing');
}

console.log('\nJunk in the assignment list cannot poison the map');
{
  const seat = buildSeatResolver([
    { reviewer_user_id: '', document_id: KIERSCH, reviewer_role: 'reviewer_1' },
    { reviewer_user_id: ESTHER, document_id: KIERSCH, reviewer_role: '' },
    { reviewer_user_id: ESTHER, document_id: ZELENAKAS, reviewer_role: 'reviewer_2' },
  ] as never);
  eq(seat(ESTHER, KIERSCH, null), 'reviewer_2', 'a roleless assignment is skipped, not stored');
  eq(seat(null, KIERSCH, 'reviewer_1'), 'reviewer_1', 'no user id → the row label');
}

console.log(failures === 0 ? '\nAll seat-resolver checks passed.\n' : `\n${failures} check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);

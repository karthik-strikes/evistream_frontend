/**
 * Self-check for lib/voteCounting.ts.
 *
 *   node --experimental-strip-types --import ./lib/__checks__/register-alias.mjs \
 *     lib/__checks__/voteCounting.check.mts
 *
 * Reference p-values are R's binom.test(x, n, 0.5) (identical to
 * scipy.stats.binomtest); Wilson bounds are scipy's proportion_ci('wilson'),
 * which uses z = Φ⁻¹(0.975) = 1.959964 where wilsonCI uses 1.96 — hence the
 * 2e-4 tolerance on those.
 */

import {
  directionOf, signTestTwoSided, voteCount, type Direction,
} from '../voteCounting.ts';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function close(name: string, actual: number | null | undefined, expected: number, tol: number): void {
  const a = actual ?? NaN;
  check(name, Number.isFinite(a) && Math.abs(a - expected) <= tol, `expected ${expected}, got ${actual}`);
}

// ── 1. Direction by point estimate ──────────────────────────────────────────
{
  check('RR 0.8, lower is benefit → benefit', directionOf(0.8, 1, true) === 'benefit');
  check('RR 1.3, lower is benefit → harm', directionOf(1.3, 1, true) === 'harm');
  check('RR 0.8, higher is benefit → harm', directionOf(0.8, 1, false) === 'harm');
  check('MD 2.1, higher is benefit → benefit', directionOf(2.1, 0, false) === 'benefit');
  check('MD −0.4, lower is benefit → benefit', directionOf(-0.4, 0, true) === 'benefit');
  check('exactly on the null → none', directionOf(1, 1, true) === 'none');
  check('null estimate → nodata', directionOf(null, 1, true) === 'nodata');
  check('NaN estimate → nodata', directionOf(NaN, 0, true) === 'nodata');
  check('no null value (a proportion) → nodata', directionOf(0.3, NaN, true) === 'nodata');
  // Direction never reads significance: a tiny, wildly imprecise effect still points.
  check('a barely-below-null estimate still has a direction', directionOf(0.999, 1, true) === 'benefit');
}

// ── 2. Exact two-sided sign test ────────────────────────────────────────────
{
  for (const [x, n, p] of [
    [0, 5, 0.0625], [8, 10, 0.109375], [9, 10, 0.021484375], [5, 10, 1],
    [7, 12, 0.7744140625], [3, 3, 0.25], [15, 20, 0.04138946533203125],
  ] as Array<[number, number, number]>) {
    close(`sign test ${x}/${n} = ${p}`, signTestTwoSided(x, n), p, 1e-12);
  }
  close('symmetric: 2/10 equals 8/10', signTestTwoSided(2, 10), signTestTwoSided(8, 10), 1e-15);
  check('n = 0 gives p = 1', signTestTwoSided(0, 0) === 1);
  check('x > n is refused', Number.isNaN(signTestTwoSided(4, 3)));
  check('a non-integer count is refused', Number.isNaN(signTestTwoSided(2.5, 5)));
  // Large n must not overflow: 600/1000 is overwhelming evidence.
  const big = signTestTwoSided(600, 1000);
  check('large n stays finite and tiny', Number.isFinite(big) && big < 1e-9, String(big));
  check('p never exceeds 1', signTestTwoSided(10, 20) <= 1);
}

// ── 3. Vote count: denominators exclude nodata; none is a non-success ──────
{
  const dirs: Direction[] = [
    'benefit', 'benefit', 'benefit', 'benefit', 'benefit', 'benefit', 'benefit', 'benefit',
    'harm', 'none', 'nodata', 'nodata',
  ];
  const v = voteCount(dirs, 'benefit');
  check('k counts every study', v.k === 12);
  check('nodata is counted separately', v.nodata === 2);
  check('nodata is out of the denominator', v.withDirection === 10);
  check('none counts in the denominator, not as success', v.success === 8);
  close('p is the sign test on 8/10', v.p, 0.109375, 1e-12);
  close('Wilson lower for 8/10', v.wilson?.[0], 0.4901624715, 2e-4);
  close('Wilson upper for 8/10', v.wilson?.[1], 0.9433178485, 2e-4);

  const harm = voteCount(dirs, 'harm');
  check('success = harm counts harms', harm.success === 1 && harm.withDirection === 10);
  close('harm p is the sign test on 1/10', harm.p, 0.021484375, 1e-12);

  const empty = voteCount(['nodata', 'nodata'], 'benefit');
  check('all nodata: no denominator', empty.withDirection === 0 && empty.success === 0);
  check('all nodata: no interval', empty.wilson === null);
  check('all nodata: no test', empty.p === null);

  const allBenefit = voteCount(['benefit', 'benefit', 'benefit'], 'benefit');
  close('3/3 Wilson lower', allBenefit.wilson?.[0], 0.4385029682, 2e-4);
  check('3/3 Wilson upper is 1', allBenefit.wilson?.[1] === 1);
  close('3/3 sign test', allBenefit.p, 0.25, 1e-12);

  // Adding nodata studies must not change anything but k and nodata.
  const padded = voteCount([...dirs, 'nodata', 'nodata', 'nodata'], 'benefit');
  check('more nodata leaves p unchanged', padded.p === v.p);
  check('...and the interval unchanged', padded.wilson?.[0] === v.wilson?.[0] && padded.wilson?.[1] === v.wilson?.[1]);
}

if (failures.length > 0) {
  console.error(`\n  ${failures.length} FAILED of ${passed + failures.length}:\n`);
  for (const f of failures) console.error(`   x ${f}`);
  console.error('');
  process.exit(1);
}
console.log(`\n  voteCounting.ts — ${passed} checks passed\n`);

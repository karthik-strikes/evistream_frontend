/**
 * Self-check for the absence *input* vocabulary and the consensus resolver's
 * absence handling.
 *
 *   node --experimental-strip-types --import ./lib/__checks__/register-alias.mjs \
 *        lib/__checks__/absenceInput.check.mts
 *
 * Two things are pinned here, and they pull against each other on purpose:
 *
 *   1. What a reviewer *types* is never silently reinterpreted — 'N/A' is asked
 *      about, not folded (`_lib/absenceInput.ts`).
 *   2. What is already *stored* still round-trips — save, reopen, re-save must
 *      leave the record byte-identical (`consensus/_lib/resolve.ts`).
 *
 * Plus one standing guard on `lib/absence.ts` that is not ours to change but
 * that the multi-select storage decision rests on entirely.
 */

import {
  hasDeclaredAbsence,
  needsAbsenceDisambiguation,
  unambiguousAbsenceLabel,
} from '../../app/(dashboard)/manual-extraction/_lib/absenceInput.ts';
import {
  decisionFromResolutionSource,
  isFieldResolved,
  resolveField,
  type ResolutionSource,
  type ResolvableField,
} from '../../app/(dashboard)/consensus/_lib/resolve.ts';
import { classify } from '../absence.ts';

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed++;
  else failures.push(detail ? `${name} — ${detail}` : name);
}

const base: ResolvableField = {
  sources: {}, agreed: false, decision: null, customValue: '', legacyCorrection: '',
};
const field = (over: Partial<ResolvableField>): ResolvableField => ({ ...base, ...over });

// ── 1. Typed text: one reading, or ask ───────────────────────────────────────
{
  for (const t of ['NR', 'N/R', 'nr', ' NR ', 'Not reported', 'NOT_REPORTED', 'not-reported']) {
    check(`"${t}" reads only as not-reported`, unambiguousAbsenceLabel(t) === 'NR');
  }
  for (const t of ['NA', 'N.A.', 'na', 'Not applicable', 'NOT_APPLICABLE', 'not-applicable']) {
    check(`"${t}" reads only as not-applicable`, unambiguousAbsenceLabel(t) === 'NA');
  }

  // The whole reason this module exists.
  check("'N/A' is not resolved silently", unambiguousAbsenceLabel('N/A') === null);
  check("'N/A' prompts", needsAbsenceDisambiguation('N/A'));
  check("'N.A' (no trailing dot) prompts", needsAbsenceDisambiguation('N.A'));

  // Things that are answers, or nothing, but never absence.
  for (const t of ['None', '', '0', '-', 'Nothing', 'Unclear', 'n']) {
    check(`"${t}" is not an absence token`, unambiguousAbsenceLabel(t) === null);
    check(`"${t}" does not prompt`, !needsAbsenceDisambiguation(t));
  }
  check('unambiguous tokens do not prompt', !needsAbsenceDisambiguation('NR') && !needsAbsenceDisambiguation('NA'));
  check('non-strings are inert', unambiguousAbsenceLabel(null) === null && unambiguousAbsenceLabel(3) === null
    && !needsAbsenceDisambiguation(['NR']));
}

// ── 2. The author's vocabulary wins ──────────────────────────────────────────
{
  check('declared "Not applicable" suppresses the generic NA',
    hasDeclaredAbsence(['Yes', 'No', 'Not applicable'], 'NA'));
  check('...and does NOT suppress NR — they are different claims',
    !hasDeclaredAbsence(['Yes', 'No', 'Not applicable'], 'NR'));
  check('declared "NR" suppresses the generic NR',
    hasDeclaredAbsence(['Low', 'High', 'NR'], 'NR'));
  check('RoB2\'s "No information" is not an absence token',
    !hasDeclaredAbsence(['Yes', 'No', 'No information'], 'NR')
    && !hasDeclaredAbsence(['Yes', 'No', 'No information'], 'NA'));
  check('no options declares nothing', !hasDeclaredAbsence(undefined, 'NR') && !hasDeclaredAbsence([], 'NA'));
}

// ── 3. The resolver derives provenance from the value ────────────────────────
{
  const r = (f: Partial<ResolvableField>) => resolveField(field(f));

  check('custom "NR" is recorded as not-reported',
    r({ decision: 'custom', customValue: 'NR' }).source === 'not_reported');
  check('custom "NA" is recorded as not-applicable',
    r({ decision: 'custom', customValue: 'NA' }).source === 'not_applicable');

  // The author's exact text survives — RoB2 depends on this.
  const declared = r({ decision: 'custom', customValue: 'Not applicable', options: ['Yes', 'No', 'Not applicable'] });
  check('a declared spelling keeps its text', declared.finalValue === 'Not applicable');
  check('...while still recording the right claim', declared.source === 'not_applicable');

  // Ambiguous and substantive values are left exactly as typed.
  const na = r({ decision: 'custom', customValue: 'N/A' });
  check("'N/A' is not guessed at rest", na.source === 'custom' && na.finalValue === 'N/A');
  for (const v of ['None', 'Unclear', '0']) {
    check(`custom "${v}" stays custom`, r({ decision: 'custom', customValue: v }).source === 'custom');
  }

  // The fourth write path, which always stamped 'custom'.
  check('an absence correction is recorded as such',
    r({ decision: 'incorrect', legacyCorrection: 'NR' }).source === 'not_reported');
  check('an ordinary correction is still custom',
    r({ decision: 'incorrect', legacyCorrection: '124' }).source === 'custom');

  // Untouched by all of the above.
  check('accept_ai preserves 0', r({ decision: 'accept_ai', sources: { ai: 0 } }).finalValue === 0);
  check('agreed is still agreed',
    r({ agreed: true, decision: 'agreed', sources: { ai: 'RCT', r1: 'RCT' } }).source === 'agreed');
}

// ── 4. Save → reopen → re-save leaves the record unchanged ───────────────────
{
  const SOURCES: ResolutionSource[] = ['agreed', 'ai', 'reviewer_1', 'reviewer_2', 'majority',
    'suggestion', 'custom', 'not_reported', 'not_applicable'];

  for (const source of SOURCES) {
    const storedValue = source === 'custom' ? '58'
      : source === 'not_reported' ? 'NR'
      : source === 'not_applicable' ? 'NA' : 'x';
    const restored = decisionFromResolutionSource(source, storedValue);
    check(`${source} has a restore branch`, restored !== null);
    if (!restored) continue;

    const reopened = field({
      sources: { ai: 'x', r1: 'y', r2: 'z' },
      suggestion: { value: 'x', source: 'AI', reason: '' },
      agreed: source === 'agreed',
      decision: restored.decision,
      customValue: restored.customValue ?? '',
    });
    check(`${source} reopens submittable`, isFieldResolved(reopened));

    const again = resolveField(reopened);
    // 'suggestion' is a legacy alias that canonicalizes to 'majority'.
    const expected = source === 'suggestion' ? 'majority' : source;
    check(`${source} re-saves unchanged`, again.source === expected,
      `got ${again.source}`);
    if (source === 'not_reported' || source === 'not_applicable') {
      check(`${source} re-saves the same value`, again.finalValue === storedValue,
        `got ${String(again.finalValue)}`);
    }
  }

  // Absence must land in the editor, since the dedicated buttons are gone.
  const nr = decisionFromResolutionSource('not_reported', 'NR');
  check('not_reported restores into the value editor',
    nr?.decision === 'custom' && nr?.customValue === 'NR');

  // Legacy rows that smuggled absence through `custom` still load.
  check('legacy custom+"NR" still restores',
    decisionFromResolutionSource('custom', 'NR')?.customValue === 'NR');
  check('an unknown source has no decision',
    decisionFromResolutionSource('vibes', null) === null);
}

// ── 5. Standing guard on lib/absence.ts (not ours to change) ─────────────────
{
  // This is why multi-select absence is stored as the bare string 'NR' and never
  // as ['NR']: any non-empty array classifies as a reported answer, so the array
  // form would round-trip through compareKey and the Python mirror as a finding.
  check("classify(['NR']) is 'reported' — the array form would be a lie",
    classify(['NR']) === 'reported');
  check("classify('NR') is 'not_reported' — the scalar form is understood",
    classify('NR') === 'not_reported');
}

// ── Report ───────────────────────────────────────────────────────────────────

if (failures.length > 0) {
  console.error(`\n  ${failures.length} FAILED of ${passed + failures.length}:\n`);
  for (const f of failures) console.error(`   x ${f}`);
  console.error('');
  process.exit(1);
}

console.log(`\n  absence input + consensus resolution — ${passed} checks passed\n`);

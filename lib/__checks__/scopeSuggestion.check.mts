/**
 * Self-check for folding document suggestions into the scope builder.
 *
 *   node --experimental-strip-types --import ./lib/__checks__/register-alias.mjs \
 *        lib/__checks__/scopeSuggestion.check.mts
 *
 * Two things are pinned:
 *
 *   1. Merge NEVER loses what the reviewer typed. Running the suggester on a
 *      second protocol has to add to the builder, not silently rewrite it.
 *   2. Replace clears `pairsOff` too. Those keys name chips that no longer
 *      exist, and a stale key re-mutes a comparison the moment the same text
 *      is typed again.
 *
 * Plus the family mapping, which is the one place the backend's singular names
 * and the draft's plural lists have to agree.
 */

import {
  EMPTY_DRAFT,
  FAMILY_KEY,
  composeScope,
  draftToApi,
  mergeChips,
  pairKey,
  type ReviewScopeDraft,
  type SuggestedScopeChip,
} from '../reviewScope.ts';

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed++;
  else failures.push(detail ? `${name} — ${detail}` : name);
}

function chip(
  family: SuggestedScopeChip['family'],
  value: string,
  extra: Partial<SuggestedScopeChip> = {},
): SuggestedScopeChip {
  return { family, value, evidence: 'quoted from the protocol', confidence: 'high', unverified: false, ...extra };
}

const typed: ReviewScopeDraft = {
  populations: ['Adults with chronic periodontitis'],
  interventions: ['SRP + antibiotics'],
  comparators: ['SRP alone'],
  outcomes: ['Probing pocket depth'],
  timepoints: ['3 months'],
  pairsOff: [pairKey('SRP + antibiotics', 'SRP alone')],
};

// ── family mapping ──────────────────────────────────────────────────────────

check(
  'every family maps to a draft list',
  (['population', 'intervention', 'comparator', 'outcome', 'timepoint'] as const).every(
    (f) => FAMILY_KEY[f] in EMPTY_DRAFT,
  ),
);

{
  const out = mergeChips(EMPTY_DRAFT, [
    chip('population', 'Smokers'),
    chip('intervention', 'Er:YAG laser'),
    chip('comparator', 'Placebo'),
    chip('outcome', 'Bleeding on probing'),
    chip('timepoint', '6 months'),
  ]);
  check('each family lands in its own list',
    out.populations.length === 1 && out.interventions.length === 1 &&
    out.comparators.length === 1 && out.outcomes.length === 1 && out.timepoints.length === 1,
    JSON.stringify(out));
}

// ── merge keeps what the reviewer typed ─────────────────────────────────────

{
  const out = mergeChips(typed, [chip('outcome', 'Clinical attachment level')]);
  check('merge appends without disturbing existing order',
    out.outcomes.join('|') === 'Probing pocket depth|Clinical attachment level',
    out.outcomes.join('|'));
  check('merge leaves other families alone',
    out.populations.join('|') === typed.populations.join('|'));
  check('merge keeps pairsOff', out.pairsOff.length === 1);
}

{
  const out = mergeChips(typed, [chip('comparator', 'srp ALONE')]);
  check('a suggestion duplicating a typed entry is dropped case-insensitively',
    out.comparators.length === 1, out.comparators.join('|'));
}

{
  const out = mergeChips(typed, [chip('outcome', '   ')]);
  check('a blank suggestion is skipped', out.outcomes.length === 1);
}

{
  const out = mergeChips(EMPTY_DRAFT, [chip('outcome', 'PPD'), chip('outcome', 'ppd')]);
  check('duplicates within one batch collapse', out.outcomes.length === 1, out.outcomes.join('|'));
}

// ── EMPTY_DRAFT must not be mutated by any of the above ─────────────────────

check('EMPTY_DRAFT is still empty',
  EMPTY_DRAFT.populations.length === 0 && EMPTY_DRAFT.outcomes.length === 0 &&
  EMPTY_DRAFT.pairsOff.length === 0);

// ── replace ─────────────────────────────────────────────────────────────────

{
  const out = mergeChips(typed, [chip('population', 'Smokers')], 'replace');
  check('replace drops the previous entries',
    out.populations.join('|') === 'Smokers' && out.outcomes.length === 0,
    JSON.stringify(out));
  check('replace clears pairsOff, whose keys name chips that are gone',
    out.pairsOff.length === 0);
}

// ── the result is a legal save payload ──────────────────────────────────────

{
  const out = mergeChips(EMPTY_DRAFT, [
    chip('intervention', 'SRP + antibiotics'),
    chip('comparator', 'SRP alone'),
    chip('outcome', 'Probing pocket depth'),
    chip('timepoint', '6 months'),
  ]);
  const prose = composeScope(out);
  check('merged chips compose into prose',
    prose.includes('SRP + antibiotics versus SRP alone') && prose.includes('each at 6 months'),
    prose);
  check('merged chips survive draftToApi',
    draftToApi(out).interventions?.length === 1);
}

if (failures.length) {
  console.error(`✗ ${failures.length} failed, ${passed} passed`);
  failures.forEach((f) => console.error(`  - ${f}`));
  process.exit(1);
}
console.log(`✓ ${passed} checks passed`);

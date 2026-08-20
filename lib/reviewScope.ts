/**
 * The guided review-scope builder: chips in, one prose string out.
 *
 * `composeScope` is the ONLY writer of the text that reaches the extraction
 * prompt (backend `runtime_builders.apply_review_scope` injects it verbatim into
 * every signature docstring). The backend stores what it is given and never
 * recomposes, so this file is the single source of truth for the wording.
 *
 * Composition is deliberately one-way — unticked pairs simply vanish from the
 * text, and "A versus B" no longer says which side was the comparator — which is
 * why the chips are persisted separately in `projects.review_scope_structured`
 * rather than parsed back out of the prose.
 */

export const SCOPE_MAX = 4000;

/** Separator for comparison-pair keys. Mirrored in the backend model. */
const PAIR_SEP = '⚔';

export interface ReviewScopeDraft {
  populations: string[];
  interventions: string[];
  comparators: string[];
  outcomes: string[];
  timepoints: string[];
  /** pairKey()s of comparisons the user unticked. */
  pairsOff: string[];
}

/** Wire shape of `projects.review_scope_structured`. */
export interface ReviewScopeStructured {
  populations?: string[];
  interventions?: string[];
  comparators?: string[];
  outcomes?: string[];
  timepoints?: string[];
  pairs_off?: string[];
}

export type ScopeListKey = Exclude<keyof ReviewScopeDraft, 'pairsOff'>;

/**
 * A scope entry proposed from an uploaded document, before the reviewer has
 * accepted it. Mirrors `backend/app/api/v1/review_scope.py:SuggestedChip`.
 *
 * `unverified` means the server could not find the model's quote in the
 * document. Such a chip is deliberately kept rather than dropped — PDF table
 * extraction mangles whitespace often enough that dropping would lose correct
 * entries — so the dialog shows it unticked and the reviewer decides.
 */
export interface SuggestedScopeChip {
  family: ScopeFamilyName;
  value: string;
  evidence: string;
  confidence: 'high' | 'medium' | 'low';
  unverified: boolean;
}

export type ScopeFamilyName =
  | 'population'
  | 'intervention'
  | 'comparator'
  | 'outcome'
  | 'timepoint';

/** The backend names one entry; the draft holds a list. */
export const FAMILY_KEY: Record<ScopeFamilyName, ScopeListKey> = {
  population: 'populations',
  intervention: 'interventions',
  comparator: 'comparators',
  outcome: 'outcomes',
  timepoint: 'timepoints',
};

export const EMPTY_DRAFT: ReviewScopeDraft = {
  populations: [],
  interventions: [],
  comparators: [],
  outcomes: [],
  timepoints: [],
  pairsOff: [],
};

export interface ScopeFamily {
  key: ScopeListKey;
  label: string;
  hint: string;
  placeholder: string;
  /** Chip fill + text, light and dark. Follows the badge.tsx `-500/10` idiom. */
  chip: string;
  /** Count badge in the scope-shape panel. */
  badge: string;
}

export const FAMILIES: ScopeFamily[] = [
  {
    key: 'populations',
    label: 'Populations',
    hint: 'each group the review covers',
    placeholder: 'e.g. Adults with chronic periodontitis — Enter to add',
    chip: 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300',
    badge: 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300',
  },
  {
    key: 'interventions',
    label: 'Interventions',
    hint: 'every treatment of interest',
    placeholder: 'e.g. SRP + systemic antibiotics — Enter to add',
    chip: 'bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-300',
    badge: 'bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-300',
  },
  {
    key: 'comparators',
    label: 'Comparators',
    hint: 'control or baseline arms',
    placeholder: 'e.g. SRP alone — Enter to add',
    chip: 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300',
    badge: 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300',
  },
  {
    key: 'outcomes',
    label: 'Outcomes',
    hint: 'all measures you’ll extract',
    placeholder: 'e.g. Probing pocket depth — Enter to add',
    chip: 'bg-fuchsia-50 text-fuchsia-700 dark:bg-fuchsia-500/10 dark:text-fuchsia-300',
    badge: 'bg-fuchsia-50 text-fuchsia-700 dark:bg-fuchsia-500/10 dark:text-fuchsia-300',
  },
  {
    key: 'timepoints',
    label: 'Timepoints',
    hint: 'every follow-up that counts',
    placeholder: 'e.g. 3 months — Enter to add',
    chip: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300',
    badge: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300',
  },
];

export const EXAMPLE_DRAFT: ReviewScopeDraft = {
  populations: ['Adults with chronic periodontitis', 'Smokers with chronic periodontitis'],
  interventions: ['SRP + systemic antibiotics', 'SRP + Er:YAG laser'],
  comparators: ['SRP alone'],
  outcomes: ['Probing pocket depth', 'Clinical attachment level', 'Bleeding on probing'],
  timepoints: ['3 months', '6 months'],
  pairsOff: [],
};

export type ScopePair = [string, string];

export function pairKey(a: string, b: string): string {
  return a + PAIR_SEP + b;
}

/**
 * Every comparison the chips imply, in the order they read in the prose:
 * each intervention against each comparator, then every intervention
 * head-to-head. Order is part of the output, so don't sort it.
 */
export function activePairs(d: ReviewScopeDraft): ScopePair[] {
  const pairs: ScopePair[] = [];
  d.interventions.forEach((iv) => d.comparators.forEach((cv) => pairs.push([iv, cv])));
  const i = d.interventions;
  if (i.length > 1) {
    for (let a = 0; a < i.length; a++) {
      for (let b = a + 1; b < i.length; b++) pairs.push([i[a], i[b]]);
    }
  }
  return pairs;
}

export function chosenPairs(d: ReviewScopeDraft): ScopePair[] {
  const off = new Set(d.pairsOff);
  return activePairs(d).filter(([a, b]) => !off.has(pairKey(a, b)));
}

/** "a", "a and b", "a, b and c" — reads as a sentence, not a bullet list. */
function readableList(arr: string[]): string {
  if (arr.length === 1) return arr[0];
  return arr.slice(0, -1).join(', ') + ' and ' + arr[arr.length - 1];
}

/**
 * The exact text the model sees. A single population gets no prefix on purpose:
 * it composes to the bare sentence "Adults with chronic periodontitis.", which
 * is how hand-written scopes have always opened.
 */
export function composeScope(d: ReviewScopeDraft): string {
  const parts: string[] = [];

  if (d.populations.length) {
    parts.push(
      (d.populations.length > 1 ? 'Populations of interest: ' : '') +
        readableList(d.populations) +
        '.'
    );
  }

  const chosen = chosenPairs(d);
  if (chosen.length) {
    parts.push(
      (chosen.length > 1 ? 'Comparisons of interest: ' : 'Comparison of interest: ') +
        chosen.map(([a, b]) => a + ' versus ' + b).join('; ') +
        '.'
    );
  } else if (d.interventions.length) {
    parts.push('Interventions of interest: ' + readableList(d.interventions) + '.');
  }

  if (d.outcomes.length) {
    let line = 'Outcomes of interest: ' + readableList(d.outcomes);
    if (d.timepoints.length) line += ', each at ' + readableList(d.timepoints);
    parts.push(line + '.');
  } else if (d.timepoints.length) {
    parts.push('Timepoints of interest: ' + readableList(d.timepoints) + '.');
  }

  return parts.join('\n');
}

export function isDraftEmpty(d: ReviewScopeDraft): boolean {
  return !composeScope(d).trim();
}

/**
 * A scope this wide is usually two review questions sharing one document
 * library — worth saying so before the model has to hold it all at once.
 */
export function isScopeOverloaded(d: ReviewScopeDraft): boolean {
  return (
    d.interventions.length >= 4 ||
    d.outcomes.length >= 6 ||
    d.interventions.length * d.outcomes.length >= 15
  );
}

export function draftFromApi(s: ReviewScopeStructured | null | undefined): ReviewScopeDraft | null {
  if (!s) return null;
  return {
    populations: s.populations ?? [],
    interventions: s.interventions ?? [],
    comparators: s.comparators ?? [],
    outcomes: s.outcomes ?? [],
    timepoints: s.timepoints ?? [],
    pairsOff: s.pairs_off ?? [],
  };
}

/**
 * Fold accepted suggestions into the builder's draft.
 *
 * `merge` appends what is new and leaves everything the reviewer already typed
 * alone — running the suggester on a second document should add, not wipe.
 * `replace` starts from empty, which also clears `pairsOff`: those keys name
 * chips that no longer exist.
 *
 * Comparison of existing entries is case-insensitive, matching ScopeChipField's
 * own duplicate rule, so a suggested "SRP alone" does not sit next to a typed
 * "srp alone".
 */
export function mergeChips(
  draft: ReviewScopeDraft,
  chips: SuggestedScopeChip[],
  mode: 'merge' | 'replace' = 'merge',
): ReviewScopeDraft {
  // Fresh arrays rather than `{...EMPTY_DRAFT}`, which would share that
  // module-level constant's arrays with the returned draft.
  const next: ReviewScopeDraft =
    mode === 'replace'
      ? { populations: [], interventions: [], comparators: [], outcomes: [], timepoints: [], pairsOff: [] }
      : {
          populations: [...draft.populations],
          interventions: [...draft.interventions],
          comparators: [...draft.comparators],
          outcomes: [...draft.outcomes],
          timepoints: [...draft.timepoints],
          // Stale keys are harmless: draftToApi drops any pair whose two sides
          // do not both still exist.
          pairsOff: [...draft.pairsOff],
        };

  chips.forEach((chip) => {
    const key = FAMILY_KEY[chip.family];
    if (!key) return;
    const value = chip.value.trim();
    if (!value) return;
    const fold = value.toLowerCase();
    if (next[key].some((v) => v.toLowerCase() === fold)) return;
    next[key] = [...next[key], value];
  });

  return next;
}

export function draftToApi(d: ReviewScopeDraft): ReviewScopeStructured {
  return {
    populations: d.populations,
    interventions: d.interventions,
    comparators: d.comparators,
    outcomes: d.outcomes,
    timepoints: d.timepoints,
    // Only keys for pairs that still exist — an intervention removed after its
    // pair was unticked would otherwise leave a key that re-mutes the pair if
    // the same text is typed again.
    pairs_off: d.pairsOff.filter((k) =>
      activePairs(d).some(([a, b]) => pairKey(a, b) === k)
    ),
  };
}

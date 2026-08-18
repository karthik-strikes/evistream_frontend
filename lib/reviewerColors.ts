/**
 * One colour per review role, for the whole app.
 *
 * Why this file exists: R2 used to be emerald/green, and green is *also* the
 * app's "agreed / resolved / done" colour — checkmarks, status pills, agreement
 * bars, the RingChart's `#22c55e`. So "R2's answer was accepted" and "this field
 * is settled" rendered as the same hue, which is exactly the distinction a
 * reviewer needs at a glance. R2 is purple now, and green means one thing.
 *
 * Roles are colour-coded in seven places (the consensus review cards and
 * dashboard, the manual-extraction queue and toolbar, and three project
 * allocation views). They all read from here, so the next recolour is one edit
 * rather than a grep.
 *
 * Tailwind classes rather than hex values, so every slot carries its dark
 * variant. Written as complete literal strings because Tailwind's scanner cannot
 * see through interpolation — `bg-${color}-50` produces no CSS.
 */

export type ReviewRole = 'ai' | 'reviewer_1' | 'reviewer_2' | 'adjudicator';

export interface RoleColors {
  /** Full name, for a source box header. */
  label: string;
  /** Two-character form, for dense rows and dots. */
  short: string;
  /** Label / icon colour. */
  text: string;
  /** Resting surface of a source box. */
  bg: string;
  /** Selected surface + inset ring. Applied instead of `bg`. */
  selected: string;
  /** Hairline for table-style source columns. */
  border: string;
  /** Filled chip: the round check on a picked box, a solid dot, an active pill. */
  solid: string;
  /** Compact role tag used by the assignment / queue screens. */
  pill: string;
  /** Small solid dot for role columns. */
  dot: string;
}

export const ROLE_COLORS: Record<ReviewRole, RoleColors> = {
  ai: {
    label: 'AI',
    short: 'AI',
    text: 'text-blue-600 dark:text-blue-300',
    bg: 'bg-blue-50/70 dark:bg-blue-950/40',
    selected: 'bg-blue-100/80 dark:bg-blue-900/40 ring-2 ring-inset ring-blue-500 dark:ring-blue-400',
    border: 'border-blue-300 dark:border-blue-700',
    solid: 'bg-blue-600 dark:bg-blue-500 text-white',
    pill: 'text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-400/15',
    dot: 'bg-blue-500',
  },
  reviewer_1: {
    label: 'Reviewer 1',
    short: 'R1',
    text: 'text-orange-600 dark:text-orange-300',
    bg: 'bg-orange-50/70 dark:bg-orange-950/40',
    selected: 'bg-orange-100/80 dark:bg-orange-900/40 ring-2 ring-inset ring-orange-500 dark:ring-orange-400',
    border: 'border-orange-300 dark:border-orange-700',
    solid: 'bg-orange-600 dark:bg-orange-500 text-white',
    pill: 'text-orange-600 dark:text-orange-400 bg-orange-100 dark:bg-orange-400/15',
    dot: 'bg-orange-500',
  },
  reviewer_2: {
    label: 'Reviewer 2',
    short: 'R2',
    text: 'text-purple-600 dark:text-purple-300',
    bg: 'bg-purple-50/70 dark:bg-purple-950/40',
    selected: 'bg-purple-100/80 dark:bg-purple-900/40 ring-2 ring-inset ring-purple-500 dark:ring-purple-400',
    border: 'border-purple-300 dark:border-purple-700',
    solid: 'bg-purple-600 dark:bg-purple-500 text-white',
    pill: 'text-purple-600 dark:text-purple-400 bg-purple-100 dark:bg-purple-400/15',
    dot: 'bg-purple-500',
  },
  adjudicator: {
    label: 'Adjudicator',
    short: 'AD',
    text: 'text-sky-600 dark:text-sky-300',
    bg: 'bg-sky-50/70 dark:bg-sky-950/40',
    selected: 'bg-sky-100/80 dark:bg-sky-900/40 ring-2 ring-inset ring-sky-500 dark:ring-sky-400',
    border: 'border-sky-300 dark:border-sky-700',
    solid: 'bg-sky-600 dark:bg-sky-500 text-white',
    pill: 'text-sky-600 dark:text-sky-400 bg-sky-100 dark:bg-sky-400/15',
    dot: 'bg-sky-500',
  },
};

/** The short keys the consensus screens use internally for the three sources. */
export type SourceKey = 'ai' | 'r1' | 'r2';

const SOURCE_KEY_TO_ROLE: Record<SourceKey, ReviewRole> = {
  ai: 'ai',
  r1: 'reviewer_1',
  r2: 'reviewer_2',
};

export function sourceColors(key: SourceKey): RoleColors {
  return ROLE_COLORS[SOURCE_KEY_TO_ROLE[key]];
}

/**
 * Semantic colours, kept here so they stay visibly distinct from the role
 * colours above. Green is reserved for "settled" and amber for "needs you".
 */
export const STATE_COLORS = {
  /** A field that is resolved, or two sources that match. */
  resolved: {
    text: 'text-emerald-700 dark:text-emerald-300',
    bg: 'bg-emerald-50 dark:bg-emerald-950/40',
    border: 'border-emerald-500 dark:border-emerald-400',
  },
  /** The field currently under the cursor. */
  active: {
    text: 'text-amber-700 dark:text-amber-300',
    bg: 'bg-amber-50 dark:bg-amber-950/30',
    border: 'border-amber-500 dark:border-amber-400',
  },
  /** Undecided. Reserves the same border width so rows do not shift by 3px. */
  pending: {
    text: 'text-gray-500 dark:text-zinc-400',
    bg: 'bg-gray-100 dark:bg-[#1a1a1a]',
    border: 'border-transparent',
  },
} as const;

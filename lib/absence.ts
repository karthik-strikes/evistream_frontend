/**
 * Canonical absence semantics — the TypeScript mirror of backend/utils/absence.py.
 *
 * Evidence synthesis distinguishes four claims that this app used to collapse
 * into the single string "NR":
 *
 *   reported        the value — including "None" / 0, which are findings
 *   not_reported    the paper is silent (a finding *about* the paper)
 *   not_applicable  the field cannot apply to this study/arm
 *   missing | error the pipeline faulted; no claim about the paper at all
 *
 * Two invariants:
 *   1. A cell's `value` is never overwritten. Labels come from `status`.
 *   2. Declared options win over token matching — the form author's vocabulary
 *      outranks the system sentinel.
 *
 * Keep this in step with the Python module: several screens compare their counts
 * against backend-computed ones, so the two classifiers must agree.
 */

export const REPORTED = 'reported';
export const NOT_REPORTED = 'not_reported';
export const NOT_APPLICABLE = 'not_applicable';
export const MISSING = 'missing';
export const ERROR = 'error';
export const PARTIAL = 'partial';

export type CellStatus =
  | 'reported'
  | 'not_reported'
  | 'not_applicable'
  | 'missing'
  | 'error'
  | 'partial';

/** Where a quote was found in the document, as resolved by the backend's
 *  source linker. `synthetic_caption` marks a quote that landed inside
 *  Datalab's machine-generated description of a figure rather than in text the
 *  authors wrote — see backend/utils/synthetic_captions.py. It rides here
 *  rather than on the cell so reviewer comparison keeps ignoring it. */
export interface SourceLocation {
  page?: number;
  start_char?: number;
  end_char?: number;
  matched_text?: string;
  confidence?: number;
  section?: string;
  grounding_method?: string;
  bboxes?: any[];
  synthetic_caption?: boolean;
  /** Filename of the figure a synthetic caption describes — the viewer's join
   *  key for highlighting the picture instead of the caption text. */
  caption_image?: string;
}

/** The `{value, source_text, status}` envelope every extracted field uses. */
export interface ValueCell {
  value: any;
  source_text?: string;
  source_location?: SourceLocation | null;
  status?: string;
  error?: string;
  off_options?: string[];
}

/** Fixed canonical labels. The spec controls meaning via options, not the glyph. */
export const NR_LABEL = 'NR';
export const NA_LABEL = 'NA';
/** A failure must never render blank or as NR. */
export const FAILED_LABEL = '⚠';

/** The agentic table path historically emitted "extracted" for "reported". */
const LEGACY_STATUS_ALIASES: Record<string, CellStatus> = { extracted: REPORTED as CellStatus };

const NA_TOKENS = new Set(['NA', 'N.A.', 'NOT APPLICABLE', 'NOT_APPLICABLE', 'NOT-APPLICABLE']);
const NR_TOKENS = new Set(['', 'NR', 'N/R', 'N/A', 'NONE', 'NOT REPORTED', 'NOT_REPORTED']);

/** Superset of every token list this module replaces. */
export const ABSENCE_TOKENS = new Set<string>([...NA_TOKENS, ...NR_TOKENS]);

/** Plus the dash glyphs that only ever appear as display placeholders. */
export const EMPTY_DISPLAY_TOKENS = new Set<string>([...ABSENCE_TOKENS, '—', '–', '-']);

const FAILURE_STATUSES = new Set<string>([MISSING, ERROR]);
const ABSENCE_STATUSES = new Set<string>([NOT_REPORTED, NOT_APPLICABLE]);
const ALL_STATUSES = new Set<string>([
  REPORTED, NOT_REPORTED, NOT_APPLICABLE, MISSING, ERROR, PARTIAL,
]);

/** Map a stored status onto the canonical vocabulary; null when unrecognized. */
export function normalizeStatus(status: any): CellStatus | null {
  if (typeof status !== 'string') return null;
  const s = status.trim().toLowerCase();
  const aliased = LEGACY_STATUS_ALIASES[s] ?? s;
  return ALL_STATUSES.has(aliased) ? (aliased as CellStatus) : null;
}

export function isFailure(status: any): boolean {
  const s = normalizeStatus(status);
  return s !== null && FAILURE_STATUSES.has(s);
}

/** True when `value` is one of the declared options (case-insensitively). */
export function matchesOption(value: any, options?: string[] | null): boolean {
  if (!options || options.length === 0) return false;
  const canon = new Set(options.map(o => String(o).trim().toLowerCase()));
  const vals = Array.isArray(value) ? value : [value];
  if (vals.length === 0) return false;
  return vals.every(v => typeof v === 'string' && canon.has(v.trim().toLowerCase()));
}

/** Classify a value. Declared options are consulted before token matching. */
export function classify(value: any, options?: string[] | null): CellStatus {
  if (matchesOption(value, options)) {
    // The author's vocabulary is honoured, but a declared inapplicability
    // option keeps the NA meaning. A declared "None" stays reported: a study
    // with no funding reported its funding.
    if (typeof value === 'string' && NA_TOKENS.has(value.trim().toUpperCase())) {
      return NOT_APPLICABLE as CellStatus;
    }
    return REPORTED as CellStatus;
  }
  if (value === null || value === undefined) return NOT_REPORTED as CellStatus;
  if (typeof value === 'string') {
    const token = value.trim().toUpperCase();
    if (NA_TOKENS.has(token)) return NOT_APPLICABLE as CellStatus;
    if (NR_TOKENS.has(token)) return NOT_REPORTED as CellStatus;
    return REPORTED as CellStatus;
  }
  // Numbers and booleans are findings — 0 and false mean something.
  if (typeof value === 'number' || typeof value === 'boolean') return REPORTED as CellStatus;
  if (Array.isArray(value)) {
    return value.length ? (REPORTED as CellStatus) : (NOT_REPORTED as CellStatus);
  }
  if (typeof value === 'object') {
    return Object.keys(value).length ? (REPORTED as CellStatus) : (NOT_REPORTED as CellStatus);
  }
  return REPORTED as CellStatus;
}

/** Effective status of a cell, inferring one for legacy status-less rows. */
export function cellStatus(cell: any, options?: string[] | null): CellStatus {
  if (cell && typeof cell === 'object' && !Array.isArray(cell)) {
    const st = normalizeStatus((cell as ValueCell).status);
    if (st) return st;
    if ('value' in cell) return classify((cell as ValueCell).value, options);
  }
  return classify(cell, options);
}

/**
 * The label a results surface should show instead of the raw value, or null to
 * show the value itself.
 */
export function displayLabel(cell: any): string | null {
  if (!cell || typeof cell !== 'object') return null;
  const st = normalizeStatus((cell as ValueCell).status);
  if (st === null) return null;
  if (FAILURE_STATUSES.has(st)) return FAILED_LABEL;
  if (st === NOT_REPORTED) return NR_LABEL;
  if (st === NOT_APPLICABLE) return NA_LABEL;
  return null;
}

/** True when a value asserts absence (either flavour). */
export function isAbsent(value: any, options?: string[] | null): boolean {
  return ABSENCE_STATUSES.has(classify(value, options));
}

/**
 * NR / NA label for an unambiguous bare absence token, else null. Deliberately
 * does not fold "None" or "" — a bare "None" can be a substantive answer.
 */
export function canonicalAbsenceLabel(value: any): string | null {
  if (typeof value !== 'string') return null;
  const token = value.trim().toUpperCase();
  if (NA_TOKENS.has(token)) return NA_LABEL;
  if (['NR', 'N/R', 'N/A', 'NOT REPORTED', 'NOT_REPORTED'].includes(token)) return NR_LABEL;
  return null;
}

/**
 * Is this field a reporting gap, for coverage/flagging purposes?
 * Mirrors the backend's `_field_is_empty` so card and page counts agree.
 */
export function fieldIsEmpty(v: any): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') {
    const s = v.trim();
    return s === '' || EMPTY_DISPLAY_TOKENS.has(s.toUpperCase());
  }
  if (typeof v === 'number' || typeof v === 'boolean') return false;
  if (Array.isArray(v)) return v.length === 0 || v.every(fieldIsEmpty);
  if (typeof v === 'object') {
    const st = normalizeStatus((v as ValueCell).status);
    // Exhaustive on purpose: a status falling through to the value below gets
    // classified by its raw text, which silently mislabels new states.
    if (st !== null) {
      if (FAILURE_STATUSES.has(st) || st === NOT_REPORTED) return true;
      if (st === REPORTED || st === PARTIAL || st === NOT_APPLICABLE) return false;
    }
    if ('value' in v) return fieldIsEmpty((v as ValueCell).value);
    const vals = Object.values(v);
    return vals.length === 0 || vals.every(fieldIsEmpty);
  }
  return false;
}

/**
 * A field the study design excludes — not a reporting gap, so it is taken out
 * of the coverage denominator rather than counted against the paper.
 */
export function fieldIsNotApplicable(v: any): boolean {
  return (
    !!v && typeof v === 'object' &&
    normalizeStatus((v as ValueCell).status) === NOT_APPLICABLE
  );
}

/**
 * Canonical token for reviewer-agreement comparison. Returns null for a failed
 * cell, which callers must treat as incomparable — an extraction failure is not
 * evidence that two reviewers agree. NR and NA compare unequal.
 */
export function compareKey(cell: any, options?: string[] | null): string | null {
  const value =
    cell && typeof cell === 'object' && !Array.isArray(cell) && 'value' in cell
      ? (cell as ValueCell).value
      : cell;
  const st = cellStatus(cell, options);
  if (FAILURE_STATUSES.has(st)) return null;
  if (st === NOT_REPORTED) return NR_LABEL;
  if (st === NOT_APPLICABLE) return NA_LABEL;
  return valueKey(value);
}

function valueKey(value: any): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(valueKey).sort().join('|');
  if (typeof value === 'object') {
    return Object.keys(value)
      .filter(k => !['source_text', 'source_location', 'status', 'error'].includes(k))
      .sort()
      .map(k => `${k}=${valueKey(value[k])}`)
      .join('|');
  }
  const text = String(value).trim();
  const asNum = Number(text);
  if (text !== '' && !Number.isNaN(asNum)) return String(asNum);
  const lowered = text.toLowerCase();
  if (['true', 'yes', 'y'].includes(lowered)) return 'true';
  if (['false', 'no', 'n'].includes(lowered)) return 'false';
  return lowered;
}

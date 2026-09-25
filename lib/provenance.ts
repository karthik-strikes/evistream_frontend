/**
 * Reading the per-cell provenance block.
 *
 * The mirror of `backend/utils/provenance.py`, the way `lib/absence.ts` mirrors
 * `utils/absence.py` and `lib/documentLabel.ts` mirrors `utils/study_label.py`.
 * Change one, change the other in the same commit.
 *
 * Only the READ half is here. The envelope is built server-side on purpose —
 * "reviewer identity and edit time are not the client's to assert" — so there
 * is deliberately no writer in this file.
 *
 * Why it did not exist until now: `GET /results` has been sending this block
 * inside every `extracted_data` cell since the provenance work shipped, and
 * nothing on the Results page read it. 408 of 408 live table cells and 134
 * scalar cells carry one; the screen showed none of it.
 */

import type { SourceLocation } from './absence';

/** Where a cell's current value came from. */
export type CellOrigin =
  | 'ai'
  /** Changed a value that already existed. */
  | 'human_edited'
  /** Typed a value with no baseline at all. */
  | 'human_authored'
  /** Looked at the baseline and kept it. */
  | 'human_confirmed'
  /** Accepted a verified RoB 2 AI suggestion (backend checks the draft and quote). */
  | 'ai_suggestion';

/** How well the quote under the value still supports it. */
export type EvidenceState =
  /** The baseline quote still contains the new value. */
  | 'inherited'
  /** The new value was re-located in the document. */
  | 'reanchored'
  /** The reviewer handed us the quote or region themselves. */
  | 'reviewer_supplied'
  /** Not locatable — the prior pointer is kept, the top-level quote cleared. */
  | 'unverified'
  /** An absence value (NR/NA); there is nothing to ground. */
  | 'none';

export const HUMAN_ORIGINS: ReadonlySet<CellOrigin> = new Set<CellOrigin>([
  'human_edited',
  'human_authored',
  'human_confirmed',
  'ai_suggestion',
]);

export interface CellProvenance {
  origin?: CellOrigin;
  evidence_state?: EvidenceState;

  edited_by?: string;
  edited_at?: string;
  edited_by_role?: string;

  confirmed_by?: string;
  confirmed_at?: string;
  confirmed_by_role?: string;

  sourced_by?: string;
  sourced_at?: string;
  sourced_by_role?: string;

  /** The frozen baseline. Points at the ORIGINAL reading through any number of
   *  edits — see the trap noted on `cellHistory`. */
  prior_value?: unknown;
  prior_origin?: CellOrigin;
  prior_status?: string;
  prior_source_text?: string;
  prior_source_location?: SourceLocation | null;

  /** Table fields only — per-cell states live on the cells inside `value`. */
  row_count?: number;
  prior_row_count?: number;
  changed_columns?: string[];
}

export function cellProvenance(raw: unknown): CellProvenance | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const prov = (raw as { provenance?: unknown }).provenance;
  if (!prov || typeof prov !== 'object' || Array.isArray(prov)) return null;
  return prov as CellProvenance;
}

/** Did a person put their hands on this cell at all? */
export function touchedByHuman(prov: CellProvenance | null): boolean {
  return !!prov?.origin && HUMAN_ORIGINS.has(prov.origin);
}

/** Human-readable, and deliberately not the raw origin string. */
export const ORIGIN_LABEL: Record<CellOrigin, string> = {
  ai: 'Extracted by AI',
  human_edited: 'Changed by a reviewer',
  human_authored: 'Entered by a reviewer',
  human_confirmed: 'Confirmed by a reviewer',
  ai_suggestion: 'Accepted from an AI suggestion',
};

export const EVIDENCE_LABEL: Record<EvidenceState, string> = {
  inherited: 'Kept the original quote',
  reanchored: 'Quote re-located in the paper',
  reviewer_supplied: 'Reviewer picked the quote',
  unverified: 'No quote supports this value',
  none: 'Nothing to quote (NR / NA)',
};

/** What kind of touch one timeline entry records. */
export type TouchKind = 'ai' | 'entered' | 'edited' | 'confirmed' | 'sourced';

export interface CellTouch {
  kind: TouchKind;
  /** Null for the AI baseline, which carries no per-cell timestamp. */
  at: string | null;
  /** Null for the AI baseline. */
  userId: string | null;
  role: string | null;
  /** The value as of this touch, when we know it. */
  value?: unknown;
}

/**
 * The edit history of one cell, oldest first.
 *
 * **This is not a full version history, and must not be presented as one.**
 * `prior_value` is the frozen ORIGINAL baseline, preserved through repeat edits
 * by the backend's `_prior_block` so an edit chain still shows what the AI
 * first said. The consequence is that intermediate values are not kept: edit a
 * cell from 1 to 2 to 3 and the stored block says "was 1, is 3" with no record
 * of 2. `audit_trail` has one row per save and is the finer-grained source —
 * `CellHistoryPanel` merges the two.
 */
export function cellHistory(
  prov: CellProvenance | null,
  currentValue: unknown,
): CellTouch[] {
  if (!prov) return [];
  const touches: CellTouch[] = [];

  const hasPrior = prov.prior_value !== undefined && prov.prior_value !== null;
  if (hasPrior && prov.prior_origin) {
    touches.push({
      kind: prov.prior_origin === 'ai' ? 'ai' : 'entered',
      at: null,
      userId: null,
      role: null,
      value: prov.prior_value,
    });
  }

  if (prov.edited_at) {
    touches.push({
      kind: prov.origin === 'human_authored' ? 'entered' : 'edited',
      at: prov.edited_at,
      userId: prov.edited_by ?? null,
      role: prov.edited_by_role ?? null,
      value: currentValue,
    });
  }
  if (prov.confirmed_at) {
    touches.push({
      kind: 'confirmed',
      at: prov.confirmed_at,
      userId: prov.confirmed_by ?? null,
      role: prov.confirmed_by_role ?? null,
      value: currentValue,
    });
  }
  if (prov.sourced_at) {
    touches.push({
      kind: 'sourced',
      at: prov.sourced_at,
      userId: prov.sourced_by ?? null,
      role: prov.sourced_by_role ?? null,
    });
  }

  // Stable chronological order. The AI baseline has no stamp and always leads.
  return touches.sort((a, b) => {
    if (a.at === b.at) return 0;
    if (!a.at) return -1;
    if (!b.at) return 1;
    return a.at.localeCompare(b.at);
  });
}

/**
 * The one person to name on a dense cell — the latest human touch.
 *
 * Precedence is by timestamp, not by kind: a reviewer who confirms a value
 * after someone else edited it is the person whose judgement the cell now
 * carries.
 */
export function latestTouch(prov: CellProvenance | null): CellTouch | null {
  const human = cellHistory(prov, undefined).filter(t => t.userId);
  return human.length ? human[human.length - 1] : null;
}

/** Verb for a timeline line. Kept short — the panel puts it after the name. */
export const TOUCH_VERB: Record<TouchKind, string> = {
  ai: 'extracted',
  entered: 'entered',
  edited: 'changed to',
  confirmed: 'confirmed the value',
  sourced: 'attached a source quote',
};

/** Whether a touch's wording takes a value after the verb. */
export function touchShowsValue(kind: TouchKind): boolean {
  return kind === 'ai' || kind === 'entered' || kind === 'edited';
}

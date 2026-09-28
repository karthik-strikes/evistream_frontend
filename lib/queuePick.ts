/**
 * Which manual-extraction paper to open next. One definition, shared by the
 * manual-extraction queue ("Resume") and Project Home ("Continue").
 *
 * Extraction only, on purpose: papers, RoB assessments, consensus decisions and
 * synthesis approvals are unlike objects, and ranking them against each other
 * would be an invented urgency score. Home orders workflows by a fixed rule and
 * lets the reviewer pick another from the list.
 */
export interface ExtractionPickable {
  /** The paper can be opened (processed / accepted). */
  ready: boolean;
  /** Some form already saved or drafted. */
  active: boolean;
  /** Not declared finished. */
  open: boolean;
  /** There is a form left to do. */
  hasNext: boolean;
  label: string;
}

/** Half-finished first, then untouched, then what can't be opened. */
export const extractionQueueRank = (t: Pick<ExtractionPickable, 'ready' | 'active'>): number =>
  (t.ready ? 0 : 2) + (t.active ? 0 : 1);

export function sortExtractionQueue<T extends Pick<ExtractionPickable, 'ready' | 'active' | 'label'>>(list: T[]): T[] {
  return [...list].sort((x, y) => extractionQueueRank(x) - extractionQueueRank(y) || x.label.localeCompare(y.label));
}

/** The one paper to open next: already under way, else the first untouched one. */
export function pickNextExtractionTask<T extends ExtractionPickable>(list: T[]): T | null {
  return sortExtractionQueue(list.filter(t => t.open && t.ready && t.hasNext))[0] ?? null;
}

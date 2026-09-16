/**
 * Drawable rectangles from a stored `source_location`.
 *
 * Every screen that shows evidence needs the same answer to "where on the page
 * is it?", so the reading lives here rather than in each one. Manual extraction
 * writes this geometry (a reviewer's text selection, or a box they dragged round
 * a figure or a scanned page); /consensus and /results only read it.
 *
 * The rule that matters: **no dimensions, no rectangle.** A box means nothing
 * without the space it was measured in, and the AI path records its bboxes in
 * Datalab's page space while usually omitting `page_width`/`page_height` —
 * drawing those as if they were PDF points puts the highlight somewhere else
 * entirely. When this returns null the viewer falls back to locating the quote
 * by text, which is what it has always done for AI evidence.
 */

export interface EvidenceBoxes {
  /** 1-indexed, like `source_location.page`. */
  page: number;
  /** `[x0, y0, x1, y1]` each, in the space named below. */
  boxes: Array<[number, number, number, number]>;
  pageWidth: number;
  pageHeight: number;
}

export function boxesFromLocation(loc: any): EvidenceBoxes | null {
  if (!loc || typeof loc !== 'object') return null;

  const pageWidth = Number(loc.page_width);
  const pageHeight = Number(loc.page_height);
  if (!(pageWidth > 0) || !(pageHeight > 0)) return null;

  const raw = Array.isArray(loc.bboxes) ? loc.bboxes : [];
  const page = typeof loc.page === 'number'
    ? loc.page
    : typeof raw[0]?.page === 'number' ? raw[0].page + 1 : null;
  if (page == null) return null;

  const boxes = raw
    // `bboxes[].page` is 0-indexed; `page` is 1-indexed. One page's boxes only —
    // the viewer draws onto a single page.
    .filter((b: any) => Array.isArray(b?.bbox) && b.bbox.length === 4
      && (typeof b.page !== 'number' || b.page + 1 === page))
    .map((b: any) => b.bbox.map(Number) as [number, number, number, number]);
  if (!boxes.length) return null;

  return { page, boxes, pageWidth, pageHeight };
}

/**
 * Does this cell carry evidence a reviewer can be shown?
 *
 * A quote is the usual form, but a drawn box is evidence with no words in it, and
 * a chart reading points at a picture. Screens that gated on `source_text` alone
 * hid both — so a reviewer who cited a scanned page saw their own citation
 * vanish from /results.
 */
export function hasShowableEvidence(cell: any): boolean {
  if (!cell || typeof cell !== 'object' || Array.isArray(cell)) return false;
  const text = typeof cell.source_text === 'string' ? cell.source_text.trim() : '';
  if (text && text !== 'NR') return true;
  if (boxesFromLocation(cell.source_location)) return true;
  return !!cell.source_location?.figure_image;
}

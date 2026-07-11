/**
 * Text-layer overlay computation — returns one rectangle per LINE of matched
 * text, not one giant union rectangle.
 *
 * Why per-line: a multi-line quote spans, say, 4 visual lines on the page.
 * Taking the union of all matched spans gives one big rectangle that covers
 * those 4 lines AND everything between them (margins, neighboring sentences
 * that share the same line). For new docs that's fine — Datalab gives us
 * proper block-level bboxes. For legacy docs we only have pdfjs's per-word
 * spans, so we group them by line and emit one rectangle per line, snug to
 * the actual matched glyphs. Same teal color, just the right shape.
 */

import { matchQuote, type QuoteMatchResult } from './textMatch';

export interface TextLayerOverlay {
  /** Page-wrapper-relative position, in CSS pixels. */
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface TextLayerMatch {
  /** One rectangle per visual text line covered by the quote. */
  rects: TextLayerOverlay[];
  /** Confidence in [0,1] — drives color / style choice in the viewer. */
  confidence: number;
  /** Which match tier produced this match. */
  tier: QuoteMatchResult['tier'];
}

/**
 * Group matched spans by visual text line. Two spans belong to the same line
 * when their vertical centers are within ~`tolerancePx` of each other (font
 * size proxy). Returns one rectangle per group, hugging only the matched
 * glyphs on that line.
 */
function groupSpansByLine(
  spans: HTMLElement[],
  pageRect: DOMRect,
  tolerancePx = 4,
): TextLayerOverlay[] {
  type SpanInfo = { rect: DOMRect; centerY: number };
  const infos: SpanInfo[] = [];
  for (const el of spans) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    infos.push({ rect: r, centerY: (r.top + r.bottom) / 2 });
  }
  if (!infos.length) return [];

  // Sort by vertical position so adjacent items in the same line cluster.
  infos.sort((a, b) => a.centerY - b.centerY);

  type Line = { top: number; bottom: number; left: number; right: number; centers: number[] };
  const lines: Line[] = [];
  for (const it of infos) {
    const lineCenterAvg = (line: Line) =>
      line.centers.reduce((s, v) => s + v, 0) / line.centers.length;
    // Find existing line whose center is within tolerance of this span's center.
    let merged = false;
    for (const line of lines) {
      if (Math.abs(it.centerY - lineCenterAvg(line)) <= tolerancePx) {
        line.top = Math.min(line.top, it.rect.top);
        line.bottom = Math.max(line.bottom, it.rect.bottom);
        line.left = Math.min(line.left, it.rect.left);
        line.right = Math.max(line.right, it.rect.right);
        line.centers.push(it.centerY);
        merged = true;
        break;
      }
    }
    if (!merged) {
      lines.push({
        top: it.rect.top,
        bottom: it.rect.bottom,
        left: it.rect.left,
        right: it.rect.right,
        centers: [it.centerY],
      });
    }
  }

  return lines.map((l) => ({
    left: l.left - pageRect.left,
    top: l.top - pageRect.top,
    width: l.right - l.left,
    height: l.bottom - l.top,
  }));
}

/**
 * Walk the spans inside `textLayer`, build a flat character index, find the
 * quote with `matchQuote`, then return one rectangle per LINE of matched
 * text (snug to the matched glyphs, not the full bounding union).
 *
 * @param quote     The LLM-emitted source text we want to highlight.
 * @param textLayer The `.react-pdf__Page__textContent` element.
 * @param pageEl    The page wrapper used as the offset origin.
 */
export function findTextLayerOverlay(
  quote: string,
  textLayer: HTMLElement,
  pageEl: HTMLElement,
): TextLayerMatch | null {
  if (!quote || !textLayer || !pageEl) return null;

  const allSpans = Array.from(textLayer.querySelectorAll('span')) as HTMLElement[];
  // pdfjs sometimes nests spans inside spans for ligatures/positioning. Keep
  // only leaf text spans so we don't double-count text.
  const leaves = allSpans.filter((s) => !s.querySelector('span'));
  if (!leaves.length) return null;

  // Build flat string, remember the [start, end) char range of each span.
  let flat = '';
  const ranges: Array<{ start: number; end: number; el: HTMLElement }> = [];
  for (const el of leaves) {
    const text = el.textContent ?? '';
    if (!text) continue;
    const start = flat.length;
    flat += text;
    flat += ' ';
    ranges.push({ start, end: start + text.length, el });
  }
  if (!flat.trim()) return null;

  const match = matchQuote(flat, quote);
  if (!match) return null;

  const matchStart = match.index;
  const matchEnd = match.index + match.needle.length;
  const coveredSpans = ranges
    .filter((r) => r.end > matchStart && r.start < matchEnd)
    .map((r) => r.el);
  if (!coveredSpans.length) return null;

  const pageRect = pageEl.getBoundingClientRect();
  const rects = groupSpansByLine(coveredSpans, pageRect);
  if (!rects.length) return null;

  return { rects, confidence: match.confidence, tier: match.tier };
}

/**
 * Block index — flatten the Datalab JSON sidecar into a searchable list of
 * leaf text blocks, each tagged with its page number and PDF-space bbox.
 *
 * Datalab returns:
 *   {
 *     metadata: { page_stats: [{ page_id, num_blocks }] },
 *     children: [             // one entry per page
 *       {
 *         block_type: "Page",
 *         id: "/page/0/Page/0",
 *         bbox: [x0, y0, x1, y1],
 *         children: [         // leaf blocks
 *           { block_type, id, bbox, html, children: [] },
 *           ...
 *         ],
 *       },
 *       ...
 *     ],
 *   }
 *
 * Page numbers are embedded in the id path (`/page/N/...`).
 */

export interface Bbox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface PageDims {
  /** 0-indexed Datalab page id; +1 for the human-facing page number. */
  pageId: number;
  width: number;
  height: number;
}

export interface FlatBlock {
  id: string;
  pageId: number;
  pageWidth: number;
  pageHeight: number;
  bbox: Bbox;
  blockType: string;
  /** Plain text, HTML tags stripped, whitespace collapsed. */
  text: string;
}

export interface BlocksDocument {
  pages: PageDims[];
  blocks: FlatBlock[];
}

export interface QuoteMatch {
  block: FlatBlock;
  /** 0–1; 1.0 = exact substring, 0.6 = whitespace-normalized. */
  confidence: number;
  /** Local index inside the block.text where the quote starts (only useful for exact). */
  localStart: number;
  /** localStart + matched.length. */
  localEnd: number;
}

const PAGE_ID_RE = /\/page\/(\d+)\//;

function stripHtml(html: string): string {
  if (!html) return '';
  return html
    .replace(/<\/?(?:p|div|span|br|li|ol|ul|h[1-6]|em|strong|i|b|sup|sub|small|u)(?:\s[^>]*)?\/?>/gi, ' ')
    .replace(/<img[^>]*alt="([^"]*)"[^>]*\/?>/gi, '$1') // keep alt for figure captions
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function parsePageId(blockId: string | undefined, fallback: number): number {
  if (!blockId) return fallback;
  const m = blockId.match(PAGE_ID_RE);
  return m ? parseInt(m[1], 10) : fallback;
}

function toBbox(b: number[] | undefined): Bbox | null {
  if (!b || b.length < 4) return null;
  return { x0: b[0], y0: b[1], x1: b[2], y1: b[3] };
}

/**
 * Parse the raw Datalab JSON into a flat list of leaf blocks plus page dimensions.
 */
export function parseBlocks(raw: unknown): BlocksDocument {
  const empty: BlocksDocument = { pages: [], blocks: [] };
  if (!raw || typeof raw !== 'object') return empty;
  const root = raw as { children?: unknown[] };
  const pages: PageDims[] = [];
  const blocks: FlatBlock[] = [];

  for (const pageNode of root.children ?? []) {
    if (!pageNode || typeof pageNode !== 'object') continue;
    const p = pageNode as {
      bbox?: number[];
      id?: string;
      block_type?: string;
      children?: unknown[];
    };
    const pageBbox = toBbox(p.bbox);
    if (!pageBbox) continue;
    const pageId = parsePageId(p.id, pages.length);
    const pageWidth = pageBbox.x1 - pageBbox.x0;
    const pageHeight = pageBbox.y1 - pageBbox.y0;
    pages.push({ pageId, width: pageWidth, height: pageHeight });

    // Walk leaf children (Datalab's children inside a Page are typically leaves).
    walkLeaves(p.children ?? [], pageId, pageWidth, pageHeight, blocks);
  }

  return { pages, blocks };
}

function walkLeaves(
  children: unknown[],
  pageId: number,
  pageWidth: number,
  pageHeight: number,
  out: FlatBlock[],
): void {
  for (const node of children) {
    if (!node || typeof node !== 'object') continue;
    const n = node as {
      id?: string;
      block_type?: string;
      bbox?: number[];
      html?: string;
      children?: unknown[];
    };
    const bbox = toBbox(n.bbox);
    if (!bbox) continue;
    const blockType = n.block_type ?? 'Unknown';
    // Skip the wrapping "Page" type if it shows up nested; keep all leaf content.
    if (blockType === 'Page') {
      walkLeaves(n.children ?? [], pageId, pageWidth, pageHeight, out);
      continue;
    }
    const text = stripHtml(n.html ?? '');
    // If this block has children, recurse (rare — most are leaves), but also
    // keep the parent if it has its own text.
    const hasChildren = Array.isArray(n.children) && n.children.length > 0;
    if (text || !hasChildren) {
      out.push({
        id: n.id ?? `${pageId}/${out.length}`,
        pageId,
        pageWidth,
        pageHeight,
        bbox,
        blockType,
        text,
      });
    }
    if (hasChildren) {
      walkLeaves(n.children!, pageId, pageWidth, pageHeight, out);
    }
  }
}

import { matchQuote } from './textMatch';

/**
 * Find the block whose text contains the quote. Returns null when no block
 * yields any meaningful overlap — caller should render the "derived value"
 * callout in that case.
 *
 * Uses the shared tier strategy in textMatch.ts so the pdfjs text-layer
 * fallback in PdfHighlightViewer can stay consistent with block matching.
 */
export function findQuoteInBlocks(
  blocks: FlatBlock[],
  quote: string,
): QuoteMatch | null {
  if (!quote || !blocks.length) return null;

  // Try each tier across all blocks: tier-1 hits anywhere beat tier-2 hits
  // anywhere, so we iterate in tier order, not per-block.
  let best: QuoteMatch | null = null;
  for (const block of blocks) {
    if (!block.text) continue;
    const m = matchQuote(block.text, quote);
    if (!m) continue;
    if (!best || m.confidence > best.confidence) {
      best = {
        block,
        confidence: m.confidence,
        localStart: 0,
        localEnd: block.text.length,
      };
      if (best.confidence >= 1.0) return best; // exact — early exit
    }
  }
  return best;
}

/**
 * Convert a PDF-space bbox to viewport-space coordinates for an HTML overlay
 * given the rendered dimensions of the page.
 */
export function bboxToViewport(
  bbox: Bbox,
  pageWidth: number,
  pageHeight: number,
  renderedWidth: number,
  renderedHeight: number,
): { left: number; top: number; width: number; height: number } {
  const sx = renderedWidth / pageWidth;
  const sy = renderedHeight / pageHeight;
  return {
    left: bbox.x0 * sx,
    top: bbox.y0 * sy,
    width: (bbox.x1 - bbox.x0) * sx,
    height: (bbox.y1 - bbox.y0) * sy,
  };
}

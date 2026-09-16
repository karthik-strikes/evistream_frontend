'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import {
  X,
  FileText,
  Maximize2,
  Minimize2,
  Sparkles,
  BarChart3,
  AlertTriangle,
  ZoomIn,
  ZoomOut,
  ChevronLeft,
  ChevronRight,
  Quote,
  Crop,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { documentsService } from '@/services/documents.service';
import {
  parseBlocks,
  findQuoteInBlocks,
  findBlockByImageFile,
  bboxToViewport,
  type Bbox,
  type BlocksDocument,
  type QuoteMatch,
} from '@/lib/blockIndex';
import { matchQuote, type QuoteMatchResult } from '@/lib/textMatch';
import { findTextLayerOverlay, type TextLayerMatch as TextLayerMatchRect } from '@/lib/textLayerHighlight';
import { useDocumentFigure } from '@/hooks/useDocumentFigure';
import { FigureReadout } from '@/components/figures/FigureReadout';
import { labelFigureQuote } from '@/lib/figureQuote';

// Worker file is self-hosted under public/.
if (typeof window !== 'undefined') {
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
}

// Set this flag to true (e.g. via DevTools console: `localStorage.setItem('evistream:pdfdebug','1')`)
// to see verbose logs of the matching/overlay/render decisions.
const DEBUG_ENABLED = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem('evistream:pdfdebug') === '1';
  } catch {
    return false;
  }
};
const dbg = (...args: unknown[]) => {
  if (DEBUG_ENABLED()) {
    // eslint-disable-next-line no-console
    console.log('[pdf-viewer]', ...args);
  }
};

// Options passed to pdfjs via <Document options=...>. Disabling annotations
// stops author-added PDF highlights (yellow markups baked into the file by
// previous readers) from rendering — we want OUR overlay to be the only mark.
//
// `AnnotationMode.DISABLE = 0` per pdfjs.
const PDF_DOC_OPTIONS = {
  annotationMode: 0,
  isEvalSupported: false,
} as const;

export interface PdfHighlightViewerProps {
  documentId: string | null;
  filename?: string;
  /** LLM-emitted verbatim quote we're locating in the PDF. */
  sourceText?: string | null;
  /** The extracted value — shown in the derived-value banner if no match. */
  storedValue?: string | null;
  /** Display-friendly field name (e.g., "Patient age"). */
  fieldLabel?: string | null;
  /**
   * 1-indexed page to land on when the quote can't be located — or when there is
   * no quote at all, only a recorded page.
   *
   * The viewer is otherwise steerable only via `sourceText`, which is enough for
   * the source-evidence drawer but not for the consensus review screen: a field
   * can carry `source_location.page` with a `source_text` that never matches
   * (paraphrased, or a value derived from a table). A stored page is still
   * better than page 1. Never overrides a real match.
   */
  initialPage?: number | null;
  /**
   * Reports the page currently in view, so a host can keep it in the URL.
   *
   * Optional, like `onSelectQuote`: the viewer already tracks the page for its
   * own header, and only a host that asks gets told. Manual extraction's
   * `?page=` was a deep-link *input* with no matching output — you could be sent
   * to page 7 but never link anyone to the page you were reading.
   *
   * A host that feeds this straight back into `initialPage` will fight the
   * reader's own scrolling; hand over the landing page once instead.
   */
  onVisiblePageChange?: (page: number) => void;
  onClose?: () => void;
  /** Optional prev/next navigation between sources (rendered inline in
   *  the header next to the close button so the drawer chrome stays a
   *  single bar instead of two stacked headers). */
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
  /** Filename of the figure this quote actually came from, set when the quote
   *  was lifted from Datalab's automatic description of that figure. When
   *  present the viewer highlights the picture itself, because that — not the
   *  caption prose — is the evidence the reviewer needs to check. */
  captionImage?: string | null;
  /** Filename of the digitized figure whose table row this quote was lifted
   *  from (backend/utils/figure_splice.py splices that table into the markdown
   *  at extraction time).
   *
   *  The row exists ONLY in that read-time markdown — the numbers were pixels
   *  in a chart and were never printed as text — so the picture is the only
   *  honest thing to highlight, and every text-matching tier below is by
   *  construction spurious for such a quote. */
  figureImage?: string | null;
  /** Whether a person had confirmed that figure's table at extraction time.
   *  Stale by nature; the live figure record wins when one has loaded. */
  figureVerified?: boolean | null;
  /**
   * Opt in to selection capture: when set, selecting text in the PDF raises a
   * confirm button, and clicking it calls this with the passage and its geometry.
   *
   * Optional on purpose — the consensus screen and the source-evidence drawer
   * render this viewer read-only and must not sprout a capture affordance.
   *
   * This is why manual extraction can offer sourcing at all: it used to render
   * the PDF in a plain <iframe>, and a cross-origin native PDF plugin exposes no
   * selection to the page. pdf.js draws a real text layer into our own DOM, so
   * `window.getSelection()` works normally.
   */
  onSelectQuote?: (quote: SelectedQuote) => void;
  /** Where the next captured quote will be attached, e.g. "mean score · row 2".
   *  Shown on the confirm button so the reviewer can see the target. */
  selectionTargetLabel?: string | null;
  /**
   * Draw exactly these rectangles instead of hunting for the quote.
   *
   * Evidence that already has geometry — a reviewer's own selection, a box they
   * drew round a chart, the AI's own bboxes — should not be re-derived by string
   * matching: the match can fail, and on a scanned page there is no text to
   * match at all. Stored geometry is not a guess, so it wins over both match
   * tiers and over `initialPage`.
   */
  highlightBoxes?: HighlightBoxes | null;
  /**
   * Opt in to region capture: while `regionMode` is on, dragging on a page draws
   * a box instead of selecting text, and the confirm button hands it back here.
   *
   * This is the only way to cite a figure or a scanned page — a chart's numbers
   * were pixels, and a scan has no text layer to select (Kiersch 1994: 11 pages,
   * 0 text spans).
   */
  onSelectRegion?: (region: SelectedQuote) => void;
  regionMode?: boolean;
  /** Present → the viewer renders its own toggle in the header. */
  onRegionModeChange?: (on: boolean) => void;
  /**
   * Passages a reviewer can click to cite, drawn all at once.
   *
   * The per-cell "Cite this" prompt asked the reviewer to go and find a passage
   * for every field in turn. This inverts it: the passages the model already
   * quoted are marked on the page, and one click files the one you are looking
   * at against its field. Only quotes that resolve to a block are drawn — a
   * marker whose position is a guess is worse than no marker.
   */
  markers?: SourceMarker[];
  /** Raised with every key sharing the clicked passage, plus the passage itself
   *  with real geometry, so the citation stored is drawable rather than a page
   *  number and a string. */
  onMarkerClick?: (keys: string[], quote: SelectedQuote) => void;
  /** Status line for the floating pill at the foot of the pane. */
  markerHint?: string | null;
}

/** One citable passage: the quote to find, and what it would be cited for. */
export interface SourceMarker {
  /** Cell key, handed back on click. */
  key: string;
  /** Human name of the cell, e.g. "mean score · row 2". */
  label: string;
  /** The verbatim quote to locate on the page. */
  text: string;
  /** Already cited by the reviewer — drawn as done, still clickable. */
  used?: boolean;
}

/**
 * A readable name for what one passage would be cited for.
 *
 * A table column usually carries the same quote on every row, so the honest
 * count is often ten or twenty — and listing "subgroup · row 1, subgroup · row
 * 2, …" ten times over makes a tooltip nobody finishes reading. When the column
 * is shared, say the column once and count the rows.
 */
function describeMarkers(markers: SourceMarker[]): string {
  if (markers.length === 1) return markers[0].label;
  // Labels are "column · row N" for a table cell, a bare field name otherwise.
  const columns = new Set(markers.map(m => m.label.split(' · ')[0]));
  if (columns.size === 1) {
    return `${[...columns][0]} · ${markers.length} rows`;
  }
  if (markers.length <= 3) return markers.map(m => m.label).join(', ');
  return `${markers.slice(0, 3).map(m => m.label).join(', ')} +${markers.length - 3} more`;
}

/** One located passage and every marker that points at it. Two cells often cite
 *  the same sentence; drawing it twice would stack two rectangles on the same
 *  glyphs, so they are grouped and one click cites all of them. */
interface MarkerHit {
  page: number;
  bbox: Bbox;
  pageWidth: number;
  pageHeight: number;
  confidence: number;
  markers: SourceMarker[];
}

/** A rectangle set to draw, in the space named by `pageWidth`/`pageHeight`. */
export interface HighlightBoxes {
  /** 1-indexed, like `source_location.page`. */
  page: number;
  boxes: Array<[number, number, number, number]>;
  pageWidth: number;
  pageHeight: number;
}

/** A passage a reviewer selected, with geometry in the space named by
 *  `page_width`/`page_height`. Mirrors the AI path's `source_location`. */
export interface SelectedQuote {
  text: string;
  page: number;
  location: {
    page: number;
    bboxes: Array<{ page: number; bbox: [number, number, number, number] }>;
    page_width: number;
    page_height: number;
    matched_text: string;
    confidence: number;
    grounding_method: 'human_selected';
  };
}

interface TextLayerMatchMeta {
  page: number;       // 1-indexed
  confidence: number;
  tier: QuoteMatchResult['tier'];
}

// Single teal style for every highlight, every confidence tier. Deliberately
// NOT yellow/amber so our highlight stays distinct from author-markup yellow
// that occasionally survives the PDF cleaner. The confidence number lives in
// the info card text, not in the highlight color — one visual signal is
// enough for a clinician to parse mid-task.
const HIGHLIGHT_FILL = 'rgba(45, 212, 191, 0.38)';   // teal-400
const HIGHLIGHT_BORDER = 'rgba(13, 148, 136, 0.75)'; // teal-600

/** `[x0,y0,x1,y1]` — how a source_location stores a box — as the object
 *  `bboxToViewport` wants. */
function asBbox(b: [number, number, number, number]) {
  return { x0: b[0], y0: b[1], x1: b[2], y1: b[3] };
}

function highlightStyle(_confidence: number): React.CSSProperties {
  return {
    backgroundColor: HIGHLIGHT_FILL,
    outline: `1.5px solid ${HIGHLIGHT_BORDER}`,
    outlineOffset: '-1.5px',
  };
}

function confidenceLabel(c: number, source: 'bbox' | 'text-layer'): string {
  const pct = Math.round(c * 100);
  if (c >= 0.9) return source === 'text-layer' ? 'Verbatim · text-layer' : 'Verbatim';
  if (c >= 0.7) return `Normalized · ${pct}%`;
  if (c >= 0.6) return `Fuzzy · ${pct}%`;
  if (c >= 0.5) return `Approx · ${pct}%`;
  return `Anchor · ${pct}%`;
}

// Module-level caches — cheap, bounded by hand if needed.
const blobUrlCache = new Map<string, string>();
const textLayerMatchCache = new Map<string, TextLayerMatchMeta | 'no-match'>();

function makeCacheKey(documentId: string, sourceText: string): string {
  return `${documentId}::${sourceText.slice(0, 200)}`;
}

export function PdfHighlightViewer({
  documentId,
  filename,
  sourceText,
  storedValue,
  fieldLabel,
  initialPage,
  onVisiblePageChange,
  onClose,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
  captionImage,
  figureImage,
  figureVerified,
  onSelectQuote,
  selectionTargetLabel,
  highlightBoxes,
  markers,
  onMarkerClick,
  markerHint,
  onSelectRegion,
  regionMode = false,
  onRegionModeChange,
}: PdfHighlightViewerProps) {
  // ── PDF blob ─────────────────────────────────────────────────────────────
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loadingPdf, setLoadingPdf] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  useEffect(() => {
    if (!documentId) {
      setBlobUrl(null);
      return;
    }
    const cached = blobUrlCache.get(documentId);
    if (cached) {
      setBlobUrl(cached);
      setPdfError(null);
      setLoadingPdf(false);
      return;
    }
    let cancelled = false;
    setLoadingPdf(true);
    setPdfError(null);
    documentsService
      .downloadPdfBlob(documentId)
      .then((blob) => {
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        blobUrlCache.set(documentId, url);
        setBlobUrl(url);
      })
      .catch((err) => {
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.error('Failed to fetch PDF blob:', err);
        setPdfError('Failed to load PDF.');
        setBlobUrl(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingPdf(false);
      });
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  // ── Blocks sidecar ───────────────────────────────────────────────────────
  const [blocksDoc, setBlocksDoc] = useState<BlocksDocument | null>(null);
  const [blocksUnavailable, setBlocksUnavailable] = useState(false);

  useEffect(() => {
    if (!documentId) {
      setBlocksDoc(null);
      setBlocksUnavailable(false);
      return;
    }
    let cancelled = false;
    setBlocksDoc(null);
    setBlocksUnavailable(false);
    documentsService
      .downloadBlocks(documentId)
      .then((raw) => {
        if (cancelled) return;
        if (raw === null) {
          // Server replied 200 + {unavailable: true} — legacy doc, no bbox
          // sidecar. Mark the doc as such so the viewer skips bbox matching
          // and goes straight to text-layer fallback.
          setBlocksUnavailable(true);
          setBlocksDoc(null);
          return;
        }
        setBlocksDoc(parseBlocks(raw));
      })
      .catch(() => {
        if (cancelled) return;
        setBlocksUnavailable(true);
      });
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  // ── The digitized figure this quote came from, when it came from one ─────
  // Gated on figureImage inside the hook, so a text-sourced quote never fires
  // a request. Needs a QueryClientProvider above it — both mount points (the
  // source-evidence drawer and the consensus pane) sit under app/layout.tsx's.
  const figure = useDocumentFigure(documentId, figureImage ?? null);
  // The figure's verified state at extraction time is baked into the splice
  // fence and goes stale the moment a reviewer confirms the figure, so prefer
  // the live record whenever the query has resolved.
  const figureIsVerified = figure ? !!figure.verified : !!figureVerified;

  // ── Bbox match (preferred when blocks JSON exists) ───────────────────────
  const bboxMatch: QuoteMatch | null = useMemo(() => {
    if (!blocksDoc) return null;
    // A quote lifted from an automatic figure description is evidence about the
    // FIGURE. Highlight the picture by filename rather than hunting for the
    // caption text: the markdown caption and the blocks caption are separate
    // Datalab generations, worded differently, so a text search would often
    // miss and fall through to the "derived value" callout with no highlight.
    // A quote lifted from a spliced figure table is evidence about the FIGURE,
    // and its text is not in the PDF at all. Return the picture — or nothing.
    //
    // The early return on null is the point, not an oversight: falling through
    // to findQuoteInBlocks would hand a row of bare numbers to the tier cascade
    // in textMatch.ts, whose anchor tier matches on any single token of six or
    // more characters. That is exactly how these values ended up highlighting
    // unrelated prose. No box is better than a confident wrong box.
    if (figureImage) {
      const byFigure = findBlockByImageFile(blocksDoc.blocks, figureImage);
      dbg('figure-table match by image file', {
        documentId, fieldLabel, figureImage,
        found: !!byFigure, page: byFigure ? byFigure.block.pageId + 1 : null,
      });
      return byFigure;
    }
    if (captionImage) {
      const byImage = findBlockByImageFile(blocksDoc.blocks, captionImage);
      if (byImage) {
        dbg('figure match by image file', {
          documentId, fieldLabel, captionImage,
          page: byImage.block.pageId + 1, blockType: byImage.block.blockType,
        });
        return byImage;
      }
    }
    // Stored geometry is the authority: when the caller hands us the exact
    // rectangles, searching the blocks for the same quote only produces a SECOND
    // overlay a few points off the first — the doubled, seamed highlight a
    // reviewer sees over their own selection.
    if (highlightBoxes) return null;
    if (!sourceText) return null;
    const m = findQuoteInBlocks(blocksDoc.blocks, sourceText);
    dbg('bbox match', { documentId, fieldLabel, sourceText: sourceText?.slice(0, 80), match: m ? { page: m.block.pageId + 1, confidence: m.confidence, blockType: m.block.blockType } : null });
    return m;
  }, [blocksDoc, sourceText, documentId, fieldLabel, captionImage, figureImage, highlightBoxes]);

  // ── Citable markers ──────────────────────────────────────────────────────
  /**
   * Every marker quote located in the blocks sidecar, grouped by the block it
   * landed in.
   *
   * Blocks only — never the text-layer sweep the single highlight falls back
   * to. That sweep is one `getTextContent()` per page per quote, which for
   * thirty quotes is thirty full passes of the document; and it yields a page,
   * not a rectangle, so there would be nothing to draw anyway.
   *
   * The 0.6 floor keeps the `prefix` (0.5) and `anchor` (0.3) tiers out.
   * `anchor` matches on any single token of six or more characters — the tier
   * that put highlights on unrelated prose before. A marker is a *button*, so a
   * wrong one does not merely mislead, it files a false citation.
   */
  const markerHits: MarkerHit[] = useMemo(() => {
    if (!blocksDoc || !markers?.length) return [];
    const byBlock = new Map<string, MarkerHit>();
    for (const m of markers) {
      const quote = (m.text ?? '').trim();
      // A very short quote matches everywhere. "NR" and "0.5" are not passages.
      if (quote.length < 12) continue;
      const hit = findQuoteInBlocks(blocksDoc.blocks, quote);
      if (!hit || hit.kind === 'image' || hit.confidence < 0.6) continue;
      const b = hit.block;
      const { x0, y0, x1, y1 } = b.bbox;
      const id = `${b.pageId}:${x0},${y0},${x1},${y1}`;
      const existing = byBlock.get(id);
      if (existing) {
        existing.markers.push(m);
        existing.confidence = Math.max(existing.confidence, hit.confidence);
      } else {
        byBlock.set(id, {
          page: b.pageId + 1,
          bbox: b.bbox,
          pageWidth: b.pageWidth,
          pageHeight: b.pageHeight,
          confidence: hit.confidence,
          markers: [m],
        });
      }
    }
    return [...byBlock.values()];
  }, [blocksDoc, markers]);

  /** Turn a located block into the same `SelectedQuote` shape a text selection
   *  or a drawn box produces, so all three citation routes store one format. */
  const quoteFromHit = useCallback((hit: MarkerHit): SelectedQuote => ({
    text: hit.markers[0]?.text ?? '',
    page: hit.page,
    location: {
      page: hit.page,
      bboxes: [{
        page: hit.page - 1,
        bbox: [hit.bbox.x0, hit.bbox.y0, hit.bbox.x1, hit.bbox.y1],
      }],
      page_width: hit.pageWidth,
      page_height: hit.pageHeight,
      matched_text: hit.markers[0]?.text ?? '',
      confidence: hit.confidence,
      // The reviewer clicked it. That the model quoted it first is why the
      // marker is there at all, but the act on record is a person pointing.
      grounding_method: 'human_selected',
    },
  }), []);

  // ── Text-layer page-level match (fallback when no bbox match) ────────────
  const [textLayerMatch, setTextLayerMatch] = useState<TextLayerMatchMeta | null>(null);
  const [scannedNoText, setScannedNoText] = useState(false);
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [numPages, setNumPages] = useState<number>(0);

  /**
   * Does this PDF have a text layer at all?
   *
   * The match effect below answers that as a side effect, but only when it has a
   * quote to look for. The region hint needs the answer with no quote in play —
   * a reviewer opening a scan needs to be told that drawing a box is the only
   * way to cite it, before they have tried to select anything.
   */
  useEffect(() => {
    if (!pdfDoc || sourceText) return;
    let cancelled = false;
    (async () => {
      let chars = 0;
      const pages = Math.min(pdfDoc.numPages ?? 0, 3);
      for (let i = 1; i <= pages; i++) {
        try {
          const tc = await pdfDoc.getPage(i).then((pg: any) => pg.getTextContent());
          chars += (tc.items ?? []).reduce((n: number, it: any) => n + (it.str?.length ?? 0), 0);
        } catch { /* unreadable page */ }
        if (chars > 0) break;
      }
      if (!cancelled) setScannedNoText(chars === 0);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfDoc, sourceText]);


  useEffect(() => {
    if (!pdfDoc || !sourceText || !documentId) return;
    // Same reason as the bbox memo: with exact rectangles in hand, a text match
    // can only draw a duplicate of them. Skipping it also spares an N-page
    // getTextContent() sweep.
    if (highlightBoxes) {
      setTextLayerMatch(null);
      setScannedNoText(false);
      return;
    }
    // Same reasoning as the bbox memo: a spliced figure row cannot be in the
    // text layer, so an N-page getTextContent() sweep can only find a false
    // positive. Skip it entirely.
    if (bboxMatch || figureImage) {
      setTextLayerMatch(null);
      setScannedNoText(false);
      return;
    }


    const cacheKey = makeCacheKey(documentId, sourceText);
    const cached = textLayerMatchCache.get(cacheKey);
    if (cached === 'no-match') {
      dbg('text-layer search: cache hit (no-match)', { fieldLabel });
      setTextLayerMatch(null);
      setScannedNoText(false);
      return;
    }
    if (cached) {
      dbg('text-layer search: cache hit', { fieldLabel, ...cached });
      setTextLayerMatch(cached);
      setScannedNoText(false);
      return;
    }

    let cancelled = false;
    (async () => {
      let totalChars = 0;
      let best: TextLayerMatchMeta | null = null;
      for (let i = 1; i <= numPages; i++) {
        if (cancelled) return;
        try {
          const page = await pdfDoc.getPage(i);
          const tc = await page.getTextContent();
          const text = (tc.items as Array<{ str?: string }>).map((it) => it?.str ?? '').join(' ');
          totalChars += text.length;
          const m = matchQuote(text, sourceText);
          if (m && (!best || m.confidence > best.confidence)) {
            best = { page: i, confidence: m.confidence, tier: m.tier };
            if (best.confidence >= 1.0) break;
          }
        } catch {
          // skip unreadable page
        }
      }
      if (cancelled) return;
      if (totalChars === 0) {
        dbg('text-layer search: scanned PDF, no text', { fieldLabel });
        setScannedNoText(true);
        setTextLayerMatch(null);
        textLayerMatchCache.set(cacheKey, 'no-match');
      } else {
        dbg('text-layer search: complete', { fieldLabel, totalChars, best });
        setScannedNoText(false);
        setTextLayerMatch(best);
        textLayerMatchCache.set(cacheKey, best ?? 'no-match');
      }
    })();
    return () => {
      cancelled = true;
    };
    // `fieldLabel` is debug-log only, deliberately out of the deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfDoc, sourceText, numPages, bboxMatch, documentId, figureImage, highlightBoxes]);

  // ── Container width (drives page width) ──────────────────────────────────
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>(720);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.floor(entry.contentRect.width);
        if (w > 0) setContainerWidth(w);
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // ── Zoom ─────────────────────────────────────────────────────────────────
  const [zoom, setZoom] = useState(1);
  const zoomIn = useCallback(() => setZoom((z) => Math.min(2, +(z + 0.1).toFixed(2))), []);
  const zoomOut = useCallback(() => setZoom((z) => Math.max(0.5, +(z - 0.1).toFixed(2))), []);

  // Cmd / Ctrl + wheel zoom inside the PDF area
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      setZoom((z) => {
        const next = z + (e.deltaY > 0 ? -0.05 : 0.05);
        return Math.max(0.5, Math.min(2, +next.toFixed(2)));
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // ── Per-page refs + current-visible-page tracking ────────────────────────
  const pageRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [visiblePage, setVisiblePage] = useState(1);
  const [textOverlay, setTextOverlay] = useState<{ page: number; match: TextLayerMatchRect } | null>(null);
  // Page render dimensions — needed by the auto-scroll effect to translate
  // PDF bbox coordinates into viewport pixels. Declared up here (instead of
  // alongside the render handlers below) so the scroll effect can reference it.
  const [renderedDims, setRenderedDims] = useState<Record<number, { width: number; height: number }>>({});
  // Unscaled page size, kept in a ref because only the selection maths reads it
  // and re-rendering on it would be pointless. Lets a captured selection be
  // recorded in PDF-point space instead of whatever zoom happened to be active.
  const originalDims = useRef<Record<number, { width: number; height: number }>>({});

  // Track which page is currently centered in the viewport
  useEffect(() => {
    if (!scrollRef.current || numPages === 0) return;
    const container = scrollRef.current;
    const observer = new IntersectionObserver(
      (entries) => {
        // Pick the entry with the highest intersection ratio
        let bestPage = visiblePage;
        let bestRatio = 0;
        for (const entry of entries) {
          if (entry.intersectionRatio > bestRatio) {
            bestRatio = entry.intersectionRatio;
            bestPage = Number((entry.target as HTMLElement).dataset.page);
          }
        }
        if (bestRatio > 0) setVisiblePage(bestPage);
      },
      { root: container, threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    for (const el of pageRefs.current) {
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [numPages, visiblePage]);

  // Tell the host which page that is, when it asked. Guarded on a real change
  // so a host holding it in state does not re-render on every scroll frame.
  const reportedPageRef = useRef<number | null>(null);
  useEffect(() => {
    if (!onVisiblePageChange || !visiblePage) return;
    if (reportedPageRef.current === visiblePage) return;
    reportedPageRef.current = visiblePage;
    onVisiblePageChange(visiblePage);
  }, [visiblePage, onVisiblePageChange]);

  // ── Auto-scroll to the matched paragraph (not just the page) ────────────
  // We track the "last quote we scrolled to" so user free-scroll isn't stomped.
  // Re-runs as renderedDims/textOverlay update so we land on the bbox once the
  // page has actually rendered (page-center scroll alone leaves the reviewer
  // hunting for the paragraph).
  const lastScrolledQuoteRef = useRef<string | null>(null);
  useEffect(() => {
    // A recorded page is a usable target even with no quote to match, so don't
    // bail on a missing sourceText when initialPage is set. The dedupe key spans
    // both, or moving between two quote-less fields on different pages wouldn't
    // re-scroll.
    if (!sourceText && !initialPage && !highlightBoxes) return;
    const boxKey = highlightBoxes
      ? `${highlightBoxes.page}:${highlightBoxes.boxes.map(b => b.join(',')).join('|')}`
      : '';
    const scrollKey = `${sourceText ?? ''}::${initialPage ?? ''}::${boxKey}`;
    if (lastScrolledQuoteRef.current === scrollKey) return;

    const container = scrollRef.current;
    if (!container) return;

    // Prefer bbox match → text-layer rects → fallback to page center.
    let targetPage = 0;
    let yWithinPage: number | null = null;

    if (highlightBoxes && highlightBoxes.boxes.length) {
      // Stored geometry: no matching, no guessing.
      targetPage = highlightBoxes.page;
      const dims = renderedDims[targetPage];
      if (dims) {
        const v = bboxToViewport(
          asBbox(highlightBoxes.boxes[0]),
          highlightBoxes.pageWidth,
          highlightBoxes.pageHeight,
          dims.width,
          dims.height,
        );
        yWithinPage = v.top;
      }
    } else if (bboxMatch) {
      targetPage = bboxMatch.block.pageId + 1;
      const dims = renderedDims[targetPage];
      if (dims) {
        const v = bboxToViewport(
          bboxMatch.block.bbox,
          bboxMatch.block.pageWidth,
          bboxMatch.block.pageHeight,
          dims.width,
          dims.height,
        );
        yWithinPage = v.top;
      }
    } else if (textOverlay && textOverlay.match.rects.length > 0) {
      targetPage = textOverlay.page;
      yWithinPage = textOverlay.match.rects[0].top;
    } else if (textLayerMatch) {
      targetPage = textLayerMatch.page;
    } else if (figureImage && figure?.page) {
      // The figure couldn't be located in the blocks sidecar, but its own
      // record knows which page it is on. DocumentFigure.page is already
      // 1-based (figure_index._page_of), same as targetPage — no +1.
      targetPage = figure.page;
    } else if (initialPage) {
      // Last resort: the page the extractor recorded. Only reached when no
      // match was found, so it never overrides real evidence.
      targetPage = initialPage;
    }

    if (!targetPage) return;
    const pageEl = pageRefs.current[targetPage - 1];
    if (!pageEl) return;

    if (yWithinPage != null) {
      // Scroll so the paragraph sits ~80px below the top of the viewport
      // (room for the sticky header in the drawer chrome).
      const pageRect = pageEl.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const pageTopInContainer = (pageRect.top - containerRect.top) + container.scrollTop;
      const targetScrollTop = Math.max(0, pageTopInContainer + yWithinPage - 80);
      container.scrollTo({ top: targetScrollTop, behavior: 'smooth' });
      lastScrolledQuoteRef.current = scrollKey;
    } else {
      // Page hasn't rendered dimensions yet — center the page; the effect
      // will re-fire once renderedDims/textOverlay update and refine.
      pageEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [bboxMatch, textLayerMatch, textOverlay, renderedDims, sourceText, initialPage, figureImage, figure?.page, highlightBoxes]);

  // Reset overlay + scroll-tracking on chip change
  useEffect(() => {
    setTextOverlay(null);
    lastScrolledQuoteRef.current = null;
  }, [sourceText, documentId, highlightBoxes]);

  // ── Page render handlers ─────────────────────────────────────────────────

  const onDocLoad = useCallback((doc: any) => {
    setNumPages(doc.numPages);
    setPdfDoc(doc);
    setRenderedDims({});
    pageRefs.current = new Array(doc.numPages).fill(null);
  }, []);

  const handlePageRender = useCallback(
    (pageNumber: number, pageInfo: { width: number; height: number; originalWidth?: number; originalHeight?: number }) => {
      setRenderedDims((prev) => ({ ...prev, [pageNumber]: { width: pageInfo.width, height: pageInfo.height } }));
      originalDims.current[pageNumber] = {
        width: pageInfo.originalWidth ?? pageInfo.width,
        height: pageInfo.originalHeight ?? pageInfo.height,
      };

      // Compute text-layer overlay only for the matched page
      if (!textLayerMatch || textLayerMatch.page !== pageNumber || !sourceText) return;
      const pageEl = pageRefs.current[pageNumber - 1];
      if (!pageEl) return;

      // The text layer is rendered async even after onRenderSuccess. RAF buys
      // it a frame; if it's still not there, retry on the next frame once.
      const tryFind = (attempt = 0) => {
        const textLayer = pageEl.querySelector('.react-pdf__Page__textContent') as HTMLElement | null;
        if (!textLayer || textLayer.children.length === 0) {
          if (attempt < 5) requestAnimationFrame(() => tryFind(attempt + 1));
          else dbg('text-layer overlay: text layer not ready after retries', { pageNumber });
          return;
        }
        const m = findTextLayerOverlay(sourceText, textLayer, pageEl);
        dbg('text-layer overlay computed', { pageNumber, rectCount: m?.rects.length, confidence: m?.confidence });
        if (m) setTextOverlay({ page: pageNumber, match: m });
      };
      requestAnimationFrame(() => tryFind());
    },
    [textLayerMatch, sourceText],
  );

  // ── Banner / callout state ───────────────────────────────────────────────
  // `figureImage` is excluded: a chart-read value that couldn't be located is
  // still not a "derived value", and that banner is the same wrong claim the
  // status line used to make. The figure status line already explains it.
  const showDerivedBanner =
    !!sourceText && !figureImage && !bboxMatch && !textLayerMatch && !scannedNoText && (!!blocksDoc || blocksUnavailable);

  const showLowConfidenceWarning =
    !!((bboxMatch && bboxMatch.confidence < 0.5) ||
       (textLayerMatch && textLayerMatch.confidence < 0.5));

  // ── Selection capture (opt-in via onSelectQuote) ─────────────────────────
  // Only mounted behaviour when a host asks for it; the read-only screens see
  // none of this.
  const [pendingSelection, setPendingSelection] = useState<{
    /** Which callback confirming it should reach. */
    kind: 'text' | 'region';
    quote: SelectedQuote;
    /** Viewport coords for the confirm button. Fixed positioning is deliberate:
     *  it avoids translating through the scroll container's offset and zoom. */
    x: number;
    y: number;
  } | null>(null);

  const captureSelection = useCallback(() => {
    if (!onSelectQuote) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      setPendingSelection(null);
      return;
    }
    const text = sel.toString().replace(/\s+/g, ' ').trim();
    // Two characters is not a quote — and it is how a stray click-drag lands here.
    if (text.length < 3) {
      setPendingSelection(null);
      return;
    }
    const range = sel.getRangeAt(0);

    // Walk up to the page wrapper that owns this text layer.
    let node: Node | null = range.startContainer;
    let pageEl: HTMLElement | null = null;
    while (node) {
      if (node instanceof HTMLElement && node.dataset.page) { pageEl = node; break; }
      node = node.parentNode;
    }
    if (!pageEl) { setPendingSelection(null); return; }

    const pageNumber = Number(pageEl.dataset.page);
    if (!Number.isFinite(pageNumber)) { setPendingSelection(null); return; }

    const rects = Array.from(range.getClientRects()).filter(r => r.width > 0.5 && r.height > 0.5);
    if (rects.length === 0) { setPendingSelection(null); return; }

    // Express the geometry in unscaled page space so it survives zoom, and
    // record which space that is — a consumer must never have to guess.
    const pageBox = pageEl.getBoundingClientRect();
    const rendered = renderedDims[pageNumber];
    const original = originalDims.current[pageNumber];
    const sx = original && rendered && rendered.width ? original.width / rendered.width : 1;
    const sy = original && rendered && rendered.height ? original.height / rendered.height : 1;
    const round = (n: number) => Math.round(n * 10) / 10;

    const bboxes = rects.map(r => ({
      page: pageNumber - 1,          // 0-indexed, as the AI path writes it
      bbox: [
        round((r.left - pageBox.left) * sx),
        round((r.top - pageBox.top) * sy),
        round((r.right - pageBox.left) * sx),
        round((r.bottom - pageBox.top) * sy),
      ] as [number, number, number, number],
    }));

    const last = rects[rects.length - 1];
    setPendingSelection({
      kind: 'text',
      quote: {
        text,
        page: pageNumber,
        location: {
          page: pageNumber,
          bboxes,
          page_width: round(original?.width ?? rendered?.width ?? pageBox.width),
          page_height: round(original?.height ?? rendered?.height ?? pageBox.height),
          matched_text: text,
          confidence: 1,
          grounding_method: 'human_selected',
        },
      },
      x: Math.min(last.right, window.innerWidth - 190),
      y: last.bottom,
    });
  }, [onSelectQuote, renderedDims]);

  // Scrolling invalidates the button's fixed position, so retract it rather
  // than let it drift away from the passage it belongs to.
  useEffect(() => {
    if (!pendingSelection || !scrollRef.current) return;
    const el = scrollRef.current;
    const drop = () => setPendingSelection(null);
    el.addEventListener('scroll', drop, { passive: true });
    return () => el.removeEventListener('scroll', drop);
  }, [pendingSelection]);

  const confirmSelection = useCallback(() => {
    if (!pendingSelection) return;
    const sink = pendingSelection.kind === 'region' ? onSelectRegion : onSelectQuote;
    if (!sink) return;
    sink(pendingSelection.quote);
    setPendingSelection(null);
    window.getSelection()?.removeAllRanges();
  }, [pendingSelection, onSelectQuote, onSelectRegion]);

  // ── Region capture (opt-in via onSelectRegion) ────────────────────────────
  // A drag in page-relative *rendered* pixels while it happens; converted to
  // unscaled page space only on release, exactly as captureSelection does, so a
  // box drawn at 150% zoom lands in the same coordinates as one drawn at 100%.
  const [regionDraft, setRegionDraft] = useState<
    { page: number; x0: number; y0: number; x1: number; y1: number } | null
  >(null);
  const regionDrawing = useRef(false);

  const pageRelative = (pageNumber: number, e: React.MouseEvent) => {
    const el = pageRefs.current[pageNumber - 1];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const beginRegion = useCallback((pageNumber: number, e: React.MouseEvent) => {
    const pt = pageRelative(pageNumber, e);
    if (!pt) return;
    e.preventDefault();
    regionDrawing.current = true;
    setPendingSelection(null);
    setRegionDraft({ page: pageNumber, x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y });
  }, []);

  const dragRegion = useCallback((pageNumber: number, e: React.MouseEvent) => {
    if (!regionDrawing.current) return;
    const pt = pageRelative(pageNumber, e);
    if (!pt) return;
    setRegionDraft(d => (d ? { ...d, x1: pt.x, y1: pt.y } : d));
  }, []);

  const endRegion = useCallback((pageNumber: number, e: React.MouseEvent) => {
    if (!regionDrawing.current) return;
    e.stopPropagation();
    regionDrawing.current = false;
    const d = regionDraft;
    setRegionDraft(null);
    if (!d) return;

    const left = Math.min(d.x0, d.x1), right = Math.max(d.x0, d.x1);
    const top = Math.min(d.y0, d.y1), bottom = Math.max(d.y0, d.y1);
    // A click is not a box — and a stray click is how an empty one gets here.
    if (right - left < 8 || bottom - top < 8) return;

    const rendered = renderedDims[d.page];
    const original = originalDims.current[d.page];
    const sx = original && rendered?.width ? original.width / rendered.width : 1;
    const sy = original && rendered?.height ? original.height / rendered.height : 1;
    const round = (n: number) => Math.round(n * 10) / 10;

    setPendingSelection({
      kind: 'region',
      quote: {
        // No text: a region asserts "the value is in this rectangle", which is
        // the honest claim for a chart or a scan. `matched_text` says which.
        text: '',
        page: d.page,
        location: {
          page: d.page,
          bboxes: [{
            page: d.page - 1,
            bbox: [round(left * sx), round(top * sy), round(right * sx), round(bottom * sy)],
          }],
          page_width: round(original?.width ?? rendered?.width ?? 0),
          page_height: round(original?.height ?? rendered?.height ?? 0),
          matched_text: `region on page ${d.page}`,
          confidence: 1,
          grounding_method: 'human_selected',
        },
      },
      x: Math.min(e.clientX, window.innerWidth - 190),
      y: e.clientY,
    });
  }, [regionDraft, renderedDims]);

  // ── Page jump UI ─────────────────────────────────────────────────────────
  const [jumpValue, setJumpValue] = useState<string>('');
  const onJumpSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const n = parseInt(jumpValue, 10);
      if (Number.isNaN(n) || n < 1 || n > numPages) return;
      pageRefs.current[n - 1]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setJumpValue('');
    },
    [jumpValue, numPages],
  );

  // ── Fullscreen toggle (kept from prior viewer) ───────────────────────────
  const [isExpanded, setIsExpanded] = useState(false);

  // ── Unified status line (info-card footer) ───────────────────────────────
  // Boils every match state down to one icon + one short label. The viewer
  // never shows more than one of these at a time, and it always appears in
  // the same spot (bottom of the info card), so a reviewer can scan it
  // without hunting around the chrome.
  type StatusKind = 'verbatim' | 'verify' | 'derived' | 'scanned' | 'figure' | 'human' | null;
  const statusKind: StatusKind = (() => {
    // A person pointed at the page. That outranks every match tier below —
    // and labelling their own selection "Verbatim · page 1" (a claim about how
    // well a *machine* located a quote) is how it came to be double-marked in
    // the first place.
    if (highlightBoxes) return 'human';
    if (!sourceText) return null;
    // Tested first, and before the 'derived' fallthrough below, so a value read
    // off a chart can never be labelled "Inferred". It was not inferred: it is
    // a verbatim row of a machine's reading of the figure. Those are different
    // claims, and collapsing them tells a reviewer to distrust a good number.
    if (figureImage) return 'figure';
    if (bboxMatch) return bboxMatch.confidence < 0.5 ? 'verify' : 'verbatim';
    if (textLayerMatch) return textLayerMatch.confidence < 0.5 ? 'verify' : 'verbatim';
    if (scannedNoText) return 'scanned';
    if (blocksDoc || blocksUnavailable) return 'derived';
    return null;
  })();

  const statusLabel: string = (() => {
    if (highlightBoxes) {
      return sourceText
        ? `Highlighted by a reviewer · page ${highlightBoxes.page}`
        : `Box drawn by a reviewer · page ${highlightBoxes.page}`;
    }
    if (!sourceText) return '';
    // A figure read never goes through confidenceLabel: that function scores
    // how well a quote matched TEXT, and this quote was never text.
    if (figureImage) {
      const state = figureIsVerified ? 'checked' : 'unchecked';
      const pageNo = bboxMatch ? bboxMatch.block.pageId + 1 : figure?.page ?? null;
      if (!bboxMatch && !pageNo) return `Read from figure · ${state} · location unavailable`;
      if (!bboxMatch) return `Read from figure · ${state} · page ${pageNo} (not located)`;
      return `Read from figure · ${state} · page ${pageNo}`;
    }
    // An image-identity match is a structural join, not a text match — saying
    // "Verbatim" here would claim the quote was found in the PDF.
    if (bboxMatch?.kind === 'image') return `Figure description · page ${bboxMatch.block.pageId + 1}`;
    if (bboxMatch) return `${confidenceLabel(bboxMatch.confidence, 'bbox')} · page ${bboxMatch.block.pageId + 1}`;
    if (textLayerMatch) return `${confidenceLabel(textLayerMatch.confidence, 'text-layer')} · page ${textLayerMatch.page}`;
    if (scannedNoText) return 'Scanned PDF — text layer unavailable';
    if (blocksDoc || blocksUnavailable) return 'Inferred · not a direct quote';
    return '';
  })();

  // Colour means "a person must act" (components/ui/badge.tsx). An unchecked
  // chart read earns amber; a confirmed one is the boring majority and stays
  // teal with the rest of the status line.
  const statusIsAmber = statusKind === 'figure' && !figureIsVerified;

  // The readout refuses to guess a column alignment and returns null when it
  // can't be sure. Ask it the same question here so the card can keep showing
  // the raw quote instead of rendering an empty slot.
  const showFigureReadout = useMemo(
    () => !!(figureImage && sourceText && labelFigureQuote(sourceText, figure?.columns)),
    [figureImage, sourceText, figure?.columns],
  );

  // ── Render ───────────────────────────────────────────────────────────────
  if (loadingPdf && !blobUrl) {
    return (
      <div className="flex h-full flex-col items-center justify-center rounded-xl border border-gray-200 bg-gray-50 p-8 dark:border-[#1f1f1f] dark:bg-[#0a0a0a]">
        <FileText className="mb-3 h-10 w-10 text-gray-300 dark:text-zinc-700" />
        <p className="text-sm italic text-gray-400 dark:text-zinc-600">Loading PDF…</p>
      </div>
    );
  }
  if (pdfError) {
    return (
      <div className="flex h-full flex-col items-center justify-center rounded-xl border border-rose-200 bg-rose-50/30 p-8 dark:border-rose-900/40 dark:bg-rose-900/10">
        <p className="text-sm text-rose-600 dark:text-rose-400">{pdfError}</p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        'flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-[#1f1f1f] dark:bg-[#111111]',
        isExpanded ? 'fixed inset-4 z-50 shadow-2xl' : 'h-full',
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-gray-200 bg-gray-50 px-3 py-2 dark:border-[#1f1f1f] dark:bg-[#0a0a0a]">
        <FileText className="h-3.5 w-3.5 flex-shrink-0 text-gray-400 dark:text-zinc-600" />
        <span className="flex-1 truncate text-xs font-medium text-gray-700 dark:text-zinc-300">
          {filename || 'PDF Viewer'}
        </span>

        <form onSubmit={onJumpSubmit} className="flex items-center gap-1">
          <input
            type="text"
            inputMode="numeric"
            placeholder={String(visiblePage)}
            value={jumpValue}
            onChange={(e) => setJumpValue(e.target.value.replace(/[^0-9]/g, ''))}
            className="w-9 rounded border border-gray-200 bg-white px-1 py-0.5 text-center font-mono text-[11px] text-gray-700 outline-none focus:border-amber-400 dark:border-[#2a2a2a] dark:bg-[#111111] dark:text-zinc-300"
            aria-label="Jump to page"
          />
          <span className="font-mono text-[11px] text-gray-500 dark:text-zinc-500">
            / {numPages || '—'}
          </span>
        </form>

        <div className="ml-1 flex items-center gap-0.5">
          <button onClick={zoomOut} title="Zoom out" disabled={zoom <= 0.5} className="rounded p-1 transition-colors hover:bg-gray-200 disabled:opacity-30 dark:hover:bg-[#1f1f1f]">
            <ZoomOut className="h-3.5 w-3.5 text-gray-600 dark:text-zinc-400" />
          </button>
          <span className="min-w-[36px] text-center font-mono text-[10px] text-gray-500 dark:text-zinc-500">{Math.round(zoom * 100)}%</span>
          <button onClick={zoomIn} title="Zoom in" disabled={zoom >= 2} className="rounded p-1 transition-colors hover:bg-gray-200 disabled:opacity-30 dark:hover:bg-[#1f1f1f]">
            <ZoomIn className="h-3.5 w-3.5 text-gray-600 dark:text-zinc-400" />
          </button>
        </div>

        {onRegionModeChange && (
          <button
            type="button"
            onClick={() => onRegionModeChange(!regionMode)}
            aria-pressed={regionMode}
            title={
              regionMode
                ? 'Drawing a box — drag over the figure, then confirm'
                : 'Draw a box round a figure, a table, or a scanned page'
            }
            className={cn(
              'ml-1 flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium transition-colors',
              regionMode
                ? 'border-teal-500 bg-teal-600 text-white'
                : 'border-gray-200 text-gray-600 hover:bg-gray-200 dark:border-[#2a2a2a] dark:text-zinc-400 dark:hover:bg-[#1f1f1f]',
            )}
          >
            <Crop className="h-3 w-3 flex-none" />
            Box
          </button>
        )}

        <button onClick={() => setIsExpanded(!isExpanded)} className="rounded p-1 transition-colors hover:bg-gray-200 dark:hover:bg-[#1f1f1f]">
          {isExpanded ? (
            <Minimize2 className="h-3.5 w-3.5 text-gray-500 dark:text-zinc-500" />
          ) : (
            <Maximize2 className="h-3.5 w-3.5 text-gray-500 dark:text-zinc-500" />
          )}
        </button>

        {(onPrev || onNext) && (
          <>
            <button
              type="button"
              onClick={onPrev}
              disabled={!hasPrev}
              aria-label="Previous source"
              className="rounded p-1 transition-colors hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-[#1f1f1f]"
            >
              <ChevronLeft className="h-3.5 w-3.5 text-gray-500 dark:text-zinc-500" />
            </button>
            <button
              type="button"
              onClick={onNext}
              disabled={!hasNext}
              aria-label="Next source"
              className="rounded p-1 transition-colors hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-[#1f1f1f]"
            >
              <ChevronRight className="h-3.5 w-3.5 text-gray-500 dark:text-zinc-500" />
            </button>
          </>
        )}

        {onClose && (
          <button onClick={onClose} aria-label="Close" className="rounded p-1 transition-colors hover:bg-gray-200 dark:hover:bg-[#1f1f1f]">
            <X className="h-3.5 w-3.5 text-gray-500 dark:text-zinc-500" />
          </button>
        )}
      </div>

      {/* Unified info card — always above the PDF, never overlapping it.
          Shows: field name, the AI's extracted value, the AI's source quote,
          and a single status line (verbatim / verify / derived / scanned).
          Replaces the three separate banners we had before so the reviewer
          has exactly one place to look for "what did the AI say." */}
      {(sourceText || highlightBoxes) && (
        <div className="border-b border-gray-200 bg-white px-4 py-3 dark:border-[#1f1f1f] dark:bg-[#111111]">
          {fieldLabel && (
            <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-zinc-500">
              {fieldLabel}
            </div>
          )}

          {storedValue && (
            <div className="mb-1.5 flex items-start gap-3">
              <span className="w-12 flex-shrink-0 pt-0.5 text-[9.5px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-600">
                Value
              </span>
              <span className="min-w-0 flex-1 font-mono text-[12.5px] leading-snug text-gray-900 dark:text-zinc-100">
                {storedValue}
              </span>
            </div>
          )}

          {/* A drawn box has no words in it — the rectangle below is the whole
              citation, so the Quote row would be an empty pair of quote marks. */}
          {sourceText && (
          <div className="mb-2 flex items-start gap-3">
            <span className="w-12 flex-shrink-0 pt-0.5 text-[9.5px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-600">
              {showFigureReadout ? 'Figure' : 'Quote'}
            </span>
            <span className="min-w-0 flex-1 text-[12.5px] italic leading-snug text-gray-700 dark:text-zinc-300">
              {showFigureReadout ? (
                /* The raw quote is a markdown table row — verbatim, but
                   unreadable, and it hides which column each number is. */
                <FigureReadout
                  documentId={documentId}
                  figure={figure}
                  quote={sourceText ?? ''}
                  hasHighlight={!!bboxMatch}
                />
              ) : (
                <>&ldquo;{sourceText}&rdquo;</>
              )}
            </span>
          </div>
          )}

          {statusKind && (
            <div className={cn(
              'mt-2 flex items-center gap-1.5 border-t pt-2',
              statusIsAmber
                ? 'border-amber-100 dark:border-amber-900/40'
                : 'border-teal-100 dark:border-teal-900/40',
            )}>
              {statusKind === 'verify' ? (
                <AlertTriangle className="h-3 w-3 flex-shrink-0 text-teal-700 dark:text-teal-300" />
              ) : statusKind === 'figure' ? (
                <BarChart3 className={cn(
                  'h-3 w-3 flex-shrink-0',
                  statusIsAmber
                    ? 'text-amber-700 dark:text-amber-300'
                    : 'text-teal-700 dark:text-teal-300',
                )} />
              ) : statusKind === 'derived' ? (
                <Sparkles className="h-3 w-3 flex-shrink-0 text-teal-700 dark:text-teal-300" />
              ) : (
                <div className="h-2 w-2 flex-shrink-0 animate-pulse rounded-full bg-teal-500" />
              )}
              <span className={cn(
                'truncate text-[11px] font-medium',
                statusIsAmber
                  ? 'text-amber-800 dark:text-amber-300'
                  : 'text-teal-800 dark:text-teal-300',
              )}>
                {statusLabel}
                {statusKind === 'verify' && (
                  <span className="ml-1 font-normal opacity-80">— please verify manually</span>
                )}
                {statusKind === 'figure' && !figureIsVerified && (
                  <span className="ml-1 font-normal opacity-80">— check it against the chart</span>
                )}
              </span>
            </div>
          )}
        </div>
      )}

      {onSelectRegion && regionMode && (
        <div className="flex items-center gap-1.5 border-b border-teal-200 bg-teal-50 px-3 py-1 text-[11px] text-teal-800 dark:border-teal-900/50 dark:bg-teal-950/40 dark:text-teal-300">
          <Crop className="h-3 w-3 flex-none" />
          Drag on the page to draw a box round the figure, table or scanned text you are citing.
          {scannedNoText && <span className="opacity-80">This PDF is a scan, so this is the only way to cite it.</span>}
        </div>
      )}

      {/* Scrollable PDF body — all pages stacked, free scroll, no button-clicking */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto bg-gray-100 dark:bg-[#080808]"
        // While a box is being drawn, text capture must stay out of the way:
        // mouseup bubbles up from the page overlay, and captureSelection —
        // finding no text selected — used to clear the region it had just made.
        onMouseUp={onSelectQuote && !regionMode ? captureSelection : undefined}
      >
        {blobUrl && (
          <Document
            file={blobUrl}
            options={PDF_DOC_OPTIONS}
            onLoadSuccess={onDocLoad}
            loading={
              <div className="flex h-[400px] items-center justify-center text-xs text-gray-400">Loading PDF…</div>
            }
            error={
              <div className="flex h-[400px] items-center justify-center text-xs text-rose-500">Failed to load PDF.</div>
            }
          >
            <div className="flex flex-col items-center gap-3 py-3">
              {Array.from({ length: numPages }, (_, i) => {
                const pageNumber = i + 1;
                const isMatchedPage =
                  (highlightBoxes?.page === pageNumber) ||
                  (bboxMatch && bboxMatch.block.pageId + 1 === pageNumber) ||
                  (textLayerMatch && textLayerMatch.page === pageNumber);

                // Stored rectangles (reviewer selection, drawn region, AI bbox).
                let storedBoxStyles: Array<React.CSSProperties> = [];
                if (highlightBoxes?.page === pageNumber) {
                  const dims = renderedDims[pageNumber];
                  if (dims) {
                    storedBoxStyles = highlightBoxes.boxes.map(box => {
                      const v = bboxToViewport(
                        asBbox(box), highlightBoxes.pageWidth, highlightBoxes.pageHeight,
                        dims.width, dims.height,
                      );
                      return {
                        left: `${v.left}px`, top: `${v.top}px`,
                        width: `${v.width}px`, height: `${v.height}px`,
                        ...highlightStyle(1),
                      };
                    });
                  }
                }

                let bboxOverlayStyle: React.CSSProperties | null = null;
                if (bboxMatch && bboxMatch.block.pageId + 1 === pageNumber) {
                  const dims = renderedDims[pageNumber];
                  if (dims) {
                    const v = bboxToViewport(
                      bboxMatch.block.bbox,
                      bboxMatch.block.pageWidth,
                      bboxMatch.block.pageHeight,
                      dims.width,
                      dims.height,
                    );
                    bboxOverlayStyle = {
                      left: `${v.left}px`,
                      top: `${v.top}px`,
                      width: `${v.width}px`,
                      height: `${v.height}px`,
                      ...highlightStyle(bboxMatch.confidence),
                    };
                  }
                }

                // Text-layer match: one rectangle per visual text line.
                // Keeps the highlight snug to the matched glyphs instead of
                // wrapping a single giant union rect around 4 lines + their
                // margins.
                let textLayerRects: Array<React.CSSProperties> = [];
                if (
                  textLayerMatch &&
                  textOverlay &&
                  textOverlay.page === pageNumber
                ) {
                  const sharedStyle = highlightStyle(textOverlay.match.confidence);
                  textLayerRects = textOverlay.match.rects.map((r) => ({
                    left: `${r.left}px`,
                    top: `${r.top}px`,
                    width: `${r.width}px`,
                    height: `${r.height}px`,
                    ...sharedStyle,
                  }));
                }

                return (
                  <div
                    key={pageNumber}
                    ref={(el) => { pageRefs.current[i] = el; }}
                    data-page={pageNumber}
                    className={cn(
                      'relative bg-white shadow-sm transition-shadow',
                      isMatchedPage && 'shadow-teal-300/40 ring-1 ring-teal-200 dark:ring-teal-700/40',
                    )}
                  >
                    <Page
                      pageNumber={pageNumber}
                      width={containerWidth * zoom}
                      renderAnnotationLayer={false}
                      renderTextLayer={true}
                      onRenderSuccess={(pageInfo: any) => handlePageRender(pageNumber, pageInfo)}
                    />
                    {storedBoxStyles.map((style, idx) => (
                      <div
                        key={`sb-${idx}`}
                        className="pointer-events-none absolute rounded-[2px]"
                        style={style}
                        aria-label="Source highlight (stored)"
                      />
                    ))}
                    {onSelectRegion && regionMode && (
                      <div
                        className="absolute inset-0 z-10 cursor-crosshair"
                        onMouseDown={e => beginRegion(pageNumber, e)}
                        onMouseMove={e => dragRegion(pageNumber, e)}
                        onMouseUp={e => endRegion(pageNumber, e)}
                        onMouseLeave={e => endRegion(pageNumber, e)}
                        aria-label={`Draw a box on page ${pageNumber}`}
                      />
                    )}
                    {regionDraft?.page === pageNumber && (
                      <div
                        className="pointer-events-none absolute z-20 rounded-[2px] border-2 border-teal-500 bg-teal-400/20"
                        style={{
                          left: `${Math.min(regionDraft.x0, regionDraft.x1)}px`,
                          top: `${Math.min(regionDraft.y0, regionDraft.y1)}px`,
                          width: `${Math.abs(regionDraft.x1 - regionDraft.x0)}px`,
                          height: `${Math.abs(regionDraft.y1 - regionDraft.y0)}px`,
                        }}
                      />
                    )}
                    {bboxOverlayStyle && (
                      <div
                        className="pointer-events-none absolute rounded-[2px]"
                        style={bboxOverlayStyle}
                        aria-label="Source highlight"
                      />
                    )}
                    {textLayerRects.map((style, idx) => (
                      <div
                        key={`tl-${idx}`}
                        className="pointer-events-none absolute rounded-[2px]"
                        style={style}
                        aria-label="Source highlight (text-layer)"
                      />
                    ))}

                    {/* Citable passages. Amber, not the teal every other
                        highlight uses, because these are the only marks on the
                        page you can press — and green once pressed. Hidden
                        while a box is being drawn: the region overlay owns the
                        whole page then, and a button under it would swallow the
                        drag. */}
                    {!regionMode && markerHits.map((hit, hi) => {
                      if (hit.page !== pageNumber) return null;
                      const dims = renderedDims[pageNumber];
                      if (!dims) return null;
                      const v = bboxToViewport(hit.bbox, hit.pageWidth, hit.pageHeight, dims.width, dims.height);
                      const used = hit.markers.every(m => m.used);
                      const names = describeMarkers(hit.markers);
                      return (
                        <button
                          key={`mk-${hi}`}
                          type="button"
                          onClick={() => onMarkerClick?.(hit.markers.map(m => m.key), quoteFromHit(hit))}
                          title={used ? `Cited for ${names}` : `Cite this for ${names}`}
                          aria-label={used ? `Cited for ${names}` : `Cite this passage for ${names}`}
                          className={cn(
                            'absolute z-[15] cursor-pointer rounded-[2px] border-0 border-b-2 p-0 transition-colors',
                            used
                              ? 'border-b-green-500 bg-green-300/30 hover:bg-green-300/50'
                              : 'border-b-amber-500 bg-amber-300/35 hover:bg-amber-300/60',
                          )}
                          style={{
                            left: `${v.left}px`, top: `${v.top}px`,
                            width: `${v.width}px`, height: `${v.height}px`,
                          }}
                        />
                      );
                    })}
                    {/* Page number tag in the corner */}
                    <div className="pointer-events-none absolute left-1 top-1 rounded bg-black/40 px-1 py-px font-mono text-[9px] text-white opacity-0 transition-opacity group-hover:opacity-100">
                      {pageNumber}
                    </div>
                  </div>
                );
              })}
            </div>
          </Document>
        )}

        {/* Status pill. Sticky inside the scroll body rather than fixed to the
            pane, so it rides the pages the way the marks it describes do. */}
        {markerHint && (
          <div className="pointer-events-none sticky bottom-3 z-30 flex justify-center px-3">
            <div className="pointer-events-auto flex items-center gap-2 whitespace-nowrap rounded-full bg-zinc-900 px-3.5 py-1.5 text-[11.5px] text-zinc-100 shadow-lg dark:bg-zinc-800">
              <span
                className={cn(
                  'h-[7px] w-[7px] flex-none rounded-full',
                  markerHits.length ? 'bg-amber-400' : 'bg-zinc-500',
                )}
              />
              {markerHint}
            </div>
          </div>
        )}
      </div>

      {/* Confirm button for a captured selection. Rendered last and fixed, so it
          sits above the page canvas without joining the scrolled content. */}
      {pendingSelection && (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}  // keep the selection alive through the click
          onClick={confirmSelection}
          style={{ left: pendingSelection.x, top: pendingSelection.y + 6 }}
          className="fixed z-50 flex max-w-[240px] items-center gap-1.5 rounded-lg border border-teal-500 bg-teal-600 px-2.5 py-1.5 text-[11px] font-semibold text-white shadow-lg transition-colors hover:bg-teal-700"
        >
          {pendingSelection.kind === 'region'
            ? <Crop className="h-3 w-3 flex-none" />
            : <Quote className="h-3 w-3 flex-none" />}
          <span className="truncate">
            {pendingSelection.kind === 'region'
              ? (selectionTargetLabel ? `Use this box for ${selectionTargetLabel}` : 'Use this box')
              : (selectionTargetLabel ? `Use as source for ${selectionTargetLabel}` : 'Use as source')}
          </span>
        </button>
      )}
    </div>
  );
}

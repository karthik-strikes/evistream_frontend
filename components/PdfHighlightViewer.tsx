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
  AlertTriangle,
  ZoomIn,
  ZoomOut,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { documentsService } from '@/services/documents.service';
import {
  parseBlocks,
  findQuoteInBlocks,
  bboxToViewport,
  type BlocksDocument,
  type QuoteMatch,
} from '@/lib/blockIndex';
import { matchQuote, type QuoteMatchResult } from '@/lib/textMatch';
import { findTextLayerOverlay, type TextLayerMatch as TextLayerMatchRect } from '@/lib/textLayerHighlight';

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
  onClose?: () => void;
  /** Optional prev/next navigation between sources (rendered inline in
   *  the header next to the close button so the drawer chrome stays a
   *  single bar instead of two stacked headers). */
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
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
  onClose,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
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

  // ── Bbox match (preferred when blocks JSON exists) ───────────────────────
  const bboxMatch: QuoteMatch | null = useMemo(() => {
    if (!blocksDoc || !sourceText) return null;
    const m = findQuoteInBlocks(blocksDoc.blocks, sourceText);
    dbg('bbox match', { documentId, fieldLabel, sourceText: sourceText?.slice(0, 80), match: m ? { page: m.block.pageId + 1, confidence: m.confidence, blockType: m.block.blockType } : null });
    return m;
  }, [blocksDoc, sourceText, documentId, fieldLabel]);

  // ── Text-layer page-level match (fallback when no bbox match) ────────────
  const [textLayerMatch, setTextLayerMatch] = useState<TextLayerMatchMeta | null>(null);
  const [scannedNoText, setScannedNoText] = useState(false);
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [numPages, setNumPages] = useState<number>(0);

  useEffect(() => {
    if (!pdfDoc || !sourceText || !documentId) return;
    if (bboxMatch) {
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
  }, [pdfDoc, sourceText, numPages, bboxMatch, documentId]);

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
    if (!sourceText && !initialPage) return;
    const scrollKey = `${sourceText ?? ''}::${initialPage ?? ''}`;
    if (lastScrolledQuoteRef.current === scrollKey) return;

    const container = scrollRef.current;
    if (!container) return;

    // Prefer bbox match → text-layer rects → fallback to page center.
    let targetPage = 0;
    let yWithinPage: number | null = null;

    if (bboxMatch) {
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
  }, [bboxMatch, textLayerMatch, textOverlay, renderedDims, sourceText, initialPage]);

  // Reset overlay + scroll-tracking on chip change
  useEffect(() => {
    setTextOverlay(null);
    lastScrolledQuoteRef.current = null;
  }, [sourceText, documentId]);

  // ── Page render handlers ─────────────────────────────────────────────────

  const onDocLoad = useCallback((doc: any) => {
    setNumPages(doc.numPages);
    setPdfDoc(doc);
    setRenderedDims({});
    pageRefs.current = new Array(doc.numPages).fill(null);
  }, []);

  const handlePageRender = useCallback(
    (pageNumber: number, pageInfo: { width: number; height: number }) => {
      setRenderedDims((prev) => ({ ...prev, [pageNumber]: { width: pageInfo.width, height: pageInfo.height } }));

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
  const showDerivedBanner =
    !!sourceText && !bboxMatch && !textLayerMatch && !scannedNoText && (!!blocksDoc || blocksUnavailable);

  const showLowConfidenceWarning =
    !!((bboxMatch && bboxMatch.confidence < 0.5) ||
       (textLayerMatch && textLayerMatch.confidence < 0.5));

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
  type StatusKind = 'verbatim' | 'verify' | 'derived' | 'scanned' | null;
  const statusKind: StatusKind = (() => {
    if (!sourceText) return null;
    if (bboxMatch) return bboxMatch.confidence < 0.5 ? 'verify' : 'verbatim';
    if (textLayerMatch) return textLayerMatch.confidence < 0.5 ? 'verify' : 'verbatim';
    if (scannedNoText) return 'scanned';
    if (blocksDoc || blocksUnavailable) return 'derived';
    return null;
  })();

  const statusLabel: string = (() => {
    if (!sourceText) return '';
    if (bboxMatch) return `${confidenceLabel(bboxMatch.confidence, 'bbox')} · page ${bboxMatch.block.pageId + 1}`;
    if (textLayerMatch) return `${confidenceLabel(textLayerMatch.confidence, 'text-layer')} · page ${textLayerMatch.page}`;
    if (scannedNoText) return 'Scanned PDF — text layer unavailable';
    if (blocksDoc || blocksUnavailable) return 'Inferred · not a direct quote';
    return '';
  })();

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
      {sourceText && (
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

          <div className="mb-2 flex items-start gap-3">
            <span className="w-12 flex-shrink-0 pt-0.5 text-[9.5px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-600">
              Quote
            </span>
            <span className="min-w-0 flex-1 text-[12.5px] italic leading-snug text-gray-700 dark:text-zinc-300">
              &ldquo;{sourceText}&rdquo;
            </span>
          </div>

          {statusKind && (
            <div className="mt-2 flex items-center gap-1.5 border-t border-teal-100 pt-2 dark:border-teal-900/40">
              {statusKind === 'verify' ? (
                <AlertTriangle className="h-3 w-3 flex-shrink-0 text-teal-700 dark:text-teal-300" />
              ) : statusKind === 'derived' ? (
                <Sparkles className="h-3 w-3 flex-shrink-0 text-teal-700 dark:text-teal-300" />
              ) : (
                <div className="h-2 w-2 flex-shrink-0 animate-pulse rounded-full bg-teal-500" />
              )}
              <span className="truncate text-[11px] font-medium text-teal-800 dark:text-teal-300">
                {statusLabel}
                {statusKind === 'verify' && (
                  <span className="ml-1 font-normal opacity-80">— please verify manually</span>
                )}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Scrollable PDF body — all pages stacked, free scroll, no button-clicking */}
      <div ref={scrollRef} className="flex-1 overflow-auto bg-gray-100 dark:bg-[#080808]">
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
                  (bboxMatch && bboxMatch.block.pageId + 1 === pageNumber) ||
                  (textLayerMatch && textLayerMatch.page === pageNumber);

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
      </div>
    </div>
  );
}

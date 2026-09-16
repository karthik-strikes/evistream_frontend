'use client';

import { useCallback, useEffect } from 'react';
import type { EvidenceBoxes } from '@/lib/sourceBoxes';
import dynamic from 'next/dynamic';
import { cn } from '@/lib/utils';
import { MetadataSourceEvidence } from './MetadataSourceEvidence';

// react-pdf pulls in pdfjs-dist which needs browser-only APIs (DOMMatrix,
// DOMRect). Lazy-load on the client to avoid SSR/static-prerender errors.
const PdfHighlightViewer = dynamic(
  () => import('@/components/PdfHighlightViewer').then((m) => m.PdfHighlightViewer),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center text-xs italic text-gray-400 dark:text-zinc-600">
        Loading PDF viewer…
      </div>
    ),
  },
);

export interface SourceEvidenceDrawerProps {
  /** Stored rectangles for this cell's evidence, drawn as-is by the viewer.
   *  This is how a reviewer's own selection — or a box they dragged round a
   *  figure or a scanned page — shows up again instead of just a page number. */
  boxes?: EvidenceBoxes | null;
  open: boolean;
  onClose: () => void;
  documentId: string | null;
  documentFilename: string | null;
  /** Verbatim quote the LLM emitted as source_text. */
  sourceText: string | null;
  /** The extracted/stored value, shown in the "Derived value" callout when
   *  the source_text isn't located in the PDF. */
  storedValue?: string | null;
  /** Column / field name shown in the location badge. */
  fieldLabel?: string;
  /** 1-indexed page the extractor recorded. Forwarded to the viewer as its
   *  last-resort landing page: it never overrides a real match, so a quote that
   *  locates cleanly is unaffected, and one that doesn't now opens on the right
   *  page instead of page 1. */
  page?: number | null;
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
  /** Whether the document has an ingested PDF to highlight. When false and the
   *  doc is a metadata import (ctgov/pubmed), the drawer renders the metadata
   *  evidence view instead of the PDF highlighter. Defaults to true so existing
   *  PDF-backed call sites are unchanged. */
  hasPdf?: boolean;
  /** Document provenance — drives the metadata-view branch and badge. */
  sourceType?: string | null;
  /** NCT ID (ctgov) or PMID (pubmed) for the metadata record. */
  recordId?: string | null;
  doi?: string | null;
  /** True when the quote was located inside Datalab's machine-generated
   *  description of a figure rather than in the authors' own text. Such a quote
   *  passes verbatim verification — the string really is in the parsed
   *  document — so the reviewer has to be told, or they will read a machine's
   *  reading of a chart as the paper's own words. */
  syntheticCaption?: boolean;
  /** Filename of the figure the quote was read from, when it came from an
   *  automatic figure description. Lets the viewer highlight the picture. */
  captionImage?: string | null;
  /** True when the quote is a row of a figure table we digitized ourselves and
   *  spliced into the markdown at extraction time. Unlike a synthetic caption,
   *  this quote is a verbatim line of the text the model read — it is not
   *  inferred — but the numbers came off a chart by machine, so the reviewer
   *  must be told to check them against the picture. */
  fromFigure?: boolean;
  /** Filename of that figure. Lets the viewer highlight it. */
  figureImage?: string | null;
  /** Whether a person had confirmed the figure's table at extraction time. */
  figureVerified?: boolean | null;
}

/**
 * Right-side drawer that opens when a user clicks a source chip on the
 * results page. Renders the actual PDF (not markdown) with a bbox-accurate
 * highlight drawn over the source quote. If the LLM's quote isn't found
 * in the blocks JSON, falls back to pdfjs text-layer search. If even that
 * fails, shows a floating "Derived value" callout.
 *
 * The PdfHighlightViewer owns the PDF fetch (via the backend proxy), the
 * blocks JSON fetch, and all matching/rendering — this component is just
 * the surrounding chrome (drawer panel, header, prev/next nav).
 */
export function SourceEvidenceDrawer({
  open,
  onClose,
  documentId,
  documentFilename,
  sourceText,
  storedValue,
  fieldLabel,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
  hasPdf = true,
  sourceType,
  recordId,
  doi,
  page = null,
  syntheticCaption = false,
  captionImage = null,
  fromFigure = false,
  figureImage = null,
  figureVerified = null,
  boxes = null,
}: SourceEvidenceDrawerProps) {
  // Wrap onClose so we blur whatever button is focused inside the drawer
  // BEFORE flipping aria-hidden to true on its ancestor. Otherwise Chrome
  // logs a warning ("Blocked aria-hidden on an element because its descendant
  // retained focus") because a screen-reader user would lose track of focus
  // when the panel hides.
  const handleClose = useCallback(() => {
    if (typeof document !== 'undefined') {
      const active = document.activeElement as HTMLElement | null;
      if (active && typeof active.blur === 'function') {
        // Only blur if focus is inside the drawer — don't steal focus from
        // unrelated elements elsewhere on the page.
        const drawerAside = document.querySelector('aside[data-source-evidence-drawer]');
        if (drawerAside && drawerAside.contains(active)) {
          active.blur();
        }
      }
    }
    onClose();
  }, [onClose]);

  // ESC closes
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, handleClose]);

  return (
    <>
      <div
        onClick={handleClose}
        className={cn(
          'fixed inset-0 z-[60] bg-black/15 transition-opacity duration-200 dark:bg-black/40',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      />

      <aside
        aria-hidden={!open}
        data-source-evidence-drawer="true"
        className={cn(
          'fixed right-0 top-0 z-[70] flex h-screen w-[780px] max-w-[96vw] flex-col',
          'border-l border-gray-200 bg-white shadow-2xl dark:border-[#1f1f1f] dark:bg-[#0f0f0f]',
          'transition-transform duration-300 ease-out',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        {/* Body — PdfHighlightViewer owns the entire chrome now (filename,
            page input, zoom, prev/next, close all live in its header). */}
        <div className="relative flex-1 min-h-0 bg-gray-50 p-3 dark:bg-[#0a0a0a]">
          {fromFigure ? (
            <div className={cn(
              'mb-2 flex items-start gap-2.5 rounded-lg border px-3 py-2',
              figureVerified
                ? 'border-teal-200/70 bg-teal-50/50 dark:border-teal-900/40 dark:bg-teal-950/20'
                : 'border-amber-200/80 bg-amber-50/70 dark:border-amber-900/40 dark:bg-amber-950/25',
            )}>
              <span
                aria-hidden
                className={cn(
                  'mt-[5px] h-1.5 w-1.5 flex-shrink-0 rounded-full',
                  figureVerified
                    ? 'bg-teal-500 dark:bg-teal-400'
                    : 'bg-amber-500 dark:bg-amber-400',
                )}
              />
              <p className={cn(
                'text-[11.5px] leading-relaxed',
                figureVerified
                  ? 'text-teal-900 dark:text-teal-200/90'
                  : 'text-amber-900 dark:text-amber-200/90',
              )}>
                {figureVerified ? (
                  <>
                    <span className="font-semibold">Read from a figure, checked by a reviewer.</span>{' '}
                    This value comes from the figure&rsquo;s digitized table, which a person has
                    confirmed against the chart.
                  </>
                ) : (
                  <>
                    <span className="font-semibold">Read from a figure.</span>{' '}
                    These numbers were read off the chart image by a model and have not been
                    checked by a person. The figure is highlighted below — read the value off it
                    before accepting.
                  </>
                )}
                {documentId && (
                  <>
                    {' '}
                    <a
                      href={`/documents/${documentId}#figures`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium underline underline-offset-2 hover:opacity-80"
                    >
                      Open the figure card
                    </a>
                    {' '}to correct it.
                  </>
                )}
              </p>
            </div>
          ) : syntheticCaption ? (
            <div className="mb-2 flex items-start gap-2.5 rounded-lg border border-amber-200/80 bg-amber-50/70 px-3 py-2 dark:border-amber-900/40 dark:bg-amber-950/25">
              <span
                aria-hidden
                className="mt-[5px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-500 dark:bg-amber-400"
              />
              <p className="text-[11.5px] leading-relaxed text-amber-900 dark:text-amber-200/90">
                <span className="font-semibold">Automatic figure description.</span>{' '}
                This quote comes from a description of a figure generated during
                document processing — not from text the authors wrote.
                {captionImage
                  ? ' The figure it describes is highlighted below — read the value off the figure before accepting it.'
                  : ' Check it against the figure itself before accepting the value.'}
              </p>
            </div>
          ) : null}
          {!hasPdf && (sourceType === 'ctgov' || sourceType === 'pubmed') ? (
            <MetadataSourceEvidence
              documentId={documentId}
              filename={documentFilename ?? undefined}
              sourceText={sourceText}
              storedValue={storedValue ?? null}
              fieldLabel={fieldLabel ?? null}
              source={sourceType === 'pubmed' ? 'pubmed' : 'ctgov'}
              recordId={recordId ?? null}
              doi={doi ?? null}
              onClose={handleClose}
              onPrev={onPrev}
              onNext={onNext}
              hasPrev={hasPrev}
              hasNext={hasNext}
            />
          ) : (
            <PdfHighlightViewer
              documentId={documentId}
              filename={documentFilename ?? undefined}
              sourceText={sourceText}
              storedValue={storedValue ?? null}
              fieldLabel={fieldLabel ?? null}
              onClose={handleClose}
              onPrev={onPrev}
              onNext={onNext}
              hasPrev={hasPrev}
              hasNext={hasNext}
              initialPage={page}
              captionImage={captionImage}
              figureImage={figureImage}
              highlightBoxes={boxes ?? null}
              figureVerified={figureVerified}
            />
          )}
        </div>
      </aside>
    </>
  );
}

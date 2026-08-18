'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Loader2, Upload, X } from 'lucide-react';
import JsonView from '@uiw/react-json-view';
import { lightTheme } from '@uiw/react-json-view/light';
import { darkTheme } from '@uiw/react-json-view/dark';
import { cn, getErrorMessage } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { Button, CopyButton } from '@/components/ui';
import { clinicalTrialsService, documentsService, pubmedService } from '@/services';
import type { NormalizedArticle, NormalizedTrial } from '@/types/api';
import { useTheme } from '@/contexts/ThemeContext';
import { TrialEvidencePanel } from './TrialEvidencePanel';
import { ArticleEvidencePanel } from '../pubmed/ArticleEvidencePanel';
import { ReferenceEvidencePanel, type StoredReference } from '../documents/ReferenceEvidencePanel';
import { StoredRecordView } from '../documents/StoredRecordView';

/** Registry-backed sources can be re-fetched from an API; reference sources
 *  (bibliographic imports) only exist as the stored JSON sidecar. */
export type ImportedSource = 'ctgov' | 'pubmed' | 'endnote' | 'ris';

export interface ImportedTrialDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Which source this document came from, so the right service/panel gets used. */
  source: ImportedSource | null;
  /** NCT ID (ctgov), PMID (pubmed), or DOI (endnote/ris — no registry id exists). */
  recordId: string | null;
  /** The document row's id — needed to fetch the actual stored content
   *  (GET /documents/{id}/markdown), as opposed to the "Evidence" tab which
   *  re-renders from the live/cached source normalizer, not from storage. */
  documentId: string | null;
  /** True when this is a `metadata_only` document not yet accepted for
   *  extraction. This drawer is the only place the evidence is actually visible,
   *  so it's the right place to decide. Callers must fold the permission check
   *  in — the backend gates acceptance on can_upload_docs, and offering the
   *  button to a viewer just buys them a 403. */
  approvable?: boolean;
  /** Whether this user may attach a PDF (can_upload_docs). Defaults to false:
   *  a drawer that forgets to pass it should hide the button, not offer an
   *  action the backend will reject. */
  canAttachPdf?: boolean;
}

type Tab = 'evidence' | 'raw';

const DEFAULT_WIDTH = 640;
/** Below this the two-column field grid and the tab row stop working. */
const MIN_WIDTH = 420;
const WIDTH_STORAGE_KEY = 'evistream:imported-drawer-width';

const HEADING: Record<ImportedSource, string> = {
  pubmed: 'article',
  ctgov: 'trial',
  endnote: 'reference',
  ris: 'reference',
};

/**
 * Right-edge drawer shown when clicking an already-imported document that has no
 * PDF — answers "what did we actually import?" two ways:
 *  - Evidence tab: for PubMed/CT.gov, the same evidence panel shown in the search
 *    drawer before import (re-rendered from the normalized API, cached). For
 *    EndNote/RIS there is no registry to re-fetch from, so the stored sidecar IS
 *    the record and ReferenceEvidencePanel renders it directly.
 *  - Stored record tab: the JSON content sitting in S3 at this
 *    document's s3_markdown_path — the actual artifact the extraction
 *    pipeline reads, fetched via the existing documents/{id}/markdown route.
 * The external source link lives inside the evidence panel as a secondary
 * action, not the only way to see the data.
 */
export function ImportedTrialDrawer({ open, onClose, source, recordId, documentId, approvable, canAttachPdf = false }: ImportedTrialDrawerProps) {
  const { resolvedTheme } = useTheme();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('evidence');
  // How the stored sidecar is rendered on the Raw tab. Table reads better;
  // JSON is the escape hatch when you need to see the literal bytes.
  const [rawView, setRawView] = useState<'table' | 'json'>('table');

  const [width, setWidth] = useState(DEFAULT_WIDTH);
  // Mirrors `width` so the drag listeners can read the latest value without
  // being torn down and re-attached on every pointermove.
  const widthRef = useRef(DEFAULT_WIDTH);

  const applyWidth = (next: number, persist = true) => {
    // Always leave a strip of the page behind the drawer — a panel that covers
    // the whole viewport has no visible way back out.
    const max = Math.max(MIN_WIDTH, window.innerWidth - 48);
    const clamped = Math.min(Math.max(next, MIN_WIDTH), max);
    widthRef.current = clamped;
    setWidth(clamped);
    if (persist) window.localStorage.setItem(WIDTH_STORAGE_KEY, String(clamped));
  };

  // Restore the chosen width once on mount — localStorage is client-only, so
  // this can't be the initial useState value without breaking hydration.
  useEffect(() => {
    const saved = Number(window.localStorage.getItem(WIDTH_STORAGE_KEY));
    if (Number.isFinite(saved) && saved >= MIN_WIDTH) applyWidth(saved, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    // Listeners go on the document, not the handle: the pointer routinely
    // outruns a 2px strip mid-drag, and losing it there would drop the resize.
    const onMove = (ev: PointerEvent) => applyWidth(window.innerWidth - ev.clientX, false);
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      window.localStorage.setItem(WIDTH_STORAGE_KEY, String(widthRef.current));
    };
    // Without these, dragging across the panel selects its text and the cursor
    // flickers between col-resize and whatever it's passing over.
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  };
  const [trial, setTrial] = useState<NormalizedTrial | null>(null);
  const [article, setArticle] = useState<NormalizedArticle | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [rawContent, setRawContent] = useState<string | null>(null);
  const [rawLoading, setRawLoading] = useState(false);
  const [rawError, setRawError] = useState<string | null>(null);

  // Manual "attach PDF" fallback — see the caution banner below. Only ever
  // relevant here because this drawer only opens for documents without a
  // real PDF (the row-click branch in documents/page.tsx sends any
  // s3_pdf_path-having row straight to the PDF viewer instead).
  const [attaching, setAttaching] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isReference = source === 'endnote' || source === 'ris';

  // The stored file is JSON (see build_document_content on the backend), but
  // fall back to plain text if it's ever not — e.g. a legacy document from
  // before this was pure JSON, or corrupted content. Never let a bad parse
  // crash the drawer.
  const parsedRaw = useMemo(() => {
    if (!rawContent) return null;
    try {
      return JSON.parse(rawContent);
    } catch {
      return undefined; // signals "not valid JSON" distinctly from "no content yet"
    }
  }, [rawContent]);

  const reference = useMemo<StoredReference | null>(() => {
    if (!isReference) return null;
    if (!parsedRaw || typeof parsedRaw !== 'object' || Array.isArray(parsedRaw)) return null;
    return parsedRaw as StoredReference;
  }, [isReference, parsedRaw]);

  /** Did this PubMed import actually capture PMC full text? Answered from the
   *  stored sidecar (the only place that knows), NOT the Evidence tab's live
   *  re-fetch. Tri-state on purpose: `null` = sidecar still loading, so the
   *  attach card can't claim "not found" before the evidence for that claim
   *  has arrived — a plain boolean would flash the wrong message on every
   *  open. Reads the same `fullText` key pubmed.py writes on the PMC tier. */
  const pubmedHasFullText = useMemo<boolean | null>(() => {
    if (source !== 'pubmed') return null;
    if (rawContent === null) return null;
    const ft = parsedRaw && typeof parsedRaw === 'object' ? (parsedRaw as any).fullText : null;
    return Array.isArray(ft) && ft.length > 0;
  }, [source, rawContent, parsedRaw]);

  useEffect(() => {
    if (!open) return;
    setTab('evidence');
    setRawView('table');
  }, [open, source, recordId]);

  // Registry fetch — skipped for reference sources, which have no such endpoint.
  useEffect(() => {
    if (!open || !recordId || !source || isReference) return;
    setLoading(true);
    setError(null);
    setTrial(null);
    setArticle(null);
    const fetcher = source === 'ctgov' ? clinicalTrialsService.get(recordId) : pubmedService.get(recordId);
    fetcher
      .then((data: any) => (source === 'ctgov' ? setTrial(data) : setArticle(data)))
      .catch(() => setError(`Failed to load ${source === 'ctgov' ? 'trial' : 'article'} data`))
      .finally(() => setLoading(false));
  }, [open, source, recordId, isReference]);

  // Stored sidecar. Normally lazy (Raw tab only), but fetched as soon as the
  // drawer opens for reference sources (whose Evidence tab is built from it)
  // and for PubMed (whose attach card has to know whether PMC full text was
  // actually captured — the Evidence tab's live re-fetch can't tell us that).
  useEffect(() => {
    if (!open || !documentId || rawContent !== null) return;
    if (tab !== 'raw' && !isReference && source !== 'pubmed') return;
    setRawLoading(true);
    setRawError(null);
    documentsService
      .downloadMarkdown(documentId)
      .then(setRawContent)
      .catch(() => setRawError('Failed to load the stored file'))
      .finally(() => setRawLoading(false));
  }, [open, tab, documentId, rawContent, isReference]);

  // Reset the raw-file cache each time a different document is opened
  useEffect(() => {
    setRawContent(null);
    setRawError(null);
  }, [documentId]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // "Go find the paper" links for the attach card. PubMed reads them off the
  // normalized article; EndNote/RIS off the stored sidecar.
  const attachLinks = useMemo(() => {
    const out: { label: string; href: string }[] = [];
    if (source === 'pubmed') {
      if (article?.sourceUrl) out.push({ label: 'PubMed', href: article.sourceUrl });
      if (article?.doi) out.push({ label: `Publisher (doi:${article.doi})`, href: `https://doi.org/${article.doi}` });
    } else if (isReference && reference) {
      if (reference.pmid) {
        out.push({ label: 'PubMed', href: `https://pubmed.ncbi.nlm.nih.gov/${reference.pmid}/` });
      }
      if (reference.doi) {
        out.push({ label: `Publisher (doi:${reference.doi})`, href: `https://doi.org/${reference.doi}` });
      } else if (reference.url) {
        out.push({ label: 'Source link', href: reference.url });
      }
    }
    return out;
  }, [source, isReference, article, reference]);

  // Shown whenever this document could use a PDF — including PubMed imports
  // that DID get PMC full text, since a real PDF is still an upgrade there
  // (page viewer, page-anchored quotes). What changes for those is the card's
  // wording, not its presence; hiding it would remove the only way to attach
  // a licensed copy. Held back for PubMed until the sidecar resolves, so the
  // card never renders a claim it can't yet support.
  const showAttachCard =
    approvable || isReference || (source === 'pubmed' && pubmedHasFullText !== null);

  const [accepting, setAccepting] = useState(false);
  const handleAccept = async () => {
    if (!documentId) return;
    try {
      setAccepting(true);
      await documentsService.approveMetadata([documentId]);
      toast({
        title: 'Accepted for extraction',
        description: 'This document will be included in the next run.',
        variant: 'success',
      });
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      onClose();
    } catch (error: any) {
      toast({ title: 'Error', description: getErrorMessage(error, 'Could not accept this document'), variant: 'error' });
    } finally {
      setAccepting(false);
    }
  };

  const handleAttachFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file if attach fails
    if (!file || !documentId) return;
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      toast({ title: 'Invalid file', description: 'Please select a PDF file.', variant: 'error' });
      return;
    }
    try {
      setAttaching(true);
      await documentsService.attachPdf(documentId, file);
      toast({
        title: 'PDF attached',
        description: 'Processing started — this document will update shortly.',
        variant: 'success',
      });
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      onClose();
    } catch (error: any) {
      toast({ title: 'Error', description: getErrorMessage(error, 'Failed to attach PDF'), variant: 'error' });
    } finally {
      setAttaching(false);
    }
  };

  return (
    <>
      <div
        onClick={onClose}
        className={cn(
          'fixed inset-0 z-[60] bg-black/15 transition-opacity duration-200 dark:bg-black/40',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      />

      <aside
        aria-hidden={!open}
        style={{ width, maxWidth: '95vw' }}
        className={cn(
          'fixed right-0 top-0 z-[70] flex h-screen flex-col',
          'border-l border-gray-200 bg-white shadow-2xl dark:border-[#1f1f1f] dark:bg-[#0f0f0f]',
          // Only the slide-in animates. Width must not, or dragging lags the cursor.
          'transition-transform duration-300 ease-out',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        {/* Drag the left edge to widen — wide CT.gov tables and full-text prose
            don't fit 640px. Double-click resets; arrow keys nudge for keyboard
            users. Width persists per browser, so it's set once and forgotten. */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panel"
          tabIndex={0}
          onPointerDown={startResize}
          onDoubleClick={() => applyWidth(DEFAULT_WIDTH)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') applyWidth(width + 40);
            else if (e.key === 'ArrowRight') applyWidth(width - 40);
            else return;
            e.preventDefault();
          }}
          className="group absolute left-0 top-0 z-10 h-full w-2 -translate-x-1/2 cursor-col-resize focus:outline-none"
        >
          <div className="mx-auto h-full w-px bg-transparent transition-colors group-hover:bg-gray-300 group-focus:bg-gray-400 dark:group-hover:bg-[#333] dark:group-focus:bg-[#444]" />
        </div>

        <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-gray-100 dark:border-[#1f1f1f] flex-shrink-0">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white tracking-tight">
              Imported {source ? HEADING[source] : 'record'} data
            </h2>
            <p className="text-xs text-gray-400 dark:text-zinc-500 mt-0.5 truncate">
              {recordId ? `${recordId} · ` : ''}what evistream stored for this document
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-[#1a1a1a] dark:hover:text-zinc-300 transition-colors border-none bg-transparent cursor-pointer mt-0.5"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {showAttachCard && (
          <div className="px-6 pt-4 flex-shrink-0">
            <div className="rounded-lg border border-gray-200 dark:border-[#2a2a2a] bg-gray-50 dark:bg-[#161616] p-4">
              <div className="text-[11px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wider mb-1.5">
                {source === 'ctgov'
                  ? 'No results posted'
                  : pubmedHasFullText
                    ? 'Full text via PubMed Central'
                    : 'Full text not found'}
              </div>
              <p className="text-xs text-gray-500 dark:text-zinc-400 leading-relaxed mb-3">
                {source === 'ctgov'
                  ? 'This is a registration-only record: eligibility, planned arms and planned outcome measures, but no posted results. Outcome fields will have nothing to read.'
                  : pubmedHasFullText
                    ? 'The full article body was retrieved from PubMed Central and is what extraction reads. Attach the publisher PDF if you also want a page viewer and page-anchored quotes.'
                    : 'No open-access PDF was found automatically. Attach one below if you have licensed access.'}
              </p>
              {attachLinks.length > 0 && (
                <div className="flex flex-wrap items-center gap-4 mb-3">
                  {attachLinks.map((l) => (
                    <a
                      key={l.href}
                      href={l.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-medium text-gray-600 dark:text-zinc-300 hover:text-gray-900 dark:hover:text-white hover:underline"
                    >
                      {l.label}
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  ))}
                </div>
              )}
              {/* Accept is offered here because this is the only surface where the
                  stored evidence is actually visible — you decide by reading it. */}
              {approvable && (
                <>
                  <Button onClick={handleAccept} loading={accepting} className="w-full mb-1.5">
                    {accepting ? 'Accepting…' : 'Accept for extraction'}
                  </Button>
                  <p className="text-[10px] text-gray-400 dark:text-zinc-600 mb-3 text-center">
                    Extraction will read only the stored record — full-text-only fields return NR.
                  </p>
                </>
              )}
              {canAttachPdf && (
                <>
                  <Button
                    onClick={() => fileInputRef.current?.click()}
                    loading={attaching}
                    variant={approvable ? 'outline' : undefined}
                    className="w-full"
                  >
                    {!attaching && <Upload className="w-4 h-4" />}
                    {attaching ? 'Attaching…' : 'Attach PDF'}
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/pdf"
                    className="hidden"
                    onChange={handleAttachFile}
                  />
                  <p className="text-[10px] text-gray-400 dark:text-zinc-600 mt-2 text-center">
                    Only attach PDFs you&rsquo;re licensed to use.
                  </p>
                </>
              )}
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex items-center gap-1 px-6 pt-3 flex-shrink-0 border-b border-gray-100 dark:border-[#1f1f1f]">
          {(['evidence', 'raw'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'px-3 py-1.5 text-xs font-medium rounded-t-lg border-b-2 -mb-px transition-colors cursor-pointer bg-transparent',
                tab === t
                  ? 'border-gray-900 dark:border-white text-gray-900 dark:text-white'
                  : 'border-transparent text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300',
              )}
            >
              {t === 'evidence' ? 'Evidence' : 'Stored record'}
            </button>
          ))}
        </div>

        <div className="flex-1 min-w-0 overflow-y-auto px-6 py-5">
          {tab === 'evidence' ? (
            // Reference sources read their record from the sidecar, so they
            // follow the raw fetch's loading/error state, not the registry's.
            isReference ? (
              rawLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                </div>
              ) : rawError ? (
                <p className="text-xs text-red-500 dark:text-red-400 text-center py-8">{rawError}</p>
              ) : reference ? (
                <ReferenceEvidencePanel reference={reference} />
              ) : (
                <p className="text-xs text-gray-400 dark:text-zinc-600 text-center py-8">
                  No stored record for this reference.
                </p>
              )
            ) : loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
              </div>
            ) : error ? (
              <p className="text-xs text-red-500 dark:text-red-400 text-center py-8">{error}</p>
            ) : trial ? (
              <TrialEvidencePanel trial={trial} />
            ) : article ? (
              <ArticleEvidencePanel article={article} />
            ) : null
          ) : rawLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
            </div>
          ) : rawError ? (
            <p className="text-xs text-red-500 dark:text-red-400 text-center py-8">{rawError}</p>
          ) : rawContent ? (
            <>
              <div className="flex items-start justify-between gap-3 mb-2">
                <p className="text-[11px] text-gray-400 dark:text-zinc-500">
                  {/* The JSON caption is a guarantee about bytes, so it stays exact.
                      The table is a rendering of those bytes — it promises the same
                      completeness, but says so in its own terms. */}
                  {parsedRaw === undefined || rawView === 'json' ? (
                    <>
                      Literal contents stored at this document&rsquo;s <code>s3_markdown_path</code> — the full
                      normalized record as JSON. This is what the extraction pipeline reads.
                    </>
                  ) : (
                    <>
                      Every field stored at this document&rsquo;s <code>s3_markdown_path</code>, rendered as a
                      table — nothing hidden. Switch to JSON for the literal file.
                    </>
                  )}
                </p>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {parsedRaw !== undefined && (
                    <div className="inline-flex rounded-lg border border-gray-200 dark:border-[#2a2a2a] p-0.5">
                      {(['table', 'json'] as const).map((v) => (
                        <button
                          key={v}
                          onClick={() => setRawView(v)}
                          className={cn(
                            'px-2 py-0.5 text-[11px] font-medium rounded-md transition-colors cursor-pointer border-none',
                            rawView === v
                              ? 'bg-gray-900 text-white dark:bg-white dark:text-black'
                              : 'bg-transparent text-gray-500 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-white',
                          )}
                        >
                          {v === 'table' ? 'Table' : 'JSON'}
                        </button>
                      ))}
                    </div>
                  )}
                  <CopyButton text={rawContent} label="Stored record" />
                </div>
              </div>
              {parsedRaw !== undefined ? (
                <div className="rounded-lg border border-gray-200 dark:border-[#2a2a2a] p-3 overflow-x-auto">
                  {rawView === 'table' ? (
                    <StoredRecordView value={parsedRaw} source={source} />
                  ) : (
                    <JsonView
                      value={parsedRaw}
                      style={resolvedTheme === 'dark' ? darkTheme : lightTheme}
                      collapsed={2}
                    />
                  )}
                </div>
              ) : (
                // Not valid JSON (legacy/corrupted document) — show raw text instead of crashing.
                <pre className="whitespace-pre-wrap break-words text-[11.5px] leading-relaxed font-mono text-gray-700 dark:text-zinc-300 bg-gray-50 dark:bg-[#161616] border border-gray-200 dark:border-[#2a2a2a] rounded-lg p-4">
                  {rawContent}
                </pre>
              )}
            </>
          ) : null}
        </div>
      </aside>
    </>
  );
}

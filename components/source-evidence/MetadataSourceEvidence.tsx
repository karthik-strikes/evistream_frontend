'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  Loader2,
  Sparkles,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { clinicalTrialsService, documentsService, pubmedService } from '@/services';
import type { NormalizedArticle, NormalizedTrial } from '@/types/api';
import { TrialEvidencePanel } from '@/components/clinical-trials/TrialEvidencePanel';
import { ArticleEvidencePanel } from '@/components/pubmed/ArticleEvidencePanel';
import { StoredRecordView } from '@/components/documents/StoredRecordView';

export interface MetadataSourceEvidenceProps {
  documentId: string | null;
  filename?: string;
  /** Verbatim quote the extractor emitted as source_text. */
  sourceText: string | null;
  /** The extracted/stored value shown in the "Value" line. */
  storedValue?: string | null;
  /** Column / field name shown in the header. */
  fieldLabel?: string | null;
  /** Which registry the value was grounded in. */
  source: 'ctgov' | 'pubmed';
  /** NCT ID (ctgov) or PMID (pubmed). */
  recordId: string | null;
  doi?: string | null;
  onClose?: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
}

// Same vocabulary as ImportedTrialDrawer — both panels show these same two
// things, and calling them different names in each was the confusion.
type Tab = 'evidence' | 'raw';

const PROVENANCE = {
  ctgov: { label: 'Clinical trial', idLabel: 'NCT' },
  pubmed: { label: 'PubMed', idLabel: 'PMID' },
} as const;

function externalUrl(
  source: 'ctgov' | 'pubmed',
  recordId: string | null,
  doi?: string | null,
): { href: string; label: string } | null {
  if (source === 'ctgov' && recordId) {
    return {
      href: `https://clinicaltrials.gov/study/${encodeURIComponent(recordId)}`,
      label: 'View on ClinicalTrials.gov',
    };
  }
  if (source === 'pubmed' && recordId) {
    return {
      href: `https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(recordId)}/`,
      label: 'View on PubMed',
    };
  }
  if (doi) {
    return { href: `https://doi.org/${doi}`, label: `doi:${doi}` };
  }
  return null;
}

/**
 * Metadata counterpart to PdfHighlightViewer, rendered by SourceEvidenceDrawer
 * when a value was extracted from a ClinicalTrials.gov / PubMed metadata import
 * that has no PDF (documents.s3_pdf_path is null). Instead of a PDF highlight it
 * shows the normalized registry/article record (reusing the Trial/Article
 * evidence panels) plus the stored record itself, with the fields the
 * source_text quote came from highlighted.
 *
 * That highlight used to assume source_text was a verbatim substring of the
 * stored JSON. It isn't reliably: sidecars are pretty-printed, so a quote
 * spanning two keys never matches as a character run, and those quotes showed
 * nothing highlighted at all. Matching runs against field values now — see
 * lib/quote-match — with the plain-text view kept only for sidecars that don't
 * parse as JSON.
 */
export function MetadataSourceEvidence({
  documentId,
  filename,
  sourceText,
  storedValue,
  fieldLabel,
  source,
  recordId,
  doi,
  onClose,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
}: MetadataSourceEvidenceProps) {
  // Opens on the stored record, not the curated panel: this component is the
  // stand-in for the PDF highlight viewer, reached by clicking a value's source
  // icon. The question being asked is "where did this come from?", and the
  // answer — the highlighted fields — lives on that tab. (The imported-document
  // drawer defaults the other way on purpose; there you're asking what was
  // imported.) It also starts the sidecar fetch immediately, since that fetch
  // is gated on this tab being active.
  const [tab, setTab] = useState<Tab>('raw');
  const [trial, setTrial] = useState<NormalizedTrial | null>(null);
  const [article, setArticle] = useState<NormalizedArticle | null>(null);
  const [recordLoading, setRecordLoading] = useState(false);
  const [recordError, setRecordError] = useState<string | null>(null);

  const [raw, setRaw] = useState<string | null>(null);
  const [rawLoading, setRawLoading] = useState(false);
  const [rawError, setRawError] = useState<string | null>(null);

  const prov = PROVENANCE[source];
  const link = externalUrl(source, recordId, doi);
  const hasQuote = !!sourceText && sourceText.trim() !== '' && sourceText.trim() !== 'NR';

  // Fetch the normalized record (same endpoints ImportedTrialDrawer uses).
  useEffect(() => {
    if (!recordId) return;
    let cancelled = false;
    setRecordLoading(true);
    setRecordError(null);
    setTrial(null);
    setArticle(null);
    const fetcher =
      source === 'ctgov' ? clinicalTrialsService.get(recordId) : pubmedService.get(recordId);
    fetcher
      .then((data: NormalizedTrial | NormalizedArticle) => {
        if (cancelled) return;
        if (source === 'ctgov') setTrial(data as NormalizedTrial);
        else setArticle(data as NormalizedArticle);
      })
      .catch(() => {
        if (!cancelled) {
          setRecordError(`Failed to load ${source === 'ctgov' ? 'trial' : 'article'} data`);
        }
      })
      .finally(() => {
        if (!cancelled) setRecordLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [source, recordId]);

  // Lazily fetch the raw stored JSON only when the reviewer opens that tab.
  useEffect(() => {
    if (tab !== 'raw' || !documentId || raw !== null) return;
    let cancelled = false;
    setRawLoading(true);
    setRawError(null);
    documentsService
      .downloadMarkdown(documentId)
      .then((txt) => {
        if (!cancelled) setRaw(txt);
      })
      .catch(() => {
        if (!cancelled) setRawError('Failed to load the stored file');
      })
      .finally(() => {
        if (!cancelled) setRawLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, documentId, raw]);

  // Reset the raw cache when a different document is opened.
  useEffect(() => {
    setRaw(null);
    setRawError(null);
  }, [documentId]);

  // The stored sidecar as data. Non-JSON (legacy or corrupted) falls back to
  // the plain-text view below rather than crashing the panel.
  const parsedRaw = useMemo(() => {
    if (!raw) return undefined;
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : undefined;
    } catch {
      return undefined;
    }
  }, [raw]);

  // Exact (case-insensitive fallback) location of the quote inside the raw JSON.
  // Only used for the non-JSON fallback now — see the note on rendering below.
  const rawHighlight = useMemo(() => {
    if (!raw || !hasQuote || !sourceText) return null;
    const q = sourceText.trim();
    if (q.length < 3) return null;
    let idx = raw.indexOf(q);
    if (idx < 0) {
      idx = raw.toLowerCase().indexOf(q.toLowerCase());
      if (idx < 0) return null;
    }
    return {
      before: raw.slice(0, idx),
      match: raw.slice(idx, idx + q.length),
      after: raw.slice(idx + q.length),
    };
  }, [raw, sourceText, hasQuote]);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-[#1f1f1f] dark:bg-[#111111]">
      {/* Header — mirrors PdfHighlightViewer's chrome */}
      <div className="flex items-center gap-2 border-b border-gray-200 bg-gray-50 px-3 py-2 dark:border-[#1f1f1f] dark:bg-[#0a0a0a]">
        <FileText className="h-3.5 w-3.5 flex-shrink-0 text-gray-400 dark:text-zinc-600" />
        <span className="flex-1 truncate text-xs font-medium text-gray-700 dark:text-zinc-300">
          {filename || `${prov.label} record`}
        </span>

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
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 transition-colors hover:bg-gray-200 dark:hover:bg-[#1f1f1f]"
          >
            <X className="h-3.5 w-3.5 text-gray-500 dark:text-zinc-500" />
          </button>
        )}
      </div>

      {/* Info card — provenance badge, value, highlighted quote */}
      <div className="border-b border-gray-200 bg-white px-4 py-3 dark:border-[#1f1f1f] dark:bg-[#111111]">
        <div className="mb-2 flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-teal-700 dark:bg-teal-900/30 dark:text-teal-300">
            <Sparkles className="h-2.5 w-2.5" />
            {prov.label}
          </span>
          {recordId && (
            <span className="font-mono text-[10.5px] text-gray-400 dark:text-zinc-500">
              {prov.idLabel} {recordId}
            </span>
          )}
          {fieldLabel && (
            <span className="ml-auto truncate text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-zinc-500">
              {fieldLabel}
            </span>
          )}
        </div>

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

        <div className="flex items-start gap-3">
          <span className="w-12 flex-shrink-0 pt-0.5 text-[9.5px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-600">
            Quote
          </span>
          <span className="min-w-0 flex-1 text-[12.5px] italic leading-snug text-gray-700 dark:text-zinc-300">
            {hasQuote ? (
              <mark className="rounded bg-teal-100/70 px-0.5 not-italic text-gray-900 dark:bg-teal-900/40 dark:text-zinc-100">
                &ldquo;{sourceText}&rdquo;
              </mark>
            ) : (
              <span className="text-gray-400 dark:text-zinc-600">Not reported</span>
            )}
          </span>
        </div>

        <div className="mt-2 flex items-center gap-2 border-t border-teal-100 pt-2 dark:border-teal-900/40">
          <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-teal-800 dark:text-teal-300">
            Grounded in {prov.label} metadata — no PDF for this document
          </span>
          {link && (
            <a
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex flex-shrink-0 items-center gap-1 text-[11px] font-medium text-gray-500 hover:text-gray-800 dark:text-zinc-400 dark:hover:text-white"
            >
              {link.label}
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-gray-100 px-3 pt-2 dark:border-[#1f1f1f]">
        {(['evidence', 'raw'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'cursor-pointer rounded-t-lg border-b-2 -mb-px bg-transparent px-3 py-1.5 text-xs font-medium transition-colors',
              tab === t
                ? 'border-gray-900 text-gray-900 dark:border-white dark:text-white'
                : 'border-transparent text-gray-400 hover:text-gray-600 dark:text-zinc-500 dark:hover:text-zinc-300',
            )}
          >
            {t === 'evidence' ? 'Evidence' : 'Stored record'}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto bg-gray-50/40 px-4 py-4 dark:bg-[#0a0a0a]">
        {tab === 'evidence' ? (
          recordLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
            </div>
          ) : recordError ? (
            <p className="py-8 text-center text-xs text-rose-500 dark:text-rose-400">{recordError}</p>
          ) : trial ? (
            <TrialEvidencePanel trial={trial} />
          ) : article ? (
            <ArticleEvidencePanel article={article} />
          ) : (
            <p className="py-8 text-center text-xs text-gray-400 dark:text-zinc-600">
              No record data.
            </p>
          )
        ) : rawLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
          </div>
        ) : rawError ? (
          <p className="py-8 text-center text-xs text-rose-500 dark:text-rose-400">{rawError}</p>
        ) : raw ? (
          <>
            <p className="mb-2 text-[11px] text-gray-400 dark:text-zinc-500">
              The normalized record as stored — what the extraction read.
              {hasQuote && ' Fields the source quote came from are highlighted.'}
            </p>
            {parsedRaw !== undefined ? (
              // Field-anchored highlighting. The previous version searched for
              // the quote as a literal character run in the pretty-printed JSON,
              // which failed whenever the quote spanned two keys (the model
              // emits one line; the file has newlines and indentation between
              // them) — so the reviewer got a quote with nothing marked.
              // Matching values instead is formatting-proof, and a quote that
              // swept up several fields now marks each one it came from.
              <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-[#2a2a2a] dark:bg-[#111111]">
                <StoredRecordView value={parsedRaw} source={source} highlight={sourceText} />
              </div>
            ) : (
              <pre className="whitespace-pre-wrap break-words rounded-lg border border-gray-200 bg-white p-4 font-mono text-[11.5px] leading-relaxed text-gray-700 dark:border-[#2a2a2a] dark:bg-[#111111] dark:text-zinc-300">
                {rawHighlight ? (
                  <>
                    {rawHighlight.before}
                    <mark className="rounded bg-teal-200/70 text-gray-900 dark:bg-teal-800/60 dark:text-zinc-100">
                      {rawHighlight.match}
                    </mark>
                    {rawHighlight.after}
                  </>
                ) : (
                  raw
                )}
              </pre>
            )}
          </>
        ) : (
          <p className="py-8 text-center text-xs text-gray-400 dark:text-zinc-600">
            No stored content.
          </p>
        )}
      </div>
    </div>
  );
}

'use client';

import { Badge } from '@/components/ui';
import { ExternalLink } from 'lucide-react';

/**
 * Shape of the JSON sidecar written for a metadata-only reference import —
 * see endnote_service.build_document_content / ris_service.build_document_content.
 * Every field is optional because a bibliographic record is only as complete as
 * whatever the exporting tool happened to fill in.
 */
export interface StoredReference {
  source?: string;
  title?: string | null;
  authors?: string[] | string | null;
  journal?: string | null;
  year?: string | number | null;
  volume?: string | null;
  issue?: string | null;
  pages?: string | null;
  doi?: string | null;
  pmid?: string | null;
  url?: string | null;
  abstract?: string | null;
  /** PMC structured sections, present only when the RIS importer found them. */
  fullText?: unknown;
}

/** authors is a list from EndNote but can be a raw string from some RIS exports. */
function formatAuthors(authors: StoredReference['authors']): string {
  if (!authors) return 'N/A';
  const list = Array.isArray(authors) ? authors : [authors];
  const clean = list.map((a) => String(a).trim()).filter(Boolean);
  if (clean.length === 0) return 'N/A';
  if (clean.length <= 3) return clean.join(', ');
  return `${clean.slice(0, 3).join(', ')} et al.`;
}

/**
 * Label the source link by its host rather than a generic "source link" — these
 * URLs come from whatever tool exported the library (Epistemonikos stamps its own
 * record page, for instance), so the destination is not guessable from context.
 * Shows the bare hostname: unambiguous, and no brand-name guessing.
 */
function sourceHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'source link';
  }
}

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'col-span-2' : undefined}>
      <div className="text-gray-400 dark:text-zinc-500">{label}</div>
      <div className="text-gray-700 dark:text-zinc-300 font-medium">{children}</div>
    </div>
  );
}

/**
 * Read-only display of an EndNote / RIS reference, built from the stored JSON
 * sidecar rather than a live API — unlike PubMed and ClinicalTrials.gov there is
 * no registry to re-fetch these from, so the sidecar IS the record. Deliberately
 * mirrors ArticleEvidencePanel's layout so the ImportedTrialDrawer looks the same
 * whichever source a document came from.
 */
export function ReferenceEvidencePanel({
  reference,
  className,
}: {
  reference: StoredReference;
  className?: string;
}) {
  const label = (reference.source || 'reference').toUpperCase();
  const citation = [reference.volume && `Vol ${reference.volume}`, reference.issue && `No ${reference.issue}`, reference.pages]
    .filter(Boolean)
    .join(' · ');
  const hasPmcText = Array.isArray(reference.fullText) && reference.fullText.length > 0;

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-1.5 mb-2">
        <Badge variant="default">{label}</Badge>
        {hasPmcText && <Badge variant="success">PMC FULL TEXT</Badge>}
      </div>

      <h3 className="text-[15px] font-semibold text-gray-900 dark:text-white leading-snug mb-3">
        {reference.title || 'Untitled reference'}
      </h3>

      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs mb-4">
        <Field label="Year">{reference.year || 'N/A'}</Field>
        {reference.pmid ? <Field label="PMID"><span className="font-mono">{reference.pmid}</span></Field> : <Field label="Source">{reference.source || 'N/A'}</Field>}
        <Field label="Journal" wide>{reference.journal || 'N/A'}</Field>
        <Field label="Authors" wide>{formatAuthors(reference.authors)}</Field>
        {citation && <Field label="Citation" wide>{citation}</Field>}
        {(reference.doi || reference.url) && (
          <div className="col-span-2">
            <div className="text-gray-400 dark:text-zinc-500">{reference.doi ? 'DOI' : 'Source'}</div>
            {/* DOI and the exporting tool's source link sit side by side — they're
                both "go read the paper" affordances, so separating them made you
                hunt for the second one. */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {reference.doi && (
                <a
                  href={`https://doi.org/${reference.doi}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 dark:text-blue-400 font-medium hover:underline break-all"
                >
                  {reference.doi}
                </a>
              )}
              {reference.url && (
                <a
                  href={reference.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-gray-500 dark:text-zinc-400 hover:text-gray-800 dark:hover:text-white transition-colors"
                >
                  {sourceHost(reference.url)}
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Abstract deliberately not rendered here — it dominated the panel and the
          citation block is what you need to identify the paper. The full abstract
          is still in the stored sidecar, viewable on the "Stored record" tab. */}
    </div>
  );
}

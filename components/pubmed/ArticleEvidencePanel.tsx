'use client';

import { Badge } from '@/components/ui';
import { ExternalLink } from 'lucide-react';
import type { NormalizedArticle } from '@/types/api';

interface ArticleEvidencePanelProps {
  article: NormalizedArticle;
  className?: string;
}

function formatAuthors(authors: string[]): string {
  if (authors.length === 0) return 'N/A';
  if (authors.length <= 3) return authors.join(', ');
  return `${authors.slice(0, 3).join(', ')} et al.`;
}

const AVAILABILITY: Record<'pdf' | 'pmc' | 'none' | 'unknown', { dot: string; text: string; label: string }> = {
  pdf: { dot: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-300', label: 'PDF available' },
  pmc: { dot: 'bg-sky-500', text: 'text-sky-700 dark:text-sky-300', label: 'Full text via PMC' },
  none: { dot: 'bg-zinc-400 dark:bg-zinc-600', text: 'text-zinc-500 dark:text-zinc-400', label: 'Link only' },
  // Distinct from `none`: we failed to find out, rather than found nothing.
  unknown: { dot: 'bg-amber-400 dark:bg-amber-500', text: 'text-amber-700 dark:text-amber-400', label: 'Availability unknown' },
};

/** Full-text availability signal — a live, pre-import read (see
 * NormalizedArticle.fullTextAvailability) on "should I bother importing
 * this?". A quiet status dot, not a badge — it's a hint, not an alert. */
function FullTextAvailabilityBadge({ availability }: { availability: NormalizedArticle['fullTextAvailability'] }) {
  if (availability === undefined) {
    return (
      <div className="inline-flex items-center gap-1.5 text-[11px] text-gray-400 dark:text-zinc-500">
        <span className="w-1.5 h-1.5 rounded-full bg-gray-300 dark:bg-zinc-700 animate-pulse" />
        Checking…
      </div>
    );
  }
  const { dot, text, label } = AVAILABILITY[availability];
  return (
    <div className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      {label}
    </div>
  );
}

/**
 * Read-only display of a normalized PubMed article — citation metadata,
 * authors, abstract. Mirrors TrialEvidencePanel's layout so the unified
 * LiteratureSearchDrawer's right pane looks consistent regardless of which
 * source is selected. `abstractText` is only present on the full detail
 * fetch (GET /pubmed/{pmid}) — search-result-list rows use esummary only
 * (no abstract), so this panel shows a loading hint until the full record
 * arrives.
 */
export function ArticleEvidencePanel({ article, className }: ArticleEvidencePanelProps) {
  const title = article.title || `PMID ${article.pmid}`;

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-1.5 mb-2">
        <Badge variant="success">PUBMED</Badge>
        {article.pubTypes.map((t) => (
          <Badge key={t} variant="default">{t}</Badge>
        ))}
      </div>

      <h3 className="text-[15px] font-semibold text-gray-900 dark:text-white leading-snug mb-2">
        {title}
      </h3>

      <div className="mb-3">
        <FullTextAvailabilityBadge availability={article.fullTextAvailability} />
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs mb-4">
        <div>
          <div className="text-gray-400 dark:text-zinc-500">PMID</div>
          <div className="text-gray-700 dark:text-zinc-300 font-medium font-mono">{article.pmid}</div>
        </div>
        <div>
          <div className="text-gray-400 dark:text-zinc-500">Year</div>
          <div className="text-gray-700 dark:text-zinc-300 font-medium">{article.year || 'N/A'}</div>
        </div>
        <div className="col-span-2">
          <div className="text-gray-400 dark:text-zinc-500">Journal</div>
          <div className="text-gray-700 dark:text-zinc-300 font-medium">{article.journal || 'N/A'}</div>
        </div>
        <div className="col-span-2">
          <div className="text-gray-400 dark:text-zinc-500">Authors</div>
          <div className="text-gray-700 dark:text-zinc-300 font-medium">{formatAuthors(article.authors)}</div>
        </div>
        {article.doi && (
          <div className="col-span-2">
            <div className="text-gray-400 dark:text-zinc-500">DOI</div>
            <a
              href={`https://doi.org/${article.doi}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 dark:text-blue-400 font-medium hover:underline"
            >
              {article.doi}
            </a>
          </div>
        )}
      </div>

      <div className="border-t border-gray-100 dark:border-[#1f1f1f] pt-3 mb-3">
        <div className="text-[11px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wider mb-1">
          Abstract
        </div>
        {article.abstractText === undefined ? (
          <div className="text-xs text-gray-400 dark:text-zinc-500 italic">Loading full record…</div>
        ) : article.abstractText ? (
          <div className="text-xs text-gray-600 dark:text-zinc-400 leading-relaxed whitespace-pre-wrap max-h-64 overflow-y-auto">
            {article.abstractText}
          </div>
        ) : (
          <div className="text-xs text-gray-400 dark:text-zinc-500 italic">No abstract available.</div>
        )}
      </div>

      {article.sourceUrl && (
        <a
          href={article.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-zinc-400 hover:text-gray-800 dark:hover:text-white transition-colors mt-1"
        >
          View on PubMed
          <ExternalLink className="w-3 h-3" />
        </a>
      )}
    </div>
  );
}

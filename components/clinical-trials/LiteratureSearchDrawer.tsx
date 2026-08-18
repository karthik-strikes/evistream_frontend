'use client';

import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Loader2, Search, X } from 'lucide-react';
import { cn, getErrorMessage } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { Badge, Button } from '@/components/ui';
import { clinicalTrialsService, literatureService, pubmedService } from '@/services';
import type { LiteratureResult } from '@/types/api';
import type { LiteratureScope } from '@/services/literature.service';
import { TrialEvidencePanel } from './TrialEvidencePanel';
import { ArticleEvidencePanel } from '../pubmed/ArticleEvidencePanel';

// NCT ID / PMID auto-detection lives server-side now (literature.py's
// _search_ctgov/_search_pubmed) so it applies consistently regardless of
// scope — this component just passes the raw query straight through.

// Real, upstream-supported filter dimensions only — ClinicalTrials.gov only,
// hidden when scope is narrowed to PubMed. Same caveat as before: "Has
// results"/"RCT only"/date-range are NOT real ClinicalTrials.gov API filter
// params, so they're deliberately not offered here.
const STATUS_OPTIONS: { label: string; value: string }[] = [
  { label: 'Completed', value: 'COMPLETED' },
  { label: 'Recruiting', value: 'RECRUITING' },
  { label: 'Active, not recruiting', value: 'ACTIVE_NOT_RECRUITING' },
  { label: 'Terminated', value: 'TERMINATED' },
];

const PHASE_OPTIONS: { label: string; value: string }[] = [
  { label: 'Phase 1', value: 'PHASE1' },
  { label: 'Phase 2', value: 'PHASE2' },
  { label: 'Phase 3', value: 'PHASE3' },
  { label: 'Phase 4', value: 'PHASE4' },
];

const SCOPE_TABS: { label: string; value: LiteratureScope }[] = [
  { label: 'All sources', value: 'all' },
  { label: 'ClinicalTrials.gov', value: 'ctgov' },
  { label: 'PubMed', value: 'pubmed' },
];

function toggleValue(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function resultKey(r: LiteratureResult): string {
  return r.source === 'ctgov' ? r.nctId : r.pmid;
}

function resultLabel(r: LiteratureResult): string {
  // An NCT ID is self-explanatory on its own ("NCT04812345"); a bare PMID
  // is just a number with no visual cue what it is — label it.
  return r.source === 'ctgov' ? r.nctId : `PMID ${r.pmid}`;
}

function resultTitle(r: LiteratureResult): string {
  if (r.source === 'ctgov') return r.title.brief || r.title.official || r.nctId;
  return r.title || `PMID ${r.pmid}`;
}

function resultMeta(r: LiteratureResult): string {
  if (r.source === 'ctgov') {
    return [r.nctId, r.status.overall, r.phase.join(', '), r.enrollment.count != null ? `n=${r.enrollment.count}` : null]
      .filter(Boolean)
      .join(' · ');
  }
  const authors = r.authors.length > 3 ? `${r.authors.slice(0, 3).join(', ')} et al.` : r.authors.join(', ');
  return [authors, r.journal, r.year, `PMID ${r.pmid}`].filter(Boolean).join(' · ');
}

export interface LiteratureSearchDrawerProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  /** The project's name — stands in for "project topic" (no dedicated topic
   *  field exists). Used to auto-seed and auto-run the search the moment
   *  the drawer opens, so it never opens blank. */
  projectName: string;
  /** Scope picked from the header dropdown before opening (defaults to
   *  'all' if not provided). Only read when the drawer opens — after that,
   *  the in-drawer scope tabs own it. */
  initialScope?: LiteratureScope;
  /** Text typed into the page's "Evidence search" hero card before opening —
   *  takes precedence over the projectName auto-seed when non-empty. Only
   *  read when the drawer opens, same as initialScope. */
  initialQuery?: string;
}

/**
 * Right-edge slide-over: unified search across ClinicalTrials.gov + PubMed
 * at once, merged/interleaved results on the left, evidence preview
 * (dispatched per source) on the right, import on confirm.
 *
 * Built from the shared design mockup "Documents Registry Search.dc.html"
 * (an executable prototype, not just visuals) — see the plan for the
 * deliberate departures: search is proxied server-side (not browser-direct
 * fetch() to the two upstream APIs), PubMed abstracts ARE fetched (lazily,
 * on selection — the mockup never fetches them), and status/phase filter
 * chips are kept (scoped to when ClinicalTrials.gov is in view) even though
 * this mockup doesn't show them.
 *
 * Search is explicit-submit (button/Enter), not live-per-keystroke, since
 * a search now fans out to two upstream APIs instead of one.
 */
export function LiteratureSearchDrawer({ open, onClose, projectId, projectName, initialScope, initialQuery }: LiteratureSearchDrawerProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<LiteratureScope>('all');
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [phaseFilter, setPhaseFilter] = useState<string[]>([]);

  const [results, setResults] = useState<LiteratureResult[]>([]);
  const [counts, setCounts] = useState<{ ctgov: number | null; pubmed: number | null }>({ ctgov: null, pubmed: null });
  const [message, setMessage] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  // "Load more" pagination — one call per source returns one page; these
  // carry forward what to ask for next (null once a source is exhausted).
  // See literature.service.ts / backend/app/api/v1/literature.py.
  const [nextCtgovPageToken, setNextCtgovPageToken] = useState<string | null>(null);
  const [nextPubmedOffset, setNextPubmedOffset] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const [selected, setSelected] = useState<LiteratureResult | null>(null);
  const [importing, setImporting] = useState(false);

  const handleClose = useCallback(() => {
    if (typeof document !== 'undefined') {
      const active = document.activeElement as HTMLElement | null;
      const drawer = document.querySelector('aside[data-literature-search-drawer]');
      if (active && drawer && drawer.contains(active) && typeof active.blur === 'function') {
        active.blur();
      }
    }
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, handleClose]);

  // Selecting a PubMed result whose abstract hasn't been fetched yet
  // (search-result rows only carry esummary data) lazily fetches the full
  // record. CT.gov results already carry the full normalize() shape from
  // search, so no extra fetch needed there.
  const selectResult = useCallback((result: LiteratureResult | null) => {
    setSelected(result);
    // Gated on fullTextAvailability, not abstractText: a failed fetch used to
    // set abstractText to null and thereby permanently disable its own retry,
    // leaving the availability dot stuck on "Checking…" for the rest of the
    // session (one backend blip during a deploy was enough to do it).
    if (result && result.source === 'pubmed' && result.fullTextAvailability === undefined) {
      const pmid = result.pmid;
      pubmedService
        .get(pmid)
        .then((full) => {
          setSelected((prev) => (prev && prev.source === 'pubmed' && prev.pmid === pmid ? { source: 'pubmed', ...full } : prev));
        })
        .catch(() => {
          // Land on a terminal state. "unknown" is honest and, unlike
          // undefined, stops the badge claiming a check is still running.
          setSelected((prev) =>
            prev && prev.source === 'pubmed' && prev.pmid === pmid
              ? { ...prev, abstractText: null, fullTextAvailability: 'unknown' }
              : prev,
          );
        });
    }
  }, []);

  const runSearch = useCallback(
    async (term: string, searchScope: LiteratureScope, status: string[], phase: string[]) => {
      const q = term.trim();
      setHasSearched(true);
      if (!q) {
        setResults([]);
        setCounts({ ctgov: null, pubmed: null });
        setMessage(null);
        setNextCtgovPageToken(null);
        setNextPubmedOffset(null);
        return;
      }
      setSearching(true);
      setSearchError(null);
      setMessage(null);
      try {
        // A fresh search (new term/scope/filter) always starts at page 1 —
        // no ctgovPageToken/pubmedOffset passed.
        const resp = await literatureService.search({
          term: q,
          scope: searchScope,
          status: status.length ? status.join(',') : undefined,
          phase: phase.length ? phase.join(',') : undefined,
          pageSize: 15,
        });
        setResults(resp.results);
        setCounts(resp.counts);
        setMessage(resp.message);
        setNextCtgovPageToken(resp.nextCtgovPageToken);
        setNextPubmedOffset(resp.nextPubmedOffset);
        selectResult(resp.results[0] ?? null);
      } catch (error: any) {
        setResults([]);
        setSearchError(getErrorMessage(error, 'Search failed'));
        setNextCtgovPageToken(null);
        setNextPubmedOffset(null);
      } finally {
        setSearching(false);
      }
    },
    [selectResult],
  );

  const loadMore = async () => {
    const q = query.trim();
    if (!q || loadingMore) return;
    setLoadingMore(true);
    try {
      const resp = await literatureService.search({
        term: q,
        scope,
        status: statusFilter.length ? statusFilter.join(',') : undefined,
        phase: phaseFilter.length ? phaseFilter.join(',') : undefined,
        pageSize: 15,
        ctgovPageToken: nextCtgovPageToken ?? undefined,
        pubmedOffset: nextPubmedOffset ?? undefined,
      });
      setResults((prev) => [...prev, ...resp.results]);
      setCounts(resp.counts);
      setNextCtgovPageToken(resp.nextCtgovPageToken);
      setNextPubmedOffset(resp.nextPubmedOffset);
    } catch (error: any) {
      toast({ title: 'Error', description: getErrorMessage(error, 'Failed to load more results'), variant: 'error' });
    } finally {
      setLoadingMore(false);
    }
  };

  // Reset + auto-seed + auto-run each time the drawer opens. A typed
  // initialQuery (from the page's "Evidence search" hero card) takes
  // precedence; otherwise seeding `query` from the project name and
  // immediately searching is what makes the panel never open blank.
  useEffect(() => {
    if (!open) return;
    const seeded = (initialQuery && initialQuery.trim()) || projectName || '';
    const seededScope = initialScope || 'all';
    setQuery(seeded);
    setScope(seededScope);
    setStatusFilter([]);
    setPhaseFilter([]);
    setSelected(null);
    setHasSearched(false);
    if (seeded.trim()) {
      runSearch(seeded, seededScope, [], []);
    } else {
      setResults([]);
      setCounts({ ctgov: null, pubmed: null });
      setMessage(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectName, initialScope, initialQuery]);

  const handleScopeTab = (newScope: LiteratureScope) => {
    setScope(newScope);
    runSearch(query, newScope, statusFilter, phaseFilter);
  };
  const handleStatusToggle = (value: string) => {
    const next = toggleValue(statusFilter, value);
    setStatusFilter(next);
    runSearch(query, scope, next, phaseFilter);
  };
  const handlePhaseToggle = (value: string) => {
    const next = toggleValue(phaseFilter, value);
    setPhaseFilter(next);
    runSearch(query, scope, statusFilter, next);
  };
  const handleSearchSubmit = () => runSearch(query, scope, statusFilter, phaseFilter);

  const handleImport = async () => {
    if (!selected) return;
    try {
      setImporting(true);
      const result =
        selected.source === 'ctgov'
          ? await clinicalTrialsService.importTrial(selected.nctId, projectId)
          : await pubmedService.importArticle(selected.pmid, projectId);
      const { duplicate, document } = result;
      const key = resultKey(selected);
      if (duplicate) {
        toast({ title: 'Already imported', description: `${key} is already in this project as "${document.filename}"` });
      } else {
        // full_text_source only exists on PubMed imports (see
        // pubmedService.importArticle) — a trial import always falls to the
        // generic message.
        const fullTextSource = (result as { full_text_source?: string }).full_text_source;
        const description =
          fullTextSource === 'unpaywall_pdf'
            ? `${key} added with full text (open-access PDF found)`
            : fullTextSource === 'pmc'
            ? `${key} added with full text (via PubMed Central)`
            : fullTextSource === 'abstract'
            ? `${key} added (abstract only — no free full text found; attach a PDF from the document's drawer if you have access)`
            : `${key} added to Documents`;
        toast({ title: 'Imported', description, variant: 'success' });
      }
      queryClient.invalidateQueries({ queryKey: ['documents', projectId] });
      handleClose();
    } catch (error: any) {
      toast({ title: 'Error', description: getErrorMessage(error, 'Failed to import'), variant: 'error' });
    } finally {
      setImporting(false);
    }
  };

  const importLabel = selected?.source === 'pubmed' ? 'Import publication' : 'Import trial record';
  const fmtCount = (n: number | null) => (n == null ? '' : n > 999 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n));

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
        data-literature-search-drawer="true"
        className={cn(
          'fixed right-0 top-0 z-[70] flex h-screen w-[960px] max-w-[96vw] flex-col',
          'border-l border-gray-200 bg-white shadow-2xl dark:border-[#1f1f1f] dark:bg-[#0f0f0f]',
          'transition-transform duration-300 ease-out',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-gray-100 dark:border-[#1f1f1f] flex-shrink-0">
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-white tracking-tight">
              Search trials &amp; literature
            </h2>
            <p className="text-xs text-gray-400 dark:text-zinc-500 mt-0.5">
              ClinicalTrials.gov + PubMed · keyword, NCT ID, or PMID
            </p>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-[#1a1a1a] dark:hover:text-zinc-300 transition-colors border-none bg-transparent cursor-pointer mt-0.5"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Two-column body */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Left — search + filters + results */}
          <div className="w-[460px] flex-shrink-0 flex flex-col min-h-0 overflow-hidden border-r border-gray-100 dark:border-[#1f1f1f]">
            <div className="px-5 pt-4 pb-3 flex-shrink-0 space-y-3">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="w-3.5 h-3.5 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                  <input
                    type="text"
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSearchSubmit();
                    }}
                    placeholder="antibiotic prophylaxis implant — or NCT04812345 / PMID"
                    className="w-full text-sm text-gray-900 dark:text-white bg-gray-50 dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a] rounded-full py-1.5 pl-9 pr-4 outline-none focus:border-gray-400 dark:focus:border-[#3f3f3f] placeholder:text-gray-400 dark:placeholder:text-zinc-600"
                  />
                </div>
                <Button onClick={handleSearchSubmit} size="sm">
                  Search
                </Button>
              </div>

              {/* Scope tabs — control both what's fetched AND what's shown */}
              <div className="flex gap-1 border-b border-gray-100 dark:border-[#1f1f1f]">
                {SCOPE_TABS.map((t) => {
                  const active = scope === t.value;
                  const count = t.value === 'all'
                    ? counts.ctgov != null && counts.pubmed != null ? fmtCount(counts.ctgov + counts.pubmed) : ''
                    : fmtCount(counts[t.value as 'ctgov' | 'pubmed']);
                  return (
                    <button
                      key={t.value}
                      onClick={() => handleScopeTab(t.value)}
                      className={cn(
                        'px-3 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors cursor-pointer bg-transparent',
                        active
                          ? 'text-blue-700 dark:text-blue-400 border-blue-600 dark:border-blue-400'
                          : 'text-gray-500 dark:text-zinc-400 border-transparent hover:text-gray-700 dark:hover:text-zinc-200',
                      )}
                    >
                      {t.label} {count && <span className="text-gray-400 dark:text-zinc-500">{count}</span>}
                    </button>
                  );
                })}
              </div>

              {/* CT.gov-only filters — hidden when scope is narrowed to PubMed */}
              {scope !== 'pubmed' && (
                <div className="space-y-1.5">
                  <div className="flex flex-wrap gap-1.5">
                    {STATUS_OPTIONS.map((opt) => {
                      const active = statusFilter.includes(opt.value);
                      return (
                        <button
                          key={opt.value}
                          onClick={() => handleStatusToggle(opt.value)}
                          className={cn(
                            'text-[11px] font-semibold rounded-full px-2.5 py-1 border transition-colors cursor-pointer',
                            active
                              ? 'text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800'
                              : 'text-gray-500 dark:text-zinc-400 bg-white dark:bg-transparent border-gray-200 dark:border-[#2a2a2a] hover:bg-gray-50 dark:hover:bg-[#1a1a1a]',
                          )}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {PHASE_OPTIONS.map((opt) => {
                      const active = phaseFilter.includes(opt.value);
                      return (
                        <button
                          key={opt.value}
                          onClick={() => handlePhaseToggle(opt.value)}
                          className={cn(
                            'text-[11px] font-semibold rounded-full px-2.5 py-1 border transition-colors cursor-pointer',
                            active
                              ? 'text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800'
                              : 'text-gray-500 dark:text-zinc-400 bg-white dark:bg-transparent border-gray-200 dark:border-[#2a2a2a] hover:bg-gray-50 dark:hover:bg-[#1a1a1a]',
                          )}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {message && (
                <div className="flex items-start gap-2 text-[11.5px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{message}</span>
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto px-5 pb-4 space-y-1.5">
              {searching ? (
                <div className="flex items-center justify-center gap-2 py-8 text-xs text-gray-400 dark:text-zinc-500">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Searching…
                </div>
              ) : searchError ? (
                <p className="text-xs text-red-500 dark:text-red-400 text-center py-4">{searchError}</p>
              ) : !hasSearched ? (
                <p className="text-xs text-gray-400 dark:text-zinc-500 text-center py-4">
                  Start typing to search ClinicalTrials.gov and PubMed
                </p>
              ) : results.length === 0 ? (
                <p className="text-xs text-gray-400 dark:text-zinc-500 text-center py-4">
                  No results — try broader terms.
                </p>
              ) : (
                <>
                  {results.map((r) => {
                    const key = resultKey(r);
                    const isSelected = selected != null && resultKey(selected) === key && selected.source === r.source;
                    return (
                      <button
                        key={`${r.source}:${key}`}
                        onClick={() => selectResult(r)}
                        className={cn(
                          'w-full text-left px-3.5 py-3 rounded-xl border transition-all duration-150 cursor-pointer',
                          isSelected
                            ? 'border-gray-300 dark:border-[#3a3a3a] bg-gray-50 dark:bg-[#1a1a1a]'
                            : 'border-gray-100 dark:border-[#1f1f1f] bg-white dark:bg-[#111111] hover:border-gray-300 dark:hover:border-[#2a2a2a] hover:bg-gray-50 dark:hover:bg-[#1a1a1a]',
                        )}
                      >
                        <div className="flex items-center gap-2 mb-0.5">
                          {/* Same label + color as the documents list badge (Badge
                              component, "secondary"/"success") — was "CT.GOV" in blue
                              here vs "CLINICAL TRIAL" in grey there; now identical. */}
                          <Badge variant={r.source === 'ctgov' ? 'blue' : 'success'} className="shrink-0">
                            {r.source === 'ctgov' ? 'CLINICAL TRIAL' : 'PUBMED'}
                          </Badge>
                        </div>
                        <p className="text-sm font-semibold truncate leading-snug text-gray-900 dark:text-white">
                          {resultTitle(r)}
                        </p>
                        <p className="text-xs mt-0.5 truncate leading-snug text-gray-400 dark:text-zinc-500">
                          {resultMeta(r)}
                        </p>
                      </button>
                    );
                  })}

                  {(nextCtgovPageToken || nextPubmedOffset) && (
                    <button
                      onClick={loadMore}
                      disabled={loadingMore}
                      className="w-full flex items-center justify-center gap-1.5 text-xs font-medium text-gray-500 dark:text-zinc-400 py-2.5 rounded-lg border border-gray-100 dark:border-[#1f1f1f] hover:bg-gray-50 dark:hover:bg-[#1a1a1a] hover:text-gray-700 dark:hover:text-zinc-200 cursor-pointer bg-transparent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {loadingMore ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          Loading…
                        </>
                      ) : (
                        'Load more results'
                      )}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Right — evidence preview, dispatched per source */}
          <div className="flex-1 min-w-0 overflow-y-auto px-6 py-5">
            {selected ? (
              selected.source === 'ctgov' ? (
                <TrialEvidencePanel trial={selected} />
              ) : (
                <ArticleEvidencePanel article={selected} />
              )
            ) : (
              <div className="h-full flex items-center justify-center">
                <p className="text-xs text-gray-400 dark:text-zinc-500">Select a record to preview its evidence</p>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-4 px-6 py-4 border-t border-gray-100 dark:border-[#1f1f1f] bg-gray-50/60 dark:bg-[#0a0a0a] flex-shrink-0">
          <span className="text-xs text-gray-400 dark:text-zinc-500">
            {selected ? resultLabel(selected) : 'No record selected'}
          </span>
          <div className="flex items-center gap-2.5">
            <button
              onClick={handleClose}
              className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-zinc-300 bg-transparent border border-gray-200 dark:border-[#2a2a2a] rounded-lg hover:bg-gray-100 dark:hover:bg-[#1a1a1a] dark:hover:border-[#3a3a3a] cursor-pointer transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleImport}
              disabled={!selected || importing}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white dark:text-gray-900 bg-gray-900 dark:bg-zinc-100 rounded-lg cursor-pointer border-none transition-all duration-150 hover:bg-gray-700 dark:hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {importing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Importing...
                </>
              ) : (
                importLabel
              )}
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

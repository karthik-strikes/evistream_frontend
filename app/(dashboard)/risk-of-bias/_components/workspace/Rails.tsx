'use client';

/**
 * The workspace's two sticky rails: the domain list on the left, and the
 * assessment target plus the paper's evidence on the right.
 *
 * The evidence panel searches the paper's own text (the parsed markdown) and
 * lets the reviewer link a passage to the question they are on. When AI
 * suggestions are on it also gets a PDF tab: the paper itself, with the AI's
 * quotes for the focused domain drawn as markers (the manual-extraction
 * mechanism) — clicking one, or selecting text, links it to the question.
 */

import { useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, ExternalLink, Search } from 'lucide-react';

import { cn } from '@/lib/utils';
import { documentsService } from '@/services';
import type { SelectedQuote, SourceMarker } from '@/components/PdfHighlightViewer';
import type { Judgement } from '../../_lib/robModel';
import { Light } from '../robUi';
import { AiRailMark } from './AiParts';
import type { RobAiDomainState } from '@/services/rob.service';

// react-pdf needs browser-only APIs; load it on the client only (as the evidence drawer does).
const PdfHighlightViewer = dynamic(
  () => import('@/components/PdfHighlightViewer').then(m => m.PdfHighlightViewer),
  {
    ssr: false,
    loading: () => <div className="flex h-full items-center justify-center text-[12px] italic text-gray-400 dark:text-zinc-600">Loading PDF viewer…</div>,
  },
);

// ── Left rail ────────────────────────────────────────────────────────────────

export interface RailItem {
  step: number;
  label: string;
  status: string;
  judgement?: Judgement | null;
  /** This domain's AI run, when AI suggestions are on and visible here. */
  ai?: RobAiDomainState | null;
}

export function DomainRail({ items, active, onPick, outcomeScope, onRetryAi, retryingAi }: {
  items: RailItem[]; active: number; onPick: (step: number) => void;
  /** Re-run one failed domain (consensus reviewer / managers only). */
  onRetryAi?: (domain: number) => void;
  retryingAi?: number | null;
  /** Outcome scope: D2–D5 are judged for the outcome as a whole. */
  outcomeScope?: boolean;
}) {
  return (
    <div className="sticky top-4 flex flex-col gap-3">
      <div className="px-3 text-[11px] font-semibold uppercase tracking-[.05em] text-gray-500 dark:text-zinc-500">Domains</div>
      <div className="flex flex-col gap-0.5">
        {items.map(item => (
          <div key={item.step} className="relative">
            <button type="button" onClick={() => onPick(item.step)}
              className={cn('flex w-full items-start gap-2.5 rounded-lg px-3 py-2 text-left transition-colors',
                item.ai && 'pr-9',
                active === item.step ? 'bg-gray-100 dark:bg-[#1a1a1a]' : 'hover:bg-gray-50 dark:hover:bg-[#141414]')}>
              <span className="mt-0.5">
                {item.judgement !== undefined
                  ? <Light j={item.judgement} size={18} active={active === item.step} />
                  : <Light j={null} size={18} neutral active={active === item.step} />}
              </span>
              <span className="min-w-0">
                <span className={cn('block text-[13px] leading-[17px] text-gray-900 dark:text-zinc-100', active === item.step && 'font-semibold')}>
                  {item.label}
                </span>
                <span className="mt-0.5 block text-[11px] leading-[14px] text-gray-500 dark:text-zinc-500">{item.status}</span>
              </span>
            </button>
            {item.ai && (
              <span className="absolute right-2 top-2">
                <AiRailMark state={item.ai}
                  retrying={retryingAi === item.ai.domain}
                  onRetry={onRetryAi && item.ai.status === 'failed' ? () => onRetryAi(item.ai!.domain) : undefined} />
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-[11px] leading-[16px] text-gray-500 dark:border-[#1f1f1f] dark:bg-[#0d0d0d] dark:text-zinc-500">
        {outcomeScope
          ? 'Scope: D1 applies to the whole trial; D2–D5 are judged for this outcome as a whole. Judge each assessment on its own.'
          : 'Scope: D1 applies to the whole trial, D2 mainly to the outcome, D4 to the measurement method, D5 to this specific result. Copy where the scope matches; judge each assessment on its own.'}
      </div>
    </div>
  );
}

// ── Target panel ─────────────────────────────────────────────────────────────

export function TargetPanel({ rows }: { rows: Array<[string, ReactNode]> }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-xl border border-gray-200 bg-white dark:border-[#1f1f1f] dark:bg-[#111111]">
      <button type="button" onClick={() => setOpen(o => !o)}
        className="flex w-full items-center justify-between px-4 py-3 text-[11px] font-semibold uppercase tracking-[.05em] text-gray-500 dark:text-zinc-500">
        Assessment target
        {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>
      {open && (
        <>
          <dl className="grid grid-cols-[88px_minmax(0,1fr)] gap-x-2 gap-y-2 px-4 pb-3 text-[12.5px]">
            {rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-gray-400 dark:text-zinc-500">{k}</dt>
                <dd className="min-w-0 break-words text-gray-900 dark:text-zinc-100">
                  {v || <span className="italic text-gray-400 dark:text-zinc-600">not recorded</span>}
                </dd>
              </div>
            ))}
          </dl>
          <div className="border-t border-[#f3f4f6] px-4 py-2 text-[11px] text-[#9ca3af] dark:border-[#1f1f1f] dark:text-zinc-600">
            Read-only · <Link href="/manual-extraction" className="text-[#4b5563] underline dark:text-zinc-400">Edit extracted result</Link>
          </div>
        </>
      )}
    </div>
  );
}

// ── Evidence panel ───────────────────────────────────────────────────────────

interface Passage { text: string; locator: string }

/** Paragraphs of the parsed paper, each tagged with the heading above it. */
function passagesOf(markdown: string): Passage[] {
  const out: Passage[] = [];
  let heading = '';
  for (const block of markdown.split(/\n\s*\n/)) {
    const raw = block.trim();
    if (!raw) continue;
    const headingMatch = raw.match(/^#{1,6}\s+(.+)$/m);
    if (headingMatch && raw.split('\n').length === 1) { heading = headingMatch[1].replace(/[*_`]/g, '').trim(); continue; }
    if (/^\|/.test(raw) || /^!\[/.test(raw)) continue;
    const text = raw
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/<[^>]+>/g, '')
      .replace(/[*_`]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (text.length < 40) continue;
    out.push({ text, locator: heading.slice(0, 60) });
  }
  return out;
}

/** A ~300-character window around the first hit, cut on word boundaries. */
function snippet(text: string, terms: string[]): string {
  if (text.length <= 320) return text;
  const lower = text.toLowerCase();
  const first = Math.min(...terms.map(t => lower.indexOf(t)).filter(i => i >= 0));
  const start = Math.max(0, first - 120);
  let s = text.slice(start, start + 320);
  if (start > 0) s = s.replace(/^\S*\s/, '');
  s = s.replace(/\s\S*$/, '');
  return s;
}

function Highlighted({ text, terms }: { text: string; terms: string[] }) {
  if (!terms.length) return <>{text}</>;
  const re = new RegExp(`(${terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return (
    <>
      {text.split(re).map((part, i) => (i % 2 === 1
        ? <mark key={i} className="rounded-sm bg-slate-100 px-0.5 text-inherit dark:bg-slate-500/25">{part}</mark>
        : <span key={i}>{part}</span>))}
    </>
  );
}

export interface EvidencePdfTab {
  /** AI quotes of the focused domain, keyed `<question>#<n>`. */
  markers: SourceMarker[];
  onMarkerClick: (keys: string[], quote: SelectedQuote) => void;
  /** Selecting text links it to the focused question; absent when read-only. */
  onSelectQuote?: (quote: SelectedQuote) => void;
  hint: string | null;
}

export function EvidencePanel({
  documentId, studyLabel, focusedQuestion, linkedCount, isLinked, onToggleLink, linked, readOnly, pdf,
}: {
  documentId: string;
  studyLabel: string;
  /** The question a passage would be linked to; null outside a domain. */
  focusedQuestion: string | null;
  linkedCount: number;
  isLinked: (text: string) => string | null;
  onToggleLink: (passage: Passage) => void;
  /** Quotes already linked, shown when nothing is searched. */
  linked: Array<{ id: string; quote: string; locator: string }>;
  readOnly: boolean;
  /** Present → a "PDF" tab beside the text search. */
  pdf?: EvidencePdfTab;
}) {
  const [tab, setTab] = useState<'search' | 'pdf'>('search');
  const [query, setQuery] = useState('');
  const [opening, setOpening] = useState(false);

  const markdownQ = useQuery({
    queryKey: ['rob-markdown', documentId],
    queryFn: () => documentsService.downloadMarkdown(documentId),
    enabled: !!documentId,
    staleTime: Infinity,
    retry: false,
  });
  const passages = useMemo(
    () => (typeof markdownQ.data === 'string' ? passagesOf(markdownQ.data) : []),
    [markdownQ.data]);

  const terms = useMemo(
    () => query.toLowerCase().split(/\s+/).map(t => t.trim()).filter(t => t.length >= 2),
    [query]);
  const hits = useMemo(() => {
    if (!terms.length) return [];
    return passages
      .filter(p => { const l = p.text.toLowerCase(); return terms.every(t => l.includes(t)); })
      .slice(0, 15)
      .map(p => ({ ...p, text: snippet(p.text, terms) }));
  }, [passages, terms]);

  const openPdf = async () => {
    // Opened synchronously, inside the click, so a popup blocker allows it;
    // the signed URL is filled in once it arrives.
    const tab = window.open('', '_blank');
    setOpening(true);
    try {
      const url = await documentsService.getDownloadUrl(documentId);
      if (tab) tab.location.href = url;
      else window.open(url, '_blank', 'noopener');
    } catch {
      tab?.close();
    } finally {
      setOpening(false);
    }
  };

  const linkLabel = (text: string) => {
    const at = isLinked(text);
    if (at) return `Linked · Q${at}`;
    return focusedQuestion ? `Link to Q${focusedQuestion}` : 'Link';
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white dark:border-[#1f1f1f] dark:bg-[#111111]">
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <span className="min-w-0 truncate text-[11px] font-semibold uppercase tracking-[.05em] text-gray-500 dark:text-zinc-500">
          Evidence · {studyLabel}
        </span>
        <span className="shrink-0 text-[11px] text-gray-400 dark:text-zinc-500">{linkedCount} linked</span>
      </div>
      {pdf && (
        <div className="mx-4 mb-2 flex overflow-hidden rounded-lg border border-gray-200 dark:border-[#2a2a2a]">
          {(['search', 'pdf'] as const).map(t => (
            <button key={t} type="button" onClick={() => setTab(t)}
              className={cn('flex-1 py-1.5 text-[12px] font-medium',
                tab === t ? 'bg-gray-900 text-white dark:bg-zinc-100 dark:text-gray-900' : 'bg-white text-gray-600 hover:bg-gray-50 dark:bg-[#111111] dark:text-zinc-400 dark:hover:bg-[#1a1a1a]')}>
              {t === 'search' ? 'Search text' : `PDF${pdf.markers.length ? ` · ${pdf.markers.length} AI` : ''}`}
            </button>
          ))}
        </div>
      )}
      {pdf && tab === 'pdf' ? (
        <div className="px-2 pb-2">
          <div className="h-[62vh] min-h-[420px] overflow-hidden rounded-lg border border-gray-200 dark:border-[#242424]">
            <PdfHighlightViewer
              documentId={documentId}
              filename={studyLabel}
              markers={pdf.markers}
              onMarkerClick={readOnly ? undefined : pdf.onMarkerClick}
              markerHint={pdf.hint}
              onSelectQuote={readOnly || !focusedQuestion ? undefined : pdf.onSelectQuote}
              selectionTargetLabel={focusedQuestion ? `Q${focusedQuestion}` : null}
            />
          </div>
        </div>
      ) : (
      <>
      <div className="px-4">
        <button type="button" onClick={openPdf} disabled={opening}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 py-2 text-[12px] font-medium text-gray-700 hover:bg-gray-100 dark:border-[#2a2a2a] dark:bg-[#161616] dark:text-zinc-300 dark:hover:bg-[#1c1c1c]">
          <ExternalLink className="h-3.5 w-3.5" />{opening ? 'Opening…' : 'Open PDF'}
        </button>
        <div className="relative mt-2">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search the paper…"
            className="h-8 w-full rounded-lg border border-gray-200 bg-white pl-8 pr-2 text-[12.5px] text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none dark:border-[#2a2a2a] dark:bg-[#0d0d0d] dark:text-zinc-100" />
        </div>
      </div>

      <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto px-4 py-3">
        {markdownQ.isError && (
          <p className="text-[12px] text-gray-500 dark:text-zinc-500">The paper’s text isn’t available for search. Use Open PDF.</p>
        )}
        {!terms.length && !markdownQ.isError && (
          linked.length === 0
            ? <p className="text-[12px] leading-[17px] text-gray-500 dark:text-zinc-500">
                Search the paper to find a passage, then link it to the question you are answering.
              </p>
            : linked.map(l => (
              <PassageCard key={l.id} text={l.quote} locator={l.locator} terms={[]}
                label={`Linked · Q${l.id}`} on disabled />
            ))
        )}
        {terms.length > 0 && markdownQ.isLoading && <p className="text-[12px] text-gray-500">Loading the paper…</p>}
        {terms.length > 0 && !markdownQ.isLoading && hits.length === 0 && !markdownQ.isError && (
          <p className="text-[12px] text-gray-500 dark:text-zinc-500">No passage contains every word searched.</p>
        )}
        {hits.map((h, i) => (
          <PassageCard key={i} text={h.text} locator={h.locator} terms={terms}
            label={linkLabel(h.text)} on={!!isLinked(h.text)}
            disabled={readOnly || (!focusedQuestion && !isLinked(h.text))}
            onClick={() => onToggleLink(h)} />
        ))}
      </div>
      </>
      )}
    </div>
  );
}

function PassageCard({ text, locator, terms, label, on, disabled, onClick }: {
  text: string; locator: string; terms: string[]; label: string; on: boolean;
  disabled?: boolean; onClick?: () => void;
}) {
  return (
    <div className="rounded-lg border border-gray-200 px-3 py-2.5 dark:border-[#242424]">
      <p className="text-[12.5px] leading-[18px] text-gray-800 dark:text-zinc-200">“<Highlighted text={text} terms={terms} />”</p>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[11px] text-gray-400 dark:text-zinc-500">{locator || 'Paper text'}</span>
        <button type="button" onClick={onClick} disabled={disabled}
          className={cn('shrink-0 rounded-[6px] border px-2 py-0.5 text-[11px] font-medium disabled:cursor-not-allowed',
            on ? 'border-[#bbf7d0] bg-[#f0fdf4] text-[#15803d] dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300'
              : 'border-gray-200 text-gray-700 hover:bg-gray-50 disabled:text-gray-300 dark:border-[#2a2a2a] dark:text-zinc-300 dark:disabled:text-zinc-600')}>
          {label}
        </button>
      </div>
    </div>
  );
}

export type { Passage };

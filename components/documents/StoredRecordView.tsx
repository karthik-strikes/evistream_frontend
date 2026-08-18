'use client';

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { buildQuoteMatcher, subtreeHasMatch, type QuoteMatcher } from '@/lib/quote-match';

/**
 * Structured, source-agnostic view of a document's stored JSON sidecar — the
 * "Table" half of the Stored record tab (see ImportedTrialDrawer).
 *
 * The contract that shapes every decision here: this tab promises to show what
 * is actually stored at the document's s3_markdown_path. So this renderer
 * NEVER drops a key, never sorts keys away from the backend's declaration
 * order, and never truncates without a control that reveals the rest. Empty
 * arrays, nulls and blank strings all still render — "the field exists and is
 * empty" and "the field isn't there" are different facts about an import, and
 * a reviewer deciding whether to accept thin evidence needs to tell them
 * apart. When a subtree is too deep to lay out (see MAX_DEPTH) it degrades to
 * raw JSON rather than being summarised away.
 *
 * Deliberately NOT built on components/DynamicDataRenderer.tsx (now deleted):
 * that renderer filtered out keys named `confidence`/`reasoning` and collapsed
 * `{value, source_text}` wrappers, both of which silently remove data — fine
 * for extraction results, disqualifying for a view whose whole promise is
 * literalness. It also stringified anything nested below the first level, so
 * no stored record ever reached its table code at all.
 *
 * Dispatch is purely shape-driven; `source` only reorders top-level keys.
 * Documents reach this drawer with source === null, so nothing may depend on
 * knowing which importer wrote the record.
 */

// A ClinicalTrials.gov `results` blob runs ~26 KB at depth 11 (participantFlow
// → periods → milestones → achievements, outcomeMeasures → classes →
// categories → measurements). Laying that out node-by-node would render
// thousands of elements on open, so past this depth the subtree is shown as
// raw JSON — still complete, just not decomposed.
const MAX_DEPTH = 6;
// Sections bigger than this start collapsed so the drawer opens instantly. In
// practice this is exactly the `results` blob.
const COLLAPSE_BYTES = 4096;
const CHIP_CAP = 30;
const CELL_CHIP_CAP = 6;
const ROW_CAP = 50;
/** A scalar longer than this gets the full row rather than a grid half. */
const WIDE_SCALAR_CHARS = 120;
/** Table cells clamp here — the only place text is hidden, always with a toggle. */
const CELL_CLAMP_CHARS = 80;
/** Above this (or on any newline) a string renders as a scrollable prose block. */
const PROSE_CHARS = 280;

/** Keys that read wrong under naive title-casing: nctId → "Nct Id". */
const ACRONYMS = new Set([
  'id', 'url', 'doi', 'pmid', 'pmc', 'nct', 'ncbi', 'fda', 'us', 'uk', 'eu',
  'ci', 'sd', 'se', 'ip', 'api', 'json', 'pdf', 'mesh',
]);

/**
 * Preferred top-level ordering per source — reorder ONLY. Any key not listed
 * still renders, in its original position after the listed ones, so adding a
 * field backend-side can never make it invisible here.
 */
const SOURCE_ORDER: Record<string, string[]> = {
  ctgov: [
    'nctId', 'title', 'status', 'phase', 'studyType', 'conditions', 'summary',
    'sponsor', 'design', 'enrollment', 'eligibility', 'arms', 'interventions',
    'outcomes', 'locations', 'oversight', 'references', 'documents',
    'orgStudyId', 'sourceUrl', 'keywords', 'meshTerms', 'results',
  ],
  pubmed: [
    'pmid', 'title', 'journal', 'year', 'pubDate', 'authors', 'doi',
    'pubTypes', 'sourceUrl', 'abstractText', 'fullText',
  ],
  endnote: ['title', 'authors', 'journal', 'year', 'volume', 'issue', 'pages', 'doi', 'pmid', 'url', 'abstract'],
  ris: ['title', 'authors', 'journal', 'year', 'volume', 'issue', 'pages', 'doi', 'pmid', 'url', 'abstract', 'fullText'],
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isPrimitive(v: unknown): boolean {
  return v === null || v === undefined || typeof v !== 'object';
}

/** Cheap size proxy for the collapse-by-default rule. */
function approxBytes(v: unknown): number {
  try {
    return JSON.stringify(v)?.length ?? 0;
  } catch {
    return 0;
  }
}

/** PMC full text arrives as [{section, text}] — prose, not tabular data. */
function isSectionArray(v: unknown): v is { section: string | null; text: string }[] {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    v.every((item) => {
      if (!isPlainObject(item)) return false;
      const keys = Object.keys(item).sort();
      return keys.length === 2 && keys[0] === 'section' && keys[1] === 'text' && typeof item.text === 'string';
    })
  );
}

function formatLabel(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2') // camelCase → camel Case
    .replace(/[_.]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((word) => (ACRONYMS.has(word.toLowerCase()) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(' ');
}

function isLinkish(v: string): boolean {
  return /^https?:\/\//i.test(v.trim());
}

/** Listed keys first in the given order, then everything else untouched. */
function orderKeys(keys: string[], source?: string | null): string[] {
  const preferred = source ? SOURCE_ORDER[source] : undefined;
  if (!preferred) return keys;
  const remaining = keys.filter((k) => !preferred.includes(k));
  return [...preferred.filter((k) => keys.includes(k)), ...remaining];
}

const MUTED = 'text-gray-400 dark:text-zinc-600';
/** Top-level key of the record — the loudest label in the view. */
const SECTION_LABEL = 'text-[11px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wider';
/** Nested key. Sentence case and lighter, so depth is legible at a glance
 *  rather than every level shouting at the same volume. */
const NESTED_LABEL = 'text-[11px] font-medium text-gray-500 dark:text-zinc-400';

/**
 * The active source_text matcher, or null when nothing is being highlighted.
 * Context rather than a prop because every leaf needs it and it would
 * otherwise thread through eight components that have no other use for it.
 */
const HighlightContext = createContext<QuoteMatcher | null>(null);

function useMatched(value: unknown): boolean {
  const matcher = useContext(HighlightContext);
  return matcher ? matcher(value) : false;
}

/** Marks a leaf the quote matched. `data-quote-hit` is what the scroll-into-view
 *  effect looks for; keep it on any future highlight surface too. */
function Mark({ on, children }: { on: boolean; children: React.ReactNode }) {
  if (!on) return <>{children}</>;
  return (
    <mark data-quote-hit className="rounded bg-teal-200/70 text-gray-900 dark:bg-teal-800/60 dark:text-zinc-100">
      {children}
    </mark>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <span className={cn('italic text-xs', MUTED)}>{children}</span>;
}

/** "+N more" / "Show less" — the only way anything hidden gets revealed. */
function MoreButton({ hidden, expanded, onClick }: { hidden: number; expanded: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="text-[11px] font-medium text-gray-500 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-white transition-colors bg-transparent border-none cursor-pointer p-0"
    >
      {expanded ? 'Show less' : `+${hidden} more`}
    </button>
  );
}

function RawJson({ value, note }: { value: unknown; note?: string }) {
  return (
    <div>
      {note && <div className={cn('text-[10px] mb-1', MUTED)}>{note}</div>}
      <pre className="whitespace-pre-wrap break-words text-[11px] leading-relaxed font-mono text-gray-700 dark:text-zinc-300 bg-gray-50 dark:bg-[#161616] border border-gray-200 dark:border-[#2a2a2a] rounded-lg p-3 max-h-72 overflow-auto">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function Chips({ items, cap }: { items: unknown[]; cap: number }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? items : items.slice(0, cap);
  const hidden = items.length - shown.length;

  return (
    <div className="flex flex-wrap items-center gap-1">
      {shown.map((item, i) => (
        <span
          key={i}
          className="inline-flex items-center rounded-full bg-gray-100 dark:bg-[#1a1a1a] text-gray-700 dark:text-[#e0e0e0] px-2 py-0.5 text-[11px]"
        >
          {item === null || item === undefined ? '—' : String(item)}
        </span>
      ))}
      {(hidden > 0 || expanded) && (
        <MoreButton hidden={hidden} expanded={expanded} onClick={() => setExpanded((v) => !v)} />
      )}
    </div>
  );
}

function PrimitiveValue({ value }: { value: unknown }) {
  // Hook first — the early returns below would otherwise make it conditional.
  const hit = useMatched(value);

  if (value === null || value === undefined) return <Empty>null</Empty>;
  if (typeof value === 'boolean') return <Mark on={hit}>{value ? 'Yes' : 'No'}</Mark>;

  const text = String(value);
  if (text === '') return <Empty>empty string</Empty>;

  if (typeof value === 'string' && isLinkish(text)) {
    return (
      <a
        href={text}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-start gap-1 text-blue-600 dark:text-blue-400 hover:underline break-all"
      >
        <Mark on={hit}>{text}</Mark>
        <ExternalLink className="w-3 h-3 mt-0.5 shrink-0" />
      </a>
    );
  }

  // Long or multi-line text scrolls in place rather than being cut — nothing is
  // hidden, so no expander is needed. Matches ArticleEvidencePanel's abstract.
  if (text.length > PROSE_CHARS || text.includes('\n')) {
    return (
      <div className="whitespace-pre-wrap text-xs text-gray-600 dark:text-zinc-400 leading-relaxed max-h-64 overflow-y-auto">
        <Mark on={hit}>{text}</Mark>
      </div>
    );
  }

  return (
    <span className="break-words">
      <Mark on={hit}>{text}</Mark>
    </span>
  );
}

/** A table cell — the one place text is genuinely clamped. */
function Cell({ value, depth }: { value: unknown; depth: number }) {
  const [open, setOpen] = useState(false);
  const hit = useMatched(value);

  if (value === null || value === undefined) return <Empty>—</Empty>;
  if (typeof value === 'boolean') return <Mark on={hit}>{value ? 'Yes' : 'No'}</Mark>;

  if (Array.isArray(value)) {
    if (value.length === 0) return <Empty>empty</Empty>;
    if (value.every(isPrimitive)) return <Chips items={value} cap={CELL_CHIP_CAP} />;
    return (
      <div>
        <button
          onClick={() => setOpen((v) => !v)}
          className="text-[11px] font-medium text-gray-500 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-white transition-colors bg-transparent border-none cursor-pointer p-0"
        >
          {open ? 'Hide' : `${value.length} ${value.length === 1 ? 'item' : 'items'}`}
        </button>
        {open && (
          <div className="mt-1.5">
            <ValueNode value={value} depth={depth + 1} />
          </div>
        )}
      </div>
    );
  }

  if (isPlainObject(value)) {
    const count = Object.keys(value).length;
    if (count === 0) return <Empty>empty</Empty>;
    return (
      <div>
        <button
          onClick={() => setOpen((v) => !v)}
          className="text-[11px] font-medium text-gray-500 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-white transition-colors bg-transparent border-none cursor-pointer p-0"
        >
          {open ? 'Hide' : `${count} ${count === 1 ? 'field' : 'fields'}`}
        </button>
        {open && (
          <div className="mt-1.5">
            <ValueNode value={value} depth={depth + 1} />
          </div>
        )}
      </div>
    );
  }

  const text = String(value);
  if (text === '') return <Empty>—</Empty>;
  if (text.length <= CELL_CLAMP_CHARS) {
    return (
      <span className="break-words">
        <Mark on={hit}>{text}</Mark>
      </span>
    );
  }

  return (
    <div className="min-w-[12rem]">
      <span className="break-words">
        <Mark on={hit}>{open ? text : `${text.slice(0, CELL_CLAMP_CHARS)}…`}</Mark>
      </span>{' '}
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-[11px] font-medium text-gray-500 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-white transition-colors bg-transparent border-none cursor-pointer p-0 whitespace-nowrap"
      >
        {open ? 'less' : 'more'}
      </button>
    </div>
  );
}

/** Array of objects → one table, columns = union of every row's keys. */
function RecordTable({ rows, depth }: { rows: Record<string, unknown>[]; depth: number }) {
  const [expanded, setExpanded] = useState(false);
  const columns = useMemo(
    () => Array.from(new Set(rows.flatMap((row) => Object.keys(row)))),
    [rows],
  );
  const shown = expanded ? rows : rows.slice(0, ROW_CAP);
  const hidden = rows.length - shown.length;

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-[#1f1f1f] border border-gray-200 dark:border-[#1f1f1f] rounded-lg text-xs">
          <thead className="bg-gray-50 dark:bg-[#0a0a0a]">
            <tr>
              {columns.map((col) => (
                <th
                  key={col}
                  className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider whitespace-nowrap"
                >
                  {formatLabel(col)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-[#111111] divide-y divide-gray-100 dark:divide-[#1f1f1f]">
            {shown.map((row, i) => (
              <tr key={i} className="hover:bg-gray-50 dark:hover:bg-[#1a1a1a] transition-colors align-top">
                {columns.map((col) => (
                  <td key={col} className="px-3 py-2 text-gray-900 dark:text-white">
                    {col in row ? <Cell value={row[col]} depth={depth} /> : <Empty>—</Empty>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* No bare row count here — the section header above already carries it,
          and printing "6 items" twice reads as two different facts. This line
          appears only when rows are actually being withheld, where "showing X
          of Y" is information the header doesn't have. */}
      {(hidden > 0 || expanded) && (
        <div className="flex items-center gap-2 mt-1.5">
          <span className={cn('text-[10px]', MUTED)}>
            Showing {shown.length} of {rows.length}
          </span>
          <MoreButton hidden={hidden} expanded={expanded} onClick={() => setExpanded((v) => !v)} />
        </div>
      )}
    </div>
  );
}

/** PMC full text: headed prose, because a 9k-character Discussion is not a cell. */
function ProseSections({ sections }: { sections: { section: string | null; text: string }[] }) {
  return (
    <div className="space-y-3">
      {sections.map((s, i) => (
        <div key={i}>
          <div className={cn(SECTION_LABEL, 'mb-1')}>{s.section || `Section ${i + 1}`}</div>
          <div className="whitespace-pre-wrap text-xs text-gray-600 dark:text-zinc-400 leading-relaxed max-h-64 overflow-y-auto">
            {s.text}
          </div>
        </div>
      ))}
    </div>
  );
}

function ArrayValue({ data, depth }: { data: unknown[]; depth: number }) {
  if (data.length === 0) return <Empty>Empty list</Empty>;
  if (isSectionArray(data)) return <ProseSections sections={data} />;
  if (data.every(isPrimitive)) return <Chips items={data} cap={CHIP_CAP} />;
  if (data.every(isPlainObject)) return <RecordTable rows={data as Record<string, unknown>[]} depth={depth} />;

  // Mixed shapes — no honest set of columns exists, so give each item its own block.
  return (
    <div className="space-y-2">
      {data.map((item, i) => (
        <div key={i} className="border-l-2 border-gray-100 dark:border-[#1f1f1f] pl-3">
          <div className={cn('text-[10px] mb-1', MUTED)}>#{i + 1}</div>
          <ValueNode value={item} depth={depth + 1} />
        </div>
      ))}
    </div>
  );
}

function Section({
  label,
  count,
  depth,
  defaultOpen,
  forceOpen = false,
  children,
}: {
  label: string;
  count?: string;
  depth: number;
  defaultOpen: boolean;
  /** The quote matched something inside — open regardless of size. */
  forceOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen || forceOpen);

  // Re-open when the quote changes to one that matches in here — the reviewer
  // can page between sources without the panel closing over the new hit.
  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);
  // A top-level key gets a full-width rule above it; anything deeper is
  // indented under a left rail instead, so a child never looks like a sibling
  // of its parent (outcomes → primary/secondary was the case that exposed it).
  const nested = depth > 0;

  return (
    <div
      className={cn(
        nested
          ? 'border-l border-gray-100 dark:border-[#1f1f1f] pl-3'
          : 'border-t border-gray-100 dark:border-[#1f1f1f] pt-3',
      )}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 mb-2 bg-transparent border-none cursor-pointer p-0 group"
      >
        <ChevronDown
          className={cn('w-3 h-3 text-gray-400 dark:text-zinc-600 transition-transform', !open && '-rotate-90')}
        />
        <span className={nested ? NESTED_LABEL : SECTION_LABEL}>{label}</span>
        {count && <span className={cn('text-[10px] normal-case tracking-normal', MUTED)}>{count}</span>}
      </button>
      {open && children}
    </div>
  );
}

function ObjectValue({ data, depth, source }: { data: Record<string, unknown>; depth: number; source?: string | null }) {
  const matcher = useContext(HighlightContext);
  const keys = orderKeys(Object.keys(data), depth === 0 ? source : undefined);
  if (keys.length === 0) return <Empty>No fields</Empty>;

  const scalars = keys.filter((k) => isPrimitive(data[k]));
  const complex = keys.filter((k) => !isPrimitive(data[k]));

  return (
    <div className="space-y-3">
      {scalars.length > 0 && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
          {scalars.map((key) => {
            const value = data[key];
            const wide = typeof value === 'string' && value.length > WIDE_SCALAR_CHARS;
            return (
              <div key={key} className={wide ? 'col-span-2' : undefined}>
                <div className="text-gray-400 dark:text-zinc-500">{formatLabel(key)}</div>
                <div className="text-gray-700 dark:text-zinc-300 font-medium">
                  <PrimitiveValue value={value} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {complex.map((key) => {
        const value = data[key];
        const count = Array.isArray(value)
          ? `${value.length} ${value.length === 1 ? 'item' : 'items'}`
          : isPlainObject(value)
            ? `${Object.keys(value).length} ${Object.keys(value).length === 1 ? 'field' : 'fields'}`
            : undefined;
        return (
          <Section
            key={key}
            label={formatLabel(key)}
            count={count}
            depth={depth}
            defaultOpen={approxBytes(value) <= COLLAPSE_BYTES}
            forceOpen={matcher ? subtreeHasMatch(value, matcher) : false}
          >
            <ValueNode value={value} depth={depth + 1} />
          </Section>
        );
      })}
    </div>
  );
}

function ValueNode({ value, depth, source }: { value: unknown; depth: number; source?: string | null }) {
  if (depth >= MAX_DEPTH && !isPrimitive(value)) {
    return <RawJson value={value} note="Nested beyond display depth — shown as raw JSON" />;
  }
  if (isPrimitive(value)) return <PrimitiveValue value={value} />;
  if (Array.isArray(value)) return <ArrayValue data={value} depth={depth} />;
  return <ObjectValue data={value as Record<string, unknown>} depth={depth} source={source} />;
}

export function StoredRecordView({
  value,
  source,
  highlight,
  className,
}: {
  value: unknown;
  /** Top-level key ordering only. Safe to omit — documents reach this drawer with no source. */
  source?: string | null;
  /**
   * A source_text quote to mark. Matched against field VALUES, not against the
   * stored file's characters — the old substring search failed whenever the
   * quote's whitespace differed from the pretty-printed JSON, which is exactly
   * what happens when a quote spans two keys. See lib/quote-match.
   */
  highlight?: string | null;
  className?: string;
}) {
  // Built against the whole record, not the quote alone: deciding whether a
  // field is a genuine hit needs to know whether some *other* field contains
  // the quote outright. See buildQuoteMatcher.
  const matcher = useMemo(() => buildQuoteMatcher(value, highlight), [value, highlight]);
  const containerRef = useRef<HTMLDivElement>(null);

  // Bring the first hit into view. Runs after the sections it lives in have
  // been forced open, so the target exists by the time we look for it.
  useEffect(() => {
    if (!matcher) return;
    const target = containerRef.current?.querySelector('[data-quote-hit]');
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [matcher]);

  return (
    <div ref={containerRef} className={className}>
      <HighlightContext.Provider value={matcher}>
        <ValueNode value={value} depth={0} source={source} />
      </HighlightContext.Provider>
    </div>
  );
}

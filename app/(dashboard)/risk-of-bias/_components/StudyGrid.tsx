'use client';

import { Tag } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip } from '@/components/ui/tooltip';
import { tagsAsText } from '@/lib/documentTags';
import {
  SEVERITY_COLOR, SEVERITY_LABEL, STATUS_COLOR, STATUS_LABEL,
  type AssessmentStatus, type Severity,
} from '../_lib/robForm';
import type { BoundDomain } from '../_lib/robAdapter';

export interface GridRow {
  documentId: string;
  label: string;
  /** Document tags (`documents.labels`). Optional: a caller that has not been
   *  taught to pass them gets a row with no tag marker, not a type error. */
  labels?: string[];
  /** One severity per bound domain, in the instrument's order. */
  severities: Severity[];
  overall: Severity;
  status: AssessmentStatus;
  /** True while the only judgments present are an unreviewed AI pass. */
  isDraft: boolean;
}

const OVERALL_CHIP: Record<Severity, string> = {
  low: 'bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-300',
  some: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300',
  high: 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300',
  none: 'bg-gray-100 text-gray-400 dark:bg-[#1a1a1a] dark:text-zinc-600',
};

/**
 * The traffic-light grid.
 *
 * Columns are the **instrument's** domains, always in its published order, so
 * two projects using RoB 2 produce the same grid whatever their forms look like.
 * A domain the underlying form omits gets a hollow cell rather than being
 * dropped from the header — a missing domain is a finding about the form.
 *
 * A dashed dot means the judgment is still an unreviewed AI draft. That
 * distinction carries weight: a solid green dot claims a person decided this
 * study was at low risk, and only a confirmed judgment has earned that claim.
 */
export function StudyGrid({
  domains,
  rows,
  selectedDocumentId,
  onSelect,
  progressText,
}: {
  domains: BoundDomain[];
  rows: GridRow[];
  selectedDocumentId: string | null;
  onSelect: (documentId: string) => void;
  progressText: string;
}) {
  const grid = {
    gridTemplateColumns: `minmax(140px,190px) repeat(${domains.length}, 30px) 130px 108px`,
  };

  return (
    <div className="border border-border rounded-lg bg-white dark:bg-[#111111] dark:border-[#1f1f1f] overflow-x-auto">
      <div className="min-w-[640px]">
        <div className="flex items-center px-4 py-3.5 border-b border-gray-100 dark:border-[#1f1f1f]">
          <div className="text-[15px] font-semibold dark:text-white">Studies</div>
          <span className="ml-auto text-xs text-gray-500 dark:text-zinc-500">{progressText}</span>
        </div>

        <div
          className="grid gap-x-2 items-center px-4 py-2 border-b border-gray-100 dark:border-[#1f1f1f]"
          style={grid}
        >
          <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-zinc-500">
            Study
          </span>
          {domains.map(d => (
            <span
              key={d.code + d.name}
              title={
                d.column
                  ? `${d.code} · ${d.name}${d.extra ? ' (not part of this tool)' : ''}`
                  : `${d.code} · ${d.name} — this form has no column for it`
              }
              className={cn(
                'text-[11px] font-semibold text-center cursor-default',
                d.column ? 'text-gray-500 dark:text-zinc-500' : 'text-gray-300 dark:text-zinc-700',
                d.extra && 'italic',
              )}
            >
              {d.code}
            </span>
          ))}
          <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-zinc-500">
            Overall
          </span>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-zinc-500">
            Status
          </span>
        </div>

        {rows.map(r => (
          <button
            key={r.documentId}
            type="button"
            onClick={() => onSelect(r.documentId)}
            className={cn(
              'grid gap-x-2 items-center w-full text-left px-4 py-1.5 border-l-2 transition-colors',
              r.documentId === selectedDocumentId
                ? 'bg-gray-50 border-l-[#0a0a0a] dark:bg-[#1a1a1a] dark:border-l-white'
                : 'border-l-transparent hover:bg-gray-50 dark:hover:bg-[#161616]',
            )}
            style={grid}
          >
            {/* Tags live behind a marker, not inline: this column is capped at
                190px and the study label has first claim on it. */}
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="text-[13px] text-zinc-900 dark:text-zinc-100 truncate" title={r.label}>
                {r.label}
              </span>
              {!!r.labels?.length && (
                <Tooltip content={tagsAsText(r.labels)} className="max-w-xs whitespace-normal">
                  <Tag className="h-2.5 w-2.5 shrink-0 text-gray-400 dark:text-zinc-500" />
                </Tooltip>
              )}
            </span>
            {domains.map((d, i) => {
              const severity = r.severities[i] ?? 'none';
              const drafted = r.isDraft && severity !== 'none';
              // A domain the form cannot store at all reads as an outline, so it
              // is visibly different from one that simply has not been judged.
              const missing = !d.column;
              return (
                <span
                  key={d.code + d.name}
                  title={
                    missing
                      ? `${d.name} — not in this form`
                      : `${d.name}: ${SEVERITY_LABEL[severity]}${drafted ? ' (AI draft)' : ''}`
                  }
                  className="w-3 h-3 rounded-full justify-self-center"
                  style={{
                    background: missing || drafted ? 'transparent' : SEVERITY_COLOR[severity],
                    border: missing
                      ? '1px solid #d4d4d8'
                      : drafted
                        ? `1.5px dashed ${SEVERITY_COLOR[severity]}`
                        : 'none',
                  }}
                />
              );
            })}
            <span
              className={cn(
                'text-[10.5px] font-semibold rounded-full px-2 py-0.5 justify-self-start whitespace-nowrap',
                OVERALL_CHIP[r.overall],
              )}
            >
              {r.overall === 'none' ? '—' : SEVERITY_LABEL[r.overall]}
            </span>
            <span className={cn('text-[11px] font-medium whitespace-nowrap', STATUS_COLOR[r.status])}>
              {STATUS_LABEL[r.status]}
            </span>
          </button>
        ))}

        <div className="flex gap-4 px-4 py-3 border-t border-gray-100 dark:border-[#1f1f1f] flex-wrap">
          {(['low', 'some', 'high', 'none'] as Severity[]).map(s => (
            <span key={s} className="flex items-center gap-1.5 text-[11.5px] text-gray-500 dark:text-zinc-500">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: SEVERITY_COLOR[s] }} />
              {SEVERITY_LABEL[s]}
            </span>
          ))}
          <span className="ml-auto flex items-center gap-1.5 text-[11.5px] text-gray-500 dark:text-zinc-500">
            <span className="w-2.5 h-2.5 rounded-full border-[1.5px] border-dashed border-amber-500" />
            AI draft awaiting review
          </span>
        </div>
      </div>
    </div>
  );
}

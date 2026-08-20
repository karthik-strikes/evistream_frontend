'use client';

import Link from 'next/link';
import { X } from 'lucide-react';
import { isBinaryArm, studyDataCells, type StudyEffect } from '@/lib/metaAnalysis';

/**
 * One side of the two-panel header. A study that arrived as an effect estimate
 * has no arms behind it, so both panels fall back to the plot's own reading of
 * what the source reported rather than inventing arm numbers.
 */
function armText(study: StudyEffect, which: 'treatment' | 'comparator'): string {
  const arm = study[which];
  if (!arm) return which === 'treatment' ? studyDataCells(study).left : studyDataCells(study).right;
  if (isBinaryArm(arm)) return `${arm.events} / ${arm.total}`;
  return `${arm.mean} ± ${Number(arm.sd.toFixed(3))} (n = ${arm.n})`;
}

/**
 * Source evidence for one plotted study.
 *
 * The numbers on the plot are two steps removed from the paper — extracted, then
 * mapped — so this shows the quoted sentence they came from. Where the quote is
 * missing, it says so rather than showing a blank panel, because a silent gap
 * reads as "no evidence needed".
 */
export function EvidenceDrawer({
  study,
  formId,
  treatmentLabel,
  comparatorLabel,
  onClose,
}: {
  study: StudyEffect | null;
  formId: string;
  treatmentLabel: string;
  comparatorLabel: string;
  onClose: () => void;
}) {
  if (!study) return null;

  const evidence = (study.evidence ?? {}) as Record<string, any>;
  const cells: Record<string, any> = evidence.treatmentCells ?? {};
  const quotes = Object.entries(cells)
    .map(([col, cell]) => ({ col, text: cell?.source_text as string | undefined, status: cell?.status }))
    .filter(q => typeof q.text === 'string' && q.text.trim() !== '' && q.text !== 'NR');

  return (
    <div className="fixed inset-0 z-40">
      <div onClick={onClose} className="absolute inset-0 bg-black/20" />
      <div className="absolute top-0 right-0 bottom-0 w-full max-w-[440px] bg-white dark:bg-[#111111] shadow-2xl flex flex-col border-l border-transparent dark:border-[#1f1f1f]">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100 dark:border-[#1f1f1f]">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-zinc-500">
              Source evidence
            </div>
            <div className="text-base font-semibold mt-0.5 truncate dark:text-white">{study.label}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto cursor-pointer p-1.5 text-gray-500 hover:text-gray-900 dark:text-zinc-500 dark:hover:text-white"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <div className="grid grid-cols-2 gap-2.5">
            <div className="border border-gray-200 dark:border-[#2a2a2a] rounded-lg px-3 py-2.5">
              <div className="text-[11px] text-gray-500 dark:text-zinc-500 truncate" title={treatmentLabel}>
                {treatmentLabel}
              </div>
              <div className="text-lg font-bold tabular-nums mt-0.5 dark:text-white">
                {armText(study, 'treatment')}
              </div>
            </div>
            <div className="border border-gray-200 dark:border-[#2a2a2a] rounded-lg px-3 py-2.5">
              <div className="text-[11px] text-gray-500 dark:text-zinc-500 truncate" title={comparatorLabel}>
                {comparatorLabel}
              </div>
              <div className="text-lg font-bold tabular-nums mt-0.5 dark:text-white">
                {armText(study, 'comparator')}
              </div>
            </div>
          </div>

          {(evidence.outcome || evidence.timepoint) && (
            <div className="text-xs text-gray-500 dark:text-zinc-500 mt-3">
              {[evidence.outcome, evidence.timepoint].filter(Boolean).join(' · ')}
              {evidence.sharedComparator && ' · comparator arm shared with another comparison'}
            </div>
          )}

          <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-zinc-500 mt-5 mb-2">
            Extracted from
          </div>

          {quotes.length > 0 ? (
            <div className="flex flex-col gap-2">
              {quotes.slice(0, 4).map(q => (
                <div key={q.col}>
                  <div className="font-mono text-[10.5px] text-gray-400 dark:text-zinc-600 mb-1">
                    {q.col}
                  </div>
                  <div className="border border-gray-200 dark:border-[#2a2a2a] border-l-[3px] border-l-green-600 rounded-lg px-3.5 py-3 text-[13px] leading-relaxed text-gray-700 dark:text-zinc-300">
                    &ldquo;{q.text}&rdquo;
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="border border-dashed border-gray-300 dark:border-[#2a2a2a] rounded-lg px-3.5 py-4 text-[13px] text-gray-500 dark:text-zinc-500 leading-relaxed">
              No quoted source text was stored for these values. The numbers are still the extracted
              ones — but there is nothing here to check them against without opening the document.
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-gray-100 dark:border-[#1f1f1f]">
          <Link
            href={`/consensus?form=${encodeURIComponent(formId)}&doc=${encodeURIComponent(study.documentId)}`}
            className="block w-full text-center cursor-pointer text-[13px] font-semibold bg-[#0a0a0a] text-white rounded-md px-4 py-2.5 hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-100"
          >
            Open this document&rsquo;s review
          </Link>
        </div>
      </div>
    </div>
  );
}

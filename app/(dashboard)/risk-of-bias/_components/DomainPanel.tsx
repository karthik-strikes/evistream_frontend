'use client';

import Link from 'next/link';
import { Check, ExternalLink, Lock } from 'lucide-react';
import { Spinner } from '@/components/ui';
import { cn } from '@/lib/utils';
import { overallSeverity, SEVERITY_COLOR, SEVERITY_LABEL, type Severity } from '../_lib/robForm';
import { severityOfCanonical, type BoundDomain, type DomainWrite } from '../_lib/robAdapter';
import type { RobTool } from '../_lib/robTools';

const CHIP: Record<Severity, string> = {
  low: 'bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-300',
  some: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300',
  high: 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300',
  none: 'bg-gray-100 text-gray-400 dark:bg-[#1a1a1a] dark:text-zinc-600',
};

/**
 * The assessment panel for one study.
 *
 * The buttons are the **instrument's** judgments — always the same three for
 * RoB 2 — not whatever the underlying form happens to declare. Where the form
 * cannot store one of them unambiguously, that button is disabled with the
 * reason shown rather than silently mapped onto a neighbouring option; picking
 * one would record a judgment the reviewer never made.
 */
export function DomainPanel({
  studyLabel,
  statusNote,
  outcome,
  tool,
  domains,
  writes,
  rawValues,
  confirmed,
  onJudgment,
  onRationale,
  onConfirm,
  onSave,
  saving,
  dirty,
  canEdit,
  documentId,
  formId,
}: {
  studyLabel: string;
  statusNote: string;
  outcome: string;
  tool: RobTool;
  domains: BoundDomain[];
  writes: Record<string, DomainWrite>;
  /** Exactly what is stored, so a translation is always inspectable. */
  rawValues: Record<string, string>;
  confirmed: Record<string, boolean>;
  onJudgment: (column: string, canonical: string) => void;
  onRationale: (column: string, text: string) => void;
  onConfirm: (column: string) => void;
  onSave: () => void;
  saving: boolean;
  dirty: boolean;
  canEdit: boolean;
  documentId: string;
  formId: string;
}) {
  const severities = domains
    .filter(d => !d.extra)
    .map(d => severityOfCanonical(d.column ? writes[d.column]?.canonical ?? null : null, tool));
  const overall = overallSeverity(severities);
  const unconfirmed = domains.filter(
    d => d.column && writes[d.column]?.canonical && !confirmed[d.column],
  ).length;

  return (
    <div className="border border-border rounded-lg bg-white dark:bg-[#111111] dark:border-[#1f1f1f] lg:sticky lg:top-0">
      <div className="px-4 py-3.5 border-b border-gray-100 dark:border-[#1f1f1f]">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-zinc-500">
          Assessing
        </div>
        <div className="text-base font-semibold mt-0.5 truncate dark:text-white" title={studyLabel}>
          {studyLabel}
        </div>
        <div className="text-xs text-gray-400 dark:text-zinc-600 mt-0.5">{statusNote}</div>
        {outcome && (
          <div className="text-xs text-gray-500 dark:text-zinc-500 mt-1.5">
            for <span className="font-medium text-gray-700 dark:text-zinc-300">{outcome}</span>
          </div>
        )}
      </div>

      <div className="px-4 py-3.5 flex flex-col gap-3">
        {domains.map(domain => {
          const key = domain.column ?? `${domain.code}-${domain.name}`;
          const current = domain.column ? writes[domain.column]?.canonical ?? '' : '';
          const raw = domain.column ? rawValues[domain.column] ?? '' : '';
          const isConfirmed = !!domain.column && !!confirmed[domain.column];
          const suggested = !!current && !isConfirmed;
          const missing = !domain.column;

          return (
            <div
              key={key}
              className={cn(
                'rounded-lg px-3 py-2.5 border',
                missing
                  ? 'border-dashed border-gray-300 bg-gray-50 dark:border-[#2a2a2a] dark:bg-[#0d0d0d]'
                  : suggested
                    ? 'border-[1.5px] border-dashed border-amber-500 bg-amber-50/60 dark:bg-amber-500/5'
                    : 'border-gray-200 bg-white dark:border-[#2a2a2a] dark:bg-[#111111]',
              )}
            >
              <div className="flex items-center gap-2">
                <span className="text-[12.5px] font-semibold text-gray-900 dark:text-white flex-1 min-w-0">
                  <span className={cn('mr-1.5', domain.extra
                    ? 'text-amber-600 dark:text-amber-500'
                    : 'text-gray-400 dark:text-zinc-600')}>
                    {domain.code}
                  </span>
                  {domain.name}
                </span>
                {suggested && (
                  <>
                    <span
                      title="An AI draft — confirm or change it"
                      className="text-[10px] font-semibold rounded-full px-2 py-0.5 bg-amber-100 text-amber-800 whitespace-nowrap dark:bg-amber-500/15 dark:text-amber-300 cursor-help"
                    >
                      Suggested
                    </span>
                    <button
                      type="button"
                      onClick={() => domain.column && onConfirm(domain.column)}
                      disabled={!canEdit}
                      title="Confirm this judgment"
                      className="cursor-pointer border border-gray-200 bg-white rounded-md px-2 py-0.5 text-[11px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:border-[#2a2a2a] dark:bg-[#1a1a1a] dark:text-zinc-300"
                    >
                      <Check className="h-3 w-3" />
                    </button>
                  </>
                )}
                {isConfirmed && (
                  <span className="flex items-center gap-1 text-[10px] font-semibold text-green-700 dark:text-green-400 whitespace-nowrap">
                    <Check className="h-2.5 w-2.5" />
                    Confirmed
                  </span>
                )}
              </div>

              {missing ? (
                <div className="text-[11.5px] text-gray-500 dark:text-zinc-500 mt-2 leading-relaxed">
                  This form has no column for {domain.code}. {tool.name.split('—')[0].trim()} defines
                  it, so the assessment is incomplete until the form carries it.
                </div>
              ) : (
                <>
                  <div className="flex gap-1.5 mt-2 flex-wrap">
                    {tool.judgments.map(judgment => {
                      const active = current === judgment;
                      const blocked = domain.unwritable.includes(judgment);
                      const rank = severityOfCanonical(judgment, tool);
                      return (
                        <button
                          key={judgment}
                          type="button"
                          onClick={() => domain.column && onJudgment(domain.column, judgment)}
                          disabled={!canEdit || blocked}
                          title={blocked
                            ? `This form can't store "${judgment}" unambiguously — more than one of its options means the same thing. Migrate it to the standard preset to use this.`
                            : undefined}
                          className={cn(
                            'flex items-center gap-1 cursor-pointer text-[11.5px] font-semibold rounded-md px-2.5 py-1 border transition-colors',
                            'disabled:cursor-not-allowed',
                            blocked && 'opacity-40 line-through',
                            !active && 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50 dark:border-[#2a2a2a] dark:bg-[#1a1a1a] dark:text-zinc-400',
                            !canEdit && !blocked && 'opacity-50',
                          )}
                          style={active ? {
                            borderColor: SEVERITY_COLOR[rank],
                            color: SEVERITY_COLOR[rank],
                            background: `${SEVERITY_COLOR[rank]}14`,
                          } : undefined}
                        >
                          {blocked && <Lock className="h-2.5 w-2.5" />}
                          {judgment}
                        </button>
                      );
                    })}
                  </div>

                  {domain.rationaleColumn ? (
                    <textarea
                      value={domain.column ? writes[domain.column]?.rationale ?? '' : ''}
                      onChange={e => domain.column && onRationale(domain.column, e.target.value)}
                      disabled={!canEdit}
                      rows={2}
                      placeholder="Why? Quote or paraphrase what the paper says."
                      className="w-full mt-2 text-[11.5px] leading-relaxed text-gray-700 dark:text-zinc-300 bg-transparent border-l-2 border-gray-200 dark:border-[#2a2a2a] pl-2 py-0.5 resize-y focus:outline-none focus:border-gray-400 disabled:opacity-60"
                    />
                  ) : (
                    <div className="text-[11px] text-gray-400 dark:text-zinc-600 mt-2">
                      This form has no free-text column for {domain.code}, so a reason can&rsquo;t be
                      recorded.
                    </div>
                  )}

                  {/* A translation must always be inspectable. */}
                  {raw && raw.toLowerCase() !== current.toLowerCase() && (
                    <div className="text-[10.5px] text-gray-400 dark:text-zinc-600 mt-1.5">
                      stored in this form as &ldquo;{raw}&rdquo;
                    </div>
                  )}
                  {domain.extra && (
                    <div className="text-[10.5px] text-amber-700 dark:text-amber-500 mt-1.5">
                      This domain isn&rsquo;t part of {tool.name.split('—')[0].trim()} — the form adds
                      it. Kept so nothing is lost, but it won&rsquo;t appear in a standard export.
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}

        <div className="flex items-center gap-2.5 border-t border-gray-100 dark:border-[#1f1f1f] pt-3 flex-wrap">
          <span className="text-[12.5px] font-semibold dark:text-white">Overall</span>
          <span className={cn('text-[10.5px] font-semibold rounded-full px-2.5 py-1', CHIP[overall])}>
            {SEVERITY_LABEL[overall]}
          </span>
          <span className="text-[11px] text-gray-400 dark:text-zinc-600">
            derived — worst domain wins
          </span>
        </div>

        <Link
          href={`/consensus?form=${encodeURIComponent(formId)}&doc=${encodeURIComponent(documentId)}`}
          className="inline-flex items-center gap-1 text-[11px] text-gray-600 dark:text-zinc-400 hover:underline"
        >
          View supporting text in the document
          <ExternalLink className="h-2.5 w-2.5" />
        </Link>

        {canEdit ? (
          <>
            <button
              type="button"
              onClick={onSave}
              disabled={saving || !dirty}
              className="flex items-center justify-center gap-2 w-full cursor-pointer text-[13px] font-semibold bg-[#0a0a0a] text-white rounded-md px-4 py-2.5 hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed dark:bg-white dark:text-black dark:hover:bg-zinc-100"
            >
              {saving && <Spinner className="h-3.5 w-3.5" />}
              {saving ? 'Saving…' : dirty ? 'Save assessment' : 'Saved'}
            </button>
            <div className="text-[11.5px] text-gray-400 dark:text-zinc-600 leading-relaxed">
              {unconfirmed > 0
                ? `${unconfirmed} ${unconfirmed === 1 ? 'domain is' : 'domains are'} still an unconfirmed AI draft. Saving records them as your judgment, so confirm or change them first.`
                : 'Saving records these as your judgment. The other reviewer assesses independently; disagreements go to Consensus.'}
            </div>
          </>
        ) : (
          <div className="text-[11.5px] text-gray-500 dark:text-zinc-500 leading-relaxed border border-dashed border-gray-300 dark:border-[#2a2a2a] rounded-lg px-3 py-2.5">
            You don&rsquo;t have a reviewer assignment for this document, so these judgments are
            read-only. Assignments are managed on the project page.
          </div>
        )}
      </div>
    </div>
  );
}

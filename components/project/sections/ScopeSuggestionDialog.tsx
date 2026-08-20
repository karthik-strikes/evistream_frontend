'use client';

import { useMemo, useRef, useState } from 'react';
import { AlertCircle, FileUp, Loader2, X } from 'lucide-react';
import { reviewScopeService, type ScopeSuggestionResult } from '@/services';
import { Button } from '@/components/ui';
import { cn } from '@/lib/utils';
import {
  FAMILIES,
  FAMILY_KEY,
  type ReviewScopeDraft,
  type ScopeFamilyName,
  type SuggestedScopeChip,
} from '@/lib/reviewScope';

const ML = 'text-[10px] font-semibold tracking-widest text-gray-400 dark:text-zinc-500 uppercase';

const ACCEPT = '.pdf,.docx,.md,.markdown,.txt';
const MAX_FILES = 3;
const MAX_BYTES = 20 * 1024 * 1024;

// Family order and colour come from the builder, so the dialog and the chips it
// fills read as one surface.
const ORDER: ScopeFamilyName[] = ['population', 'intervention', 'comparator', 'outcome', 'timepoint'];
const FAMILY_META = Object.fromEntries(
  ORDER.map((f) => [f, FAMILIES.find((x) => x.key === FAMILY_KEY[f])!]),
) as Record<ScopeFamilyName, (typeof FAMILIES)[number]>;

type Phase = 'idle' | 'reading' | 'review' | 'error';

/** A suggestion plus the reviewer's edits to it. */
interface Row extends SuggestedScopeChip {
  id: number;
  keep: boolean;
}

interface ScopeSuggestionDialogProps {
  open: boolean;
  projectId: string;
  /** Current builder contents — decides whether Merge/Replace is even offered. */
  draft: ReviewScopeDraft;
  onClose: () => void;
  onAccept: (chips: SuggestedScopeChip[], mode: 'merge' | 'replace') => void;
}

export function ScopeSuggestionDialog({
  open,
  projectId,
  draft,
  onClose,
  onAccept,
}: ScopeSuggestionDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<ScopeSuggestionResult | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [dragging, setDragging] = useState(false);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [error, setError] = useState<string | null>(null);

  const hasExisting = useMemo(
    () =>
      draft.populations.length +
        draft.interventions.length +
        draft.comparators.length +
        draft.outcomes.length +
        draft.timepoints.length >
      0,
    [draft],
  );

  const kept = rows.filter((r) => r.keep && r.value.trim());
  const truncated = (result?.files || []).filter((f) => f.truncated);
  const emptyFiles = (result?.files || []).filter((f) => f.empty);

  const reset = () => {
    setPhase('idle');
    setResult(null);
    setRows([]);
    setError(null);
  };

  const handleFiles = async (files: File[]) => {
    const picked = files.slice(0, MAX_FILES);
    const oversized = picked.find((f) => f.size > MAX_BYTES);
    if (oversized) {
      setError(`${oversized.name} is larger than 20 MB.`);
      setPhase('error');
      return;
    }
    setPhase('reading');
    setError(null);
    try {
      const res = await reviewScopeService.suggestFromDocuments(projectId, picked);
      setResult(res);
      setRows(
        res.chips.map((c, i) => ({
          ...c,
          id: i,
          // An unverified chip starts unticked: the server could not find its
          // quote, so it is the reviewer's call rather than the default.
          keep: !c.unverified,
        })),
      );
      setMode(hasExisting ? 'merge' : 'replace');
      setPhase('review');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read these documents.');
      setPhase('error');
    }
  };

  if (!open) return null;
  const busy = phase === 'reading';

  return (
    <div
      className="fixed inset-0 bg-black/60 dark:bg-black/70 backdrop-blur-md flex items-center justify-center z-50 p-4"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div
        className="bg-white dark:bg-[#111111] rounded-2xl border border-gray-200 dark:border-[#1f1f1f] w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 pt-5 pb-3 flex-shrink-0 border-b border-gray-100 dark:border-[#1a1a1a]">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white tracking-tight">
                Read the scope from a document
              </h2>
              <p className="text-sm text-gray-400 dark:text-zinc-500 mt-1">
                Upload your protocol or eligibility criteria — nothing is saved until you do.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                if (!busy) onClose();
              }}
              disabled={busy}
              className="text-gray-300 dark:text-zinc-600 hover:text-gray-500 dark:hover:text-zinc-300 transition-colors p-1 shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {phase === 'review' && result && (
            <div className="grid grid-cols-5 mt-3 rounded-xl border border-gray-100 dark:border-[#1f1f1f] divide-x divide-gray-100 dark:divide-[#1f1f1f] overflow-hidden">
              {ORDER.map((f) => (
                <div key={f} className="px-3 py-2">
                  <p className={ML}>{FAMILY_META[f].label}</p>
                  <p className="text-lg font-semibold tabular-nums mt-0.5 text-gray-700 dark:text-zinc-200">
                    {kept.filter((r) => r.family === f).length}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Body */}
        <div className="px-6 py-5 flex-1 overflow-y-auto min-h-0">
          {phase === 'idle' && (
            <div className="space-y-4">
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  setDragging(false);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  const f = Array.from(e.dataTransfer.files);
                  if (f.length) handleFiles(f);
                }}
                onClick={() => inputRef.current?.click()}
                className={cn(
                  'relative rounded-2xl border border-dashed px-6 py-10 text-center cursor-pointer transition-colors',
                  dragging
                    ? 'border-sky-400 bg-sky-50/60 dark:bg-sky-500/[0.06]'
                    : 'border-gray-200 dark:border-[#2a2a2a] hover:border-gray-300 dark:hover:border-[#333]',
                )}
              >
                <input
                  ref={inputRef}
                  type="file"
                  multiple
                  accept={ACCEPT}
                  className="hidden"
                  onChange={(e) => {
                    const f = Array.from(e.target.files || []);
                    e.target.value = '';
                    if (f.length) handleFiles(f);
                  }}
                />
                <div className="flex flex-col items-center gap-2.5">
                  <div className="rounded-full bg-gray-50 dark:bg-[#1a1a1a] p-3">
                    <FileUp
                      className={cn(
                        'w-5 h-5',
                        dragging ? 'text-sky-500 dark:text-sky-400' : 'text-gray-400 dark:text-zinc-500',
                      )}
                    />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-700 dark:text-zinc-200">
                      Drop your protocol here
                    </p>
                    <p className="text-xs text-gray-400 dark:text-zinc-500 mt-0.5">
                      or click to browse · PDF, .docx, .md, .txt · up to {MAX_FILES} files, 20 MB each
                    </p>
                  </div>
                </div>
              </div>
              <p className="text-xs text-gray-400 dark:text-zinc-500 leading-relaxed">
                A protocol, PROSPERO record, or the inclusion-criteria table works best. Exclusion
                criteria are read but never added — they belong to screening, not extraction. A
                scanned PDF with no text layer cannot be read; paste it into Free text instead.
              </p>
            </div>
          )}

          {phase === 'reading' && (
            <div className="py-12 flex items-center justify-center gap-2.5 text-sm text-gray-400 dark:text-zinc-500">
              <Loader2 className="w-4 h-4 animate-spin text-sky-500" />
              Reading the document…
            </div>
          )}

          {phase === 'review' && result && (
            <div className="space-y-5">
              {rows.length === 0 && (
                <div className="rounded-xl border border-amber-100 dark:border-amber-900/40 bg-amber-50/50 dark:bg-amber-950/10 px-4 py-3">
                  <p className="text-[13px] text-amber-700 dark:text-amber-300">
                    No scope entries found in this document.
                  </p>
                  {result.notes && (
                    <p className="text-xs text-gray-500 dark:text-zinc-400 mt-1">{result.notes}</p>
                  )}
                </div>
              )}

              {result.needs_review.length > 0 && (
                <div className="rounded-xl border border-amber-100 dark:border-amber-900/40 bg-amber-50/50 dark:bg-amber-950/10 px-4 py-3">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-[12px] font-semibold text-amber-700 dark:text-amber-300">
                      Needs your judgment
                    </span>
                    <span className="text-[11px] text-gray-500 dark:text-zinc-400">
                      {result.needs_review.length === 1
                        ? 'one call the model would not make for you'
                        : `${result.needs_review.length} calls the model would not make for you`}
                    </span>
                  </div>
                  <ul className="mt-2 divide-y divide-amber-100/70 dark:divide-amber-900/30">
                    {result.needs_review.map((t, i) => (
                      <li key={i} className="flex gap-2.5 py-1.5 first:pt-0 last:pb-0">
                        <span className="mt-[7px] w-1 h-1 rounded-full bg-amber-500/70 dark:bg-amber-400/60 shrink-0" />
                        <span className="text-[12px] text-gray-700 dark:text-zinc-300 leading-relaxed">
                          {t}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="text-[11px] text-gray-500 dark:text-zinc-400 mt-2.5 leading-relaxed">
                    Nothing here was decided for you. Where an entry sits under the wrong heading,
                    untick it and type it into the right field in the builder.
                  </p>
                </div>
              )}

              {ORDER.map((family) => {
                const group = rows.filter((r) => r.family === family);
                if (!group.length) return null;
                const meta = FAMILY_META[family];
                return (
                  <div key={family}>
                    <div className="flex items-baseline gap-2 mb-1.5">
                      <p className={ML}>{meta.label}</p>
                      <span className="text-[11px] text-gray-400 dark:text-zinc-500">{meta.hint}</span>
                    </div>
                    <div className="rounded-xl border border-gray-100 dark:border-[#1f1f1f] divide-y divide-gray-50 dark:divide-[#161616]">
                      {group.map((row) => (
                        <div key={row.id} className="px-3 py-2.5 flex items-start gap-2.5">
                          <button
                            type="button"
                            onClick={() =>
                              setRows((rs) =>
                                rs.map((r) => (r.id === row.id ? { ...r, keep: !r.keep } : r)),
                              )
                            }
                            className={cn(
                              'mt-1 w-3.5 h-3.5 rounded-[4px] border flex items-center justify-center text-[9px] font-bold shrink-0 transition-colors',
                              row.keep
                                ? 'bg-blue-500 border-blue-500 text-white'
                                : 'bg-transparent border-gray-300 dark:border-[#3a3a3a]',
                            )}
                            aria-label={row.keep ? 'Drop this entry' : 'Keep this entry'}
                          >
                            {row.keep ? '✓' : ''}
                          </button>

                          <div className="min-w-0 flex-1">
                            <input
                              value={row.value}
                              onChange={(e) =>
                                setRows((rs) =>
                                  rs.map((r) =>
                                    r.id === row.id ? { ...r, value: e.target.value } : r,
                                  ),
                                )
                              }
                              className={cn(
                                'w-full bg-transparent border-none outline-none p-0 text-[13px]',
                                row.keep
                                  ? 'text-gray-800 dark:text-zinc-100'
                                  : 'text-gray-400 dark:text-zinc-500 line-through',
                              )}
                            />
                            {row.evidence && (
                              <p
                                className="text-[11px] text-gray-400 dark:text-zinc-500 mt-0.5 truncate font-mono"
                                title={row.evidence}
                              >
                                “{row.evidence}”
                              </p>
                            )}
                          </div>

                          <span
                            className={cn(
                              'mt-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0',
                              row.unverified
                                ? 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300'
                                : row.confidence === 'high'
                                  ? 'bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-300'
                                  : 'bg-gray-100 text-gray-500 dark:bg-[#1a1a1a] dark:text-zinc-400',
                            )}
                            title={
                              row.unverified
                                ? 'This quote was not found in the document — check it against the source before keeping it.'
                                : `Confidence: ${row.confidence}`
                            }
                          >
                            {row.unverified ? 'unquoted' : row.confidence}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}

              {(result.not_used.length > 0 ||
                result.dropped.length > 0 ||
                truncated.length > 0 ||
                emptyFiles.length > 0 ||
                !!result.notes) && (
                <div className="rounded-xl border border-gray-100 dark:border-[#1f1f1f] bg-gray-50 dark:bg-[#141414] divide-y divide-gray-100 dark:divide-[#1f1f1f] overflow-hidden">
                  {(truncated.length > 0 || emptyFiles.length > 0) && (
                    <Aside
                      label="What was read"
                      hint="the model never saw the rest"
                      tone="amber"
                      items={[
                        ...truncated.map(
                          (f) =>
                            `${f.filename} — first ${f.chars_read.toLocaleString()} of ${f.chars_total.toLocaleString()} characters only.`,
                        ),
                        ...emptyFiles.map(
                          (f) => `${f.filename} — no text found; scanned, or no text layer.`,
                        ),
                      ]}
                    />
                  )}
                  {result.not_used.length > 0 && (
                    <Aside
                      label="Read but not used"
                      hint="exclusion criteria and design limits never become entries"
                      items={result.not_used}
                    />
                  )}
                  {result.dropped.length > 0 && (
                    <Aside
                      label="Rejected before you saw it"
                      hint="malformed, or past a per-family limit"
                      items={result.dropped}
                    />
                  )}
                  {result.notes && (
                    <div className="px-4 py-3">
                      <p className={ML}>Where this came from</p>
                      <p className="text-[11px] text-gray-500 dark:text-zinc-400 leading-relaxed mt-1">
                        {result.notes}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {phase === 'error' && (
            <div className="py-8 flex items-start gap-2.5 text-sm text-rose-600 dark:text-rose-400">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error || 'Something went wrong.'}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 dark:border-[#1a1a1a] flex items-center justify-between gap-3 flex-wrap flex-shrink-0">
          <div className="text-xs text-gray-400 dark:text-zinc-500">
            {phase === 'review' && hasExisting && (
              <div className="inline-flex rounded-lg border border-gray-200 dark:border-[#2a2a2a] overflow-hidden">
                {(['merge', 'replace'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={cn(
                      'px-2.5 py-1 text-[11px] font-semibold transition-colors',
                      mode === m
                        ? 'bg-gray-900 text-white dark:bg-white dark:text-black'
                        : 'text-gray-500 dark:text-zinc-400 hover:bg-black/[0.025] dark:hover:bg-white/[0.03]',
                    )}
                  >
                    {m === 'merge' ? 'Add to my entries' : 'Replace them'}
                  </button>
                ))}
              </div>
            )}
            {phase === 'review' && !hasExisting && result?.cached && 'Served from an earlier read.'}
          </div>
          <div className="flex gap-2">
            {phase === 'error' && (
              <Button variant="secondary" size="sm" onClick={reset}>
                Try again
              </Button>
            )}
            {phase === 'review' && (
              <Button
                variant="default"
                size="sm"
                disabled={kept.length === 0}
                onClick={() =>
                  onAccept(
                    kept.map(({ id, keep, ...chip }) => ({ ...chip, value: chip.value.trim() })),
                    mode,
                  )
                }
              >
                Add {kept.length} {kept.length === 1 ? 'entry' : 'entries'}
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>
              {phase === 'review' ? 'Cancel' : 'Close'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** One quiet, labelled group inside the summary block. */
function Aside({
  label,
  hint,
  items,
  tone = 'muted',
}: {
  label: string;
  hint?: string;
  items: string[];
  tone?: 'amber' | 'muted';
}) {
  return (
    <div className="px-4 py-3">
      <div className="flex items-baseline gap-2 flex-wrap">
        <p className={cn(ML, tone === 'amber' && 'text-amber-600 dark:text-amber-400')}>{label}</p>
        {hint && (
          <span className="text-[11px] text-gray-400 dark:text-zinc-500">{hint}</span>
        )}
      </div>
      <ul className="mt-1.5 divide-y divide-gray-100/80 dark:divide-[#1a1a1a]">
        {items.map((t, i) => (
          <li
            key={i}
            className={cn(
              'text-[11px] leading-relaxed py-1 first:pt-0 last:pb-0',
              tone === 'amber'
                ? 'text-amber-700 dark:text-amber-300'
                : 'text-gray-500 dark:text-zinc-400',
            )}
          >
            {t}
          </li>
        ))}
      </ul>
    </div>
  );
}

'use client';

/**
 * Which estimate this assessment is about — all eight slots, always visible.
 *
 * Not behind an expander. A reviewer who cannot see which result they are
 * judging can answer 5.2 — "were the reported results selected from multiple
 * analyses?" — about the wrong one, and nothing downstream would ever catch it.
 * The page this replaces showed a single composite string built by joining an
 * outcome name, a timepoint and a comparison with a separator, under which an
 * intention-to-treat estimate and a per-protocol estimate of the same outcome
 * were the same target.
 *
 * What stays on screen is what tells two results of one trial apart: the study,
 * the outcome, the timepoint, the comparison and the measurement. The remaining
 * slots expand on demand — a reviewer scrolling through twelve questions needs
 * the first five at all times and the rest when they are checking.
 *
 * Slots that hold a written default rather than something the trial reported are
 * marked, because "Overall population" is what we filled in when no source form
 * had a population column — not a finding. An ordinary difference between two
 * results gets no warning colour: most of them are the point, not a problem.
 */

import { useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';

import { identitySlots, type ResultIdentity } from '../_lib/robIdentity';

interface Props {
  result: ResultIdentity;
  studyLabel: string;
  /** Design line — "Parallel-group RCT", NCT number, and so on, when known. */
  studyMeta?: string;
  measurementInferred?: boolean;
  position: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  seatText: string;
  progressText: string;
  /** Rendered above the slots — the comparison and how it was measured. */
  contrastText: string;
  onBack?: () => void;
  /** The short handle a reviewer can say out loud — K1, Z3. */
  /** Which extraction row this result came from. */
  sourceRef?: string;
  /** True when the identity has changed since this assessment was made. */
  stale?: boolean;
  /** Correct the identity. Absent or false-gated means the slots are read-only. */
  canCorrect?: boolean;
  correcting?: boolean;
  onCorrect?: (patch: Record<string, string>) => void;
}

/**
 * Which displayed slot maps to which column, and what correcting it costs.
 *
 * The first six are the text half of `rob_results_unique_identity`; changing
 * any of them bumps the row's `version`, which marks every assessment already
 * made against it stale rather than silently re-pointing it at a different
 * estimate. `estimate` is editable and deliberately NOT part of the identity —
 * two results differing only by it are the same result — so it changes nothing
 * about what has been assessed.
 *
 * Contrast, source reference and instrument are absent on purpose: which arms
 * were compared is a fact about the STUDY, edited from its comparisons, and
 * the other two are not editable at all.
 */
const SLOT_FIELD: Record<string, string> = {
  Population: 'population',
  'Outcome domain': 'outcome_domain',
  Measurement: 'measurement',
  Timepoint: 'timepoint',
  'Analysis population': 'analysis_population',
  Analysis: 'analysis',
  'Effect estimate': 'estimate',
};

/** The six whose change bumps `version` and marks assessments stale. */
const IDENTITY_FIELDS = new Set([
  'population', 'outcome_domain', 'measurement',
  'timepoint', 'analysis_population', 'analysis',
]);

export function ResultHeader({
  result, studyLabel, studyMeta, measurementInferred,
  position, total, onPrev, onNext, seatText, progressText, stale,
  contrastText, onBack, sourceRef,
  canCorrect, correcting, onCorrect,
}: Props) {
  /**
   * Corrections are made in place: double-click the slot, type, press Enter.
   *
   * The form that used to sit here opened all seven slots at once behind a
   * "Correct identity" button, to change the one that was wrong — and it
   * carried a paragraph explaining a consequence that applies to six of them.
   * The consequence is still stated, but while editing the slot it applies to,
   * where it is about something.
   */
  const [editingField, setEditingField] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const startEdit = (field: string) => {
    setDraft(String((result as any)[field] ?? ''));
    setEditingField(field);
  };

  const commit = (field: string) => {
    const before = String((result as any)[field] ?? '');
    setEditingField(null);
    if (draft !== before) onCorrect?.({ [field]: draft });
  };
  const slots = identitySlots(result, measurementInferred);
  // The five that stay; the rest open on demand.
  const ALWAYS = new Set(['Outcome domain', 'Timepoint', 'Measurement']);
  const [open, setOpen] = useState(false);
  const shown = open ? slots : slots.filter(s => ALWAYS.has(s.label));

  return (
    <div className="border border-gray-200 border-t-[3px] border-t-gray-900 rounded-xl bg-white dark:bg-[#111111] dark:border-[#1f1f1f] dark:border-t-gray-900">
      <div className="flex items-start gap-4 flex-wrap px-4 pt-4">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-mono uppercase tracking-[0.09em] text-gray-400 dark:text-zinc-600">
            {studyLabel}
          </div>
          <div className="text-[17px] font-bold tracking-tight dark:text-white leading-snug">
            {result.outcome_domain}
            {result.timepoint && (
              <span className="font-normal text-gray-500 dark:text-zinc-500">
                {' · '}{result.timepoint}
              </span>
            )}
          </div>
          <div className="text-[12.5px] text-gray-600 dark:text-zinc-400 mt-1">{contrastText}</div>
          <div className="text-[12px] text-gray-500 dark:text-zinc-500">
            {result.measurement || 'Measurement not recorded'}
            {studyMeta && ` · ${studyMeta}`}
          </div>
        </div>
        <div className="text-right flex-none">
          <div className="text-[9px] font-mono uppercase tracking-[0.09em] text-gray-400 dark:text-zinc-600">
            Result
          </div>
          <div className="text-[12px] font-mono text-gray-600 dark:text-zinc-400">
            {position} of {total}
          </div>
          <div className="flex items-center gap-1 justify-end mt-1.5">
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                className="inline-flex items-center rounded-md border border-gray-200 dark:border-[#2a2a2a] px-2 py-1 text-[11.5px] font-semibold text-gray-600 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] mr-1"
              >
                ← Queue
              </button>
            )}
            <button
              type="button"
              onClick={onPrev}
              disabled={total < 2}
              aria-label="Previous result"
              className="inline-flex items-center rounded-md border border-gray-200 dark:border-[#2a2a2a] p-1 text-gray-600 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] disabled:opacity-40"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onNext}
              disabled={total < 2}
              aria-label="Next result"
              className="inline-flex items-center rounded-md border border-gray-200 dark:border-[#2a2a2a] p-1 text-gray-600 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] disabled:opacity-40"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 px-4 pt-3">
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          aria-expanded={open}
          className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-gray-500 dark:text-zinc-500 hover:underline"
        >
          <ChevronDown className={`h-3 w-3 transition-transform ${open ? '' : '-rotate-90'}`} />
          {open ? 'Hide result details ↑' : 'Result details ↓'}
        </button>
        <span className="text-[11.5px] text-gray-400 dark:text-zinc-600">{progressText}</span>
      </div>

      <div className="grid gap-x-4 gap-y-2.5 px-4 py-3.5 border-t border-gray-100 dark:border-[#1a1a1a] mt-3 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
        {(open
          ? [...shown,
            // Where the result came from and what instrument judged it: not
            // identity, but the two things somebody auditing a judgement needs
            // to find the source row and know which version of the tool applied.
            ...(sourceRef ? [{ label: 'Source reference', value: sourceRef }] : []),
            { label: 'Instrument', value: 'RoB 2 · parallel group · assignment effect' },
          ]
          : shown
        ).map(slot => {
          const field = SLOT_FIELD[slot.label];
          const canEdit = !!canCorrect && !!field && !!onCorrect;
          const isEditing = canEdit && editingField === field;
          return (
              <div key={slot.label} className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] font-mono uppercase tracking-[0.09em] text-gray-400 dark:text-zinc-600">
                    {slot.label}
                  </span>
                  {slot.tag && (
                    <span className={[
                      'text-[9px] font-mono rounded px-1 py-px',
                      slot.isDefault
                        ? 'bg-gray-200 text-gray-700 dark:bg-[#1f1f1f] dark:text-zinc-400'
                        : 'bg-gray-50 text-gray-500 dark:bg-[#1a1a1a] dark:text-zinc-500',
                    ].join(' ')}>
                      {slot.tag}
                    </span>
                  )}
                </div>
                {isEditing ? (
                  <>
                    <input
                      autoFocus
                      value={draft}
                      disabled={!!correcting}
                      onChange={e => setDraft(e.target.value)}
                      onBlur={() => commit(field)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') { e.preventDefault(); commit(field); }
                        if (e.key === 'Escape') { e.preventDefault(); setEditingField(null); }
                      }}
                      aria-label={`Correct ${slot.label}`}
                      className="mt-0.5 w-full text-[12.5px] font-medium rounded-md border border-gray-900 dark:border-white bg-white dark:bg-[#0d0d0d] px-1.5 py-0.5 dark:text-zinc-200 focus:outline-none"
                    />
                    {/* The consequence, next to the slot it applies to, only
                        while it is being changed. Six of the seven are part of
                        `rob_results_unique_identity`; the effect estimate is
                        not, and saying so of all seven was how a paragraph
                        ended up above a form nobody had opened yet. */}
                    <span className="block text-[10px] text-gray-500 dark:text-zinc-500 mt-0.5 leading-snug">
                      {IDENTITY_FIELDS.has(field)
                        ? 'Enter saves · assessments already made are marked stale, never re-pointed'
                        : 'Enter saves · not part of the identity, so nothing is marked stale'}
                    </span>
                  </>
                ) : (
                  <div
                    onDoubleClick={canEdit ? () => startEdit(field) : undefined}
                    title={canEdit ? 'Double-click to correct' : undefined}
                    className={`text-[12.5px] font-medium mt-0.5 break-words dark:text-zinc-200 ${canEdit
                      ? 'cursor-text rounded-md -mx-1 px-1 hover:bg-gray-50 dark:hover:bg-[#1a1a1a]' : ''}`}
                  >
                    {slot.value}
                  </div>
                )}
              </div>
          );
        })}
      </div>

      <div className="flex items-center gap-3 flex-wrap px-4 py-2.5 border-t border-gray-100 dark:border-[#1a1a1a] text-[11.5px] text-gray-500 dark:text-zinc-500">
        {/* "effect of assignment" was dropped from this stamp (22 Sep 2026). RoB 2
            has two variants and they ask different D2 questions, but this tool
            implements only the assignment one — nothing chooses it and nothing
            branches on it. The single question that turns on it says so in full,
            in context: 2.6. It is still written into every saved record as
            `rob_effect_of_interest`, which is where that provenance belongs. */}
        <span><strong className="font-semibold">RoB 2 · parallel group</strong> · 22 Aug 2019</span>
        <span className="flex-1" />
        <span>{seatText}</span>
      </div>

      {stale && (
        <div className="flex items-start gap-2 px-4 py-2.5 border-t border-gray-200 dark:border-[#2a2a2a] bg-gray-50 dark:bg-gray-500/5 text-[12px] text-gray-700 dark:text-zinc-300">
          <span>
            This result&rsquo;s identity was corrected after the assessment was made. The answers are
            kept as they were — check that they still describe the estimate above.
          </span>
        </div>
      )}
    </div>
  );
}

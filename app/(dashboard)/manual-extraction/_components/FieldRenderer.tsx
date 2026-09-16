'use client';

import { NR_LABEL, NA_LABEL } from '@/lib/absence';
import {
  hasDeclaredAbsence,
  needsAbsenceDisambiguation,
  unambiguousAbsenceLabel,
} from '../_lib/absenceInput';

import { useState } from 'react';
import { Quote, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FormField } from '@/types/api';
import { useFieldSourcing } from '../_lib/SourcingContext';
import { isRequiredField } from '../_lib/fieldKinds';
import { FieldLabel } from './FormChrome';

const inputCls = "w-full px-3 py-2 text-sm text-gray-900 dark:text-white bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a] rounded-lg outline-none focus:border-gray-400 dark:focus:border-[#3f3f3f] transition-colors placeholder:text-gray-300 dark:placeholder:text-zinc-600";

/** Shared look for the NR/NA toggles, wherever they appear. */
const absenceBtnCls = (pressed: boolean) => cn(
  "flex-none rounded-lg border px-2 py-1.5 text-[11px] font-medium transition-colors",
  pressed
    ? "border-violet-300 bg-violet-50/50 text-gray-800 dark:border-violet-600 dark:bg-violet-900/20 dark:text-zinc-200"
    : "border-gray-200 text-gray-500 hover:border-gray-300 dark:border-[#2a2a2a] dark:text-zinc-400 dark:hover:border-[#3a3a3a]",
);

const ABSENCE_TITLE: Record<string, string> = {
  [NR_LABEL]: 'Not reported — the paper is silent on this',
  [NA_LABEL]: 'Not applicable — this field cannot apply to this study',
};

/** The absence tokens to offer, minus any the form author already declared. */
function genericTokens(options: string[] | undefined): Array<typeof NR_LABEL | typeof NA_LABEL> {
  return ([NR_LABEL, NA_LABEL] as const).filter(
    tok => !hasDeclaredAbsence(options, tok as 'NR' | 'NA'),
  );
}

interface FieldRendererProps {
  field: FormField;
  value: any;
  onChange: (value: any) => void;
  /** Vestigial. The form numbers its *sections* now, not every input — a
   *  per-field number cost a 28px gutter on a pane that has none to spare. */
  index?: number;
  isAiPrefilled?: boolean;
  id?: string;
  compact?: boolean;
  /**
   * Overrides `field.example` in the scalar input. For hosts that synthesize a
   * FormField for a key with no schema entry and so have no example to offer.
   */
  placeholder?: string;
  /**
   * Identity of this cell for reviewer-supplied source quotes — `field_name` for
   * a scalar, `field[row].column` for a table cell. Omitted outside manual
   * extraction, where the sourcing context is absent and all of this is inert.
   */
  sourceKey?: string;
}

/**
 * The evidence line for one cell — the reviewer's own quote, or the AI's.
 *
 * Modelled on /consensus (`UnifiedFieldCard.SourceEvidence`), which had this
 * right first: show the **quote itself** with the page in bold, and make the
 * whole thing the button back to the PDF. The old chip here said only "p.1",
 * which told a reviewer nothing about what they had cited, and "no source" /
 * "highlight in PDF →" read as status labels rather than as something to do.
 *
 * Table cells stay on one short line: thirty full quotes inside a row grid is
 * unreadable, so `compact` keeps the page marker and moves the quote into the
 * tooltip. Silent unless the cell actually has evidence or owes some — a nag on
 * every field is how the feature gets switched off.
 */
function SourceChip({ sourceKey, compact }: { sourceKey?: string; compact?: boolean }) {
  const { enabled, isActive, source, ai, owes, clear, reveal } = useFieldSourcing(sourceKey);
  if (!enabled || (!source && !owes && !ai)) return null;

  const mine = !!source;
  const page = source ? source.source_location?.page ?? null : ai?.page ?? null;
  const quote = (source ? source.source_text : ai?.text) ?? '';
  // A drawn box has no words to show. Say so, rather than showing an empty quote.
  const isRegion = mine && !quote.trim();
  // `page` is genuinely optional: a location can carry boxes without one, and a
  // legacy cell can carry a quote alone. Never render the word "undefined".
  const label = isRegion
    ? (page != null ? `box on p.${page}` : 'box drawn in the PDF')
    : quote.trim()
      ? quote.length > 110 ? `${quote.slice(0, 110)}…` : quote
      : page != null ? `p.${page}` : 'source';

  if (source || (!owes && ai)) {
    const tint = mine
      ? 'text-teal-700 dark:text-teal-300'
      : 'text-gray-500 dark:text-zinc-500';
    const hover = mine
      ? 'hover:border-teal-400 dark:hover:border-teal-600'
      : 'hover:border-gray-400 dark:hover:border-zinc-500';
    const where = page != null ? ` (page ${page})` : '';
    const title = mine
      ? (isRegion ? `Show this box in the PDF${where}` : `Show this passage in the PDF${where}`)
      : `The AI cited this${page != null ? ` on page ${page}` : ''} — click to check it`;

    if (compact) {
      return (
        <span className="inline-flex max-w-full items-center gap-1">
          <button
            type="button"
            onClick={reveal}
            title={quote ? `${title}\n\n“${quote}”` : title}
            className={cn(
              'inline-flex min-w-0 items-center gap-1 rounded border px-1.5 py-px text-[10px] font-medium transition-colors',
              mine
                ? 'border-teal-200 bg-teal-50/70 text-teal-700 hover:border-teal-400 dark:border-teal-800/60 dark:bg-teal-900/20 dark:text-teal-300'
                : 'border-gray-200 bg-gray-50/80 text-gray-500 hover:border-gray-400 dark:border-[#2a2a2a] dark:bg-[#151515] dark:text-zinc-500',
            )}
          >
            <Quote className="h-2.5 w-2.5 flex-none" />
            <span className="truncate">
              {isRegion
                ? (page != null ? `box p.${page}` : 'box')
                : mine
                  ? (page != null ? `p.${page}` : 'cited')
                  : page != null ? `AI p.${page}` : 'AI'}
            </span>
          </button>
          {mine && (
            <button
              type="button"
              onClick={clear}
              aria-label="Remove source"
              className="flex-none text-teal-600/60 transition-opacity hover:text-teal-700 dark:text-teal-400/60"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          )}
        </span>
      );
    }

    return (
      <div className="mt-1.5 flex items-start gap-1">
        <button
          type="button"
          onClick={reveal}
          title={title}
          className={cn(
            'flex min-w-0 flex-1 gap-1 border-l-2 border-gray-200 pl-2 text-left text-[10px] transition-colors dark:border-[#2a2a2a]',
            tint, hover,
          )}
        >
          <Quote className="mt-0.5 h-2.5 w-2.5 flex-shrink-0 opacity-50" />
          <span className={cn('leading-relaxed', !isRegion && 'italic')}>
            {label}
            {page != null && !isRegion && (
              <span className={cn('ml-1.5 font-semibold not-italic', tint)}>p.{page}</span>
            )}
            {!mine && (
              <span className="ml-1.5 rounded bg-gray-100 px-1 text-[9px] font-medium not-italic uppercase tracking-wide text-gray-500 dark:bg-[#1a1a1a] dark:text-zinc-500">
                AI
              </span>
            )}
          </span>
        </button>
        {mine && (
          <button
            type="button"
            onClick={clear}
            aria-label="Remove source"
            title="Remove this source"
            className="mt-0.5 flex-none text-gray-400 transition-colors hover:text-rose-500 dark:text-zinc-600"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        )}
      </div>
    );
  }

  // Owes a source, and says nothing about it.
  //
  // There used to be a "Cite this" chip here, becoming "Highlight it in the PDF
  // →" on focus. Two amber chips per cell, on a form with forty of them, is a
  // wall of nagging that says the same thing every time — and it asked the
  // reviewer to go hunting for a passage field by field. The citing affordance
  // now lives on the PDF, where the passages are: the marks are clickable and
  // the pill at the foot of the pane says what to do. The count of cells still
  // owing one stays in the progress header, which is one line, not forty.
  return null;
}

/**
 * Text / number / date input, plus the two absence toggles.
 *
 * Split out of `FieldRenderer` because the disambiguation prompt needs state and
 * `renderInput()` is a conditional call site — a hook there would break the rules
 * of hooks. `FieldRenderer` itself stays hook-free.
 */
function ScalarInput({ field, value, onChange, isAiPrefilled, placeholder }: {
  field: FormField;
  value: any;
  onChange: (value: any) => void;
  isAiPrefilled?: boolean;
  placeholder?: string;
}) {
  const val = value ?? '';
  const [keptAsTyped, setKeptAsTyped] = useState<string | null>(null);
  const trimmed = typeof val === 'string' ? val.trim().toUpperCase() : '';

  // unambiguousAbsenceLabel, NOT canonicalAbsenceLabel: the latter folds 'N/A'
  // into NR, which silently disabled the input and rewrote the reviewer's text.
  const absenceVal = unambiguousAbsenceLabel(val);
  const asking = needsAbsenceDisambiguation(val) && keptAsTyped !== trimmed;
  const tokens = genericTokens(field.options);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <input
          type={field.field_type === 'number' || field.field_type === 'integer' ? 'number' : 'text'}
          value={absenceVal ? '' : val}
          onChange={e => onChange(e.target.value)}
          disabled={!!absenceVal}
          placeholder={absenceVal ? absenceVal : (placeholder ?? field.example ?? '')}
          className={cn(inputCls, isAiPrefilled && "bg-blue-50/30 dark:bg-blue-900/10", absenceVal && "opacity-60")}
        />
        {tokens.map(tok => (
          <button
            key={tok}
            type="button"
            onClick={() => onChange(absenceVal === tok ? '' : tok)}
            aria-pressed={absenceVal === tok}
            title={ABSENCE_TITLE[tok]}
            className={absenceBtnCls(absenceVal === tok)}
          >{tok}</button>
        ))}
      </div>

      {/* Ask rather than guess. The input stays enabled — the reviewer is
          mid-answer, and disabling it here would trap them. */}
      {asking && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50/60 px-2.5 py-1.5 dark:border-amber-800/50 dark:bg-amber-900/15">
          <span className="text-[11px] text-amber-800 dark:text-amber-200">
            &ldquo;{String(val).trim()}&rdquo; reads two ways. Which did you mean?
          </span>
          <button
            type="button"
            onClick={() => onChange(NR_LABEL)}
            className="rounded-md border border-amber-300 bg-white px-2 py-0.5 text-[11px] font-medium text-amber-800 transition-colors hover:bg-amber-100 dark:border-amber-700 dark:bg-[#1a1a1a] dark:text-amber-200 dark:hover:bg-amber-900/30"
          >
            Not reported
          </button>
          <button
            type="button"
            onClick={() => onChange(NA_LABEL)}
            className="rounded-md border border-amber-300 bg-white px-2 py-0.5 text-[11px] font-medium text-amber-800 transition-colors hover:bg-amber-100 dark:border-amber-700 dark:bg-[#1a1a1a] dark:text-amber-200 dark:hover:bg-amber-900/30"
          >
            Not applicable
          </button>
          <button
            type="button"
            onClick={() => setKeptAsTyped(trimmed)}
            className="text-[10px] text-amber-700/70 underline-offset-2 hover:underline dark:text-amber-300/70"
          >
            keep as typed
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Multi-select chips, plus the two absence toggles.
 *
 * The absence value is stored as the bare string `"NR"` / `"NA"`, never as
 * `["NR"]`. That is not a style choice: `classify` in `lib/absence.ts` treats any
 * non-empty array as a reported answer, so the array form would round-trip
 * through `compareKey` and the Python mirror as a finding rather than a gap.
 * The scalar form is the shape those readers already understand.
 */
function MultiSelectField({ field, value, onChange }: {
  field: FormField;
  value: any;
  onChange: (value: any) => void;
}) {
  const absenceVal = unambiguousAbsenceLabel(value);
  const selected: string[] = absenceVal
    ? []
    : Array.isArray(value)
      ? value
      : value ? String(value).split(',').map((s: string) => s.trim()).filter(Boolean) : [];

  const toggleOption = (opt: string) =>
    onChange(selected.includes(opt) ? selected.filter((s: string) => s !== opt) : [...selected, opt]);

  const tokens = genericTokens(field.options);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {field.options?.map(o => (
        <label
          key={o}
          className={cn(
            "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm transition-colors",
            absenceVal
              ? "cursor-not-allowed border-gray-200 text-gray-300 opacity-50 dark:border-[#2a2a2a] dark:text-zinc-600"
              : selected.includes(o)
                ? "cursor-pointer border-violet-300 bg-violet-50/50 text-gray-800 dark:border-violet-600 dark:bg-violet-900/20 dark:text-zinc-200"
                : "cursor-pointer border-gray-200 text-gray-500 hover:border-gray-300 dark:border-[#2a2a2a] dark:text-zinc-400 dark:hover:border-[#3a3a3a]",
          )}
        >
          {/* Unchecked-and-disabled, not checked-and-greyed: the selection
              genuinely is not part of the answer any more. */}
          <input
            type="checkbox"
            checked={!absenceVal && selected.includes(o)}
            disabled={!!absenceVal}
            onChange={() => toggleOption(o)}
            className="h-3.5 w-3.5 rounded border-gray-300 accent-violet-500 dark:border-zinc-600"
          />
          {o}
        </label>
      ))}
      {tokens.length > 0 && field.options?.length ? (
        <span className="mx-0.5 h-4 w-px flex-none bg-gray-200 dark:bg-[#2a2a2a]" aria-hidden />
      ) : null}
      {tokens.map(tok => (
        <button
          key={tok}
          type="button"
          onClick={() => onChange(absenceVal === tok ? [] : tok)}
          aria-pressed={absenceVal === tok}
          title={ABSENCE_TITLE[tok]}
          className={absenceBtnCls(absenceVal === tok)}
        >{tok}</button>
      ))}
    </div>
  );
}

export function FieldRenderer({ field, value, onChange, isAiPrefilled, id, compact, placeholder, sourceKey }: FieldRendererProps) {
  const val = value ?? '';
  const isEmpty = !val.toString().trim();
  const sourcing = useFieldSourcing(sourceKey);

  // Focus, not click: arrowing or tabbing into a field makes it the attach
  // target too, so keyboard-driven reviewers are not left out. Capture phase so
  // it fires for the inner <input>/<select> without wiring each one.
  const focusProps = sourcing.enabled
    ? { onFocusCapture: sourcing.focus, onMouseDownCapture: sourcing.focus }
    : {};

  const renderInput = () => {
    if (field.field_type === 'select' || field.field_type === 'enum' || field.field_type === 'list') {
      if (field.multiple) {
        return <MultiSelectField field={field} value={value} onChange={onChange} />;
      }
      return (
        <select value={val} onChange={e => onChange(e.target.value)} className={cn(inputCls, "cursor-pointer dark:[color-scheme:dark]", isAiPrefilled && "bg-blue-50/30 dark:bg-blue-900/10")}>
          <option value="">Select an option…</option>
          {field.options?.map((o) => <option key={o} value={o}>{o}</option>)}
          {/* Absence is an answer, and blank must keep meaning "not yet filled". */}
          {!hasDeclaredAbsence(field.options, 'NR') && <option value={NR_LABEL}>NR — not reported in the paper</option>}
          {!hasDeclaredAbsence(field.options, 'NA') && <option value={NA_LABEL}>NA — does not apply to this study</option>}
        </select>
      );
    }
    if (field.field_type === 'boolean') {
      return (
        <select value={val} onChange={e => onChange(e.target.value)} className={cn(inputCls, "cursor-pointer dark:[color-scheme:dark]", isAiPrefilled && "bg-blue-50/30 dark:bg-blue-900/10")}>
          <option value="">Select…</option>
          <option value="Yes">Yes</option>
          <option value="No">No</option>
          {/* Guarded like the select branch above. A boolean with declared
              options is only reachable by JSON import today, but this was the
              one branch where the author's vocabulary did not win. */}
          {!hasDeclaredAbsence(field.options, 'NR') && <option value={NR_LABEL}>NR — not reported in the paper</option>}
          {!hasDeclaredAbsence(field.options, 'NA') && <option value={NA_LABEL}>NA — does not apply to this study</option>}
        </select>
      );
    }
    // Text and number fields previously had no way to record absence at all:
    // a blank was indistinguishable from "not yet filled", so a required field
    // could not be marked not-reported without typing something.
    return (
      <ScalarInput
        field={field}
        value={value}
        onChange={onChange}
        isAiPrefilled={isAiPrefilled}
        placeholder={placeholder}
      />
    );
  };

  if (compact) {
    return (
      <div id={id} {...focusProps} className={cn(sourcing.isActive && 'rounded-lg ring-1 ring-teal-300 dark:ring-teal-700')}>
        {renderInput()}
        {sourcing.enabled && (
          <div className="mt-1 empty:hidden"><SourceChip sourceKey={sourceKey} compact={compact} /></div>
        )}
      </div>
    );
  }

  return (
    <div
      id={id}
      {...focusProps}
      className={cn(
        'border-l-2 pl-3 transition-colors',
        sourcing.isActive
          ? 'border-teal-400 dark:border-teal-600'
          : isEmpty
            ? 'border-amber-300 dark:border-amber-600'
            : 'border-transparent',
      )}
    >
      <FieldLabel name={field.field_name} required={isRequiredField(field)} field={field}>
        {isAiPrefilled && (
          <span className="flex-none text-[10px] font-medium text-blue-500 dark:text-blue-400">(AI)</span>
        )}
      </FieldLabel>
      {renderInput()}
      {sourcing.enabled && (sourcing.source || sourcing.ai) && <SourceChip sourceKey={sourceKey} />}
    </div>
  );
}

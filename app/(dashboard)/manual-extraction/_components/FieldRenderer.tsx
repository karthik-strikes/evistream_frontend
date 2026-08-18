'use client';

import { NR_LABEL, NA_LABEL } from '@/lib/absence';
import {
  hasDeclaredAbsence,
  needsAbsenceDisambiguation,
  unambiguousAbsenceLabel,
} from '../_lib/absenceInput';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { FormField } from '@/types/api';

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
  index: number;
  isAiPrefilled?: boolean;
  id?: string;
  compact?: boolean;
  /**
   * Overrides `field.example` in the scalar input. For hosts that synthesize a
   * FormField for a key with no schema entry and so have no example to offer.
   */
  placeholder?: string;
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

export function FieldRenderer({ field, value, onChange, index, isAiPrefilled, id, compact, placeholder }: FieldRendererProps) {
  const val = value ?? '';
  const isEmpty = !val.toString().trim();

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
    return <div id={id}>{renderInput()}</div>;
  }

  return (
    <div id={id} className={cn(isEmpty && "border-l-2 border-amber-300 dark:border-amber-600 pl-3", !isEmpty && "pl-[14px]")}>
      <div className="flex items-start gap-2 mb-1.5">
        <span className="text-[11px] font-bold text-gray-300 dark:text-zinc-700 w-5 text-right flex-shrink-0 mt-0.5 tabular-nums">{index}</span>
        <div className="flex-1">
          <p className="text-xs font-semibold text-gray-700 dark:text-zinc-300 capitalize">
            {field.field_name.replace(/_/g, ' ')}
            {isAiPrefilled && (
              <span className="ml-1.5 text-[10px] font-medium text-blue-500 dark:text-blue-400">(AI)</span>
            )}
          </p>
          {field.field_description && (
            <p className="text-[11px] text-gray-400 dark:text-zinc-500 mt-0.5 leading-snug">{field.field_description}</p>
          )}
          {field.extraction_hints && (
            <p className="text-[11px] text-gray-400/70 dark:text-zinc-600 mt-0.5 leading-snug italic">{field.extraction_hints}</p>
          )}
        </div>
      </div>
      {renderInput()}
    </div>
  );
}

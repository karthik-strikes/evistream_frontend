'use client';

import { Check, ChevronDown, Sparkles } from 'lucide-react';
import { Spinner } from '@/components/ui';
import { cn } from '@/lib/utils';
import { SlotSelect } from './SlotSelect';
import {
  identityHeader,
  identitySlots,
  longSlots,
  pairedRows,
  suggestedCount,
  type ColumnCoverage,
  type Mapping,
  type OutcomeKind,
  type SlotKey,
  type TableLayout,
} from '../_lib/mapping';

export function MappingStep({
  forms,
  formId,
  onFormChange,
  sourceField,
  scalarCoverage,
  columnCoverage,
  columnNames,
  kind,
  layout,
  onKind,
  onLayout,
  mapping,
  onSelect,
  onConfirm,
  onConfirmAll,
  onSuggest,
  suggesting,
  suggestionSource,
  suggestionWarnings,
  armOptions,
  comparatorValue,
  onComparatorValue,
  armColumn,
  children,
}: {
  forms: Array<{ id: string; form_name: string }>;
  formId: string;
  onFormChange: (id: string) => void;
  sourceField: string | null;
  scalarCoverage: ColumnCoverage[];
  columnCoverage: ColumnCoverage[];
  columnNames: string[];
  kind: OutcomeKind;
  layout: TableLayout;
  onKind: (k: OutcomeKind) => void;
  onLayout: (l: TableLayout) => void;
  mapping: Mapping;
  onSelect: (key: SlotKey, col: string) => void;
  onConfirm: (key: SlotKey) => void;
  onConfirmAll: () => void;
  onSuggest: () => void;
  suggesting: boolean;
  suggestionSource: string | null;
  suggestionWarnings: string[];
  armOptions: string[];
  comparatorValue: string;
  onComparatorValue: (v: string) => void;
  armColumn: string | null;
  /** The units card, which only some forms need. */
  children?: React.ReactNode;
}) {
  const nSuggested = suggestedCount(mapping);
  const mappingEmpty = Object.keys(mapping).length === 0;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[330px_1fr] gap-5 items-start">
      {/* ── Source form and its columns ─────────────────────────────────── */}
      <div className="border border-border rounded-lg bg-white dark:bg-[#111111] dark:border-[#1f1f1f]">
        <div className="p-4 pb-3 border-b border-gray-100 dark:border-[#1f1f1f]">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-zinc-500 mb-2">
            Source form
          </div>
          <select
            value={formId}
            onChange={e => onFormChange(e.target.value)}
            className="w-full h-9 border border-gray-200 rounded-lg bg-white text-[13px] px-2 text-gray-900 dark:border-[#2a2a2a] dark:bg-[#1a1a1a] dark:text-white focus:outline-none"
          >
            {forms.map(f => (
              <option key={f.id} value={f.id}>
                {f.form_name}
              </option>
            ))}
          </select>
        </div>

        <div className="p-4 pt-3">
          {scalarCoverage.map(c => (
            <CoverageRow key={c.name} col={c} />
          ))}

          {sourceField && (
            <>
              <div className="flex items-center gap-2 pt-2 pb-1 mt-1">
                <ChevronDown className="h-3 w-3 text-gray-500 dark:text-zinc-500" />
                <span className="font-mono text-[12.5px] font-semibold text-gray-900 dark:text-white">
                  {sourceField}
                </span>
                <span className="text-[10px] font-medium bg-gray-100 text-gray-600 rounded-full px-1.5 py-0.5 dark:bg-[#1f1f1f] dark:text-zinc-400">
                  table
                </span>
              </div>
              <div className="border-l border-gray-200 dark:border-[#2a2a2a] ml-[5px] pl-3.5 flex flex-col">
                {columnCoverage.map(c => (
                  <CoverageRow key={c.name} col={c} />
                ))}
              </div>
            </>
          )}

          <div className="text-[11px] text-gray-400 dark:text-zinc-600 mt-3 leading-relaxed">
            Coverage counts documents with a value in that column. Low-coverage columns can&rsquo;t
            reliably anchor an analysis.
          </div>
        </div>
      </div>

      {/* ── Shape and mapping ───────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 min-w-0">
        <div className="border border-border rounded-lg bg-white p-4 dark:bg-[#111111] dark:border-[#1f1f1f]">
          <div className="flex items-start gap-6 flex-wrap">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-zinc-500 mb-2">
                Outcome type
              </div>
              <div className="inline-flex bg-gray-100 dark:bg-[#1a1a1a] rounded-lg p-0.5">
                <Toggle active={kind === 'dichotomous'} onClick={() => onKind('dichotomous')}>
                  Dichotomous
                </Toggle>
                <Toggle active={kind === 'continuous'} onClick={() => onKind('continuous')}>
                  Continuous
                </Toggle>
              </div>
            </div>

            <div className="flex-1 min-w-[340px]">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-zinc-500 mb-2">
                How is this table organized?
              </div>
              <div className="flex gap-2.5">
                <LayoutChoice
                  active={layout === 'wide'}
                  onClick={() => onLayout('wide')}
                  title="One row per comparison"
                  detail="Treatment and comparator side by side"
                />
                <LayoutChoice
                  active={layout === 'long'}
                  onClick={() => onLayout('long')}
                  title="One row per study arm"
                  detail="Rows must be paired up"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="border border-border rounded-lg bg-white p-4 dark:bg-[#111111] dark:border-[#1f1f1f]">
          <div className="flex items-center gap-3 mb-1 flex-wrap">
            <div className="text-[15px] font-semibold dark:text-white">Map fields to analysis roles</div>
            <div className="ml-auto flex items-center gap-2.5">
              {nSuggested > 0 && (
                <>
                  <span className="text-xs text-amber-700 dark:text-amber-400">
                    {nSuggested} suggested — confirm before running
                  </span>
                  <button
                    type="button"
                    onClick={onConfirmAll}
                    className="cursor-pointer text-xs font-semibold bg-[#0a0a0a] text-white rounded-md px-3 py-1.5 hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-100"
                  >
                    Confirm all
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={onSuggest}
                disabled={suggesting}
                className="flex items-center gap-1.5 cursor-pointer text-xs font-medium text-gray-600 dark:text-zinc-400 border border-gray-200 dark:border-[#2a2a2a] rounded-md px-2.5 py-1.5 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] disabled:opacity-50"
              >
                {suggesting ? <Spinner className="h-3 w-3" /> : <Sparkles className="h-3 w-3" />}
                {suggesting ? 'Reading columns…' : 'Suggest again'}
              </button>
            </div>
          </div>

          {suggestionSource === 'heuristic' && (
            <div className="text-xs text-amber-700 dark:text-amber-400 mb-2">
              The mapping model was unavailable, so these came from column names alone. Check each
              one carefully.
            </div>
          )}
          {suggestionWarnings.map(w => (
            <div key={w} className="text-xs text-gray-500 dark:text-zinc-500 mb-1">
              {w}
            </div>
          ))}

          {mappingEmpty && !suggesting && (
            <div className="border-[1.5px] border-dashed border-gray-300 dark:border-[#2a2a2a] rounded-lg bg-gray-50 dark:bg-[#0d0d0d] p-8 text-center mt-3">
              <div className="text-sm font-semibold mb-1.5 dark:text-white">No analysis mapping yet</div>
              <div className="text-[13px] text-gray-500 dark:text-zinc-400 max-w-md mx-auto mb-4 leading-relaxed">
                A mapping tells EviStream which columns hold the meta-analysis inputs — events,
                totals, means. Suggestions are never applied without your confirmation.
              </div>
              <button
                type="button"
                onClick={onSuggest}
                className="cursor-pointer text-[13px] font-semibold bg-[#0a0a0a] text-white rounded-md px-4 py-2 hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-100"
              >
                Suggest a mapping
              </button>
            </div>
          )}

          {mappingEmpty && suggesting && (
            <div className="flex items-center justify-center gap-2.5 p-10 text-[13px] text-gray-500 dark:text-zinc-400">
              <Spinner className="h-4 w-4" />
              Reading this form&rsquo;s columns…
            </div>
          )}

          {!mappingEmpty && (
            <>
              {layout === 'wide' ? (
                <>
                  <div className="grid grid-cols-[96px_1fr_1fr] gap-2.5 mt-3.5">
                    <div />
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-zinc-500">
                      Treatment arm
                    </div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-zinc-500">
                      Comparator arm
                    </div>
                  </div>
                  {pairedRows(kind).map(r => (
                    <div key={r.label} className="grid grid-cols-[96px_1fr_1fr] gap-2.5 mt-2.5 items-stretch">
                      <div className="text-[13px] font-medium text-gray-700 dark:text-zinc-300 flex items-center">
                        {r.label}
                      </div>
                      <SlotSelect slotKey={r.treatment} mapping={mapping} columns={columnNames}
                        onSelect={onSelect} onConfirm={onConfirm} sourceField={sourceField} showPath />
                      <SlotSelect slotKey={r.comparator} mapping={mapping} columns={columnNames}
                        onSelect={onSelect} onConfirm={onConfirm} sourceField={sourceField} showPath />
                    </div>
                  ))}
                </>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mt-3.5">
                  {longSlots(kind).map(s => (
                    <SlotSelect key={s.key} slotKey={s.key} label={s.label} mapping={mapping}
                      columns={columnNames} onSelect={onSelect} onConfirm={onConfirm}
                      sourceField={sourceField} showPath />
                  ))}
                </div>
              )}

              <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-zinc-500 mt-4 mb-2">
                {identityHeader(layout)}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {identitySlots(layout).map(s => (
                  <SlotSelect key={s.key} slotKey={s.key} label={s.label} mapping={mapping}
                    columns={columnNames} onSelect={onSelect} onConfirm={onConfirm} />
                ))}
              </div>

              {layout === 'long' && armColumn && (
                <div className="flex items-center gap-2 border border-gray-200 dark:border-[#2a2a2a] bg-gray-50 dark:bg-[#0d0d0d] rounded-lg px-3 py-2.5 mt-3 flex-wrap">
                  <span className="text-[13px] text-gray-700 dark:text-zinc-300">
                    The comparator row is the one where
                  </span>
                  <span className="font-mono text-xs font-semibold bg-gray-100 dark:bg-[#1f1f1f] dark:text-zinc-200 rounded px-2 py-1">
                    {armColumn}
                  </span>
                  <span className="text-[13px] text-gray-700 dark:text-zinc-300">=</span>
                  <select
                    value={comparatorValue}
                    onChange={e => onComparatorValue(e.target.value)}
                    className="h-8 border border-gray-200 rounded-md bg-white text-[13px] px-2 text-gray-900 dark:border-[#2a2a2a] dark:bg-[#1a1a1a] dark:text-white focus:outline-none max-w-full"
                  >
                    <option value="">Select the comparator arm…</option>
                    {armOptions.map(o => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                  <span className="text-xs text-gray-400 dark:text-zinc-600 basis-full mt-1 leading-relaxed">
                    Options are the values actually found in <span className="font-mono">{armColumn}</span>.
                    Rows are matched on outcome and timepoint; every other row in a group becomes a
                    treatment arm compared against this one.
                  </span>
                </div>
              )}
            </>
          )}
        </div>

        {children}
      </div>
    </div>
  );
}

function CoverageRow({ col }: { col: ColumnCoverage }) {
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="font-mono text-[12.5px] text-gray-700 dark:text-zinc-300 truncate" title={col.name}>
        {col.name}
      </span>
      <span
        title="Documents with a value in this column"
        className={cn(
          'ml-auto flex items-center gap-1 text-[11px] whitespace-nowrap',
          col.low ? 'text-amber-700 dark:text-amber-400' : 'text-gray-400 dark:text-zinc-600',
        )}
      >
        {col.low ? (
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" />
        ) : (
          <Check className="h-2.5 w-2.5 text-green-600 dark:text-green-500" />
        )}
        {col.documents}/{col.totalDocuments}
      </span>
    </div>
  );
}

function Toggle({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'cursor-pointer text-[13px] font-medium px-3.5 py-1.5 rounded-md transition-colors',
        active
          ? 'bg-white text-gray-900 shadow-sm dark:bg-[#2a2a2a] dark:text-white'
          : 'bg-transparent text-gray-500 dark:text-zinc-500',
      )}
    >
      {children}
    </button>
  );
}

function LayoutChoice({
  active, onClick, title, detail,
}: { active: boolean; onClick: () => void; title: string; detail: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex-1 flex items-start gap-2.5 text-left cursor-pointer rounded-lg px-3 py-2.5 border-[1.5px] transition-colors',
        active
          ? 'bg-gray-50 border-[#0a0a0a] dark:bg-[#1a1a1a] dark:border-white'
          : 'bg-white border-gray-200 dark:bg-[#111111] dark:border-[#2a2a2a]',
      )}
    >
      <span
        className={cn(
          'w-3.5 h-3.5 rounded-full border-[1.5px] flex items-center justify-center mt-0.5 flex-shrink-0',
          active ? 'border-[#0a0a0a] dark:border-white' : 'border-gray-300 dark:border-[#3a3a3a]',
        )}
      >
        {active && <span className="w-1.5 h-1.5 rounded-full bg-[#0a0a0a] dark:bg-white" />}
      </span>
      <span>
        <span className="block text-[13px] font-semibold text-gray-900 dark:text-white">{title}</span>
        <span className="block text-xs text-gray-500 dark:text-zinc-400 mt-0.5">{detail}</span>
      </span>
    </button>
  );
}

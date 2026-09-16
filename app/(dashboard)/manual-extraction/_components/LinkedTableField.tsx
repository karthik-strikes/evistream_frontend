'use client';

import { useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Copy, Plus, Table2, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FormField } from '@/types/api';
import { FieldRenderer } from './FieldRenderer';
import { TableField } from './TableField';
import {
  AutoGrid, CountChip, Divider, FieldLabel, GhostButton, NumBadge, SectionHead,
  humanize, spanAll,
} from './FormChrome';
import { isRequiredField, type AiTablePrefill } from '../_lib/fieldKinds';
import { tableCellKey } from '../_lib/sourcing';
import { remapRows, rowsRemoved, type RowRemap } from '../_lib/rowMoves';
import {
  GROUP_PALETTE, ROW_COLOR,
  addInstance, assignInstance, blankRow, deriveInstances, filledCount,
  instanceLabel, planTable, removeRows, sharedAnchor, sharedValue, sharedValues, stamp, stampStudy,
  type GroupInstance, type GroupPlan, type TableRow,
} from '../_lib/linkedGroups';

interface LinkedTableFieldProps {
  field: FormField;
  rows: TableRow[];
  onChange: (rows: TableRow[], remap?: RowRemap) => void;
  aiPrefill?: AiTablePrefill;
  errors?: Record<number, Set<string>>;
  saving?: boolean;
  /** Open the column-grouping setup for this field. */
  onEditGrouping?: () => void;
}

const newId = () => Math.random().toString(36).slice(2);
const norm = (v: any): string => (v == null ? '' : String(v)).trim();

/** One editable cell, wherever it sits. Always renders through FieldRenderer so
 *  a shared value keeps the same NR/NA toggles, option list and source-quote
 *  affordance a per-row cell has. */
function Cell({
  field, col, rowIdx, value, onChange, ai, error, compact,
}: {
  field: FormField;
  col: FormField;
  /** The flat row this cell's quote and AI provenance hang off. For a shared
   *  value that is the first row it spans — the value is identical on all of
   *  them, so any one is a truthful anchor, and the first is stable. */
  rowIdx: number;
  value: string;
  onChange: (v: string) => void;
  ai: boolean;
  error: boolean;
  compact?: boolean;
}) {
  return (
    <div className={cn(error && 'rounded-lg ring-1 ring-red-400')}>
      <FieldRenderer
        field={col}
        value={value}
        onChange={v => onChange(String(v ?? ''))}
        isAiPrefilled={ai}
        id={`field-${col.field_name}-r${rowIdx}`}
        sourceKey={tableCellKey(field.field_name, rowIdx, col.field_name)}
        compact={compact}
      />
    </div>
  );
}

/**
 * One instance of a group whose only column is its name — an arm, an outcome.
 *
 * A collapsible card for a single text box was three lines of chrome around one
 * line of content. This is the line of content, with the disc, the row count
 * and the bin around it.
 */
function InstanceLine({
  field, group, inst, rows, onChange, onRemoveRows, aiPrefill, errors, saving, color, n,
}: {
  field: FormField;
  group: GroupPlan;
  inst: GroupInstance;
  rows: TableRow[];
  onChange: (rows: TableRow[], remap?: RowRemap) => void;
  /** Removal is the parent's job: it owns the per-row ids that have to shift
   *  with the rows. */
  onRemoveRows: (indices: number[]) => void;
  aiPrefill?: AiTablePrefill;
  errors?: Record<number, Set<string>>;
  saving?: boolean;
  color: string;
  n: number;
}) {
  const col = group.cols[0];
  // The row this input speaks for — where the value actually sits, not just the
  // first row of the instance. See sharedAnchor.
  const anchor = sharedAnchor(rows, inst.rowIndices, col.field_name);
  const label = instanceLabel(inst, group.keyCols);
  const count = inst.rowIndices.length;

  const remove = () => {
    if (!window.confirm(
      `Remove "${label || 'this ' + group.name}" and the ${count} result row${count === 1 ? '' : 's'} under it?`,
    )) return;
    onRemoveRows(inst.rowIndices);
  };

  return (
    <div className="flex items-center gap-2.5">
      <NumBadge n={n} color={color} />
      <div className="min-w-0 flex-1">
        <Cell
          field={field}
          col={col}
          rowIdx={anchor}
          value={sharedValue(rows, inst.rowIndices, col.field_name)}
          onChange={v => onChange(stamp(rows, inst.rowIndices, col.field_name, v))}
          ai={inst.rowIndices.some(r => !!aiPrefill?.cells[r]?.has(col.field_name))}
          error={inst.rowIndices.some(r => !!errors?.[r]?.has(col.field_name))}
          compact
        />
      </div>
      <span className="flex-none text-[10px] tabular-nums text-gray-400 dark:text-zinc-600">
        {count} row{count === 1 ? '' : 's'}
      </span>
      <button
        onClick={remove}
        disabled={saving}
        title={`Remove this ${group.name}`}
        className="flex-none rounded p-1 text-gray-300 transition-colors hover:text-red-400 disabled:opacity-40 dark:text-zinc-700 dark:hover:text-red-400"
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}

/** One instance of a group that carries several columns — a scale with a name,
 *  a type, a range and a question. Collapsed to its identity and a fill count,
 *  because the whole point is that its fields are answered once and then stay
 *  out of the way. */
function InstanceBlock({
  field, group, inst, rows, onChange, onRemoveRows, aiPrefill, errors, saving, color, n, openByDefault,
}: {
  field: FormField;
  group: GroupPlan;
  inst: GroupInstance;
  rows: TableRow[];
  onChange: (rows: TableRow[], remap?: RowRemap) => void;
  onRemoveRows: (indices: number[]) => void;
  aiPrefill?: AiTablePrefill;
  errors?: Record<number, Set<string>>;
  saving?: boolean;
  color: string;
  n: number;
  openByDefault: boolean;
}) {
  const [open, setOpen] = useState(openByDefault);
  const label = instanceLabel(inst, group.keyCols);
  const filled = filledCount(rows, inst.rowIndices, group.cols);
  const hasError = group.cols.some(c => inst.rowIndices.some(i => errors?.[i]?.has(c.field_name)));

  const remove = () => {
    const count = inst.rowIndices.length;
    if (!window.confirm(
      `Remove "${label || 'this ' + group.name}" and the ${count} result row${count === 1 ? '' : 's'} under it?`,
    )) return;
    onRemoveRows(inst.rowIndices);
  };

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen(p => !p)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(p => !p); } }}
        className="flex cursor-pointer select-none items-center gap-2 py-1"
      >
        {open
          ? <ChevronDown className="h-3.5 w-3.5 flex-none text-gray-400" />
          : <ChevronRight className="h-3.5 w-3.5 flex-none text-gray-400" />}
        <NumBadge n={n} color={color} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-gray-800 dark:text-zinc-200">
          {label || (
            <span className="font-normal italic text-gray-400 dark:text-zinc-600">
              Unnamed {group.name} — open to fill in
            </span>
          )}
        </span>
        <span className="flex-none text-[10px] tabular-nums text-gray-400 dark:text-zinc-600">
          {inst.rowIndices.length} row{inst.rowIndices.length === 1 ? '' : 's'}
        </span>
        <CountChip filled={filled} total={group.cols.length} error={hasError} />
        <button
          onClick={e => { e.stopPropagation(); remove(); }}
          disabled={saving}
          title={`Remove this ${group.name}`}
          className="flex-none rounded p-1 text-gray-300 transition-colors hover:text-red-400 disabled:opacity-40 dark:text-zinc-700 dark:hover:text-red-400"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>

      {open && (
        <AutoGrid min={230} gap="gap-x-5 gap-y-3.5" className="pb-1 pl-7 pt-2">
          {group.cols.map(col => {
            const disagree = sharedValues(rows, inst.rowIndices, col.field_name).length > 1;
            return (
            <div key={col.field_name} className="min-w-0">
              <FieldLabel
                name={col.field_name}
                required={isRequiredField(col)}
                field={col}
                note={disagree ? 'differs across rows — editing sets them all' : undefined}
                noteColor="#b45309"
              />
              <Cell
                field={field}
                col={col}
                rowIdx={sharedAnchor(rows, inst.rowIndices, col.field_name)}
                value={sharedValue(rows, inst.rowIndices, col.field_name)}
                onChange={v => onChange(stamp(rows, inst.rowIndices, col.field_name, v))}
                ai={inst.rowIndices.some(r => !!aiPrefill?.cells[r]?.has(col.field_name))}
                error={inst.rowIndices.some(r => !!errors?.[r]?.has(col.field_name))}
                compact
              />
            </div>
            );
          })}
        </AutoGrid>
      )}
    </div>
  );
}

export function LinkedTableField({
  field, rows, onChange, aiPrefill, errors, saving, onEditGrouping,
}: LinkedTableFieldProps) {
  const plan = useMemo(() => planTable(field), [field]);
  const [flat, setFlat] = useState(false);
  const allCols = field.subform_fields ?? [];

  // Stable per-row ids so a cell's internal state follows its data across an
  // insert or a delete rather than the position it happened to occupy. Grown
  // during render because `key` is needed while rendering; idempotent, since
  // the row count drives it.
  const idsRef = useRef<string[]>([]);
  while (idsRef.current.length < rows.length) idsRef.current.push(newId());
  if (idsRef.current.length > rows.length) idsRef.current.length = rows.length;

  const groupInstances = useMemo(
    () => plan.groups.map(g => deriveInstances(rows, g.keyCols)),
    [plan.groups, rows],
  );

  const colorOf = (i: number) => GROUP_PALETTE[i % GROUP_PALETTE.length];

  const addRow = (seedFrom: number | null) => {
    idsRef.current = [...idsRef.current, newId()];
    onChange([...rows, blankRow(field, rows, seedFrom)]);
  };

  /** A copy of one row, appended rather than spliced in beneath it. Every
   *  row-indexed side table — AI provenance, per-cell errors, the reviewer's own
   *  source quotes — is keyed by position, so an insert in the middle would
   *  silently re-point all of them one row down. */
  const duplicateRow = (idx: number) => {
    idsRef.current = [...idsRef.current, newId()];
    onChange([...rows, { ...rows[idx] }]);
  };

  const removeRow = (idx: number) => {
    if (!window.confirm('Remove this result row?')) return;
    dropRows([idx]);
  };

  /** Remove rows, and move the per-row ids and every row-keyed side table with
   *  them. One place, because a group card removes several rows at once and got
   *  the ids wrong doing it itself: `idsRef` was truncated from the end, so
   *  after deleting an instance in the middle every remaining row was rendered
   *  under another row's key. */
  const dropRows = (indices: number[]) => {
    const remap = rowsRemoved(indices);
    idsRef.current = remapRows(idsRef.current, remap);
    onChange(removeRows(rows, indices), remap);
  };

  const setRowCell = (idx: number, col: string, v: string) =>
    onChange(rows.map((r, i) => (i === idx ? { ...r, [col]: v } : r)));

  const isAiTable = !!aiPrefill && aiPrefill.rowIndices.size > 0;

  // The escape hatch. If a form is tagged wrongly — or a reviewer simply wants
  // to see the stored shape — the flat editor is one click away and writes the
  // identical array, so nothing is trapped behind the grouped view.
  if (flat) {
    return (
      <div className="space-y-2">
        <div className="flex justify-end">
          <GhostButton onClick={() => setFlat(false)}>
            Grouped view
          </GhostButton>
        </div>
        <TableField
          field={field} rows={rows} onChange={onChange}
          aiPrefill={aiPrefill} errors={errors} saving={saving}
          onEditGrouping={onEditGrouping}
        />
      </div>
    );
  }

  const sections: ReactNode[] = [];
  let step = 0;

  if (plan.study.length > 0) {
    step += 1;
    sections.push(
      <section key="study">
        <SectionHead step={step} title="Study level" note="entered once — never repeated in rows" />
        <AutoGrid min={230} gap="gap-x-5 gap-y-3.5">
          {plan.study.map(col => {
            const disagree = sharedValues(rows, rows.map((_, r) => r), col.field_name).length > 1;
            return (
            <div key={col.field_name} className="min-w-0">
              <FieldLabel
                name={col.field_name}
                required={isRequiredField(col)}
                field={col}
                note={disagree ? 'differs across rows — editing sets them all' : undefined}
                noteColor="#b45309"
              />
              <Cell
                field={field}
                col={col}
                rowIdx={sharedAnchor(rows, rows.map((_, r) => r), col.field_name)}
                value={sharedValue(rows, rows.map((_, r) => r), col.field_name)}
                onChange={v => {
                  // Nowhere to put a study value until a row exists, so the
                  // first one typed creates it. Storing it in a side-buffer
                  // instead would mean a value the reviewer can see but Save
                  // cannot find.
                  const base = rows.length ? rows : [blankRow(field, rows, null)];
                  if (!rows.length) idsRef.current = [newId()];
                  onChange(stampStudy(base, col.field_name, v));
                }}
                ai={rows.some((_, r) => !!aiPrefill?.cells[r]?.has(col.field_name))}
                error={rows.some((_, r) => !!errors?.[r]?.has(col.field_name))}
                compact
              />
            </div>
            );
          })}
        </AutoGrid>
      </section>,
    );
  }

  plan.groups.forEach((group, gi) => {
    step += 1;
    const instances = groupInstances[gi];
    const color = colorOf(gi);
    // Two unnamed instances have the same (empty) identity, so they merge into
    // one card over two rows and the name then gets stamped onto both. Adding
    // one appeared to do nothing while the row count climbed.
    const unnamed = instances.some(inst => !inst.id);
    // A group whose only column is its name is one line per instance; anything
    // wider keeps a header it can fold away. The rule reads off the *form*, not
    // off how many instances happen to exist, so the section does not change
    // shape under a reviewer who is adding one.
    const inline = group.cols.length === 1;

    sections.push(
      <section key={`group:${group.name}`}>
        <SectionHead
          step={step}
          title={group.name}
          note={`${instances.length} defined — result rows reference ${instances.length === 1 ? 'it' : 'them'}`}
          action={
            <span className="inline-flex flex-none items-center gap-1.5">
              {unnamed && (
                <span
                  className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-700 dark:text-amber-400"
                  title={`Name the unnamed ${group.name} before adding another — two unnamed ones would merge into one.`}
                >
                  <AlertTriangle className="h-3 w-3" /> name it first
                </span>
              )}
              <GhostButton
                onClick={() => onChange(addInstance(field, rows, group))}
                disabled={saving || unnamed}
                title={unnamed
                  ? `Name the unnamed ${group.name} first`
                  : `Add another ${group.name}`}
              >
                <Plus className="h-3 w-3" /> Add {group.name}
              </GhostButton>
            </span>
          }
        />
        {instances.length === 0 ? (
          <p className="py-1 text-[12px] text-gray-400 dark:text-zinc-600">
            No {group.name} yet — <span className="font-semibold">Add {group.name}</span> to begin.
          </p>
        ) : (
          <div className={inline ? 'space-y-2' : 'divide-y divide-gray-100 dark:divide-[#1a1a1a]'}>
            {/* Keyed by the anchor row's stable id, never by `inst.id`: the
                identity is derived from the very columns being typed into, so a
                key built from it changed on every keystroke — React then
                remounted the card, the input lost focus after one character and
                a multi-column card folded itself shut. */}
            {instances.map((inst, i) => {
              const rowKey = idsRef.current[inst.rowIndices[0] ?? 0] ?? `i${i}`;
              return inline ? (
                <InstanceLine
                  key={`${group.name}:${rowKey}`}
                  field={field} group={group} inst={inst} rows={rows}
                  onChange={onChange} onRemoveRows={dropRows}
                  aiPrefill={aiPrefill} errors={errors}
                  saving={saving} color={color} n={i + 1}
                />
              ) : (
                <InstanceBlock
                  key={`${group.name}:${rowKey}`}
                  field={field} group={group} inst={inst} rows={rows}
                  onChange={onChange} onRemoveRows={dropRows}
                  aiPrefill={aiPrefill} errors={errors}
                  saving={saving} color={color} n={i + 1}
                  openByDefault={!inst.id || instances.length === 1}
                />
              );
            })}
          </div>
        )}
      </section>,
    );
  });

  step += 1;
  sections.push(
    <section key="results">
      <SectionHead
        step={step}
        title="Results"
        note={
          plan.row.length
            ? 'one row per data point — everything above is stamped onto each row on save'
            : 'every column is shared above, so a row carries no extra values'
        }
        action={
          <GhostButton onClick={() => addRow(rows.length ? rows.length - 1 : null)} disabled={saving}>
            <Plus className="h-3 w-3" /> Add row
          </GhostButton>
        }
      />
      {rows.length === 0 ? (
        <p className="py-1 text-[12px] text-gray-400 dark:text-zinc-600">
          No rows yet — <span className="font-semibold">Add row</span> to begin.
        </p>
      ) : (
        <>
          <div className="space-y-5">
            {rows.map((row, rowIdx) => (
              <ResultRow
                key={idsRef.current[rowIdx]}
                field={field} plan={plan} allCols={allCols} row={row} rowIdx={rowIdx} rows={rows}
                instances={groupInstances} colorOf={colorOf}
                onChange={onChange} setCell={setRowCell}
                onRemove={() => removeRow(rowIdx)} onDuplicate={() => duplicateRow(rowIdx)}
                aiPrefill={aiPrefill} errors={errors} saving={saving}
              />
            ))}
          </div>
          <button
            onClick={() => addRow(rows.length - 1)}
            disabled={saving}
            className="mt-4 flex w-full cursor-pointer items-center justify-center gap-1 rounded-lg border border-dashed border-gray-200 py-2 text-[11px] text-gray-400 transition-colors hover:border-gray-300 hover:text-gray-500 disabled:opacity-40 dark:border-[#2a2a2a] dark:text-zinc-600 dark:hover:border-[#3a3a3a] dark:hover:text-zinc-500"
          >
            <Plus className="h-3 w-3" /> Add another row
          </button>
          <p className="mt-3 text-[11px] text-gray-400 dark:text-zinc-500">
            Stored and exported unchanged — {rows.length} row{rows.length === 1 ? '' : 's'} of{' '}
            {allCols.length} columns.
          </p>
        </>
      )}
    </section>,
  );

  return (
    <div>
      {/* Field header */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="min-w-0 truncate text-xs font-semibold capitalize text-gray-700 dark:text-zinc-300">
          {humanize(field.field_name)}
          {isAiTable && <span className="ml-1.5 text-[10px] font-medium text-blue-500 dark:text-blue-400">(AI)</span>}
          <span className="ml-2 text-[10px] font-normal text-gray-400 dark:text-zinc-600">
            {rows.length} row{rows.length === 1 ? '' : 's'}
          </span>
        </p>
        <span className="inline-flex flex-none items-center gap-1.5">
          {onEditGrouping && (
            <GhostButton
              onClick={onEditGrouping}
              title="Change which of these columns repeat"
            >
              Grouping
            </GhostButton>
          )}
          <GhostButton onClick={() => setFlat(true)} title="Edit the stored rows directly">
            <Table2 className="h-3 w-3" /> Flat table
          </GhostButton>
        </span>
      </div>

      {sections.map((node, i) => (
        <div key={i}>
          {i > 0 && <Divider className="my-6" />}
          {node}
        </div>
      ))}
    </div>
  );
}

/**
 * One flat row, reduced to the groups it belongs to plus the values that vary.
 *
 * This used to be a line in a horizontally scrolling grid. Nine columns at a
 * 96px minimum is 900px of table in a pane that is often 500px wide, so every
 * reviewer read the row through a letterbox. As a block with a wrapping grid it
 * costs more height and no horizontal scrolling at all.
 */
function ResultRow({
  field, plan, allCols, row, rowIdx, rows, instances, colorOf,
  onChange, setCell, onRemove, onDuplicate, aiPrefill, errors, saving,
}: {
  field: FormField;
  plan: ReturnType<typeof planTable>;
  allCols: FormField[];
  row: TableRow;
  rowIdx: number;
  rows: TableRow[];
  instances: GroupInstance[][];
  colorOf: (i: number) => string;
  onChange: (rows: TableRow[], remap?: RowRemap) => void;
  setCell: (idx: number, col: string, v: string) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  aiPrefill?: AiTablePrefill;
  errors?: Record<number, Set<string>>;
  saving?: boolean;
}) {
  const hasError = !!errors?.[rowIdx]?.size;
  const filled = allCols.filter(c => norm(row[c.field_name])).length;

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <NumBadge n={rowIdx + 1} color={hasError ? '#dc2626' : ROW_COLOR} size={22} />
        <span className="flex-none text-[11px] font-semibold text-gray-500 dark:text-zinc-400">
          Row {rowIdx + 1}
        </span>
        <CountChip filled={filled} total={allCols.length} error={hasError} />
        <span className="h-px flex-1 bg-gray-100 dark:bg-[#1a1a1a]" />
        <button
          onClick={onDuplicate}
          disabled={saving}
          title="Add a copy of this row at the end of the list"
          className="inline-flex flex-none cursor-pointer items-center gap-1 border-none bg-transparent p-0 text-[11px] text-gray-400 transition-colors hover:text-gray-600 disabled:opacity-40 dark:text-zinc-600 dark:hover:text-zinc-300"
        >
          <Copy className="h-3 w-3" /> duplicate
        </button>
        <button
          onClick={onRemove}
          disabled={saving}
          title="Remove row"
          className="flex-none rounded p-1 text-gray-300 transition-colors hover:text-red-400 disabled:opacity-40 dark:text-zinc-700 dark:hover:text-red-400"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>

      <AutoGrid min={200} gap="gap-x-4 gap-y-3" className="pl-7">
        {/* One cell per key column, not one per group.
            A group identified by two columns used to collapse into a single
            selector reading "HbA1c · 3-4_months", which put two different
            answers behind one label and one heading. Each column now gets its
            own cell, headed by its own name, the way every other column in the
            row is presented. */}
        {plan.groups.flatMap((g, gi) => {
          const list = instances[gi];
          const mine = list.find(inst => inst.rowIndices.includes(rowIdx)) ?? null;
          const color = colorOf(gi);

          /**
           * Changing one cell still picks a whole instance — a row belongs to
           * an arm, not to a loose set of strings, and letting the cells vary
           * independently would let a reviewer describe an arm that was never
           * defined above. Among the instances carrying the chosen value,
           * prefer the one that also agrees with this row's other key cells, so
           * changing `timepoint` does not silently move the row to a different
           * outcome.
           */
          const pick = (colName: string, value: string) => {
            const want = value.toLowerCase();
            const matches = list.filter(inst => norm(inst.keyValues[colName]).toLowerCase() === want);
            if (!matches.length) return;
            const best = matches.find(inst =>
              g.keyCols.every(c => c === colName || !mine
                || norm(inst.keyValues[c]).toLowerCase() === norm(mine.keyValues[c]).toLowerCase()),
            ) ?? matches[0];
            onChange(assignInstance(rows, rowIdx, g, best));
          };

          return g.keyCols.map((colName, ci) => {
            // Distinct values for this column, in the order the instances were
            // first defined — the same ordering the section above shows.
            const seen = new Set<string>();
            const values: string[] = [];
            for (const inst of list) {
              const v = norm(inst.keyValues[colName]);
              const k = v.toLowerCase();
              if (!seen.has(k)) { seen.add(k); values.push(v); }
            }
            const current = mine ? norm(mine.keyValues[colName]) : '';

            return (
              // A single-column group still spans the row: an arm's name is the
              // long one, and a 200px cell truncates it to uselessness.
              <div
                key={`${rowIdx}-${g.name}-${colName}`}
                className="min-w-0"
                style={gi === 0 && g.keyCols.length === 1 ? spanAll : undefined}
              >
                <FieldLabel name={colName} tone="cell" color={color} />
                <select
                  value={current}
                  disabled={saving}
                  onChange={e => pick(colName, e.target.value)}
                  className="h-9 w-full min-w-0 truncate rounded-lg border border-gray-200 bg-white px-2.5 text-[13px] text-gray-800 outline-none transition-colors focus:border-gray-400 dark:border-[#2a2a2a] dark:bg-[#1a1a1a] dark:text-zinc-200 dark:focus:border-[#3f3f3f]"
                  style={{ borderLeft: `3px solid ${color}` }}
                >
                  {values.map((v, i) => (
                    <option key={v || `blank-${i}`} value={v}>
                      {v || `Unnamed ${g.name}`}
                    </option>
                  ))}
                </select>
              </div>
            );
          });
        })}

        {plan.row.map(col => (
          <div key={`${rowIdx}-${col.field_name}`} className="min-w-0">
            <FieldLabel
              name={col.field_name}
              tone="cell"
              required={isRequiredField(col)}
              field={col}
            />
            <Cell
              field={field}
              col={col}
              rowIdx={rowIdx}
              value={row[col.field_name] ?? ''}
              onChange={v => setCell(rowIdx, col.field_name, v)}
              ai={!!aiPrefill?.cells[rowIdx]?.has(col.field_name)}
              error={!!errors?.[rowIdx]?.has(col.field_name)}
              compact
            />
          </div>
        ))}
      </AutoGrid>
    </div>
  );
}

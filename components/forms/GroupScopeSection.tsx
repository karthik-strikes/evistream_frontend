'use client';

import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Spinner } from '@/components/ui';
import { cn } from '@/lib/utils';
import {
  GROUP_PALETTE, ROW_COLOR, SCOPE_ROW, SCOPE_STUDY, STUDY_COLOR,
  groupScope, scopeOf,
} from '@/lib/fieldScopes';

// ── Linked groups — what each column is a property of ──────────────────────
// A table stores one row per combination (arm × scale × timepoint), so most of
// a row's columns repeat a value that belongs to something larger than the row.
// Tagging them lets the reviewer form ask for each value once. The groups are
// this form's own names, not a fixed vocabulary: an outcomes form has arm and
// scale, a harms form has arm and adverse effect, and a form where everything
// varies per row declares none and behaves exactly as it does today.
//
// Nothing here reaches schema_def or a prompt. Tagging is a metadata edit, so
// it changes what a reviewer types and never what the extractor does.
export function GroupScopeSection({
  subformFields,
  groups: storedGroups,
  onSave,
  onSuggest,
  disabled = false,
  saving = false,
}: {
  subformFields: any[];
  groups: string[];
  onSave: (next: { groups: string[]; columnScopes: Record<string, string> }) => void;
  /** Ask the model to propose the tagging. Omitted to hide the button. */
  onSuggest?: () => Promise<{
    groups: string[];
    columns: Array<{ column: string; scope: string; reason: string }>;
    notes: string;
    warnings: string[];
  } | null>;
  disabled?: boolean;
  saving?: boolean;
}) {
  const names: string[] = (subformFields || []).map((sf: any) => sf?.field_name).filter(Boolean);

  const [groups, setGroups] = useState<string[]>(() => storedGroups);
  const [suggesting, setSuggesting] = useState(false);
  // Reasons keyed by column, cleared for any column the reviewer then changes —
  // so an amber marker never explains a choice that is no longer the model's.
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');
  const [issues, setIssues] = useState<string[]>([]);
  const [scopes, setScopes] = useState<Record<string, string>>(() =>
    Object.fromEntries((subformFields || [])
      .filter((sf: any) => sf?.field_name)
      .map((sf: any) => [sf.field_name, scopeOf(sf)])),
  );

  const ml = "text-[11px] font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider";

  if (names.length === 0) return null;

  const colorOf = (g: string) => GROUP_PALETTE[Math.max(0, groups.indexOf(g)) % GROUP_PALETTE.length];
  const scopeDefs = [
    { id: SCOPE_STUDY, label: 'Study', color: STUDY_COLOR },
    ...groups.map(g => ({ id: groupScope(g), label: g, color: colorOf(g) })),
    { id: SCOPE_ROW, label: 'Row', color: ROW_COLOR },
  ];

  const scopeFor = (name: string) => {
    const s = scopes[name] || SCOPE_ROW;
    return scopeDefs.some(d => d.id === s) ? s : SCOPE_ROW;
  };
  const colsIn = (id: string) => names.filter(n => scopeFor(n) === id);
  const nSuggested = names.filter(n => reasons[n]).length;

  const runSuggest = async () => {
    if (!onSuggest) return;
    setSuggesting(true);
    try {
      const res = await onSuggest();
      if (!res) return;
      setGroups(res.groups);
      const nextScopes: Record<string, string> = {};
      const nextReasons: Record<string, string> = {};
      for (const c of res.columns) {
        nextScopes[c.column] = c.scope;
        if (c.reason && c.scope !== SCOPE_ROW) nextReasons[c.column] = c.reason;
      }
      // Columns the answer did not mention keep whatever they had, rather than
      // being silently reset to per-row.
      setScopes(prev => ({ ...prev, ...nextScopes }));
      setReasons(nextReasons);
      setNotes(res.notes || '');
      setIssues(res.warnings || []);
    } finally {
      setSuggesting(false);
    }
  };

  const setScope = (name: string, id: string) => {
    setScopes(prev => ({ ...prev, [name]: id }));
    setReasons(prev => {
      if (!prev[name]) return prev;
      const next = { ...prev }; delete next[name]; return next;
    });
  };

  const addGroup = () => {
    const raw = window.prompt('Group name — what repeats in this form? (e.g. "arm", "scale", "outcome")');
    const name = (raw || '').trim();
    if (!name || groups.includes(name)) return;
    setGroups(prev => [...prev, name]);
  };

  const removeGroup = (g: string) => {
    const affected = colsIn(groupScope(g));
    if (affected.length && !window.confirm(
      `Remove the "${g}" group? Its ${affected.length} column${affected.length === 1 ? '' : 's'} ` +
      `will go back to being entered per row.`,
    )) return;
    setGroups(prev => prev.filter(x => x !== g));
    setScopes(prev => {
      const next = { ...prev };
      for (const n of affected) next[n] = SCOPE_ROW;
      return next;
    });
  };

  const stored = Object.fromEntries((subformFields || [])
    .filter((sf: any) => sf?.field_name)
    .map((sf: any) => [sf.field_name, scopeOf(sf)]));
  const dirty =
    groups.join('|') !== storedGroups.join('|') ||
    names.some(n => scopeFor(n) !== (stored[n] || SCOPE_ROW));

  const shared = names.filter(n => scopeFor(n) !== SCOPE_ROW).length;

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-gray-50/60 dark:border-[#2a2a2a] dark:bg-[#141414]">
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-800 dark:text-zinc-200">What is each column a property of?</p>
            <p className="mt-0.5 text-xs leading-relaxed text-gray-500 dark:text-zinc-400">
              Columns that describe the whole study, or something that repeats across rows, are entered
              once instead of retyped on every row. Leave a column on <b>Row</b> when its value really
              does change from row to row.
            </p>
          </div>
          {onSuggest && (
            <button
              type="button"
              onClick={runSuggest}
              disabled={suggesting || disabled || saving}
              className="flex flex-shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-[#2a2a2a] dark:text-zinc-400 dark:hover:bg-[#1a1a1a]"
            >
              {suggesting ? <Spinner className="h-3 w-3" /> : <Sparkles className="h-3 w-3" />}
              {suggesting ? 'Reading columns…' : nSuggested > 0 ? 'Suggest again' : 'Suggest with AI'}
            </button>
          )}
        </div>
      </div>

      {suggesting && (
        <div className="border-t border-gray-200 px-4 py-2.5 dark:border-[#2a2a2a]">
          <p className="text-[11.5px] leading-relaxed text-gray-500 dark:text-zinc-500">
            Reading all {names.length} columns and working out what each one belongs to. This takes
            up to a minute on a wide table — the answer is cached afterwards, so it is instant next
            time.
          </p>
        </div>
      )}

      {/* Everything the model proposes arrives as a suggestion. Nothing is
          written until Save, so the amber is a reading aid, not a gate. */}
      {!suggesting && (nSuggested > 0 || notes || issues.length > 0) && (
        <div className="border-t border-gray-200 px-4 py-2.5 dark:border-[#2a2a2a]">
          {nSuggested > 0 && (
            <div className="flex items-center gap-2">
              <span className="whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                Suggested
              </span>
              <span className="text-[11.5px] leading-relaxed text-gray-600 dark:text-zinc-400">
                {nSuggested} column{nSuggested === 1 ? '' : 's'} proposed by AI — hover one for the
                reason, change any of them, then save. Nothing is written until you do.
              </span>
            </div>
          )}
          {notes && (
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-gray-500 dark:text-zinc-500">{notes}</p>
          )}
          {issues.map(w => (
            <p key={w} className="mt-1 text-[11.5px] leading-relaxed text-amber-700 dark:text-amber-400">{w}</p>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-gray-200 px-4 py-2.5 dark:border-[#2a2a2a]">
        <p className={ml}>Groups in this form</p>
        {groups.length === 0 && (
          <span className="text-[11px] text-gray-400 dark:text-zinc-500">none yet</span>
        )}
        {groups.map(g => (
          <span
            key={g}
            className="inline-flex items-center gap-1 rounded-full py-[3px] pl-2.5 pr-1 text-[10.5px] font-bold text-white"
            style={{ background: colorOf(g) }}
          >
            {g}
            <button
              type="button"
              onClick={() => removeGroup(g)}
              disabled={disabled || saving}
              title={`Remove the "${g}" group`}
              className="cursor-pointer rounded-full border-none bg-transparent px-1 leading-none text-white/70 hover:text-white disabled:cursor-not-allowed"
            >
              ×
            </button>
          </span>
        ))}
        <button
          type="button"
          onClick={addGroup}
          disabled={disabled || saving}
          className="cursor-pointer rounded-full border border-dashed border-gray-300 bg-white px-2.5 py-[3px] text-[10.5px] font-semibold text-gray-500 hover:border-gray-400 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-[#3a3a3a] dark:bg-[#1a1a1a] dark:text-zinc-400"
        >
          + group
        </button>
      </div>

      <div className="grid gap-4 border-t border-gray-200 px-4 py-3 dark:border-[#2a2a2a] lg:grid-cols-[1.5fr_1fr]">
        {/* Column → scope */}
        <div className="flex flex-col gap-1">
          {(subformFields || []).map((sf: any, i: number) => {
            if (!sf?.field_name) return null;
            const cur = scopeFor(sf.field_name);
            return (
              <div key={sf.field_name || i} className="flex items-center gap-3 rounded-lg px-1 py-1">
                <span
                  title={reasons[sf.field_name] || undefined}
                  className={cn(
                    'min-w-0 flex-1 truncate font-mono text-[11.5px]',
                    reasons[sf.field_name]
                      ? 'text-amber-700 decoration-dotted underline-offset-2 hover:underline dark:text-amber-400'
                      : 'text-gray-700 dark:text-zinc-300',
                  )}
                >
                  {sf.field_name}
                </span>
                <div className="flex flex-shrink-0 overflow-hidden rounded-md border border-gray-200 dark:border-[#2a2a2a]">
                  {scopeDefs.map(d => {
                    const on = cur === d.id;
                    return (
                      <button
                        key={d.id}
                        type="button"
                        disabled={disabled || saving}
                        onClick={() => setScope(sf.field_name, d.id)}
                        className="cursor-pointer border-none px-2.5 py-1 text-[10.5px] font-semibold capitalize transition-colors disabled:cursor-not-allowed"
                        style={{
                          background: on ? d.color : 'transparent',
                          color: on ? '#fff' : undefined,
                        }}
                      >
                        <span className={on ? '' : 'text-gray-400 dark:text-zinc-500'}>{d.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* What the reviewer will be asked for */}
        <div>
          <p className={cn(ml, 'mb-2')}>Reviewer sees</p>
          <div className="flex flex-col gap-1.5">
            {scopeDefs.map(d => {
              const cols = colsIn(d.id);
              const title = d.id === SCOPE_STUDY
                ? 'Study section — once'
                : d.id === SCOPE_ROW
                  ? 'Rows — per data point'
                  : `${d.label} cards — once per ${d.label}`;
              return (
                <div key={d.id} className="rounded-lg border border-gray-200 bg-white px-3 py-2 dark:border-[#2a2a2a] dark:bg-[#111111]">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[11.5px] font-bold capitalize" style={{ color: d.color }}>{title}</span>
                    <span className="flex-shrink-0 text-[10px] tabular-nums text-gray-400 dark:text-zinc-500">
                      {cols.length} field{cols.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[10.5px] leading-relaxed text-gray-500 dark:text-zinc-400">
                    {cols.length ? cols.join(', ') : '—'}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-gray-200 px-4 py-3 dark:border-[#2a2a2a]">
        <p className="text-[11px] leading-relaxed text-gray-500 dark:text-zinc-400">
          {shared === 0
            ? 'Nothing is shared yet, so this table stays a flat row list — exactly as it is today.'
            : `${shared} of ${names.length} columns are entered once instead of on every row.`}
        </p>
        <button
          type="button"
          disabled={!dirty || disabled || saving}
          onClick={() => onSave({ groups, columnScopes: Object.fromEntries(names.map(n => [n, scopeFor(n)])) })}
          className="flex-shrink-0 cursor-pointer rounded-lg border-none bg-gray-900 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-gray-900 dark:hover:bg-white"
        >
          {saving ? 'Saving…' : 'Save grouping'}
        </button>
      </div>
    </div>
  );
}

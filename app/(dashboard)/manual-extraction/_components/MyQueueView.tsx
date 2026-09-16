'use client';

/**
 * My queue — a reviewer's reading list.
 *
 * Rebuilt from the "Manual Extraction Queue" design canvas. The old version was
 * a four-column table (Document · Role · Status · Action) with a stats strip on
 * top: it answered "what am I assigned" but never "what do I open next", which
 * is the only question anyone opens this screen with. So: a resume card, and
 * papers grouped by the role you play on them.
 */

import { useMemo, useState } from 'react';
import {
  ChevronRight, ClipboardList, Scale, Loader2, Check, CircleDot, Search, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Document, Form, FormField, ReviewAssignment } from '@/types/api';
import { ROLE_COLORS } from '@/lib/reviewerColors';
import { groupsOf, scopeOf, SCOPE_ROW } from '@/lib/fieldScopes';
import { isTableField } from '../_lib/fieldKinds';
import { GroupSetupDialog, type GroupingProps } from './GroupSetupDialog';

export type FormState = 'done' | 'partial' | 'todo';

/**
 * Which bucket of `perDocFormStatus` one role's work lives in.
 *
 * Not the role itself. The map is built from the *result rows*, whose
 * `reviewer_role` is a label stamped at save time and stale the moment a seat
 * moves — so keying on it meant a reviewer whose row said `reviewer_2` while
 * their assignment said `reviewer_1` looked up a key that did not exist and
 * saw their own finished forms as "not started". The backend counter
 * (`reviewer_slots.authored_by_holder`) already treats the two reader labels
 * as interchangeable and only `adjudicator` as distinct — the seat is decided
 * by who wrote the row, and nobody can hold both reader seats. This is that
 * same rule, so the strip and the "n of m forms" count cannot disagree.
 */
export const formStatusBucket = (role: string | null | undefined): string =>
  role === 'adjudicator' ? 'adjudicator' : 'reader';

type RoleKey = 'reviewer_1' | 'reviewer_2' | 'adjudicator';

interface MyQueueViewProps {
  assignments: ReviewAssignment[];
  /** Documents that can be opened — processed and ready. */
  documents: Document[];
  /** Every document in the project, ready or not. An assignment whose paper is
   *  still processing used to render as nothing at all, so the stats said
   *  "Assigned 12" above 8 rows with no explanation. */
  allDocuments: Document[];
  /** Project-wide study IDs — see ExtractionView. */
  docLabels: Record<string, string>;
  forms: Form[];
  /** `role:docId` → formId → state, from the current user's own rows. Keyed by
   *  role because this list shows one row per (role, paper). A legacy row saved
   *  with no role at all is filed under `none:docId`. */
  perDocFormStatus: Map<string, Map<string, FormState>>;
  loading: boolean;
  starting: boolean;
  startingKey: string | null; // `${docId}:${formId}` while opening
  /** The role is passed back because the queue is the only place that knows
   *  it: a reviewer holding two roles on one paper gets a row for each. */
  onStartForm: (doc: Document, form: Form, role: string) => void;
  /** The reviewer declaring their own work finished, or reopening it. Nothing
   *  else may set these two statuses — see assignment_service. */
  onSetStatus: (assignment: ReviewAssignment, next: 'completed' | 'in_progress') => void;
  /** Assignment id currently being written, so its row can show a spinner. */
  statusBusyId: string | null;
  onBrowseAll: () => void;
  hasBrowseAll: boolean;
  /** Column grouping setup, when this reviewer may edit forms. Offered here
   *  because the person who knows a column is a property of the study is the
   *  one being asked for it a fourth time. */
  grouping?: GroupingProps;
}

// Role hues come from lib/reviewerColors so R2 is the same purple here as on the
// consensus screen. It used to be emerald, which is also the app's "done" colour.
const ROLE_META: Record<RoleKey, {
  tag: string; pill: string; icon: typeof ClipboardList; title: string; unit: string;
}> = {
  reviewer_1:  { tag: 'R1',  pill: ROLE_COLORS.reviewer_1.pill,  icon: ClipboardList, title: 'Your Reviewer 1 papers', unit: 'to do' },
  reviewer_2:  { tag: 'R2',  pill: ROLE_COLORS.reviewer_2.pill,  icon: ClipboardList, title: 'Your Reviewer 2 papers', unit: 'to do' },
  adjudicator: { tag: 'Adj', pill: ROLE_COLORS.adjudicator.pill, icon: Scale,         title: 'Your consensus papers',   unit: 'waiting' },
};

const ROLE_ORDER: RoleKey[] = ['reviewer_1', 'reviewer_2', 'adjudicator'];

/** Beyond this many forms the per-form strip stops being readable. */
const STRIP_LIMIT = 10;

// ─── Types ────────────────────────────────────────────────────────────────────

interface QueueRow {
  key: string;
  doc: Document;
  role: RoleKey;
  /** The row this came from — what "mark complete" and "reopen" act on. */
  assignment: ReviewAssignment;
  label: string;
  ready: boolean;
  /** Aligned with `forms`. */
  states: FormState[];
  done: number;
  nextForm: Form | null;
  /**
   * `done` means THE REVIEWER SAID SO, not "every form has a row".
   *
   * It used to mean the latter, computed here as `done === forms.length`, and
   * that is the bug this whole screen was reported for: saving the last of
   * four forms moved the paper into Done and out of reach. Saving is not
   * declaring. A paper with every form saved sits here as `active` with the
   * nudge to finish it, until its reviewer says the word.
   */
  status: 'active' | 'pending' | 'done';
}

// ─── Small pieces ─────────────────────────────────────────────────────────────

/**
 * How to name an ungrouped table without stuttering. A field called
 * `interventions` on a form called "Acute Dental Pain — Interventions" read as
 * "Interventions in Acute Dental Pain — Interventions", so the form name is
 * only worth printing when it does not already carry the table's own name.
 */
function tableName(field: FormField, form: Form): { table: string; where: string } {
  const table = field.field_name.replace(/_/g, ' ');
  const squash = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return { table, where: squash(form.form_name).includes(squash(table)) ? '' : ` in ${form.form_name}` };
}

/** One bar per form: saved, partial, not started. */
function FormsStrip({ states, forms }: { states: FormState[]; forms: Form[] }) {
  if (forms.length === 0) {
    return <span className="text-[11px] italic text-gray-300 dark:text-zinc-700">no forms</span>;
  }
  const done = states.filter(s => s === 'done').length;
  if (forms.length > STRIP_LIMIT) {
    const pct = Math.round((done / forms.length) * 100);
    return (
      <span className="flex items-center gap-1.5" aria-label={`${done} of ${forms.length} forms saved`}>
        <span className="relative inline-block w-14 h-1.5 rounded-full bg-gray-200 dark:bg-[#2a2a2a] overflow-hidden">
          <span className="absolute inset-y-0 left-0 rounded-full bg-emerald-500 dark:bg-emerald-400" style={{ width: `${pct}%` }} />
        </span>
        <span className="text-[10.5px] font-medium text-gray-400 dark:text-zinc-500 tabular-nums">{done}/{forms.length}</span>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-[3px]" aria-label={`${done} of ${forms.length} forms saved`}>
      {states.map((s, i) => (
        <span
          key={forms[i]?.id ?? i}
          title={`${forms[i]?.form_name ?? 'Form'} — ${s === 'done' ? 'saved' : s === 'partial' ? 'partial draft' : 'not started'}`}
          className={cn(
            'inline-block w-[5px] h-4 rounded-[2px]',
            s === 'done'    ? 'bg-emerald-500 dark:bg-emerald-400' :
            s === 'partial' ? 'bg-blue-500 dark:bg-blue-400'       :
            'bg-gray-200 dark:bg-[#2a2a2a]',
          )}
        />
      ))}
    </span>
  );
}

function ActionButton({
  label, dark, disabled, busy, onClick, title,
}: {
  label: string; dark: boolean; disabled?: boolean; busy?: boolean; onClick: () => void; title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={e => { e.stopPropagation(); onClick(); }}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-1.5 text-[12px] font-semibold whitespace-nowrap transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
        dark
          ? 'border-gray-900 dark:border-white bg-gray-900 dark:bg-white text-white dark:text-black hover:bg-gray-700 dark:hover:bg-zinc-100'
          : 'border-gray-200 dark:border-[#2a2a2a] bg-white dark:bg-[#111111] text-gray-700 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-[#1a1a1a]',
      )}
    >
      {busy && <Loader2 className="h-3 w-3 animate-spin" />}
      {label}
    </button>
  );
}

function SectionHead({
  tag, pill, title, count, action,
}: {
  tag: string; pill: string; title: string; count: string; action?: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-2 mb-2 px-0.5 flex-wrap">
      <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-semibold', pill)}>{tag}</span>
      <h3 className="text-[14px] font-semibold text-gray-900 dark:text-white">{title}</h3>
      <span className="text-[12px] text-gray-400 dark:text-zinc-500 whitespace-nowrap">{count}</span>
      {action && <span className="ml-auto">{action}</span>}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function MyQueueView({
  assignments,
  documents,
  allDocuments,
  docLabels,
  forms,
  perDocFormStatus,
  loading,
  starting,
  startingKey,
  onStartForm,
  onSetStatus,
  statusBusyId,
  onBrowseAll,
  hasBrowseAll,
  grouping,
}: MyQueueViewProps) {
  const [expanded, setExpanded]   = useState<Set<string>>(new Set());
  const [query, setQuery]         = useState('');
  const [showDone, setShowDone]   = useState(false);
  const [nudgeOff, setNudgeOff]   = useState(false);
  // The form travels with the field: this view offers grouping for tables in
  // any of the project's forms, and the page has no form selected here.
  const [groupingTarget, setGroupingTarget] = useState<{ form: Form; field: FormField } | null>(null);

  /** Every assigned paper, so a row always renders. */
  const docById = useMemo(() => {
    const m = new Map<string, Document>();
    for (const d of allDocuments) m.set(d.id, d);
    return m;
  }, [allDocuments]);

  /** ...and which of them can actually be opened. */
  const readyDocIds = useMemo(() => new Set(documents.map(d => d.id)), [documents]);

  /**
   * One row per (role, paper) — a reviewer who is both R1 and adjudicator on a
   * paper has two jobs on it.
   *
   * The per-form states come from `perDocFormStatus`, which is now keyed by
   * role — so those two rows are scored separately instead of sharing one
   * strip. Rows saved before roles were recorded have none, and fall back to
   * the `none:` bucket rather than disappearing.
   */
  const rows = useMemo<QueueRow[]>(() => {
    const out: QueueRow[] = [];
    for (const a of assignments) {
      if (a.status === 'skipped') continue;
      const role = a.reviewer_role as RoleKey;
      if (!ROLE_META[role]) continue;
      const doc = docById.get(a.document_id);
      if (!doc) continue;
      const byForm = perDocFormStatus.get(`${formStatusBucket(role)}:${a.document_id}`);
      const states = forms.map(f => byForm?.get(f.id) ?? 'todo');
      const done = states.filter(s => s === 'done').length;
      const nextIdx = states.findIndex(s => s !== 'done');
      out.push({
        key: `${role}:${a.document_id}`,
        doc, role,
        assignment: a,
        label: docLabels[doc.id] ?? doc.filename,
        ready: readyDocIds.has(doc.id),
        states, done,
        nextForm: nextIdx >= 0 ? forms[nextIdx] : null,
        status: a.status === 'completed' ? 'done'
          : states.some(s => s !== 'todo') ? 'active'
          : 'pending',
      });
    }
    return out;
  }, [assignments, docById, readyDocIds, docLabels, forms, perDocFormStatus]);

  const q = query.trim().toLowerCase();
  const matches = (r: QueueRow) => !q || r.label.toLowerCase().includes(q);

  /** Rank: what is half-finished first, then untouched, then what can't be opened. */
  const rank = (r: QueueRow) => (r.ready ? 0 : 2) + (r.status === 'active' ? 0 : 1);
  const sortRows = (list: QueueRow[]) =>
    [...list].sort((x, y) => rank(x) - rank(y) || x.label.localeCompare(y.label));

  const openRows = useMemo(() => rows.filter(r => r.status !== 'done'), [rows]);
  const doneRows = useMemo(
    () => rows.filter(r => r.status === 'done').sort((x, y) => x.label.localeCompare(y.label)),
    [rows],
  );

  /** The one thing to open next: a paper already under way, else the first untouched one. */
  const hero = useMemo(() => {
    const openable = sortRows(openRows.filter(r => r.ready && r.nextForm));
    return openable[0] ?? null;
  }, [openRows]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Tables whose columns are all per-row, i.e. the reviewer retypes the study's
   * shared values on every row. Worth one nudge, not a banner on every paper.
   */
  const ungrouped = useMemo(() => {
    if (!grouping) return [];
    const out: { form: Form; field: FormField }[] = [];
    for (const f of forms) {
      for (const field of (f.fields ?? []).filter(isTableField)) {
        const cols = field.subform_fields ?? [];
        if (cols.length < 3) continue;                        // nothing to group
        const shared = cols.filter(c => scopeOf(c) !== SCOPE_ROW).length;
        if (shared === 0 && groupsOf(field).length === 0) out.push({ form: f, field });
      }
    }
    return out;
  }, [forms, grouping]);

  const startRow = (r: QueueRow) => {
    const form = r.nextForm ?? forms[0];
    if (!form) return;
    onStartForm(r.doc, form, r.role);
  };

  const toggle = (key: string) =>
    setExpanded(prev => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key); else n.add(key);
      return n;
    });

  // ── Loading / empty ───────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-[#1f1f1f] bg-white dark:bg-[#111111] p-12 flex items-center justify-center text-gray-400 gap-2">
        <Loader2 size={16} className="animate-spin" />
        <span className="text-sm">Loading your queue…</span>
      </div>
    );
  }

  if (assignments.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-[#1f1f1f] bg-white dark:bg-[#111111] py-16 text-center">
        <div className="w-12 h-12 rounded-xl bg-gray-100 dark:bg-[#1a1a1a] flex items-center justify-center mx-auto mb-3">
          <ClipboardList size={20} className="text-gray-300 dark:text-zinc-600" />
        </div>
        <div className="text-sm font-semibold text-gray-900 dark:text-white mb-1">Nothing assigned to you yet</div>
        <div className="text-xs text-gray-400 dark:text-zinc-600 mb-4">
          Ask whoever runs this project to allocate you some papers — or open any document yourself.
        </div>
        {hasBrowseAll && (
          <button
            onClick={onBrowseAll}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-white dark:text-gray-900 bg-gray-900 dark:bg-white rounded-lg px-3 py-1.5 hover:opacity-90 transition-opacity"
          >
            Browse all documents
          </button>
        )}
      </div>
    );
  }

  // ── Sections ──────────────────────────────────────────────────────────────

  const paperSections = ROLE_ORDER.map(role => {
    const meta = ROLE_META[role];
    const list = sortRows(openRows.filter(r => r.role === role && matches(r)));
    return { key: role, tag: meta.tag, pill: meta.pill, title: meta.title, rows: list, unit: meta.unit };
  }).filter(s => s.rows.length > 0);

  return (
    // One rhythm for the whole screen. This wrapper used to be space-y-1
    // while the blocks inside carried mt-2 / mt-5 / pt-4 of their own —
    // Tailwind's space-y utility wins, so those margins were dead and the
    // resume card sat 4px from the hint below it.
    <div className="space-y-4">
      {grouping && (
        <GroupSetupDialog
          field={groupingTarget?.field ?? null}
          onClose={() => setGroupingTarget(null)}
          saving={!!groupingTarget && grouping.savingField === `${groupingTarget.form.id}:${groupingTarget.field.field_name}`}
          onSave={async (name, next) => {
            if (!groupingTarget) return false;
            const ok = await grouping.onSave(groupingTarget.form.id, name, next);
            if (ok) setGroupingTarget(null);
            return ok;
          }}
          onSuggest={name => groupingTarget ? grouping.onSuggest(groupingTarget.form.id, name) : Promise.resolve(null)}
        />
      )}

      {/* ── Pick up where you left off ─────────────────────────────────────── */}
      {hero && (
        <section className="rounded-xl bg-gray-900 dark:bg-[#0d0d0d] dark:border dark:border-[#1f1f1f] px-5 py-4 flex items-center justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-gray-400 dark:text-zinc-500">
              Pick up where you left off
            </p>
            <p className="text-[15px] font-semibold text-white mt-1">
              {hero.label} <span className="text-gray-500">·</span>{' '}
              <span className="text-blue-300 dark:text-blue-400">{hero.nextForm?.form_name}</span>
            </p>
            <p className="text-[12px] text-gray-400 dark:text-zinc-500 mt-0.5">
              <span className="tabular-nums">{hero.done}</span> of <span className="tabular-nums">{forms.length}</span> forms saved
              {' · '}{ROLE_META[hero.role].tag}
              {' · '}
              {hero.nextForm && (
                perDocFormStatus.get(`${formStatusBucket(hero.role)}:${hero.doc.id}`)
              )?.get(hero.nextForm.id) === 'partial'
                ? 'partial draft waiting'
                : 'not started yet'}
            </p>
          </div>
          <ActionButton
            label="Resume →"
            dark={false}
            busy={starting && startingKey === `${hero.doc.id}:${hero.nextForm?.id}`}
            disabled={starting}
            onClick={() => startRow(hero)}
          />
        </section>
      )}

      {/* ── Search ─────────────────────────────────────────────────────────── */}
      {/* No progress bar and no by-paper/by-form switch: across a real queue the
          bar is a full-width grey line reading 0-something percent, and the
          sections below already say what is left, per role. */}
      {rows.length > 4 && (
        // Left-aligned, with the section heads and rows it filters. Pinned to
        // the right edge it read as a control floating in an empty band.
        <div className="flex items-center px-0.5">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 dark:text-zinc-500" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search papers…"
              className="h-7 w-40 pl-7 pr-6 text-[12px] rounded-lg border border-gray-200 dark:border-[#2a2a2a] bg-white dark:bg-[#111111] text-gray-700 dark:text-zinc-300 placeholder-gray-400 dark:placeholder-zinc-600 outline-none focus:border-gray-400 dark:focus:border-[#3f3f3f]"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-300 dark:text-zinc-600 hover:text-gray-500"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Grouping hint ──────────────────────────────────────────────────── */}
      {/* A line, not a card. As a bordered white panel it weighed the same as
          the paper cards below it and its filled button competed with the
          resume card's, directly above. The link idiom is the app's
          (documents/page.tsx) and the words are the Column-grouping panel's
          (SelectionView). */}
      {grouping && !nudgeOff && ungrouped.length > 0 && rows.length > 1 && (() => {
        const { table, where } = tableName(ungrouped[0].field, ungrouped[0].form);
        return (
          <div className="flex items-center gap-2 px-0.5 py-1">
            <p className="text-[12.5px] text-gray-500 dark:text-zinc-500 min-w-0">
              <span className="font-semibold capitalize text-gray-700 dark:text-zinc-300">{table}</span>
              {where} repeats the same values on every row
              {/* Say how many there are. Naming only the first read as "this is
                  the one table with the problem", and the rest are reachable
                  only from the form picker. */}
              {ungrouped.length > 1 && (
                <>, and so {ungrouped.length === 2 ? 'does 1 other table' : `do ${ungrouped.length - 1} other tables`}</>
              )}.{' '}
              <button
                type="button"
                title="Set up once per form — it applies to every paper"
                onClick={() => setGroupingTarget(ungrouped[0])}
                className="font-semibold text-blue-600 underline underline-offset-2 hover:no-underline dark:text-blue-400"
              >
                Set up grouping →
              </button>
            </p>
            {/* Beside the sentence, not pushed to the far edge — at this width
                ml-auto left it stranded in empty space. */}
            <button
              type="button"
              title="Dismiss"
              onClick={() => setNudgeOff(true)}
              className="flex-shrink-0 p-1 text-gray-300 hover:text-gray-500 dark:text-zinc-600 dark:hover:text-zinc-400"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        );
      })()}

      {/* ── One section per role ───────────────────────────────────────────── */}
      {paperSections.map(sec => (
        <div key={sec.key}>
          <SectionHead
            tag={sec.tag} pill={sec.pill} title={sec.title}
            count={`${sec.rows.length} ${sec.unit}`}
          />
          <section className="rounded-xl border border-gray-200 dark:border-[#1f1f1f] bg-white dark:bg-[#111111] overflow-hidden">
            {sec.rows.map((r, i) => (
              <QueueRowView
                key={r.key}
                row={r}
                forms={forms}
                first={i === 0}
                expanded={expanded.has(r.key)}
                starting={starting}
                startingKey={startingKey}
                statusBusy={statusBusyId === r.assignment.id}
                onToggle={() => toggle(r.key)}
                onStart={() => startRow(r)}
                onStartForm={(form) => onStartForm(r.doc, form, r.role)}
                onSetStatus={next => onSetStatus(r.assignment, next)}
              />
            ))}
          </section>
        </div>
      ))}

      {/* ── Nothing left in view ───────────────────────────────────────────── */}
      {paperSections.length === 0 && (
        <div className="rounded-xl border border-gray-200 dark:border-[#1f1f1f] bg-white dark:bg-[#111111] py-12 text-center mt-4">
          <div className="text-sm font-semibold text-gray-900 dark:text-white mb-1">
            {q ? 'No papers match that search' : 'Everything assigned to you is marked complete'}
          </div>
          <div className="text-xs text-gray-400 dark:text-zinc-600">
            {q ? 'Clear the search to see the rest of your queue.' : 'They are listed under Done below — reopen any of them to edit.'}
          </div>
        </div>
      )}

      {/* ── Done ───────────────────────────────────────────────────────────── */}
      {doneRows.length > 0 && (
        <div>
        <button
          type="button"
          onClick={() => setShowDone(s => !s)}
          className="flex items-center gap-2 mb-2 px-0.5 group"
        >
          <ChevronRight className={cn('w-3 h-3 text-gray-400 transition-transform', showDone && 'rotate-90')} />
          <h3 className="text-[14px] font-semibold text-gray-500 dark:text-zinc-400 group-hover:text-gray-700 dark:group-hover:text-zinc-200">Done</h3>
          <span className="text-[12px] text-gray-400 dark:text-zinc-500 whitespace-nowrap tabular-nums">
            {doneRows.length} paper{doneRows.length !== 1 ? 's' : ''}
          </span>
          <span className="text-[11.5px] text-gray-400 dark:text-zinc-600 whitespace-nowrap">
            — you marked these finished; Reopen to edit
          </span>
        </button>
        {showDone && (
          <section className="rounded-xl border border-gray-200 dark:border-[#1f1f1f] bg-white dark:bg-[#111111] overflow-hidden">
            {/* The same row as an unfinished paper, deliberately. This used to
                be a flat line whose one button opened `forms[0]` — so the
                moment the last form was saved, the paper's other forms became
                unreachable: no expander, no per-form list, and a reviewer with
                a queue has no "Browse all" tab to get back in by. Saving work
                must never be the thing that hides it. */}
            {doneRows.map((r, i) => (
              <QueueRowView
                key={r.key}
                row={r}
                forms={forms}
                first={i === 0}
                expanded={expanded.has(r.key)}
                starting={starting}
                startingKey={startingKey}
                statusBusy={statusBusyId === r.assignment.id}
                onToggle={() => toggle(r.key)}
                onStart={() => startRow(r)}
                onStartForm={(form) => onStartForm(r.doc, form, r.role)}
                onSetStatus={next => onSetStatus(r.assignment, next)}
              />
            ))}
          </section>
        )}
        </div>
      )}
    </div>
  );
}

// ─── One paper row ────────────────────────────────────────────────────────────

function QueueRowView({
  row, forms, first, expanded, starting, startingKey, statusBusy,
  onToggle, onStart, onStartForm, onSetStatus,
}: {
  row: QueueRow;
  forms: Form[];
  first: boolean;
  expanded: boolean;
  starting: boolean;
  startingKey: string | null;
  statusBusy: boolean;
  onToggle: () => void;
  onStart: () => void;
  onStartForm: (form: Form) => void;
  onSetStatus: (next: 'completed' | 'in_progress') => void;
}) {
  const isAdj = row.role === 'adjudicator';
  const action = row.status === 'done' ? 'Review →'
    : isAdj ? 'Adjudicate →'
    : row.status === 'active' ? 'Continue →'
    : 'Start →';
  const dark = row.status === 'active';
  const allSaved = forms.length > 0 && row.done === forms.length;

  /** Marking a paper finished with forms still unsaved is allowed — it is the
   *  reviewer's judgement, and a paper can be finished with nothing to record
   *  on one of its forms. It is worth one question, though, because the usual
   *  reason is not having noticed. */
  const declare = () => {
    if (!allSaved) {
      const left = forms.length - row.done;
      const ok = window.confirm(
        `${left} of ${forms.length} form${forms.length === 1 ? '' : 's'} `
        + `${left === 1 ? 'has' : 'have'} nothing saved for ${row.label}. `
        + 'Mark the paper finished anyway?',
      );
      if (!ok) return;
    }
    onSetStatus('completed');
  };

  return (
    <div className={cn(!first && 'border-t border-gray-100 dark:border-[#1a1a1a]')}>
      <div
        onClick={onToggle}
        className="grid gap-3.5 items-center px-4 py-2.5 cursor-pointer hover:bg-gray-50/70 dark:hover:bg-[#0d0d0d]/70 transition-colors"
        style={{ gridTemplateColumns: '1fr auto auto auto auto' }}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[13.5px] font-semibold text-gray-900 dark:text-white truncate" title={row.doc.filename}>
              {row.label}
            </span>
            {!row.ready && (
              <span
                title="Still being processed — cannot be opened yet"
                className="flex-shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-700 bg-amber-50 border border-amber-200 dark:text-amber-400 dark:bg-amber-900/20 dark:border-amber-800/40"
              >
                processing
              </span>
            )}
          </div>
          <div className="text-[11.5px] text-gray-400 dark:text-zinc-500">
            {forms.length === 0
              ? 'no active forms in this project'
              : <>
                  <span className="tabular-nums">{row.done}</span> of <span className="tabular-nums">{forms.length}</span> forms
                  {row.nextForm && <> · next: {row.nextForm.form_name}</>}
                  {/* The only thing left to do is say so. Without this line a
                      paper with every form saved looks identical to one still
                      half-done, and nothing on screen asks for the one act
                      that moves it. */}
                  {allSaved && row.status !== 'done' && (
                    <> · <span className="font-medium text-emerald-600 dark:text-emerald-400">all saved</span> — mark it complete when you are</>
                  )}
                </>}
          </div>
        </div>

        <FormsStrip states={row.states} forms={forms} />

        <ActionButton
          label={action}
          dark={dark}
          busy={starting && startingKey === `${row.doc.id}:${row.nextForm?.id}`}
          disabled={starting || !row.ready || forms.length === 0}
          title={row.ready ? undefined : 'This paper is still being processed'}
          onClick={onStart}
        />

        {/* The reviewer's own switch. Both directions are theirs: nothing else
            in the system may set or clear `completed` any more. */}
        <ActionButton
          label={row.status === 'done' ? 'Reopen' : 'Mark complete'}
          dark={false}
          busy={statusBusy}
          disabled={statusBusy}
          title={row.status === 'done'
            ? 'Put this paper back on your list so you can keep editing it'
            : 'Say you are finished with this paper. You can reopen it later.'}
          onClick={() => (row.status === 'done' ? onSetStatus('in_progress') : declare())}
        />

        <ChevronRight className={cn('w-3.5 h-3.5 text-gray-400 transition-transform flex-shrink-0', expanded && 'rotate-90')} />
      </div>

      {expanded && (
        <div className="bg-gray-50/70 dark:bg-[#0d0d0d] border-t border-gray-100 dark:border-[#1a1a1a] px-4 py-1.5">
          {!row.ready ? (
            <p className="text-xs italic text-amber-700 dark:text-amber-400 py-2 px-1">
              This paper is still being processed — extraction opens once it finishes.
            </p>
          ) : forms.length === 0 ? (
            <p className="text-xs italic text-gray-400 dark:text-zinc-500 py-2 px-1">No active forms in this project.</p>
          ) : forms.map((f, i) => {
            const state = row.states[i];
            const busy = starting && startingKey === `${row.doc.id}:${f.id}`;
            return (
              <button
                key={f.id}
                disabled={starting}
                onClick={e => { e.stopPropagation(); onStartForm(f); }}
                className="group w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-white dark:hover:bg-[#1a1a1a] transition-colors disabled:opacity-60 disabled:cursor-wait text-left"
              >
                {state === 'done' ? (
                  <span className="w-4 h-4 rounded-full bg-emerald-500 flex items-center justify-center shrink-0">
                    <Check size={9} className="text-white" strokeWidth={3} />
                  </span>
                ) : state === 'partial' ? (
                  <span className="w-4 h-4 rounded-full bg-blue-100 dark:bg-blue-400/15 border border-blue-300 dark:border-blue-500/40 flex items-center justify-center shrink-0">
                    <CircleDot size={9} className="text-blue-600 dark:text-blue-400" />
                  </span>
                ) : (
                  <span className="w-4 h-4 rounded-full border border-gray-300 dark:border-[#2a2a2a] shrink-0" />
                )}
                <span className="text-[12.5px] font-medium text-gray-700 dark:text-zinc-300 truncate flex-1 min-w-0">
                  {f.form_name}
                </span>
                {state !== 'todo' && (
                  <span className={cn(
                    'text-[10.5px] font-semibold uppercase tracking-[0.05em]',
                    state === 'done' ? 'text-emerald-600 dark:text-emerald-400' : 'text-blue-600 dark:text-blue-400',
                  )}>
                    {state === 'done' ? 'saved' : 'partial'}
                  </span>
                )}
                <span className="text-xs font-medium text-gray-400 dark:text-zinc-600 group-hover:text-gray-700 dark:group-hover:text-zinc-300 transition-colors shrink-0">
                  {busy ? <Loader2 size={12} className="animate-spin" /> : '→'}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

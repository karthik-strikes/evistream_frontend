'use client';

/**
 * What a review manager decides before anyone assesses anything.
 *
 * Everything on this screen is a **proposal awaiting a person**. The page this
 * replaces made the same derivation invisibly on every render — which outcome
 * form names the results, which column holds the outcome, which arm is the
 * comparator — and was wrong on every project in the corpus: it read
 * `outcome_type` as the outcome when that column holds "Adverse effects", and
 * read an arm column as a comparison, collapsing a five-arm trial to one target.
 *
 * So the derivation is shown before it is real. Nothing on this screen has been
 * written to the database until **Create these results** is pressed, and each
 * fold says how many things inside it still need a human decision.
 */

import { useState } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import type {
  RobBuildResponse, RobContrast, RobExcludedForm, RobFormMapping, RobResultCandidate,
} from '@/services/rob.service';
import { contrastLabel } from '../_lib/robIdentity';

interface Props {
  build: RobBuildResponse | null;
  loading: boolean;
  canManage: boolean;
  committing: boolean;
  onCommit: () => void;
  onOpenMapping: (formId: string) => void;
  onToggleSource: (formId: string, use: boolean | null) => void;
  /** A manager's comparison decisions per study, applied when results are created. */
  contrastEdits: Record<string, ContrastEdit[]>;
  onEditContrast: (documentId: string, edits: ContrastEdit[] | null) => void;
  /** document id → study label, so a comparison names a paper not a uuid. */
  /** Comparisons are a fact about a study, so they are edited from its queue row. */
  /** Form ids whose source flag is being written right now. */
  pendingSources: Set<string>;
  /** How many results the registry already holds — "new" is meaningless alone. */
  existingCount: number;
  onOpenQueue: () => void;
}

function Fold({ title, summary, tone, children, defaultOpen }: {
  title: string;
  summary: string;
  /** `warn` marks a section holding a decision nobody has taken. */
  tone?: 'warn';
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className={[
      'border rounded-xl bg-white dark:bg-[#111111] overflow-hidden',
      tone === 'warn'
        ? 'border-gray-200 dark:border-[#2a2a2a]'
        : 'border-gray-200 dark:border-[#1f1f1f]',
    ].join(' ')}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-[#141414]"
      >
        <ChevronDown className={`h-3.5 w-3.5 flex-shrink-0 text-gray-400 dark:text-zinc-600 transition-transform ${open ? '' : '-rotate-90'}`} />
        <span className="text-[13.5px] font-semibold dark:text-white">{title}</span>
        <span className="flex-1" />
        <span className={[
          'text-[11.5px] font-medium',
          tone === 'warn'
            ? 'text-gray-600 dark:text-zinc-400'
            : 'text-gray-500 dark:text-zinc-500',
        ].join(' ')}>
          {summary}
        </span>
      </button>
      {open && <div className="px-4 pb-4 pt-1 border-t border-gray-100 dark:border-[#1a1a1a]">{children}</div>}
    </div>
  );
}

/**
 * One outcome form, as the prototype draws it.
 *
 * Issues are **counted into a pill, not printed**. An earlier version listed
 * every mapping warning here as a full sentence — five paragraphs of warning prose
 * per form, on a screen whose job is to let somebody see at a glance what still
 * needs them. The warnings are not deleted; they live on the mapping screen,
 * next to the column each one is about, where they can actually be acted on.
 */
/**
 * Whether a form's rows are a source of results. Step one, and only that.
 *
 * The mapping half used to live on this same row, which made one control do two
 * jobs: deciding a form counts, and checking what its columns mean. They happen
 * at different times — you pick the sources once and then work through the
 * mappings — so they are two steps.
 */
function SourceRow({ form, excluded, pending, onToggle }: {
  form?: RobFormMapping;
  excluded?: RobExcludedForm;
  pending: boolean;
  onToggle: (use: boolean | null) => void;
}) {
  const used = !!form;
  const name = form?.form_name ?? excluded?.form_name ?? '';

  return (
    <label className={[
      'flex items-start gap-3 rounded-xl border px-3 py-2.5 mt-2 cursor-pointer transition-colors',
      used
        ? 'border-gray-200 hover:bg-gray-50 dark:border-[#242424] dark:hover:bg-[#141414]'
        : 'border-dashed border-gray-200 dark:border-[#242424] opacity-70',
    ].join(' ')}>
      <input
        type="checkbox"
        checked={used}
        disabled={pending}
        aria-label={`Use ${name} as a source of results`}
        onChange={e => onToggle(e.target.checked)}
        className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 accent-gray-900 dark:accent-white"
      />

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 flex-wrap">
          <span className="text-[13px] font-semibold dark:text-white">{name}</span>
          {pending && <Loader2 className="h-3 w-3 animate-spin text-gray-400" />}
        </span>

        {used && form && (
          <>
            <span className="block text-[11.5px] text-gray-500 dark:text-zinc-500 mt-0.5">
              {form.extractions} extraction{form.extractions === 1 ? '' : 's'} · table {form.table}
            </span>
            <span className="block font-mono text-[10.5px] text-gray-400 dark:text-zinc-600 mt-1 break-words">
              {form.columns.join(' · ')}
            </span>
          </>
        )}

        {excluded && (
          <span className="block text-[11.5px] text-gray-500 dark:text-zinc-500 mt-0.5 leading-relaxed">
            Not used — {excluded.reason}
          </span>
        )}
      </span>

      {!used && !excluded?.explicit && (
        <button
          type="button"
          onClick={e => { e.preventDefault(); e.stopPropagation(); onToggle(null); }}
          className="flex-none text-[11.5px] font-semibold rounded-lg border border-gray-200 dark:border-[#2a2a2a] px-2.5 py-1 text-gray-500 dark:text-zinc-500 hover:bg-gray-50 dark:hover:bg-[#1a1a1a]"
        >
          Automatic
        </button>
      )}
    </label>
  );
}

/**
 * Step two: what this form's columns mean, and whether anybody has checked.
 *
 * One box per SELECTED form, because the mapping is per form — two outcome
 * tables in one project name their columns differently, and confirming one
 * says nothing about the other.
 */
function MappingRow({ form, onOpenMapping }: {
  form: RobFormMapping;
  onOpenMapping: () => void;
}) {
  const blocking = (form.warnings ?? []).filter(w => w.severity === 'blocking').length;
  const issues = (form.warnings ?? []).filter(
    w => w.severity === 'blocking' || w.severity === 'needs_review').length;
  const confirmed = !!form.confirmed && blocking === 0;

  return (
    <div className="flex items-start gap-3 flex-wrap rounded-xl border border-gray-200 dark:border-[#242424] px-3 py-2.5 mt-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[13px] font-semibold dark:text-white">{form.form_name}</span>
          {/* The shared badge, and its rule: colour encodes required human
              action (`components/ui/badge.tsx`). A broken mapping must be
              fixed — `critical`. One that needs a person to look and decide —
              `attention`. A confirmed one is "done", which that rule keeps
              deliberately quiet, so it is `neutral` rather than green: on a
              finished project every row would otherwise be a wall of ticks. */}
          <Badge variant={blocking ? 'critical' : confirmed ? 'neutral' : 'attention'}>
            {/* `blocking` is a COUNT. `{blocking && …}` renders a literal 0
                when it is zero — the badge read "01 issue to check" on the
                live site. Coerce before the guard. */}
            {blocking > 0 && <span aria-hidden>×</span>}
            {confirmed && <span aria-hidden>✓</span>}
            {blocking
              ? `${blocking} must be fixed`
              : confirmed ? 'Mapping confirmed'
                : issues ? `${issues} ${issues === 1 ? 'issue' : 'issues'} to check`
                  : 'Needs confirming'}
          </Badge>
        </div>
        <div className="text-[11.5px] text-gray-500 dark:text-zinc-500 mt-0.5">
          {form.extractions} extraction{form.extractions === 1 ? '' : 's'} · table {form.table}
          {' · '}{form.columns.length} column{form.columns.length === 1 ? '' : 's'}
        </div>
      </div>
      <button
        type="button"
        onClick={onOpenMapping}
        className="flex-none text-[11.5px] font-semibold rounded-lg border border-gray-200 dark:border-[#2a2a2a] px-2.5 py-1 text-gray-600 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-[#1a1a1a]"
      >
        {/* Both states open the mapping screen, so both carry the arrow. It
            marks where the button goes, not how far along the form is. */}
        {confirmed ? 'Review mapping →' : 'Confirm mapping →'}
      </button>
    </div>
  );
}

/** A comparison a manager declared for one study, before anything is created. */
export interface ContrastEdit {
  intervention: string;
  comparator: string;
}

export function SetupScreen({
  build, loading, canManage, committing, onCommit,
  onOpenMapping, onToggleSource, pendingSources, contrastEdits, onEditContrast,
  existingCount, onOpenQueue,
}: Props) {
  const results: RobResultCandidate[] = build?.results ?? [];
  const contrasts = build?.contrasts ?? [];
  const held = results.filter(r => r.state === 'held');
  const unresolved = contrasts.filter(c => c.state === 'unresolved');
  const proposed = contrasts.filter(c => c.state === 'proposed');
  const duplicates = build?.duplicates ?? [];
  // Every SELECTED form has to be confirmed before results can be created — but
  // an unselected form blocks nothing, because it contributes nothing.
  const needsMapping = (build?.forms ?? []).filter(
    f => !f.confirmed
      || (f.warnings ?? []).some(w => w.severity === 'blocking'));
  const studies = new Set(results.map(r => r.document_id)).size;

  // What a fold's one-line summary says. When something in it needs a decision
  // the summary NAMES that thing; otherwise it states a fact. A generic count
  // beside every heading tells a manager nothing about where to look.
  const sourceSummary = `${build?.forms.length ?? 0} outcome form`
    + `${build?.forms.length === 1 ? '' : 's'} · `
    + `${(build?.forms ?? []).reduce((n, f) => n + f.extractions, 0)} extractions`;
  const mappingSummary = needsMapping.length
    ? `${needsMapping.length} form${needsMapping.length === 1 ? '' : 's'} to confirm`
    : `${build?.forms.length ?? 0} confirmed`;
  // A study is settled when it has at least one comparison — derived or declared.
  const unsettled = contrasts.filter(
    c => !c.intervention && !(contrastEdits[c.document_id] ?? []).length);
  const duplicateSummary = duplicates.length
    ? `${duplicates.length} pair${duplicates.length === 1 ? '' : 's'} held out of the queue until you decide`
    : 'none outstanding';

  // Counted only for things that still have a SECTION below to open. Studies
  // with no comparison are settled in the queue now, not here.
  const needs = [needsMapping.length > 0, duplicates.length > 0].filter(Boolean).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="border border-gray-200 rounded-xl bg-white dark:bg-[#111111] dark:border-[#1f1f1f] px-4 py-4">
        <div className="flex items-start gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <h1 className="text-[17px] font-bold tracking-tight dark:text-white">
              Project setup
            </h1>
            <p className="text-[12.5px] text-gray-600 dark:text-zinc-400 mt-1 leading-relaxed max-w-[76ch]">
              <strong className="font-semibold dark:text-white">
                {results.length} result{results.length === 1 ? '' : 's'} across {studies} stud
                {studies === 1 ? 'y' : 'ies'} {results.length ? 'ready to create' : 'derived'}.
              </strong>{' '}
              {/* Without this, "12 results ready to create" reads as the size of
                  the project rather than as what this press would add. */}
              <span className="text-gray-500 dark:text-zinc-500">
                {existingCount} already in the queue.
              </span>{' '}

              {needs
                ? <>{needs} section{needs === 1 ? '' : 's'} still {needs === 1 ? 'has' : 'have'} something
                  to settle — marked below. The rest was decided automatically; open a section only to
                  check or change it.</>
                : <>Everything was decided automatically. Open a section only to check or change it.</>}
            </p>
          </div>
        </div>
      </div>

      {/* Why Create is disabled, and what is missing from the count beside it.
          Both used to be invisible: the mapping requirement lived only in the
          disabled button's `title`, which never appears on a touch device and
          is not read out, and the held rows were computed here and rendered
          nowhere at all. */}
      {needsMapping.length > 0 && (
        <div className="flex items-start gap-2.5 border border-gray-200 dark:border-[#2a2a2a] bg-gray-50 dark:bg-gray-500/5 rounded-xl px-3 py-2.5 text-[12.5px] text-gray-700 dark:text-zinc-300">
          <span className="min-w-0 flex-1">
            <strong className="font-semibold">Mapping needed:</strong>{' '}
            {needsMapping.map(f => f.form_name).join(', ')}. Every selected form has to be
            confirmed before results can be created.
          </span>
          <button
            type="button"
            onClick={() => onOpenMapping(needsMapping[0].form_id)}
            className="flex-none text-[11.5px] font-semibold rounded-lg border border-gray-200 dark:border-[#2a2a2a] px-2.5 py-1 hover:bg-gray-50 dark:hover:bg-[#1a1a1a]"
          >
            Check {needsMapping.length === 1 ? 'it' : 'the first'} →
          </button>
        </div>
      )}

      {held.length > 0 && (
        <div className="flex items-start gap-2.5 border border-gray-200 dark:border-[#242424] bg-gray-50 dark:bg-[#0d0d0d] rounded-xl px-3 py-2.5 text-[12.5px] text-gray-600 dark:text-zinc-400">
          <span className="min-w-0 flex-1">
            <strong className="font-semibold dark:text-zinc-200">
              {held.length} further candidate row{held.length === 1 ? '' : 's'} held.
            </strong>{' '}
            {unresolved.length
              ? <>They are waiting on a study comparison; the queue lists them under
                &ldquo;Comparison needed&rdquo;.</>
              : <>They are waiting on a decision and are listed in the queue.</>}{' '}
            Creating now adds the rest and leaves these where they are.
          </span>
          <button
            type="button"
            onClick={onOpenQueue}
            className="flex-none text-[11.5px] font-semibold rounded-lg border border-gray-200 dark:border-[#2a2a2a] px-2.5 py-1 hover:bg-gray-50 dark:hover:bg-[#1a1a1a]"
          >
            See them →
          </button>
        </div>
      )}

      <Fold
        title="Instrument"
        summary="RoB 2 · parallel group · 22 Aug 2019"
      >
        <p className="text-[12.5px] text-gray-600 dark:text-zinc-400 leading-relaxed mt-2">
          22 signalling questions across 5 domains. Recorded on every assessment. One assessment per
          result — RoB 2 requires it, so it is not offered as a choice.
        </p>
        <p className="text-[12px] text-gray-500 dark:text-zinc-500 leading-relaxed mt-2">
          Cluster-randomised and crossover trials use different question sets, not renamed ones, and
          are not implemented. ROBINS-I and RoB 1 forms still open, with their saved judgements read
          correctly, but neither has signalling questions.
        </p>
      </Fold>

      <Fold
        title="Choose extraction sources"
        summary={sourceSummary}
        defaultOpen
      >
        <p className="text-[12.5px] text-gray-500 dark:text-zinc-500 leading-relaxed mt-2">
          Every outcome form that names results is used, not the first one that matches a pattern.
          Untick a form whose rows are a second copy of another&rsquo;s. Unticking blocks nothing —
          an unselected form simply contributes no candidates, and assessments already made are
          kept either way.
        </p>
        {(build?.forms ?? []).map(form => (
          <SourceRow
            key={form.form_id}
            form={form}
            pending={pendingSources.has(form.form_id)}
            onToggle={use => onToggleSource(form.form_id, use)}
          />
        ))}
        {(build?.excluded ?? []).map(excluded => (
          <SourceRow
            key={excluded.form_id}
            excluded={excluded}
            pending={pendingSources.has(excluded.form_id)}
            onToggle={use => onToggleSource(excluded.form_id, use)}
          />
        ))}
      </Fold>

      <Fold
        title="Check each form's mapping"
        summary={mappingSummary}
        tone={needsMapping.length ? 'warn' : undefined}
        defaultOpen={needsMapping.length > 0}
      >
        <p className="text-[12.5px] text-gray-500 dark:text-zinc-500 leading-relaxed mt-2">
          Confirm the columns and their sample values separately for every selected form. Two
          outcome tables in one project name their columns differently, so confirming one says
          nothing about the other.
        </p>
        {(build?.forms ?? []).length === 0 ? (
          <p className="text-[12.5px] text-gray-500 dark:text-zinc-500 mt-2">
            Select at least one extraction form above to review its mapping.
          </p>
        ) : (build?.forms ?? []).map(form => (
          <MappingRow
            key={form.form_id}
            form={form}
            onOpenMapping={() => onOpenMapping(form.form_id)}
          />
        ))}
      </Fold>

      {duplicates.length > 0 && (
        <Fold
          title="Results that describe the same thing"
          summary={duplicateSummary}
          tone="warn"
        >
          <p className="text-[12.5px] text-gray-500 dark:text-zinc-500 leading-relaxed mt-2 mb-1">
            Two forms produced results with the same identity. Both are held rather than merged: the
            same outcome measured two ways is two results, and only a person can say which this is.
            There is nothing here to merge &mdash; one identity can only ever be one row &mdash; so
            the decision is about the <strong>forms</strong>: stop using one as a source, or map a
            column that tells the two apart.
          </p>
          {duplicates.map((dup, i) => (
            <div key={i} className="border-t border-gray-100 dark:border-[#1a1a1a] py-2.5 first:border-t-0">
              <div className="text-[12.5px] font-medium dark:text-zinc-200">
                {Object.values(dup.identity).filter(Boolean).join(' · ')}
              </div>
              <div className="text-[11.5px] text-gray-500 dark:text-zinc-500 mt-0.5">
                Derived from {dup.from.join(' and ')}
              </div>
              {canManage && (
                <div className="mt-2 flex flex-col gap-1.5">
                  {dup.from.map((name, side) => {
                    const formId = dup.from_ids?.[side];
                    if (!formId) return null;
                    return (
                      <div key={formId} className="flex items-center gap-2 flex-wrap text-[11.5px]">
                        <span className="text-gray-500 dark:text-zinc-500 min-w-0 truncate max-w-[16rem]">
                          {name}
                        </span>
                        <button
                          type="button"
                          disabled={pendingSources.has(formId)}
                          onClick={() => onToggleSource(formId, false)}
                          className="flex-none font-semibold rounded-lg border border-gray-200 dark:border-[#2a2a2a] px-2 py-0.5 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] disabled:opacity-50"
                        >
                          Not a source
                        </button>
                        <button
                          type="button"
                          onClick={() => onOpenMapping(formId)}
                          className="flex-none font-semibold rounded-lg border border-gray-200 dark:border-[#2a2a2a] px-2 py-0.5 hover:bg-gray-50 dark:hover:bg-[#1a1a1a]"
                        >
                          Map its columns
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </Fold>
      )}

      {/* Nothing to create is a RESULT, not an absence. The fold simply
          disappeared, so a manager who pressed Re-derive and saw the page not
          change had no way to tell whether it had run. */}
      {results.length === 0 && !loading && (
        <div className="border border-gray-200 rounded-xl bg-white dark:bg-[#111111] dark:border-[#1f1f1f] px-4 py-6 text-center">
          <div className="text-[14px] font-semibold dark:text-zinc-200">Nothing new to create</div>
          <p className="text-[12.5px] text-gray-500 dark:text-zinc-500 mt-1 max-w-[62ch] mx-auto leading-relaxed">
            {held.length
              ? <>Every candidate row is held. Define the missing study comparisons and they become
                results you can create.</>
              : unsettled.length
                ? <>No result can be derived until at least one study says which arms were
                  compared.</>
                : existingCount
                  ? <>The selected forms and study comparisons produce nothing that is not already
                    in the queue.</>
                  : <>The selected forms produce no candidate results. Tick another source above,
                    or check a form&rsquo;s column mapping.</>}
          </p>
        </div>
      )}

      {/* "Study readiness" and "Preview before adding" were REMOVED (22 Sep
          2026). Both enumerated one row per study or per result on a screen
          whose every other section is about the project: which forms are
          sources, and what their columns mean. Paper-by-paper detail belongs in
          the queue, which already groups by study — and the preview in
          particular was a list nothing could be done from.

          Neither signal is lost. Held rows still get the banner at the top of
          this screen, which names the count and says the queue lists them under
          "Comparison needed" — and a study with no comparison always has held
          rows, because that is what holds them. The count of what Create would
          add is on the button itself. */}
      {/* The one action this screen owns, and the only project-wide one there
          is. It was removed on 22 Sep 2026 and put back the same day: creating
          results per study, from the comparisons screen, is only reachable for
          a study the QUEUE lists — and the queue lists a study only if it
          already has results, or has no comparison at all. A study with a
          comparison and nothing created yet — an ordinary new paper in a
          configured project — appeared nowhere, so its results could never be
          created. Setup is also the only screen that loads the candidate build
          (the queue deliberately does not; it reads every outcome extraction in
          the project), so it is the only screen that can know the count.

          What did NOT come back: the per-result preview list, the per-study
          readiness list, and the "Open queue →" link beside this button. The
          first two were paper-by-paper detail on a project-level screen; the
          queue is already in the header. */}
      <div className="border border-gray-200 dark:border-[#1f1f1f] rounded-xl bg-white dark:bg-[#111111] px-4 py-3.5">
        {canManage && (
          <button
            type="button"
            onClick={onCommit}
            disabled={committing || results.length === 0 || needsMapping.length > 0}
            className="w-full min-h-[40px] text-[13px] font-semibold rounded-lg px-3 py-2 border border-gray-900 bg-gray-900 text-white hover:bg-gray-800 dark:border-white dark:bg-white dark:text-gray-900 disabled:opacity-[.55] disabled:cursor-not-allowed"
          >
            {committing ? 'Adding…' : `Add ${results.length} result${results.length === 1 ? '' : 's'} to queue`}
          </button>
        )}
      </div>
      {build?.note && (
        <div className="flex items-start gap-2.5 border border-gray-200 dark:border-[#2a2a2a] bg-gray-50 dark:bg-gray-500/5 rounded-xl px-3 py-2.5 text-[12.5px] text-gray-700 dark:text-zinc-300">
          <span>{build.note}</span>
        </div>
      )}
    </div>
  );
}

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

import type {
  RobBuildResponse, RobContrast, RobExcludedForm, RobFormMapping, RobResultCandidate,
} from '@/services/rob.service';
import { contrastLabel } from '../_lib/robIdentity';

interface Props {
  build: RobBuildResponse | null;
  loading: boolean;
  committing: boolean;
  canManage: boolean;
  onRebuild: () => void;
  onCommit: () => void;
  onOpenMapping: (formId: string) => void;
  onToggleSource: (formId: string, use: boolean | null) => void;
  /** A manager's comparison decisions per study, applied when results are created. */
  contrastEdits: Record<string, ContrastEdit[]>;
  onEditContrast: (documentId: string, edits: ContrastEdit[] | null) => void;
  /** document id → study label, so a comparison names a paper not a uuid. */
  studyLabels: Record<string, string>;
  /** Form ids whose source flag is being written right now. */
  pendingSources: Set<string>;
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
        ? 'border-amber-300 dark:border-amber-900/60'
        : 'border-border dark:border-[#1f1f1f]',
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
            ? 'text-amber-700 dark:text-amber-400'
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
 * every mapping warning here as a full sentence — five paragraphs of amber prose
 * per form, on a screen whose job is to let somebody see at a glance what still
 * needs them. The warnings are not deleted; they live on the mapping screen,
 * next to the column each one is about, where they can actually be acted on.
 */
function SourceRow({ form, excluded, pending, onToggle, onOpenMapping }: {
  form?: RobFormMapping;
  excluded?: RobExcludedForm;
  pending: boolean;
  onToggle: (use: boolean | null) => void;
  onOpenMapping?: () => void;
}) {
  const used = !!form;
  const name = form?.form_name ?? excluded?.form_name ?? '';
  const issues = (form?.warnings ?? []).filter(
    w => w.severity === 'blocking' || w.severity === 'needs_review').length;

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

      {used && (
        <span className="flex flex-col items-end gap-1.5 flex-none">
          <span className={[
            'inline-flex items-center gap-1 text-[10.5px] font-semibold rounded-full border px-1.5 py-px whitespace-nowrap',
            issues
              ? 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-500/5 dark:text-amber-400'
              : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-500/5 dark:text-emerald-400',
          ].join(' ')}>
            <span aria-hidden>{issues ? '!' : '✓'}</span>
            {issues
              ? `${issues} ${issues === 1 ? 'issue needs' : 'issues need'} review`
              : 'Mapped automatically'}
          </span>
          {onOpenMapping && (
            <button
              type="button"
              onClick={e => { e.preventDefault(); e.stopPropagation(); onOpenMapping(); }}
              className="text-[11.5px] font-semibold rounded-lg border border-gray-200 dark:border-[#2a2a2a] px-2.5 py-1 text-gray-600 dark:text-zinc-400 hover:bg-white dark:hover:bg-[#1a1a1a]"
            >
              {issues ? 'Review mapping →' : 'Inspect columns'}
            </button>
          )}
        </span>
      )}

      {!used && !excluded?.explicit && (
        <button
          type="button"
          onClick={e => { e.preventDefault(); e.stopPropagation(); onToggle(null); }}
          className="flex-none text-[11.5px] font-semibold rounded-lg border border-gray-200 dark:border-[#2a2a2a] px-2.5 py-1 text-gray-500 dark:text-zinc-500 hover:bg-white dark:hover:bg-[#1a1a1a]"
        >
          Automatic
        </button>
      )}
    </label>
  );
}

/** A comparison a manager declared for one study, before anything is created. */
export interface ContrastEdit {
  intervention: string;
  comparator: string;
}

/**
 * One study's comparisons — however many it has.
 *
 * **A trial is not one comparison.** A four-arm trial with a placebo arm has
 * three, and each is a separate estimate with its own answers to 2.4 and 5.2 —
 * so an outcome measured once produces three results to assess, not one. An
 * earlier version allowed a single comparison per study and quietly hid two
 * thirds of the work: the same collapse the page this replaces made, arrived at
 * from the other direction.
 *
 * What the machine can settle by itself it has already settled. What is left is
 * naming the arms, and where exactly one of them reads as a control the
 * comparator comes filled in, so only the intervention is chosen. The order is
 * the direction of effect: swapping it turns RR 1.84 favouring the drug into
 * RR 0.54 favouring placebo.
 */
function StudyContrasts({ contrast, edits, label, onSet, onRemove }: {
  contrast: RobContrast;
  edits: ContrastEdit[];
  label: string;
  onSet: (next: ContrastEdit[]) => void;
  onRemove: () => void;
}) {
  const arms = contrast.arms ?? [];
  const suggested = contrast.suggested_comparator ?? '';
  const declared: ContrastEdit[] = edits.length
    ? edits
    : contrast.intervention
      ? [{ intervention: contrast.intervention, comparator: contrast.comparator }]
      : [];

  const [intervention, setIntervention] = useState('');
  const [comparator, setComparator] = useState(suggested);

  const taken = new Set(declared.map(d => `${d.intervention}|${d.comparator}`));
  const canAdd = !!intervention && !!comparator
    && !taken.has(`${intervention}|${comparator}`);

  const add = () => {
    onSet([...declared, { intervention, comparator }]);
    setIntervention('');
    setComparator(suggested);
  };

  return (
    <div className="border-t border-gray-100 dark:border-[#1a1a1a] py-3 first:border-t-0">
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-[12.5px] font-semibold dark:text-white">{label}</span>
        <span className="text-[11px] text-gray-500 dark:text-zinc-500">
          {arms.length > 0 && `${arms.length} arms · `}
          {declared.length
            ? `${declared.length} comparison${declared.length === 1 ? '' : 's'}`
            : 'no comparison yet'}
        </span>
        {declared.length === 0 && (
          <span className="text-[11px] font-semibold rounded-full border border-amber-200 bg-amber-50 px-2 py-px text-amber-800 dark:border-amber-900/50 dark:bg-amber-500/5 dark:text-amber-400">
            needs a decision
          </span>
        )}
      </div>

      {declared.map((d, i) => (
        <div key={`${d.intervention}|${d.comparator}`}
             className="flex items-center gap-2 flex-wrap mt-1.5">
          <span className="text-[12.5px] dark:text-zinc-200">
            {d.intervention} <span className="text-gray-400 dark:text-zinc-600">vs</span> {d.comparator}
          </span>
          <button
            type="button"
            title="Swap which arm is the intervention"
            onClick={() => onSet(declared.map((x, j) => j === i
              ? { intervention: x.comparator, comparator: x.intervention } : x))}
            className="text-[11px] font-semibold rounded-lg border border-gray-200 dark:border-[#2a2a2a] px-2 py-0.5 text-gray-600 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-[#1a1a1a]"
          >
            ⇄ Swap
          </button>
          <button
            type="button"
            onClick={() => {
              const next = declared.filter((_, j) => j !== i);
              if (next.length) onSet(next); else onRemove();
            }}
            className="text-[11px] font-semibold rounded-lg border border-gray-200 dark:border-[#2a2a2a] px-2 py-0.5 text-gray-500 dark:text-zinc-500 hover:bg-gray-50 dark:hover:bg-[#1a1a1a]"
          >
            Remove
          </button>
        </div>
      ))}

      {arms.length > 1 && (
        <div className="flex items-end gap-2 flex-wrap mt-2">
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-600 mb-0.5">
              Intervention
            </label>
            <select
              value={intervention}
              onChange={e => setIntervention(e.target.value)}
              className="h-8 max-w-[240px] text-[12px] border border-gray-200 dark:border-[#2a2a2a] rounded-lg px-2 bg-white dark:bg-[#0d0d0d] dark:text-zinc-200 focus:outline-none"
            >
              <option value="">Choose an arm</option>
              {arms.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <span className="text-[11.5px] text-gray-500 dark:text-zinc-500 pb-1.5">vs</span>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-600 mb-0.5">
              Comparator
            </label>
            <select
              value={comparator}
              onChange={e => setComparator(e.target.value)}
              className="h-8 max-w-[240px] text-[12px] border border-gray-200 dark:border-[#2a2a2a] rounded-lg px-2 bg-white dark:bg-[#0d0d0d] dark:text-zinc-200 focus:outline-none"
            >
              <option value="">Choose an arm</option>
              {arms.filter(a => a !== intervention).map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <button
            type="button"
            disabled={!canAdd}
            onClick={add}
            className="h-8 text-[12px] font-semibold rounded-lg px-3 border border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-gray-900 disabled:opacity-40"
          >
            {declared.length ? 'Add another comparison' : 'Add this comparison'}
          </button>
        </div>
      )}
    </div>
  );
}

export function SetupScreen({
  build, loading, committing, canManage, onRebuild, onCommit,
  onOpenMapping, onToggleSource, pendingSources, contrastEdits, onEditContrast,
  studyLabels,
}: Props) {
  const results: RobResultCandidate[] = build?.results ?? [];
  const contrasts = build?.contrasts ?? [];
  const held = results.filter(r => r.state === 'held');
  const unresolved = contrasts.filter(c => c.state === 'unresolved');
  const proposed = contrasts.filter(c => c.state === 'proposed');
  const duplicates = build?.duplicates ?? [];
  const needsMapping = (build?.forms ?? []).filter(
    f => (f.warnings ?? []).some(w => w.severity === 'blocking' || w.severity === 'needs_review'));
  const studies = new Set(results.map(r => r.document_id)).size;

  // What a fold's one-line summary says. When something in it needs a decision
  // the summary NAMES that thing; otherwise it states a fact. A generic count
  // beside every heading tells a manager nothing about where to look.
  const sourceSummary = needsMapping.length
    ? `${needsMapping[0].form_name.replace(/^.*—\s*/, '')}: columns to confirm`
    : `${build?.forms.length ?? 0} outcome form${build?.forms.length === 1 ? '' : 's'} · `
      + `${(build?.forms ?? []).reduce((n, f) => n + f.extractions, 0)} extractions`;
  // A study is settled when it has at least one comparison — derived or declared.
  const unsettled = contrasts.filter(
    c => !c.intervention && !(contrastEdits[c.document_id] ?? []).length);
  const contrastSummary = unsettled.length
    ? `${unsettled.length} stud${unsettled.length === 1 ? 'y' : 'ies'} with no comparison yet`
    : `${contrasts.length + Object.values(contrastEdits).reduce(
        (n, e) => n + Math.max(0, e.length - 1), 0)} comparisons across ${contrasts.length} studies`;
  const duplicateSummary = duplicates.length
    ? `${duplicates.length} pair${duplicates.length === 1 ? '' : 's'} held out of the queue until you decide`
    : 'none outstanding';

  const needs = [needsMapping.length > 0, unsettled.length > 0,
                 duplicates.length > 0].filter(Boolean).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="border border-border rounded-xl bg-white dark:bg-[#111111] dark:border-[#1f1f1f] px-4 py-4">
        <div className="flex items-start gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <h1 className="text-[17px] font-bold tracking-tight dark:text-white">
              Risk of bias — project setup
            </h1>
            <p className="text-[12.5px] text-gray-600 dark:text-zinc-400 mt-1 leading-relaxed max-w-[76ch]">
              <strong className="font-semibold dark:text-white">
                {results.length} result{results.length === 1 ? '' : 's'} across {studies} stud
                {studies === 1 ? 'y' : 'ies'} {results.length ? 'ready to create' : 'derived'}.
              </strong>{' '}
              {needs
                ? <>{needs} section{needs === 1 ? '' : 's'} still {needs === 1 ? 'has' : 'have'} something
                  to settle — marked below. The rest was decided automatically; open a section only to
                  check or change it.</>
                : <>Everything was decided automatically. Open a section only to check or change it.</>}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-none">
            <button
              type="button"
              onClick={onRebuild}
              disabled={loading}
              className="text-[12.5px] font-semibold rounded-lg border border-gray-200 dark:border-[#2a2a2a] px-3 py-1.5 text-gray-600 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] disabled:opacity-40"
            >
              {loading ? 'Deriving…' : 'Re-derive'}
            </button>
            <button
              type="button"
              onClick={onCommit}
              disabled={!canManage || committing || results.length === 0}
              className="text-[12.5px] font-semibold rounded-lg px-3 py-1.5 border border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-gray-900 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {committing ? 'Creating…' : `Create these ${results.length} results`}
            </button>
          </div>
        </div>
      </div>

      <Fold
        title="Instrument"
        summary="RoB 2 · parallel group · 22 Aug 2019 · effect of assignment"
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
        title="Where results come from"
        summary={sourceSummary}
        tone={needsMapping.length ? 'warn' : undefined}
        defaultOpen
      >
        <p className="text-[12.5px] text-gray-500 dark:text-zinc-500 leading-relaxed mt-2">
          Every outcome form that names results is used, not the first one that matches a pattern.
          Untick a form whose rows are a second copy of another&rsquo;s.
        </p>
        {(build?.forms ?? []).map(form => (
          <SourceRow
            key={form.form_id}
            form={form}
            pending={pendingSources.has(form.form_id)}
            onToggle={use => onToggleSource(form.form_id, use)}
            onOpenMapping={() => onOpenMapping(form.form_id)}
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
        title="Comparisons"
        summary={contrastSummary}
        tone={unsettled.length ? 'warn' : undefined}
      >
        <p className="text-[12.5px] text-gray-500 dark:text-zinc-500 leading-relaxed mt-2 mb-1">
          An outcome table stores one row per <em>arm</em>, and an arm name cannot say what it was
          compared against. Two-arm trials with an identifiable control resolve on their own; anything
          else waits for you, because guessing the comparator inverts every estimate that points here.
        </p>
        {contrasts.length === 0 && (
          <div className="text-[12.5px] text-gray-500 dark:text-zinc-500 py-2">
            No comparisons derived yet.
          </div>
        )}
        {contrasts.map((contrast, i) => (
          <StudyContrasts
            key={contrast.id || contrast.document_id || i}
            contrast={contrast}
            edits={contrastEdits[contrast.document_id] ?? []}
            label={studyLabels[contrast.document_id] ?? contrast.document_id.slice(0, 8)}
            onSet={next => onEditContrast(contrast.document_id, next)}
            onRemove={() => onEditContrast(contrast.document_id, null)}
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
          </p>
          {duplicates.map((dup, i) => (
            <div key={i} className="border-t border-gray-100 dark:border-[#1a1a1a] py-2.5 first:border-t-0">
              <div className="text-[12.5px] font-medium dark:text-zinc-200">
                {Object.values(dup.identity).filter(Boolean).join(' · ')}
              </div>
              <div className="text-[11.5px] text-gray-500 dark:text-zinc-500 mt-0.5">
                Derived from {dup.from.join(' and ')}
              </div>
            </div>
          ))}
        </Fold>
      )}

      {build?.note && (
        <div className="flex items-start gap-2.5 border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-500/5 rounded-xl px-3 py-2.5 text-[12.5px] text-amber-900 dark:text-amber-300">
          <span aria-hidden className="font-bold">!</span>
          <span>{build.note}</span>
        </div>
      )}
    </div>
  );
}

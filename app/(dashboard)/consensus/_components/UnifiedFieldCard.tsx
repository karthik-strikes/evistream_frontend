'use client';

/**
 * One field, as an adjudicator sees it.
 *
 * The interaction changed shape here. It used to be: read three tinted boxes,
 * then reach for a row of small text buttons underneath to say which one you
 * meant. The boxes were inert — their only clickable element was a pencil that
 * copied the value into a custom-value input. So the thing you were choosing and
 * the thing you clicked were different objects.
 *
 * Now the box *is* the button. Picking a source is one click on the value you
 * read, the picked box carries an inset ring in that source's colour plus a check
 * chip, and the button row shrinks to the things that are not a source (custom,
 * not reported, not applicable).
 *
 * Three other things this file gained:
 *
 *  - **The majority bar.** `computeSuggestion` on the page has always worked out
 *    when 2 of 3 sources agree, and the result was passed in as `suggestion` —
 *    and then never rendered. `accept_suggestion` was unreachable, while the
 *    post-submit summary had an "Auto-accepted" tile counting it. One click, or M.
 *  - **Evidence that goes somewhere.** `SourceEvidence` was a static `<div>`, and
 *    `sourceMeta` was not even forwarded to the disputed branch — so quotes were
 *    invisible on exactly the cards where a reviewer needs them. They are buttons
 *    now, and they drive the PDF pane.
 *  - **A reserved left border.** Every card carries `border-l-[3px]`, transparent
 *    when neutral, so rows stop shifting 3px sideways as they resolve.
 *
 * Deleted: the "N−1 of N disagree" badge. Its arithmetic was unconditional, so a
 * field where 2 of 3 sources agreed still announced "2 of 3 disagree", and it was
 * the loudest element on the card. The majority bar states the true count, from
 * the positive side.
 */

import { NR_LABEL, NA_LABEL, canonicalAbsenceLabel, compareKey } from '@/lib/absence';
import { sourceColors, STATE_COLORS, type SourceKey } from '@/lib/reviewerColors';
import { cn } from '@/lib/utils';
import { AlertTriangle, Check, ChevronDown, ChevronRight, Pencil, Quote } from 'lucide-react';
import { useState } from 'react';
import type { FormField } from '@/types/api';
import { FieldRenderer } from '../../manual-extraction/_components/FieldRenderer';
import { TableField } from '../../manual-extraction/_components/TableField';
import { isTableField } from '../../manual-extraction/_lib/fieldKinds';
import { unambiguousAbsenceLabel } from '../../manual-extraction/_lib/absenceInput';
import {
  isUnfilled,
  pickedSourceKeys,
  resolveField,
  resolutionLabel,
  type Decision,
  type ResolvableField,
} from '../_lib/resolve';

/** Grounding metadata for one source's answer. */
export interface EvidenceMeta {
  source_text?: string;
  page?: number;
  section?: string;
}

export interface UnifiedFieldCardProps {
  fieldName: string;
  field?: FormField;
  sources: { ai?: any; r1?: any; r2?: any };
  agreed: boolean;
  suggestion?: { value: any; source: string; reason: string };
  decision: string | null;
  customValue: any;
  legacyCorrection: string;
  onDecision: (decision: Decision) => void;
  onCustomValue: (value: any) => void;
  onCorrection: (value: string) => void;
  isActive: boolean;
  onClick: () => void;
  sourceMeta?: { ai?: EvidenceMeta; r1?: EvidenceMeta; r2?: EvidenceMeta };
  /** Raise a quote to the PDF pane. Absent → evidence renders unclickable. */
  onJumpToEvidence?: (source: SourceKey, meta: EvidenceMeta) => void;
  id?: string;
}

/** Shared micro-label token, lifted from DecompositionReviewDialog. */
const ML = 'text-[11px] font-semibold uppercase tracking-wider';

/** Do two answers say the same thing? Same rule the page uses for agreement. */
function matches(a: any, b: any): boolean {
  if (isUnfilled(a) || isUnfilled(b)) return false;
  const ka = compareKey(a);
  const kb = compareKey(b);
  return ka !== null && kb !== null && ka === kb;
}

function displayBoolean(v: any): string | null {
  const s = String(v).trim().toLowerCase();
  if (['yes', 'true', '1', 'y'].includes(s)) return 'Yes';
  if (['no', 'false', '0', 'n'].includes(s)) return 'No';
  // NA and NR are different findings, so they must not both render as "NR".
  const absent = canonicalAbsenceLabel(v);
  if (absent) return absent;
  return null;
}

function displayShort(v: any, field?: FormField): string {
  if (isUnfilled(v)) return '';
  if (Array.isArray(v)) {
    if (v.every(x => typeof x !== 'object')) return v.join(', ');
    return `${v.length} row${v.length === 1 ? '' : 's'}`;
  }
  if (typeof v === 'object') return JSON.stringify(v);
  if (field?.field_type === 'boolean') return displayBoolean(v) ?? String(v);
  return String(v);
}

// ── Shared bits ───────────────────────────────────────────────────────────────

function StatusPill({ resolved, label }: { resolved: boolean; label: string }) {
  const c = resolved ? STATE_COLORS.resolved : STATE_COLORS.active;
  return (
    <span className={cn('flex-shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold', c.text, c.bg)}>
      {resolved ? `✓ ${label}` : label}
    </span>
  );
}

function TypeBadge({ field }: { field?: FormField }) {
  if (!field?.field_type) return null;
  return (
    <span className="rounded bg-gray-100 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:bg-[#1a1a1a] dark:text-zinc-500">
      {field.field_type === 'array' ? (field.subform_fields?.length ? 'table' : 'list') : field.field_type}
      {field.multiple && ' ·multi'}
    </span>
  );
}

function FieldMeta({ field }: { field?: FormField }) {
  return (
    <>
      {field?.field_description && (
        <p className="mt-0.5 text-[11px] leading-snug text-gray-400 dark:text-zinc-500">{field.field_description}</p>
      )}
      {field?.extraction_hints && (
        <p className="mt-0.5 text-[11px] italic leading-snug text-gray-400/70 dark:text-zinc-600">{field.extraction_hints}</p>
      )}
    </>
  );
}

/** Card header: label, type, description, status. */
function CardHeader({
  label, field, resolved, statusLabel, icon,
}: {
  label: string; field?: FormField; resolved: boolean; statusLabel: string; icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="flex min-w-0 items-start gap-2">
        {icon}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={cn(ML, 'text-gray-600 dark:text-zinc-300')}>{label}</span>
            {field?.required && <span className="text-[11px] text-red-400">*</span>}
            <TypeBadge field={field} />
          </div>
          <FieldMeta field={field} />
        </div>
      </div>
      <StatusPill resolved={resolved} label={statusLabel} />
    </div>
  );
}

/**
 * A clickable quote. This is the affordance the screen was missing: every field
 * already carried `source_text` and a page, and none of it was reachable.
 */
function SourceEvidence({
  meta, onJump, tint,
}: {
  meta?: EvidenceMeta;
  onJump?: () => void;
  tint?: string;
}) {
  if (!meta?.source_text) return null;
  const text = meta.source_text.length > 110 ? `${meta.source_text.slice(0, 110)}…` : meta.source_text;
  const body = (
    <>
      <Quote className="mt-0.5 h-2.5 w-2.5 flex-shrink-0 opacity-50" />
      <span className="italic leading-relaxed">
        {text}
        {meta.page ? <span className={cn('ml-1.5 not-italic font-semibold', tint)}>p.{meta.page}</span> : null}
      </span>
    </>
  );
  if (!onJump) {
    return (
      <div className="mt-1.5 flex gap-1 border-l-2 border-gray-200 pl-2 text-[10px] text-gray-400 dark:border-[#2a2a2a] dark:text-zinc-500">
        {body}
      </div>
    );
  }
  return (
    <button
      type="button"
      title="Show this passage in the PDF"
      onClick={e => { e.stopPropagation(); onJump(); }}
      className="mt-1.5 flex w-full gap-1 border-l-2 border-gray-200 pl-2 text-left text-[10px] text-gray-400 transition-colors hover:border-gray-400 hover:text-gray-600 dark:border-[#2a2a2a] dark:text-zinc-500 dark:hover:border-zinc-500 dark:hover:text-zinc-300"
    >
      {body}
    </button>
  );
}

/**
 * One source's answer, as a pick target.
 *
 * The whole box is the button — see the file header. `aria-pressed` carries the
 * picked state, so this reads as a toggle to a screen reader rather than as a
 * decorative panel with a mystery ring.
 */
function SourceBox({
  sourceKey, value, field, picked, meta, onPick, onSeed, onJump, children,
}: {
  sourceKey: SourceKey;
  value: any;
  field?: FormField;
  picked: boolean;
  meta?: EvidenceMeta;
  onPick?: () => void;
  onSeed?: () => void;
  onJump?: () => void;
  children?: React.ReactNode;
}) {
  const c = sourceColors(sourceKey);
  return (
    <div
      role={onPick ? 'button' : undefined}
      tabIndex={onPick ? 0 : undefined}
      aria-pressed={onPick ? picked : undefined}
      onClick={onPick ? e => { e.stopPropagation(); onPick(); } : undefined}
      onKeyDown={onPick ? e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onPick(); }
      } : undefined}
      className={cn(
        'flex min-w-0 flex-col gap-1.5 rounded-xl px-3 py-2.5 transition-all',
        onPick && 'cursor-pointer',
        picked ? c.selected : c.bg,
      )}
    >
      <div className="flex items-center justify-between gap-1.5">
        <span className={cn(ML, c.text)}>{c.label}</span>
        <div className="flex items-center gap-1">
          {onSeed && (
            <button
              type="button"
              title={`Start a custom value from ${c.label}'s answer`}
              onClick={e => { e.stopPropagation(); onSeed(); }}
              className="cursor-pointer border-none bg-transparent p-0.5 text-gray-400 hover:text-gray-600 dark:text-zinc-600 dark:hover:text-zinc-300"
            >
              <Pencil className="h-2.5 w-2.5" />
            </button>
          )}
          {picked && (
            <span className={cn('flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full', c.solid)}>
              <Check className="h-2.5 w-2.5" strokeWidth={3} />
            </span>
          )}
        </div>
      </div>
      <div className="max-h-28 overflow-y-auto text-sm leading-snug text-gray-700 dark:text-zinc-300">
        {children ?? <DisplayValue value={value} field={field} />}
      </div>
      <SourceEvidence meta={meta} onJump={onJump} tint={c.text} />
    </div>
  );
}

/**
 * "AI + R1 agree (2/3) — accept it?"
 *
 * Stays visible after acceptance in a settled state rather than disappearing: a
 * reviewer coming back to the card should still be able to see *why* the field
 * resolved the way it did.
 */
function MajorityBar({
  reason, accepted, onAccept,
}: {
  reason: string; accepted: boolean; onAccept: () => void;
}) {
  if (accepted) {
    return (
      <div className={cn(
        'mt-2.5 flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-semibold',
        STATE_COLORS.resolved.bg, STATE_COLORS.resolved.text,
      )}>
        <Check className="h-3 w-3" strokeWidth={3} />
        <span>Majority accepted — {reason}</span>
      </div>
    );
  }
  return (
    <div className="mt-2.5 flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 py-1.5 pl-3 pr-1.5 dark:border-blue-900/50 dark:bg-blue-950/40">
      <span className="min-w-0 flex-1 truncate text-xs font-semibold text-blue-800 dark:text-blue-200">{reason}</span>
      <button
        type="button"
        onClick={e => { e.stopPropagation(); onAccept(); }}
        className="flex-shrink-0 cursor-pointer rounded-lg bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-400"
      >
        Accept majority
      </button>
    </div>
  );
}

function DecisionButton({
  label, active, onClick, tone = 'gray',
}: {
  label: string; active: boolean; onClick: () => void; tone?: 'gray' | 'good';
}) {
  const activeCls = tone === 'good'
    ? 'border-emerald-600 bg-emerald-600 text-white dark:border-emerald-500 dark:bg-emerald-500'
    : 'border-gray-900 bg-gray-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-gray-900';
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={e => { e.stopPropagation(); onClick(); }}
      className={cn(
        'cursor-pointer rounded-lg border px-2.5 py-1 text-xs font-semibold transition-all',
        active
          ? activeCls
          : 'border-gray-200 bg-white text-gray-500 hover:border-gray-400 dark:border-[#2a2a2a] dark:bg-[#111111] dark:text-zinc-400 dark:hover:border-[#3f3f3f]',
      )}
    >
      {label}
    </button>
  );
}

/**
 * The "none of the sources" choice.
 *
 * This used to be three buttons — Custom value, Not reported, Not applicable —
 * while the value editor those buttons opened already offered NR and NA itself.
 * Two controls for one claim, storing two different records: clicking the button
 * wrote `resolution_source: 'not_reported'`, picking it in the editor wrote
 * `'custom'`. Absence lives in the editor now, with the value, and `resolveField`
 * derives the provenance from what was entered.
 */
function OtherDecisions({
  decision, onDecision, customLabel = 'Enter a different answer',
}: {
  decision: string | null; onDecision: (d: Decision) => void; customLabel?: string;
}) {
  return <DecisionButton label={customLabel} active={decision === 'custom'} onClick={() => onDecision('custom')} />;
}

function DisplayValue({ value, field }: { value: any; field?: FormField }) {
  if (isUnfilled(value)) {
    return <span className="text-xs italic text-gray-400 dark:text-zinc-600">nothing recorded</span>;
  }
  if (Array.isArray(value)) {
    if (field && isTableField(field)) {
      return <TableRowsPreview rows={value} cols={field.subform_fields ?? []} compareTo={[]} />;
    }
    if (value.every(v => typeof v !== 'object' || v === null)) {
      return (
        <div className="flex flex-wrap gap-1">
          {value.map((v, i) => (
            <span
              key={i}
              className="rounded border border-gray-200 bg-white/70 px-1.5 py-0.5 text-[11px] dark:border-[#2a2a2a] dark:bg-black/30"
            >
              {String(v)}
            </span>
          ))}
        </div>
      );
    }
    return <span className="break-all font-mono text-[11px]">{`${value.length} row${value.length === 1 ? '' : 's'} (table)`}</span>;
  }
  if (typeof value === 'object') {
    return <span className="break-all font-mono text-[11px]">{JSON.stringify(value)}</span>;
  }
  if (field?.field_type === 'boolean') {
    const b = displayBoolean(value);
    if (b === NR_LABEL || b === NA_LABEL) return <span className="italic text-gray-400">{b}</span>;
    if (b) return <span>{b}</span>;
  }
  return <span className="break-words">{String(value)}</span>;
}

/**
 * A data key with no entry in the form schema (`page.tsx` builds `{ name: k }`
 * for these). It has no author vocabulary to defer to, so the generic NR/NA
 * affordance is unconditionally right for it — and synthesizing a field is how
 * it gets one without duplicating the markup. `compact` strips the label chrome
 * before the empty `field_name` could ever reach the DOM.
 */
const ADHOC_TEXT_FIELD: FormField = { field_name: '', field_type: 'text' } as FormField;

function CustomInput({ field, value, onChange, placeholder }: {
  field?: FormField; value: any; onChange: (v: any) => void; placeholder?: string;
}) {
  if (field && isTableField(field)) {
    return <TableCustomInput field={field} value={value} onChange={onChange} />;
  }
  return (
    <div className="mt-2" onClick={e => e.stopPropagation()}>
      <FieldRenderer
        field={field ?? ADHOC_TEXT_FIELD}
        value={value ?? ''}
        onChange={onChange}
        index={0}
        compact
        placeholder={field ? undefined : (placeholder ?? 'Enter the correct value…')}
      />
    </div>
  );
}

// ── Agreed fields ─────────────────────────────────────────────────────────────

/**
 * A field every source agreed on, as one quiet line.
 *
 * These used to render as full cards with a source grid and four buttons, which
 * made a settled field look like work. Now it is label, value, who matched, and
 * an Override that opens on demand — and Override finally does something: the
 * resolver used to short-circuit on `agreed` before reading the decision, so an
 * override typed here was silently thrown away on save.
 */
export function AgreedFieldRow({
  fieldName, field, sources, decision, customValue, onDecision, onCustomValue,
}: {
  fieldName: string;
  field?: FormField;
  sources: { ai?: any; r1?: any; r2?: any };
  decision: string | null;
  customValue: any;
  onDecision: (d: Decision) => void;
  onCustomValue: (v: any) => void;
}) {
  const label = field?.display_name || fieldName.replace(/_/g, ' ');
  const overriding = decision !== null && decision !== 'agreed';
  const [open, setOpen] = useState(false);
  const value = sources.ai ?? sources.r1 ?? sources.r2 ?? '';
  const matched = (['ai', 'r1', 'r2'] as SourceKey[])
    .filter(k => sources[k] !== undefined && !isUnfilled(sources[k]))
    .map(k => sourceColors(k).short)
    .join(' · ');

  const showForm = open || overriding;

  return (
    <div className={cn(
      'flex flex-col gap-1.5 border-b border-l-[3px] border-gray-100 px-4 py-2.5 dark:border-b-[#1a1a1a]',
      overriding ? STATE_COLORS.active.border : 'border-l-emerald-200 dark:border-l-emerald-900/60',
    )}>
      <div className="flex items-center gap-2">
        <span className={cn(ML, 'min-w-0 truncate text-gray-500 dark:text-zinc-400')}>{label}</span>
        <span className="flex-1" />
        <span className={cn(
          'flex-shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold',
          overriding
            ? cn(STATE_COLORS.active.text, STATE_COLORS.active.bg)
            : cn(STATE_COLORS.resolved.text, STATE_COLORS.resolved.bg),
        )}>
          {overriding ? 'Overridden' : 'Agreed'}
        </span>
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="flex-shrink-0 cursor-pointer border-none bg-transparent text-xs text-gray-400 hover:text-gray-600 dark:text-zinc-500 dark:hover:text-zinc-300"
        >
          {showForm ? 'Hide' : 'Override'}
        </button>
      </div>

      <div className="flex items-baseline gap-2">
        <span className="min-w-0 truncate text-sm text-gray-600 dark:text-zinc-300">
          {overriding
            ? displayShort(resolveField({ sources, agreed: true, decision, customValue, legacyCorrection: '' }).finalValue, field) || '—'
            : displayShort(value, field) || '—'}
        </span>
        <span className="flex-shrink-0 text-[10px] text-gray-400 dark:text-zinc-600">{matched} match</span>
      </div>

      {showForm && (
        <div className="mt-0.5 flex flex-col gap-1.5" onClick={e => e.stopPropagation()}>
          <div className="flex flex-wrap items-center gap-1.5">
            <DecisionButton
              label="Keep agreed"
              active={!overriding}
              tone="good"
              onClick={() => { onDecision('agreed'); setOpen(false); }}
            />
            <OtherDecisions decision={decision} onDecision={onDecision} />
          </div>
          {decision === 'custom' && <CustomInput field={field} value={customValue} onChange={onCustomValue} />}
        </div>
      )}
    </div>
  );
}

// ── The card ──────────────────────────────────────────────────────────────────

export function UnifiedFieldCard({
  fieldName,
  field,
  sources,
  agreed,
  suggestion,
  decision,
  customValue,
  legacyCorrection,
  onDecision,
  onCustomValue,
  onCorrection,
  isActive,
  onClick,
  sourceMeta,
  onJumpToEvidence,
  id,
}: UnifiedFieldCardProps) {
  const label = field?.display_name || fieldName.replace(/_/g, ' ');
  const isBoolean = field?.field_type === 'boolean';
  const presentKeys = (['ai', 'r1', 'r2'] as SourceKey[]).filter(
    k => sources[k] !== undefined && !isUnfilled(sources[k]),
  );

  const resolvable: ResolvableField = { sources, agreed, suggestion, decision, customValue, legacyCorrection };
  const resolution = resolveField(resolvable);
  const picked = new Set(pickedSourceKeys(resolvable, matches));

  // Mirrors isFieldResolved on the page, which gates submission.
  const resolved =
    decision !== null &&
    (decision === 'custom' ? !isUnfilled(customValue)
      : decision === 'incorrect' ? !isUnfilled(legacyCorrection)
      : true);

  const statusLabel = resolved ? resolutionLabel(resolution.source) : 'Needs decision';

  const seedFrom = (key: SourceKey) => { onCustomValue(sources[key]); onDecision('custom'); };
  const jump = (key: SourceKey) => {
    const meta = sourceMeta?.[key];
    if (meta && onJumpToEvidence) onJumpToEvidence(key, meta);
  };

  const cardClass = cn(
    'cursor-pointer border-b border-l-[3px] border-b-gray-100 px-4 py-3 transition-colors dark:border-b-[#1a1a1a]',
    resolved ? STATE_COLORS.resolved.border : isActive ? STATE_COLORS.active.border : STATE_COLORS.pending.border,
    isActive ? 'bg-amber-50/40 dark:bg-amber-900/10' : 'hover:bg-gray-50/60 dark:hover:bg-[rgba(255,255,255,0.02)]',
  );

  // ── Single source: confirm it, or correct it ──
  if (presentKeys.length <= 1) {
    const only = presentKeys[0];
    return (
      <div id={id} className={cardClass} onClick={onClick}>
        <CardHeader label={label} field={field} resolved={resolved} statusLabel={statusLabel} />

        {only ? (
          <div className="mt-2.5">
            <SourceBox
              sourceKey={only}
              value={sources[only]}
              field={field}
              picked={decision === 'correct' || decision === `accept_${only}`}
              meta={sourceMeta?.[only]}
              onPick={() => onDecision('correct')}
              onSeed={() => seedFrom(only)}
              onJump={sourceMeta?.[only]?.source_text ? () => jump(only) : undefined}
            />
          </div>
        ) : (
          <p className="mt-2 text-xs italic text-gray-400 dark:text-zinc-600">No value extracted for this field.</p>
        )}

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {only && (
            <>
              <DecisionButton
                label="Correct"
                active={decision === 'correct'}
                tone="good"
                onClick={() => onDecision('correct')}
              />
              <DecisionButton
                label="Needs correction"
                active={decision === 'incorrect'}
                onClick={() => {
                  // Seed the box from the value being corrected — a reviewer
                  // fixing one digit should not retype the whole cell.
                  const v = sources[only];
                  if (decision !== 'incorrect' && !legacyCorrection && !isUnfilled(v)) {
                    onCorrection(typeof v === 'string' ? v : Array.isArray(v) ? v.join(',') : String(v));
                  }
                  onDecision('incorrect');
                }}
              />
            </>
          )}
          <OtherDecisions decision={decision} onDecision={onDecision} />
        </div>

        {decision === 'incorrect' && (
          <div onClick={e => e.stopPropagation()}>
            {/* Same editor as "Enter a different answer", so a correction can be
                "not reported" too — it is an answer like any other. */}
            <CustomInput
              field={field}
              value={legacyCorrection}
              onChange={v => onCorrection(typeof v === 'string' ? v : Array.isArray(v) ? v.join(',') : String(v ?? ''))}
              placeholder="The correct value (required)"
            />
            {isUnfilled(legacyCorrection) && (
              <p className="mt-1 text-[10px] text-amber-600 dark:text-amber-400">
                Enter the corrected value — leaving this empty would save no answer at all.
              </p>
            )}
          </div>
        )}

        {decision === 'custom' && <CustomInput field={field} value={customValue} onChange={onCustomValue} />}
      </div>
    );
  }

  // ── Several sources disagree: pick one, or write your own ──
  const isTable = !!field && isTableField(field);
  return (
    <div id={id} className={cardClass} onClick={onClick}>
      <CardHeader
        label={label}
        field={field}
        resolved={resolved}
        statusLabel={statusLabel}
        icon={
          resolved
            ? undefined
            : <AlertTriangle className={cn('mt-0.5 h-3.5 w-3.5 flex-shrink-0', STATE_COLORS.active.text)} />
        }
      />

      {isTable ? (
        <TableSourceGrid
          sources={sources}
          field={field!}
          picked={picked}
          sourceMeta={sourceMeta}
          onPick={key => onDecision(`accept_${key}` as Decision)}
          onSeed={seedFrom}
          onJump={onJumpToEvidence ? jump : undefined}
        />
      ) : (
        <div
          className="mt-2.5 grid gap-2"
          style={{ gridTemplateColumns: `repeat(${presentKeys.length}, minmax(0, 1fr))` }}
        >
          {presentKeys.map(key => (
            <SourceBox
              key={key}
              sourceKey={key}
              value={sources[key]}
              field={field}
              picked={picked.has(key)}
              meta={sourceMeta?.[key]}
              onPick={() => onDecision(`accept_${key}` as Decision)}
              onSeed={() => seedFrom(key)}
              onJump={sourceMeta?.[key]?.source_text && onJumpToEvidence ? () => jump(key) : undefined}
            />
          ))}
        </div>
      )}

      {suggestion && (
        <MajorityBar
          reason={suggestion.reason}
          accepted={decision === 'accept_majority' || decision === 'accept_suggestion'}
          onAccept={() => onDecision('accept_majority')}
        />
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <OtherDecisions decision={decision} onDecision={onDecision} />
      </div>

      {decision === 'custom' && <CustomInput field={field} value={customValue} onChange={onCustomValue} />}
    </div>
  );
}

// ── Table helpers ─────────────────────────────────────────────────────────────

function cellValue(raw: any): string {
  if (raw == null) return '';
  if (Array.isArray(raw)) return raw.map(cellValue).join(', ');
  if (typeof raw === 'object') {
    if ('value' in raw) return raw.value == null ? '' : String(raw.value);
    if ('rating' in raw) return raw.rating == null ? '' : String(raw.rating);
    return JSON.stringify(raw);
  }
  return String(raw);
}

/** Per-cell grounding metadata for a `{value, source_text}` envelope. Returns
 *  undefined for bare-scalar cells (old data) so no evidence chip is rendered. */
function cellMeta(raw: any): EvidenceMeta | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const meta: EvidenceMeta = {};
  if (typeof raw.source_text === 'string') {
    const t = raw.source_text.trim();
    if (t && t !== 'NR') meta.source_text = raw.source_text;
  }
  if (typeof raw.page === 'number') meta.page = raw.page;
  if (typeof raw.section === 'string' && raw.section.trim()) meta.section = raw.section;
  return Object.keys(meta).length > 0 ? meta : undefined;
}

/**
 * Which cells of row `i` differ from the other sources' row `i`, and whether the
 * row differs at all.
 *
 * One implementation for both row renderers. `TableRowsCompact` had its own copy
 * containing `cellValue(...) !== other?.[col] !== undefined && …`, which parses
 * as `(a !== b) !== undefined` — a boolean is never `undefined`, so that clause
 * was unconditionally true and the `&&` silently degraded to the third clause. It
 * happened to produce a plausible answer, which is why it survived.
 *
 * Row pairing is by array index, unchanged. Pairing on the composite key instead
 * would change which cells are flagged, and that is a data-semantics decision
 * needing its own verification — not a side effect of a restyle.
 */
function computeRowDiff(row: any, rowIdx: number, cols: FormField[], compareTo: any[][]) {
  const others = compareTo.map(o => o[rowIdx]).filter(o => o !== undefined);
  const differingCells = new Set<string>();
  for (const col of cols) {
    const mine = cellValue(row?.[col.field_name]).trim().toLowerCase();
    if (others.some(o => cellValue(o?.[col.field_name]).trim().toLowerCase() !== mine)) {
      differingCells.add(col.field_name);
    }
  }
  // A source that has no row at this index is itself a difference.
  const missingRow = compareTo.some(o => o[rowIdx] === undefined);
  const differs = others.length === 0 ? missingRow : differingCells.size > 0 || missingRow;
  return { differs, differingCells };
}

/** Label + value + evidence for one column of an expanded row. */
function RowCell({
  col, raw, isDiff, fullWidth,
}: {
  col: FormField; raw: any; isDiff: boolean; fullWidth: boolean;
}) {
  const val = cellValue(raw);
  return (
    <div className={cn(
      fullWidth && 'col-span-2',
      isDiff && '-mx-1 rounded bg-amber-50/80 px-1 dark:bg-amber-900/25',
    )}>
      <p className={cn(
        'mb-0.5 text-[10px] font-bold uppercase leading-none tracking-normal',
        isDiff ? STATE_COLORS.active.text : 'text-gray-400 dark:text-zinc-500',
      )}>
        {(col.display_name || col.field_name).replace(/_/g, ' ')}
        {isDiff && <span className="ml-1 text-amber-500">⚠</span>}
      </p>
      <p className={cn(
        'break-words text-sm leading-snug',
        val.trim() ? 'text-gray-700 dark:text-zinc-300' : 'italic text-gray-400 dark:text-zinc-500',
      )}>
        {val.trim() || 'empty'}
      </p>
      <SourceEvidence meta={cellMeta(raw)} />
    </div>
  );
}

function TableRowsPreview({ rows, cols, compareTo }: { rows: any[]; cols: FormField[]; compareTo: any[][] }) {
  const [showAll, setShowAll] = useState(false);
  if (!rows || rows.length === 0) {
    return <div className="px-1 text-[11px] italic text-gray-400 dark:text-zinc-600">empty</div>;
  }
  const visible = showAll ? rows : rows.slice(0, 3);
  const hidden = rows.length - visible.length;
  return (
    <div className="space-y-1">
      {visible.map((row, i) => {
        const { differs, differingCells } = computeRowDiff(row, i, cols, compareTo);
        return (
          <TableRowCard key={i} row={row} rowIdx={i} cols={cols} differs={differs} differingCells={differingCells} />
        );
      })}
      {hidden > 0 && <MoreRows hidden={hidden} onShow={() => setShowAll(true)} />}
    </div>
  );
}

function MoreRows({ hidden, onShow }: { hidden: number; onShow: () => void }) {
  return (
    <button
      type="button"
      onClick={ev => { ev.stopPropagation(); onShow(); }}
      className="cursor-pointer border-none bg-transparent px-1.5 text-[11px] text-gray-400 hover:text-gray-600 dark:text-zinc-600 dark:hover:text-zinc-300"
    >
      + {hidden} more row{hidden === 1 ? '' : 's'}
    </button>
  );
}

function TableRowCard({ row, rowIdx, cols, differs, differingCells }: {
  row: any; rowIdx: number; cols: FormField[]; differs: boolean; differingCells: Set<string>;
}) {
  const [expanded, setExpanded] = useState(false);
  const summary = cols
    .map(c => cellValue(row?.[c.field_name]))
    .filter(s => s.trim())
    .slice(0, 2)
    .join(' · ') || `Row ${rowIdx + 1}`;
  const filled = cols.filter(c => cellValue(row?.[c.field_name]).trim()).length;
  return (
    <div className={cn(
      'overflow-hidden rounded-lg border bg-white/60 dark:bg-[#0f0f0f]',
      differs ? 'border-amber-300 dark:border-amber-700/50' : 'border-gray-100 dark:border-[#1f1f1f]',
    )}>
      <div
        role="button"
        tabIndex={0}
        onClick={e => { e.stopPropagation(); setExpanded(p => !p); }}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setExpanded(p => !p); }
        }}
        className={cn(
          'flex select-none items-center gap-1.5 px-2 py-1.5 transition-colors',
          differs ? 'hover:bg-amber-50/80 dark:hover:bg-amber-900/20' : 'hover:bg-gray-50/60 dark:hover:bg-[rgba(255,255,255,0.02)]',
        )}
      >
        {expanded
          ? <ChevronDown className="h-3 w-3 flex-shrink-0 text-gray-400" />
          : <ChevronRight className="h-3 w-3 flex-shrink-0 text-gray-400" />}
        <span className="flex-shrink-0 font-mono text-[10px] tabular-nums text-gray-400 dark:text-zinc-600">#{rowIdx + 1}</span>
        <span className={cn(
          'flex-1 truncate text-[11px]',
          differs ? STATE_COLORS.active.text : 'text-gray-600 dark:text-zinc-400',
        )}>
          {summary}
        </span>
        <span className="flex-shrink-0 text-[10px] tabular-nums text-gray-400 dark:text-zinc-600">{filled}/{cols.length}</span>
        {differs && <span className="flex-shrink-0 text-[10px] text-amber-600 dark:text-amber-300">⚠</span>}
      </div>
      {expanded && (
        <div className="border-t border-gray-100 bg-white/40 px-2.5 py-2 dark:border-[#1f1f1f] dark:bg-[#0a0a0a]">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
            {cols.map((col, colIdx) => (
              <RowCell
                key={col.field_name}
                col={col}
                raw={row?.[col.field_name]}
                isDiff={differingCells.has(col.field_name)}
                fullWidth={colIdx === cols.length - 1 && cols.length % 2 !== 0}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TableRowsCompact({ rows, cols, compareTo, expandedRowIdx, onToggle }: {
  rows: any[];
  cols: FormField[];
  compareTo: any[][];
  expandedRowIdx: number | null;
  onToggle: (rowIdx: number) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  if (!rows || rows.length === 0) {
    return <div className="px-1 text-[11px] italic text-gray-400 dark:text-zinc-600">empty</div>;
  }
  const visible = showAll ? rows : rows.slice(0, 3);
  const hidden = rows.length - visible.length;
  return (
    <div className="space-y-0.5">
      {visible.map((row, i) => {
        const { differs } = computeRowDiff(row, i, cols, compareTo);
        const isExpanded = expandedRowIdx === i;
        const summary = cols
          .map(c => cellValue(row?.[c.field_name]))
          .filter(s => s.trim())
          .slice(0, 2)
          .join(' · ') || `Row ${i + 1}`;
        return (
          <div
            key={i}
            role="button"
            tabIndex={0}
            onClick={e => { e.stopPropagation(); onToggle(i); }}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onToggle(i); } }}
            className={cn(
              'flex select-none items-center gap-1.5 rounded px-1.5 py-0.5 text-xs transition-colors',
              isExpanded
                ? 'bg-white/80 ring-1 ring-gray-200 dark:bg-black/30 dark:ring-[#2a2a2a]'
                : differs
                  ? cn(STATE_COLORS.active.text, 'hover:bg-amber-50/80 dark:hover:bg-amber-900/20')
                  : 'text-gray-600 hover:bg-white/60 dark:text-zinc-400 dark:hover:bg-black/20',
            )}
          >
            <span className="flex-shrink-0 font-mono text-[10px] tabular-nums text-gray-400 dark:text-zinc-500">#{i + 1}</span>
            <span className="flex-1 truncate">{summary}</span>
            {differs && !isExpanded && <span className="flex-shrink-0 text-[10px] text-amber-600 dark:text-amber-300">⚠</span>}
            {isExpanded
              ? <ChevronDown className="h-2.5 w-2.5 flex-shrink-0 text-gray-400" />
              : <ChevronRight className="h-2.5 w-2.5 flex-shrink-0 text-gray-400 opacity-40" />}
          </div>
        );
      })}
      {hidden > 0 && <MoreRows hidden={hidden} onShow={() => setShowAll(true)} />}
    </div>
  );
}

function TableSourceGrid({ sources, field, picked, sourceMeta, onPick, onSeed, onJump }: {
  sources: UnifiedFieldCardProps['sources'];
  field: FormField;
  picked: Set<SourceKey>;
  sourceMeta?: UnifiedFieldCardProps['sourceMeta'];
  onPick: (key: SourceKey) => void;
  onSeed: (key: SourceKey) => void;
  onJump?: (key: SourceKey) => void;
}) {
  const cols = field.subform_fields ?? [];
  const [expanded, setExpanded] = useState<{ src: SourceKey; rowIdx: number } | null>(null);

  // A source that reported the whole table absent sends the scalar "NR"/"NA",
  // not an array. Coercing that to [] rendered it as "empty" — indistinguishable
  // from an extraction that failed, which is the opposite claim.
  const entries = (['ai', 'r1', 'r2'] as SourceKey[])
    .filter(k => sources[k] != null)
    .map(k => ({
      key: k,
      rows: Array.isArray(sources[k]) ? (sources[k] as any[]) : [],
      absence: unambiguousAbsenceLabel(sources[k]),
    }));

  const toggleRow = (src: SourceKey, rowIdx: number) =>
    setExpanded(prev => (prev?.src === src && prev.rowIdx === rowIdx ? null : { src, rowIdx }));

  const expandedEntry = expanded ? entries.find(e => e.key === expanded.src) : null;
  const expandedRow = expandedEntry ? expandedEntry.rows[expanded!.rowIdx] : null;

  const differingCells = new Set<string>();
  if (expanded && expandedRow) {
    const otherRows = entries.filter(e => e.key !== expanded.src).map(e => e.rows[expanded.rowIdx]);
    for (const col of cols) {
      const mine = cellValue(expandedRow?.[col.field_name]).trim().toLowerCase();
      if (otherRows.some(o => o === undefined || cellValue(o?.[col.field_name]).trim().toLowerCase() !== mine)) {
        differingCells.add(col.field_name);
      }
    }
  }

  return (
    <div className="mt-2.5 space-y-2">
      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: `repeat(${entries.length}, minmax(0, 1fr))` }}
      >
        {entries.map(e => (
          <SourceBox
            key={e.key}
            sourceKey={e.key}
            value={sources[e.key]}
            field={field}
            picked={picked.has(e.key)}
            meta={sourceMeta?.[e.key]}
            onPick={() => onPick(e.key)}
            onSeed={() => onSeed(e.key)}
            onJump={sourceMeta?.[e.key]?.source_text && onJump ? () => onJump(e.key) : undefined}
          >
            {e.absence ? (
              <span className="px-1 text-[11px] italic text-gray-500 dark:text-zinc-400">
                {e.absence === NR_LABEL ? 'table not reported' : 'table not applicable'}
              </span>
            ) : (
              <TableRowsCompact
                rows={e.rows}
                cols={cols}
                compareTo={entries.filter(o => o.key !== e.key).map(o => o.rows)}
                expandedRowIdx={expanded?.src === e.key ? expanded.rowIdx : null}
                onToggle={rowIdx => toggleRow(e.key, rowIdx)}
              />
            )}
          </SourceBox>
        ))}
      </div>

      {expanded && expandedRow && expandedEntry && (
        <div
          className={cn('rounded-xl border bg-white/60 px-3 py-2.5 dark:bg-[#0a0a0a]', sourceColors(expandedEntry.key).border)}
          onClick={e => e.stopPropagation()}
        >
          <div className="mb-2 flex items-center justify-between">
            <span className={cn(ML, sourceColors(expandedEntry.key).text)}>
              {sourceColors(expandedEntry.key).label} · Row #{expanded.rowIdx + 1}
            </span>
            <button
              type="button"
              onClick={e => { e.stopPropagation(); setExpanded(null); }}
              className="cursor-pointer border-none bg-transparent text-xs text-gray-400 hover:text-gray-600 dark:text-zinc-500 dark:hover:text-zinc-300"
            >
              Close
            </button>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-3">
            {cols.map((col, colIdx) => (
              <RowCell
                key={col.field_name}
                col={col}
                raw={expandedRow?.[col.field_name]}
                isDiff={differingCells.has(col.field_name)}
                fullWidth={colIdx === cols.length - 1 && cols.length % 2 !== 0}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The table editor, plus a way to say the whole table is absent.
 *
 * Per-cell NR does not express "this table is not in the paper at all", and that
 * was previously only reachable through the card's NR button. The control sits
 * above the editor and *hides* it rather than disabling it — disabling would mean
 * threading a flag through TableField → RowCard → the add-row button and the
 * per-row delete (which opens a confirm dialog), four touch points in a component
 * manual-extraction depends on.
 *
 * It writes the bare string, which is not a new shape: it is byte-identical to
 * what the extraction pipeline already emits for an absent table.
 */
function TableCustomInput({ field, value, onChange }: { field: FormField; value: any; onChange: (v: any) => void }) {
  const cols = field.subform_fields ?? [];
  const absenceVal = unambiguousAbsenceLabel(value);
  const arr: any[] = Array.isArray(value) ? value : [];
  const stringRows: Array<Record<string, string>> = arr.map(r => {
    const out: Record<string, string> = {};
    for (const col of cols) out[col.field_name] = cellValue(r?.[col.field_name]);
    return out;
  });

  return (
    <div className="mt-2 space-y-2" onClick={e => e.stopPropagation()}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-gray-400 dark:text-zinc-500">This whole table is:</span>
        {([NR_LABEL, NA_LABEL] as const).map(tok => (
          <button
            key={tok}
            type="button"
            onClick={() => onChange(absenceVal === tok ? [] : tok)}
            aria-pressed={absenceVal === tok}
            title={tok === NR_LABEL
              ? 'The paper does not report this table at all'
              : 'This table cannot apply to this study'}
            className={cn(
              'rounded-lg border px-2 py-1 text-[11px] font-medium transition-colors',
              absenceVal === tok
                ? 'border-violet-300 bg-violet-50/50 text-gray-800 dark:border-violet-600 dark:bg-violet-900/20 dark:text-zinc-200'
                : 'border-gray-200 text-gray-500 hover:border-gray-400 dark:border-[#2a2a2a] dark:text-zinc-400 dark:hover:border-[#3f3f3f]',
            )}
          >
            {tok === NR_LABEL ? 'Not reported' : 'Not applicable'}
          </button>
        ))}
      </div>
      {absenceVal ? (
        <p className="rounded-xl border border-dashed border-gray-200 px-3 py-3 text-center text-xs italic text-gray-400 dark:border-[#2a2a2a] dark:text-zinc-600">
          {absenceVal === NR_LABEL
            ? 'Not reported — no rows will be recorded for this table.'
            : 'Not applicable — this table does not apply to this study.'}
        </p>
      ) : (
        <TableField field={field} rows={stringRows} onChange={rows => onChange(rows)} />
      )}
    </div>
  );
}

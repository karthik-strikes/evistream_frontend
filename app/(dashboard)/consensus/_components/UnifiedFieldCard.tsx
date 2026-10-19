'use client';

import { cn } from '@/lib/utils';
import { CheckCircle2, AlertTriangle, Pencil, ChevronRight, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import type { FormField } from '@/types/api';
import { FieldRenderer } from '../../manual-extraction/_components/FieldRenderer';
import { TableField } from '../../manual-extraction/_components/TableField';
import { isTableField } from '../../manual-extraction/_lib/fieldKinds';

export interface UnifiedFieldCardProps {
  fieldName: string;
  field?: FormField;
  sources: {
    ai?: any;
    r1?: any;
    r2?: any;
  };
  agreed: boolean;
  suggestion?: { value: any; source: string; reason: string };
  decision: string | null;
  customValue: any;
  legacyCorrection: string;
  onDecision: (decision: string) => void;
  onCustomValue: (value: any) => void;
  onCorrection: (value: string) => void;
  onSeedFromSource?: (source: 'ai' | 'r1' | 'r2') => void;
  isActive: boolean;
  onClick: () => void;
  sourceMeta?: {
    ai?: { source_text?: string; page?: number; section?: string };
    r1?: { source_text?: string; page?: number; section?: string };
    r2?: { source_text?: string; page?: number; section?: string };
  };
  id?: string;
}

function isEmpty(v: any): boolean {
  if (v == null) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'string') return v.trim() === '';
  return false;
}

function displayBoolean(v: any): string | null {
  const s = String(v).trim().toLowerCase();
  if (['yes', 'true', '1', 'y'].includes(s)) return 'Yes';
  if (['no', 'false', '0', 'n'].includes(s)) return 'No';
  if (['nr', 'n/a', 'na'].includes(s)) return 'NR';
  return null;
}

function displayShort(v: any, field?: FormField): string {
  if (isEmpty(v)) return '';
  if (Array.isArray(v)) {
    if (v.every(x => typeof x !== 'object')) return v.join(', ');
    return `${v.length} row${v.length === 1 ? '' : 's'}`;
  }
  if (typeof v === 'object') return JSON.stringify(v);
  if (field?.field_type === 'boolean') {
    const b = displayBoolean(v);
    if (b) return b;
  }
  return String(v);
}

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
  onSeedFromSource,
  isActive,
  onClick,
  sourceMeta,
  id,
}: UnifiedFieldCardProps) {
  const [expanded, setExpanded] = useState(false);
  const sourceCount = [sources.ai, sources.r1, sources.r2].filter(v => !isEmpty(v)).length;
  const label = field?.display_name || fieldName.replace(/_/g, ' ');
  const isBoolean = field?.field_type === 'boolean';

  const seedFromSource = (src: 'ai' | 'r1' | 'r2') => {
    if (onSeedFromSource) onSeedFromSource(src);
    else {
      const value = sources[src];
      onCustomValue(value);
      onDecision('custom');
    }
  };

  const FieldMeta = () => (
    <>
      {field?.field_description && (
        <p className="text-[10px] text-gray-400 dark:text-zinc-500 mt-0.5 leading-snug">{field.field_description}</p>
      )}
      {field?.extraction_hints && (
        <p className="text-[10px] text-gray-400/70 dark:text-zinc-600 mt-0.5 leading-snug italic">{field.extraction_hints}</p>
      )}
    </>
  );

  const TypeBadge = () => field?.field_type ? (
    <span className="text-[9px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-600 bg-gray-100 dark:bg-[#1a1a1a] px-1 py-px rounded">
      {field.field_type === 'array' ? (field.subform_fields?.length ? 'table' : 'list') : field.field_type}
      {field.multiple && '·multi'}
    </span>
  ) : null;

  // ── Agreed field (≥2 sources match) — collapsed by default ──
  if (agreed) {
    const value = sources.ai ?? sources.r1 ?? sources.r2 ?? '';
    const presentLabels = [
      !isEmpty(sources.ai) && 'AI',
      !isEmpty(sources.r1) && 'R1',
      !isEmpty(sources.r2) && 'R2',
    ].filter(Boolean).join(' · ');

    if (!expanded) {
      return (
        <div
          id={id}
          className="px-4 py-2.5 cursor-pointer hover:bg-emerald-50/50 dark:hover:bg-emerald-950/20 transition-colors"
          onClick={() => setExpanded(true)}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-300 flex-shrink-0" />
              <span className="text-[11px] font-semibold text-gray-500 dark:text-zinc-500 uppercase tracking-wide truncate">{label}</span>
              {field?.required && <span className="text-[11px] text-red-400">*</span>}
            </div>
            <span className="text-[10px] font-medium text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 px-1.5 py-0.5 rounded-full flex-shrink-0">
              Agreed
            </span>
          </div>
          <div className="flex items-center gap-2 mt-0.5 ml-5">
            <span className="text-xs text-gray-500 dark:text-zinc-500 truncate">{displayShort(value, field) || '—'}</span>
            <span className="text-[10px] text-gray-300 dark:text-zinc-600 flex-shrink-0">{presentLabels.includes('·') ? `${presentLabels} all match` : presentLabels}</span>
          </div>
        </div>
      );
    }

    return (
      <div id={id} className="px-4 py-3 bg-emerald-50/30 dark:bg-emerald-950/20 border-l-2 border-emerald-500">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex items-start gap-2 min-w-0">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-300 mt-0.5" />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] font-semibold text-gray-500 dark:text-zinc-500 uppercase tracking-wide">{label}</span>
                {field?.required && <span className="text-[11px] text-red-400">*</span>}
                <TypeBadge />
              </div>
              <FieldMeta />
            </div>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded(false); }}
            className="text-[10px] text-gray-400 hover:text-gray-600 dark:text-zinc-500 dark:hover:text-zinc-300 flex-shrink-0"
          >
            Collapse
          </button>
        </div>
        <SourceGrid sources={sources} field={field} onSeed={seedFromSource} pickedDecision={decision} sourceMeta={sourceMeta} />
        <div className="flex items-center gap-1.5 flex-wrap mt-2">
          <DecisionButton label="Keep agreed" active={decision === 'agreed' || decision === null} onClick={() => onDecision('agreed')} />
          <DecisionButton label="Custom" active={decision === 'custom'} onClick={() => onDecision('custom')} />
          {!isBoolean && <DecisionButton label="NR" active={decision === 'nr'} onClick={() => onDecision('nr')} />}
        </div>
        {decision === 'custom' && <CustomInput field={field} value={customValue} onChange={onCustomValue} />}
      </div>
    );
  }

  // ── Single-source field (typically AI-only) ──
  if (sourceCount <= 1) {
    const presentSrc: 'ai' | 'r1' | 'r2' | null =
      !isEmpty(sources.ai) ? 'ai' : !isEmpty(sources.r1) ? 'r1' : !isEmpty(sources.r2) ? 'r2' : null;
    const value = presentSrc ? sources[presentSrc] : '';
    const isAi = presentSrc === 'ai';

    return (
      <div
        id={id}
        className={cn(
          'px-4 py-3 cursor-pointer transition-colors',
          isActive ? 'bg-gray-50 dark:bg-[#1a1a1a]' : 'hover:bg-gray-50/60 dark:hover:bg-[rgba(255,255,255,0.02)]'
        )}
        onClick={onClick}
      >
        <div className="flex items-start justify-between gap-2 mb-1">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] font-semibold text-gray-500 dark:text-zinc-500 uppercase tracking-wide">{label}</span>
              {field?.required && <span className="text-[11px] text-red-400">*</span>}
              <TypeBadge />
            </div>
            <FieldMeta />
          </div>
          <span className={cn(
            'text-[10px] font-medium px-1.5 py-0.5 rounded-full flex-shrink-0',
            decision === 'correct' ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40' :
            decision === 'incorrect' ? 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30' :
            decision === 'nr' ? 'text-gray-500 dark:text-zinc-400 bg-gray-100 dark:bg-[#1a1a1a]' :
            'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30'
          )}>
            {decision === 'correct' ? 'Correct' : decision === 'incorrect' ? 'Corrected' : decision === 'nr' ? 'NR' : decision === 'custom' ? 'Custom' : 'Pending'}
          </span>
        </div>
        <div className="text-sm text-gray-700 dark:text-zinc-300 mb-2 leading-snug max-h-32 overflow-y-auto">
          {presentSrc ? (
            <DisplayValue value={value} field={field} />
          ) : (
            <span className="text-gray-300 dark:text-zinc-600 italic text-xs">No value extracted</span>
          )}
          {presentSrc && !isAi && (
            <span className="ml-2 text-[10px] text-gray-400 dark:text-zinc-600">({presentSrc.toUpperCase()} only)</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {presentSrc ? (
            <>
              <button
                onClick={e => { e.stopPropagation(); onDecision(isAi ? 'correct' : `accept_${presentSrc}`); }}
                className={cn(
                  'text-xs font-medium px-3 py-1.5 rounded-lg border transition-all cursor-pointer',
                  (decision === 'correct' || decision === `accept_${presentSrc}`)
                    ? 'bg-gray-900 dark:bg-zinc-100 text-white dark:text-gray-900 border-gray-900 dark:border-zinc-100'
                    : 'bg-white dark:bg-[#111111] text-gray-500 dark:text-zinc-400 border-gray-200 dark:border-[#2a2a2a] hover:border-gray-400 dark:hover:border-[#3f3f3f]'
                )}
              >
                {isAi ? 'Correct' : `Accept ${presentSrc.toUpperCase()}`}
              </button>
              <button
                onClick={e => {
                  e.stopPropagation();
                  if (decision !== 'incorrect' && !legacyCorrection && value !== undefined && value !== null && value !== '') {
                    onCorrection(
                      typeof value === 'string' ? value
                      : Array.isArray(value) ? value.join(',')
                      : String(value)
                    );
                  }
                  onDecision('incorrect');
                }}
                className={cn(
                  'text-xs font-medium px-3 py-1.5 rounded-lg border transition-all cursor-pointer',
                  decision === 'incorrect'
                    ? 'bg-gray-200 dark:bg-[#2a2a2a] text-gray-700 dark:text-zinc-300 border-gray-300 dark:border-[#3a3a3a]'
                    : 'bg-white dark:bg-[#111111] text-gray-500 dark:text-zinc-400 border-gray-200 dark:border-[#2a2a2a] hover:border-gray-400 dark:hover:border-[#3f3f3f]'
                )}
              >
                Correction
              </button>
            </>
          ) : (
            <DecisionButton label="Custom" active={decision === 'custom'} onClick={() => onDecision('custom')} />
          )}
          {!isBoolean && <DecisionButton label="NR" active={decision === 'nr'} onClick={() => onDecision('nr')} />}
        </div>
        {decision === 'incorrect' && (
          <div className="mt-2" onClick={e => e.stopPropagation()}>
            {field ? (
              <FieldRenderer field={field} value={legacyCorrection} onChange={(v) => onCorrection(typeof v === 'string' ? v : Array.isArray(v) ? v.join(',') : String(v ?? ''))} index={0} compact />
            ) : (
              <input
                type="text"
                value={legacyCorrection}
                onChange={e => onCorrection(e.target.value)}
                placeholder="Add correction (optional)"
                className="w-full text-sm text-gray-700 dark:text-zinc-300 bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a] rounded-lg px-3 py-1.5 outline-none focus:border-gray-400 dark:focus:border-[#3f3f3f]"
              />
            )}
          </div>
        )}
        {decision === 'custom' && <CustomInput field={field} value={customValue} onChange={onCustomValue} />}
      </div>
    );
  }

  // ── Multi-source disputed field ──
  return (
    <div
      id={id}
      className={cn(
        'px-4 py-3 cursor-pointer transition-colors border-l-2 border-amber-500',
        isActive ? 'bg-amber-50/60 dark:bg-amber-900/15' : 'hover:bg-gray-50/60 dark:hover:bg-[rgba(255,255,255,0.02)]'
      )}
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-start gap-2 min-w-0">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-300 mt-0.5 flex-shrink-0" />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] font-semibold text-gray-500 dark:text-zinc-500 uppercase tracking-wide">{label}</span>
              {field?.required && <span className="text-[11px] text-red-400">*</span>}
              <TypeBadge />
            </div>
            <FieldMeta />
          </div>
        </div>
        <span className="text-[10px] font-medium text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 px-1.5 py-0.5 rounded-full flex-shrink-0">
          {sourceCount - 1} of {sourceCount} disagree
        </span>
      </div>

      <SourceGrid sources={sources} field={field} onSeed={seedFromSource} pickedDecision={decision} />

      <div className="flex items-center gap-1.5 flex-wrap mt-2">
        {sources.ai != null && (
          <DecisionButton label="AI" active={decision === 'accept_ai'} onClick={() => onDecision('accept_ai')} color="blue" />
        )}
        {sources.r1 != null && (
          <DecisionButton label="R1" active={decision === 'accept_r1'} onClick={() => onDecision('accept_r1')} color="orange" />
        )}
        {sources.r2 != null && (
          <DecisionButton label="R2" active={decision === 'accept_r2'} onClick={() => onDecision('accept_r2')} color="emerald" />
        )}
        <DecisionButton label="Custom" active={decision === 'custom'} onClick={() => onDecision('custom')} />
        {!isBoolean && <DecisionButton label="NR" active={decision === 'nr'} onClick={() => onDecision('nr')} />}
      </div>

      {decision === 'custom' && <CustomInput field={field} value={customValue} onChange={onCustomValue} />}
    </div>
  );
}

// ── Internal helpers ──

function SourceGrid({ sources, field, onSeed, pickedDecision, sourceMeta }: {
  sources: UnifiedFieldCardProps['sources'];
  field?: FormField;
  onSeed: (source: 'ai' | 'r1' | 'r2') => void;
  pickedDecision: string | null;
  sourceMeta?: UnifiedFieldCardProps['sourceMeta'];
}) {
  if (field && isTableField(field)) {
    return <TableSourceGrid sources={sources} field={field} onSeed={onSeed} pickedDecision={pickedDecision} sourceMeta={sourceMeta} />;
  }
  type Entry = { key: 'ai' | 'r1' | 'r2'; label: string; value: any; bg: string; labelColor: string; activeBg: string; meta?: { source_text?: string; page?: number } };
  const entries: Entry[] = [];

  if (sources.ai != null) entries.push({
    key: 'ai', label: 'AI', value: sources.ai,
    bg: 'bg-blue-50/70 dark:bg-blue-950/40',
    activeBg: 'ring-1 ring-blue-500 dark:ring-blue-400 bg-blue-100/80 dark:bg-blue-900/40',
    labelColor: 'text-blue-600 dark:text-blue-300',
    meta: sourceMeta?.ai,
  });
  if (sources.r1 != null) entries.push({
    key: 'r1', label: 'Reviewer 1', value: sources.r1,
    bg: 'bg-orange-50/70 dark:bg-orange-950/40',
    activeBg: 'ring-1 ring-orange-500 dark:ring-orange-400 bg-orange-100/80 dark:bg-orange-900/40',
    labelColor: 'text-orange-600 dark:text-orange-300',
    meta: sourceMeta?.r1,
  });
  if (sources.r2 != null) entries.push({
    key: 'r2', label: 'Reviewer 2', value: sources.r2,
    bg: 'bg-emerald-50/70 dark:bg-emerald-950/40',
    activeBg: 'ring-1 ring-emerald-500 dark:ring-emerald-400 bg-emerald-100/80 dark:bg-emerald-900/40',
    labelColor: 'text-emerald-600 dark:text-emerald-300',
    meta: sourceMeta?.r2,
  });

  const cols = entries.length >= 3 ? 'grid-cols-3' : entries.length === 2 ? 'grid-cols-2' : 'grid-cols-1';

  return (
    <div className={cn('grid gap-2', cols)}>
      {entries.map(e => {
        const active = pickedDecision === `accept_${e.key}`;
        return (
          <div key={e.key} className={cn('relative rounded-lg px-2.5 py-2 transition-all', active ? e.activeBg : e.bg)}>
            <div className="flex items-center justify-between mb-0.5 gap-1">
              <div className={cn('text-[10px] font-semibold uppercase tracking-wide', e.labelColor)}>{e.label}</div>
              <button
                type="button"
                onClick={(ev) => { ev.stopPropagation(); onSeed(e.key); }}
                title={`Edit from ${e.label}'s value`}
                className="text-gray-400 dark:text-zinc-600 hover:text-gray-600 dark:hover:text-zinc-300 p-0.5 cursor-pointer bg-transparent border-none"
              >
                <Pencil className="w-2.5 h-2.5" />
              </button>
            </div>
            <div className="text-xs text-gray-700 dark:text-zinc-300 leading-snug max-h-24 overflow-y-auto">
              <DisplayValue value={e.value} field={field} />
            </div>
            <SourceEvidence meta={e.meta} />
          </div>
        );
      })}
    </div>
  );
}

function DisplayValue({ value, field }: { value: any; field?: FormField }) {
  if (isEmpty(value)) {
    return <span className="italic text-gray-300 dark:text-zinc-600">empty</span>;
  }
  if (Array.isArray(value)) {
    if (field && isTableField(field)) {
      return <TableRowsPreview rows={value} cols={field.subform_fields ?? []} compareTo={[]} />;
    }
    if (value.every(v => typeof v !== 'object' || v === null)) {
      return (
        <div className="flex flex-wrap gap-1">
          {value.map((v, i) => (
            <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-white/70 dark:bg-black/30 border border-gray-200 dark:border-[#2a2a2a]">{String(v)}</span>
          ))}
        </div>
      );
    }
    return <span className="font-mono text-[10px] break-all">{`${value.length} row${value.length === 1 ? '' : 's'} (table)`}</span>;
  }
  if (typeof value === 'object') {
    return <span className="font-mono text-[10px] break-all">{JSON.stringify(value)}</span>;
  }
  if (field?.field_type === 'boolean') {
    const b = displayBoolean(value);
    if (b === 'NR') return <span className="italic text-gray-400">NR</span>;
    if (b) return <span>{b}</span>;
  }
  return <span className="break-words">{String(value)}</span>;
}

function DecisionButton({ label, active, onClick, color }: {
  label: string;
  active: boolean;
  onClick: () => void;
  color?: 'gray' | 'blue' | 'orange' | 'emerald' | 'purple';
}) {
  const activeColors: Record<string, string> = {
    gray: 'bg-gray-900 dark:bg-zinc-100 text-white dark:text-gray-900 border-gray-900 dark:border-zinc-100',
    blue: 'bg-blue-600 dark:bg-blue-500 text-white border-blue-600 dark:border-blue-500',
    orange: 'bg-orange-600 dark:bg-orange-500 text-white border-orange-600 dark:border-orange-500',
    emerald: 'bg-emerald-600 dark:bg-emerald-500 text-white border-emerald-600 dark:border-emerald-500',
    purple: 'bg-purple-600 dark:bg-purple-500 text-white border-purple-600 dark:border-purple-500',
  };
  return (
    <button
      onClick={e => { e.stopPropagation(); onClick(); }}
      className={cn(
        'text-[11px] font-medium px-2.5 py-1 rounded-lg border transition-all cursor-pointer',
        active ? activeColors[color ?? 'gray'] : 'bg-white dark:bg-[#111111] text-gray-500 dark:text-zinc-400 border-gray-200 dark:border-[#2a2a2a] hover:border-gray-400'
      )}
    >
      {label}
    </button>
  );
}

function CustomInput({ field, value, onChange }: { field?: FormField; value: any; onChange: (v: any) => void }) {
  if (field && isTableField(field)) {
    return <TableCustomInput field={field} value={value} onChange={onChange} />;
  }
  if (field) {
    return (
      <div className="mt-2" onClick={e => e.stopPropagation()}>
        <FieldRenderer field={field} value={value ?? ''} onChange={onChange} index={0} compact />
      </div>
    );
  }
  return (
    <div className="mt-2">
      <input
        type="text"
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        onClick={e => e.stopPropagation()}
        placeholder="Enter custom value..."
        className="w-full text-xs text-gray-700 dark:text-zinc-300 bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a] rounded-lg px-3 py-1.5 outline-none focus:border-gray-400 dark:focus:border-[#3f3f3f] placeholder:text-gray-300 dark:placeholder:text-zinc-600"
      />
    </div>
  );
}

// ── Table-specific helpers ────────────────────────────────────────────────────

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
function cellMeta(raw: any): { source_text?: string; page?: number; section?: string } | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const meta: { source_text?: string; page?: number; section?: string } = {};
  if (typeof raw.source_text === 'string') {
    const t = raw.source_text.trim();
    if (t && t !== 'NR') meta.source_text = raw.source_text;
  }
  if (typeof raw.page === 'number') meta.page = raw.page;
  if (typeof raw.section === 'string' && raw.section.trim()) meta.section = raw.section;
  return Object.keys(meta).length > 0 ? meta : undefined;
}

function rowKey(row: any): string {
  try { return JSON.stringify(row, Object.keys(row ?? {}).sort()); } catch { return String(row); }
}

function TableRowsPreview({ rows, cols, compareTo }: {
  rows: any[];
  cols: FormField[];
  compareTo: any[][];
}) {
  const [showAll, setShowAll] = useState(false);
  if (!rows || rows.length === 0) {
    return <div className="text-[11px] italic text-gray-400 dark:text-zinc-600 px-1">empty</div>;
  }
  const visible = showAll ? rows : rows.slice(0, 3);
  const hidden = rows.length - visible.length;
  return (
    <div className="space-y-1">
      {visible.map((row, i) => {
        const otherRowsAtIdx = compareTo.map(o => o[i]).filter(o => o !== undefined);
        const differingCells = new Set<string>();
        for (const col of cols) {
          const mine = cellValue(row?.[col.field_name]).trim().toLowerCase();
          const someOtherDiffers = otherRowsAtIdx.some(other =>
            cellValue(other?.[col.field_name]).trim().toLowerCase() !== mine
          );
          if (someOtherDiffers) differingCells.add(col.field_name);
        }
        const rowDiffers = otherRowsAtIdx.length === 0
          ? false
          : differingCells.size > 0 || compareTo.some(o => o[i] === undefined);

        return (
          <TableRowCard
            key={i}
            row={row}
            rowIdx={i}
            cols={cols}
            differs={rowDiffers}
            differingCells={differingCells}
          />
        );
      })}
      {hidden > 0 && (
        <button
          type="button"
          onClick={(ev) => { ev.stopPropagation(); setShowAll(true); }}
          className="text-[11px] text-gray-400 hover:text-gray-600 dark:text-zinc-600 dark:hover:text-zinc-300 px-1.5 cursor-pointer bg-transparent border-none"
        >
          + {hidden} more row{hidden === 1 ? '' : 's'}
        </button>
      )}
    </div>
  );
}

function TableRowCard({ row, rowIdx, cols, differs, differingCells }: {
  row: any;
  rowIdx: number;
  cols: FormField[];
  differs: boolean;
  differingCells: Set<string>;
}) {
  const [expanded, setExpanded] = useState(false);
  const summary = cols
    .map(c => cellValue(row?.[c.field_name]))
    .filter(s => s.trim())
    .slice(0, 2)
    .join(' · ') || `Row ${rowIdx + 1}`;
  const filled = cols.filter(c => cellValue(row?.[c.field_name]).trim()).length;
  const total = cols.length;
  return (
    <div className={cn(
      'rounded-lg border overflow-hidden bg-white/60 dark:bg-[#0f0f0f]',
      differs
        ? 'border-amber-300 dark:border-amber-700/50'
        : 'border-gray-100 dark:border-[#1f1f1f]',
    )}>
      <div
        role="button"
        tabIndex={0}
        onClick={(e) => { e.stopPropagation(); setExpanded(p => !p); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            setExpanded(p => !p);
          }
        }}
        className={cn(
          'flex items-center gap-1.5 px-2 py-1.5 cursor-pointer transition-colors select-none',
          differs
            ? 'hover:bg-amber-50/80 dark:hover:bg-amber-900/20'
            : 'hover:bg-gray-50/60 dark:hover:bg-[rgba(255,255,255,0.02)]'
        )}
      >
        {expanded
          ? <ChevronDown className="w-3 h-3 text-gray-400 flex-shrink-0" />
          : <ChevronRight className="w-3 h-3 text-gray-400 flex-shrink-0" />}
        <span className="font-mono text-[9px] text-gray-300 dark:text-zinc-600 tabular-nums flex-shrink-0">#{rowIdx + 1}</span>
        <span className={cn(
          'flex-1 truncate text-[11px]',
          differs ? 'text-amber-700 dark:text-amber-300' : 'text-gray-600 dark:text-zinc-400',
        )}>
          {summary}
        </span>
        <span className="text-[9px] text-gray-300 dark:text-zinc-600 tabular-nums flex-shrink-0">{filled}/{total}</span>
        {differs && <span className="text-[9px] text-amber-600 dark:text-amber-300 flex-shrink-0">⚠</span>}
      </div>
      {expanded && (
        <div className="border-t border-gray-100 dark:border-[#1f1f1f] px-2.5 py-2 bg-white/40 dark:bg-[#0a0a0a]">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
            {cols.map((col, colIdx) => {
              const fullWidth = colIdx === cols.length - 1 && cols.length % 2 !== 0;
              const val = cellValue(row?.[col.field_name]);
              const meta = cellMeta(row?.[col.field_name]);
              const isDiff = differingCells.has(col.field_name);
              return (
                <div
                  key={col.field_name}
                  className={cn(
                    fullWidth && 'col-span-2',
                    isDiff && 'bg-amber-50/80 dark:bg-amber-900/25 -mx-1 px-1 rounded',
                  )}
                >
                  <p className={cn(
                    'text-[10px] font-bold uppercase tracking-normal mb-0.5 leading-none',
                    isDiff
                      ? 'text-amber-700 dark:text-amber-300'
                      : 'text-gray-400 dark:text-zinc-500',
                  )}>
                    {(col.display_name || col.field_name).replace(/_/g, ' ')}
                  </p>
                  <p className={cn(
                    'text-[13px] leading-snug break-words',
                    val.trim()
                      ? 'text-gray-700 dark:text-zinc-300'
                      : 'text-gray-400 dark:text-zinc-500 italic',
                  )}>
                    {val.trim() || 'empty'}
                  </p>
                  <SourceEvidence meta={meta} />
                </div>
              );
            })}
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
    return <div className="text-[11px] italic text-gray-400 dark:text-zinc-600 px-1">empty</div>;
  }
  const visible = showAll ? rows : rows.slice(0, 3);
  const hidden = rows.length - visible.length;
  return (
    <div className="space-y-0.5">
      {visible.map((row, i) => {
        const otherRowsAtIdx = compareTo.map(o => o[i]).filter(o => o !== undefined);
        const differs = otherRowsAtIdx.length > 0 && (
          compareTo.some(o => o[i] === undefined) ||
          cols.some(col =>
            cellValue(row?.[col.field_name]).trim().toLowerCase() !==
            otherRowsAtIdx.find(o => o !== undefined)?.[col.field_name] !== undefined &&
            otherRowsAtIdx.some(other =>
              cellValue(other?.[col.field_name]).trim().toLowerCase() !==
              cellValue(row?.[col.field_name]).trim().toLowerCase()
            )
          )
        );
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
            onClick={(e) => { e.stopPropagation(); onToggle(i); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onToggle(i); } }}
            className={cn(
              'flex items-center gap-1.5 text-[12px] px-1.5 py-0.5 rounded cursor-pointer select-none transition-colors',
              isExpanded
                ? 'bg-white/80 dark:bg-black/30 ring-1 ring-gray-200 dark:ring-[#2a2a2a]'
                : differs
                  ? 'text-amber-700 dark:text-amber-300 hover:bg-amber-50/80 dark:hover:bg-amber-900/20'
                  : 'text-gray-600 dark:text-zinc-400 hover:bg-white/60 dark:hover:bg-black/20',
            )}
          >
            <span className="font-mono text-[10px] text-gray-400 dark:text-zinc-500 tabular-nums flex-shrink-0">#{i + 1}</span>
            <span className="truncate flex-1">{summary}</span>
            {differs && !isExpanded && <span className="text-[10px] text-amber-600 dark:text-amber-300 flex-shrink-0">⚠</span>}
            {isExpanded && <ChevronDown className="w-2.5 h-2.5 text-gray-400 flex-shrink-0" />}
            {!isExpanded && <ChevronRight className="w-2.5 h-2.5 text-gray-400 flex-shrink-0 opacity-40" />}
          </div>
        );
      })}
      {hidden > 0 && (
        <button
          type="button"
          onClick={(ev) => { ev.stopPropagation(); setShowAll(true); }}
          className="text-[11px] text-gray-400 hover:text-gray-600 dark:text-zinc-600 dark:hover:text-zinc-300 px-1.5 cursor-pointer bg-transparent border-none"
        >
          + {hidden} more row{hidden === 1 ? '' : 's'}
        </button>
      )}
    </div>
  );
}

function TableSourceGrid({ sources, field, onSeed, pickedDecision, sourceMeta }: {
  sources: UnifiedFieldCardProps['sources'];
  field: FormField;
  onSeed: (source: 'ai' | 'r1' | 'r2') => void;
  pickedDecision: string | null;
  sourceMeta?: UnifiedFieldCardProps['sourceMeta'];
}) {
  const cols = field.subform_fields ?? [];
  const [expanded, setExpanded] = useState<{ src: 'ai' | 'r1' | 'r2'; rowIdx: number } | null>(null);

  type Entry = { key: 'ai' | 'r1' | 'r2'; label: string; rows: any[]; bg: string; activeBg: string; labelColor: string; borderColor: string };
  const entries: Entry[] = [];
  if (sources.ai != null) entries.push({
    key: 'ai', label: 'AI', rows: Array.isArray(sources.ai) ? sources.ai : [],
    bg: 'bg-blue-50/70 dark:bg-blue-950/40',
    activeBg: 'ring-1 ring-blue-500 dark:ring-blue-400 bg-blue-100/80 dark:bg-blue-900/40',
    labelColor: 'text-blue-600 dark:text-blue-300',
    borderColor: 'border-blue-300 dark:border-blue-700',
  });
  if (sources.r1 != null) entries.push({
    key: 'r1', label: 'Reviewer 1', rows: Array.isArray(sources.r1) ? sources.r1 : [],
    bg: 'bg-orange-50/70 dark:bg-orange-950/40',
    activeBg: 'ring-1 ring-orange-500 dark:ring-orange-400 bg-orange-100/80 dark:bg-orange-900/40',
    labelColor: 'text-orange-600 dark:text-orange-300',
    borderColor: 'border-orange-300 dark:border-orange-700',
  });
  if (sources.r2 != null) entries.push({
    key: 'r2', label: 'Reviewer 2', rows: Array.isArray(sources.r2) ? sources.r2 : [],
    bg: 'bg-emerald-50/70 dark:bg-emerald-950/40',
    activeBg: 'ring-1 ring-emerald-500 dark:ring-emerald-400 bg-emerald-100/80 dark:bg-emerald-900/40',
    labelColor: 'text-emerald-600 dark:text-emerald-300',
    borderColor: 'border-emerald-300 dark:border-emerald-700',
  });

  const gridCols = entries.length >= 3 ? 'grid-cols-3' : entries.length === 2 ? 'grid-cols-2' : 'grid-cols-1';

  const toggleRow = (src: 'ai' | 'r1' | 'r2', rowIdx: number) => {
    setExpanded(prev =>
      prev?.src === src && prev.rowIdx === rowIdx ? null : { src, rowIdx }
    );
  };

  const expandedEntry = expanded ? entries.find(e => e.key === expanded.src) : null;
  const expandedRow = expandedEntry ? expandedEntry.rows[expanded!.rowIdx] : null;

  const differingCells = new Set<string>();
  if (expanded && expandedRow) {
    const otherRows = entries.filter(e => e.key !== expanded.src).map(e => e.rows[expanded.rowIdx]);
    for (const col of cols) {
      const mine = cellValue(expandedRow?.[col.field_name]).trim().toLowerCase();
      if (otherRows.some(other => other === undefined || cellValue(other?.[col.field_name]).trim().toLowerCase() !== mine)) {
        differingCells.add(col.field_name);
      }
    }
  }

  return (
    <div className="space-y-2">
      <div className={cn('grid gap-2', gridCols)}>
        {entries.map(e => {
          const active = pickedDecision === `accept_${e.key}`;
          const compareTo = entries.filter(o => o.key !== e.key).map(o => o.rows);
          return (
            <div key={e.key} className={cn('relative rounded-lg px-2.5 py-2 transition-all', active ? e.activeBg : e.bg)}>
              <div className="flex items-center justify-between mb-0.5 gap-1">
                <div className={cn('text-[11px] font-semibold uppercase tracking-wide', e.labelColor)}>{e.label}</div>
                <button
                  type="button"
                  onClick={(ev) => { ev.stopPropagation(); onSeed(e.key); }}
                  title={`Edit from ${e.label}'s table`}
                  className="text-gray-400 dark:text-zinc-600 hover:text-gray-600 dark:hover:text-zinc-300 p-0.5 cursor-pointer bg-transparent border-none"
                >
                  <Pencil className="w-2.5 h-2.5" />
                </button>
              </div>
              <TableRowsCompact
                rows={e.rows}
                cols={cols}
                compareTo={compareTo}
                expandedRowIdx={expanded?.src === e.key ? expanded.rowIdx : null}
                onToggle={(rowIdx) => toggleRow(e.key, rowIdx)}
              />
              <SourceEvidence meta={sourceMeta?.[e.key]} />
            </div>
          );
        })}
      </div>

      {expanded && expandedRow && expandedEntry && (
        <div
          className={cn('rounded-lg border px-3 py-2.5', expandedEntry.borderColor, 'bg-white/60 dark:bg-[#0a0a0a]')}
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-2">
            <span className={cn('text-[11px] font-semibold uppercase tracking-wide', expandedEntry.labelColor)}>
              {expandedEntry.label} · Row #{expanded.rowIdx + 1}
            </span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setExpanded(null); }}
              className="text-[11px] text-gray-400 hover:text-gray-600 dark:text-zinc-500 dark:hover:text-zinc-300 cursor-pointer bg-transparent border-none"
            >
              Close
            </button>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-3">
            {cols.map((col, colIdx) => {
              const fullWidth = colIdx === cols.length - 1 && cols.length % 2 !== 0;
              const val = cellValue(expandedRow?.[col.field_name]);
              const meta = cellMeta(expandedRow?.[col.field_name]);
              const isDiff = differingCells.has(col.field_name);
              return (
                <div key={col.field_name} className={cn(fullWidth && 'col-span-2')}>
                  <p className={cn(
                    'text-[10px] font-bold uppercase tracking-normal mb-0.5 leading-none',
                    isDiff ? 'text-amber-700 dark:text-amber-300' : 'text-gray-400 dark:text-zinc-500',
                  )}>
                    {(col.display_name || col.field_name).replace(/_/g, ' ')}
                    {isDiff && <span className="ml-1 text-amber-500">⚠</span>}
                  </p>
                  <p className={cn(
                    'text-[13px] leading-snug break-words',
                    val.trim() ? 'text-gray-700 dark:text-zinc-300' : 'text-gray-400 dark:text-zinc-500 italic',
                  )}>
                    {val.trim() || 'empty'}
                  </p>
                  <SourceEvidence meta={meta} />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function TableCustomInput({ field, value, onChange }: { field: FormField; value: any; onChange: (v: any) => void }) {
  const cols = field.subform_fields ?? [];
  const arr: any[] = Array.isArray(value) ? value : [];
  const stringRows: Array<Record<string, string>> = arr.map(r => {
    const out: Record<string, string> = {};
    for (const col of cols) out[col.field_name] = cellValue(r?.[col.field_name]);
    return out;
  });
  return (
    <div className="mt-2" onClick={e => e.stopPropagation()}>
      <TableField field={field} rows={stringRows} onChange={(rows) => onChange(rows)} />
    </div>
  );
}

function SourceEvidence({ meta }: { meta?: { source_text?: string; page?: number; section?: string } }) {
  if (!meta?.source_text) return null;
  const text = meta.source_text.length > 120 ? meta.source_text.slice(0, 120) + '…' : meta.source_text;
  return (
    <div className="mt-1.5 text-[10px] italic text-gray-400 dark:text-zinc-500 border-l-2 border-gray-200 dark:border-[#2a2a2a] pl-2 leading-relaxed">
      &ldquo;{text}&rdquo;
      {meta.page && (
        <span className="ml-1.5 not-italic font-semibold text-blue-500 dark:text-blue-400">p.{meta.page}</span>
      )}
    </div>
  );
}

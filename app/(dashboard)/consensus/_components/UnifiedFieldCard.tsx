'use client';

import { cn } from '@/lib/utils';
import { CheckCircle2, AlertTriangle, Lightbulb } from 'lucide-react';
import { useState } from 'react';

export interface UnifiedFieldCardProps {
  fieldName: string;
  sources: {
    ai?: string | null;
    r1?: string | null;
    r2?: string | null;
  };
  agreed: boolean;
  suggestion?: { value: string; source: string; reason: string };
  decision: string | null; // 'accept_ai' | 'accept_r1' | 'accept_r2' | 'custom' | 'correct' | 'incorrect' | 'agreed'
  customValue: string;
  legacyCorrection: string;
  onDecision: (decision: string) => void;
  onCustomValue: (value: string) => void;
  onCorrection: (value: string) => void;
  isActive: boolean;
  onClick: () => void;
}

export function UnifiedFieldCard({
  fieldName,
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
}: UnifiedFieldCardProps) {
  const [expanded, setExpanded] = useState(false);
  const sourceCount = [sources.ai, sources.r1, sources.r2].filter(v => v != null).length;
  const label = fieldName.replace(/_/g, ' ');

  // ── Agreed field (all sources match) — collapsed by default ──
  if (agreed) {
    const value = sources.ai ?? sources.r1 ?? sources.r2 ?? '';
    const sourceLabels = [
      sources.ai != null && 'AI',
      sources.r1 != null && 'R1',
      sources.r2 != null && 'R2',
    ].filter(Boolean).join(' · ');

    if (!expanded) {
      return (
        <div
          className="px-4 py-2.5 cursor-pointer hover:bg-green-50/30 dark:hover:bg-green-900/5 transition-colors"
          onClick={() => setExpanded(true)}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <CheckCircle2 className="w-3.5 h-3.5 text-green-500 dark:text-green-400 flex-shrink-0" />
              <span className="text-[11px] font-semibold text-gray-500 dark:text-zinc-500 uppercase tracking-wide truncate">{label}</span>
            </div>
            <span className="text-[10px] font-medium text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 px-1.5 py-0.5 rounded-full flex-shrink-0">
              Agreed
            </span>
          </div>
          <div className="flex items-center gap-2 mt-0.5 ml-5.5">
            <span className="text-xs text-gray-500 dark:text-zinc-500 truncate">{value || '—'}</span>
            <span className="text-[10px] text-gray-300 dark:text-zinc-600 flex-shrink-0">{sourceLabels} all match</span>
          </div>
        </div>
      );
    }

    // Expanded agreed — let user override
    return (
      <div className="px-4 py-3 bg-green-50/20 dark:bg-green-900/5 border-l-2 border-green-400">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-green-500 dark:text-green-400" />
            <span className="text-[11px] font-semibold text-gray-500 dark:text-zinc-500 uppercase tracking-wide">{label}</span>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded(false); }}
            className="text-[10px] text-gray-400 hover:text-gray-600 dark:text-zinc-500 dark:hover:text-zinc-300"
          >
            Collapse
          </button>
        </div>
        <SourceGrid sources={sources} />
        <div className="flex items-center gap-1.5 mt-2">
          <DecisionButton label="Keep agreed" active={decision === 'agreed' || decision === null} onClick={() => onDecision('agreed')} />
          <DecisionButton label="Custom" active={decision === 'custom'} onClick={() => onDecision('custom')} />
        </div>
        {decision === 'custom' && (
          <CustomInput value={customValue} onChange={onCustomValue} />
        )}
      </div>
    );
  }

  // ── AI-only field (single source) ──
  if (sourceCount === 1 && sources.ai != null) {
    return (
      <div
        className={cn(
          'px-4 py-3 cursor-pointer transition-colors',
          isActive ? 'bg-gray-50 dark:bg-[#1a1a1a]' : 'hover:bg-gray-50/60 dark:hover:bg-[rgba(255,255,255,0.02)]'
        )}
        onClick={onClick}
      >
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] font-semibold text-gray-500 dark:text-zinc-500 uppercase tracking-wide">{label}</span>
          <span className={cn(
            'text-[10px] font-medium px-1.5 py-0.5 rounded-full',
            decision === 'correct' ? 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20' :
            decision === 'incorrect' ? 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20' :
            'text-gray-500 dark:text-zinc-500 bg-gray-100 dark:bg-[#1a1a1a]'
          )}>
            {decision === 'correct' ? 'Correct' : decision === 'incorrect' ? 'Corrected' : 'Pending'}
          </span>
        </div>
        <div className="text-sm text-gray-700 dark:text-zinc-300 mb-2 leading-snug">
          {sources.ai || <span className="text-gray-300 dark:text-zinc-600 italic text-xs">No value extracted</span>}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={e => { e.stopPropagation(); onDecision('correct'); }}
            className={cn(
              'flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-all',
              decision === 'correct'
                ? 'bg-gray-900 dark:bg-zinc-100 text-white dark:text-gray-900 border-gray-900 dark:border-zinc-100'
                : 'bg-white dark:bg-[#111111] text-gray-500 dark:text-zinc-400 border-gray-200 dark:border-[#2a2a2a] hover:border-gray-400 dark:hover:border-[#3f3f3f]'
            )}
          >
            Correct
          </button>
          <button
            onClick={e => { e.stopPropagation(); onDecision('incorrect'); }}
            className={cn(
              'flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-all',
              decision === 'incorrect'
                ? 'bg-gray-200 dark:bg-[#2a2a2a] text-gray-700 dark:text-zinc-300 border-gray-300 dark:border-[#3a3a3a]'
                : 'bg-white dark:bg-[#111111] text-gray-500 dark:text-zinc-400 border-gray-200 dark:border-[#2a2a2a] hover:border-gray-400 dark:hover:border-[#3f3f3f]'
            )}
          >
            Wrong
          </button>
        </div>
        {decision === 'incorrect' && (
          <div className="mt-2">
            <input
              type="text"
              value={legacyCorrection}
              onChange={e => onCorrection(e.target.value)}
              onClick={e => e.stopPropagation()}
              placeholder="Add correction (optional)"
              className="w-full text-sm text-gray-700 dark:text-zinc-300 bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a] rounded-lg px-3 py-1.5 outline-none focus:border-gray-400 dark:focus:border-[#3f3f3f] placeholder:text-gray-300 dark:placeholder:text-zinc-600"
            />
          </div>
        )}
      </div>
    );
  }

  // ── Multi-source disputed field ──
  return (
    <div
      className={cn(
        'px-4 py-3 cursor-pointer transition-colors border-l-2 border-amber-400',
        isActive ? 'bg-amber-50/40 dark:bg-amber-900/5' : 'hover:bg-gray-50/60 dark:hover:bg-[rgba(255,255,255,0.02)]'
      )}
      onClick={onClick}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400" />
          <span className="text-[11px] font-semibold text-gray-500 dark:text-zinc-500 uppercase tracking-wide">{label}</span>
        </div>
        <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-1.5 py-0.5 rounded-full">
          {sourceCount - 1} of {sourceCount} disagree
        </span>
      </div>

      <SourceGrid sources={sources} />

      {/* Majority suggestion banner */}
      {suggestion && (
        <div className="mt-2 rounded-lg bg-blue-50/60 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-900/30 px-3 py-2">
          <div className="flex items-start gap-2">
            <Lightbulb className="w-3.5 h-3.5 text-blue-500 dark:text-blue-400 mt-0.5 flex-shrink-0" />
            <div className="min-w-0">
              <div className="text-[11px] font-medium text-blue-700 dark:text-blue-300">
                Suggested: &ldquo;{suggestion.value}&rdquo;
              </div>
              <div className="text-[10px] text-blue-500 dark:text-blue-400 mt-0.5">{suggestion.reason}</div>
            </div>
          </div>
          <button
            onClick={e => { e.stopPropagation(); onDecision('accept_suggestion'); }}
            className={cn(
              'mt-1.5 text-[11px] font-medium px-3 py-1 rounded-lg border transition-all',
              decision === 'accept_suggestion'
                ? 'bg-blue-600 dark:bg-blue-500 text-white border-blue-600 dark:border-blue-500'
                : 'bg-white dark:bg-[#111111] text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800 hover:bg-blue-50 dark:hover:bg-blue-900/20'
            )}
          >
            Accept suggestion
          </button>
        </div>
      )}

      {/* Source decision buttons */}
      <div className="flex items-center gap-1.5 flex-wrap mt-2">
        {sources.ai != null && (
          <DecisionButton
            label="AI"
            active={decision === 'accept_ai'}
            onClick={() => onDecision('accept_ai')}
            color="gray"
          />
        )}
        {sources.r1 != null && (
          <DecisionButton
            label="R1"
            active={decision === 'accept_r1'}
            onClick={() => onDecision('accept_r1')}
            color="blue"
          />
        )}
        {sources.r2 != null && (
          <DecisionButton
            label="R2"
            active={decision === 'accept_r2'}
            onClick={() => onDecision('accept_r2')}
            color="purple"
          />
        )}
        <DecisionButton
          label="Custom"
          active={decision === 'custom'}
          onClick={() => onDecision('custom')}
        />
      </div>

      {decision === 'custom' && (
        <CustomInput value={customValue} onChange={onCustomValue} />
      )}
    </div>
  );
}

// ── Internal helpers ──

function SourceGrid({ sources }: { sources: UnifiedFieldCardProps['sources'] }) {
  const entries: { key: string; label: string; value: string | null | undefined; bg: string; labelColor: string }[] = [];

  if (sources.ai != null) entries.push({
    key: 'ai', label: 'AI', value: sources.ai,
    bg: 'bg-gray-50 dark:bg-[#1a1a1a]',
    labelColor: 'text-gray-400 dark:text-zinc-500',
  });
  if (sources.r1 != null) entries.push({
    key: 'r1', label: 'Reviewer 1', value: sources.r1,
    bg: 'bg-blue-50/50 dark:bg-blue-900/10',
    labelColor: 'text-blue-500 dark:text-blue-400',
  });
  if (sources.r2 != null) entries.push({
    key: 'r2', label: 'Reviewer 2', value: sources.r2,
    bg: 'bg-purple-50/50 dark:bg-purple-900/10',
    labelColor: 'text-purple-500 dark:text-purple-400',
  });

  const cols = entries.length >= 3 ? 'grid-cols-3' : entries.length === 2 ? 'grid-cols-2' : 'grid-cols-1';

  return (
    <div className={cn('grid gap-2', cols)}>
      {entries.map(e => (
        <div key={e.key} className={cn('rounded-lg px-2.5 py-2', e.bg)}>
          <div className={cn('text-[10px] font-semibold uppercase tracking-wide mb-0.5', e.labelColor)}>{e.label}</div>
          <div className="text-xs text-gray-700 dark:text-zinc-300 leading-snug">
            {e.value || <span className="italic text-gray-300 dark:text-zinc-600">empty</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

function DecisionButton({
  label,
  active,
  onClick,
  color,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  color?: 'gray' | 'blue' | 'purple';
}) {
  const activeColors = {
    gray: 'bg-gray-900 dark:bg-zinc-100 text-white dark:text-gray-900 border-gray-900 dark:border-zinc-100',
    blue: 'bg-blue-600 dark:bg-blue-500 text-white border-blue-600 dark:border-blue-500',
    purple: 'bg-purple-600 dark:bg-purple-500 text-white border-purple-600 dark:border-purple-500',
  };

  return (
    <button
      onClick={e => { e.stopPropagation(); onClick(); }}
      className={cn(
        'text-[11px] font-medium px-2.5 py-1 rounded-lg border transition-all',
        active
          ? (activeColors[color ?? 'gray'])
          : 'bg-white dark:bg-[#111111] text-gray-500 dark:text-zinc-400 border-gray-200 dark:border-[#2a2a2a] hover:border-gray-400'
      )}
    >
      {label}
    </button>
  );
}

function CustomInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="mt-2">
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        onClick={e => e.stopPropagation()}
        placeholder="Enter custom value..."
        className="w-full text-xs text-gray-700 dark:text-zinc-300 bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a] rounded-lg px-3 py-1.5 outline-none focus:border-gray-400 dark:focus:border-[#3f3f3f] placeholder:text-gray-300 dark:placeholder:text-zinc-600"
      />
    </div>
  );
}

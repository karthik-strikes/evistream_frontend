'use client';

/**
 * Shares the "which field am I filling, and what has a source" state with the
 * inputs, without threading six new props through
 * ExtractionForm -> TableField -> RowCard -> FieldRenderer.
 *
 * A context is the right tool here specifically because the consumers are leaves
 * scattered two and three levels down and the producer is the page. Kept
 * deliberately small: focus, the source map, and the two mutators.
 *
 * `useSourcing` returns null when there is no provider, so `FieldRenderer` stays
 * usable on the other screens that render it outside this feature.
 */

import { createContext, useContext, useMemo } from 'react';
import type { AttachedSource, EvidenceMap, SourceMap } from './sourcing';

export interface SourcingValue {
  /** Key of the field the reviewer is currently filling — the attach target. */
  activeKey: string | null;
  setActiveKey: (key: string | null) => void;
  sources: SourceMap;
  /** The AI's own quote per cell, for values it prefilled. Read-only: it is the
   *  model's assertion, not the reviewer's, and is never re-posted as one. */
  aiEvidence: EvidenceMap;
  /** Keys that still owe a source, in form order. */
  unsourced: string[];
  attach: (key: string, source: AttachedSource) => void;
  clear: (key: string) => void;
  /** Put this cell's attached passage back on screen: jump the PDF to its page
   *  and re-draw the highlight. A chip that shows "p.7" and does nothing when
   *  clicked reads as broken. */
  reveal: (key: string) => void;
  /** False on screens with no PDF text layer to select from. */
  enabled: boolean;
}

const SourcingContext = createContext<SourcingValue | null>(null);

export function SourcingProvider({
  value,
  children,
}: {
  value: SourcingValue;
  children: React.ReactNode;
}) {
  return <SourcingContext.Provider value={value}>{children}</SourcingContext.Provider>;
}

export function useSourcing(): SourcingValue | null {
  return useContext(SourcingContext);
}

/**
 * Per-field view of the sourcing state, for one input.
 *
 * `owes` is computed by the provider (it owns the AI baseline), so a field only
 * has to look itself up rather than re-deriving the rule.
 */
export function useFieldSourcing(key: string | undefined) {
  const ctx = useSourcing();
  return useMemo(() => {
    if (!ctx || !key) {
      return {
        enabled: false, isActive: false, source: undefined as AttachedSource | undefined,
        ai: undefined as EvidenceMap[string] | undefined,
        owes: false, focus: () => {}, clear: () => {}, reveal: () => {},
      };
    }
    return {
      enabled: ctx.enabled,
      isActive: ctx.activeKey === key,
      source: ctx.sources[key],
      ai: ctx.aiEvidence[key],
      owes: ctx.unsourced.includes(key),
      focus: () => ctx.setActiveKey(key),
      clear: () => ctx.clear(key),
      reveal: () => ctx.reveal(key),
    };
  }, [ctx, key]);
}

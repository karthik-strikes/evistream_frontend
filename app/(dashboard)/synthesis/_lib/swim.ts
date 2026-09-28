/**
 * Structured synthesis without meta-analysis (SWiM), vote counting by
 * direction of effect.
 *
 * SPEC §3: direction is read from the POINT ESTIMATE, never from
 * significance; studies with no usable data are listed but left out of every
 * denominator; each group gets a Wilson interval and an exact sign test, and
 * there is no cross-class overall test when the groups are not one construct.
 */

import {
  formatEffect, nullValue, runMetaAnalysis,
  type EffectMeasure, type MetaStudy, type PoolingModel,
} from '@/lib/metaAnalysis';
import { directionOf, voteCount, type Direction, type VoteCount } from '@/lib/voteCounting';

export interface SwimRow {
  ref: string;
  documentId: string;
  label: string;
  group: string;
  direction: Direction;
  est: number | null;
  lo: number | null;
  hi: number | null;
  effectText: string;
}

export interface SwimGroup {
  name: string;
  rows: SwimRow[];
  count: VoteCount;
}

export interface SwimResult {
  groups: SwimGroup[];
  overall: VoteCount;
  success: 'benefit' | 'harm';
}

export const DIRECTION_TEXT: Record<Direction, string> = {
  benefit: 'Point estimate favours intervention',
  harm: 'Point estimate favours comparator',
  none: 'Null point estimate',
  nodata: 'No usable data',
};

export function buildSwim(input: {
  studies: MetaStudy[];
  /** Eligible studies that produced no estimate — listed, excluded from denominators. */
  noData: Array<{ ref: string; documentId: string; label: string; group: string }>;
  measure: EffectMeasure;
  model?: PoolingModel;
  lowerIsBenefit: boolean;
  groupOf: (s: MetaStudy) => string;
  success: 'benefit' | 'harm';
}): SwimResult {
  const result = runMetaAnalysis(input.studies, input.measure, input.model ?? 'fixed');
  const nv = nullValue(input.measure);
  const rows: SwimRow[] = [];
  const byKey = new Map(input.studies.map(s => [s.key, s]));
  for (const s of result.studies) {
    const src = byKey.get(s.key);
    rows.push({
      ref: s.key, documentId: s.documentId, label: s.label, group: src ? input.groupOf(src) || 'All studies' : 'All studies',
      direction: directionOf(s.est, Number.isFinite(nv) ? nv : 0, input.lowerIsBenefit),
      est: s.est, lo: s.lo, hi: s.hi, effectText: formatEffect(s.est, s.lo, s.hi),
    });
  }
  for (const n of result.notEstimable) {
    rows.push({
      ref: n.study.key, documentId: n.study.documentId, label: n.study.label,
      group: input.groupOf(n.study) || 'All studies', direction: 'nodata', est: null, lo: null, hi: null, effectText: '—',
    });
  }
  for (const n of input.noData) {
    rows.push({ ...n, group: n.group || 'All studies', direction: 'nodata', est: null, lo: null, hi: null, effectText: '—' });
  }
  const names = [...new Set(rows.map(r => r.group))].sort();
  const groups = names.map(name => {
    const gr = rows.filter(r => r.group === name).sort((a, b) => a.label.localeCompare(b.label));
    return { name, rows: gr, count: voteCount(gr.map(r => r.direction), input.success) };
  });
  return { groups, overall: voteCount(rows.map(r => r.direction), input.success), success: input.success };
}

export function voteText(c: VoteCount, success: 'benefit' | 'harm'): string {
  const who = success === 'benefit' ? 'favour the intervention' : 'favour the comparator';
  const nod = c.nodata ? ` (${c.nodata} no data)` : '';
  const ci = c.wilson ? ` · Wilson 95% CI ${(c.wilson[0] * 100).toFixed(0)}–${(c.wilson[1] * 100).toFixed(0)}%` : '';
  const p = c.p !== null ? ` · sign test p ${c.p < 0.001 ? '< 0.001' : `= ${c.p.toFixed(c.p < 0.01 ? 3 : 2)}`}` : '';
  return `${c.success} of ${c.withDirection} with a direction ${who}${nod}${ci}${p}`;
}

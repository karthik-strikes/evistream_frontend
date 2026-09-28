import type { Workflow } from '@/types/home';

/**
 * Workflow palette (design handoff v3.1, from the product's KPI strip).
 * `color` for bars, dots, swatches and corner marks; `text` for any text
 * (>= 4.5:1 on white); `tint` for hover backgrounds. `darkText` / `darkTint`
 * are the charcoal-surface equivalents.
 */
export interface WorkflowTone {
  color: string;
  light: string;
  text: string;
  tint: string;
  darkText: string;
  darkTint: string;
}

export const WF: Record<Workflow, WorkflowTone> = {
  documents: { color: '#F0536B', light: '#F9C4CD', text: '#C22D47', tint: '#FEF1F3', darkText: '#F58A9C', darkTint: 'rgba(240,83,107,0.08)' },
  ai:        { color: '#4F86F7', light: '#B7CDFB', text: '#2A5FC9', tint: '#EEF4FE', darkText: '#8AB0FA', darkTint: 'rgba(79,134,247,0.08)' },
  forms:     { color: '#F5A623', light: '#FBDCA8', text: '#A8650A', tint: '#FFF6E8', darkText: '#F8C26A', darkTint: 'rgba(245,166,35,0.08)' },
  consensus: { color: '#22B573', light: '#BDE9D3', text: '#177A4E', tint: '#EAF8F1', darkText: '#5FD39C', darkTint: 'rgba(34,181,115,0.08)' },
  neutral:   { color: '#0a0a0a', light: '#94a3b8', text: '#0a0a0a', tint: '#f3f4f6', darkText: '#e4e4e7', darkTint: 'rgba(255,255,255,0.04)' },
};

/** Swatch color that survives dark mode (black swatches vanish on charcoal). */
export const swatch = (wf: Workflow, dark: boolean) => (wf === 'neutral' && dark ? '#e4e4e7' : WF[wf].color);
export const wfText = (wf: Workflow, dark: boolean) => (dark ? WF[wf].darkText : WF[wf].text);

export const STAGE = {
  form: { head: 'text-gray-500 dark:text-zinc-500' },
  ai: { head: 'text-[#2a5fc9] dark:text-[#8ab0fa]', fill: '#4F86F7', running: '#B7CDFB' },
  reader: { head: 'text-[#a8650a] dark:text-[#f8c26a]', fill: '#F5A623' },
  consensus: { head: 'text-[#177a4e] dark:text-[#5fd39c]', fill: '#22B573' },
  failed: '#F0536B',
} as const;

'use client';

import React, { useState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { Textarea } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { FormField } from '@/types/api';

// ── Types ──────────────────────────────────────────────────────────────────

export type UEFCalField = {
  description: string;
  hints: string[];
  rules: string[];
  examples: Array<{ value: string; source_text?: string }>;
};

export type UEFEditableField = FormField & { _isNew?: boolean; _isDeleted?: boolean };

export interface FieldEditorPaneProps {
  field: UEFEditableField;
  cal: UEFCalField;
  editable: boolean;
  structuralEditable?: boolean;
  simple?: boolean;
  onFieldPatch: (patch: Partial<FormField>) => void;
  onCalPatch: (patch: Partial<UEFCalField>) => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────

export function humanizeFieldName(s: string): string {
  return s.split('_').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

const ANCHOR_KEYWORDS = ['name','label','type','subtype','point','timepoint','period','arm','group','unit','category','intervention','outcome','visit','event','treatment','identifier','measure'];

// Per-arm/per-group numeric measurements (mean_arm1, sd_arm2, n_arm1, change_group2) are
// always VALUE columns, never anchors. Without this guard the 'arm' keyword matched the
// *_arm<N> suffix on every numeric column, making them all anchors and leaving Stage 2 empty.
const PER_ARM_VALUE = /_(arm|group|grp|g)\s*\d+$/;
const MEASURE_TOKENS = new Set(['mean','median','sd','std','stdev','se','sem','iqr','range','ci','n','num','count','pct','percent','proportion','rate','value','score','change','delta','diff','pvalue','pval','p','min','max','sum','total','avg','baseline']);

export function isValueColumn(name: string): boolean {
  const f = (name || '').toLowerCase();
  if (PER_ARM_VALUE.test(f)) return true;
  return MEASURE_TOKENS.has(f.split(/[_\s]+/)[0]);
}

export function autoDetectAnchors(sfs: any[]): string[] {
  const detected = sfs
    .filter(sf => !isValueColumn(sf.field_name || '') && ANCHOR_KEYWORDS.some(kw => (sf.field_name||'').toLowerCase().includes(kw)))
    .map((sf:any) => sf.field_name);
  return detected.length > 0 ? detected : (sfs[0] ? [sfs[0].field_name] : []);
}

// ── AutoTextarea (auto-growing textarea used inside FieldEditorPane) ──────

export function AutoTextarea({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(el.scrollHeight, 28)}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      rows={1}
      className={className}
    />
  );
}

// ── FieldEditorPane (extraction strategy is auto-decided; no strategy UI) ──

export function FieldEditorPane({ field, cal, editable, structuralEditable = editable, simple = false, onFieldPatch, onCalPatch }: FieldEditorPaneProps) {
  const ml = "text-[11px] font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider";
  const fname = field.field_name;
  const isTableField = field.field_type === 'array';
  const isSelectField = field.field_type === 'select';
  const subformFields: any[] = isTableField && Array.isArray(field.subform_fields) ? field.subform_fields : [];

  const subfieldNameRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const [pendingFocusIdx, setPendingFocusIdx] = useState<number | null>(null);

  useEffect(() => {
    if (pendingFocusIdx === null) return;
    const el = subfieldNameRefs.current[pendingFocusIdx];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.focus();
    }
    setPendingFocusIdx(null);
  }, [pendingFocusIdx, subformFields.length]);

  return (
    <div className="flex-1 overflow-y-auto p-5">
      {/* Field identity */}
      <div className="pb-4 mb-4 border-b border-gray-100 dark:border-[#1f1f1f]">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <p className={cn(ml, "mb-1")}>Field name</p>
            {structuralEditable ? (
              <input
                value={fname}
                onChange={e => onFieldPatch({ field_name: e.target.value })}
                placeholder="field_name"
                className="w-full font-mono text-sm bg-gray-50 dark:bg-[#141414] border border-gray-200 dark:border-[#2a2a2a] rounded-lg px-3 py-2 text-gray-800 dark:text-zinc-200 focus:outline-none focus:border-gray-400 dark:focus:border-zinc-500"
              />
            ) : (
              <>
                <p className="font-mono text-sm text-gray-700 dark:text-zinc-300">{fname}</p>
              </>
            )}
          </div>
          <div className="shrink-0">
            <p className={cn(ml, "mb-1")}>Type</p>
            {structuralEditable ? (
              <select
                value={field.field_type}
                onChange={e => onFieldPatch({ field_type: e.target.value })}
                className="bg-gray-50 dark:bg-[#141414] border border-gray-200 dark:border-[#2a2a2a] rounded-lg px-2 py-2 text-xs text-gray-700 dark:text-zinc-300 focus:outline-none"
              >
                <option value="text">text</option>
                <option value="number">number</option>
                <option value="boolean">boolean</option>
                <option value="select">select</option>
                <option value="array">table</option>
              </select>
            ) : (
              <>
                <span className={cn("text-xs px-2 py-1 rounded-md font-medium", isTableField ? "bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 border border-amber-200/60 dark:border-amber-800/40" : "bg-gray-100 dark:bg-[#1f1f1f] text-gray-600 dark:text-zinc-300")}>
                  {isTableField ? '\u25A6 table' : field.field_type}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Table callout */}
      {isTableField && (
        <div className="mb-4 rounded-xl border border-amber-200 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-950/20 p-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm text-amber-600 dark:text-amber-400">{'\u25A6'}</span>
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">Table field — extracted as one unit</p>
          </div>
          <p className="text-xs text-amber-700/80 dark:text-amber-300/70 leading-relaxed">Extraction strategy is decided automatically from the table&apos;s shape. Each column has its own description, hints, rules, and examples.</p>
        </div>
      )}

      {/* Subfields */}
      {isTableField && (
        <div className="mb-5">
          <div className="flex items-center justify-between mb-2">
            <p className={ml}>Subfields ({subformFields.length})</p>
            {editable && (
              <button type="button"
                onClick={() => {
                  const newIdx = subformFields.length;
                  onFieldPatch({ subform_fields: [...subformFields, { field_name: '', field_type: 'text', field_description: '' }] });
                  setPendingFocusIdx(newIdx);
                }}
                className="text-[11px] text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 transition-colors">
                + Add subfield
              </button>
            )}
          </div>
          {subformFields.length === 0 && <p className="text-[11px] text-gray-500 dark:text-zinc-400 italic">No subfields yet.</p>}
          <div className="flex flex-col gap-2">
            {subformFields.map((sf: any, i: number) => {
              const sfHints: string[] = Array.isArray(sf.hints) ? sf.hints : [];
              const sfRules: string[] = Array.isArray(sf.rules) ? sf.rules : [];
              const sfExamples: Array<{ value: string; source_text: string }> = Array.isArray(sf.examples)
                ? sf.examples
                : (sf.example ? [{ value: sf.example, source_text: '' }] : []);
              const patchSf = (patch: any) => { const n = [...subformFields]; n[i] = { ...n[i], ...patch }; onFieldPatch({ subform_fields: n }); };
              return (
                <div key={i} className="rounded-lg border border-gray-100 dark:border-[#1f1f1f] bg-white dark:bg-[#0d0d0d] p-3">
                  {editable ? (
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center gap-2">
                        <input ref={el => { subfieldNameRefs.current[i] = el; }} value={sf.field_name} onChange={e => patchSf({ field_name: e.target.value })}
                          onBlur={e => { const trimmed = e.target.value.trim(); if (trimmed !== sf.field_name) patchSf({ field_name: trimmed }); }}
                          placeholder="field_name" className="flex-1 font-mono text-xs bg-gray-50 dark:bg-[#141414] border border-gray-200 dark:border-[#2a2a2a] rounded-md px-2 py-1.5 text-gray-800 dark:text-zinc-200 focus:outline-none" />
                        <select value={sf.field_type || 'text'} onChange={e => patchSf({ field_type: e.target.value })}
                          className="bg-gray-50 dark:bg-[#141414] border border-gray-200 dark:border-[#2a2a2a] rounded-md px-1.5 py-1.5 text-[11px] text-gray-600 dark:text-zinc-400 focus:outline-none">
                          <option value="text">text</option>
                          <option value="number">number</option>
                          <option value="boolean">boolean</option>
                          <option value="select">select</option>
                        </select>
                        <button type="button" onClick={() => onFieldPatch({ subform_fields: subformFields.filter((_, j) => j !== i) })}
                          className="text-gray-300 dark:text-zinc-700 hover:text-red-400 transition-colors shrink-0"><X className="h-3 w-3" /></button>
                      </div>
                      <input value={sf.field_description || ''} onChange={e => patchSf({ field_description: e.target.value })}
                        placeholder="Description (tells the LLM what this column means)"
                        className="w-full text-xs bg-gray-50 dark:bg-[#141414] border border-gray-200 dark:border-[#2a2a2a] rounded-md px-2 py-1.5 text-gray-800 dark:text-zinc-200 placeholder:text-gray-400 dark:placeholder:text-zinc-600 focus:outline-none" />
                      {sf.field_type === 'select' && (
                        <div className="flex flex-col gap-1 mt-1 pt-1.5 border-t border-gray-100 dark:border-[#1f1f1f]">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-[10px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wider">Options ({(sf.options || []).length})</p>
                            {(sf.options || []).length > 0 && <button type="button" onClick={() => patchSf({ options: [] })} className="text-[10px] text-gray-400 dark:text-zinc-500 hover:text-red-400 transition-colors shrink-0">Clear</button>}
                          </div>
                          {(sf.options || []).map((opt: string, oi: number) => (
                            <div key={oi} className="flex items-center gap-1.5">
                              <input value={opt} onChange={e => { const no = [...(sf.options || [])]; no[oi] = e.target.value; patchSf({ options: no }); }}
                                placeholder="option value" className="flex-1 text-[11px] bg-gray-50 dark:bg-[#141414] border border-gray-100 dark:border-[#1f1f1f] rounded-md px-2 py-1.5 text-gray-700 dark:text-zinc-300 focus:outline-none" />
                              <button type="button" onClick={() => patchSf({ options: (sf.options || []).filter((_: string, oj: number) => oj !== oi) })} className="text-gray-300 dark:text-zinc-700 hover:text-red-400 transition-colors p-0.5 shrink-0"><X className="h-3 w-3" /></button>
                            </div>
                          ))}
                          <button type="button" onClick={() => patchSf({ options: [...(sf.options || []), ''] })} className="text-[10px] text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 text-left transition-colors">+ Add option</button>
                        </div>
                      )}
                      <div className="flex flex-col gap-1 mt-1 pt-1.5 border-t border-gray-100 dark:border-[#1f1f1f]">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[10px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wider">Extraction Hints</p>
                          {sfHints.length > 0 && <button type="button" onClick={() => patchSf({ hints: [] })} className="text-[10px] text-gray-400 dark:text-zinc-500 hover:text-red-400 transition-colors shrink-0">Clear</button>}
                        </div>
                        {sfHints.map((h, hi) => (
                          <div key={hi} className="flex items-start gap-1.5 rounded-md bg-gray-50 dark:bg-[#141414] border border-gray-100 dark:border-[#1f1f1f] px-2 py-1.5">
                            <span className="text-gray-400 dark:text-zinc-500 text-[11px] mt-0.5 shrink-0">{'\u2192'}</span>
                            <AutoTextarea value={h} onChange={e => { const nh = [...sfHints]; nh[hi] = e.target.value; patchSf({ hints: nh }); }} placeholder="where or how to find this value..." className="flex-1 text-[11px] bg-transparent text-gray-700 dark:text-zinc-300 placeholder-gray-400 dark:placeholder-zinc-500 focus:outline-none resize-none overflow-hidden leading-relaxed" />
                            <button type="button" onClick={() => patchSf({ hints: sfHints.filter((_, hj) => hj !== hi) })} className="text-gray-300 dark:text-zinc-700 hover:text-red-400 transition-colors p-0.5 shrink-0"><X className="h-3 w-3" /></button>
                          </div>
                        ))}
                        <button type="button" onClick={() => patchSf({ hints: [...sfHints, ''] })} className="text-[10px] text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 text-left transition-colors">+ Add hint</button>
                      </div>
                      <div className="flex flex-col gap-1 pt-1.5 border-t border-gray-100 dark:border-[#1f1f1f]">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[10px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wider">Rules</p>
                          {sfRules.length > 0 && <button type="button" onClick={() => patchSf({ rules: [] })} className="text-[10px] text-gray-400 dark:text-zinc-500 hover:text-red-400 transition-colors shrink-0">Clear</button>}
                        </div>
                        {sfRules.map((r, ri) => (
                          <div key={ri} className="flex items-start gap-1.5 rounded-md bg-gray-50 dark:bg-[#141414] border border-gray-100 dark:border-[#1f1f1f] px-2 py-1.5">
                            <span className="text-gray-400 dark:text-zinc-500 text-[11px] mt-0.5 shrink-0">{'\u00B7'}</span>
                            <AutoTextarea value={r} onChange={e => { const nr = [...sfRules]; nr[ri] = e.target.value; patchSf({ rules: nr }); }} placeholder="must / must-not constraint..." className="flex-1 text-[11px] bg-transparent text-gray-700 dark:text-zinc-300 placeholder-gray-400 dark:placeholder-zinc-500 focus:outline-none resize-none overflow-hidden leading-relaxed" />
                            <button type="button" onClick={() => patchSf({ rules: sfRules.filter((_, rj) => rj !== ri) })} className="text-gray-300 dark:text-zinc-700 hover:text-red-400 transition-colors p-0.5 shrink-0"><X className="h-3 w-3" /></button>
                          </div>
                        ))}
                        <button type="button" onClick={() => patchSf({ rules: [...sfRules, ''] })} className="text-[10px] text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 text-left transition-colors">+ Add rule</button>
                      </div>
                      <div className="flex flex-col gap-1 pt-1.5 border-t border-gray-100 dark:border-[#1f1f1f]">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[10px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wider">Examples</p>
                          {sfExamples.length > 0 && <button type="button" onClick={() => patchSf({ examples: [] })} className="text-[10px] text-gray-400 dark:text-zinc-500 hover:text-red-400 transition-colors shrink-0">Clear</button>}
                        </div>
                        {sfExamples.map((ex, ei) => (
                          <div key={ei} className="rounded-md border border-gray-100 dark:border-[#1f1f1f] overflow-hidden">
                            <div className="flex items-start gap-2 bg-gray-50 dark:bg-[#141414] px-2 py-1.5">
                              <div className="flex-1 flex flex-col gap-0.5">
                                <p className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-zinc-500">Value</p>
                                <AutoTextarea value={String(ex.value ?? '')} onChange={e => { const ne = [...sfExamples]; ne[ei] = { ...ne[ei], value: e.target.value }; patchSf({ examples: ne }); }} placeholder="extracted value" className="text-[11px] bg-transparent text-gray-700 dark:text-zinc-300 placeholder-gray-400 dark:placeholder-zinc-500 focus:outline-none resize-none overflow-hidden leading-relaxed" />
                              </div>
                              <button type="button" onClick={() => patchSf({ examples: sfExamples.filter((_, ej) => ej !== ei) })} className="text-gray-400 dark:text-zinc-500 hover:text-red-400 transition-colors p-0.5 mt-4 shrink-0"><X className="h-3 w-3" /></button>
                            </div>
                          </div>
                        ))}
                        <button type="button" onClick={() => patchSf({ examples: [...sfExamples, { value: '', source_text: '' }] })} className="text-[10px] text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 text-left transition-colors">+ Add example</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <p className="text-sm font-semibold text-gray-800 dark:text-zinc-100">{sf.display_name || humanizeFieldName(sf.field_name)}</p>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-[#1f1f1f] text-gray-500 dark:text-zinc-400">{sf.field_type || 'text'}</span>
                      </div>
                      <p className="font-mono text-[11px] text-gray-400 dark:text-zinc-500">{sf.field_name}</p>
                      {sf.field_description && <p className="text-xs text-gray-500 dark:text-zinc-400 mt-0.5">{sf.field_description}</p>}
                      {Array.isArray(sf.options) && sf.options.length > 0 && <div className="mt-1.5"><p className="text-[10px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wider mb-0.5">Options</p>{sf.options.map((opt: string, oi: number) => <p key={oi} className="text-[11px] text-gray-500 dark:text-zinc-400">{'·'} {opt}</p>)}</div>}
                      {sfHints.length > 0 && <div className="mt-1.5"><p className="text-[10px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wider mb-0.5">Hints</p>{sfHints.map((h, hi) => <p key={hi} className="text-[11px] text-gray-500 dark:text-zinc-400">{'\u2192'} {h}</p>)}</div>}
                      {sfRules.length > 0 && <div className="mt-1"><p className="text-[10px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wider mb-0.5">Rules</p>{sfRules.map((r, ri) => <p key={ri} className="text-[11px] text-gray-500 dark:text-zinc-400">{'\u00B7'} {r}</p>)}</div>}
                      {sfExamples.length > 0 && <div className="mt-1"><p className="text-[10px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wider mb-0.5">Examples</p>{sfExamples.map((ex, ei) => <p key={ei} className="text-[11px] text-gray-500 dark:text-zinc-400">{String(ex.value ?? '')}</p>)}</div>}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}


      {/* Select options */}
      {isSelectField && editable && (
        <div className="mb-5">
          <div className="flex items-center justify-between mb-2">
            <p className={ml}>Options ({(field.options || []).length})</p>
            <button type="button" onClick={() => onFieldPatch({ options: [...(field.options || []), ''] })}
              className="text-[11px] text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 transition-colors">+ Add option</button>
          </div>
          {(field.options || []).length === 0 && <p className="text-[11px] text-gray-500 dark:text-zinc-400 italic">No options yet.</p>}
          <div className="flex flex-col gap-1.5">
            {(field.options || []).map((opt: string, i: number) => (
              <div key={i} className="flex items-center gap-2">
                <input value={opt} onChange={e => { const n = [...(field.options || [])]; n[i] = e.target.value; onFieldPatch({ options: n }); }}
                  placeholder="option value" className="flex-1 text-xs bg-gray-50 dark:bg-[#141414] border border-gray-200 dark:border-[#2a2a2a] rounded-md px-2 py-1.5 text-gray-800 dark:text-zinc-200 focus:outline-none" />
                <button type="button" onClick={() => onFieldPatch({ options: (field.options || []).filter((_, j) => j !== i) })}
                  className="text-gray-300 dark:text-zinc-700 hover:text-red-400 transition-colors shrink-0"><X className="h-3 w-3" /></button>
              </div>
            ))}
          </div>
          {editable && (
            <label className="flex items-center gap-2 mt-2 cursor-pointer select-none">
              <input type="checkbox" checked={field.multiple ?? false}
                onChange={e => onFieldPatch({ multiple: e.target.checked })}
                className="w-3.5 h-3.5 rounded border-gray-300 dark:border-zinc-600 accent-violet-500" />
              <span className="text-[11px] text-gray-500 dark:text-zinc-400">Allow multiple selections</span>
            </label>
          )}
        </div>
      )}

      {/* Calibration */}
      <div className={cn("flex flex-col gap-4", (isTableField || (isSelectField && editable)) && "border-t border-gray-100 dark:border-[#1f1f1f] pt-4")}>
        <div className="flex flex-col gap-1.5">
          <p className={ml}>Description</p>
          <Textarea
            value={cal.description}
            onChange={e => editable && onCalPatch({ description: e.target.value })}
            placeholder="What this field captures..."
            rows={3}
            className="resize-none text-xs leading-relaxed"
            disabled={!editable}
          />
        </div>

        {simple ? (
          <div className="flex flex-col gap-1.5">
            <p className={ml}>Example value <span className="normal-case font-normal text-gray-400 dark:text-zinc-500">(optional)</span></p>
            <input
              value={field.example || ''}
              onChange={e => editable && onFieldPatch({ example: e.target.value })}
              placeholder="e.g. 45.2, 'Placebo', true..."
              disabled={!editable}
              className="w-full text-xs bg-gray-50 dark:bg-[#141414] border border-gray-200 dark:border-[#2a2a2a] rounded-lg px-3 py-2 text-gray-800 dark:text-zinc-200 placeholder:text-gray-400 dark:placeholder:text-zinc-600 focus:outline-none disabled:opacity-50"
            />
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className={ml}>Extraction Hints</p>
                  <p className="text-[11px] text-gray-400 dark:text-zinc-500 mt-0.5">Where or how to find this value &mdash; e.g. &ldquo;look in the Methods section&rdquo;. Soft guidance for the AI.</p>
                </div>
                {editable && cal.hints.length > 0 && <button type="button" onClick={() => onCalPatch({ hints: [] })} className="text-[11px] text-gray-400 dark:text-zinc-500 hover:text-red-400 transition-colors shrink-0">Clear</button>}
              </div>
              {cal.hints.length === 0 && <p className="text-[11px] text-gray-500 dark:text-zinc-400 italic">No hints yet.</p>}
              {cal.hints.map((h, i) => (
                <div key={i} className="flex items-start gap-2 rounded-lg bg-gray-50 dark:bg-[#141414] border border-gray-100 dark:border-[#1f1f1f] px-3 py-2">
                  <span className="text-gray-500 dark:text-zinc-400 text-xs mt-0.5 shrink-0">{'\u2192'}</span>
                  <AutoTextarea value={h} onChange={e => { const next = [...cal.hints]; next[i] = e.target.value; onCalPatch({ hints: next }); }} placeholder="where or how to find this value..." className="flex-1 text-xs bg-transparent text-gray-700 dark:text-zinc-300 placeholder-gray-400 dark:placeholder-zinc-500 focus:outline-none resize-none overflow-hidden leading-relaxed" />
                  {editable && <button type="button" onClick={() => onCalPatch({ hints: cal.hints.filter((_, idx) => idx !== i) })} className="text-gray-400 dark:text-zinc-500 hover:text-red-400 transition-colors p-0.5 shrink-0"><X className="h-3 w-3" /></button>}
                </div>
              ))}
              {editable && <button type="button" onClick={() => onCalPatch({ hints: [...cal.hints, ''] })} className="text-[11px] text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 text-left transition-colors">+ Add hint</button>}
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className={ml}>Rules</p>
                  <p className="text-[11px] text-gray-400 dark:text-zinc-500 mt-0.5">Hard constraints the AI must follow &mdash; e.g. &ldquo;return NR if not found&rdquo;, &ldquo;never infer&rdquo;. Rules override hints.</p>
                </div>
                {editable && cal.rules.length > 0 && <button type="button" onClick={() => onCalPatch({ rules: [] })} className="text-[11px] text-gray-400 dark:text-zinc-500 hover:text-red-400 transition-colors shrink-0">Clear</button>}
              </div>
              {cal.rules.length === 0 && <p className="text-[11px] text-gray-500 dark:text-zinc-400 italic">No rules yet.</p>}
              {cal.rules.map((r, i) => (
                <div key={i} className="flex items-start gap-2 rounded-lg bg-gray-50 dark:bg-[#141414] border border-gray-100 dark:border-[#1f1f1f] px-3 py-2">
                  <span className="text-gray-500 dark:text-zinc-400 text-xs mt-0.5 shrink-0">{'\u00B7'}</span>
                  <AutoTextarea value={r} onChange={e => { const next = [...cal.rules]; next[i] = e.target.value; onCalPatch({ rules: next }); }} placeholder="must / must-not constraint..." className="flex-1 text-xs bg-transparent text-gray-700 dark:text-zinc-300 placeholder-gray-400 dark:placeholder-zinc-500 focus:outline-none resize-none overflow-hidden leading-relaxed" />
                  {editable && <button type="button" onClick={() => onCalPatch({ rules: cal.rules.filter((_, idx) => idx !== i) })} className="text-gray-400 dark:text-zinc-500 hover:text-red-400 transition-colors p-0.5 shrink-0"><X className="h-3 w-3" /></button>}
                </div>
              ))}
              {editable && <button type="button" onClick={() => onCalPatch({ rules: [...cal.rules, ''] })} className="text-[11px] text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 text-left transition-colors">+ Add rule</button>}
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <p className={ml}>Examples</p>
                {editable && cal.examples.length > 0 && <button type="button" onClick={() => onCalPatch({ examples: [] })} className="text-[11px] text-gray-400 dark:text-zinc-500 hover:text-red-400 transition-colors shrink-0">Clear</button>}
              </div>
              {cal.examples.length === 0 && <p className="text-[11px] text-gray-500 dark:text-zinc-400 italic">No examples yet.</p>}
              {cal.examples.map((ex, i) => (
                <div key={i} className="rounded-lg border border-gray-100 dark:border-[#1f1f1f] overflow-hidden">
                  <div className="flex items-start gap-2 bg-gray-50 dark:bg-[#141414] px-3 py-2">
                    <div className="flex-1 flex flex-col gap-0.5">
                      <p className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-zinc-500">Value</p>
                      <AutoTextarea value={String(ex.value ?? '')} onChange={e => { const next = [...cal.examples]; next[i] = { ...next[i], value: e.target.value }; onCalPatch({ examples: next }); }} placeholder="extracted value" className="text-xs bg-transparent text-gray-700 dark:text-zinc-300 placeholder-gray-400 dark:placeholder-zinc-500 focus:outline-none resize-none overflow-hidden leading-relaxed" />
                    </div>
                    {editable && <button type="button" onClick={() => onCalPatch({ examples: cal.examples.filter((_, idx) => idx !== i) })} className="text-gray-400 dark:text-zinc-500 hover:text-red-400 transition-colors p-0.5 mt-4 shrink-0"><X className="h-3 w-3" /></button>}
                  </div>
                </div>
              ))}
              {editable && <button type="button" onClick={() => onCalPatch({ examples: [...cal.examples, { value: '', source_text: '' }] })} className="text-[11px] text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 text-left transition-colors">+ Add example</button>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

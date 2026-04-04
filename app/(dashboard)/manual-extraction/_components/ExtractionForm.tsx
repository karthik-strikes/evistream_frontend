'use client';

import { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight, Save, RotateCcw, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Form, FormField } from '@/types/api';
import { FieldRenderer } from './FieldRenderer';
import { modKey } from '../_hooks/useExtractionKeyboard';

interface ExtractionFormProps {
  form: Form;
  formData: Record<string, any>;
  aiPrefilledKeys: Set<string>;
  onFieldChange: (fieldName: string, value: any) => void;
  onSave: () => void;
  onSaveAndNext: () => void;
  onReset: () => void;
  saving: boolean;
  hasNextDoc: boolean;
}

export function ExtractionForm({
  form,
  formData,
  aiPrefilledKeys,
  onFieldChange,
  onSave,
  onSaveAndNext,
  onReset,
  saving,
  hasNextDoc,
}: ExtractionFormProps) {
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());

  const allFields = useMemo(() => flattenFields(form.fields), [form.fields]);
  const filled = allFields.filter(f => formData[f.field_name]?.toString().trim()).length;
  const total = allFields.length;
  const pct = total > 0 ? Math.round((filled / total) * 100) : 0;

  const emptyFields = allFields.filter(f => !formData[f.field_name]?.toString().trim());
  const displayEmpty = emptyFields.slice(0, 3);
  const moreCount = emptyFields.length - displayEmpty.length;

  const hasSubforms = form.fields.some(f => f.subform_fields && f.subform_fields.length > 0);

  const toggleSection = (name: string) => {
    setCollapsedSections(prev => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  };

  const scrollToField = (fieldName: string) => {
    document.getElementById(`field-${fieldName}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  // Progress bar color
  const barColor = pct >= 100 ? 'bg-green-500 dark:bg-green-400' : pct >= 50 ? 'bg-amber-500 dark:bg-amber-400' : 'bg-gray-400 dark:bg-zinc-500';
  const mk = modKey();

  let fieldCounter = 0;

  const renderFieldWithCounter = (field: FormField) => {
    fieldCounter++;
    return (
      <FieldRenderer
        key={field.field_name}
        field={field}
        value={formData[field.field_name]}
        onChange={(v) => onFieldChange(field.field_name, v)}
        index={fieldCounter}
        isAiPrefilled={aiPrefilledKeys.has(field.field_name)}
        id={`field-${field.field_name}`}
      />
    );
  };

  return (
    <div className="flex flex-col h-full">
      {/* Progress header */}
      <div className="px-5 py-3 border-b border-gray-100 dark:border-[#1f1f1f] flex-shrink-0">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-semibold text-gray-500 dark:text-zinc-400">Progress</span>
          <span className="text-xs font-semibold text-gray-800 dark:text-white">{filled} / {total}</span>
        </div>
        <div className="h-1.5 bg-gray-100 dark:bg-[#1a1a1a] rounded-full overflow-hidden">
          <div className={cn("h-full rounded-full transition-all duration-300", barColor)} style={{ width: `${pct}%` }} />
        </div>
        {emptyFields.length > 0 && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            <span className="text-[10px] text-gray-400 dark:text-zinc-600">Empty:</span>
            {displayEmpty.map(f => (
              <button
                key={f.field_name}
                onClick={() => scrollToField(f.field_name)}
                className="text-[10px] text-amber-600 dark:text-amber-400 hover:underline cursor-pointer bg-transparent border-none p-0"
              >
                {f.field_name.replace(/_/g, ' ')}
              </button>
            ))}
            {moreCount > 0 && (
              <span className="text-[10px] text-gray-400 dark:text-zinc-600">+ {moreCount} more</span>
            )}
          </div>
        )}
      </div>

      {/* Fields */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5 min-h-0">
        {hasSubforms ? (
          form.fields.map((field) => {
            if (field.subform_fields && field.subform_fields.length > 0) {
              const isCollapsed = collapsedSections.has(field.field_name);
              return (
                <div key={field.field_name} className="rounded-xl border border-gray-200 dark:border-[#1f1f1f] overflow-hidden bg-white dark:bg-[#111111]">
                  <button
                    onClick={() => toggleSection(field.field_name)}
                    className="w-full flex items-center gap-2 px-4 py-3 text-left bg-gray-50/60 dark:bg-[#0a0a0a] border-b border-gray-100 dark:border-[#1f1f1f] cursor-pointer hover:bg-gray-100 dark:hover:bg-[#141414] transition-colors"
                  >
                    {isCollapsed ? <ChevronRight className="w-3.5 h-3.5 text-gray-400" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-400" />}
                    <div>
                      <p className="text-xs font-semibold text-gray-700 dark:text-zinc-300 capitalize">{field.field_name.replace(/_/g, ' ')}</p>
                      {field.field_description && (
                        <p className="text-[11px] text-gray-400 dark:text-zinc-500 mt-0.5">{field.field_description}</p>
                      )}
                    </div>
                  </button>
                  {!isCollapsed && (
                    <div className="px-4 py-4 space-y-5 pl-6">
                      {field.subform_fields.map(sub => renderFieldWithCounter({
                        ...sub,
                        field_name: `${field.field_name}_${sub.field_name}`,
                      }))}
                    </div>
                  )}
                </div>
              );
            }
            // Top-level field without subform
            return renderFieldWithCounter(field);
          })
        ) : (
          form.fields.map((field) => renderFieldWithCounter(field))
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-gray-100 dark:border-[#1f1f1f] bg-gray-50/60 dark:bg-[#0a0a0a] flex-shrink-0 flex gap-2">
        <button
          onClick={onSave}
          disabled={saving}
          className="flex-1 inline-flex items-center justify-center gap-2 text-sm font-semibold text-white dark:text-gray-900 bg-gray-900 dark:bg-zinc-100 hover:bg-gray-700 dark:hover:bg-white border-none rounded-lg py-2.5 cursor-pointer transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Save className="w-3.5 h-3.5" />
          {saving ? 'Saving…' : 'Save'}
          <span className="text-[10px] opacity-50 ml-1">{mk}+S</span>
        </button>
        {hasNextDoc && (
          <button
            onClick={onSaveAndNext}
            disabled={saving}
            className="flex-1 inline-flex items-center justify-center gap-2 text-sm font-semibold text-gray-900 dark:text-white bg-gray-100 dark:bg-[#1a1a1a] hover:bg-gray-200 dark:hover:bg-[#222] border border-gray-200 dark:border-[#2a2a2a] rounded-lg py-2.5 cursor-pointer transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ArrowRight className="w-3.5 h-3.5" />
            {saving ? 'Saving…' : 'Save & Next'}
            <span className="text-[10px] opacity-50 ml-1">{mk}+↵</span>
          </button>
        )}
        <button
          onClick={onReset}
          title="Reset fields"
          className="px-3 text-gray-500 dark:text-zinc-400 bg-gray-100 dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a] rounded-lg py-2.5 cursor-pointer hover:bg-gray-200 dark:hover:bg-[#222] transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

/** Flatten form fields, expanding subform_fields with composite keys to avoid collisions */
function flattenFields(fields: FormField[]): FormField[] {
  const result: FormField[] = [];
  for (const f of fields) {
    if (f.subform_fields && f.subform_fields.length > 0) {
      result.push(...f.subform_fields.map(sub => ({
        ...sub,
        field_name: `${f.field_name}_${sub.field_name}`,
      })));
    } else {
      result.push(f);
    }
  }
  return result;
}

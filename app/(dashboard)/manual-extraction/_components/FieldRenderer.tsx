'use client';

import { cn } from '@/lib/utils';
import type { FormField } from '@/types/api';

const inputCls = "w-full px-3 py-2 text-sm text-gray-900 dark:text-white bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a] rounded-lg outline-none focus:border-gray-400 dark:focus:border-[#3f3f3f] transition-colors placeholder:text-gray-300 dark:placeholder:text-zinc-600";

interface FieldRendererProps {
  field: FormField;
  value: any;
  onChange: (value: any) => void;
  index: number;
  isAiPrefilled?: boolean;
  id?: string;
}

export function FieldRenderer({ field, value, onChange, index, isAiPrefilled, id }: FieldRendererProps) {
  const val = value ?? '';
  const isEmpty = !val.toString().trim();
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => onChange(e.target.value);

  const renderInput = () => {
    if (field.field_type === 'select' || field.field_type === 'enum' || field.field_type === 'list') {
      if (field.multiple) {
        // Multi-select: render checkboxes
        const selected: string[] = Array.isArray(val) ? val : val ? String(val).split(',').map((s: string) => s.trim()).filter(Boolean) : [];
        const toggleOption = (opt: string) => {
          const next = selected.includes(opt) ? selected.filter((s: string) => s !== opt) : [...selected, opt];
          onChange(next);
        };
        return (
          <div className="flex flex-wrap gap-1.5">
            {field.options?.map((o) => (
              <label key={o} className={cn("flex items-center gap-1.5 text-sm px-2.5 py-1.5 rounded-lg border cursor-pointer transition-colors", selected.includes(o) ? "border-violet-300 dark:border-violet-600 bg-violet-50/50 dark:bg-violet-900/20 text-gray-800 dark:text-zinc-200" : "border-gray-200 dark:border-[#2a2a2a] text-gray-500 dark:text-zinc-400 hover:border-gray-300 dark:hover:border-[#3a3a3a]")}>
                <input type="checkbox" checked={selected.includes(o)} onChange={() => toggleOption(o)} className="w-3.5 h-3.5 rounded border-gray-300 dark:border-zinc-600 accent-violet-500" />
                {o}
              </label>
            ))}
          </div>
        );
      }
      return (
        <select value={val} onChange={handleChange} className={cn(inputCls, "cursor-pointer dark:[color-scheme:dark]", isAiPrefilled && "bg-blue-50/30 dark:bg-blue-900/10")}>
          <option value="">Select an option…</option>
          {field.options?.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    }
    if (field.field_type === 'boolean') {
      return (
        <select value={val} onChange={handleChange} className={cn(inputCls, "cursor-pointer dark:[color-scheme:dark]", isAiPrefilled && "bg-blue-50/30 dark:bg-blue-900/10")}>
          <option value="">Select…</option>
          <option value="Yes">Yes</option>
          <option value="No">No</option>
          <option value="NR">NR</option>
        </select>
      );
    }
    return (
      <input
        type={field.field_type === 'number' || field.field_type === 'integer' ? 'number' : 'text'}
        value={val}
        onChange={handleChange}
        placeholder={field.example || `Enter ${field.field_name}`}
        className={cn(inputCls, isAiPrefilled && "bg-blue-50/30 dark:bg-blue-900/10")}
      />
    );
  };

  return (
    <div id={id} className={cn(isEmpty && "border-l-2 border-amber-300 dark:border-amber-600 pl-3", !isEmpty && "pl-[14px]")}>
      <div className="flex items-start gap-2 mb-1.5">
        <span className="text-[11px] font-bold text-gray-300 dark:text-zinc-700 w-5 text-right flex-shrink-0 mt-0.5 tabular-nums">{index}</span>
        <div className="flex-1">
          <p className="text-xs font-semibold text-gray-700 dark:text-zinc-300 capitalize">
            {field.field_name.replace(/_/g, ' ')}
            {isAiPrefilled && (
              <span className="ml-1.5 text-[10px] font-medium text-blue-500 dark:text-blue-400">(AI)</span>
            )}
          </p>
          {field.field_description && (
            <p className="text-[11px] text-gray-400 dark:text-zinc-500 mt-0.5 leading-snug">{field.field_description}</p>
          )}
          {field.extraction_hints && (
            <p className="text-[11px] text-gray-400/70 dark:text-zinc-600 mt-0.5 leading-snug italic">{field.extraction_hints}</p>
          )}
        </div>
      </div>
      {renderInput()}
    </div>
  );
}

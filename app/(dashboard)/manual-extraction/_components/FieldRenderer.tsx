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
    if (field.field_type === 'enum' || field.field_type === 'list') {
      return (
        <select value={val} onChange={handleChange} className={cn(inputCls, "cursor-pointer dark:[color-scheme:dark]", isAiPrefilled && "bg-blue-50/30 dark:bg-blue-900/10")}>
          <option value="">Select an option…</option>
          {field.options?.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    }
    if (field.field_type === 'textarea') {
      return (
        <textarea
          value={val}
          onChange={handleChange}
          placeholder={field.example || `Enter ${field.field_name}`}
          rows={3}
          className={cn(inputCls, "resize-none", isAiPrefilled && "bg-blue-50/30 dark:bg-blue-900/10")}
        />
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

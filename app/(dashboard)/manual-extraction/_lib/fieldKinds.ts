import type { FormField } from '@/types/api';

export type AiTablePrefill = {
  rowIndices: Set<number>;
  cells: Record<number, Set<string>>;
};

/** A field is a table when its type is 'array' AND it has subform_fields. */
export const isTableField = (f: FormField): boolean =>
  f.field_type === 'array' && !!f.subform_fields?.length;

/** Flatten only non-table fields, expanding non-array subforms with composite keys. */
export function flattenScalarFields(fields: FormField[]): FormField[] {
  const result: FormField[] = [];
  for (const f of fields) {
    if (isTableField(f)) continue;
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

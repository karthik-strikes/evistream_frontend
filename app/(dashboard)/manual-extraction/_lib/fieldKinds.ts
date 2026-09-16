import type { FormField } from '@/types/api';

export type AiTablePrefill = {
  rowIndices: Set<number>;
  cells: Record<number, Set<string>>;
};

/** A field is a table when its type is 'array' AND it has subform_fields. */
export const isTableField = (f: FormField): boolean =>
  f.field_type === 'array' && !!f.subform_fields?.length;

/**
 * A field is required only when it says it is.
 *
 * This used to be `required !== false` at every validation site, which made
 * *everything* mandatory on every live form: not one of the 385 fields on the
 * active forms carries a `required` key at all (the code generator never emits
 * one), and neither does a single table column. So a 25-row x 16-column table
 * meant 400 cells that had to be non-empty before Save would run, which is why
 * saved work piled up as `_partial`. The form said nothing about it either —
 * `FieldRenderer` printed its asterisk on `required === true`, so the demand was
 * invisible until the toast. One helper, used by the validator and by every
 * label, so the two can no longer disagree.
 */
export const isRequiredField = (f: { required?: boolean | null }): boolean =>
  f.required === true;

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

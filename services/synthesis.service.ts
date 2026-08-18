import { apiClient } from '@/lib/api';

export interface MappingColumn {
  name: string;
  type: string;
  description?: string;
  options?: string[];
}

/**
 * The backend's proposal for how a form's table maps onto analysis roles.
 *
 * `slots` has already been validated server-side: every column named here exists
 * in the form, no column is mapped twice, and label columns have been refused
 * for measurement roles. `dropped` says what was thrown away, `warnings` what was
 * kept but is worth a second look. Nothing is applied until the reviewer confirms.
 */
export interface MappingSuggestion {
  form_id: string;
  form_name: string;
  field_name: string | null;
  columns: MappingColumn[];
  verdict: 'dichotomous' | 'continuous' | 'diagnostic_accuracy' | 'not_poolable';
  layout: 'wide' | 'long' | null;
  slots: Record<string, string>;
  variability_measure_column: string | null;
  comparator_value: string | null;
  reasoning: string;
  per_slot_reasoning: Record<string, string>;
  missing_slots: string[];
  partial: boolean;
  dropped: string[];
  warnings: string[];
  source: 'llm' | 'heuristic' | 'deterministic';
  cached: boolean;
}

export const synthesisService = {
  async suggestMapping(
    formId: string,
    options: { fieldName?: string; force?: boolean } = {},
  ): Promise<MappingSuggestion> {
    return apiClient.post<MappingSuggestion>('/api/v1/synthesis/suggest-mapping', {
      form_id: formId,
      field_name: options.fieldName ?? null,
      force: options.force ?? false,
    });
  },
};

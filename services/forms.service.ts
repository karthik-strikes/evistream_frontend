import { apiClient } from '@/lib/api';
import type {
  Form, CreateFormRequest, DuplicateFormRequest,
  PilotState, PilotStartResponse, PilotFeedbackResponse, PilotCompleteResponse,
  PilotFieldFeedback,
  ReviewNote,
  FieldEditUpdate, FieldEditsResponse, FieldPromptsResponse, TableExtractionMode,
} from '@/types/api';

export const formsService = {
  async getAll(projectId: string, search?: string): Promise<Form[]> {
    const params = new URLSearchParams({ project_id: projectId, limit: '500' });
    if (search?.trim()) {
      params.set('search', search.trim());
    }
    return apiClient.get<Form[]>(`/api/v1/forms/?${params.toString()}`);
  },

  async get(id: string): Promise<Form> {
    return apiClient.get<Form>(`/api/v1/forms/${id}`);
  },

  async create(data: CreateFormRequest): Promise<Form> {
    return apiClient.post<Form>('/api/v1/forms/', data);
  },

  async update(id: string, data: Partial<CreateFormRequest>): Promise<Form> {
    return apiClient.put<Form>(`/api/v1/forms/${id}`, data);
  },

  async duplicate(id: string, payload: DuplicateFormRequest): Promise<Form> {
    return apiClient.post<Form>(`/api/v1/forms/${id}/duplicate`, payload);
  },

  async delete(id: string): Promise<void> {
    return apiClient.delete<void>(`/api/v1/forms/${id}`);
  },

  async generateCode(id: string, enableReview?: boolean): Promise<Form> {
    const params = enableReview ? '?enable_review=true' : '';
    return apiClient.post<Form>(`/api/v1/forms/${id}/regenerate${params}`);
  },

  async approveDecomposition(
    id: string,
    opts?: { silent?: boolean },
  ): Promise<{ message: string; form_id: string; job_id: string; status: string }> {
    return apiClient.post<{ message: string; form_id: string; job_id: string; status: string }>(
      `/api/v1/forms/${id}/approve-decomposition`,
      {},
      opts?.silent ? ({ _skipGlobalToast: true } as any) : undefined,
    );
  },

  async rejectDecomposition(
    id: string,
    payload: { feedback?: string; notes?: ReviewNote[]; accepted_refs?: string[] },
  ): Promise<{ message: string; form_id: string; job_id: string; feedback: string; status: string }> {
    return apiClient.post<{ message: string; form_id: string; job_id: string; feedback: string; status: string }>(
      `/api/v1/forms/${id}/reject-decomposition`,
      payload,
    );
  },

  async getReviewHistory(id: string): Promise<{ form_id: string; history: any[] }> {
    return apiClient.get<{ form_id: string; history: any[] }>(`/api/v1/forms/${id}/review-history`);
  },

  // ── Pilot Study ─────────────────────────────────────────────────────────

  async startPilot(formId: string, documentIds?: string[], count?: number): Promise<PilotStartResponse> {
    return apiClient.post<PilotStartResponse>(`/api/v1/forms/${formId}/pilot/start`, {
      document_ids: documentIds || null,
      count: count || 3,
    });
  },

  async getPilot(formId: string): Promise<PilotState> {
    return apiClient.get<PilotState>(`/api/v1/forms/${formId}/pilot`);
  },

  async submitPilotFeedback(
    formId: string,
    iteration: number,
    feedback: Record<string, PilotFieldFeedback>,
  ): Promise<PilotFeedbackResponse> {
    return apiClient.post<PilotFeedbackResponse>(`/api/v1/forms/${formId}/pilot/feedback`, {
      iteration,
      feedback,
    });
  },

  async completePilot(formId: string): Promise<PilotCompleteResponse> {
    return apiClient.post<PilotCompleteResponse>(`/api/v1/forms/${formId}/pilot/complete`, {});
  },

  async resetPilot(formId: string): Promise<void> {
    return apiClient.delete<void>(`/api/v1/forms/${formId}/pilot`);
  },

  /**
   * Patch per-field calibration and/or the form-level table extraction mode.
   * Both ride this endpoint so they share one atomic schema_def + fields +
   * metadata write and its OCC guard. Either argument may be empty/omitted,
   * but not both — the API rejects a no-op request.
   */
  async updateFieldEdits(
    formId: string,
    fieldUpdates: FieldEditUpdate[],
    tableExtractionMode?: TableExtractionMode,
  ): Promise<FieldEditsResponse> {
    return apiClient.patch<FieldEditsResponse>(
      `/api/v1/forms/${formId}/fields`,
      {
        field_updates: fieldUpdates,
        ...(tableExtractionMode ? { table_extraction_mode: tableExtractionMode } : {}),
      },
    );
  },

  async getFieldPrompts(formId: string): Promise<FieldPromptsResponse> {
    return apiClient.get<FieldPromptsResponse>(`/api/v1/forms/${formId}/field-prompts`);
  },

  async dismissIssue(formId: string, issueId: string): Promise<{ form_id: string; dismissed_issue_ids: string[] }> {
    return apiClient.post<{ form_id: string; dismissed_issue_ids: string[] }>(
      `/api/v1/forms/${formId}/dismiss-issue`,
      { issue_id: issueId },
    );
  },

  async addField(formId: string, payload: {
    field_name: string;
    field_type: string;
    display_name?: string;
    options?: string[];
    multiple?: boolean;
    target_signature_class: string;
    description: string;
    examples?: Array<{ value: string; source_text?: string }>;
  }): Promise<{ form_id: string; field_name: string; calibration: { description: string; hints: string[]; rules: string[]; examples: any[] } }> {
    return apiClient.post(`/api/v1/forms/${formId}/fields`, payload);
  },

  async removeField(formId: string, fieldName: string): Promise<{ form_id: string; field_name: string; removed_signature: string | null; removed_stage: number | null }> {
    return apiClient.delete(`/api/v1/forms/${formId}/fields/${encodeURIComponent(fieldName)}`);
  },

  async getFieldDependencies(formId: string, fieldName: string): Promise<{ field_name: string; consuming_signatures: string[] }> {
    return apiClient.get(`/api/v1/forms/${formId}/fields/${encodeURIComponent(fieldName)}/dependencies`);
  },

  async updateSubfieldEdit(formId: string, fieldName: string, subfieldData: any[]): Promise<{ form_id: string; field_name: string; schema_def_version: number }> {
    return apiClient.post(`/api/v1/forms/${formId}/subfield-edit`, {
      field_name: fieldName,
      subform_fields: subfieldData,
    });
  },
};

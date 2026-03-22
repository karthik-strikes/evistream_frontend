import { apiClient } from '@/lib/api';
import type {
  ControlledVocabulary, FieldVocabularyMapping, VocabularySearchResult, VocabularyTerm,
} from '@/types/api';

export const vocabulariesService = {
  async list(projectId?: string): Promise<ControlledVocabulary[]> {
    const qs = projectId ? `?project_id=${projectId}` : '';
    return apiClient.get<ControlledVocabulary[]>(`/api/v1/vocabularies${qs}`);
  },

  async create(data: {
    project_id?: string;
    name: string;
    description?: string;
    terms?: VocabularyTerm[];
    source?: string;
  }): Promise<ControlledVocabulary> {
    return apiClient.post<ControlledVocabulary>('/api/v1/vocabularies', data);
  },

  async update(id: string, data: {
    name?: string;
    description?: string;
    terms?: VocabularyTerm[];
  }): Promise<ControlledVocabulary> {
    return apiClient.put<ControlledVocabulary>(`/api/v1/vocabularies/${id}`, data);
  },

  async delete(id: string): Promise<void> {
    await apiClient.delete(`/api/v1/vocabularies/${id}`);
  },

  async importCSV(id: string, file: File): Promise<{ imported: number; total_terms: number }> {
    const formData = new FormData();
    formData.append('file', file);
    const token = apiClient.getToken();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const response = await fetch(`/api/v1/vocabularies/${id}/import`, {
      method: 'POST',
      headers,
      body: formData,
    });
    if (!response.ok) throw new Error(`Import failed: ${response.status}`);
    return response.json();
  },

  async search(query: string, options: {
    vocabularyId?: string;
    projectId?: string;
    limit?: number;
  } = {}): Promise<VocabularySearchResult[]> {
    const params = new URLSearchParams();
    params.append('q', query);
    if (options.vocabularyId) params.append('vocabulary_id', options.vocabularyId);
    if (options.projectId) params.append('project_id', options.projectId);
    if (options.limit) params.append('limit', String(options.limit));
    return apiClient.get<VocabularySearchResult[]>(`/api/v1/vocabularies/search?${params.toString()}`);
  },

  async createFieldMapping(data: {
    form_id: string;
    field_name: string;
    vocabulary_id: string;
    validation_mode?: string;
  }): Promise<FieldVocabularyMapping> {
    return apiClient.post<FieldVocabularyMapping>('/api/v1/vocabularies/field-mappings', data);
  },

  async getFieldMappings(formId: string): Promise<FieldVocabularyMapping[]> {
    return apiClient.get<FieldVocabularyMapping[]>(`/api/v1/vocabularies/field-mappings/${formId}`);
  },
};

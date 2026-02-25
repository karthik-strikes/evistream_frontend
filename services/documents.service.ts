import { apiClient } from '@/lib/api';
import type { Document, DocumentUploadResponse } from '@/types/api';
import { AxiosProgressEvent } from 'axios';

export interface UploadDocumentOptions {
  file: File;
  projectId: string;
  onUploadProgress?: (progress: number) => void;
}

export const documentsService = {
  async getAll(projectId: string): Promise<Document[]> {
    return apiClient.get<Document[]>(`/api/v1/documents?project_id=${encodeURIComponent(projectId)}`);
  },

  async getById(id: string): Promise<Document> {
    return apiClient.get<Document>(`/api/v1/documents/${id}`);
  },

  async upload({ file, projectId, onUploadProgress }: UploadDocumentOptions): Promise<DocumentUploadResponse> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('project_id', projectId);

    return apiClient.post<DocumentUploadResponse>('/api/v1/documents/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (progressEvent: AxiosProgressEvent) => {
        if (onUploadProgress && progressEvent.total) {
          const progress = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          onUploadProgress(progress);
        }
      },
    });
  },

  async delete(id: string): Promise<void> {
    return apiClient.delete<void>(`/api/v1/documents/${id}`);
  },

  async downloadMarkdown(id: string): Promise<string> {
    return apiClient.get<string>(`/api/v1/documents/${id}/markdown`);
  },

  async downloadPDF(id: string): Promise<Blob> {
    return apiClient.get<Blob>(`/api/v1/documents/${id}/download`, {
      responseType: 'blob',
    });
  },
};

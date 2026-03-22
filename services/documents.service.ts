import { apiClient } from '@/lib/api';
import type { Document } from '@/types/api';

export interface UploadDocumentOptions {
  file: File;
  projectId: string;
  labels?: string[];
  onUploadProgress?: (progress: number) => void;
}

interface UploadInitResponse {
  document_id: string;
  presigned_url: string;
  presigned_fields: Record<string, string>;
  s3_key: string;
  confirm_url: string;
  duplicate?: boolean;
  document?: Document;
}

export interface UploadResult {
  status: string;
  job_id: string | null;
  document_id: string;
}

async function computeSHA256(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function uploadToS3(
  presignedUrl: string,
  presignedFields: Record<string, string>,
  file: File,
  onUploadProgress?: (progress: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const hasFields = Object.keys(presignedFields).length > 0;

    if (hasFields) {
      // S3 presigned POST — use FormData with all policy fields
      const formData = new FormData();
      for (const [key, value] of Object.entries(presignedFields)) {
        formData.append(key, value);
      }
      formData.append('file', file);

      const xhr = new XMLHttpRequest();
      xhr.open('POST', presignedUrl);

      if (onUploadProgress) {
        xhr.upload.addEventListener('progress', (event) => {
          if (event.lengthComputable) {
            const progress = Math.round((event.loaded * 100) / event.total);
            onUploadProgress(progress);
          }
        });
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          console.error('[S3 POST] Status:', xhr.status, 'Response:', xhr.responseText);
          reject(new Error(`S3 upload failed with status ${xhr.status}`));
        }
      };
      xhr.onerror = () => reject(new Error('S3 upload network error'));
      xhr.send(formData);
    } else {
      // Pure presigned PUT URL
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', presignedUrl);
      xhr.setRequestHeader('Content-Type', 'application/pdf');

      if (onUploadProgress) {
        xhr.upload.addEventListener('progress', (event) => {
          if (event.lengthComputable) {
            const progress = Math.round((event.loaded * 100) / event.total);
            onUploadProgress(progress);
          }
        });
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          reject(new Error(`S3 upload failed with status ${xhr.status}`));
        }
      };
      xhr.onerror = () => reject(new Error('S3 upload network error'));
      xhr.send(file);
    }
  });
}

export const documentsService = {
  async getAll(projectId: string, search?: string): Promise<Document[]> {
    let url = `/api/v1/documents?project_id=${encodeURIComponent(projectId)}`;
    if (search && search.trim()) {
      url += `&search=${encodeURIComponent(search.trim())}`;
    }
    return apiClient.get<Document[]>(url);
  },

  async getById(id: string): Promise<Document> {
    return apiClient.get<Document>(`/api/v1/documents/${id}`);
  },

  async updateLabels(id: string, labels: string[]): Promise<Document> {
    return apiClient.patch<Document>(`/api/v1/documents/${id}/labels`, { labels });
  },

  async upload({ file, projectId, labels, onUploadProgress }: UploadDocumentOptions): Promise<UploadResult> {
    const contentHash = await computeSHA256(file);

    let initResponse: UploadInitResponse;
    try {
      initResponse = await apiClient.post<UploadInitResponse>('/api/v1/documents/upload', {
        project_id: projectId,
        filename: file.name,
        content_hash: contentHash,
        file_size: file.size,
        labels: labels || [],
      });
    } catch (err: any) {
      console.error('[Upload] Init failed:', err?.response?.data || err?.message || err);
      throw err;
    }

    if (initResponse.duplicate && initResponse.document) {
      return {
        status: 'duplicate',
        job_id: null,
        document_id: initResponse.document.id,
      };
    }

    try {
      await uploadToS3(
        initResponse.presigned_url,
        initResponse.presigned_fields,
        file,
        onUploadProgress
      );
    } catch (err: any) {
      console.error('[Upload] S3 upload failed:', err?.message || err);
      throw err;
    }

    let confirmResponse: { status: string; job_id: string | null };
    try {
      confirmResponse = await apiClient.post<{ status: string; job_id: string | null }>(
        `/api/v1/documents/${initResponse.document_id}/confirm-upload`,
        {}
      );
    } catch (err: any) {
      console.error('[Upload] Confirm failed:', err?.response?.data || err?.message || err);
      throw err;
    }

    return {
      status: confirmResponse.status,
      job_id: confirmResponse.job_id,
      document_id: initResponse.document_id,
    };
  },

  async delete(id: string): Promise<void> {
    return apiClient.delete<void>(`/api/v1/documents/${id}`);
  },

  async downloadMarkdown(id: string): Promise<string> {
    return apiClient.get<string>(`/api/v1/documents/${id}/markdown`);
  },

  async getDownloadUrl(id: string): Promise<string> {
    const response = await apiClient.get<{ download_url: string; expires_in: number }>(
      `/api/v1/documents/${id}/download`
    );
    return response.download_url;
  },
};

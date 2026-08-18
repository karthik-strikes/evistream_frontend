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
  /**
   * List documents. Pass a projectId to scope to one project; omit it (or pass
   * null) to list across EVERY project the caller can view — the backend's
   * `list_documents` falls back to owned + member projects when no project_id
   * is supplied.
   */
  async getAll(projectId?: string | null, search?: string): Promise<Document[]> {
    const params = new URLSearchParams({ limit: '500' });
    if (projectId) params.set('project_id', projectId);
    if (search && search.trim()) params.set('search', search.trim());
    return apiClient.get<Document[]>(`/api/v1/documents?${params.toString()}`);
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

  /**
   * Accept thin-evidence (`metadata_only`) documents for extraction. Bulk by
   * design. Does NOT change processing_status — the document stays
   * `metadata_only` so results and exports can still show the evidence was thin.
   */
  async approveMetadata(ids: string[], approved = true): Promise<{ count: number; skipped: number }> {
    return apiClient.patch('/api/v1/documents/approve-metadata', { document_ids: ids, approved });
  },

  async reprocess(id: string): Promise<{ status: string; job_id: string | null }> {
    return apiClient.post<{ status: string; job_id: string | null }>(`/api/v1/documents/${id}/reprocess`, {});
  },

  /**
   * Best-effort DOI/title resolution for one document whose DOI was never
   * attempted (doi_source IS NULL — anything uploaded before the DOI pipeline
   * existed). Reads the PDF's embedded metadata, then page-1 text, then falls
   * back to a Crossref title lookup. No Datalab calls, so it costs nothing but
   * a little time.
   */
  async backfillDoi(id: string): Promise<{ status: string; job_id: string | null }> {
    return apiClient.post<{ status: string; job_id: string | null }>(`/api/v1/documents/${id}/backfill-doi`, {});
  },


  async attachPdf(id: string, file: File): Promise<{ status: string; job_id: string | null }> {
    // Manual full-text fallback (see ImportedTrialDrawer's "Attach PDF"
    // prompt) — bypasses apiClient for the same reason vocabulariesService's
    // importCSV does: a raw fetch with just the auth header avoids axios's
    // default JSON Content-Type header fighting FormData's auto-set
    // multipart boundary.
    const formData = new FormData();
    formData.append('file', file);
    const token = apiClient.getToken();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const response = await fetch(`/api/v1/documents/${id}/attach-pdf`, {
      method: 'POST',
      headers,
      body: formData,
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.detail || `Attach failed: ${response.status}`);
    }
    return response.json();
  },

  async downloadMarkdown(id: string): Promise<string> {
    // responseType: 'text' forces axios to hand back the raw string body.
    // Without it, axios's default transform silently JSON.parses ANY
    // response string that happens to be valid JSON — regardless of the
    // server's Content-Type header — which turns this into an object
    // instead of a string for CT.gov-imported documents (whose stored
    // "markdown" is now pure JSON) and crashes callers expecting a string.
    return apiClient.get<string>(`/api/v1/documents/${id}/markdown`, { responseType: 'text' } as any);
  },

  async downloadBlocks(id: string): Promise<unknown | null> {
    // Returns the Datalab block-level JSON ({children: [...pages], metadata}),
    // OR null when the document is a legacy one without a bbox sidecar (the
    // backend returns 200 with {"unavailable": true} for that case so it
    // doesn't paint a red 404 in browser devtools).
    const data: any = await apiClient.get<unknown>(`/api/v1/documents/${id}/blocks`);
    if (data && typeof data === 'object' && data.unavailable === true) {
      return null;
    }
    return data;
  },

  async downloadPdfBlob(id: string): Promise<Blob> {
    // Streams the raw PDF through the backend (same-origin → no S3 CORS).
    // Caller is responsible for URL.revokeObjectURL on any blob URL it creates.
    // _skipGlobalToast: the viewer renders its own inline error UI; a toast
    // would duplicate it.
    return apiClient.get<Blob>(`/api/v1/documents/${id}/file`, {
      responseType: 'blob',
      _skipGlobalToast: true,
    } as any);
  },

  async getDownloadUrl(id: string): Promise<string> {
    const response = await apiClient.get<{ download_url: string; expires_in: number }>(
      `/api/v1/documents/${id}/download`
    );
    return response.download_url;
  },
};

import { apiClient } from '@/lib/api';

export interface EndNoteImportResult {
  job_id: string;
  status: string;
}

export interface EndNotePreviewRecord {
  ref_id: number;
  title: string;
  authors: string | null;
  year: string | null;
  journal: string | null;
  doi: string | null;
  pmid: string | null;
  pmcid: string | null;
  // Every http(s) link mined from the reference's `url` field — the same
  // last-resort fetch candidates the import job tries; also fed to the
  // availability probe so the preview reflects what import will find.
  urls: string[];
  has_pdf: boolean;
}

export interface EndNotePreviewResult {
  filename: string;
  total: number;
  with_pdf: number;
  needs_pdf: number;
  records: EndNotePreviewRecord[];
}

// Raw multipart POST (not apiClient) for the same reason documentsService.attachPdf
// does it: axios's default JSON Content-Type fights FormData's multipart boundary.
async function postForm<T>(path: string, form: FormData): Promise<T> {
  const token = apiClient.getToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const response = await fetch(path, { method: 'POST', headers, body: form });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail || `Request failed: ${response.status}`);
  }
  return response.json();
}

export const endnoteService = {
  /** Parse a .enlx and return its references WITHOUT importing — for the
   * review/select step. See backend/app/api/v1/endnote.py:preview_endnote. */
  async preview(file: File, projectId: string): Promise<EndNotePreviewResult> {
    const form = new FormData();
    form.append('project_id', projectId);
    form.append('file', file);
    return postForm<EndNotePreviewResult>('/api/v1/endnote/preview', form);
  },

  /** Commit the import. `refIds` (optional) restricts it to the selected
   * references; omit to import all. Returns a job_id; follow progress over
   * the WebSocket channel ws_jobs:{job_id}. */
  async importLibrary(file: File, projectId: string, refIds?: number[]): Promise<EndNoteImportResult> {
    const form = new FormData();
    form.append('project_id', projectId);
    form.append('file', file);
    if (refIds) form.append('ref_ids', JSON.stringify(refIds));
    return postForm<EndNoteImportResult>('/api/v1/endnote/import', form);
  },
};

import { apiClient } from '@/lib/api';
import type { SuggestedScopeChip } from '@/lib/reviewScope';

/** Per-file account of what the server actually managed to read. */
export interface ScopeFileReport {
  filename: string;
  chars_total: number;
  chars_read: number;
  truncated: boolean;
  empty: boolean;
}

export interface ScopeSuggestionResult {
  chips: SuggestedScopeChip[];
  /** Exclusion criteria, study-design limits, methods artefacts — read and skipped. */
  not_used: string[];
  /** Ambiguities the model refused to settle on its own. */
  needs_review: string[];
  notes: string;
  /** Entries the server refused: wrong family, too long, past the per-family cap. */
  dropped: string[];
  files: ScopeFileReport[];
  cached: boolean;
}

// Raw multipart POST rather than apiClient, for the same reason
// endnoteService.preview does it: axios's default JSON Content-Type fights
// FormData's multipart boundary.
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

export const reviewScopeService = {
  /**
   * Read protocols / eligibility criteria and propose scope entries.
   *
   * Suggestion only — nothing is saved. The reviewer edits the chips in the
   * guided builder and saves through `projectsService.updateReviewScope`, which
   * stays the only writer of the prose extraction reads.
   *
   * See backend/app/api/v1/review_scope.py:suggest_review_scope.
   */
  async suggestFromDocuments(projectId: string, files: File[]): Promise<ScopeSuggestionResult> {
    const form = new FormData();
    form.append('project_id', projectId);
    files.forEach((f) => form.append('files', f));
    return postForm<ScopeSuggestionResult>('/api/v1/review-scope/suggest', form);
  },
};

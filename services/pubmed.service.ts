import { apiClient } from '@/lib/api';
import type { Document, NormalizedArticle, PubmedSearchResponse } from '@/types/api';

export interface ImportArticleResult {
  duplicate?: boolean;
  document: Document;
  /** How the imported document got its content — absent on the duplicate
   * branch. 'unpaywall_pdf'/'pmc' mean real full text; 'abstract' means the
   * frontend should point the user at the drawer's manual "Attach PDF"
   * fallback. See backend/app/api/v1/pubmed.py's import cascade. */
  full_text_source?: 'unpaywall_pdf' | 'pmc' | 'abstract';
}

export const pubmedService = {
  /** Free-text search — title, author, condition, etc. */
  async search(term: string): Promise<PubmedSearchResponse> {
    return apiClient.get<PubmedSearchResponse>(`/api/v1/pubmed/search?term=${encodeURIComponent(term)}`);
  },

  /** Single normalized article by PMID (e.g. "34878953") — includes the
   * abstract (search results don't; that needs the extra efetch call this
   * makes server-side). */
  async get(pmid: string): Promise<NormalizedArticle> {
    return apiClient.get<NormalizedArticle>(`/api/v1/pubmed/${encodeURIComponent(pmid)}`);
  },

  /** Import an article as a document in the given project. Dedups by PMID.
   * Same duplicate-response-shape handling as clinicalTrialsService.importTrial. */
  async importArticle(pmid: string, projectId: string): Promise<ImportArticleResult> {
    const response = await apiClient.post<any>(
      `/api/v1/pubmed/${encodeURIComponent(pmid)}/import`,
      { project_id: projectId }
    );
    if (response && response.duplicate) {
      return { duplicate: true, document: response.document as Document };
    }
    const { full_text_source, ...document } = response;
    return { duplicate: false, document: document as Document, full_text_source };
  },
};

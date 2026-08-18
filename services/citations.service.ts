import { apiClient } from '@/lib/api';

export interface CitationRecord {
  id?: number;
  title?: string | null;
  authors?: string | null;
  year?: string | null;
  journal?: string | null;
  doi?: string | null;
  pmid?: string | null;
  pmcid?: string | null;
  // Every http(s) UR link the RIS record carried — the raw-URL fallback the
  // import tries when Unpaywall/PMC have nothing (see fetch_direct_pdf).
  // Must round-trip through preview -> this record -> the /import call.
  urls?: string[] | null;
}

export interface CitationPreviewResult {
  filename: string;
  total: number;
  with_doi: number;
  records: CitationRecord[];
}

export interface CitationImportResult {
  job_id: string;
  status: string;
}

export type FullTextStatus = 'pdf' | 'pmc' | 'none';

export interface AvailabilityResult {
  results: { id: number; status: FullTextStatus }[];
  capped: boolean;
}

export const citationsService = {
  /** Parse an uploaded .ris file into citations WITHOUT importing — for the
   * review/select step. See backend/app/api/v1/citations.py:preview_ris. */
  async previewRis(file: File, projectId: string): Promise<CitationPreviewResult> {
    const form = new FormData();
    form.append('project_id', projectId);
    form.append('file', file);
    const token = apiClient.getToken();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const response = await fetch('/api/v1/citations/preview', { method: 'POST', headers, body: form });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.detail || `Preview failed: ${response.status}`);
    }
    return response.json();
  },

  /** Best-effort pre-import probe of free full-text availability per reference
   * ('pdf' = open-access PDF, 'pmc' = PubMed Central, 'none' = neither). Cheap,
   * no download. See backend/app/api/v1/citations.py:check_availability.
   * Generic despite the URL: the EndNote import dialog calls this too, with
   * pmcid/urls mined from the .enlx `url` field. */
  async checkAvailability(
    items: { id: number; doi?: string | null; pmid?: string | null; pmcid?: string | null; urls?: string[] | null }[],
  ): Promise<AvailabilityResult> {
    return apiClient.post<AvailabilityResult>('/api/v1/citations/availability', { items });
  },

  /** Commit the selected citations for open-access fetch + import. Returns a
   * job_id; follow progress over the WebSocket channel ws_jobs:{job_id}. */
  async import(projectId: string, records: CitationRecord[]): Promise<CitationImportResult> {
    return apiClient.post<CitationImportResult>('/api/v1/citations/import', {
      project_id: projectId,
      records,
    });
  },
};

/** Extract DOIs from free-pasted text (one per line, or space/comma separated). */
export function extractDois(text: string): string[] {
  const matches = text.match(/10\.\d{4,9}\/[^\s"'<>,;]+/g) || [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of matches) {
    const doi = raw.replace(/[.,;)]+$/, '');
    if (!seen.has(doi)) {
      seen.add(doi);
      out.push(doi);
    }
  }
  return out;
}

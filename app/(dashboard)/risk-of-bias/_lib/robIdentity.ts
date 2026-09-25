/**
 * The identity of one numerical result, as the result registry stores it
 * (`rob_results` + `rob_contrasts`). A risk-of-bias assessment points at a
 * result by id; the eight identity slots are defined server-side
 * (`utils/rob_mapping.py:ROW_IDENTITY_COLUMNS`).
 */

export interface Contrast {
  id: string;
  intervention: string;
  comparator: string;
  canonical_key?: string | null;
  state?: string;
}

export interface ResultIdentity {
  id: string;
  document_id: string;
  contrast?: Contrast | null;
  population: string;
  outcome_domain: string;
  measurement: string;
  timepoint: string;
  analysis_population: string;
  analysis: string;
  estimate: string;
  version?: number;
  state?: string;
}

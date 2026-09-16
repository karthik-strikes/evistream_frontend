/**
 * API Request/Response Types
 */

import type { ReviewScopeStructured } from '@/lib/reviewScope';

// Authentication
export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  full_name: string;
}

export interface AuthResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  user_id?: string;
}

export interface User {
  id: string;
  email: string;
  full_name: string;
  is_active: boolean;
  role: 'admin' | 'user';
  created_at: string;
  last_seen_at?: string | null;
  project_count?: number;
}

export interface AdminUserUpdate {
  is_active?: boolean;
  role?: 'admin' | 'user';
}

export interface AdminStats {
  total_users: number;
  total_projects: number;
  total_extractions: number;
  total_admins: number;
  total_active_users: number;
  total_memberships: number;
  total_documents: number;
  total_storage_bytes: number;
}

export interface AdminAuditLogEntry {
  id: string;
  project_id: string | null;
  actor_id: string | null;
  target_user_id: string | null;
  action: string;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  created_at: string;
  actor_name: string | null;
  actor_email: string;
  target_name: string | null;
  target_email: string;
  project_name: string;
}

export interface AdminAuditLogResponse {
  entries: AdminAuditLogEntry[];
  total: number;
  page: number;
  page_size: number;
}

export interface AdminUsersResponse {
  users: User[];
  total: number;
  page: number;
  page_size: number;
}

// Projects
export interface Project {
  id: string;
  name: string;
  description: string | null;
  user_id?: string;
  created_at: string;
  updated_at: string;
  review_settings?: { blinding: 'none' | 'partial' | 'full'; hide_ai_results: boolean } | null;
  /** Free text describing what the review is about. Injected into every
   *  extraction prompt at runtime as CONTEXT — it helps the model pick the
   *  right arm/population/timepoint. It never filters rows. */
  review_scope?: string | null;
  /** The guided scope builder's chips behind `review_scope`. UI state only —
   *  extraction reads `review_scope`. Null on projects whose scope was typed
   *  as free text, which is why the editor falls back to a textarea. */
  review_scope_structured?: ReviewScopeStructured | null;
  my_role?: 'owner' | 'manager' | 'member' | 'viewer' | 'admin';
  /** Soft archive. Null/undefined = active. Archived projects are hidden from
   *  the selector and every dropdown, and are read-only until restored. */
  archived_at?: string | null;
  archived_by?: string | null;
}

export interface CreateProjectRequest {
  name: string;
  description?: string;
}

// Documents
export interface Document {
  id: string;
  project_id: string;
  ref_id: number;
  filename: string;
  unique_filename: string | null;
  s3_pdf_path: string | null;
  s3_markdown_path: string | null;
  /** `metadata_only` = readable but THIN evidence (abstract-only PubMed, a
   *  registration-only trial). Held out of extraction until accepted. */
  processing_status: 'pending' | 'processing' | 'completed' | 'failed' | 'needs_pdf' | 'metadata_only';
  processing_error: string | null;
  doi: string | null;
  doi_source: 'metadata' | 'text' | 'crossref' | 'none' | null;
  title: string | null;
  /** Study identity — the "Raslan 2021" every screen shows. `first_author` is a
   *  surname only; `study_label` is the manual override and beats both. The
   *  displayed label (a/b/c disambiguation included, which is a per-project
   *  decision) is composed by lib/documentLabel.ts — never render these raw. */
  first_author?: string | null;
  pub_year?: string | null;
  study_label?: string | null;
  labels: string[];
  created_at: string;
  // ClinicalTrials.gov / PubMed import (optional — absent/undefined on normal uploads)
  source_type?: 'upload' | 'ctgov' | 'pubmed' | 'endnote' | 'ris' | null;
  nct_id?: string | null;
  trial_status?: string | null;
  trial_phase?: string | null;
  pmid?: string | null;
  /** Only meaningful when processing_status === 'metadata_only': a reviewer has
   *  accepted this thin-evidence document for extraction. Kept separate from the
   *  status so "the evidence was thin" survives approval. */
  metadata_extraction_approved?: boolean;
  /** Content hash of the PDF. Names every derived S3 artifact for this document
   *  (markdown, blocks, images, figures), so the detail page needs it. */
  content_hash?: string | null;
  /** Figure images extracted by the parser and stored. */
  image_count?: number | null;
  blocks_status?: 'pending' | 'completed' | 'failed' | null;
  blocks_error?: string | null;
  /** Figure digitization. `figure_count` is tri-state: null = never attempted,
   *  0 = attempted and the paper has no data figures, n = n reviewable tables. */
  figures_status?: 'pending' | 'completed' | 'failed' | null;
  figures_error?: string | null;
  figure_count?: number | null;
}

/** One cell of a digitized figure table — the same {value, source_text, status}
 *  envelope every extracted field uses (lib/absence.ts). */
export interface FigureCell {
  value: string;
  source_text?: string;
  status?: string;
}

/** A figure read out of its image, with the metadata that makes the numbers
 *  auditable and the state of a reviewer's check. */
export interface DocumentFigure {
  figure_id: string;
  /** Filename, and the join key to GET /documents/{id}/images/{image}. */
  image: string;
  title: string | null;
  page: number | null;
  bbox: number[] | null;
  block_type: string | null;
  /** `completed` = a table was read. `not_a_chart` = a micrograph or diagram,
   *  read successfully but with nothing to tabulate. `failed` = see `error`. */
  status?: 'completed' | 'not_a_chart' | 'failed';
  error?: string | null;
  is_data_chart?: boolean;
  columns?: string[];
  rows?: Record<string, FigureCell>[];
  x_axis_label?: string | null;
  y_axis_label?: string | null;
  y_axis_range?: string | null;
  /** SEM | SD | IQR | 95% CI | range, as the caption names it. A mean without
   *  its dispersion cannot enter a meta-analysis. */
  dispersion_measure?: string | null;
  /** The model's own assessment. A confident wrong answer is worse than an
   *  uncertain one, so this drives what a reviewer checks first. */
  confidence?: 'high' | 'medium' | 'low';
  notes?: string | null;
  verified?: boolean;
  verified_by?: string | null;
  verified_at?: string | null;
  corrected_cells?: number;
  digitized_at?: string | null;
  prompt_version?: number;
}

export interface DocumentFiguresResponse {
  figures: DocumentFigure[];
  figures_status: 'pending' | 'completed' | 'failed' | null;
  figures_error: string | null;
  figure_count: number | null;
}

export interface SupplementaryFile {
  id: string;
  document_id: string;
  filename: string;
  size_bytes: number | null;
  content_type: string | null;
  created_at: string;
}

// ClinicalTrials.gov — normalized trial shape returned by
// GET /api/v1/trials/{nctId} and the `results[]` of GET /api/v1/trials/search
// (mirrors backend/app/services/clinical_trials_service.py:normalize()).
export interface NormalizedTrial {
  nctId: string;
  sourceUrl: string | null;
  title: { brief: string | null; official: string | null };
  status: {
    overall: string | null;
    hasResults: boolean;
    startDate: string | null;
    primaryCompletionDate: string | null;
    completionDate: string | null;
    firstPostedDate: string | null;
    resultsFirstPostedDate: string | null;
    lastUpdatePostedDate: string | null;
  };
  sponsor: { lead: string | null; class: string | null; collaborators: (string | null)[] };
  summary: string | null;
  conditions: string[];
  keywords: string[];
  orgStudyId?: string | null;
  oversight?: { fdaRegulatedDrug: boolean | null; fdaRegulatedDevice: boolean | null; usExport: boolean | null };
  meshTerms?: string[];
  studyType: string | null;
  phase: string[];
  design: {
    allocation: string | null;
    interventionModel: string | null;
    masking: string | null;
    primaryPurpose: string | null;
  };
  enrollment: { count: number | null; type: string | null };
  eligibility: {
    minAge: string | null;
    maxAge: string | null;
    sex: string | null;
    healthyVolunteers: boolean | null;
    criteria: string | null;
  };
  arms: { label: string | null; type: string | null; description: string | null; interventionNames: string[] }[];
  interventions: { type: string | null; name: string | null; description: string | null }[];
  outcomes: {
    primary: { measure: string | null; description: string | null; timeFrame: string | null }[];
    secondary: { measure: string | null; description: string | null; timeFrame: string | null }[];
  };
  locations: { facility: string | null; city: string | null; state: string | null; country: string | null; zip: string | null }[];
  references: { pmid: string | null; type: string | null; citation: string | null }[];
  documents: { label: string | null; url: string; date: string | null; sizeBytes: number | null }[];
  results: {
    participantFlow: unknown;
    outcomeMeasures: unknown[];
    adverseEvents: unknown;
  } | null;
}

export interface TrialSearchResponse {
  total: number | null;
  nextPageToken: string | null;
  results: NormalizedTrial[];
}

// PubMed — normalized article shape returned by GET /api/v1/pubmed/{pmid}
// and the `results[]` of GET /api/v1/pubmed/search (mirrors
// backend/app/services/pubmed_service.py:normalize_summary()/get_article_full()).
export interface NormalizedArticle {
  pmid: string;
  sourceUrl: string | null;
  title: string | null;
  authors: string[];
  journal: string | null;
  pubDate: string | null;
  year: string | null;
  doi: string | null;
  pubTypes: string[];
  /** Only present on the full detail fetch (GET /pubmed/{pmid}), not on
   *  search-result-list rows — abstract requires a separate efetch call. */
  abstractText?: string | null;
  /** Pre-import probe — what will an import actually get? Only present on
   * the full detail fetch, same as abstractText. `'unknown'` means the check
   * could not be completed (upstream timeout, or the fetch itself failed) and
   * is deliberately distinct from `'none'`: one says "we couldn't tell", the
   * other claims nothing is available. `undefined` means still in flight —
   * never leave it there on an error path, or the UI reports a check that is
   * no longer running. See backend/app/services/fulltext_service.py:
   * probe_full_text_availability. */
  fullTextAvailability?: 'pdf' | 'pmc' | 'none' | 'unknown';
}

export interface PubmedSearchResponse {
  total: number;
  results: NormalizedArticle[];
}

// Unified literature search (GET /api/v1/literature/search) — fans out to
// both sources server-side and tags each result so the frontend can
// dispatch rendering per source without re-deriving which is which.
export type LiteratureResult =
  | ({ source: 'ctgov' } & NormalizedTrial)
  | ({ source: 'pubmed' } & NormalizedArticle);

export interface LiteratureSearchResponse {
  results: LiteratureResult[];
  counts: { ctgov: number | null; pubmed: number | null };
  errors: { ctgov?: string; pubmed?: string };
  message: string | null;
  /** Pass back as ctgovPageToken/pubmedOffset on the next search call to
   * fetch the next page — null once that source is exhausted. counts.* are
   * the upstream APIs' real total match counts (can be far larger than one
   * page), so a null here doesn't mean "no more results exist," it means
   * "no more results FROM THIS QUERY are available." */
  nextCtgovPageToken: string | null;
  nextPubmedOffset: number | null;
}

export interface DocumentUploadResponse {
  id: string;
  filename: string;
  unique_filename: string;
  project_id: string;
  job_id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
}

// Forms
export interface ReviewNote {
  target_type: 'field' | 'group' | 'stage' | 'pipeline';
  target_ref: string;
  comment: string;
}

export interface FieldExample {
  value: any;
  source_text?: string;
  note?: string;
}

export interface FormField {
  field_name: string;
  display_name?: string;
  field_type: string;
  field_description: string;
  field_control_type?: string;
  options?: string[];
  multiple?: boolean;
  required?: boolean;
  example?: string;
  extraction_hints?: string;
  subform_fields?: FormField[];
  // HITL review-time calibration — merged into DSPy desc at runtime, never in signatures.py
  examples?: FieldExample[];
  hints?: string[];
  rules?: string[];
  // Table extraction strategy (only meaningful on array fields) — a per-field
  // choice made in the form builder; single_call is the default at every
  // column count. Mirrors schema_def.output_fields[].extraction_strategy.
  extraction_strategy?: TableFieldExtractionStrategy;
  // The composite key: the columns whose values identify one row. Being
  // renamed anchor_columns → key_columns; the backend dual-writes both, so
  // read with keyColumnsOf() and keep writing anchor_columns.
  key_columns?: string[];
  anchor_columns?: string[];
  // Linked groups: what this column is a property of. On a subform column,
  // 'study' | 'row' | `group:<name>`; absent means 'row', which is what every
  // column did before scopes existed. On the table field itself, `groups` is
  // the list of names that field declares. Read through _lib/linkedGroups.
  scope?: string;
  groups?: string[];
}

/**
 * How a single TABLE field is extracted — chosen per field in the form
 * builder, not inferred from column count.
 *  - single_call:       one DSPy call for the whole table (default)
 *  - row_then_columns:  two-stage DSPy pipeline (row discovery, then one
 *                        focused call per row for the value columns)
 *  - agentic:           the Claude Agent SDK extractor (Claude models only)
 */
export type TableFieldExtractionStrategy = 'single_call' | 'row_then_columns' | 'agentic';

/**
 * Which extractor runs for a form's TABLE fields.
 *  - standard: the DSPy single-call / row_then_columns pipeline (default)
 *  - agentic:  the Claude Agent SDK extractor (Claude models only)
 * Authoritative copy lives in schema_def; forms.metadata carries a mirror for
 * the builder UI, which never loads schema_def.
 */
export type TableExtractionMode = 'standard' | 'agentic';

export interface FormMetadata {
  table_extraction_mode?: TableExtractionMode;
  [key: string]: any;
}

export interface FieldEditUpdate {
  field_name: string;
  description?: string;
  examples?: FieldExample[];
  hints?: string[];
  rules?: string[];
  options?: string[];
  extraction_strategy?: TableFieldExtractionStrategy;
  key_columns?: string[];        // see FormField — dual-written during migration
  anchor_columns?: string[];
  // Linked groups. Sent together: the handler drops any scope naming a group
  // this list does not declare, so removing a group demotes its columns to
  // per-row rather than leaving a dangling reference.
  groups?: string[];
  column_scopes?: Record<string, string>;
}

/** One column's proposed scope, from POST /forms/{id}/fields/{name}/suggest-groups. */
export interface SuggestedColumnScope {
  column: string;
  /** 'study' | 'row' | `group:<name>` — already reconciled server-side. */
  scope: string;
  reason: string;
}

export interface SuggestGroupsResponse {
  groups: string[];
  columns: SuggestedColumnScope[];
  notes: string;
  /** What the server had to fix in the model's answer — an invented column, an
   *  unanswered one, a measured result it tried to share. Shown, not hidden. */
  warnings: string[];
  cached: boolean;
}

export interface FieldEditsResponse {
  form_id: string;
  updated_fields: string[];
  warnings: Array<{ field: string; level: string; message: string }>;
  field_edits_version: number;
  signatures_rewritten?: boolean;
  extraction_warning?: string;
}

export interface FieldPrompt {
  signature: string;
  description: string;
  hints: string[];
  rules: string[];
  examples: Array<{ value: string; source_text?: string; note?: string } | string>;
  subform_fields?: Array<{ field_name: string; field_type: string; field_description?: string; hints?: string[]; rules?: string[]; examples?: any[] }>;
  // Served from schema_def — what the extractor will actually do, as opposed to
  // the forms.fields mirror the editor used to read. Null when the field is not
  // a table or carries no stored mode.
  extraction_strategy?: TableFieldExtractionStrategy | null;
  key_columns?: string[] | null;
}

export interface FieldPromptsResponse {
  form_id: string;
  field_prompts: Record<string, FieldPrompt>;
}

export interface Form {
  id: string;
  project_id: string;
  form_name: string;
  form_description: string | null;
  fields: FormField[];
  status: 'draft' | 'generating' | 'awaiting_review' | 'regenerating' | 'active' | 'failed';
  schema_name: string | null;
  statistics: any | null;
  error: string | null;
  metadata?: FormMetadata | null; // thread_id, decomposition, table_extraction_mode
  /** HITL #1 — pause code generation for decomposition review. Lives in the
   *  `forms.enable_review` COLUMN, never in `metadata`; read it from here. */
  enable_review?: boolean;
  created_at: string;
  updated_at: string;
  job_id?: string; // Optional: returned when generating code
}

// ── Pilot Study Types ────────────────────────────────────────────────────────

export interface PilotSubfieldFeedback {
  rating?: 'correct' | 'incorrect';
  correct_value?: string;
  correct_source_text?: string;
  note?: string;
}

export interface PilotFieldFeedback {
  /** Absent when only individual table columns were rated, not the parent field. */
  rating?: 'correct' | 'incorrect';
  correct_value?: string;
  correct_source_text?: string;
  note?: string;
  document_id: string;
  /** Per-table-column thumbs + corrections, keyed by subfield name. */
  subfield_corrections?: Record<string, PilotSubfieldFeedback>;
}

export interface PilotIteration {
  iteration: number;
  job_id: string;
  extraction_id: string;
  results: Record<string, Record<string, any>>; // doc_id -> field_name -> extracted data
  feedback: Record<string, PilotFieldFeedback>;
}

export interface PilotExample {
  value: any;
  source_text: string;
  note?: string;
  iteration: number;
  document_id: string;
}

export interface PilotState {
  status: 'none' | 'running' | 'reviewing' | 'failed' | 'completed';
  sample_document_ids?: string[];
  current_iteration?: number;
  iterations?: PilotIteration[];
  field_examples?: Record<string, PilotExample[]>;
  field_instructions?: Record<string, string>;
}

export interface PilotStartResponse {
  status: string;
  iteration: number;
  job_id: string;
  extraction_id: string;
  document_ids: string[];
}

export interface PilotFeedbackResponse {
  status: string;
  iteration: number;
  job_id: string;
  extraction_id: string;
  accumulated_examples: number;
  accumulated_instructions: number;
}

export interface PilotCompleteResponse {
  status: string;
  total_examples: number;
  fields_with_examples: number;
  fields_with_instructions: number;
}

export interface CreateFormRequest {
  project_id: string;
  form_name: string;
  form_description: string;  // Required!
  fields: FormField[];
  enable_review?: boolean;  // Optional, defaults to false
  save_as_draft?: boolean;  // Optional, defaults to false — skips code generation
}

export interface DuplicateFormRequest {
  form_name: string;
  target_project_id?: string;  // defaults to source form's project
  form_description?: string;   // defaults to source form's description
}

// Extractions
export interface Extraction {
  id: string;
  project_id: string;
  form_id: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'manual' | 'consensus';
  job_id: string | null;
  created_at: string;
}

export interface CreateExtractionRequest {
  project_id: string;
  form_id: string;
  document_ids?: string[];
  max_documents?: number;
}

// Results
export interface ExtractionResult {
  id: string;
  extraction_id: string | null;
  job_id: string | null;
  extraction_type: 'ai' | 'manual' | 'consensus';
  project_id: string;
  form_id: string;
  document_id: string;
  extracted_data: Record<string, any>;
  evaluation_metrics: any | null;
  extracted_by: string | null;
  reviewer_role: string | null;
  model_name?: string | null;
  created_at: string;
  /** When the row was last written. Added with the column in Sep 2026; older
   *  clients and rows may not carry it, hence optional. */
  updated_at?: string | null;
}

export interface ConsensusResult {
  id: string;
  project_id: string;
  form_id: string;
  document_id: string;
  review_mode: 'ai_only' | 'ai_manual';
  field_decisions: Record<string, any>;
  agreed_count: number;
  disputed_count: number;
  total_fields: number;
  agreement_pct: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// Jobs
export interface Job {
  id: string;
  user_id: string;
  project_id: string | null;
  job_type: 'pdf_processing' | 'form_generation' | 'extraction';
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  celery_task_id: string | null;
  input_data: any | null;
  result_data: any | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

// WebSocket Messages
export interface WSMessage {
  type: 'progress' | 'completed' | 'failed' | 'status_update' | 'paper_done';
  job_id: string;
  progress?: number;
  status?: string;
  message?: string;
  error?: string;
  data?: any;
  document_id?: string;
  success?: boolean;
  papers_done?: number;
  papers_total?: number;
}

// Activity Feed
export interface Activity {
  id: string;
  user_id: string;
  project_id: string | null;
  project_name?: string;
  action_type: 'upload' | 'extraction' | 'export' | 'code_generation' | 'form_create' | 'project_create';
  action: string;
  description: string;
  metadata: Record<string, any> | null;
  status: 'success' | 'failed' | 'pending' | null;
  created_at: string;
}

// Notifications
export interface Notification {
  id: string;
  user_id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  title: string;
  message: string;
  read: boolean;
  action_label: string | null;
  action_url: string | null;
  related_entity_type: string | null;
  related_entity_id: string | null;
  created_at: string;
}

// Project Roles
export type ProjectRole = 'owner' | 'manager' | 'member' | 'viewer';

// Project Members
export interface ProjectMemberPermissions {
  can_view_docs: boolean;
  can_upload_docs: boolean;
  can_create_forms: boolean;
  can_run_extractions: boolean;
  can_run_manual_extractions: boolean;
  can_view_results: boolean;
  can_adjudicate: boolean;
  can_qa_review: boolean;
  can_manage_assignments: boolean;
  can_manage_members: boolean;
}

export interface ProjectMember {
  id: string;
  project_id: string;
  user_id: string;
  email: string;
  full_name: string | null;
  role: ProjectRole;
  can_view_docs: boolean;
  can_upload_docs: boolean;
  can_create_forms: boolean;
  can_run_extractions: boolean;
  can_run_manual_extractions: boolean;
  can_view_results: boolean;
  can_adjudicate: boolean;
  can_qa_review: boolean;
  can_manage_assignments: boolean;
  can_manage_members: boolean;
  invited_by: string | null;
  created_at: string | null;
  last_seen_at: string | null;
}

export interface ProjectInvitation {
  id: string;
  project_id: string;
  email: string;
  role: ProjectRole;
  can_view_docs: boolean;
  can_upload_docs: boolean;
  can_create_forms: boolean;
  can_run_extractions: boolean;
  can_run_manual_extractions: boolean;
  can_view_results: boolean;
  can_adjudicate: boolean;
  can_qa_review: boolean;
  can_manage_assignments: boolean;
  can_manage_members: boolean;
  invited_by: string | null;
  invited_by_name: string | null;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  created_at: string;
  accept_url: string | null;
}

export interface ProjectInvitationCreate {
  email: string;
  role: ProjectRole;
  can_view_docs: boolean;
  can_upload_docs: boolean;
  can_create_forms: boolean;
  can_run_extractions: boolean;
  can_run_manual_extractions: boolean;
  can_view_results: boolean;
  can_adjudicate: boolean;
  can_qa_review: boolean;
  can_manage_assignments: boolean;
  can_manage_members: boolean;
}

export interface InvitationPreview {
  project_id: string;
  project_name: string;
  role: ProjectRole;
  invited_by_name: string | null;
  expires_at: string;
}

export interface ProjectMemberInvite {
  email: string;
  role: ProjectRole;
  can_view_docs: boolean;
  can_upload_docs: boolean;
  can_create_forms: boolean;
  can_run_extractions: boolean;
  can_run_manual_extractions: boolean;
  can_view_results: boolean;
  can_adjudicate: boolean;
  can_qa_review: boolean;
  can_manage_assignments: boolean;
  can_manage_members: boolean;
}

export interface ProjectMemberUpdate {
  role?: ProjectRole;
  can_view_docs?: boolean;
  can_upload_docs?: boolean;
  can_create_forms?: boolean;
  can_run_extractions?: boolean;
  can_run_manual_extractions?: boolean;
  can_view_results?: boolean;
  can_adjudicate?: boolean;
  can_qa_review?: boolean;
  can_manage_assignments?: boolean;
  can_manage_members?: boolean;
}

export interface MyPermissionsResponse {
  is_owner: boolean;
  is_admin: boolean;
  role: ProjectRole;
  can_view_docs: boolean;
  can_upload_docs: boolean;
  can_create_forms: boolean;
  can_run_extractions: boolean;
  can_run_manual_extractions: boolean;
  can_view_results: boolean;
  can_adjudicate: boolean;
  can_qa_review: boolean;
  can_manage_assignments: boolean;
  can_manage_members: boolean;
  /** Derived server-side (not a project_members column): rename / archive /
   *  restore. True for owners, global admins, and managers. */
  can_manage_project?: boolean;
}

export interface OwnershipTransferRequest {
  new_owner_id: string;
  previous_owner_role?: 'manager' | 'member' | 'viewer' | 'none';
}

export interface PermissionAuditLog {
  id: string;
  project_id: string;
  actor_id: string;
  target_user_id: string | null;
  action: string;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  created_at: string;
}

export interface ConsensusSummaryDoc {
  document_id: string;
  filename: string;
  /** Study ID for display ("Raslan 2021"), resolved server-side over the whole
   *  project so its a/b suffix matches every other screen. */
  study_label?: string;
  ref_id: number | null;
  has_ai: boolean;
  has_manual: boolean;
  has_consensus: boolean;
  agreement_pct: number | null;
  disputed_fields: number | null;
  total_fields: number | null;
  // Dual-reviewer fields
  has_r1: boolean;
  has_r2: boolean;
  /**
   * An adjudication row exists — NOT that it is finished. The review screen uses
   * this to decide whether to fetch saved resolutions back into the form, so it
   * must stay broad or an in-progress adjudication is lost on reload. Use
   * `has_adjudication_completed` for "done".
   */
  has_adjudication: boolean;
  /** Optional: added alongside `docs_done`; absent from older API responses. */
  adjudication_status?: 'in_progress' | 'completed' | null;
  has_adjudication_completed?: boolean;
  r1_r2_agreement_pct: number | null;
}

export interface ConsensusSummary {
  summary: {
    total_docs: number;
    ai_done: number;
    manual_done: number;
    consensus_done: number;
    avg_agreement_pct: number | null;
    r1_done: number;
    r2_done: number;
    adjudication_done: number;
    /**
     * Documents actually finished, counted once each. A dual-reviewer submit
     * writes both a consensus row and an adjudication row, so
     * `consensus_done + adjudication_done` double-counts every one of them —
     * which is what the dashboard's "Consensus" tile used to show. Optional so
     * the frontend behaves correctly both before and after the API deploys.
     */
    docs_done?: number;
  };
  documents: ConsensusSummaryDoc[];
}

// ============================================================================
// Review Assignments
// ============================================================================

export interface ReviewAssignment {
  id: string;
  project_id: string;
  document_id: string;
  reviewer_user_id: string;
  reviewer_role: 'reviewer_1' | 'reviewer_2' | 'adjudicator';
  status: 'pending' | 'in_progress' | 'completed' | 'skipped';
  assigned_by: string | null;
  assigned_at: string;
  started_at: string | null;
  completed_at: string | null;
  is_training: boolean;
  document_filename?: string;
  /** Study ID for display ("Raslan 2021"), resolved server-side across the
   *  whole project so its a/b suffix matches every other screen. */
  document_label?: string;
  reviewer_name?: string;
  forms_completed: number;
  forms_total: number;
  form_details?: Array<{
    form_id: string;
    form_name: string;
    completed: boolean;
  }>;
}

export interface BulkAssignmentCreate {
  project_id: string;
  assignments: Array<{
    document_id: string;
    reviewer_user_id: string;
    reviewer_role: 'reviewer_1' | 'reviewer_2' | 'adjudicator';
  }>;
}

export interface AutoAssignRequest {
  project_id: string;
  reviewer_1_id: string;
  reviewer_2_id: string;
  adjudicator_id: string;
  document_ids?: string[];
}

export interface AssignmentProgress {
  total_assignments: number;
  completed: number;
  completion_pct: number;
  by_role: Record<string, {
    total: number;
    pending: number;
    in_progress: number;
    completed: number;
    skipped: number;
  }>;
}

// ============================================================================
// Adjudication
// ============================================================================

export interface AdjudicationComparison {
  document_id: string;
  form_id: string;
  reviewer_1: { user_id: string; full_name: string; result_id: string };
  reviewer_2: { user_id: string; full_name: string; result_id: string };
  fields: AdjudicationField[];
  statistics: { agreed: number; disagreed: number; total: number; agreement_pct: number };
}

export interface AdjudicationField {
  field_name: string;
  reviewer_1_value: any;
  reviewer_2_value: any;
  agreed: boolean;
  ai_value?: any;
}

export interface AdjudicationResult {
  id: string;
  project_id: string;
  form_id: string;
  document_id: string;
  adjudicator_id: string;
  reviewer_1_result_id: string | null;
  reviewer_2_result_id: string | null;
  field_resolutions: Record<string, FieldResolution>;
  agreed_count: number;
  disagreed_count: number;
  total_fields: number;
  agreement_pct: number | null;
  status: 'in_progress' | 'completed';
  created_at: string;
  updated_at: string;
}

/**
 * How an adjudicator settled one field — the provenance of `final_value`, which
 * every export reads. Mirrors the backend's
 * `ResolutionSource` Literal in `app/models/schemas.py`; the two must stay in
 * step or a save 422s.
 *
 * `ai` and `majority` were being sent by the review screen long before they were
 * declared here, and neither had a branch in the restore path — so a field
 * resolved by accepting AI reopened as undecided and the document could never be
 * re-saved. `suggestion` is a legacy alias for `majority`.
 */
export type ResolutionSource =
  | 'agreed'
  | 'ai'
  | 'reviewer_1'
  | 'reviewer_2'
  | 'majority'
  | 'suggestion'
  | 'custom'
  | 'not_reported'
  | 'not_applicable';

export interface FieldResolution {
  reviewer_1_value: any;
  reviewer_2_value: any;
  agreed: boolean;
  final_value: any;
  resolution_source: ResolutionSource;
  adjudicator_note?: string;
}

export interface AdjudicationSummary {
  ready_for_adjudication: number;
  pending: number;
  in_progress: number;
  completed: number;
  avg_agreement_pct: number | null;
}

// ============================================================================
// Controlled Vocabularies
// ============================================================================

export interface ControlledVocabulary {
  id: string;
  project_id: string | null;
  name: string;
  description: string | null;
  terms: VocabularyTerm[];
  source: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface VocabularyTerm {
  term: string;
  synonyms?: string[];
  code?: string;
}

export interface FieldVocabularyMapping {
  id: string;
  form_id: string;
  field_name: string;
  vocabulary_id: string;
  validation_mode: 'suggest' | 'strict' | 'warn';
  created_at: string;
}

export interface VocabularySearchResult {
  vocabulary_id: string;
  vocabulary_name: string;
  term: string;
  synonyms: string[];
  code: string | null;
}

// ============================================================================
// Audit Trail
// ============================================================================

export interface AuditEntry {
  id: string;
  user_id: string;
  project_id: string | null;
  entity_type: string;
  entity_id: string;
  action: string;
  field_name: string | null;
  old_value: any;
  new_value: any;
  metadata: Record<string, any> | null;
  created_at: string;
  /** Resolved server-side by `audit_service.with_user_names`. A trail that
   *  names the actor as a raw UUID cannot be read by a human, which is why
   *  nothing ever rendered this table. */
  user_name: string | null;
  user_email: string | null;
}

/** One thing a person did to a form's results. `GET /results/activity`.
 *
 *  Structured, not pre-phrased: the wording lives in
 *  `results/_components/activityCopy.ts` next to the screen that renders it,
 *  the same way `lib/activity-helpers.ts` owns the existing feed's copy. */
export interface FormActivityEntry {
  id: string;
  created_at: string;
  user_id: string;
  user_name: string | null;
  user_email: string | null;
  entity_type: string;
  action: string;
  form_id: string | null;
  document_id: string | null;
  /** "Raslan 2021" — resolved project-wide so the a/b suffix matches every
   *  other screen. */
  study_label: string | null;
  field_name: string | null;
  reviewer_role: string | null;
  is_partial: boolean;
  /** A table field's is a shape summary (`{row_count, changed_columns}`), not a
   *  value. Readers must handle both. */
  old_value: any;
  new_value: any;
  changed_columns: string[] | null;
}

export interface FormActivityResponse {
  entries: FormActivityEntry[];
  /** True when the page filled up, so the UI can say "showing the latest N". */
  truncated: boolean;
}

// ============================================================================
// IRR Metrics
// ============================================================================

export interface IRRMetrics {
  overall: number | null;
  by_field: Record<string, number | null>;
  sample_size: number;
  metric_type: string;
}

// Source Linking
export interface SourceLocation {
  page: number;
  start_char: number;
  end_char: number;
  matched_text?: string;
  confidence: number;
}

export interface SourceIndexEntry {
  field: string;
  start_char: number;
  end_char: number;
  matched_text?: string;
}

export interface SourceIndexResponse {
  page_index: Record<string, SourceIndexEntry[]>;
}

export interface PageMapEntry {
  page: number;
  start_char: number;
  end_char: number;
}

export interface PageMapResponse {
  pages: PageMapEntry[];
}

// Issue Reports
export type IssueCategory = 'bug' | 'ui_issue' | 'feature_request' | 'performance' | 'other';
export type IssuePriority = 'low' | 'medium' | 'high' | 'critical';
export type IssueStatus = 'open' | 'in_progress' | 'resolved' | 'closed' | 'wont_fix';

export interface CreateIssueRequest {
  title: string;
  description: string;
  category?: IssueCategory;
  priority?: IssuePriority;
  page_url?: string;
  browser_info?: string;
  steps_to_reproduce?: string;
  metadata?: Record<string, unknown>;
}

export interface IssueReport {
  id: string;
  user_id: string | null;
  user_email: string | null;
  title: string;
  description: string;
  category: IssueCategory;
  priority: IssuePriority;
  page_url: string | null;
  browser_info: string | null;
  steps_to_reproduce: string | null;
  status: IssueStatus;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

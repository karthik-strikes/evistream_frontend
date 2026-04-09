/**
 * API Request/Response Types
 */

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
}

export interface AdminUserUpdate {
  is_active?: boolean;
  role?: 'admin' | 'user';
}

export interface AdminStats {
  total_users: number;
  total_projects: number;
  total_extractions: number;
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
}

export interface CreateProjectRequest {
  name: string;
  description?: string;
}

// Documents
export interface Document {
  id: string;
  project_id: string;
  filename: string;
  unique_filename: string | null;
  s3_pdf_path: string | null;
  s3_markdown_path: string | null;
  processing_status: 'pending' | 'processing' | 'completed' | 'failed';
  processing_error: string | null;
  labels: string[];
  created_at: string;
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
export interface FormField {
  field_name: string;
  field_type: string;
  field_description: string;
  field_control_type?: string;
  options?: string[];
  multiple?: boolean;
  example?: string;
  extraction_hints?: string;
  subform_fields?: FormField[];
}

export interface Form {
  id: string;
  project_id: string;
  form_name: string;
  form_description: string | null;
  fields: FormField[];
  status: 'draft' | 'generating' | 'awaiting_review' | 'regenerating' | 'active' | 'failed';
  schema_name: string | null;
  task_dir: string | null;
  statistics: any | null;
  error: string | null;
  metadata?: any | null; // Workflow state for human review (thread_id, decomposition)
  created_at: string;
  updated_at: string;
  job_id?: string; // Optional: returned when generating code
}

// ── Pilot Study Types ────────────────────────────────────────────────────────

export interface PilotFieldFeedback {
  rating: 'correct' | 'incorrect';
  correct_value?: string;
  correct_source_text?: string;
  note?: string;
  document_id: string;
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
  created_at: string;
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
  can_view_results: boolean;
  can_adjudicate: boolean;
  can_qa_review: boolean;
  can_manage_assignments: boolean;
  can_manage_members: boolean;
  invited_by: string | null;
  created_at: string;
}

export interface ProjectMemberInvite {
  email: string;
  role: ProjectRole;
  can_view_docs: boolean;
  can_upload_docs: boolean;
  can_create_forms: boolean;
  can_run_extractions: boolean;
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
  can_view_results: boolean;
  can_adjudicate: boolean;
  can_qa_review: boolean;
  can_manage_assignments: boolean;
  can_manage_members: boolean;
}

export interface OwnershipTransferRequest {
  new_owner_id: string;
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
  has_ai: boolean;
  has_manual: boolean;
  has_consensus: boolean;
  agreement_pct: number | null;
  disputed_fields: number | null;
  total_fields: number | null;
  // Dual-reviewer fields
  has_r1: boolean;
  has_r2: boolean;
  has_adjudication: boolean;
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

export interface FieldResolution {
  reviewer_1_value: any;
  reviewer_2_value: any;
  agreed: boolean;
  final_value: any;
  resolution_source: 'reviewer_1' | 'reviewer_2' | 'custom' | 'agreed';
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
// QA Reviews
// ============================================================================

export interface QAReview {
  id: string;
  project_id: string;
  form_id: string;
  document_id: string;
  qa_reviewer_id: string;
  source_result_id: string | null;
  source_adjudication_id: string | null;
  status: 'pending' | 'in_progress' | 'passed' | 'flagged';
  field_comments: Record<string, FieldComment>;
  overall_comment: string | null;
  flagged_field_count: number;
  total_fields_reviewed: number;
  created_at: string;
  updated_at: string;
  document_filename?: string;
}

export interface FieldComment {
  issue_type: 'incorrect_value' | 'missing_data' | 'formatting' | 'inconsistency';
  comment: string;
  severity: 'minor' | 'major' | 'critical';
  suggested_value?: string;
  resolved: boolean;
  resolved_by: string | null;
  resolved_at: string | null;
}

export interface QADashboard {
  total_reviews: number;
  passed: number;
  flagged: number;
  pending: number;
  pass_rate: number;
  field_error_rates: Record<string, number>;
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
// Validation Rules
// ============================================================================

export interface ValidationRule {
  id: string;
  form_id: string;
  field_name: string;
  rule_type: 'range' | 'format' | 'required' | 'cross_field' | 'regex';
  rule_config: Record<string, any>;
  severity: 'error' | 'warning' | 'info';
  message: string;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
}

// ============================================================================
// Data Cleaning
// ============================================================================

export interface DataCleaningRow {
  document_id: string;
  filename: string;
  data_source: 'adjudicated' | 'reviewer_1' | 'ai' | 'manual';
  values: Record<string, any>;
  violations: DataViolation[];
}

export interface DataViolation {
  field_name: string;
  rule_id: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
}

export interface BulkEditRequest {
  project_id: string;
  form_id: string;
  edits: Array<{
    document_id: string;
    field_name: string;
    old_value: any;
    new_value: any;
  }>;
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

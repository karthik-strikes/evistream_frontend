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
  token_type: string;
  user_id?: string;
}

export interface User {
  id: string;
  email: string;
  full_name: string;
  is_active: boolean;
  created_at: string;
}

// Projects
export interface Project {
  id: string;
  name: string;
  description: string | null;
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

export interface CreateFormRequest {
  project_id: string;
  form_name: string;
  form_description: string;  // Required!
  fields: FormField[];
  enable_review?: boolean;  // Optional, defaults to false
}

// Extractions
export interface Extraction {
  id: string;
  project_id: string;
  form_id: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
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
  job_id: string | null;
  project_id: string;
  form_id: string;
  document_id: string;
  extracted_data: Record<string, any>;
  evaluation_metrics: any | null;
  created_at: string;
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
  type: 'progress' | 'completed' | 'failed' | 'status_update';
  job_id: string;
  progress?: number;
  status?: string;
  message?: string;
  error?: string;
  data?: any;
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

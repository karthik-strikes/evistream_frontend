// Project Home payloads — GET /api/v1/dashboard/home/{section}.
// Mirrors backend/app/services/dashboard_home_service.py; keep the two in sync.

// Unexpected failures are real HTTP errors (500), never a 200 envelope.
export type HomeStatus = 'ready' | 'restricted' | 'not_configured';
export interface HomeEnvelope<T> {
  status: HomeStatus;
  generated_at: string;           // ISO
  data: T | null;                 // null unless status === 'ready'
  message?: string | null;        // human explanation for restricted / not_configured
}

export type Workflow = 'documents' | 'ai' | 'forms' | 'consensus' | 'neutral';
export type Seat = 'reviewer_1' | 'reviewer_2' | 'adjudicator';

// ── context ────────────────────────────────────────────────────────────
export interface HomeContext {
  documents: {
    total: number;
    ready: number;                // completed OR (metadata_only AND metadata_extraction_approved)
    need_source: number;          // needs_pdf OR (metadata_only AND NOT approved)
    metadata_only_accepted: number;
    processing: number;           // pending|processing
    failed: number;               // processing_status failed
  };
  forms: {                        // RoB 2 forms EXCLUDED (tracked in their module)
    active: number;
    in_setup: number;             // draft|generating|regenerating
    awaiting_review: number;
    failed: number;
  };
  processing: { running: number; queued: number; failed: number } | null;
  // jobs of this project: running=processing, queued=pending, failed=failed in last 7 days.
  // null when running+queued+failed === 0 (UI omits the cell)
}

// ── forms ──────────────────────────────────────────────────────────────
export interface StageCell {
  state: 'ok' | 'not_assigned' | 'restricted';
  n: number;                      // numerator (0 when not ok)
  d: number;                      // denominator (0 when not ok)
  running?: number;               // AI only
  failed?: number;                // AI only
}
export interface HomeFormRow {
  form_id: string;
  form_name: string;
  status: 'active' | 'draft' | 'generating' | 'regenerating' | 'awaiting_review' | 'failed';
  pilot_ready: boolean;           // pilot results exist and are unreviewed, if detectable; else false
  ai: StageCell | null;           // null for non-active forms
  r1: StageCell | null;
  r2: StageCell | null;
  consensus: StageCell | null;
}
export interface HomeSeatRow {
  user_id: string;
  name: string;
  seat: Seat;
  finished: number;               // review_assignments.status === 'completed' (declared)
  in_progress: number;
  pending: number;
  skipped: number;
}
export interface HomeForms {
  ai_eligible: number;            // = context.documents.ready
  allocated: number;              // distinct documents with an R1 or R2 assignment
  rows: HomeFormRow[];            // active first (by name), then setup states
  seats: HomeSeatRow[];           // [] when the viewer may not see project-wide assignment totals
  additional_reviewers: { people: number; saved_forms: number };  // manual rows by people holding no R1/R2 seat on that doc
  processing: { running: number; queued: number; failed: number };  // extraction jobs only
  blinded: boolean;               // true → r1/r2 cells are 'restricted' for this viewer
}

// ── work (the caller's own work + attention) ───────────────────────────
export interface HomeAttentionItem {
  id: string;
  kind: 'need_pdfs' | 'form_review' | 'form_failed' | 'extraction_failed' | 'pilot_ready'
      | 'seat_missing' | 'consensus_ready' | 'synthesis_approval' | 'rob_consensus';
  workflow: Workflow;
  title: string;                  // "3 documents need PDFs"
  reason: string;                 // "Source text is not available yet"
  action: string;                 // "Open documents"
  href: string;                   // existing route (audit §6 contracts)
}
export interface HomeWaitingItem {
  id: string;
  workflow: Workflow;
  title: string;
  reason: string;
  who: string;                    // "M. Oyelaran" / "project manager"
}
export interface HomeExtractionTask {
  assignment_id: string;
  document_id: string;
  document_label: string;         // project-wide study label
  role: Seat;
  status: 'pending' | 'in_progress' | 'completed' | 'skipped';
  forms_saved: number;            // caller's non-partial manual rows over active forms
  forms_total: number;
  form_states: Record<string, 'todo' | 'partial' | 'done'>; // form_id → state for the caller
  next_form_id: string | null;    // first active form not done
  ready: boolean;                 // document ready for extraction
  updated_at: string | null;      // caller's latest save on this doc, if any
}
export interface HomeConsensusTask {
  document_id: string;
  document_label: string;
  form_id: string;
  form_name: string;
  readers: string;                // "R1 + R2 saved" / "R1 saved · R2 pending"
  state: 'ready' | 'waiting';
}
export interface HomeRobTask {
  document_id: string;
  study_label: string;
  target_id: string;
  target_label: string;
  seat: Seat;
  domains_judged: number;
  domains_total: number;
  state: 'progress' | 'not_started' | 'consensus_needed';
}
export interface HomeSynthesisTask {
  group_id: string;
  title: string;
  version: number;
  required: string;               // "Approval"
}
export interface HomeWork {
  has_assignments: boolean;       // any non-completed, non-skipped extraction assignment OR rob/synthesis task
  responsibilities: string[];     // ["Reviewer 1", "RoB Reviewer 2", "Consensus", "Synthesis approver"]
  forms: { form_id: string; form_name: string }[];  // active non-RoB forms, for next_form lookup
  attention: HomeAttentionItem[]; // ordered, audit §4; UI shows 5
  waiting: HomeWaitingItem[];
  extraction: HomeExtractionTask[];
  consensus: HomeConsensusTask[];
  rob: HomeRobTask[];
  synthesis: HomeSynthesisTask[];
}

// ── rob ────────────────────────────────────────────────────────────────
export interface HomeRob {
  scope: 'outcome' | 'result';
  studies: number;
  targets_total: number;
  both_complete: number;
  one_complete: number;
  waiting_r1: number;
  waiting_r2: number;
  consensus_needed: number;
  held: number;
}
// status 'not_configured' when no rob_protocols row exists for the project.

// ── synthesis ──────────────────────────────────────────────────────────
export interface HomeSynthesisRow {
  id: string;
  title: string;
  branch: 'ma' | 'swim' | null;
  state: 'draft' | 'in_progress' | 'awaiting' | 'finalized' | 'ready' | 'needs_review';
  freshness: 'fresh' | 'stale' | 'unverified';
  version: number | null;         // latest unsuperseded saved version n
  can_approve: boolean;           // caller is protocol approver AND not the finalizer of that version
}
export interface HomeSynthesis { groups: HomeSynthesisRow[] }
// status 'not_configured' when the project has no synthesis groups.

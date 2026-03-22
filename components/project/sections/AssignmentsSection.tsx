'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Users, UserPlus, Loader2, CheckCircle2, Clock, AlertCircle,
  ClipboardList, LayoutDashboard, BarChart3, FileText, Eye,
  Play, SkipForward, Circle, ArrowRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { typography } from '@/lib/typography';
import { assignmentsService, formsService, projectMembersService, resultsService } from '@/services';
import type {
  AssignmentProgress, ProjectMember, ReviewAssignment,
  Form, ConsensusSummary, ConsensusSummaryDoc,
} from '@/types/api';
import { useToast } from '@/hooks/use-toast';
import { EmptyState } from '@/components/ui';

interface AssignmentsSectionProps {
  projectId: string;
  progress: AssignmentProgress | null;
  onProgressChange: (p: AssignmentProgress | null) => void;
}

type TabView = 'tracking' | 'formal' | 'my-queue';

// ============================================================================
// Badge helpers
// ============================================================================

function RoleBadge({ role }: { role: string }) {
  const colors: Record<string, string> = {
    reviewer_1: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-400',
    reviewer_2: 'border-purple-200 bg-purple-50 text-purple-700 dark:border-purple-800 dark:bg-purple-900/20 dark:text-purple-400',
    adjudicator: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-400',
  };
  const labels: Record<string, string> = { reviewer_1: 'R1', reviewer_2: 'R2', adjudicator: 'Adj' };
  return (
    <span className={cn('rounded-[5px] px-2 py-0.5 text-[10.5px] font-semibold tracking-wide border', colors[role] || 'border-gray-200 bg-gray-50 text-gray-700')}>
      {labels[role] || role}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: 'border-gray-200 bg-gray-100 text-gray-600 dark:border-[#2a2a2a] dark:bg-[#1a1a1a] dark:text-zinc-400',
    in_progress: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-400',
    completed: 'border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-400',
    skipped: 'border-yellow-200 bg-yellow-50 text-yellow-700 dark:border-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400',
  };
  return (
    <span className={cn('rounded-[5px] px-2 py-0.5 text-[10.5px] font-semibold tracking-wide border', colors[status] || '')}>
      {status.replace('_', ' ')}
    </span>
  );
}

function DocStatusBadge({ doc }: { doc: ConsensusSummaryDoc }) {
  const extractionCount = (doc.has_r1 ? 1 : 0) + (doc.has_r2 ? 1 : 0) + (doc.has_ai ? 1 : 0) + (doc.has_manual ? 1 : 0);
  if (doc.has_adjudication || doc.has_consensus) {
    return <span className="rounded-[5px] px-2 py-0.5 text-[10.5px] font-semibold tracking-wide border border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-400">Adjudicated</span>;
  }
  if (extractionCount >= 2) {
    return <span className="rounded-[5px] px-2 py-0.5 text-[10.5px] font-semibold tracking-wide border border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-400">Ready for comparison</span>;
  }
  if (extractionCount === 1) {
    return <span className="rounded-[5px] px-2 py-0.5 text-[10.5px] font-semibold tracking-wide border border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-400">1 extraction</span>;
  }
  return <span className="rounded-[5px] px-2 py-0.5 text-[10.5px] font-semibold tracking-wide border border-gray-200 bg-gray-100 text-gray-600 dark:border-[#2a2a2a] dark:bg-[#1a1a1a] dark:text-zinc-400">Needs extraction</span>;
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 dark:border-[#1f1f1f] dark:bg-[#111111] py-4 px-5">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-500 mb-1">{label}</p>
      <p className={cn('text-xl font-bold tabular-nums', color)}>{value}</p>
    </div>
  );
}

function FormProgressBar({ completed, total }: { completed: number; total: number }) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const isComplete = completed === total && total > 0;
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 bg-gray-200 dark:bg-[#1a1a1a] rounded-full h-1.5">
        <div
          className={cn('h-1.5 rounded-full transition-all', isComplete ? 'bg-green-500' : 'bg-blue-500')}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={cn(
        'text-[11px] font-medium tabular-nums',
        isComplete ? 'text-green-600 dark:text-green-400' : 'text-gray-500 dark:text-zinc-400',
      )}>
        {completed}/{total}
      </span>
    </div>
  );
}

// ============================================================================
// Main component
// ============================================================================

export function AssignmentsSection({ projectId, progress, onProgressChange }: AssignmentsSectionProps) {
  const router = useRouter();
  const { toast } = useToast();

  const [tab, setTab] = useState<TabView>('tracking');
  const [loading, setLoading] = useState(true);

  // Common
  const [forms, setForms] = useState<Form[]>([]);
  const [members, setMembers] = useState<ProjectMember[]>([]);

  // Tracking
  const [trackingFormId, setTrackingFormId] = useState('');
  const [consensusSummary, setConsensusSummary] = useState<ConsensusSummary | null>(null);
  const [loadingTracking, setLoadingTracking] = useState(false);

  // Formal
  const [reviewer1Id, setReviewer1Id] = useState('');
  const [reviewer2Id, setReviewer2Id] = useState('');
  const [adjudicatorId, setAdjudicatorId] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [projectAssignments, setProjectAssignments] = useState<ReviewAssignment[]>([]);

  // My Queue
  const [myAssignments, setMyAssignments] = useState<ReviewAssignment[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // ---- Data loading ----

  const loadCommon = useCallback(async () => {
    try {
      const [formsData, membersData] = await Promise.all([
        formsService.getAll(projectId),
        projectMembersService.listMembers(projectId),
      ]);
      setForms(formsData);
      setMembers(membersData);
    } catch { /* silent */ }
  }, [projectId]);

  const loadMyAssignments = useCallback(async () => {
    try {
      const data = await assignmentsService.getMyAssignments({ projectId });
      setMyAssignments(data);
    } catch { /* silent */ }
  }, [projectId]);

  const loadTrackingSummary = useCallback(async () => {
    if (!trackingFormId) return;
    setLoadingTracking(true);
    try {
      const data = await resultsService.getConsensusSummary(projectId, trackingFormId);
      setConsensusSummary(data);
    } catch {
      toast({ title: 'Error', description: 'Failed to load tracking data', variant: 'error' });
    } finally {
      setLoadingTracking(false);
    }
  }, [projectId, trackingFormId, toast]);

  const loadFormalData = useCallback(async () => {
    try {
      const [assignmentsData, prog] = await Promise.all([
        assignmentsService.getProjectAssignments(projectId),
        assignmentsService.getProgress(projectId),
      ]);
      setProjectAssignments(assignmentsData);
      onProgressChange(prog);
    } catch { /* silent */ }
  }, [projectId, onProgressChange]);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadCommon(), loadMyAssignments()]).finally(() => setLoading(false));
  }, [loadCommon, loadMyAssignments]);

  useEffect(() => {
    if (tab === 'tracking') loadTrackingSummary();
  }, [tab, loadTrackingSummary]);

  useEffect(() => {
    if (tab === 'formal') loadFormalData();
  }, [tab, loadFormalData]);

  // Auto-select first form for tracking
  useEffect(() => {
    const active = forms.filter(f => f.status === 'active');
    if (active.length > 0 && !trackingFormId) {
      setTrackingFormId(active[0].id);
    }
  }, [forms, trackingFormId]);

  // ---- Handlers ----

  const handleStatusUpdate = async (id: string, status: string) => {
    try {
      await assignmentsService.updateStatus(id, status);
      toast({ title: 'Updated', description: `Assignment ${status}` });
      loadMyAssignments();
    } catch {
      toast({ title: 'Error', description: 'Failed to update status', variant: 'error' });
    }
  };

  const handleAutoAssign = async () => {
    if (!reviewer1Id || !reviewer2Id || !adjudicatorId) {
      toast({ title: 'Missing selections', description: 'Please select all three roles', variant: 'error' });
      return;
    }
    setAssigning(true);
    try {
      const result = await assignmentsService.autoAssign({
        project_id: projectId,
        reviewer_1_id: reviewer1Id,
        reviewer_2_id: reviewer2Id,
        adjudicator_id: adjudicatorId,
      });
      toast({ title: 'Assigned', description: `${result.length} assignments created` });
      loadFormalData();
    } catch {
      toast({ title: 'Error', description: 'Failed to auto-assign', variant: 'error' });
    } finally {
      setAssigning(false);
    }
  };

  const navigateToExtract = (documentId: string, formId?: string) => {
    const params = new URLSearchParams({ document_id: documentId });
    if (formId) params.append('form_id', formId);
    router.push(`/manual-extraction?${params.toString()}`);
  };

  // ---- Tracking stats ----

  const trackingStats = useMemo(() => {
    if (!consensusSummary) return { total: 0, oneExtraction: 0, ready: 0, adjudicated: 0 };
    const docs = consensusSummary.documents;
    let oneExtraction = 0, ready = 0, adjudicated = 0;
    for (const d of docs) {
      const count = (d.has_r1 ? 1 : 0) + (d.has_r2 ? 1 : 0) + (d.has_ai ? 1 : 0) + (d.has_manual ? 1 : 0);
      if (d.has_adjudication || d.has_consensus) adjudicated++;
      else if (count >= 2) ready++;
      else if (count === 1) oneExtraction++;
    }
    return { total: docs.length, oneExtraction, ready, adjudicated };
  }, [consensusSummary]);

  const activeForms = forms.filter(f => f.status === 'active');

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <div>
      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 dark:bg-[#1a1a1a] p-1 rounded-lg w-fit">
        {([
          { id: 'tracking' as TabView, label: 'Tracking', icon: LayoutDashboard },
          { id: 'formal' as TabView, label: 'Assign Reviewers', icon: Users },
          { id: 'my-queue' as TabView, label: 'My Queue', icon: ClipboardList },
        ]).map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors',
              tab === t.id
                ? 'bg-white dark:bg-[#2a2a2a] text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-500 dark:text-zinc-500 hover:text-gray-700 dark:hover:text-zinc-300',
            )}
          >
            <t.icon className="h-4 w-4" />
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : (
        <>
          {/* ================================================================ */}
          {/* TAB 1: Tracking Dashboard                                        */}
          {/* ================================================================ */}
          {tab === 'tracking' && (
            <div className="space-y-6">
              {/* Form selector */}
              <div className="flex items-center gap-3">
                <label className="text-xs font-medium text-gray-700 dark:text-zinc-400">Form</label>
                <select
                  value={trackingFormId}
                  onChange={e => setTrackingFormId(e.target.value)}
                  className="max-w-md px-3 py-1.5 text-sm text-gray-900 dark:text-white bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a] rounded-lg outline-none focus:border-gray-400 dark:focus:border-[#3f3f3f] transition-colors cursor-pointer dark:[color-scheme:dark]"
                >
                  <option value="">Select a form...</option>
                  {activeForms.map(f => (
                    <option key={f.id} value={f.id}>{f.form_name}</option>
                  ))}
                </select>
              </div>

              {!trackingFormId ? (
                <EmptyState
                  icon={BarChart3}
                  title="Select a form"
                  description="Choose an active form above to see extraction progress across documents."
                />
              ) : loadingTracking ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                </div>
              ) : !consensusSummary || consensusSummary.documents.length === 0 ? (
                <EmptyState
                  icon={FileText}
                  title="No documents yet"
                  description="Upload documents and run extractions to see progress here."
                />
              ) : (
                <>
                  {/* Stats bar */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <StatCard label="Total Documents" value={trackingStats.total} color="text-gray-900 dark:text-white" />
                    <StatCard label="1 Extraction" value={trackingStats.oneExtraction} color="text-blue-600 dark:text-blue-400" />
                    <StatCard label="Ready for Comparison" value={trackingStats.ready} color="text-amber-600 dark:text-amber-400" />
                    <StatCard label="Adjudicated" value={trackingStats.adjudicated} color="text-green-600 dark:text-green-400" />
                  </div>

                  {/* Document cards */}
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-1.5 h-1.5 rounded-full bg-gray-900 dark:bg-white" />
                      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-zinc-500">Documents</h3>
                    </div>
                    <div className="space-y-2">
                      {consensusSummary.documents.map(doc => {
                        const extractors: string[] = [];
                        if (doc.has_ai) extractors.push('AI');
                        if (doc.has_manual) extractors.push('Manual');
                        if (doc.has_r1) extractors.push('R1');
                        if (doc.has_r2) extractors.push('R2');
                        const count = extractors.length;

                        return (
                          <div
                            key={doc.document_id}
                            onClick={() => router.push('/consensus')}
                            className="group bg-white rounded-xl border border-gray-200 py-4 px-[22px] relative transition-all duration-150 cursor-pointer hover:shadow-card-hover hover:-translate-y-px dark:bg-[#111111] dark:border-[#1f1f1f]"
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3 min-w-0">
                                <FileText className="h-4 w-4 text-gray-400 flex-shrink-0" />
                                <span className="text-sm font-medium text-gray-900 dark:text-white truncate">
                                  {doc.filename}
                                </span>
                                <div className="flex items-center gap-1.5">
                                  {extractors.map(e => (
                                    <span
                                      key={e}
                                      className="rounded-[5px] px-2 py-0.5 text-[10.5px] font-semibold tracking-wide border border-gray-200 bg-gray-100 text-gray-600 dark:border-[#2a2a2a] dark:bg-[#1a1a1a] dark:text-zinc-400"
                                    >
                                      {e}
                                    </span>
                                  ))}
                                </div>
                              </div>
                              <div className="flex items-center gap-3 flex-shrink-0">
                                <span className="text-xs text-gray-400">
                                  {count} extraction{count !== 1 ? 's' : ''}
                                </span>
                                <DocStatusBadge doc={doc} />
                                <Eye className="h-4 w-4 text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ================================================================ */}
          {/* TAB 2: Assign Reviewers                                          */}
          {/* ================================================================ */}
          {tab === 'formal' && (
            <div className="space-y-6">
              {/* Auto-assign card */}
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-600" />
                  <h3 className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-zinc-500">Auto-Assign Reviewers</h3>
                </div>
                <p className="text-sm text-gray-500 dark:text-zinc-400 mb-4">
                  Assign reviewers to all completed documents. They will need to extract all active forms for each assigned document.
                </p>
                {members.length === 0 ? (
                  <p className="text-sm text-amber-600 dark:text-amber-400">
                    No team members found. Invite members to this project first.
                  </p>
                ) : (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                      <div>
                        <label className="block text-xs font-medium text-blue-600 dark:text-blue-400 mb-1">Reviewer 1</label>
                        <select
                          value={reviewer1Id}
                          onChange={e => setReviewer1Id(e.target.value)}
                          className="w-full px-3 py-1.5 text-sm text-gray-900 dark:text-white bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a] rounded-lg outline-none focus:border-gray-400 dark:focus:border-[#3f3f3f] transition-colors cursor-pointer dark:[color-scheme:dark]"
                        >
                          <option value="">Select R1...</option>
                          {members.map(m => (
                            <option key={m.user_id} value={m.user_id}>{m.full_name || m.email}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-purple-600 dark:text-purple-400 mb-1">Reviewer 2</label>
                        <select
                          value={reviewer2Id}
                          onChange={e => setReviewer2Id(e.target.value)}
                          className="w-full px-3 py-1.5 text-sm text-gray-900 dark:text-white bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a] rounded-lg outline-none focus:border-gray-400 dark:focus:border-[#3f3f3f] transition-colors cursor-pointer dark:[color-scheme:dark]"
                        >
                          <option value="">Select R2...</option>
                          {members.filter(m => m.user_id !== reviewer1Id).map(m => (
                            <option key={m.user_id} value={m.user_id}>{m.full_name || m.email}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-amber-600 dark:text-amber-400 mb-1">Adjudicator</label>
                        <select
                          value={adjudicatorId}
                          onChange={e => setAdjudicatorId(e.target.value)}
                          className="w-full px-3 py-1.5 text-sm text-gray-900 dark:text-white bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a] rounded-lg outline-none focus:border-gray-400 dark:focus:border-[#3f3f3f] transition-colors cursor-pointer dark:[color-scheme:dark]"
                        >
                          <option value="">Select Adj...</option>
                          {members.filter(m => m.user_id !== reviewer1Id && m.user_id !== reviewer2Id).map(m => (
                            <option key={m.user_id} value={m.user_id}>{m.full_name || m.email}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <button
                      onClick={handleAutoAssign}
                      disabled={assigning || !reviewer1Id || !reviewer2Id || !adjudicatorId}
                      className="text-sm font-semibold text-white bg-gray-900 dark:bg-white dark:text-black border-none rounded-lg px-4 py-2 cursor-pointer hover:bg-gray-700 dark:hover:bg-zinc-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
                    >
                      {assigning ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
                      {assigning ? 'Assigning...' : 'Auto-Assign All Documents'}
                    </button>
                  </>
                )}
              </div>

              {/* Progress section */}
              {progress && Object.keys(progress.by_role).length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-600" />
                    <h3 className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-zinc-500">Progress</h3>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {Object.entries(progress.by_role).map(([role, data]) => {
                      const pct = data.total > 0 ? Math.round((data.completed / data.total) * 100) : 0;
                      return (
                        <div key={role} className="p-4 rounded-xl border border-gray-200 dark:border-[#1f1f1f] bg-white dark:bg-[#111111]">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium text-gray-900 dark:text-white capitalize">{role.replace('_', ' ')}</span>
                            <span className="text-xs font-semibold text-gray-400 dark:text-zinc-500 tabular-nums">{data.completed}/{data.total}</span>
                          </div>
                          <div className="w-full bg-gray-100 dark:bg-[#1a1a1a] rounded-full h-1.5 mb-1.5">
                            <div
                              className={cn(
                                'h-1.5 rounded-full transition-all',
                                pct === 100 ? 'bg-green-500' : pct > 0 ? 'bg-blue-500' : 'bg-gray-200 dark:bg-[#2a2a2a]',
                              )}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <div className="flex items-center gap-3 text-xs text-gray-400">
                            {data.in_progress > 0 && (
                              <span className="flex items-center gap-1"><Clock size={10} /> {data.in_progress} in progress</span>
                            )}
                            {data.pending > 0 && (
                              <span className="flex items-center gap-1"><AlertCircle size={10} /> {data.pending} pending</span>
                            )}
                            {pct === 100 && (
                              <span className="flex items-center gap-1 text-green-500"><CheckCircle2 size={10} /> Complete</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Assignment table */}
              {projectAssignments.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-purple-600" />
                    <h3 className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-zinc-500">Assignments</h3>
                  </div>
                  <div className="bg-white dark:bg-[#111111] border border-gray-200 dark:border-[#1f1f1f] rounded-xl overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 dark:bg-[#0d0d0d]">
                        <tr>
                          <th className="px-5 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-zinc-500">Document</th>
                          <th className="px-5 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-zinc-500">Reviewer</th>
                          <th className="px-5 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-zinc-500">Role</th>
                          <th className="px-5 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-zinc-500">Forms</th>
                          <th className="px-5 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-zinc-500">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-[#1f1f1f]">
                        {projectAssignments.map(a => (
                          <tr key={a.id} className="hover:bg-gray-50 dark:hover:bg-[#0d0d0d] transition-colors">
                            <td className="px-5 py-3.5 text-sm text-gray-900 dark:text-zinc-200">{a.document_filename || a.document_id}</td>
                            <td className="px-5 py-3.5 text-sm text-gray-500 dark:text-zinc-400">{a.reviewer_name || a.reviewer_user_id}</td>
                            <td className="px-5 py-3.5"><RoleBadge role={a.reviewer_role} /></td>
                            <td className="px-5 py-3.5"><FormProgressBar completed={a.forms_completed} total={a.forms_total} /></td>
                            <td className="px-5 py-3.5"><StatusBadge status={a.status} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ================================================================ */}
          {/* TAB 3: My Queue                                                  */}
          {/* ================================================================ */}
          {tab === 'my-queue' && (
            <div className="space-y-3">
              {myAssignments.length === 0 ? (
                <EmptyState
                  icon={ClipboardList}
                  title="No assignments yet"
                  description="When a project owner assigns you documents, they will appear here."
                />
              ) : (
                myAssignments.map(a => {
                  const isExpanded = expandedId === a.id;

                  return (
                    <div
                      key={a.id}
                      className="bg-white rounded-xl border border-gray-200 relative transition-all duration-150 dark:bg-[#111111] dark:border-[#1f1f1f]"
                    >
                      {/* Main row */}
                      <div
                        className="group py-4 px-[22px] cursor-pointer hover:bg-gray-50 dark:hover:bg-[#1a1a1a] rounded-xl transition-colors"
                        onClick={() => setExpandedId(isExpanded ? null : a.id)}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-4 min-w-0">
                            <RoleBadge role={a.reviewer_role} />
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                                {a.document_filename || 'Unknown document'}
                              </p>
                              <p className="text-xs text-gray-400 dark:text-zinc-500 mt-0.5">
                                Assigned {new Date(a.assigned_at).toLocaleDateString()}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-4 flex-shrink-0">
                            <FormProgressBar completed={a.forms_completed} total={a.forms_total} />
                            <StatusBadge status={a.status} />
                            {/* Action buttons */}
                            <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                              {a.status === 'pending' && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleStatusUpdate(a.id, 'in_progress'); }}
                                  className="flex items-center gap-1.5 text-sm font-semibold text-white bg-gray-900 dark:bg-white dark:text-black rounded-lg px-3 py-1.5 hover:bg-gray-700 dark:hover:bg-zinc-100 transition-colors"
                                >
                                  <Play className="h-3 w-3" /> Start
                                </button>
                              )}
                              {(a.status === 'pending' || a.status === 'in_progress') && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleStatusUpdate(a.id, 'skipped'); }}
                                  className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-zinc-400 bg-transparent border-none px-3 py-1.5 rounded-lg cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-[#1a1a1a]"
                                >
                                  <SkipForward className="h-3 w-3" /> Skip
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Expanded: per-form checklist */}
                      {isExpanded && a.form_details && a.form_details.length > 0 && (
                        <div className="border-t border-gray-100 dark:border-[#1f1f1f] px-[22px] py-3">
                          <p className="text-xs font-medium text-gray-500 dark:text-zinc-400 mb-2">Forms</p>
                          <div className="space-y-1.5">
                            {a.form_details.map(f => (
                              <div
                                key={f.form_id}
                                className="flex items-center justify-between py-1.5 px-3 rounded-lg hover:bg-gray-50 dark:hover:bg-[#1a1a1a] transition-colors"
                              >
                                <div className="flex items-center gap-2.5">
                                  {f.completed ? (
                                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                                  ) : (
                                    <Circle className="h-4 w-4 text-gray-300 dark:text-zinc-600" />
                                  )}
                                  <span className={cn(
                                    'text-sm',
                                    f.completed
                                      ? 'text-gray-400 dark:text-zinc-500 line-through'
                                      : 'text-gray-900 dark:text-white',
                                  )}>
                                    {f.form_name}
                                  </span>
                                </div>
                                {!f.completed && a.status !== 'completed' && a.status !== 'skipped' && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); navigateToExtract(a.document_id, f.form_id); }}
                                    className="flex items-center gap-1 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
                                  >
                                    Extract <ArrowRight className="h-3 w-3" />
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

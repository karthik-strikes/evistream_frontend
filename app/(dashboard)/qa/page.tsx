'use client';

import { useState, useEffect, useCallback } from 'react';
import { DashboardLayout } from '@/components/layout';
import { useProject } from '@/contexts/ProjectContext';
import { useToast } from '@/hooks/use-toast';
import { qaService, formsService } from '@/services';
import type { Form, QAReview, QADashboard as QADashboardType } from '@/types/api';
import {
  ShieldCheck, Loader2, AlertTriangle, CheckCircle2, Flag, BarChart3, ArrowLeft,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type Screen = 'queue' | 'review' | 'dashboard';

export default function QAPage() {
  const { selectedProject } = useProject();
  const { toast } = useToast();
  const [screen, setScreen] = useState<Screen>('queue');
  const [forms, setForms] = useState<Form[]>([]);
  const [selectedFormId, setSelectedFormId] = useState<string>('');
  const [queue, setQueue] = useState<QAReview[]>([]);
  const [dashboard, setDashboard] = useState<QADashboardType | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeReview, setActiveReview] = useState<QAReview | null>(null);
  const [fieldComments, setFieldComments] = useState<Record<string, any>>({});
  const [overallComment, setOverallComment] = useState('');
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    if (!selectedProject?.id || !selectedFormId) return;
    setLoading(true);
    try {
      const [queueData, dashboardData] = await Promise.all([
        qaService.getQueue(selectedProject.id, selectedFormId),
        qaService.getDashboard(selectedProject.id, selectedFormId),
      ]);
      setQueue(queueData);
      setDashboard(dashboardData);
    } catch {
      toast({ title: 'Error', description: 'Failed to load QA data', variant: 'error' });
    } finally {
      setLoading(false);
    }
  }, [selectedProject?.id, selectedFormId, toast]);

  useEffect(() => {
    if (selectedProject?.id) {
      formsService.getAll(selectedProject.id).then(f => {
        setForms(f);
        if (f.length > 0 && !selectedFormId) setSelectedFormId(f[0].id);
      });
    }
  }, [selectedProject?.id]);

  useEffect(() => {
    if (selectedFormId) loadData();
  }, [selectedFormId, loadData]);

  const generateSample = async () => {
    if (!selectedProject?.id || !selectedFormId) return;
    try {
      const result = await qaService.generateSample({
        project_id: selectedProject.id,
        form_id: selectedFormId,
        sample_percentage: 20,
      });
      toast({ title: 'Sampled', description: `${result.sampled} documents added to QA queue` });
      loadData();
    } catch {
      toast({ title: 'Error', description: 'Failed to generate sample', variant: 'error' });
    }
  };

  const openReview = (review: QAReview) => {
    setActiveReview(review);
    setFieldComments(review.field_comments || {});
    setOverallComment(review.overall_comment || '');
    setScreen('review');
  };

  const saveReview = async (passOrFlag: 'passed' | 'flagged') => {
    if (!selectedProject?.id || !activeReview) return;
    setSaving(true);
    try {
      await qaService.save({
        project_id: selectedProject.id,
        form_id: selectedFormId,
        document_id: activeReview.document_id,
        source_adjudication_id: activeReview.source_adjudication_id || undefined,
        status: passOrFlag,
        field_comments: passOrFlag === 'flagged' ? fieldComments : {},
        overall_comment: overallComment || undefined,
      });
      toast({ title: 'Saved', description: `QA review ${passOrFlag}` });
      setScreen('queue');
      loadData();
    } catch {
      toast({ title: 'Error', description: 'Failed to save review', variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const statusBadge = (s: string) => {
    const colors: Record<string, string> = {
      pending: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
      in_progress: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
      passed: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
      flagged: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    };
    return <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', colors[s] || '')}>{s}</span>;
  };

  return (
    <DashboardLayout>
      <div className="p-6 max-w-7xl mx-auto">
        {screen === 'queue' ? (
          <>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="text-2xl font-bold dark:text-white">QA Review</h1>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Quality assurance spot-checks</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setScreen('dashboard')}
                  className="px-4 py-2 border border-gray-300 dark:border-[#333] rounded-lg text-sm font-medium dark:text-white hover:bg-gray-50 dark:hover:bg-[#1a1a1a] transition-colors"
                >
                  <BarChart3 className="h-4 w-4 inline mr-1" /> Dashboard
                </button>
                <button
                  onClick={generateSample}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                >
                  Generate Sample
                </button>
              </div>
            </div>

            <div className="mb-6">
              <select
                value={selectedFormId}
                onChange={e => setSelectedFormId(e.target.value)}
                className="px-3 py-2 border border-gray-300 dark:border-[#333] rounded-lg bg-white dark:bg-[#141414] text-sm dark:text-white"
              >
                {forms.filter(f => f.status === 'active').map(f => (
                  <option key={f.id} value={f.id}>{f.form_name}</option>
                ))}
              </select>
            </div>

            {loading ? (
              <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-gray-400" /></div>
            ) : queue.length === 0 ? (
              <div className="text-center py-16 text-gray-500">
                <ShieldCheck className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No QA reviews in queue. Generate a sample to begin.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {queue.map(r => (
                  <div key={r.id} className="flex items-center justify-between p-4 bg-white dark:bg-[#141414] border border-gray-200 dark:border-[#2a2a2a] rounded-lg">
                    <div>
                      <p className="font-medium text-sm dark:text-white">{r.document_filename || r.document_id.slice(0, 12)}</p>
                      <p className="text-xs text-gray-500">{r.flagged_field_count} flags / {r.total_fields_reviewed} reviewed</p>
                    </div>
                    <div className="flex items-center gap-3">
                      {statusBadge(r.status)}
                      <button
                        onClick={() => openReview(r)}
                        className="px-3 py-1.5 bg-blue-600 text-white rounded-md text-xs font-medium hover:bg-blue-700"
                      >
                        Review
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : screen === 'dashboard' ? (
          <>
            <div className="flex items-center gap-4 mb-6">
              <button onClick={() => setScreen('queue')} className="p-2 hover:bg-gray-100 dark:hover:bg-[#1a1a1a] rounded-lg">
                <ArrowLeft className="h-5 w-5 dark:text-white" />
              </button>
              <h1 className="text-2xl font-bold dark:text-white">QA Dashboard</h1>
            </div>

            {dashboard && (
              <div className="space-y-6">
                <div className="grid grid-cols-4 gap-4">
                  {[
                    { label: 'Total', value: dashboard.total_reviews },
                    { label: 'Passed', value: dashboard.passed, color: 'text-green-600' },
                    { label: 'Flagged', value: dashboard.flagged, color: 'text-red-600' },
                    { label: 'Pass Rate', value: `${dashboard.pass_rate}%`, color: 'text-blue-600' },
                  ].map(s => (
                    <div key={s.label} className="p-4 bg-white dark:bg-[#141414] border border-gray-200 dark:border-[#2a2a2a] rounded-lg">
                      <p className="text-xs text-gray-500">{s.label}</p>
                      <p className={cn('text-2xl font-bold', s.color || 'dark:text-white')}>{s.value}</p>
                    </div>
                  ))}
                </div>

                {Object.keys(dashboard.field_error_rates).length > 0 && (
                  <div className="bg-white dark:bg-[#141414] border border-gray-200 dark:border-[#2a2a2a] rounded-lg p-4">
                    <h3 className="text-sm font-medium dark:text-white mb-3">Error Rates by Field</h3>
                    <div className="space-y-2">
                      {Object.entries(dashboard.field_error_rates).map(([field, count]) => (
                        <div key={field} className="flex items-center justify-between text-sm">
                          <span className="dark:text-gray-300">{field}</span>
                          <span className="text-red-600 font-medium">{count} errors</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        ) : activeReview ? (
          <>
            <div className="flex items-center gap-4 mb-6">
              <button onClick={() => setScreen('queue')} className="p-2 hover:bg-gray-100 dark:hover:bg-[#1a1a1a] rounded-lg">
                <ArrowLeft className="h-5 w-5 dark:text-white" />
              </button>
              <h1 className="text-xl font-bold dark:text-white">QA Review</h1>
              <div className="ml-auto flex gap-2">
                <button
                  onClick={() => saveReview('passed')}
                  disabled={saving}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50"
                >
                  <CheckCircle2 className="h-4 w-4 inline mr-1" /> Pass
                </button>
                <button
                  onClick={() => saveReview('flagged')}
                  disabled={saving}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50"
                >
                  <Flag className="h-4 w-4 inline mr-1" /> Flag Issues
                </button>
              </div>
            </div>

            <div className="mb-4">
              <textarea
                value={overallComment}
                onChange={e => setOverallComment(e.target.value)}
                placeholder="Overall comment..."
                className="w-full px-3 py-2 border border-gray-300 dark:border-[#333] rounded-lg text-sm bg-white dark:bg-[#0a0a0a] dark:text-white"
                rows={2}
              />
            </div>

            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              Click &quot;Add Flag&quot; on any field to report an issue.
            </p>
          </>
        ) : null}
      </div>
    </DashboardLayout>
  );
}

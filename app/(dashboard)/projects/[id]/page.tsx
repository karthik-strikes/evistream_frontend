'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { DashboardLayout } from '@/components/layout';
import { useProject } from '@/contexts/ProjectContext';
import { formsService, documentsService, extractionsService } from '@/services';
import { useToast } from '@/hooks/use-toast';
import { cn, formatDate } from '@/lib/utils';
import {
  ArrowLeft,
  FileText,
  FileCheck,
  Play,
  Trash2,
  Edit2,
  Loader2,
  Calendar,
} from 'lucide-react';

const statusDotColor: Record<string, string> = {
  Active:     'bg-green-500',
  Completed:  'bg-green-500',
  Generating: 'bg-blue-500',
  Processing: 'bg-blue-500',
  Review:     'bg-amber-500',
  Pending:    'bg-amber-400',
  Draft:      'bg-gray-300 dark:bg-zinc-600',
  Failed:     'bg-purple-500',
};

const statusChipClass: Record<string, string> = {
  Active:     'text-green-700 dark:text-zinc-400 bg-green-50 dark:bg-[#1a1a1a] border-green-200 dark:border-[#2a2a2a]',
  Completed:  'text-green-700 dark:text-zinc-400 bg-green-50 dark:bg-[#1a1a1a] border-green-200 dark:border-[#2a2a2a]',
  Generating: 'text-blue-700 dark:text-zinc-400 bg-blue-50 dark:bg-[#1a1a1a] border-blue-200 dark:border-[#2a2a2a]',
  Processing: 'text-blue-700 dark:text-zinc-400 bg-blue-50 dark:bg-[#1a1a1a] border-blue-200 dark:border-[#2a2a2a]',
  Review:     'text-amber-700 dark:text-zinc-400 bg-amber-50 dark:bg-[#1a1a1a] border-amber-200 dark:border-[#2a2a2a]',
  Pending:    'text-amber-700 dark:text-zinc-400 bg-amber-50 dark:bg-[#1a1a1a] border-amber-200 dark:border-[#2a2a2a]',
  Draft:      'text-gray-500 dark:text-zinc-400 bg-gray-100 dark:bg-[#1a1a1a] border-gray-200 dark:border-[#2a2a2a]',
  Failed:     'text-purple-700 dark:text-zinc-400 bg-purple-50 dark:bg-[#1a1a1a] border-purple-200 dark:border-[#2a2a2a]',
};

const fmtStatus = (s: string) => {
  const map: Record<string, string> = {
    active: 'Active',
    generating: 'Generating',
    awaiting_review: 'Review',
    regenerating: 'Generating',
    draft: 'Draft',
    failed: 'Failed',
    completed: 'Completed',
    processing: 'Processing',
    pending: 'Pending',
  };
  return map[s] || s;
};

type Tab = 'forms' | 'documents' | 'extractions';

export default function ProjectDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const { toast } = useToast();
  const { projects, selectedProject, setSelectedProject, updateProject, deleteProject } = useProject();

  const proj = projects.find((p: any) => p.id === params.id) || null;

  const [forms, setForms] = useState<any[]>([]);
  const [documents, setDocuments] = useState<any[]>([]);
  const [extractions, setExtractions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [activeTab, setActiveTab] = useState<Tab>('forms');

  const [showEdit, setShowEdit] = useState(false);
  const [editData, setEditData] = useState({ name: '', description: '' });
  const [submitting, setSubmitting] = useState(false);

  const isActive = proj?.id === selectedProject?.id;

  useEffect(() => {
    if (!params.id) return;
    const fetchAll = async () => {
      setLoading(true);
      try {
        const [f, d, e] = await Promise.all([
          formsService.getAll(params.id),
          documentsService.getAll(params.id),
          extractionsService.getAll(params.id),
        ]);
        setForms(f);
        setDocuments(d);
        setExtractions(e);
      } catch {
        setForms([]);
        setDocuments([]);
        setExtractions([]);
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
  }, [params.id]);

  const handleSetActive = () => {
    if (proj) {
      setSelectedProject(proj);
      toast({ title: 'Project set as active', variant: 'success' });
    }
  };

  const handleOpenEdit = () => {
    if (!proj) return;
    setEditData({ name: proj.name, description: proj.description || '' });
    setShowEdit(true);
  };

  const handleSaveEdit = async () => {
    if (!proj || !editData.name.trim()) return;
    setSubmitting(true);
    try {
      await updateProject(proj.id, { name: editData.name, description: editData.description || undefined });
      setShowEdit(false);
      toast({ title: 'Project updated', variant: 'success' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!proj) return;
    if (!confirm(`Delete "${proj.name}"? This action cannot be undone.`)) return;
    setSubmitting(true);
    try {
      await deleteProject(proj.id);
      toast({ title: 'Project deleted', variant: 'success' });
      router.back();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  if (!proj) {
    return (
      <DashboardLayout>
        <div className="min-h-full pb-16 dashboard-dot-bg">
          <div className="flex items-center gap-3 mb-8">
            <button
              onClick={() => router.back()}
              className="flex items-center justify-center w-8 h-8 rounded-lg border border-gray-200 dark:border-[#1f1f1f] bg-white dark:bg-[#111111] text-gray-500 dark:text-zinc-400 cursor-pointer hover:bg-gray-50 dark:hover:bg-[#1a1a1a] transition-colors"
            >
              <ArrowLeft size={15} />
            </button>
            <span className="text-sm text-gray-400">Back to Projects</span>
          </div>
          <div className="text-center py-20">
            <div className="text-sm text-gray-400">Project not found</div>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'forms', label: 'Forms', count: forms.length },
    { key: 'documents', label: 'Documents', count: documents.length },
    { key: 'extractions', label: 'Extractions', count: extractions.length },
  ];

  return (
    <DashboardLayout>
      <div className="min-h-full pb-16 dashboard-dot-bg">

        {/* Header */}
        <div className="mb-8 animate-dashboard-slideUp">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-4">
              <button
                onClick={() => router.back()}
                className="mt-1 flex items-center justify-center w-8 h-8 rounded-lg border border-gray-200 dark:border-[#1f1f1f] bg-white dark:bg-[#111111] text-gray-500 dark:text-zinc-400 cursor-pointer hover:bg-gray-50 dark:hover:bg-[#1a1a1a] transition-colors shrink-0"
              >
                <ArrowLeft size={15} />
              </button>
              <div>
                <div className="flex items-center gap-2.5 mb-1">
                  <h1 className="text-2xl font-semibold text-gray-900 dark:text-white tracking-tight m-0">
                    {proj.name}
                  </h1>
                  {isActive && (
                    <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-400/15 px-2 py-0.5 rounded-full">
                      Active
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-400 dark:text-zinc-500 m-0">
                  {proj.description || 'No description'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0 mt-1">
              {!isActive && (
                <button
                  onClick={handleSetActive}
                  disabled={submitting}
                  className="font-inherit text-sm font-semibold text-white dark:text-gray-900 bg-gray-900 dark:bg-zinc-100 border-none rounded-lg px-4 py-2 cursor-pointer hover:opacity-90 transition-opacity disabled:opacity-40"
                >
                  Set Active
                </button>
              )}
              <button
                onClick={handleOpenEdit}
                disabled={submitting}
                className="flex items-center justify-center w-8 h-8 rounded-lg border border-gray-200 dark:border-[#1f1f1f] bg-white dark:bg-[#111111] text-gray-500 dark:text-zinc-400 cursor-pointer hover:bg-gray-50 dark:hover:bg-[#1a1a1a] transition-colors disabled:opacity-40"
                title="Edit project"
              >
                <Edit2 size={14} />
              </button>
              <button
                onClick={handleDelete}
                disabled={submitting}
                className="flex items-center justify-center w-8 h-8 rounded-lg border border-red-200 dark:border-red-900/40 bg-white dark:bg-[#111111] text-red-500 cursor-pointer hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors disabled:opacity-40"
                title="Delete project"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-4 gap-4 mb-8 animate-dashboard-slideUp">
          {[
            { label: 'Forms', value: loading ? '—' : forms.length, icon: <FileText size={16} className="text-gray-400 dark:text-zinc-500" /> },
            { label: 'Documents', value: loading ? '—' : documents.length, icon: <FileCheck size={16} className="text-gray-400 dark:text-zinc-500" /> },
            { label: 'Extractions', value: loading ? '—' : extractions.length, icon: <Play size={16} className="text-gray-400 dark:text-zinc-500" /> },
            {
              label: 'Created',
              value: proj.created_at ? formatDate(proj.created_at) : '—',
              icon: <Calendar size={16} className="text-gray-400 dark:text-zinc-500" />,
              small: true,
            },
          ].map((stat) => (
            <div
              key={stat.label}
              className="rounded-xl border border-gray-200 dark:border-[#1f1f1f] bg-white dark:bg-[#111111] p-5"
            >
              <div className="flex items-center justify-between mb-2">
                <span className={cn(
                  "font-semibold text-gray-900 dark:text-white",
                  stat.small ? "text-base" : "text-2xl"
                )}>
                  {stat.value}
                </span>
                {stat.icon}
              </div>
              <div className="text-[11px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wider">
                {stat.label}
              </div>
            </div>
          ))}
        </div>

        {/* Tabs + Content */}
        <div className="rounded-xl border border-gray-200 dark:border-[#1f1f1f] bg-white dark:bg-[#111111] animate-dashboard-slideUp">
          {/* Tab bar */}
          <div className="flex border-b border-gray-100 dark:border-[#1f1f1f] px-6">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  "font-inherit text-sm font-medium border-none bg-transparent py-3.5 px-4 cursor-pointer -mb-px transition-all duration-150",
                  activeTab === tab.key
                    ? "text-gray-900 dark:text-white border-b-2 border-gray-900 dark:border-white"
                    : "text-gray-400 dark:text-zinc-500 border-b-2 border-transparent hover:text-gray-600 dark:hover:text-zinc-300"
                )}
              >
                {tab.label}
                <span className={cn(
                  "ml-1.5 text-[11px] font-semibold px-1.5 py-0.5 rounded-full",
                  activeTab === tab.key
                    ? "bg-gray-100 dark:bg-[#1f1f1f] text-gray-600 dark:text-zinc-300"
                    : "bg-gray-50 dark:bg-[#1a1a1a] text-gray-400 dark:text-zinc-600"
                )}>
                  {tab.count}
                </span>
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="px-6 py-4">
            {loading ? (
              <div className="flex items-center justify-center py-12 text-gray-400 dark:text-zinc-500 gap-2">
                <Loader2 size={16} className="animate-spin" />
                <span className="text-sm">Loading...</span>
              </div>
            ) : (
              <>
                {/* Forms tab */}
                {activeTab === 'forms' && (
                  <>
                    {forms.length === 0 ? (
                      <div className="text-center py-12">
                        <div className="w-10 h-10 rounded-lg bg-gray-100 dark:bg-[#1a1a1a] flex items-center justify-center mx-auto mb-3">
                          <FileText size={18} className="text-gray-300 dark:text-zinc-600" />
                        </div>
                        <div className="text-sm font-medium text-gray-500 dark:text-zinc-400 mb-1">No forms yet</div>
                        <div className="text-xs text-gray-400 dark:text-zinc-600">Create a form to start extracting data</div>
                      </div>
                    ) : (
                      <div>
                        {forms.map((f: any, i: number) => {
                          const s = fmtStatus(f.status || 'active');
                          return (
                            <div
                              key={f.id}
                              className={cn(
                                "flex items-center justify-between py-3",
                                i < forms.length - 1 && "border-b border-gray-100 dark:border-[#1f1f1f]"
                              )}
                            >
                              <span className="text-sm font-medium text-gray-700 dark:text-[#c0c0c0] truncate pr-4">
                                {f.form_name}
                              </span>
                              <span className={cn(
                                "flex items-center gap-1.5 text-xs font-medium border rounded-[5px] px-2 py-0.5 whitespace-nowrap shrink-0",
                                statusChipClass[s] || 'text-gray-500 dark:text-zinc-400 bg-gray-100 dark:bg-[#1a1a1a] border-gray-200 dark:border-[#2a2a2a]'
                              )}>
                                <span className={cn("w-[5px] h-[5px] rounded-full shrink-0", statusDotColor[s] || 'bg-gray-300 dark:bg-zinc-600')} />
                                {s}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}

                {/* Documents tab */}
                {activeTab === 'documents' && (
                  <>
                    {documents.length === 0 ? (
                      <div className="text-center py-12">
                        <div className="w-10 h-10 rounded-lg bg-gray-100 dark:bg-[#1a1a1a] flex items-center justify-center mx-auto mb-3">
                          <FileCheck size={18} className="text-gray-300 dark:text-zinc-600" />
                        </div>
                        <div className="text-sm font-medium text-gray-500 dark:text-zinc-400 mb-1">No documents yet</div>
                        <div className="text-xs text-gray-400 dark:text-zinc-600">Upload documents to this project</div>
                      </div>
                    ) : (
                      <div>
                        {documents.map((d: any, i: number) => {
                          const rawStatus = d.processing_status || 'pending';
                          const s = fmtStatus(rawStatus);
                          const fileSize = d.file_size ? `${Math.round(d.file_size / 1024)} KB` : null;
                          return (
                            <div
                              key={d.id}
                              className={cn(
                                "flex items-center justify-between py-3",
                                i < documents.length - 1 && "border-b border-gray-100 dark:border-[#1f1f1f]"
                              )}
                            >
                              <div className="flex items-center gap-3 min-w-0 pr-4">
                                <span className="text-sm font-medium text-gray-700 dark:text-[#c0c0c0] truncate">
                                  {d.filename}
                                </span>
                                {fileSize && (
                                  <span className="text-xs text-gray-400 dark:text-zinc-600 shrink-0">{fileSize}</span>
                                )}
                              </div>
                              <span className={cn(
                                "flex items-center gap-1.5 text-xs font-medium border rounded-[5px] px-2 py-0.5 whitespace-nowrap shrink-0",
                                statusChipClass[s] || 'text-gray-500 dark:text-zinc-400 bg-gray-100 dark:bg-[#1a1a1a] border-gray-200 dark:border-[#2a2a2a]'
                              )}>
                                <span className={cn("w-[5px] h-[5px] rounded-full shrink-0", statusDotColor[s] || 'bg-gray-300 dark:bg-zinc-600')} />
                                {s}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}

                {/* Extractions tab */}
                {activeTab === 'extractions' && (
                  <>
                    {extractions.length === 0 ? (
                      <div className="text-center py-12">
                        <div className="w-10 h-10 rounded-lg bg-gray-100 dark:bg-[#1a1a1a] flex items-center justify-center mx-auto mb-3">
                          <Play size={18} className="text-gray-300 dark:text-zinc-600" />
                        </div>
                        <div className="text-sm font-medium text-gray-500 dark:text-zinc-400 mb-1">No extractions yet</div>
                        <div className="text-xs text-gray-400 dark:text-zinc-600">Run an extraction to see results here</div>
                      </div>
                    ) : (
                      <div>
                        {extractions.map((e: any, i: number) => {
                          const rawStatus = e.status || 'pending';
                          const s = fmtStatus(rawStatus);
                          const createdAt = e.created_at ? formatDate(e.created_at) : null;
                          return (
                            <div
                              key={e.id}
                              className={cn(
                                "flex items-center justify-between py-3",
                                i < extractions.length - 1 && "border-b border-gray-100 dark:border-[#1f1f1f]"
                              )}
                            >
                              <div className="flex items-center gap-3 min-w-0 pr-4">
                                <span className="text-sm font-medium text-gray-700 dark:text-[#c0c0c0] truncate">
                                  {e.form_name || e.name || `Extraction ${i + 1}`}
                                </span>
                                {createdAt && (
                                  <span className="text-xs text-gray-400 dark:text-zinc-600 shrink-0">{createdAt}</span>
                                )}
                              </div>
                              <span className={cn(
                                "flex items-center gap-1.5 text-xs font-medium border rounded-[5px] px-2 py-0.5 whitespace-nowrap shrink-0",
                                statusChipClass[s] || 'text-gray-500 dark:text-zinc-400 bg-gray-100 dark:bg-[#1a1a1a] border-gray-200 dark:border-[#2a2a2a]'
                              )}>
                                <span className={cn("w-[5px] h-[5px] rounded-full shrink-0", statusDotColor[s] || 'bg-gray-300 dark:bg-zinc-600')} />
                                {s}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Edit modal */}
      {showEdit && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.60)' }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowEdit(false); }}
        >
          <div className="w-full max-w-md mx-4 rounded-xl border border-gray-200 dark:border-[#1f1f1f] bg-white dark:bg-[#111111] shadow-2xl animate-dashboard-scaleIn">
            <div className="px-6 pt-6 pb-5">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-4">Edit Project</h2>
              <div className="flex flex-col gap-3">
                <div>
                  <label className="text-[11px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wider block mb-1.5">
                    Name
                  </label>
                  <input
                    autoFocus
                    type="text"
                    value={editData.name}
                    onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSaveEdit(); if (e.key === 'Escape') setShowEdit(false); }}
                    className="font-inherit w-full text-sm text-gray-900 dark:text-white py-2.5 px-3 rounded-lg border border-[#2a2a2a] outline-none bg-gray-50 dark:bg-[#1a1a1a] focus:border-gray-400 dark:focus:border-[#3f3f3f] transition-colors"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wider block mb-1.5">
                    Description
                  </label>
                  <input
                    type="text"
                    value={editData.description}
                    onChange={(e) => setEditData({ ...editData, description: e.target.value })}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSaveEdit(); if (e.key === 'Escape') setShowEdit(false); }}
                    placeholder="Optional description"
                    className="font-inherit w-full text-sm text-gray-900 dark:text-white py-2.5 px-3 rounded-lg border border-[#2a2a2a] outline-none bg-gray-50 dark:bg-[#1a1a1a] focus:border-gray-400 dark:focus:border-[#3f3f3f] transition-colors"
                  />
                </div>
              </div>
            </div>
            <div className="flex gap-2 px-6 pb-5">
              <button
                onClick={handleSaveEdit}
                disabled={submitting || !editData.name.trim()}
                className={cn(
                  "font-inherit text-sm font-semibold text-white dark:text-gray-900 bg-gray-900 dark:bg-zinc-100 border-none rounded-lg py-2.5 px-5 cursor-pointer transition-opacity flex-1",
                  (submitting || !editData.name.trim()) && "opacity-40 cursor-not-allowed"
                )}
              >
                {submitting ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={() => setShowEdit(false)}
                disabled={submitting}
                className="font-inherit text-sm font-medium text-gray-500 dark:text-zinc-400 bg-transparent border border-gray-200 dark:border-[#1f1f1f] rounded-lg py-2.5 px-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-[#1a1a1a] transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}

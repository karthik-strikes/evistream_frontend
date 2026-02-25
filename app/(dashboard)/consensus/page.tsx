'use client';

import { useState, useEffect } from 'react';
import { DashboardLayout } from '@/components/layout';
import { useProject } from '@/contexts/ProjectContext';
import { documentsService, formsService, extractionsService, resultsService } from '@/services';
import { useToast } from '@/hooks/use-toast';
import { cn, formatDate } from '@/lib/utils';
import {
  Check, X, FileText, CheckCircle, ArrowLeft,
  GripVertical, Loader2, Play,
} from 'lucide-react';
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels';

type ConsensusStatus = 'correct' | 'incorrect' | null;

interface FieldConsensus {
  fieldName: string;
  aiValue: string;
  status: ConsensusStatus;
  correction: string;
}

export default function ConsensusPage() {
  const { selectedProject } = useProject();
  const { toast } = useToast();

  // Mode: 'select' | 'review' | 'summary'
  const [mode, setMode] = useState<'select' | 'review' | 'summary'>('select');

  // Selection state
  const [formSearch, setFormSearch] = useState('');
  const [docSearch, setDocSearch] = useState('');
  const [forms, setForms] = useState<any[]>([]);
  const [documents, setDocuments] = useState<any[]>([]);
  const [docResultsMap, setDocResultsMap] = useState<Record<string, any[]>>({});
  const [selectedForm, setSelectedForm] = useState<any>(null);
  const [selectedDoc, setSelectedDoc] = useState<any>(null);
  const [loadingForms, setLoadingForms] = useState(false);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [starting, setStarting] = useState(false);

  // Review state
  const [pdfUrl, setPdfUrl] = useState('');
  const [fields, setFields] = useState<FieldConsensus[]>([]);
  const [activeField, setActiveField] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (selectedProject) fetchForms();
  }, [selectedProject]);

  useEffect(() => {
    return () => { if (pdfUrl.startsWith('blob:')) URL.revokeObjectURL(pdfUrl); };
  }, [pdfUrl]);

  const fetchForms = async () => {
    if (!selectedProject) return;
    setLoadingForms(true);
    try {
      const data = await formsService.getAll(selectedProject.id);
      setForms(data.filter((f: any) => f.status === 'active'));
    } catch { /* ignore */ } finally {
      setLoadingForms(false);
    }
  };

  const handleFormSelect = async (form: any) => {
    if (selectedForm?.id === form.id) return;
    setSelectedForm(form);
    setSelectedDoc(null);
    setDocuments([]);
    setDocResultsMap({});
    setLoadingDocs(true);
    try {
      const allExtractions = await extractionsService.getAll(selectedProject!.id);
      const formExtractions = allExtractions.filter(
        (e: any) => e.form_id === form.id && e.status === 'completed'
      );
      const resultsMap: Record<string, any[]> = {};
      for (const ext of formExtractions) {
        try {
          const results = await resultsService.getAll({ extractionId: ext.id });
          for (const r of results) {
            if (r.document_id) {
              if (!resultsMap[r.document_id]) resultsMap[r.document_id] = [];
              resultsMap[r.document_id].push(r);
            }
          }
        } catch { /* skip */ }
      }
      const allDocs = await documentsService.getAll(selectedProject!.id);
      setDocResultsMap(resultsMap);
      setDocuments(allDocs.filter((d: any) => resultsMap[d.id]));
    } catch { /* ignore */ } finally {
      setLoadingDocs(false);
    }
  };

  const handleStart = async () => {
    if (!selectedForm || !selectedDoc) return;
    setStarting(true);
    try {
      const blob = await documentsService.downloadPDF(selectedDoc.id);
      if (pdfUrl.startsWith('blob:')) URL.revokeObjectURL(pdfUrl);
      setPdfUrl(URL.createObjectURL(blob));
    } catch { /* ignore */ }

    const results = docResultsMap[selectedDoc.id] || [];
    const built: FieldConsensus[] = [];
    for (const r of results) {
      if (r.extracted_data && typeof r.extracted_data === 'object') {
        for (const [key, val] of Object.entries(r.extracted_data)) {
          if (key.endsWith('.value')) {
            built.push({ fieldName: key.replace('.value', ''), aiValue: val != null ? String(val) : '', status: null, correction: '' });
          }
        }
      } else {
        built.push({ fieldName: r.field_name || r.field || 'field', aiValue: r.extracted_value ?? r.value ?? r.result ?? '', status: null, correction: '' });
      }
    }
    setFields(built);
    setActiveField(null);
    setStarting(false);
    setMode('review');
  };

  const handleReset = () => {
    if (pdfUrl.startsWith('blob:')) URL.revokeObjectURL(pdfUrl);
    setPdfUrl('');
    setSelectedForm(null);
    setSelectedDoc(null);
    setDocuments([]);
    setDocResultsMap({});
    setFields([]);
    setActiveField(null);
    setFormSearch('');
    setDocSearch('');
    setMode('select');
  };

  const setStatus = (idx: number, status: ConsensusStatus) => {
    setFields(prev => prev.map((f, i) => i === idx
      ? { ...f, status, correction: status === 'correct' ? '' : f.correction }
      : f
    ));
    if (status === 'correct') {
      const next = fields.findIndex((f, i) => i > idx && f.status === null);
      setActiveField(next >= 0 ? next : idx);
    } else {
      setActiveField(idx);
    }
  };

  const setCorrection = (idx: number, val: string) => {
    setFields(prev => prev.map((f, i) => i === idx ? { ...f, correction: val } : f));
  };

  const handleSubmit = async () => {
    const unreviewed = fields.filter(f => f.status === null).length;
    if (unreviewed > 0) {
      toast({ title: `${unreviewed} field${unreviewed > 1 ? 's' : ''} not yet reviewed`, variant: 'error' });
      return;
    }
    setSubmitting(true);
    await new Promise(r => setTimeout(r, 600));
    setSubmitting(false);
    setMode('summary');
  };

  const matchCount = fields.filter(f => f.status === 'correct').length;
  const mismatchCount = fields.filter(f => f.status === 'incorrect').length;
  const matchPct = fields.length > 0 ? Math.round((matchCount / fields.length) * 100) : 0;
  const reviewedCount = fields.filter(f => f.status !== null).length;

  const filteredForms = forms.filter(f => f.form_name?.toLowerCase().includes(formSearch.toLowerCase()));
  const filteredDocs = documents.filter(d => d.filename?.toLowerCase().includes(docSearch.toLowerCase()));

  if (!selectedProject) {
    return (
      <DashboardLayout title="Consensus" description="Review AI extractions field by field">
        <div className="flex items-center justify-center h-48 text-sm text-gray-400">Select a project to get started</div>
      </DashboardLayout>
    );
  }

  // ── Summary ───────────────────────────────────────────────────────
  if (mode === 'summary') {
    return (
      <DashboardLayout title="Consensus" description="Review AI extractions field by field">
        <div className="max-w-2xl mx-auto pt-6">
          <div className="rounded-2xl border border-gray-200 dark:border-[#1f1f1f] bg-white dark:bg-[#111111] p-8 mb-6 text-center">
            <div
              className="w-20 h-20 rounded-full mx-auto mb-4 flex items-center justify-center text-3xl font-bold"
              style={{
                background: matchPct >= 80 ? '#f0fdf4' : matchPct >= 50 ? '#fffbeb' : '#fef2f2',
                color: matchPct >= 80 ? '#16a34a' : matchPct >= 50 ? '#d97706' : '#dc2626',
              }}
            >
              {matchPct}%
            </div>
            <div className="text-lg font-semibold text-gray-900 dark:text-white mb-1">Consensus Complete</div>
            <div className="text-sm text-gray-400">{selectedDoc?.filename} · {selectedForm?.form_name}</div>
            <div className="flex items-center justify-center gap-6 mt-6">
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">{matchCount}</div>
                <div className="text-xs text-gray-400 mt-0.5">Correct</div>
              </div>
              <div className="w-px h-8 bg-gray-200 dark:bg-[#1f1f1f]" />
              <div className="text-center">
                <div className="text-2xl font-bold text-red-500">{mismatchCount}</div>
                <div className="text-xs text-gray-400 mt-0.5">Incorrect</div>
              </div>
              <div className="w-px h-8 bg-gray-200 dark:bg-[#1f1f1f]" />
              <div className="text-center">
                <div className="text-2xl font-bold text-gray-700 dark:text-white">{fields.length}</div>
                <div className="text-xs text-gray-400 mt-0.5">Total fields</div>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 dark:border-[#1f1f1f] bg-white dark:bg-[#111111] overflow-hidden mb-4">
            <div className="px-5 py-3.5 border-b border-gray-100 dark:border-[#1f1f1f]">
              <span className="text-sm font-semibold text-gray-900 dark:text-white">Field Breakdown</span>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-[#1f1f1f]">
              {fields.map((f, i) => (
                <div key={i} className="flex items-start gap-3 px-5 py-3">
                  <div className={cn("mt-0.5 w-5 h-5 rounded-full flex items-center justify-center shrink-0", f.status === 'correct' ? 'bg-green-100' : 'bg-red-100')}>
                    {f.status === 'correct' ? <Check className="w-3 h-3 text-green-600" /> : <X className="w-3 h-3 text-red-500" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-gray-500 dark:text-zinc-500 uppercase tracking-wide mb-0.5">{f.fieldName.replace(/_/g, ' ')}</div>
                    <div className="text-sm text-gray-700 dark:text-zinc-300">{f.aiValue || <span className="text-gray-300 italic">empty</span>}</div>
                    {f.status === 'incorrect' && f.correction && (
                      <div className="text-sm text-green-700 dark:text-green-400 mt-0.5">
                        <span className="text-xs font-medium text-gray-400 mr-1">Correction:</span>{f.correction}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <button
            onClick={handleReset}
            className="w-full text-sm font-medium text-gray-500 dark:text-zinc-400 border border-gray-200 dark:border-[#1f1f1f] rounded-lg py-2.5 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] transition-colors bg-white dark:bg-[#111111]"
          >
            Start new consensus
          </button>
        </div>
      </DashboardLayout>
    );
  }

  // ── Review ────────────────────────────────────────────────────────
  if (mode === 'review') {
    return (
      <DashboardLayout title="Consensus" description="Review AI extractions field by field">
        <div className="flex items-center gap-2 mb-3">
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200 bg-transparent border-none cursor-pointer transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back
          </button>
          <span className="text-gray-300 dark:text-zinc-700 text-xs">·</span>
          <span className="text-xs font-medium text-gray-500 dark:text-zinc-400 bg-gray-100 dark:bg-[#1a1a1a] px-2 py-0.5 rounded-md">{selectedForm?.form_name}</span>
          <span className="text-gray-300 dark:text-zinc-700 text-xs">·</span>
          <span className="text-xs font-medium text-gray-500 dark:text-zinc-400 bg-gray-100 dark:bg-[#1a1a1a] px-2 py-0.5 rounded-md truncate max-w-[220px]">{selectedDoc?.filename}</span>
        </div>

        <PanelGroup orientation="horizontal" className="gap-0">
          <Panel defaultSize={60} minSize={30}>
            <div className="flex flex-col rounded-xl border border-gray-200 dark:border-[#1f1f1f] overflow-hidden bg-white dark:bg-[#111111]" style={{ height: 'calc(100vh - 120px)' }}>
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 dark:border-[#1f1f1f] shrink-0">
                <div className="flex items-center gap-2">
                  <FileText className="w-3.5 h-3.5 text-gray-400" />
                  <span className="text-xs font-medium text-gray-600 dark:text-zinc-400 truncate max-w-[260px]">{selectedDoc?.filename}</span>
                </div>
                <span className="text-xs text-gray-400">{reviewedCount}/{fields.length} reviewed</span>
              </div>
              <div className="flex-1 relative min-h-0">
                {pdfUrl
                  ? <iframe src={pdfUrl} className="w-full h-full border-0" title="PDF viewer" />
                  : <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-400">No PDF available</div>
                }
              </div>
            </div>
          </Panel>

          <PanelResizeHandle className="w-2 mx-1 flex items-center justify-center group cursor-col-resize">
            <div className="w-1 h-full rounded-full bg-gray-200 dark:bg-[#2a2a2a] group-hover:bg-gray-400 dark:group-hover:bg-zinc-600 transition-colors flex items-center justify-center">
              <GripVertical className="h-4 w-4 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </PanelResizeHandle>

          <Panel defaultSize={40} minSize={25}>
            <div className="flex flex-col rounded-xl border border-gray-200 dark:border-[#1f1f1f] overflow-hidden bg-white dark:bg-[#111111]" style={{ height: 'calc(100vh - 120px)' }}>
              {/* Progress */}
              <div className="px-4 py-2.5 border-b border-gray-100 dark:border-[#1f1f1f] shrink-0">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-semibold text-gray-700 dark:text-zinc-300">Review fields</span>
                  <span className="text-xs text-gray-400">{reviewedCount}/{fields.length}</span>
                </div>
                <div className="h-1 bg-gray-100 dark:bg-[#1a1a1a] rounded-full overflow-hidden flex gap-px">
                  {fields.length > 0 && (
                    <>
                      <div className="h-full bg-gray-800 dark:bg-zinc-300 rounded-full transition-all duration-300" style={{ width: `${(matchCount / fields.length) * 100}%` }} />
                      <div className="h-full bg-gray-300 dark:bg-zinc-600 rounded-full transition-all duration-300" style={{ width: `${(mismatchCount / fields.length) * 100}%` }} />
                    </>
                  )}
                </div>
              </div>

              {/* Fields */}
              <div className="flex-1 overflow-y-auto divide-y divide-gray-100 dark:divide-[#1f1f1f] min-h-0">
                {fields.map((f, i) => (
                  <div
                    key={i}
                    className={cn("px-4 py-3 cursor-pointer transition-colors", activeField === i ? "bg-gray-50 dark:bg-[#1a1a1a]" : "hover:bg-gray-50/60 dark:hover:bg-[rgba(255,255,255,0.02)]")}
                    onClick={() => setActiveField(i)}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-semibold text-gray-500 dark:text-zinc-500 uppercase tracking-wide">{f.fieldName.replace(/_/g, ' ')}</span>
                      <span className="text-[10px] font-medium text-gray-500 dark:text-zinc-500 bg-gray-100 dark:bg-[#1a1a1a] px-1.5 py-0.5 rounded-full">
                        {f.status === 'correct' ? 'Match' : f.status === 'incorrect' ? 'No match' : 'Pending'}
                      </span>
                    </div>
                    <div className="text-sm text-gray-700 dark:text-zinc-300 mb-2 leading-snug">
                      {f.aiValue || <span className="text-gray-300 dark:text-zinc-600 italic text-xs">No value extracted</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); setStatus(i, 'correct'); }}
                        className={cn(
                          "flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-all",
                          f.status === 'correct'
                            ? "bg-gray-900 dark:bg-zinc-100 text-white dark:text-gray-900 border-gray-900 dark:border-zinc-100"
                            : "bg-white dark:bg-[#111111] text-gray-500 dark:text-zinc-400 border-gray-200 dark:border-[#2a2a2a] hover:border-gray-400 dark:hover:border-[#3f3f3f]"
                        )}
                      >
                        <Check className="w-3 h-3" /> Correct
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setStatus(i, 'incorrect'); }}
                        className={cn(
                          "flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-all",
                          f.status === 'incorrect'
                            ? "bg-gray-200 dark:bg-[#2a2a2a] text-gray-700 dark:text-zinc-300 border-gray-300 dark:border-[#3a3a3a]"
                            : "bg-white dark:bg-[#111111] text-gray-500 dark:text-zinc-400 border-gray-200 dark:border-[#2a2a2a] hover:border-gray-400 dark:hover:border-[#3f3f3f]"
                        )}
                      >
                        <X className="w-3 h-3" /> Wrong
                      </button>
                    </div>
                    {f.status === 'incorrect' && (
                      <div className="mt-2">
                        <input
                          type="text"
                          value={f.correction}
                          onChange={(e) => setCorrection(i, e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          placeholder="Add correction (optional)"
                          className="w-full text-sm text-gray-700 dark:text-zinc-300 bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a] rounded-lg px-3 py-1.5 outline-none focus:border-gray-400 dark:focus:border-[#3f3f3f] placeholder:text-gray-300 dark:placeholder:text-zinc-600"
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Submit */}
              <div className="px-4 py-3 border-t border-gray-100 dark:border-[#1f1f1f] bg-gray-50/60 dark:bg-[#0a0a0a] shrink-0">
                <button
                  onClick={handleSubmit}
                  disabled={submitting || reviewedCount < fields.length}
                  className={cn(
                    "w-full text-sm font-semibold rounded-lg py-2.5 transition-colors",
                    reviewedCount === fields.length && !submitting
                      ? "bg-gray-900 dark:bg-zinc-100 text-white dark:text-gray-900 hover:bg-gray-700 dark:hover:bg-white"
                      : "bg-gray-100 dark:bg-[#1a1a1a] text-gray-400 dark:text-zinc-600 cursor-not-allowed"
                  )}
                >
                  {submitting ? 'Saving…' : reviewedCount < fields.length ? `${fields.length - reviewedCount} fields left` : 'Submit consensus'}
                </button>
              </div>
            </div>
          </Panel>
        </PanelGroup>
      </DashboardLayout>
    );
  }

  // ── Selection (full-page two-column) ─────────────────────────────
  return (
    <DashboardLayout title="Consensus" description="Review AI extractions field by field">
      <div className="flex flex-col rounded-xl border border-gray-200 dark:border-[#1f1f1f] overflow-hidden bg-white dark:bg-[#111111]" style={{ height: 'calc(100vh - 120px)' }}>

        {/* Two-column body */}
        <div className="flex flex-1 min-h-0">

          {/* Left — Forms */}
          <div className="w-[42%] flex flex-col border-r border-gray-100 dark:border-[#1f1f1f] min-h-0">
            <div className="px-5 pt-5 pb-3 flex-shrink-0">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[11px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wider">Form</span>
                {selectedForm && (
                  <span className="text-[10px] font-medium text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800/50 px-1.5 py-0.5 rounded-[4px]">Selected</span>
                )}
              </div>
              <div className="relative">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
                  <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
                </svg>
                <input
                  type="text"
                  value={formSearch}
                  onChange={e => setFormSearch(e.target.value)}
                  placeholder="Search forms…"
                  className="w-full text-sm text-gray-900 dark:text-white bg-gray-50 dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a] rounded-lg py-1.5 pl-8 pr-3 outline-none focus:border-gray-400 dark:focus:border-[#3f3f3f] placeholder:text-gray-400 dark:placeholder:text-zinc-600"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-5 pb-5 space-y-1.5">
              {loadingForms ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="w-5 h-5 animate-spin text-gray-300 dark:text-zinc-600" />
                </div>
              ) : forms.length === 0 ? (
                <div className="rounded-lg border border-amber-200 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-900/10 px-3.5 py-3 text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
                  No active forms. Create and activate a form first.
                </div>
              ) : filteredForms.length === 0 ? (
                <p className="text-xs text-gray-400 dark:text-zinc-500 text-center py-4">No forms matching &ldquo;{formSearch}&rdquo;</p>
              ) : filteredForms.map((form: any) => {
                const isSel = selectedForm?.id === form.id;
                return (
                  <button
                    key={form.id}
                    onClick={() => handleFormSelect(form)}
                    className={cn(
                      "w-full text-left px-3.5 py-3 rounded-xl border transition-all duration-150 cursor-pointer group",
                      isSel
                        ? "border-gray-900 dark:border-zinc-500 bg-gray-900 dark:bg-[#1f1f1f]"
                        : "border-gray-100 dark:border-[#1f1f1f] bg-white dark:bg-[#111111] hover:border-gray-300 dark:hover:border-[#2a2a2a] hover:bg-gray-50 dark:hover:bg-[#1a1a1a]"
                    )}
                  >
                    <div className="flex items-start gap-2.5">
                      <div className={cn("w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 transition-colors", isSel ? "bg-white dark:bg-zinc-300" : "bg-gray-300 dark:bg-zinc-600 group-hover:bg-gray-400")} />
                      <div className="flex-1 min-w-0">
                        <p className={cn("text-sm font-semibold truncate leading-snug", isSel ? "text-white" : "text-gray-900 dark:text-white")}>{form.form_name}</p>
                        <p className={cn("text-xs mt-0.5 truncate", isSel ? "text-gray-300 dark:text-zinc-400" : "text-gray-400 dark:text-zinc-500")}>
                          {form.fields?.length ?? 0} fields{form.form_description ? ` · ${form.form_description}` : ''}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right — Documents */}
          <div className="flex-1 flex flex-col bg-gray-50/60 dark:bg-[#0a0a0a] min-h-0">
            <div className="px-5 pt-5 pb-3 flex-shrink-0">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[11px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wider">
                  Document
                  {selectedForm && !loadingDocs && (
                    <span className="ml-1.5 text-gray-300 dark:text-zinc-700 normal-case font-normal tracking-normal">({filteredDocs.length})</span>
                  )}
                </span>
                {selectedDoc && (
                  <span className="text-[10px] font-medium text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800/50 px-1.5 py-0.5 rounded-[4px]">Selected</span>
                )}
              </div>
              {selectedForm && (
                <div className="relative">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
                    <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
                  </svg>
                  <input
                    type="text"
                    value={docSearch}
                    onChange={e => setDocSearch(e.target.value)}
                    placeholder="Search documents…"
                    className="w-full text-sm text-gray-900 dark:text-white bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a] rounded-lg py-1.5 pl-8 pr-3 outline-none focus:border-gray-400 dark:focus:border-[#3f3f3f] placeholder:text-gray-400 dark:placeholder:text-zinc-600"
                  />
                </div>
              )}
            </div>
            <div className="flex-1 overflow-y-auto px-5 pb-5 min-h-0">
              {!selectedForm ? (
                <div className="flex flex-col items-center justify-center h-full gap-3 pb-10">
                  <div className="w-12 h-12 rounded-xl bg-gray-100 dark:bg-[#1a1a1a] flex items-center justify-center">
                    <FileText className="w-5 h-5 text-gray-300 dark:text-zinc-600" />
                  </div>
                  <p className="text-sm text-gray-400 dark:text-zinc-600 text-center">Select a form to see<br />available documents</p>
                </div>
              ) : loadingDocs ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="w-5 h-5 animate-spin text-gray-300 dark:text-zinc-600" />
                </div>
              ) : documents.length === 0 ? (
                <div className="rounded-lg border border-amber-200 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-900/10 px-3.5 py-3 text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
                  No documents with completed extractions for this form.
                </div>
              ) : filteredDocs.length === 0 ? (
                <p className="text-xs text-gray-400 dark:text-zinc-500 text-center py-4">No documents matching &ldquo;{docSearch}&rdquo;</p>
              ) : (
                <div className="space-y-1">
                  {filteredDocs.map((doc: any) => {
                    const isSel = selectedDoc?.id === doc.id;
                    return (
                      <button
                        key={doc.id}
                        onClick={() => setSelectedDoc(isSel ? null : doc)}
                        className={cn(
                          "w-full text-left flex items-center gap-3 px-3.5 py-2.5 rounded-xl border transition-all duration-100 cursor-pointer",
                          isSel
                            ? "border-gray-200 dark:border-[#2a2a2a] bg-white dark:bg-[#1a1a1a] shadow-sm"
                            : "border-transparent bg-transparent hover:border-gray-200 dark:hover:border-[#1f1f1f] hover:bg-white dark:hover:bg-[#1a1a1a]"
                        )}
                      >
                        <div className={cn("w-4 h-4 rounded-[4px] flex items-center justify-center flex-shrink-0 border transition-colors", isSel ? "bg-gray-900 dark:bg-zinc-100 border-gray-900 dark:border-zinc-100" : "border-gray-300 dark:border-[#3a3a3a] bg-white dark:bg-[#0a0a0a]")}>
                          {isSel && <Check className="w-2.5 h-2.5 text-white dark:text-gray-900" />}
                        </div>
                        <div className="w-7 h-7 rounded-lg bg-gray-100 dark:bg-[#1f1f1f] flex items-center justify-center flex-shrink-0">
                          <FileText className="w-3.5 h-3.5 text-gray-400 dark:text-zinc-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-900 dark:text-white truncate leading-snug">{doc.filename}</p>
                          <p className="text-xs text-gray-400 dark:text-zinc-500">
                            {docResultsMap[doc.id]?.length ?? 0} fields · {formatDate(doc.created_at)}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer action bar */}
        <div className="flex items-center justify-between gap-4 px-6 py-4 border-t border-gray-100 dark:border-[#1f1f1f] bg-gray-50/60 dark:bg-[#0a0a0a] flex-shrink-0">
          <div className="min-w-0 flex-1">
            {selectedForm && selectedDoc ? (
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-xs font-semibold text-gray-800 dark:text-zinc-200 truncate">{selectedForm.form_name}</span>
                <span className="text-gray-300 dark:text-zinc-600 text-xs flex-shrink-0">·</span>
                <span className="text-xs text-gray-400 dark:text-zinc-500 truncate">{selectedDoc.filename}</span>
              </div>
            ) : (
              <span className="text-xs text-gray-400 dark:text-zinc-500 italic">Select a form and document to continue</span>
            )}
          </div>
          <button
            onClick={handleStart}
            disabled={!selectedForm || !selectedDoc || starting}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white dark:text-gray-900 bg-gray-900 dark:bg-zinc-100 rounded-lg cursor-pointer border-none transition-all duration-150 hover:bg-gray-700 dark:hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
          >
            {starting
              ? <><Loader2 className="h-4 w-4 animate-spin" />Loading…</>
              : <><Play className="h-3.5 w-3.5 fill-current" />Start Review</>
            }
          </button>
        </div>
      </div>
    </DashboardLayout>
  );
}

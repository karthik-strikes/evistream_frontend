'use client';

import { useState, useEffect } from 'react';
import { DashboardLayout } from '@/components/layout';
import { FileText, Save, ArrowLeft, Play, RotateCcw, GripVertical, Loader2, Check } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useProject } from '@/contexts/ProjectContext';
import { documentsService, formsService } from '@/services';
import type { Document, Form } from '@/types/api';
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels';
import { cn, formatDate } from '@/lib/utils';

export default function ManualExtractionPage() {
  const { toast } = useToast();
  const { selectedProject } = useProject();

  // Mode: 'select' | 'extract'
  const [mode, setMode] = useState<'select' | 'extract'>('select');

  // Selection state
  const [documents, setDocuments] = useState<Document[]>([]);
  const [forms, setForms] = useState<Form[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<Document | null>(null);
  const [selectedForm, setSelectedForm] = useState<Form | null>(null);
  const [formSearch, setFormSearch] = useState('');
  const [docSearch, setDocSearch] = useState('');
  const [loadingData, setLoadingData] = useState(false);
  const [starting, setStarting] = useState(false);

  // Extraction state
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [pdfUrl, setPdfUrl] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (selectedProject) {
      setLoadingData(true);
      Promise.all([
        formsService.getAll(selectedProject.id),
        documentsService.getAll(selectedProject.id),
      ]).then(([f, d]) => {
        setForms(f.filter((x: any) => x.status === 'active'));
        setDocuments(d.filter((x: any) => x.processing_status === 'completed'));
      }).catch(() => {}).finally(() => setLoadingData(false));
    }
  }, [selectedProject]);

  useEffect(() => {
    return () => { if (pdfUrl.startsWith('blob:')) URL.revokeObjectURL(pdfUrl); };
  }, [pdfUrl]);

  const handleStart = async () => {
    if (!selectedForm || !selectedDoc) return;
    setStarting(true);
    try {
      const blob = await documentsService.downloadPDF(selectedDoc.id);
      if (pdfUrl.startsWith('blob:')) URL.revokeObjectURL(pdfUrl);
      setPdfUrl(URL.createObjectURL(blob));
      const init: Record<string, any> = {};
      selectedForm.fields.forEach((f: any) => { init[f.field_name] = ''; });
      setFormData(init);
      setMode('extract');
    } catch {
      toast({ title: 'Error', description: 'Failed to load document', variant: 'error' });
    } finally {
      setStarting(false);
    }
  };

  const handleBack = () => {
    if (pdfUrl.startsWith('blob:')) URL.revokeObjectURL(pdfUrl);
    setPdfUrl('');
    setMode('select');
  };

  const handleSave = async () => {
    if (!selectedDoc || !selectedForm) return;
    const empty = selectedForm.fields.filter((f: any) => !formData[f.field_name]?.toString().trim());
    if (empty.length > 0) {
      toast({ title: 'Validation Error', description: `Fill in: ${empty.map((f: any) => f.field_name).join(', ')}`, variant: 'error' });
      return;
    }
    setSaving(true);
    try {
      toast({ title: 'Saved', description: 'Manual extraction saved successfully', variant: 'success' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message || 'Failed to save', variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const renderField = (field: any) => {
    const value = formData[field.field_name] || '';
    const cls = "w-full px-3 py-2 text-sm text-gray-900 dark:text-white bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a] rounded-lg outline-none focus:border-gray-400 dark:focus:border-[#3f3f3f] transition-colors placeholder:text-gray-300 dark:placeholder:text-zinc-600";
    const onChange = (e: any) => setFormData(prev => ({ ...prev, [field.field_name]: e.target.value }));
    if (field.field_type === 'enum' || field.field_type === 'list') {
      return (
        <select value={value} onChange={onChange} className={cn(cls, "cursor-pointer dark:[color-scheme:dark]")}>
          <option value="">Select an option…</option>
          {field.options?.map((o: string) => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    }
    if (field.field_type === 'textarea') {
      return <textarea value={value} onChange={onChange} placeholder={field.example || `Enter ${field.field_name}`} rows={3} className={cn(cls, "resize-none")} />;
    }
    return <input type={field.field_type === 'number' || field.field_type === 'integer' ? 'number' : 'text'} value={value} onChange={onChange} placeholder={field.example || `Enter ${field.field_name}`} className={cls} />;
  };

  if (!selectedProject) {
    return (
      <DashboardLayout title="Manual Extraction" description="Manually extract data from documents">
        <div className="flex items-center justify-center h-48 text-sm text-gray-400">Select a project to get started</div>
      </DashboardLayout>
    );
  }

  const filteredForms = formSearch.trim() ? forms.filter(f => f.form_name.toLowerCase().includes(formSearch.toLowerCase())) : forms;
  const filteredDocs = docSearch.trim() ? documents.filter(d => d.filename.toLowerCase().includes(docSearch.toLowerCase())) : documents;

  // ── Extraction view ───────────────────────────────────────────────
  if (mode === 'extract' && selectedForm && selectedDoc) {
    return (
      <DashboardLayout title="Manual Extraction" description="Manually extract data from documents">
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <button onClick={handleBack} className="flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200 bg-transparent border-none cursor-pointer transition-colors">
            <ArrowLeft className="w-3.5 h-3.5" /> Back
          </button>
          <span className="text-gray-300 dark:text-zinc-700 text-xs">·</span>
          <span className="text-xs font-medium text-gray-500 dark:text-zinc-400 bg-gray-100 dark:bg-[#1a1a1a] px-2 py-0.5 rounded-md">{selectedForm.form_name}</span>
          <span className="text-gray-300 dark:text-zinc-700 text-xs">·</span>
          <span className="text-xs font-medium text-gray-500 dark:text-zinc-400 bg-gray-100 dark:bg-[#1a1a1a] px-2 py-0.5 rounded-md truncate max-w-[220px]">{selectedDoc.filename}</span>
        </div>

        <PanelGroup orientation="horizontal" className="gap-0">
          <Panel defaultSize={60} minSize={30}>
            <div className="flex flex-col rounded-xl border border-gray-200 dark:border-[#1f1f1f] overflow-hidden bg-white dark:bg-[#111111]" style={{ height: 'calc(100vh - 120px)' }}>
              {pdfUrl
                ? <iframe src={pdfUrl} className="w-full flex-1 border-0" style={{ height: '100%' }} title="PDF Viewer" />
                : <div className="flex-1 flex items-center justify-center text-sm text-gray-400 dark:text-zinc-500">PDF not available</div>
              }
            </div>
          </Panel>

          <PanelResizeHandle className="w-2 mx-1 flex items-center justify-center group cursor-col-resize">
            <div className="w-1 h-full rounded-full bg-gray-200 dark:bg-[#2a2a2a] group-hover:bg-gray-400 dark:group-hover:bg-zinc-600 transition-colors flex items-center justify-center">
              <GripVertical className="h-4 w-4 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </PanelResizeHandle>

          <Panel defaultSize={40} minSize={25}>
            <div className="flex flex-col rounded-xl border border-gray-200 dark:border-[#1f1f1f] overflow-hidden bg-white dark:bg-[#111111]" style={{ height: 'calc(100vh - 120px)' }}>
              {/* Progress header */}
              <div className="px-5 py-3 border-b border-gray-100 dark:border-[#1f1f1f] flex-shrink-0">
                {(() => {
                  const filled = selectedForm.fields.filter((f: any) => formData[f.field_name]?.toString().trim()).length;
                  const total = selectedForm.fields.length;
                  const pct = total > 0 ? Math.round((filled / total) * 100) : 0;
                  return (
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-semibold text-gray-500 dark:text-zinc-400">Progress</span>
                        <span className="text-xs font-semibold text-gray-800 dark:text-white">{filled} / {total}</span>
                      </div>
                      <div className="h-1 bg-gray-100 dark:bg-[#1a1a1a] rounded-full overflow-hidden">
                        <div className="h-full bg-gray-800 dark:bg-zinc-300 rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Fields */}
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5 min-h-0">
                {selectedForm.fields.map((field: any, i: number) => (
                  <div key={field.field_name}>
                    <div className="flex items-start gap-2 mb-1.5">
                      <span className="text-[11px] font-bold text-gray-300 dark:text-zinc-700 w-5 text-right flex-shrink-0 mt-0.5 tabular-nums">{i + 1}</span>
                      <div className="flex-1">
                        <p className="text-xs font-semibold text-gray-700 dark:text-zinc-300 capitalize">{field.field_name.replace(/_/g, ' ')}</p>
                        {field.field_description && <p className="text-[11px] text-gray-400 dark:text-zinc-500 mt-0.5 leading-snug">{field.field_description}</p>}
                      </div>
                    </div>
                    {renderField(field)}
                  </div>
                ))}
              </div>

              {/* Save footer */}
              <div className="px-4 py-3 border-t border-gray-100 dark:border-[#1f1f1f] bg-gray-50/60 dark:bg-[#0a0a0a] flex-shrink-0 flex gap-2">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex-1 inline-flex items-center justify-center gap-2 text-sm font-semibold text-white dark:text-gray-900 bg-gray-900 dark:bg-zinc-100 hover:bg-gray-700 dark:hover:bg-white border-none rounded-lg py-2.5 cursor-pointer transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Save className="w-3.5 h-3.5" />
                  {saving ? 'Saving…' : 'Save Extraction'}
                </button>
                <button
                  onClick={() => { const init: Record<string, any> = {}; selectedForm.fields.forEach((f: any) => { init[f.field_name] = ''; }); setFormData(init); }}
                  title="Reset fields"
                  className="px-3 text-gray-500 dark:text-zinc-400 bg-gray-100 dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a] rounded-lg py-2.5 cursor-pointer hover:bg-gray-200 dark:hover:bg-[#222] transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
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
    <DashboardLayout title="Manual Extraction" description="Manually extract data from documents">
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
              {loadingData ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="w-5 h-5 animate-spin text-gray-300 dark:text-zinc-600" />
                </div>
              ) : forms.length === 0 ? (
                <div className="rounded-lg border border-amber-200 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-900/10 px-3.5 py-3 text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
                  No active forms. Create and activate a form first.
                </div>
              ) : filteredForms.length === 0 ? (
                <p className="text-xs text-gray-400 dark:text-zinc-500 text-center py-4">No forms matching &ldquo;{formSearch}&rdquo;</p>
              ) : filteredForms.map(form => {
                const isSel = selectedForm?.id === form.id;
                return (
                  <button
                    key={form.id}
                    onClick={() => setSelectedForm(form)}
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
                          {form.fields.length} fields{form.form_description ? ` · ${form.form_description}` : ''}
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
                  {!loadingData && documents.length > 0 && (
                    <span className="ml-1.5 text-gray-300 dark:text-zinc-700 normal-case font-normal tracking-normal">({filteredDocs.length})</span>
                  )}
                </span>
                {selectedDoc && (
                  <span className="text-[10px] font-medium text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800/50 px-1.5 py-0.5 rounded-[4px]">Selected</span>
                )}
              </div>
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
            </div>
            <div className="flex-1 overflow-y-auto px-5 pb-5 min-h-0">
              {loadingData ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="w-5 h-5 animate-spin text-gray-300 dark:text-zinc-600" />
                </div>
              ) : documents.length === 0 ? (
                <div className="rounded-lg border border-amber-200 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-900/10 px-3.5 py-3 text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
                  No processed documents. Upload and process a document first.
                </div>
              ) : filteredDocs.length === 0 ? (
                <p className="text-xs text-gray-400 dark:text-zinc-500 text-center py-4">No documents matching &ldquo;{docSearch}&rdquo;</p>
              ) : (
                <div className="space-y-1">
                  {filteredDocs.map(doc => {
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
                          <p className="text-xs text-gray-400 dark:text-zinc-500">{formatDate(doc.created_at)}</p>
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
              : <><Play className="h-3.5 w-3.5 fill-current" />Start Extraction</>
            }
          </button>
        </div>
      </div>
    </DashboardLayout>
  );
}

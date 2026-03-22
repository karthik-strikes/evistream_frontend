'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { DashboardLayout } from '@/components/layout';
import { useToast } from '@/hooks/use-toast';
import { useProject } from '@/contexts/ProjectContext';
import { documentsService, formsService, resultsService } from '@/services';
import type { Document, Form, FormField } from '@/types/api';

import { SelectionView } from './_components/SelectionView';
import { ExtractionView } from './_components/ExtractionView';
import type { ExtractionMode } from './_components/ExtractionToolbar';
import { useDraftAutoSave } from './_hooks/useDraftAutoSave';
import { useExtractionKeyboard } from './_hooks/useExtractionKeyboard';

/** Flatten fields, expanding subform_fields */
function flattenFields(fields: FormField[]): FormField[] {
  const result: FormField[] = [];
  for (const f of fields) {
    if (f.subform_fields && f.subform_fields.length > 0) {
      result.push(...f.subform_fields);
    } else {
      result.push(f);
    }
  }
  return result;
}

/** Normalize AI extraction keys: strip '.value' suffix, unwrap object values */
function normalizeAiData(raw: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [key, val] of Object.entries(raw)) {
    const cleanKey = key.endsWith('.value') ? key.slice(0, -6) : key;
    if (typeof val === 'object' && val !== null) {
      out[cleanKey] = (val as any)?.final_value ?? (val as any)?.value ?? JSON.stringify(val);
    } else {
      out[cleanKey] = val;
    }
  }
  return out;
}

export default function ManualExtractionPage() {
  const { toast } = useToast();
  const { selectedProject } = useProject();

  // Mode
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
  const [aiPrefilledKeys, setAiPrefilledKeys] = useState<Set<string>>(new Set());

  // Extraction mode (blind vs AI-assisted)
  const [extractionMode, setExtractionMode] = useState<ExtractionMode>(() => {
    if (typeof window !== 'undefined') {
      return (sessionStorage.getItem('evistream:extractionMode') as ExtractionMode) || 'blind';
    }
    return 'blind';
  });

  // Queue sidebar
  const [queueOpen, setQueueOpen] = useState(false);

  // Completion tracking
  const [doneDocs, setDoneDocs] = useState<Set<string>>(new Set());
  // Track which docs have AI results — controls whether AI toggle is shown
  const [aiAvailableDocs, setAiAvailableDocs] = useState<Set<string>>(new Set());

  // Draft auto-save
  const { clearDraft } = useDraftAutoSave(
    selectedForm?.id,
    selectedDoc?.id,
    formData,
    setFormData,
    mode === 'extract',
  );

  // Persist extraction mode to sessionStorage
  useEffect(() => {
    sessionStorage.setItem('evistream:extractionMode', extractionMode);
  }, [extractionMode]);

  // Load forms + documents
  useEffect(() => {
    if (selectedProject) {
      setLoadingData(true);
      Promise.all([
        formsService.getAll(selectedProject.id),
        documentsService.getAll(selectedProject.id),
      ]).then(([f, d]) => {
        setForms(f.filter((x: any) => x.status === 'active'));
        setDocuments(d.filter((x: any) => x.processing_status === 'completed'));
      }).catch(() => {
        toast({ title: 'Error', description: 'Failed to load forms and documents', variant: 'error' });
      }).finally(() => setLoadingData(false));
    }
  }, [selectedProject]);

  // When form changes, fetch which docs have manual/AI extractions
  useEffect(() => {
    if (!selectedProject || !selectedForm) {
      setDoneDocs(new Set());
      setAiAvailableDocs(new Set());
      return;
    }
    resultsService.getAll({ projectId: selectedProject.id, formId: selectedForm.id })
      .then(results => {
        setDoneDocs(new Set(
          results.filter(r => r.extraction_type === 'manual').map(r => r.document_id)
        ));
        setAiAvailableDocs(new Set(
          results.filter(r => r.extraction_type === 'ai').map(r => r.document_id)
        ));
      })
      .catch(() => {});
  }, [selectedForm, selectedProject]);

  // Cleanup blob URL
  useEffect(() => {
    return () => { if (pdfUrl.startsWith('blob:')) URL.revokeObjectURL(pdfUrl); };
  }, [pdfUrl]);

  // Show AI toggle only if at least one doc has AI results for this form
  const hasAnyAiResults = aiAvailableDocs.size > 0;

  // Find next unextracted doc
  const nextUnextractedDoc = useMemo(() => {
    if (!selectedDoc) return null;
    return documents.find(d => d.id !== selectedDoc.id && !doneDocs.has(d.id)) || null;
  }, [documents, selectedDoc, doneDocs]);

  // ── Handlers ──────────────────────────────────────────────────────

  const loadPdfForDoc = async (doc: Document): Promise<string> => {
    const presignedUrl = await documentsService.getDownloadUrl(doc.id);
    const pdfResponse = await fetch(presignedUrl);
    if (!pdfResponse.ok) throw new Error('Failed to fetch PDF');
    const blob = await pdfResponse.blob();
    return URL.createObjectURL(blob);
  };

  const initFormData = useCallback((form: Form): Record<string, any> => {
    const init: Record<string, any> = {};
    flattenFields(form.fields).forEach(f => { init[f.field_name] = ''; });
    return init;
  }, []);

  const loadAiData = useCallback(async (form: Form, docId: string): Promise<{ data: Record<string, any>; keys: Set<string> }> => {
    if (!selectedProject) return { data: {}, keys: new Set() };
    try {
      const results = await resultsService.getAll({
        projectId: selectedProject.id,
        formId: form.id,
        documentId: docId,
      });
      const aiResult = results.find(r => r.extraction_type === 'ai');
      if (!aiResult) return { data: {}, keys: new Set() };
      const normalized = normalizeAiData(aiResult.extracted_data);
      const fieldNames = new Set(flattenFields(form.fields).map(f => f.field_name));
      const prefilled: Record<string, any> = {};
      const prefilledKeys = new Set<string>();
      for (const [key, val] of Object.entries(normalized)) {
        if (fieldNames.has(key) && val != null && val !== '') {
          prefilled[key] = String(val);
          prefilledKeys.add(key);
        }
      }
      return { data: prefilled, keys: prefilledKeys };
    } catch {
      return { data: {}, keys: new Set() };
    }
  }, [selectedProject]);

  const handleStart = async () => {
    if (!selectedForm || !selectedDoc) return;
    setStarting(true);
    try {
      const blobUrl = await loadPdfForDoc(selectedDoc);
      if (pdfUrl.startsWith('blob:')) URL.revokeObjectURL(pdfUrl);
      setPdfUrl(blobUrl);

      let init = initFormData(selectedForm);

      if (extractionMode === 'ai_assisted') {
        const { data, keys } = await loadAiData(selectedForm, selectedDoc.id);
        init = { ...init, ...data };
        setAiPrefilledKeys(keys);
      } else {
        setAiPrefilledKeys(new Set());
      }

      setFormData(init);
      setMode('extract');
    } catch {
      toast({ title: 'Error', description: 'Failed to load document', variant: 'error' });
    } finally {
      setStarting(false);
    }
  };

  const handleBack = useCallback(() => {
    const hasContent = Object.values(formData).some(v => v?.toString().trim());
    if (hasContent) {
      if (!window.confirm('You have unsaved changes. Discard and go back?')) return;
    }
    if (pdfUrl.startsWith('blob:')) URL.revokeObjectURL(pdfUrl);
    setPdfUrl('');
    setAiPrefilledKeys(new Set());
    setMode('select');
  }, [formData, pdfUrl]);

  const handleSave = useCallback(async () => {
    if (!selectedDoc || !selectedForm) return;
    const allFields = flattenFields(selectedForm.fields);
    const empty = allFields.filter(f => !formData[f.field_name]?.toString().trim());
    if (empty.length > 0) {
      toast({ title: 'Validation Error', description: `Fill in: ${empty.map(f => f.field_name.replace(/_/g, ' ')).join(', ')}`, variant: 'error' });
      return;
    }
    setSaving(true);
    try {
      await resultsService.saveManualExtraction({
        document_id: selectedDoc.id,
        form_id: selectedForm.id,
        extracted_data: formData,
        extraction_type: 'manual',
      });
      toast({ title: 'Saved', description: 'Manual extraction saved successfully', variant: 'success' });
      setDoneDocs(prev => new Set(prev).add(selectedDoc.id));
      clearDraft();
      return true;
    } catch (err: any) {
      console.error('[ManualExtraction] Save failed:', err);
      return false;
    } finally {
      setSaving(false);
    }
  }, [selectedDoc, selectedForm, formData, clearDraft, toast]);

  const handleSaveAndNext = useCallback(async () => {
    const saved = await handleSave();
    if (!saved || !selectedForm) return;
    const next = nextUnextractedDoc;
    if (!next) {
      toast({ title: 'All done!', description: 'All documents have been extracted', variant: 'success' });
      if (pdfUrl.startsWith('blob:')) URL.revokeObjectURL(pdfUrl);
      setPdfUrl('');
      setMode('select');
      return;
    }
    // Switch to next doc
    try {
      const blobUrl = await loadPdfForDoc(next);
      if (pdfUrl.startsWith('blob:')) URL.revokeObjectURL(pdfUrl);
      setPdfUrl(blobUrl);
      setSelectedDoc(next);

      let init = initFormData(selectedForm);
      if (extractionMode === 'ai_assisted') {
        const { data, keys } = await loadAiData(selectedForm, next.id);
        init = { ...init, ...data };
        setAiPrefilledKeys(keys);
      } else {
        setAiPrefilledKeys(new Set());
      }
      setFormData(init);
    } catch {
      toast({ title: 'Error', description: 'Failed to load next document', variant: 'error' });
    }
  }, [handleSave, selectedForm, nextUnextractedDoc, pdfUrl, extractionMode, initFormData, loadAiData, toast]);

  const handleEscape = useCallback(() => {
    const hasContent = Object.values(formData).some(v => v?.toString().trim());
    if (hasContent) {
      if (window.confirm('Discard changes?')) {
        handleBack();
      }
    } else {
      handleBack();
    }
  }, [formData, handleBack]);

  const handleReset = useCallback(() => {
    if (!selectedForm) return;
    setFormData(initFormData(selectedForm));
    setAiPrefilledKeys(new Set());
  }, [selectedForm, initFormData]);

  const handleFieldChange = useCallback((fieldName: string, value: any) => {
    setFormData(prev => ({ ...prev, [fieldName]: value }));
  }, []);

  const handleModeChange = useCallback(async (newMode: ExtractionMode) => {
    setExtractionMode(newMode);
    if (!selectedForm || !selectedDoc || mode !== 'extract') return;

    if (newMode === 'ai_assisted') {
      const { data, keys } = await loadAiData(selectedForm, selectedDoc.id);
      // Only prefill empty fields
      setFormData(prev => {
        const updated = { ...prev };
        for (const [key, val] of Object.entries(data)) {
          if (!updated[key]?.toString().trim()) {
            updated[key] = val;
          }
        }
        return updated;
      });
      setAiPrefilledKeys(keys);
    } else {
      setAiPrefilledKeys(new Set());
    }
  }, [selectedForm, selectedDoc, mode, loadAiData]);

  const handleQueueDocSelect = useCallback(async (doc: Document) => {
    if (!selectedForm || doc.id === selectedDoc?.id) return;
    try {
      const blobUrl = await loadPdfForDoc(doc);
      if (pdfUrl.startsWith('blob:')) URL.revokeObjectURL(pdfUrl);
      setPdfUrl(blobUrl);
      setSelectedDoc(doc);

      let init = initFormData(selectedForm);
      if (extractionMode === 'ai_assisted') {
        const { data, keys } = await loadAiData(selectedForm, doc.id);
        init = { ...init, ...data };
        setAiPrefilledKeys(keys);
      } else {
        setAiPrefilledKeys(new Set());
      }
      setFormData(init);
    } catch {
      toast({ title: 'Error', description: 'Failed to load document', variant: 'error' });
    }
  }, [selectedForm, selectedDoc, pdfUrl, extractionMode, initFormData, loadAiData, toast]);

  // Keyboard shortcuts
  useExtractionKeyboard({
    onSave: handleSave,
    onSaveAndNext: handleSaveAndNext,
    onEscape: handleEscape,
    enabled: mode === 'extract',
  });

  // ── Render ────────────────────────────────────────────────────────

  if (!selectedProject) {
    return (
      <DashboardLayout title="Manual Extraction" description="Manually extract data from documents">
        <div className="flex items-center justify-center h-48 text-sm text-gray-400">Select a project to get started</div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title="Manual Extraction" description="Manually extract data from documents">
      {mode === 'extract' && selectedForm && selectedDoc ? (
        <ExtractionView
          form={selectedForm}
          doc={selectedDoc}
          documents={documents}
          pdfUrl={pdfUrl}
          formData={formData}
          aiPrefilledKeys={aiPrefilledKeys}
          extractionMode={extractionMode}
          doneDocs={doneDocs}
          saving={saving}
          queueOpen={queueOpen}
          hasNextDoc={!!nextUnextractedDoc}
          showAiToggle={hasAnyAiResults}
          onModeChange={handleModeChange}
          onFieldChange={handleFieldChange}
          onSave={handleSave}
          onSaveAndNext={handleSaveAndNext}
          onReset={handleReset}
          onBack={handleBack}
          onToggleQueue={() => setQueueOpen(p => !p)}
          onSelectDoc={handleQueueDocSelect}
        />
      ) : (
        <SelectionView
          forms={forms}
          documents={documents}
          selectedForm={selectedForm}
          selectedDoc={selectedDoc}
          formSearch={formSearch}
          docSearch={docSearch}
          loadingData={loadingData}
          starting={starting}
          doneDocs={doneDocs}
          onSelectForm={setSelectedForm}
          onSelectDoc={setSelectedDoc}
          onFormSearch={setFormSearch}
          onDocSearch={setDocSearch}
          onStart={handleStart}
        />
      )}
    </DashboardLayout>
  );
}

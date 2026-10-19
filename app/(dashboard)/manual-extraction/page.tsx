'use client';

import { useState, useEffect, useCallback, useMemo, useRef, Suspense } from 'react';
import { DashboardLayout } from '@/components/layout';
import { useRouter, useSearchParams } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { useProject } from '@/contexts/ProjectContext';
import { EmptyState } from '@/components/ui';
import { FolderOpen } from 'lucide-react';
import { documentsService, formsService, resultsService, assignmentsService } from '@/services';
import { useProjectPermissions } from '@/hooks/useProjectPermissions';
import { PermissionGate } from '@/components/ui/permission-gate';
import type { Document, Form, ReviewAssignment } from '@/types/api';

import { SelectionView } from './_components/SelectionView';
import { ExtractionView } from './_components/ExtractionView';
import { MyQueueView, type FormState } from './_components/MyQueueView';
import type { ExtractionMode } from './_components/ExtractionToolbar';
import { useDraftAutoSave } from './_hooks/useDraftAutoSave';
import { useExtractionKeyboard } from './_hooks/useExtractionKeyboard';
import { isTableField, flattenScalarFields, type AiTablePrefill } from './_lib/fieldKinds';

/** Normalize AI extraction keys: strip '.value' suffix, preserve arrays for table fields */
function normalizeAiData(raw: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [key, val] of Object.entries(raw)) {
    const cleanKey = key.endsWith('.value') ? key.slice(0, -6) : key;
    if (Array.isArray(val)) {
      out[cleanKey] = val;
    } else if (typeof val === 'object' && val !== null) {
      if ('value' in val && Array.isArray((val as any).value)) {
        out[cleanKey] = (val as any).value;
      } else {
        const extracted = (val as any)?.final_value ?? (val as any)?.value;
        if (extracted == null) {
          out[cleanKey] = '';
        } else if (typeof extracted === 'object') {
          // Doubly-nested — give up rather than render [object Object]
          out[cleanKey] = '';
        } else {
          out[cleanKey] = String(extracted);
        }
      }
    } else {
      out[cleanKey] = val;
    }
  }
  return out;
}

function ManualExtractionContent() {
  const { toast } = useToast();
  const { selectedProject } = useProject();
  const { isOwner, isAdmin, role, can_manage_assignments } = useProjectPermissions();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [mode, setMode] = useState<'select' | 'extract'>('select');
  const [currentPage, setCurrentPage] = useState<number | null>(null);

  const [documents, setDocuments] = useState<Document[]>([]);
  const [forms, setForms] = useState<Form[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<Document | null>(null);
  const [selectedForm, setSelectedForm] = useState<Form | null>(null);
  const [formSearch, setFormSearch] = useState('');
  const [docSearch, setDocSearch] = useState('');
  const [loadingData, setLoadingData] = useState(false);
  const [starting, setStarting] = useState(false);

  const [formData, setFormData] = useState<Record<string, any>>({});
  const savedSnapshotRef = useRef<string>('');
  const [pdfUrl, setPdfUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [aiPrefilledKeys, setAiPrefilledKeys] = useState<Set<string>>(new Set());
  const [aiPrefilledTablePrefill, setAiPrefilledTablePrefill] = useState<Record<string, AiTablePrefill>>({});
  const [tableErrors, setTableErrors] = useState<Record<string, Record<number, Set<string>>>>({});

  const [extractionMode, setExtractionMode] = useState<ExtractionMode>(() => {
    if (typeof window !== 'undefined') {
      return (sessionStorage.getItem('evistream:extractionMode') as ExtractionMode) || 'blind';
    }
    return 'blind';
  });

  const [queueOpen, setQueueOpen] = useState(false);
  const [doneDocs, setDoneDocs] = useState<Set<string>>(new Set());
  const [partialDocs, setPartialDocs] = useState<Set<string>>(new Set());
  const [aiAvailableDocs, setAiAvailableDocs] = useState<Set<string>>(new Set());
  const [myAssignments, setMyAssignments] = useState<ReviewAssignment[]>([]);
  const [loadingAssignments, setLoadingAssignments] = useState(true);
  // (docId, formId) → state, scoped to the role the current user plays for that doc
  const [myFormStatusByDoc, setMyFormStatusByDoc] = useState<Map<string, Map<string, FormState>>>(new Map());
  const [view, setView] = useState<'queue' | 'browse'>('queue');
  const [startingKey, setStartingKey] = useState<string | null>(null);

  const myRoleByDoc = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of myAssignments) if (a.status !== 'skipped') m.set(a.document_id, a.reviewer_role);
    return m;
  }, [myAssignments]);

  const { clearDraft } = useDraftAutoSave(
    selectedForm?.id, selectedDoc?.id, formData, setFormData, mode === 'extract',
  );

  useEffect(() => {
    sessionStorage.setItem('evistream:extractionMode', extractionMode);
  }, [extractionMode]);

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

      setLoadingAssignments(true);
      assignmentsService.getMyAssignments({ projectId: selectedProject.id })
        .then(asgs => setMyAssignments(asgs))
        .catch(() => setMyAssignments([]))
        .finally(() => setLoadingAssignments(false));
    }
  }, [selectedProject]);

  // Refresh roles when window regains focus (e.g. after admin reassigns mid-session)
  useEffect(() => {
    if (!selectedProject) return;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      assignmentsService.getMyAssignments({ projectId: selectedProject.id })
        .then(asgs => setMyAssignments(asgs))
        .catch(() => {});
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [selectedProject?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Default to "browse" if user has no assignments after assignments load resolves
  useEffect(() => {
    if (!loadingAssignments && myAssignments.length === 0) setView('browse');
    if (!loadingAssignments && myAssignments.length > 0) setView('queue');
  }, [loadingAssignments, myAssignments.length]);

  // Build (docId → formId → state) scoped to MY role per doc
  useEffect(() => {
    if (!selectedProject) { setMyFormStatusByDoc(new Map()); return; }
    let cancelled = false;
    resultsService.getAll({ projectId: selectedProject.id })
      .then(results => {
        if (cancelled) return;
        const out = new Map<string, Map<string, FormState>>();
        for (const r of results) {
          if (r.extraction_type !== 'manual') continue;
          const expectedRole = myRoleByDoc.get(r.document_id) ?? null;
          if ((r.reviewer_role ?? null) !== expectedRole) continue;
          const isPartial = (r.extracted_data as any)?._partial === true;
          if (!out.has(r.document_id)) out.set(r.document_id, new Map());
          out.get(r.document_id)!.set(r.form_id, isPartial ? 'partial' : 'done');
        }
        setMyFormStatusByDoc(out);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [selectedProject, myRoleByDoc]);

  useEffect(() => {
    if (!selectedProject || !selectedForm) {
      setDoneDocs(new Set()); setPartialDocs(new Set()); setAiAvailableDocs(new Set()); return;
    }
    let cancelled = false;
    resultsService.getAll({ projectId: selectedProject.id, formId: selectedForm.id })
      .then(results => {
        if (cancelled) return;
        const done = new Set<string>();
        const partial = new Set<string>();
        for (const r of results) {
          if (r.extraction_type !== 'manual') continue;
          if ((r.extracted_data as any)?._partial === true) partial.add(r.document_id);
          else done.add(r.document_id);
        }
        setDoneDocs(done);
        setPartialDocs(partial);
        setAiAvailableDocs(new Set(results.filter(r => r.extraction_type === 'ai').map(r => r.document_id)));
      }).catch(() => {});
    return () => { cancelled = true; };
  }, [selectedForm, selectedProject]);

  useEffect(() => {
    return () => { if (pdfUrl.startsWith('blob:')) URL.revokeObjectURL(pdfUrl); };
  }, [pdfUrl]);

  // URL → state: handles initial load, deep links, and browser back/forward
  useEffect(() => {
    if (forms.length === 0 || documents.length === 0) return;
    const formId = searchParams.get('form');
    const docId = searchParams.get('doc');
    const pageParam = parseInt(searchParams.get('page') ?? '', 10);
    const urlPage = (!isNaN(pageParam) && pageParam >= 1) ? pageParam : null;

    // URL has no extraction params → ensure we're at the picker
    if (!formId || !docId) {
      if (mode === 'extract') {
        if (pdfUrl.startsWith('blob:')) URL.revokeObjectURL(pdfUrl);
        setPdfUrl('');
        setCurrentPage(null);
        clearAiPrefill();
        setTableErrors({});
        setMode('select');
      }
      return;
    }

    // URL form/doc match current state → only sync page param
    if (mode === 'extract' && selectedForm?.id === formId && selectedDoc?.id === docId) {
      if (urlPage !== currentPage) setCurrentPage(urlPage);
      return;
    }

    // URL points at a form/doc we're not currently showing → load it
    const form = forms.find(f => f.id === formId);
    const doc = documents.find(d => d.id === docId);
    if (!form || !doc) return;
    setCurrentPage(urlPage);
    setStarting(true);
    (async () => {
      try {
        const blobUrl = await loadPdfForDoc(doc);
        setPdfUrl(prev => { if (prev.startsWith('blob:')) URL.revokeObjectURL(prev); return blobUrl; });
        let init = initFormData(form);
        if (extractionMode === 'ai_assisted') {
          const { data, keys, tablePrefill } = await loadAiData(form, doc.id);
          init = { ...init, ...data };
          setAiPrefilledKeys(keys);
          setAiPrefilledTablePrefill(tablePrefill);
        }
        const partial = await loadExistingPartial(form, doc.id);
        if (partial) init = { ...init, ...partial };
        setFormData(init);
        setSelectedForm(form);
        setSelectedDoc(doc);
        setMode('extract');
      } catch {
        toast({ title: 'Error', description: 'Failed to load document from URL', variant: 'error' });
      } finally {
        setStarting(false);
      }
    })();
  }, [searchParams, forms, documents]); // eslint-disable-line react-hooks/exhaustive-deps

  // State → URL: push for new form/doc (so browser back returns to picker), replace for page changes
  useEffect(() => {
    if (mode === 'extract' && selectedForm && selectedDoc) {
      const urlForm = searchParams.get('form');
      const urlDoc = searchParams.get('doc');
      const urlPageStr = searchParams.get('page');
      const targetPageStr = currentPage && currentPage > 1 ? String(currentPage) : null;
      if (urlForm === selectedForm.id && urlDoc === selectedDoc.id && urlPageStr === targetPageStr) return;

      const params = new URLSearchParams();
      params.set('form', selectedForm.id);
      params.set('doc', selectedDoc.id);
      if (targetPageStr) params.set('page', targetPageStr);
      const target = `/manual-extraction?${params.toString()}`;

      const formOrDocChanged = urlForm !== selectedForm.id || urlDoc !== selectedDoc.id;
      if (formOrDocChanged) router.push(target, { scroll: false });
      else router.replace(target, { scroll: false });
    } else if (mode === 'select' && (searchParams.get('form') || searchParams.get('doc') || searchParams.get('page'))) {
      router.replace('/manual-extraction', { scroll: false });
    }
  }, [mode, selectedForm?.id, selectedDoc?.id, currentPage]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasAnyAiResults = aiAvailableDocs.size > 0;
  const nextUnextractedDoc = useMemo(() => {
    if (!selectedDoc) return null;
    return documents.find(d => d.id !== selectedDoc.id && !doneDocs.has(d.id)) || null;
  }, [documents, selectedDoc, doneDocs]);

  // ── Core helpers ──────────────────────────────────────────────────

  const loadPdfForDoc = async (doc: Document): Promise<string> => {
    const presignedUrl = await documentsService.getDownloadUrl(doc.id);
    const pdfResponse = await fetch(presignedUrl, { signal: AbortSignal.timeout(30000) });
    if (!pdfResponse.ok) throw new Error('Failed to fetch PDF');
    const blob = await pdfResponse.blob();
    return URL.createObjectURL(blob);
  };

  const initFormData = useCallback((form: Form): Record<string, any> => {
    const init: Record<string, any> = {};
    flattenScalarFields(form.fields).forEach(f => { init[f.field_name] = ''; });
    form.fields.forEach(f => { if (isTableField(f)) init[f.field_name] = []; });
    return init;
  }, []);

  const loadAiData = useCallback(async (form: Form, docId: string): Promise<{
    data: Record<string, any>;
    keys: Set<string>;
    tablePrefill: Record<string, AiTablePrefill>;
  }> => {
    if (!selectedProject) return { data: {}, keys: new Set(), tablePrefill: {} };
    try {
      const results = await resultsService.getAll({
        projectId: selectedProject.id, formId: form.id, documentId: docId,
      });
      const aiResult = results.find(r => r.extraction_type === 'ai');
      if (!aiResult) return { data: {}, keys: new Set(), tablePrefill: {} };
      const normalized = normalizeAiData(aiResult.extracted_data);

      // Scalar fields
      const scalarNames = new Set(flattenScalarFields(form.fields).map(f => f.field_name));
      const prefilled: Record<string, any> = {};
      const prefilledKeys = new Set<string>();
      for (const [key, val] of Object.entries(normalized)) {
        if (scalarNames.has(key) && val != null && val !== '' && !Array.isArray(val)) {
          prefilled[key] = String(val);
          prefilledKeys.add(key);
        }
      }

      // Table fields — build per-row, per-cell prefill map
      const tablePrefill: Record<string, AiTablePrefill> = {};
      for (const field of form.fields) {
        if (!isTableField(field)) continue;
        const arr: any[] = Array.isArray(normalized[field.field_name]) ? normalized[field.field_name] : [];
        if (arr.length === 0) continue;
        const subCols = (field.subform_fields ?? []).map(sf => sf.field_name);
        const rowIndices = new Set<number>();
        const cells: Record<number, Set<string>> = {};
        const rows = arr.map((item: any, rowIdx: number) => {
          const row: Record<string, string> = {};
          const aiCells = new Set<string>();
          for (const col of subCols) {
            const cell = item?.[col];
            let val = '';
            if (cell == null) {
              val = '';
            } else if (typeof cell === 'object' && 'final_value' in cell) {
              val = cell.final_value != null ? String(cell.final_value) : '';
            } else if (typeof cell === 'object' && 'value' in cell) {
              val = cell.value != null ? String(cell.value) : '';
            } else {
              val = String(cell);
            }
            row[col] = val;
            if (val.trim()) aiCells.add(col);
          }
          rowIndices.add(rowIdx);
          cells[rowIdx] = aiCells;
          return row;
        });
        prefilled[field.field_name] = rows;
        tablePrefill[field.field_name] = { rowIndices, cells };
      }

      return { data: prefilled, keys: prefilledKeys, tablePrefill };
    } catch {
      return { data: {}, keys: new Set(), tablePrefill: {} };
    }
  }, [selectedProject]);

  const clearAiPrefill = () => {
    setAiPrefilledKeys(new Set());
    setAiPrefilledTablePrefill({});
  };

  // Fetch a previously-saved partial extraction for this doc+role and return the form data
  // (with the _partial marker stripped). Returns null when no partial save exists.
  const loadExistingPartial = useCallback(async (form: Form, docId: string): Promise<Record<string, any> | null> => {
    if (!selectedProject) return null;
    try {
      const results = await resultsService.getAll({
        projectId: selectedProject.id, formId: form.id, documentId: docId,
      });
      const role = myRoleByDoc.get(docId) ?? null;
      const manualResult = results.find(r =>
        r.extraction_type === 'manual' && (r.reviewer_role ?? null) === role
      );
      if (!manualResult) return null;
      const data = { ...manualResult.extracted_data } as Record<string, any>;
      if (data._partial !== true) return null;
      delete data._partial;
      return data;
    } catch { return null; }
  }, [selectedProject, myRoleByDoc]);

  // ── Handlers ──────────────────────────────────────────────────────

  const handleStart = async () => {
    if (!selectedForm || !selectedDoc) return;
    setStarting(true);
    try {
      const blobUrl = await loadPdfForDoc(selectedDoc);
      if (pdfUrl.startsWith('blob:')) URL.revokeObjectURL(pdfUrl);
      setPdfUrl(blobUrl);

      let init = initFormData(selectedForm);
      if (extractionMode === 'ai_assisted') {
        const { data, keys, tablePrefill } = await loadAiData(selectedForm, selectedDoc.id);
        init = { ...init, ...data };
        setAiPrefilledKeys(keys);
        setAiPrefilledTablePrefill(tablePrefill);
      } else {
        clearAiPrefill();
      }
      const partial = await loadExistingPartial(selectedForm, selectedDoc.id);
      if (partial) init = { ...init, ...partial };
      setTableErrors({});
      setFormData(init);
      setMode('extract');
    } catch {
      toast({ title: 'Error', description: 'Failed to load document', variant: 'error' });
    } finally {
      setStarting(false);
    }
  };

  const handleStartFormForDoc = useCallback(async (doc: Document, form: Form) => {
    const key = `${doc.id}:${form.id}`;
    setStartingKey(key);
    setStarting(true);
    try {
      const blobUrl = await loadPdfForDoc(doc);
      if (pdfUrl.startsWith('blob:')) URL.revokeObjectURL(pdfUrl);
      setPdfUrl(blobUrl);

      let init = initFormData(form);
      if (extractionMode === 'ai_assisted') {
        const { data, keys, tablePrefill } = await loadAiData(form, doc.id);
        init = { ...init, ...data };
        setAiPrefilledKeys(keys);
        setAiPrefilledTablePrefill(tablePrefill);
      } else {
        clearAiPrefill();
      }
      const partial = await loadExistingPartial(form, doc.id);
      if (partial) init = { ...init, ...partial };
      setTableErrors({});
      setFormData(init);
      savedSnapshotRef.current = JSON.stringify(init);
      setSelectedForm(form);
      setSelectedDoc(doc);
      setMode('extract');
    } catch {
      toast({ title: 'Error', description: 'Failed to load document', variant: 'error' });
    } finally {
      setStarting(false);
      setStartingKey(null);
    }
  }, [pdfUrl, extractionMode, initFormData, loadAiData, loadExistingPartial, toast]);

  const handleBack = useCallback(() => {
    const isDirty = JSON.stringify(formData) !== savedSnapshotRef.current;
    if (isDirty && !window.confirm('You have unsaved changes. Discard and go back?')) return;
    if (pdfUrl.startsWith('blob:')) URL.revokeObjectURL(pdfUrl);
    setPdfUrl('');
    clearAiPrefill();
    setTableErrors({});
    setCurrentPage(null);
    setMode('select');
  }, [formData, pdfUrl]);

  const handleSave = useCallback(async () => {
    if (!selectedDoc || !selectedForm) return;

    // Scalar required check
    const scalarFields = flattenScalarFields(selectedForm.fields);
    const emptyScalar = scalarFields.filter(f => f.required !== false && !formData[f.field_name]?.toString().trim());
    if (emptyScalar.length > 0) {
      toast({ title: 'Validation Error', description: `Fill in: ${emptyScalar.map(f => f.field_name.replace(/_/g, ' ')).join(', ')}`, variant: 'error' });
      return;
    }

    // Table required check — collect errors and surface them to TableField for auto-expand + red ring
    const newTableErrors: Record<string, Record<number, Set<string>>> = {};
    for (const field of selectedForm.fields) {
      if (!isTableField(field) || field.required === false) continue;
      const rows: Array<Record<string, string>> = Array.isArray(formData[field.field_name]) ? formData[field.field_name] : [];
      if (rows.length === 0) {
        toast({ title: 'Validation Error', description: `${field.field_name.replace(/_/g, ' ')} needs at least one row`, variant: 'error' });
        return;
      }
      const requiredCols = (field.subform_fields ?? []).filter(sf => sf.required !== false);
      const rowErrors: Record<number, Set<string>> = {};
      for (let i = 0; i < rows.length; i++) {
        const missing = requiredCols.filter(sf => !rows[i][sf.field_name]?.toString().trim());
        if (missing.length > 0) rowErrors[i] = new Set(missing.map(sf => sf.field_name));
      }
      if (Object.keys(rowErrors).length > 0) newTableErrors[field.field_name] = rowErrors;
    }
    if (Object.keys(newTableErrors).length > 0) {
      setTableErrors(newTableErrors);
      const firstField = Object.keys(newTableErrors)[0];
      const firstRowIdx = Number(Object.keys(newTableErrors[firstField])[0]);
      const firstMissing = [...newTableErrors[firstField][firstRowIdx]].map(c => c.replace(/_/g, ' ')).join(', ');
      toast({ title: 'Validation Error', description: `${firstField.replace(/_/g, ' ')} row ${firstRowIdx + 1}: fill in ${firstMissing}`, variant: 'error' });
      return;
    }

    setSaving(true);
    try {
      await resultsService.saveManualExtraction({
        document_id: selectedDoc.id,
        form_id: selectedForm.id,
        extracted_data: formData,
        extraction_type: 'manual',
        reviewer_role: myRoleByDoc.get(selectedDoc.id) ?? null,
      });
      toast({ title: 'Saved', description: 'Manual extraction saved successfully', variant: 'success' });
      savedSnapshotRef.current = JSON.stringify(formData);
      setDoneDocs(prev => new Set(prev).add(selectedDoc.id));
      if (selectedProject) {
        assignmentsService.getMyAssignments({ projectId: selectedProject.id })
          .then(asgs => setMyAssignments(asgs)).catch(() => {});
      }
      setPartialDocs(prev => { const n = new Set(prev); n.delete(selectedDoc.id); return n; });
      setMyFormStatusByDoc(prev => {
        const next = new Map(prev);
        const inner = new Map(next.get(selectedDoc.id) ?? new Map());
        inner.set(selectedForm.id, 'done');
        next.set(selectedDoc.id, inner);
        return next;
      });
      setTableErrors({});
      clearDraft();
      return true;
    } catch (err: any) {
      console.error('[ManualExtraction] Save failed:', err);
      toast({ title: 'Save failed', description: err?.message || 'Could not save extraction. Check your connection and try again.', variant: 'error' });
      return false;
    } finally {
      setSaving(false);
    }
  }, [selectedDoc, selectedForm, formData, clearDraft, toast]);

  const handleSavePartial = useCallback(async () => {
    if (!selectedDoc || !selectedForm) return;
    setSaving(true);
    try {
      await resultsService.saveManualExtraction({
        document_id: selectedDoc.id,
        form_id: selectedForm.id,
        extracted_data: formData,
        extraction_type: 'manual',
        reviewer_role: myRoleByDoc.get(selectedDoc.id) ?? null,
        is_partial: true,
      });
      toast({ title: 'Partial saved', description: 'In-progress work saved to server', variant: 'success' });
      savedSnapshotRef.current = JSON.stringify(formData);
      setPartialDocs(prev => new Set(prev).add(selectedDoc.id));
      setDoneDocs(prev => { const n = new Set(prev); n.delete(selectedDoc.id); return n; });
      setMyFormStatusByDoc(prev => {
        const next = new Map(prev);
        const inner = new Map(next.get(selectedDoc.id) ?? new Map());
        inner.set(selectedForm.id, 'partial');
        next.set(selectedDoc.id, inner);
        return next;
      });
      setTableErrors({});
      clearDraft();
    } catch (err: any) {
      console.error('[ManualExtraction] Partial save failed:', err);
      toast({ title: 'Save failed', description: err?.message || 'Could not save partial extraction', variant: 'error' });
    } finally {
      setSaving(false);
    }
  }, [selectedDoc, selectedForm, formData, myRoleByDoc, clearDraft, toast]);

  const handleSaveAndNext = useCallback(async () => {
    const saved = await handleSave();
    if (!saved || !selectedForm) return;
    const next = nextUnextractedDoc;
    if (!next) {
      toast({ title: 'All done!', description: 'All documents have been extracted', variant: 'success' });
      if (pdfUrl.startsWith('blob:')) URL.revokeObjectURL(pdfUrl);
      setPdfUrl('');
      setCurrentPage(null);
      setMode('select');
      return;
    }
    try {
      const blobUrl = await loadPdfForDoc(next);
      if (pdfUrl.startsWith('blob:')) URL.revokeObjectURL(pdfUrl);
      setPdfUrl(blobUrl);
      setCurrentPage(null);
      setSelectedDoc(next);
      let init = initFormData(selectedForm);
      if (extractionMode === 'ai_assisted') {
        const { data, keys, tablePrefill } = await loadAiData(selectedForm, next.id);
        init = { ...init, ...data };
        setAiPrefilledKeys(keys);
        setAiPrefilledTablePrefill(tablePrefill);
      } else {
        clearAiPrefill();
      }
      const partial = await loadExistingPartial(selectedForm, next.id);
      if (partial) init = { ...init, ...partial };
      setTableErrors({});
      setFormData(init);
    } catch {
      toast({ title: 'Error', description: 'Failed to load next document', variant: 'error' });
    }
  }, [handleSave, selectedForm, nextUnextractedDoc, pdfUrl, extractionMode, initFormData, loadAiData, loadExistingPartial, toast]);

  const handleEscape = useCallback(() => {
    const hasContent = Object.values(formData).some(v =>
      Array.isArray(v) ? v.length > 0 : v?.toString().trim()
    );
    if (hasContent) {
      if (window.confirm('Discard changes?')) handleBack();
    } else {
      handleBack();
    }
  }, [formData, handleBack]);

  const handleReset = useCallback(() => {
    if (!selectedForm) return;
    setFormData(initFormData(selectedForm));
    clearAiPrefill();
    setTableErrors({});
  }, [selectedForm, initFormData]);

  const handleFieldChange = useCallback((fieldName: string, value: any) => {
    setFormData(prev => ({ ...prev, [fieldName]: value }));
  }, []);

  const handleTableChange = useCallback((parentName: string, rows: Array<Record<string, string>>) => {
    setFormData(prev => ({ ...prev, [parentName]: rows }));
    // Clear errors for this table when user edits it
    setTableErrors(prev => {
      if (!prev[parentName]) return prev;
      const next = { ...prev };
      delete next[parentName];
      return next;
    });
  }, []);

  const handleModeChange = useCallback(async (newMode: ExtractionMode) => {
    setExtractionMode(newMode);
    if (!selectedForm || !selectedDoc || mode !== 'extract') return;
    if (newMode === 'ai_assisted') {
      const { data, keys, tablePrefill } = await loadAiData(selectedForm, selectedDoc.id);
      setFormData(prev => {
        const updated = { ...prev };
        for (const [key, val] of Object.entries(data)) {
          if (Array.isArray(val)) {
            if (!Array.isArray(updated[key]) || updated[key].length === 0) updated[key] = val;
          } else if (!updated[key]?.toString().trim()) {
            updated[key] = val;
          }
        }
        return updated;
      });
      setAiPrefilledKeys(keys);
      setAiPrefilledTablePrefill(tablePrefill);
    } else {
      // Switching back to Blind: restore AI-populated fields to empty
      setFormData(prev => {
        const restored = { ...prev };
        for (const key of aiPrefilledKeys) restored[key] = '';
        for (const tableName of Object.keys(aiPrefilledTablePrefill)) restored[tableName] = [];
        return restored;
      });
      clearAiPrefill();
    }
  }, [selectedForm, selectedDoc, mode, loadAiData, aiPrefilledKeys, aiPrefilledTablePrefill]);

  const handleQueueDocSelect = useCallback(async (doc: Document) => {
    if (!selectedForm || doc.id === selectedDoc?.id) return;
    try {
      const blobUrl = await loadPdfForDoc(doc);
      if (pdfUrl.startsWith('blob:')) URL.revokeObjectURL(pdfUrl);
      setPdfUrl(blobUrl);
      setCurrentPage(null);
      setSelectedDoc(doc);
      let init = initFormData(selectedForm);
      if (extractionMode === 'ai_assisted') {
        const { data, keys, tablePrefill } = await loadAiData(selectedForm, doc.id);
        init = { ...init, ...data };
        setAiPrefilledKeys(keys);
        setAiPrefilledTablePrefill(tablePrefill);
      } else {
        clearAiPrefill();
      }
      const partial = await loadExistingPartial(selectedForm, doc.id);
      if (partial) init = { ...init, ...partial };
      setTableErrors({});
      setFormData(init);
    } catch {
      toast({ title: 'Error', description: 'Failed to load document', variant: 'error' });
    }
  }, [selectedForm, selectedDoc, pdfUrl, extractionMode, initFormData, loadAiData, loadExistingPartial, toast]);

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
        <EmptyState
          icon={FolderOpen}
          title="No project selected"
          description="Create or open a project to manually extract data."
          action={{ label: 'Go to projects', onClick: () => router.push('/projects') }}
        />
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title="Manual Extraction" description="Manually extract data from documents">
      <PermissionGate permission="can_run_manual_extractions">
      {mode === 'extract' && selectedForm && selectedDoc ? (
        <ExtractionView
          form={selectedForm}
          doc={selectedDoc}
          documents={documents}
          pdfUrl={pdfUrl}
          formData={formData}
          aiPrefilledKeys={aiPrefilledKeys}
          aiPrefilledTablePrefill={aiPrefilledTablePrefill}
          tableErrors={tableErrors}
          extractionMode={extractionMode}
          doneDocs={doneDocs}
          partialDocs={partialDocs}
          saving={saving}
          queueOpen={queueOpen}
          hasNextDoc={!!nextUnextractedDoc}
          showAiToggle={hasAnyAiResults}
          reviewerRole={myRoleByDoc.get(selectedDoc.id) ?? null}
          onModeChange={handleModeChange}
          onFieldChange={handleFieldChange}
          onTableChange={handleTableChange}
          onSave={handleSave}
          onSavePartial={handleSavePartial}
          onSaveAndNext={handleSaveAndNext}
          onReset={handleReset}
          onBack={handleBack}
          onToggleQueue={() => setQueueOpen(p => !p)}
          onSelectDoc={handleQueueDocSelect}
          currentPage={currentPage}
        />
      ) : view === 'queue' ? (
        <MyQueueView
          assignments={myAssignments}
          documents={documents}
          forms={forms}
          perDocFormStatus={myFormStatusByDoc}
          loading={loadingData || loadingAssignments}
          starting={starting}
          startingKey={startingKey}
          onStartForm={handleStartFormForDoc}
          onBrowseAll={() => setView('browse')}
          hasBrowseAll={isOwner || isAdmin || role === 'manager' || can_manage_assignments}
        />
      ) : (
        <div className="space-y-3">
          {myAssignments.length > 0 && (
            <button
              onClick={() => setView('queue')}
              className="flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200 px-2 py-1 rounded-md hover:bg-gray-100 dark:hover:bg-[#1a1a1a] transition-colors"
            >
              ← Back to my queue
            </button>
          )}
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
        </div>
      )}
      </PermissionGate>
    </DashboardLayout>
  );
}

export default function ManualExtractionPage() {
  return (
    <Suspense>
      <ManualExtractionContent />
    </Suspense>
  );
}

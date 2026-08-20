'use client';

import { GripVertical } from 'lucide-react';
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels';
import type { Document, Form } from '@/types/api';
import { ExtractionToolbar, type ExtractionMode } from './ExtractionToolbar';
import { ExtractionForm } from './ExtractionForm';
import { DocumentQueueSidebar } from './DocumentQueueSidebar';
import type { AiTablePrefill } from '../_lib/fieldKinds';
import { buildLabelMap, documentLabel } from '@/lib/documentLabel';

interface ExtractionViewProps {
  form: Form;
  doc: Document;
  documents: Document[];
  /** Project-wide study IDs. Required, not optional: a child computing its own
   *  map from the filtered `documents` above would silently drop a/b suffixes. */
  docLabels: Record<string, string>;
  pdfUrl: string;
  formData: Record<string, any>;
  aiPrefilledKeys: Set<string>;
  aiPrefilledTablePrefill: Record<string, AiTablePrefill>;
  tableErrors: Record<string, Record<number, Set<string>>>;
  extractionMode: ExtractionMode;
  doneDocs: Set<string>;
  partialDocs: Set<string>;
  saving: boolean;
  queueOpen: boolean;
  hasNextDoc: boolean;
  showAiToggle: boolean;
  reviewerRole?: string | null;
  currentPage?: number | null;
  onPageChange?: ((page: number | null) => void) | undefined;
  onModeChange: (mode: ExtractionMode) => void;
  onFieldChange: (fieldName: string, value: any) => void;
  onTableChange: (parentName: string, rows: Array<Record<string, string>>) => void;
  onSave: () => void;
  onSavePartial: () => void;
  onSaveAndNext: () => void;
  onReset: () => void;
  onBack: () => void;
  onToggleQueue: () => void;
  onSelectDoc: (doc: Document) => void;
}

export function ExtractionView({
  form,
  doc,
  documents,
  docLabels,
  pdfUrl,
  formData,
  aiPrefilledKeys,
  aiPrefilledTablePrefill,
  tableErrors,
  extractionMode,
  doneDocs,
  partialDocs,
  saving,
  queueOpen,
  hasNextDoc,
  showAiToggle,
  reviewerRole,
  currentPage,
  onModeChange,
  onFieldChange,
  onTableChange,
  onSave,
  onSavePartial,
  onSaveAndNext,
  onReset,
  onBack,
  onToggleQueue,
  onSelectDoc,
}: ExtractionViewProps) {
  return (
    <>
      <ExtractionToolbar
        formName={form.form_name}
        docFilename={docLabels[doc.id] ?? documentLabel(doc)}
        extractionMode={extractionMode}
        onModeChange={onModeChange}
        onBack={onBack}
        queueOpen={queueOpen}
        onToggleQueue={onToggleQueue}
        showAiToggle={showAiToggle}
        reviewerRole={reviewerRole}
      />

      <PanelGroup orientation="horizontal" className="gap-0">
        <Panel defaultSize={55} minSize={30}>
          <div
            className="flex flex-col rounded-xl border border-gray-200 dark:border-[#1f1f1f] overflow-hidden bg-white dark:bg-[#111111]"
            style={{ height: 'calc(100vh - 120px)' }}
          >
            {pdfUrl ? (
              <iframe src={`${pdfUrl}${currentPage ? `#page=${currentPage}` : ''}`} className="w-full flex-1 border-0" style={{ height: '100%' }} title="PDF Viewer" />
            ) : (
              <div className="flex-1 flex items-center justify-center text-sm text-gray-400 dark:text-zinc-500">PDF not available</div>
            )}
          </div>
        </Panel>

        <PanelResizeHandle className="w-2 mx-1 flex items-center justify-center group cursor-col-resize">
          <div className="w-1 h-full rounded-full bg-gray-200 dark:bg-[#2a2a2a] group-hover:bg-gray-400 dark:group-hover:bg-zinc-600 transition-colors flex items-center justify-center">
            <GripVertical className="h-4 w-4 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </PanelResizeHandle>

        <Panel defaultSize={45} minSize={25}>
          <div
            className="flex rounded-xl border border-gray-200 dark:border-[#1f1f1f] overflow-hidden bg-white dark:bg-[#111111]"
            style={{ height: 'calc(100vh - 120px)' }}
          >
            {queueOpen && (
              <DocumentQueueSidebar
                documents={documents}
                docLabels={docLabels}
                currentDocId={doc.id}
                doneDocs={doneDocs}
                partialDocs={partialDocs}
                formId={form.id}
                onSelectDoc={onSelectDoc}
              />
            )}

            <div className="flex-1 min-w-0">
              <ExtractionForm
                form={form}
                formData={formData}
                aiPrefilledKeys={aiPrefilledKeys}
                aiPrefilledTablePrefill={aiPrefilledTablePrefill}
                tableErrors={tableErrors}
                onFieldChange={onFieldChange}
                onTableChange={onTableChange}
                onSave={onSave}
                onSavePartial={onSavePartial}
                onSaveAndNext={onSaveAndNext}
                onReset={onReset}
                saving={saving}
                hasNextDoc={hasNextDoc}
              />
            </div>
          </div>
        </Panel>
      </PanelGroup>
    </>
  );
}

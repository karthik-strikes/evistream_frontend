'use client';

import { GripVertical } from 'lucide-react';
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels';
import type { Document, Form } from '@/types/api';
import { ExtractionToolbar, type ExtractionMode } from './ExtractionToolbar';
import { ExtractionForm } from './ExtractionForm';
import { DocumentQueueSidebar } from './DocumentQueueSidebar';

interface ExtractionViewProps {
  form: Form;
  doc: Document;
  documents: Document[];
  pdfUrl: string;
  formData: Record<string, any>;
  aiPrefilledKeys: Set<string>;
  extractionMode: ExtractionMode;
  doneDocs: Set<string>;
  saving: boolean;
  queueOpen: boolean;
  hasNextDoc: boolean;
  showAiToggle: boolean;
  onModeChange: (mode: ExtractionMode) => void;
  onFieldChange: (fieldName: string, value: any) => void;
  onSave: () => void;
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
  pdfUrl,
  formData,
  aiPrefilledKeys,
  extractionMode,
  doneDocs,
  saving,
  queueOpen,
  hasNextDoc,
  showAiToggle,
  onModeChange,
  onFieldChange,
  onSave,
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
        docFilename={doc.filename}
        extractionMode={extractionMode}
        onModeChange={onModeChange}
        onBack={onBack}
        queueOpen={queueOpen}
        onToggleQueue={onToggleQueue}
        showAiToggle={showAiToggle}
      />

      <PanelGroup orientation="horizontal" className="gap-0">
        <Panel defaultSize={55} minSize={30}>
          <div
            className="flex flex-col rounded-xl border border-gray-200 dark:border-[#1f1f1f] overflow-hidden bg-white dark:bg-[#111111]"
            style={{ height: 'calc(100vh - 120px)' }}
          >
            {pdfUrl ? (
              <iframe src={pdfUrl} className="w-full flex-1 border-0" style={{ height: '100%' }} title="PDF Viewer" />
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
            {/* Queue sidebar */}
            {queueOpen && (
              <DocumentQueueSidebar
                documents={documents}
                currentDocId={doc.id}
                doneDocs={doneDocs}
                formId={form.id}
                onSelectDoc={onSelectDoc}
              />
            )}

            {/* Form */}
            <div className="flex-1 min-w-0">
              <ExtractionForm
                form={form}
                formData={formData}
                aiPrefilledKeys={aiPrefilledKeys}
                onFieldChange={onFieldChange}
                onSave={onSave}
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

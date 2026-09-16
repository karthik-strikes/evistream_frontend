'use client';

import dynamic from 'next/dynamic';
import { useRef } from 'react';
import { GripVertical } from 'lucide-react';
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels';
import type { HighlightBoxes, SelectedQuote, SourceMarker } from '@/components/PdfHighlightViewer';

import type { Document, Form } from '@/types/api';
import { ExtractionToolbar, type ExtractionMode } from './ExtractionToolbar';
import { ExtractionForm, type DraftStatus } from './ExtractionForm';
import type { GroupingProps } from './GroupSetupDialog';
import { DocumentQueueSidebar } from './DocumentQueueSidebar';
import type { AiTablePrefill } from '../_lib/fieldKinds';
import type { RowRemap } from '../_lib/rowMoves';
import { documentLabel } from '@/lib/documentLabel';

// pdf.js pulls in a worker and must not be server-rendered — loaded the same way
// /consensus loads it.
const PdfHighlightViewer = dynamic(
  () => import('@/components/PdfHighlightViewer').then(m => m.PdfHighlightViewer),
  {
    ssr: false,
    loading: () => (
      <div className="flex-1 flex items-center justify-center text-xs text-gray-400 dark:text-zinc-500">
        Loading PDF…
      </div>
    ),
  },
);

interface ExtractionViewProps {
  form: Form;
  doc: Document;
  documents: Document[];
  /** Project-wide study IDs. Required, not optional: a child computing its own
   *  map from the filtered `documents` above would silently drop a/b suffixes. */
  docLabels: Record<string, string>;
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
  /** Page to land on, read from the URL. Only the *first* value per document is
   *  handed to the viewer — see `landingPage` below. */
  currentPage?: number | null;
  /** Raised as the reader scrolls, so `?page=` follows them and the link they
   *  copy points at what they were reading. */
  onPageChange?: ((page: number) => void) | undefined;
  /** The saved quote the reviewer asked to see again (chip click). The viewer
   *  locates it in the text layer and draws the highlight; `quotePage` is the
   *  fallback target for a quote it cannot match. */
  quoteText?: string | null;
  quotePage?: number | null;
  /** Set when the quote came off a digitized figure: the picture is the only
   *  honest thing to highlight, so the viewer marks it instead of the prose. */
  quoteFigureImage?: string | null;
  /** Stored rectangles for the quote being shown — a reviewer's own selection or
   *  a box they drew. Drawn as-is, so it works on a scan with no text layer. */
  quoteBoxes?: HighlightBoxes | null;
  /** Passages the model quoted, drawn on the PDF as one-click citations. Empty
   *  in blind mode — see `sourceMarkers` in page.tsx. */
  markers?: SourceMarker[];
  onMarkerClick?: ((keys: string[], quote: SelectedQuote) => void) | undefined;
  markerHint?: string | null;
  /** Box-drawing mode, for figures and scanned pages. */
  regionMode?: boolean;
  onRegionModeChange?: (on: boolean) => void;
  onSelectRegion?: ((region: SelectedQuote) => void) | undefined;
  onModeChange: (mode: ExtractionMode) => void;
  onFieldChange: (fieldName: string, value: any) => void;
  onTableChange: (parentName: string, rows: Array<Record<string, string>>, remap?: RowRemap) => void;
  onSave: () => void;
  /** Background draft-save state, rendered in the form footer. */
  draft: DraftStatus;
  onSaveAndNext: () => void;
  onReset: () => void;
  onBack: () => void;
  onToggleQueue: () => void;
  onSelectDoc: (doc: Document) => void;
  /** Form switching + paper completion, both handed straight to the toolbar. */
  forms?: Form[];
  formStates?: Record<string, 'done' | 'partial' | 'todo'>;
  onSelectForm?: (form: Form) => void;
  paperStatus?: string | null;
  onSetPaperStatus?: ((next: 'completed' | 'in_progress') => void) | undefined;
  settingPaperStatus?: boolean;
  /** Raised when the reviewer confirms a passage selected in the PDF. */
  onSelectQuote?: ((quote: SelectedQuote) => void) | undefined;
  /** The field a captured quote will attach to, shown on the confirm button. */
  selectionTargetLabel?: string | null | undefined;
  /** Column-grouping setup, offered on each table's header. */
  grouping?: GroupingProps;
}

export function ExtractionView({
  form,
  doc,
  documents,
  docLabels,
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
  onPageChange,
  quoteText,
  quotePage,
  quoteFigureImage,
  quoteBoxes,
  markers,
  onMarkerClick,
  markerHint,
  regionMode,
  onRegionModeChange,
  onSelectRegion,
  onModeChange,
  onFieldChange,
  onTableChange,
  onSave,
  draft,
  onSaveAndNext,
  onReset,
  onBack,
  onToggleQueue,
  onSelectDoc,
  onSelectQuote,
  selectionTargetLabel,
  forms,
  formStates,
  onSelectForm,
  paperStatus,
  onSetPaperStatus,
  settingPaperStatus,
  grouping,
}: ExtractionViewProps) {
  // `currentPage` is a deep-link target that now also follows the reader's own
  // scrolling, so feeding the moving value back into the viewer would snap the
  // page to its top mid-sentence (its auto-scroll dedupes on a key that
  // includes `initialPage`). Only the first value for each document goes in.
  const landingDocRef = useRef<string | null>(null);
  const landingPageRef = useRef<number | null>(null);
  if (landingDocRef.current !== doc.id) {
    landingDocRef.current = doc.id;
    landingPageRef.current = currentPage ?? null;
  }

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
        forms={forms}
        formStates={formStates}
        onSelectForm={onSelectForm}
        paperStatus={paperStatus}
        onSetPaperStatus={onSetPaperStatus}
        settingPaperStatus={settingPaperStatus}
      />

      <PanelGroup orientation="horizontal" className="gap-0">
        {/* The form starts with the larger share. A twenty-column table read in
            a 45% pane is the congestion complaint; the PDF, being one column of
            prose, survives 42% intact — and the divider still hands it back. */}
        <Panel defaultSize={42} minSize={22}>
          <div
            className="flex flex-col rounded-xl border border-gray-200 dark:border-[#1f1f1f] overflow-hidden bg-white dark:bg-[#111111]"
            style={{ height: 'calc(100vh - 120px)' }}
          >
            {/* pdf.js, not an <iframe>. The iframe used the browser's native PDF
                plugin, whose text selection is unreachable from this page — so a
                reviewer could not point at the passage their value came from.
                This is the same viewer /consensus uses, which also brings the
                figure highlighting and page jump along with it. */}
            <PdfHighlightViewer
              documentId={doc.id}
              filename={docLabels[doc.id] ?? documentLabel(doc)}
              sourceText={quoteText ?? null}
              figureImage={quoteFigureImage ?? null}
              highlightBoxes={quoteBoxes ?? null}
              initialPage={quotePage ?? landingPageRef.current ?? null}
              onVisiblePageChange={onPageChange}
              regionMode={regionMode}
              onRegionModeChange={onRegionModeChange}
              onSelectRegion={onSelectRegion}
              onSelectQuote={onSelectQuote}
              markers={markers}
              onMarkerClick={onMarkerClick}
              markerHint={markerHint ?? null}
              selectionTargetLabel={selectionTargetLabel ?? null}
            />
          </div>
        </Panel>

        <PanelResizeHandle className="w-2 mx-1 flex items-center justify-center group cursor-col-resize">
          <div className="w-1 h-full rounded-full bg-gray-200 dark:bg-[#2a2a2a] group-hover:bg-gray-400 dark:group-hover:bg-zinc-600 transition-colors flex items-center justify-center">
            <GripVertical className="h-4 w-4 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </PanelResizeHandle>

        <Panel defaultSize={58} minSize={30}>
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
                draft={draft}
                onSaveAndNext={onSaveAndNext}
                onReset={onReset}
                saving={saving}
                hasNextDoc={hasNextDoc}
                grouping={grouping}
              />
            </div>
          </div>
        </Panel>
      </PanelGroup>
    </>
  );
}

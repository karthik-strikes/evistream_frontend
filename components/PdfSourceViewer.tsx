'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { X, ChevronLeft, ChevronRight, Maximize2, Minimize2, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PdfHighlight {
  page: number;
  fieldName: string;
  matchedText: string;
}

interface PdfSourceViewerProps {
  /** Presigned S3 URL for the PDF */
  pdfUrl: string | null;
  /** Document filename for display */
  filename?: string;
  /** Active highlight to scroll to */
  activeHighlight?: { page: number; fieldName: string; matchedText: string } | null;
  /** All highlights to show in page indicator */
  highlights?: PdfHighlight[];
  /** Called when user closes the viewer */
  onClose?: () => void;
  /** Called when the active field highlight should clear */
  onClearHighlight?: () => void;
}

/**
 * PDF viewer with page navigation and source highlight indicators.
 *
 * Uses an <iframe> to render the PDF (browser-native rendering).
 * Shows page-level indicators for which fields were extracted from each page.
 */
export function PdfSourceViewer({
  pdfUrl,
  filename,
  activeHighlight,
  highlights = [],
  onClose,
  onClearHighlight,
}: PdfSourceViewerProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState<number | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  // Navigate to page when active highlight changes
  useEffect(() => {
    if (activeHighlight?.page && iframeRef.current && pdfUrl) {
      setCurrentPage(activeHighlight.page);
      // Use PDF.js page parameter for browser PDF viewers
      const pageUrl = `${pdfUrl}#page=${activeHighlight.page}`;
      if (iframeRef.current.src !== pageUrl) {
        iframeRef.current.src = pageUrl;
      }
    }
  }, [activeHighlight, pdfUrl]);

  const goToPage = useCallback((page: number) => {
    if (page < 1) return;
    setCurrentPage(page);
    if (iframeRef.current && pdfUrl) {
      iframeRef.current.src = `${pdfUrl}#page=${page}`;
    }
  }, [pdfUrl]);

  // Get fields extracted from the current page
  const fieldsOnCurrentPage = highlights.filter(h => h.page === currentPage);

  // Pages that have highlights
  const highlightedPages = new Set(highlights.map(h => h.page));

  if (!pdfUrl) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-gray-50 dark:bg-[#0a0a0a] rounded-lg border border-gray-200 dark:border-[#1f1f1f] p-8">
        <FileText className="w-10 h-10 text-gray-300 dark:text-zinc-700 mb-3" />
        <p className="text-sm text-gray-400 dark:text-zinc-600">No PDF available</p>
      </div>
    );
  }

  return (
    <div className={cn(
      'flex flex-col bg-white dark:bg-[#111111] border border-gray-200 dark:border-[#1f1f1f] rounded-xl overflow-hidden',
      isExpanded ? 'fixed inset-4 z-50 shadow-2xl' : 'h-full'
    )}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-[#0a0a0a] border-b border-gray-200 dark:border-[#1f1f1f]">
        <FileText className="w-3.5 h-3.5 text-gray-400 dark:text-zinc-600 flex-shrink-0" />
        <span className="text-xs font-medium text-gray-700 dark:text-zinc-300 truncate flex-1">
          {filename || 'PDF Viewer'}
        </span>

        {/* Page navigation */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => goToPage(currentPage - 1)}
            disabled={currentPage <= 1}
            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-[#1f1f1f] disabled:opacity-30 transition-colors"
          >
            <ChevronLeft className="w-3.5 h-3.5 text-gray-600 dark:text-zinc-400" />
          </button>
          <span className="text-xs font-mono text-gray-600 dark:text-zinc-400 min-w-[40px] text-center">
            {currentPage}{totalPages ? ` / ${totalPages}` : ''}
          </span>
          <button
            onClick={() => goToPage(currentPage + 1)}
            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-[#1f1f1f] transition-colors"
          >
            <ChevronRight className="w-3.5 h-3.5 text-gray-600 dark:text-zinc-400" />
          </button>
        </div>

        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="p-1 rounded hover:bg-gray-200 dark:hover:bg-[#1f1f1f] transition-colors"
        >
          {isExpanded
            ? <Minimize2 className="w-3.5 h-3.5 text-gray-500 dark:text-zinc-500" />
            : <Maximize2 className="w-3.5 h-3.5 text-gray-500 dark:text-zinc-500" />
          }
        </button>

        {onClose && (
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-[#1f1f1f] transition-colors"
          >
            <X className="w-3.5 h-3.5 text-gray-500 dark:text-zinc-500" />
          </button>
        )}
      </div>

      {/* Active highlight banner */}
      {activeHighlight && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 dark:bg-blue-900/20 border-b border-blue-100 dark:border-blue-900/40">
          <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse flex-shrink-0" />
          <span className="text-xs text-blue-700 dark:text-blue-300 font-medium truncate">
            Showing source for: {activeHighlight.fieldName.replace(/_/g, ' ').replace(/\./g, ' ')}
          </span>
          {onClearHighlight && (
            <button onClick={onClearHighlight} className="ml-auto flex-shrink-0">
              <X className="w-3 h-3 text-blue-400 hover:text-blue-600 dark:hover:text-blue-200" />
            </button>
          )}
        </div>
      )}

      {/* PDF iframe */}
      <div className="flex-1 relative min-h-0">
        <iframe
          ref={iframeRef}
          src={`${pdfUrl}#page=${currentPage}`}
          className="w-full h-full border-0"
          title="PDF Document"
        />
      </div>

      {/* Footer: fields on current page */}
      {fieldsOnCurrentPage.length > 0 && (
        <div className="px-3 py-2 bg-gray-50 dark:bg-[#0a0a0a] border-t border-gray-200 dark:border-[#1f1f1f]">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-600 mb-1">
            Fields from this page
          </div>
          <div className="flex flex-wrap gap-1">
            {fieldsOnCurrentPage.map(h => (
              <span
                key={h.fieldName}
                className={cn(
                  'text-[10px] px-2 py-0.5 rounded-full border transition-colors',
                  activeHighlight?.fieldName === h.fieldName
                    ? 'bg-blue-100 dark:bg-blue-900/30 border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300 font-semibold'
                    : 'bg-gray-100 dark:bg-[#1a1a1a] border-gray-200 dark:border-[#2a2a2a] text-gray-600 dark:text-zinc-400'
                )}
              >
                {h.fieldName.replace(/_/g, ' ').replace(/\./g, ' ')}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Page dots indicator */}
      {highlights.length > 0 && (
        <div className="px-3 py-1.5 border-t border-gray-200 dark:border-[#1f1f1f] flex items-center gap-1 overflow-x-auto">
          <span className="text-[9px] text-gray-400 dark:text-zinc-600 font-medium mr-1 flex-shrink-0">Pages:</span>
          {Array.from(highlightedPages).sort((a, b) => a - b).map(page => (
            <button
              key={page}
              onClick={() => goToPage(page)}
              className={cn(
                'w-5 h-5 rounded text-[9px] font-bold flex items-center justify-center transition-colors flex-shrink-0',
                page === currentPage
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-100 dark:bg-[#1a1a1a] text-gray-600 dark:text-zinc-400 hover:bg-gray-200 dark:hover:bg-[#2a2a2a]'
              )}
            >
              {page}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

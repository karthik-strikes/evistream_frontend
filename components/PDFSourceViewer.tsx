'use client';

import React, { useState } from 'react';
import { Card } from '@/components/ui';
import { FileText, AlertCircle, ZoomIn, ZoomOut } from 'lucide-react';
import Image from 'next/image';

interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
  page: number;
}

interface PDFSourceViewerProps {
  documentId: string;
  documentName: string;
  activeBbox: BoundingBox | null;
  activeFieldName: string | null;
  pdfPageImages: string[]; // Array of image URLs for each page
}

export function PDFSourceViewer({
  documentId,
  documentName,
  activeBbox,
  activeFieldName,
  pdfPageImages,
}: PDFSourceViewerProps) {
  const [zoom, setZoom] = useState(100);
  const [currentPage, setCurrentPage] = useState(activeBbox?.page || 1);

  // Update current page when activeBbox changes
  React.useEffect(() => {
    if (activeBbox && activeBbox.page) {
      setCurrentPage(activeBbox.page);
    }
  }, [activeBbox]);

  if (!pdfPageImages || pdfPageImages.length === 0) {
    return (
      <Card className="h-full flex items-center justify-center p-8">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 text-gray-400 mx-auto mb-3" />
          <p className="text-gray-600">PDF preview not available</p>
          <p className="text-sm text-gray-500 mt-1">
            Document: {documentName}
          </p>
        </div>
      </Card>
    );
  }

  const currentPageImage = pdfPageImages[currentPage - 1];

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-gray-500" />
          <span className="text-sm font-medium text-gray-900 truncate max-w-md">
            {documentName}
          </span>
        </div>

        <div className="flex items-center gap-4">
          {/* Page Navigation */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
              className="px-2 py-1 text-sm border rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <span className="text-sm text-gray-600">
              Page {currentPage} of {pdfPageImages.length}
            </span>
            <button
              onClick={() => setCurrentPage(Math.min(pdfPageImages.length, currentPage + 1))}
              disabled={currentPage === pdfPageImages.length}
              className="px-2 py-1 text-sm border rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>

          {/* Zoom Controls */}
          <div className="flex items-center gap-2 border-l pl-4">
            <button
              onClick={() => setZoom(Math.max(50, zoom - 25))}
              className="p-1 hover:bg-gray-100 rounded"
              title="Zoom out"
            >
              <ZoomOut className="h-4 w-4" />
            </button>
            <span className="text-sm text-gray-600 min-w-[4rem] text-center">
              {zoom}%
            </span>
            <button
              onClick={() => setZoom(Math.min(200, zoom + 25))}
              className="p-1 hover:bg-gray-100 rounded"
              title="Zoom in"
            >
              <ZoomIn className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Active Field Indicator */}
      {activeFieldName && activeBbox && (
        <div className="bg-yellow-50 border-b border-yellow-200 px-4 py-2">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 bg-yellow-500 rounded-full animate-pulse" />
            <span className="text-sm font-medium text-yellow-900">
              Showing source for: {activeFieldName}
            </span>
            {activeBbox.page && (
              <span className="text-xs text-yellow-700">
                (Page {activeBbox.page})
              </span>
            )}
          </div>
        </div>
      )}

      {/* PDF Page with Overlay */}
      <div className="flex-1 overflow-auto p-6 bg-gray-100">
        <div className="max-w-4xl mx-auto">
          <div
            className="relative bg-white shadow-lg"
            style={{
              transform: `scale(${zoom / 100})`,
              transformOrigin: 'top center',
              transition: 'transform 0.2s ease'
            }}
          >
            {/* PDF Page Image */}
            <img
              src={currentPageImage}
              alt={`Page ${currentPage}`}
              className="w-full h-auto"
              style={{ display: 'block' }}
            />

            {/* Bounding Box Overlay */}
            {activeBbox && activeBbox.page === currentPage && (
              <div
                className="absolute border-4 border-yellow-400 bg-yellow-200/30 pointer-events-none animate-pulse"
                style={{
                  left: `${activeBbox.x}%`,
                  top: `${activeBbox.y}%`,
                  width: `${activeBbox.width}%`,
                  height: `${activeBbox.height}%`,
                  boxShadow: '0 0 0 2px white, 0 0 20px rgba(251, 191, 36, 0.5)',
                }}
              />
            )}
          </div>

          {/* No highlight message */}
          {!activeBbox && (
            <div className="text-center py-8 text-gray-500">
              <p className="text-sm">Click any cell in the table to view its source in the PDF</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

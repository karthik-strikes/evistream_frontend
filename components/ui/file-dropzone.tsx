'use client';

import { useCallback, useState } from 'react';
import { Upload, File, X, CheckCircle2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './button';
import { Progress } from './progress';

interface FileWithPreview extends File {
  preview?: string;
}

interface FileDropzoneProps {
  onFilesSelected: (files: File[]) => void;
  accept?: string;
  maxSize?: number;
  maxFiles?: number;
  multiple?: boolean;
  className?: string;
  disabled?: boolean;
}

export function FileDropzone({
  onFilesSelected,
  accept = '*/*',
  maxSize = 10 * 1024 * 1024, // 10MB
  maxFiles = 1,
  multiple = false,
  className,
  disabled = false,
}: FileDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragIn = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  }, []);

  const handleDragOut = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      setError(null);

      if (disabled) return;

      const files = Array.from(e.dataTransfer.files);

      if (files.length > maxFiles) {
        setError(`Maximum ${maxFiles} file${maxFiles > 1 ? 's' : ''} allowed`);
        return;
      }
      for (const file of files) {
        if (file.size > maxSize) {
          setError(`File size must be less than ${(maxSize / 1024 / 1024).toFixed(0)}MB`);
          return;
        }
      }

      onFilesSelected(files);
    },
    [disabled, maxFiles, maxSize, onFilesSelected]
  );

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);

    if (!e.target.files) return;

    const files = Array.from(e.target.files);

    if (files.length > maxFiles) {
      setError(`Maximum ${maxFiles} file${maxFiles > 1 ? 's' : ''} allowed`);
      return;
    }
    for (const file of files) {
      if (file.size > maxSize) {
        setError(`File size must be less than ${(maxSize / 1024 / 1024).toFixed(0)}MB`);
        return;
      }
    }

    onFilesSelected(files);
  };

  return (
    <div className={cn('relative', className)}>
      <div
        onDragEnter={handleDragIn}
        onDragLeave={handleDragOut}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        className={cn(
          'relative border-2 border-dashed rounded-lg p-8 text-center transition-colors',
          isDragging
            ? 'border-zinc-400 bg-zinc-50'
            : 'border-gray-300 hover:border-gray-400',
          disabled && 'opacity-50 cursor-not-allowed',
          error && 'border-red-300 bg-red-50'
        )}
      >
        <input
          type="file"
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
          onChange={handleFileInput}
          accept={accept}
          multiple={multiple}
          disabled={disabled}
        />

        <div className="flex flex-col items-center gap-2">
          <div
            className={cn(
              'rounded-full p-3',
              error
                ? 'bg-red-100'
                : isDragging
                ? 'bg-zinc-100'
                : 'bg-gray-100'
            )}
          >
            {error ? (
              <AlertCircle className="h-8 w-8 text-red-600" />
            ) : (
              <Upload
                className={cn(
                  'h-8 w-8',
                  isDragging ? 'text-zinc-700' : 'text-gray-600'
                )}
              />
            )}
          </div>

          <div className="space-y-1">
            <p className="text-sm font-medium text-gray-700">
              {isDragging
                ? 'Drop files here'
                : 'Drag & drop files here, or click to select'}
            </p>
            <p className="text-xs text-gray-500">
              {accept !== '*/*' && `Accepted: ${accept}`}
              {maxSize && ` • Max size: ${(maxSize / 1024 / 1024).toFixed(0)}MB`}
              {maxFiles > 1 && ` • Max files: ${maxFiles}`}
            </p>
          </div>

          {error && (
            <p className="text-sm text-red-600 mt-2">{error}</p>
          )}
        </div>
      </div>
    </div>
  );
}

// File list component to show selected files
export function FileList({
  files,
  onRemove,
  uploadProgress,
}: {
  files: File[];
  onRemove?: (index: number) => void;
  uploadProgress?: Record<string, number>;
}) {
  return (
    <div className="space-y-2">
      {files.map((file, index) => {
        const progress = uploadProgress?.[file.name];
        const isUploading = progress !== undefined && progress < 100;
        const isComplete = progress === 100;

        return (
          <div
            key={`${file.name}-${index}`}
            className="flex items-center gap-3 p-3 border border-border rounded-lg bg-white"
          >
            <div
              className={cn(
                'flex-shrink-0 rounded p-2',
                isComplete
                  ? 'bg-green-100'
                  : isUploading
                  ? 'bg-zinc-100'
                  : 'bg-gray-100'
              )}
            >
              {isComplete ? (
                <CheckCircle2 className="h-5 w-5 text-green-600" />
              ) : (
                <File className="h-5 w-5 text-gray-600" />
              )}
            </div>

            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">
                {file.name}
              </p>
              <p className="text-xs text-gray-500">
                {(file.size / 1024).toFixed(1)} KB
              </p>
              {isUploading && (
                <Progress value={progress} className="mt-1 h-1" />
              )}
            </div>

            {onRemove && !isUploading && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onRemove(index)}
                className="flex-shrink-0"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}

'use client';

import { ArrowLeft, EyeOff, Sparkles, PanelLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ExtractionMode = 'blind' | 'ai_assisted';

interface ExtractionToolbarProps {
  formName: string;
  docFilename: string;
  extractionMode: ExtractionMode;
  onModeChange: (mode: ExtractionMode) => void;
  onBack: () => void;
  queueOpen: boolean;
  onToggleQueue: () => void;
  showAiToggle: boolean;
}

export function ExtractionToolbar({
  formName,
  docFilename,
  extractionMode,
  onModeChange,
  onBack,
  queueOpen,
  onToggleQueue,
  showAiToggle,
}: ExtractionToolbarProps) {
  return (
    <div className="flex items-center gap-2 mb-3 flex-wrap">
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200 bg-transparent border-none cursor-pointer transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Back
      </button>

      <span className="text-gray-300 dark:text-zinc-700 text-xs">·</span>
      <span className="text-xs font-medium text-gray-500 dark:text-zinc-400 bg-gray-100 dark:bg-[#1a1a1a] px-2 py-0.5 rounded-md">{formName}</span>
      <span className="text-gray-300 dark:text-zinc-700 text-xs">·</span>
      <span className="text-xs font-medium text-gray-500 dark:text-zinc-400 bg-gray-100 dark:bg-[#1a1a1a] px-2 py-0.5 rounded-md truncate max-w-[220px]">{docFilename}</span>

      <div className="ml-auto flex items-center gap-2">
        {/* Queue toggle */}
        <button
          onClick={onToggleQueue}
          className={cn(
            "flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md border cursor-pointer transition-colors",
            queueOpen
              ? "text-gray-800 dark:text-zinc-200 bg-gray-100 dark:bg-[#1f1f1f] border-gray-300 dark:border-[#3a3a3a]"
              : "text-gray-500 dark:text-zinc-400 bg-transparent border-gray-200 dark:border-[#2a2a2a] hover:bg-gray-50 dark:hover:bg-[#1a1a1a]"
          )}
        >
          <PanelLeft className="w-3 h-3" />
          Queue
        </button>

        {/* AI mode toggle — only shown when AI results exist */}
        {showAiToggle && (
          <div className="flex items-center rounded-lg border border-gray-200 dark:border-[#2a2a2a] overflow-hidden">
            <button
              onClick={() => onModeChange('blind')}
              className={cn(
                "flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 cursor-pointer transition-colors border-none",
                extractionMode === 'blind'
                  ? "bg-gray-900 dark:bg-zinc-100 text-white dark:text-gray-900"
                  : "bg-white dark:bg-[#111111] text-gray-500 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-[#1a1a1a]"
              )}
            >
              <EyeOff className="w-3 h-3" />
              Blind
            </button>
            <button
              onClick={() => onModeChange('ai_assisted')}
              className={cn(
                "flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 cursor-pointer transition-colors border-none",
                extractionMode === 'ai_assisted'
                  ? "bg-gray-900 dark:bg-zinc-100 text-white dark:text-gray-900"
                  : "bg-white dark:bg-[#111111] text-gray-500 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-[#1a1a1a]"
              )}
            >
              <Sparkles className="w-3 h-3" />
              AI Assisted
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

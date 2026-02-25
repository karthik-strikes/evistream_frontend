import React from 'react';
import { Logo } from '@/components/ui';

export function TypingIndicator() {
  return (
    <div className="flex gap-3 mb-5 animate-reveal-fade-up">
      <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-white flex items-center justify-center border border-gray-200">
        <Logo size={20} />
      </div>

      <div className="flex flex-col items-start">
        <div className="bg-white border border-gray-200 rounded-2xl px-4 py-3 shadow-sm">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
            <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
            <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
        </div>
        <span className="text-xs text-gray-400 font-medium mt-1.5 px-1">
          Analyzing papers...
        </span>
      </div>
    </div>
  );
}

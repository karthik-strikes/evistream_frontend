import React from 'react';
import { Lightbulb } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SuggestedQuestionsProps {
  questions: string[];
  onSelect: (question: string) => void;
  disabled?: boolean;
}

export function SuggestedQuestions({ questions, onSelect, disabled }: SuggestedQuestionsProps) {
  if (questions.length === 0) return null;

  return (
    <div className="px-6 py-4 border-t border-gray-100 bg-gradient-to-b from-white to-gray-50">
      <div className="flex items-center gap-2 mb-3">
        <Lightbulb className="h-4 w-4 text-amber-500" />
        <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
          Suggested Questions
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {questions.map((question, index) => (
          <button
            key={index}
            onClick={() => onSelect(question)}
            disabled={disabled}
            className={cn(
              'px-4 py-2 rounded-xl text-sm bg-white border border-gray-200',
              'hover:border-gray-300 hover:shadow-md transition-all duration-200',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              'text-gray-700 hover:text-gray-900 font-medium'
            )}
          >
            {question}
          </button>
        ))}
      </div>
    </div>
  );
}

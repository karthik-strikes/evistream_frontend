import React, { useState } from 'react';
import { cn } from '@/lib/utils';
import { Copy, CheckCheck, Sparkles, User } from 'lucide-react';
import { Logo } from '@/components/ui';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  paperIds?: string[];
  isStreaming?: boolean;
}

interface MessageBubbleProps {
  message: Message;
  isLatest?: boolean;
}

export function MessageBubble({ message, isLatest }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className={cn(
        'flex gap-3 mb-5 group animate-reveal-fade-up',
        isUser ? 'justify-end' : 'justify-start'
      )}
    >
      {!isUser && (
        <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-white flex items-center justify-center border border-gray-200">
          <Logo size={20} />
        </div>
      )}

      <div className={cn('flex flex-col max-w-[80%]', isUser ? 'items-end' : 'items-start')}>
        <div
          className={cn(
            'relative rounded-2xl px-4 py-3 text-[15px] leading-relaxed transition-all duration-200',
            isUser
              ? 'bg-gray-900 text-white'
              : 'bg-white text-gray-900 border border-gray-200 shadow-sm hover:shadow-md'
          )}
        >
          {!isUser && !message.isStreaming && (
            <button
              onClick={handleCopy}
              className="absolute -top-2 -right-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-white rounded-lg p-1.5 shadow-md border border-gray-200 hover:bg-gray-50"
            >
              {copied ? (
                <CheckCheck className="h-3.5 w-3.5 text-green-600" />
              ) : (
                <Copy className="h-3.5 w-3.5 text-gray-600" />
              )}
            </button>
          )}

          <div className="whitespace-pre-wrap break-words">
            {message.content}
            {message.isStreaming && (
              <span className="inline-block w-1.5 h-4 bg-current ml-1 animate-pulse" />
            )}
          </div>

          {!isUser && message.paperIds && message.paperIds.length > 0 && (
            <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-gray-200">
              <Sparkles className="h-3 w-3 text-gray-400" />
              <span className="text-xs text-gray-500">
                Based on {message.paperIds.length} paper{message.paperIds.length > 1 ? 's' : ''}
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 mt-1.5 px-1">
          <span className="text-xs text-gray-400 font-medium">
            {message.timestamp.toLocaleTimeString('en-US', {
              hour: 'numeric',
              minute: '2-digit',
            })}
          </span>
        </div>
      </div>

      {isUser && (
        <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center border border-gray-200">
          <User className="h-4 w-4 text-gray-600" />
        </div>
      )}
    </div>
  );
}

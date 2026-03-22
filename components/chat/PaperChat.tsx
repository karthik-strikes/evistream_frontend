'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui';
import { Send, Sparkles, RotateCcw } from 'lucide-react';
import { MessageBubble, type Message } from './MessageBubble';
import { SuggestedQuestions } from './SuggestedQuestions';
import { TypingIndicator } from './TypingIndicator';
import type { Document } from '@/types/api';
import { cn } from '@/lib/utils';

interface PaperChatProps {
  documents: Document[];
  selectedDocIds: string[];
}

const SUGGESTED_QUESTIONS = [
  "Summarize the key findings across all papers",
  "What are the patient populations studied?",
  "Compare the methodologies used",
  "What are the main outcomes reported?",
];

export function PaperChat({ documents, selectedDocIds }: PaperChatProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content: 'Hello! I\'m your AI research assistant. Select papers from the header above to include them in our conversation, then ask me anything about them.',
      timestamp: new Date(),
    },
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [showSuggestions, setShowSuggestions] = useState(true);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (!isLoading) {
      inputRef.current?.focus();
    }
  }, [isLoading]);

  const simulateTypingResponse = (text: string, paperIds: string[]): Promise<void> => {
    return new Promise((resolve) => {
      const words = text.split(' ');
      let currentText = '';
      let wordIndex = 0;

      const assistantMessageId = Date.now().toString();

      const interval = setInterval(() => {
        if (wordIndex < words.length) {
          currentText += (wordIndex > 0 ? ' ' : '') + words[wordIndex];

          setMessages(prev => {
            const existing = prev.find(m => m.id === assistantMessageId);
            if (existing) {
              return prev.map(m =>
                m.id === assistantMessageId
                  ? { ...m, content: currentText, isStreaming: true }
                  : m
              );
            } else {
              return [
                ...prev,
                {
                  id: assistantMessageId,
                  role: 'assistant' as const,
                  content: currentText,
                  timestamp: new Date(),
                  paperIds: paperIds,
                  isStreaming: true,
                },
              ];
            }
          });

          wordIndex++;
        } else {
          setMessages(prev =>
            prev.map(m =>
              m.id === assistantMessageId
                ? { ...m, isStreaming: false }
                : m
            )
          );
          clearInterval(interval);
          resolve();
        }
      }, 40);
    });
  };

  const getMockResponse = (userMessage: string): string => {
    const lowerMessage = userMessage.toLowerCase();

    if (selectedDocIds.length === 0) {
      return "Please select papers from the header above to include them in our conversation. This will help me provide accurate and relevant answers based on your specific research documents.";
    }

    if (lowerMessage.includes('summary') || lowerMessage.includes('summarize')) {
      return `I'm analyzing ${selectedDocIds.length} paper${selectedDocIds.length > 1 ? 's' : ''} to provide you with a comprehensive summary.\n\nOnce connected to the backend, I'll extract and synthesize:\n\n• Key research questions and objectives\n• Primary findings and results\n• Methodological approaches\n• Limitations and future directions\n• Common themes across papers\n\nThe summary will be powered by your DSPy extraction pipeline combined with semantic analysis.`;
    }

    if (lowerMessage.includes('patient') || lowerMessage.includes('population')) {
      return `Based on the ${selectedDocIds.length} paper${selectedDocIds.length > 1 ? 's' : ''} in context, I would analyze:\n\n• **Demographics**: Age ranges, gender distribution, ethnicity\n• **Sample Sizes**: Number of participants per study\n• **Inclusion/Exclusion Criteria**: Who qualified for each study\n• **Clinical Characteristics**: Disease stage, comorbidities, etc.\n• **Geographic Distribution**: Where studies were conducted\n\nThis analysis will combine your extracted structured data with natural language understanding.`;
    }

    if (lowerMessage.includes('outcome') || lowerMessage.includes('result')) {
      return `I would compare outcomes across the selected papers:\n\n• **Primary Outcomes**: Main endpoints measured\n• **Secondary Outcomes**: Additional measures\n• **Statistical Significance**: P-values, confidence intervals\n• **Effect Sizes**: Clinical meaningfulness\n• **Adverse Events**: Safety data\n• **Follow-up Duration**: Time periods studied\n\nI'll cross-reference these with your extraction results to ensure accuracy.`;
    }

    if (lowerMessage.includes('compare') || lowerMessage.includes('difference')) {
      return `Great question! I can perform comprehensive comparisons:\n\n**Study Design**: RCT vs observational, cohort types\n**Interventions**: Treatments, dosages, durations\n**Outcomes Measured**: What each study tracked\n**Risk of Bias**: Quality assessment findings\n**Results**: How findings align or differ\n\nWith ${selectedDocIds.length} papers selected, I'll highlight both commonalities and key differences.`;
    }

    if (lowerMessage.includes('method')) {
      return `I'll analyze the methodological approaches:\n\n• **Study Design**: Randomized trials, cohort studies, case-control\n• **Blinding**: Single, double, open-label\n• **Randomization**: Methods and allocation\n• **Sample Size Calculation**: Power analysis details\n• **Statistical Methods**: Tests used, adjustments made\n• **Data Collection**: Instruments, timing, procedures\n\nThis leverages both structured extraction and full-text analysis.`;
    }

    return `Excellent question! Once integrated with your backend, I'll be able to:\n\n✨ **Query Extracted Data**: Access all fields from your DSPy pipeline\n🔍 **Semantic Search**: Find relevant sections across papers\n📊 **Compare Studies**: Side-by-side analysis of multiple papers\n✓ **Verify Results**: Cross-check extraction accuracy\n💡 **Deep Insights**: Connect findings across your corpus\n\nCurrently analyzing ${selectedDocIds.length} paper${selectedDocIds.length > 1 ? 's' : ''} in this conversation.`;
  };

  const handleSend = async (question?: string) => {
    const messageText = question || inputValue.trim();
    if (!messageText || isLoading) return;

    setShowSuggestions(false);

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: messageText,
      timestamp: new Date(),
      paperIds: selectedDocIds,
    };

    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);

    await new Promise(resolve => setTimeout(resolve, 1000));

    const responseText = getMockResponse(messageText);
    await simulateTypingResponse(responseText, selectedDocIds);

    setIsLoading(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleReset = () => {
    setMessages([
      {
        id: Date.now().toString(),
        role: 'assistant',
        content: 'Hello! I\'m your AI research assistant. Select papers from the header above to include them in our conversation.',
        timestamp: new Date(),
      },
    ]);
    setShowSuggestions(true);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] bg-white dark:bg-[#0a0a0a]">
      <div className="flex-1 overflow-y-auto px-8 py-6 bg-gray-50 dark:bg-[#050505]">
        <div className="max-w-5xl mx-auto">
          {messages.map((message, index) => (
            <MessageBubble
              key={message.id}
              message={message}
              isLatest={index === messages.length - 1}
            />
          ))}
          {isLoading && <TypingIndicator />}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {showSuggestions && messages.length <= 2 && (
        <SuggestedQuestions
          questions={SUGGESTED_QUESTIONS}
          onSelect={handleSend}
          disabled={isLoading}
        />
      )}

      <div className="border-t border-gray-200 bg-white px-8 py-4 dark:border-[#222] dark:bg-[#0a0a0a]">
        <div className="max-w-5xl mx-auto">
          <div className="flex gap-3 items-end">
            <Button
              onClick={handleReset}
              variant="ghost"
              size="icon"
              className="flex-shrink-0 h-11 w-11 rounded-xl hover:bg-gray-100 dark:hover:bg-[#1a1a1a]"
              title="Reset conversation"
            >
              <RotateCcw className="h-5 w-5 text-gray-600 dark:text-zinc-400" />
            </Button>

            <div className="flex-1 relative">
              <textarea
                ref={inputRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  selectedDocIds.length > 0
                    ? "Ask anything about the selected papers..."
                    : "Select papers from header to start chatting..."
                }
                disabled={isLoading}
                rows={1}
                className={cn(
                  'w-full resize-none rounded-xl border border-gray-300 bg-white px-4 py-3 pr-12',
                  'dark:bg-[#111111] dark:border-[#2a2a2a] dark:text-[#e8e8e8] dark:placeholder:text-zinc-500',
                  'text-sm placeholder:text-gray-400 transition-all duration-200',
                  'focus:border-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-opacity-5',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                  'max-h-32 overflow-y-auto'
                )}
                style={{
                  height: 'auto',
                  minHeight: '44px',
                }}
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement;
                  target.style.height = 'auto';
                  target.style.height = Math.min(target.scrollHeight, 128) + 'px';
                }}
              />
            </div>

            <Button
              onClick={() => handleSend()}
              disabled={!inputValue.trim() || isLoading}
              size="icon"
              className={cn(
                'flex-shrink-0 h-11 w-11 rounded-xl transition-all duration-200',
                inputValue.trim() && !isLoading
                  ? 'bg-gray-900 hover:bg-gray-800 hover:shadow-lg hover:scale-105'
                  : ''
              )}
            >
              {isLoading ? (
                <Sparkles className="h-5 w-5 animate-pulse" />
              ) : (
                <Send className="h-5 w-5" />
              )}
            </Button>
          </div>

          <p className="text-xs text-gray-400 mt-2.5 text-center">
            Demo mode • Press <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-300 rounded text-xs">Enter</kbd> to send • <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-300 rounded text-xs">Shift+Enter</kbd> for new line
          </p>
        </div>
      </div>
    </div>
  );
}

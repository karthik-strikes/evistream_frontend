'use client';

import { useState, useRef, useEffect } from 'react';
import { Copy, Check } from 'lucide-react';
import { Button } from './button';
import { useToast } from '@/hooks/use-toast';

interface CopyButtonProps {
  text: string;
  label?: string;
  showLabel?: boolean;
  variant?: 'default' | 'ghost' | 'secondary';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function CopyButton({
  text,
  label,
  showLabel = false,
  variant = 'ghost',
  size = 'sm',
  className,
}: CopyButtonProps) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleCopy = async () => {
    try {
      if (!navigator?.clipboard) {
        throw new Error('Clipboard API not available');
      }
      await navigator.clipboard.writeText(text);
      setCopied(true);

      toast({
        title: 'Copied!',
        description: label ? `${label} copied to clipboard` : 'Copied to clipboard',
        variant: 'success',
      });

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to copy to clipboard',
        variant: 'error',
      });
    }
  };

  return (
    <Button
      variant={variant}
      size={size}
      onClick={handleCopy}
      className={className}
      title={`Copy ${label || 'text'}`}
    >
      {copied ? (
        <Check className="h-4 w-4 text-green-600" />
      ) : (
        <Copy className="h-4 w-4" />
      )}
      {showLabel && (
        <span className="ml-2">
          {copied ? 'Copied!' : label || 'Copy'}
        </span>
      )}
    </Button>
  );
}

// Inline copy button for IDs
export function CopyID({ id, label }: { id: string; label?: string }) {
  return (
    <div className="inline-flex items-center gap-2 px-2 py-1 bg-gray-100 rounded font-mono text-xs">
      <span className="text-gray-600">{label || 'ID'}:</span>
      <span className="text-gray-900">{id.slice(0, 8)}...</span>
      <CopyButton text={id} label={label || 'ID'} size="sm" className="h-5 w-5 p-0" />
    </div>
  );
}

// Copy code block
export function CopyCodeBlock({ code, language }: { code: string; language?: string }) {
  return (
    <div className="relative group">
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <CopyButton text={code} label="Code" variant="secondary" />
      </div>
      <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto">
        <code className={`language-${language || 'text'}`}>{code}</code>
      </pre>
    </div>
  );
}

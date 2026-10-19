'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  className?: string;
  delay?: number;
}

export function Tooltip({
  content,
  children,
  side = 'top',
  align = 'center',
  className,
  delay = 200,
}: TooltipProps) {
  const [isVisible, setIsVisible] = React.useState(false);
  const [coords, setCoords] = React.useState<{ top: number; left: number } | null>(null);
  const triggerRef = React.useRef<HTMLDivElement>(null);
  const tooltipRef = React.useRef<HTMLDivElement>(null);
  const timeoutRef = React.useRef<NodeJS.Timeout>();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  const computePosition = React.useCallback(() => {
    const trigger = triggerRef.current;
    const tooltip = tooltipRef.current;
    if (!trigger || !tooltip) return;

    const t = trigger.getBoundingClientRect();
    const w = tooltip.offsetWidth;
    const h = tooltip.offsetHeight;
    const gap = 8;
    const margin = 8;

    let top = 0;
    let left = 0;

    if (side === 'top') {
      top = t.top - h - gap;
    } else if (side === 'bottom') {
      top = t.bottom + gap;
    } else if (side === 'left') {
      left = t.left - w - gap;
    } else if (side === 'right') {
      left = t.right + gap;
    }

    if (side === 'top' || side === 'bottom') {
      if (align === 'start') left = t.left;
      else if (align === 'end') left = t.right - w;
      else left = t.left + t.width / 2 - w / 2;
    } else {
      if (align === 'start') top = t.top;
      else if (align === 'end') top = t.bottom - h;
      else top = t.top + t.height / 2 - h / 2;
    }

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (left + w > vw - margin) left = vw - w - margin;
    if (left < margin) left = margin;
    if (top + h > vh - margin) top = vh - h - margin;
    if (top < margin) top = margin;

    setCoords({ top, left });
  }, [side, align]);

  React.useLayoutEffect(() => {
    if (!isVisible) return;
    computePosition();
    const handler = () => computePosition();
    window.addEventListener('scroll', handler, true);
    window.addEventListener('resize', handler);
    return () => {
      window.removeEventListener('scroll', handler, true);
      window.removeEventListener('resize', handler);
    };
  }, [isVisible, computePosition]);

  const showTooltip = () => {
    timeoutRef.current = setTimeout(() => {
      setIsVisible(true);
    }, delay);
  };

  const hideTooltip = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setIsVisible(false);
    setCoords(null);
  };

  React.useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return (
    <div
      ref={triggerRef}
      className="relative inline-block"
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
    >
      {children}
      {mounted && isVisible && createPortal(
        <div
          ref={tooltipRef}
          style={{
            position: 'fixed',
            top: coords?.top ?? -9999,
            left: coords?.left ?? -9999,
            visibility: coords ? 'visible' : 'hidden',
          }}
          className={cn(
            'z-[100] px-3 py-2 text-sm text-white bg-gray-900 dark:bg-zinc-100 dark:text-gray-900 rounded shadow-lg whitespace-nowrap pointer-events-none',
            className
          )}
          role="tooltip"
        >
          {content}
        </div>,
        document.body
      )}
    </div>
  );
}

// Simple text tooltip variant
export function TooltipSimple({
  text,
  children,
  ...props
}: Omit<TooltipProps, 'content'> & { text: string }) {
  if (!text) return <>{children}</>;
  return (
    <Tooltip content={text} {...props}>
      {children}
    </Tooltip>
  );
}

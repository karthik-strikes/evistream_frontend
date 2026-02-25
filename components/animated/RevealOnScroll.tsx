'use client';

import { ReactNode } from 'react';
import { useScrollReveal } from '@/hooks/useScrollReveal';

interface RevealOnScrollProps {
  children: ReactNode;
  animation?: 'fade-up' | 'fade-down' | 'fade-left' | 'fade-right' | 'scale' | 'flip';
  delay?: number;
  duration?: number;
  className?: string;
}

export function RevealOnScroll({
  children,
  animation = 'fade-up',
  delay = 0,
  duration = 800,
  className = '',
}: RevealOnScrollProps) {
  const { ref, isVisible } = useScrollReveal();

  const animationClasses: Record<string, string> = {
    'fade-up': 'animate-reveal-fade-up',
    'fade-down': 'animate-reveal-fade-down',
    'fade-left': 'animate-reveal-fade-left',
    'fade-right': 'animate-reveal-fade-right',
    'scale': 'animate-reveal-scale',
    'flip': 'animate-reveal-flip',
  };

  return (
    <div
      ref={ref as any}
      className={`${className} ${isVisible ? animationClasses[animation] : 'opacity-0'}`}
      style={{
        animationDelay: `${delay}ms`,
        animationDuration: `${duration}ms`,
      }}
    >
      {children}
    </div>
  );
}

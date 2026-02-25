'use client';

import { ReactNode } from 'react';
import { useParallax } from '@/hooks/useParallax';

interface ParallaxLayerProps {
  children: ReactNode;
  speed?: number;
  className?: string;
}

export function ParallaxLayer({
  children,
  speed = 0.5,
  className = '',
}: ParallaxLayerProps) {
  const offset = useParallax(speed);

  return (
    <div
      className={className}
      style={{
        transform: `translateY(${offset}px)`,
        willChange: 'transform',
      }}
    >
      {children}
    </div>
  );
}

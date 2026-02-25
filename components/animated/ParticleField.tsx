'use client';

import { useState } from 'react';

interface ParticleFieldProps {
  count?: number;
  className?: string;
}

function seededRandom(seed: number) {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

export function ParticleField({ count = 50, className = '' }: ParticleFieldProps) {
  const [particles] = useState(() =>
    Array.from({ length: count }, (_, i) => ({
      id: i,
      size: seededRandom(i + 1) * 3 + 1,
      left: seededRandom(i + 100) * 100,
      top: seededRandom(i + 200) * 100,
      duration: seededRandom(i + 300) * 20 + 15,
      delay: seededRandom(i + 400) * 5,
    }))
  );

  return (
    <div className={`absolute inset-0 overflow-hidden pointer-events-none ${className}`}>
      {particles.map((particle) => (
        <div
          key={particle.id}
          className="absolute rounded-full bg-black opacity-20 animate-particle-float"
          style={{
            width: `${particle.size}px`,
            height: `${particle.size}px`,
            left: `${particle.left}%`,
            top: `${particle.top}%`,
            animationDuration: `${particle.duration}s`,
            animationDelay: `${particle.delay}s`,
          }}
        />
      ))}
    </div>
  );
}

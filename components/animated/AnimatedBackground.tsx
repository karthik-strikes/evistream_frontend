'use client';

import { useMousePosition } from '@/hooks/useMousePosition';

export function AnimatedBackground() {
  const { x, y } = useMousePosition();

  return (
    <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
      {/* Animated mesh gradient */}
      <div className="absolute inset-0 bg-gradient-mesh opacity-30 animate-mesh-gradient" />

      {/* Noise texture */}
      <div className="absolute inset-0 bg-noise opacity-[0.015] animate-noise" />

      {/* Mouse spotlight */}
      <div
        className="absolute w-[600px] h-[600px] rounded-full pointer-events-none transition-all duration-150 ease-out"
        style={{
          left: x - 300,
          top: y - 300,
          background: 'radial-gradient(circle, rgba(99, 102, 241, 0.08) 0%, transparent 70%)',
        }}
      />

      {/* Enhanced particle system */}
      <ParticleField />
    </div>
  );
}

function ParticleField() {
  const particles = Array.from({ length: 50 }, (_, i) => ({
    id: i,
    size: Math.random() * 3 + 1,
    left: Math.random() * 100,
    top: Math.random() * 100,
    duration: Math.random() * 20 + 15,
    delay: Math.random() * 5,
  }));

  return (
    <>
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
    </>
  );
}

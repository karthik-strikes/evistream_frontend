'use client';

import { cn } from '@/lib/utils';

interface LogoProps {
  size?: number;
  className?: string;
  /**
   * Which geometry to draw. 'auto' (default) picks `compact` under 28px.
   *
   * The detailed mark uses 1.5px/1px strokes and puts only 4 user units between
   * the two strands, so below ~28px the strands merge into a dark smudge and the
   * base pairs wash out to grey — verified by rasterising at 16/20/22px. The
   * compact geometry is the same mark redrawn for small sizes (2.5px/2px
   * round-capped strokes, three base pairs, wider bars) and is what
   * public/icon.svg ships as the favicon.
   */
  variant?: 'auto' | 'detailed' | 'compact';
}

export function Logo({ size = 32, className, variant = 'auto' }: LogoProps) {
  const compact = variant === 'compact' || (variant === 'auto' && size < 28);

  if (compact) {
    return (
      <div className={cn("relative text-gray-900 dark:text-white", className)} style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox="0 0 32 32"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Left: DNA helix — bold, round-capped, strands 6 units apart so they
              stay visually separate down to 16px. */}
          <g className="dna-helix" stroke="currentColor" fill="none" strokeLinecap="round">
            <path d="M5 6 Q8 11 5 16 Q8 21 5 26" strokeWidth="2.5" />
            <path d="M11 6 Q8 11 11 16 Q8 21 11 26" strokeWidth="2.5" />
            {/* No opacity pulse on these: at this size a 0.6 trough reads as a
                dropped base pair rather than an animation. */}
            <line x1="5" y1="9" x2="11" y2="9" strokeWidth="2" />
            <line x1="6" y1="16" x2="10" y2="16" strokeWidth="2" />
            <line x1="5" y1="23" x2="11" y2="23" strokeWidth="2" />
          </g>

          {/* Right: data bars. The flow particles are omitted — they sit at x=16,
              which the compact bars now occupy. */}
          <g className="data-bars">
            <rect x="15" y="7" width="14" height="4" rx="2" fill="currentColor" className="data-bar bar-1" />
            <rect x="15" y="14" width="10" height="4" rx="2" fill="currentColor" className="data-bar bar-2" />
            <rect x="15" y="21" width="12" height="4" rx="2" fill="currentColor" className="data-bar bar-3" />
          </g>
        </svg>

        <style jsx>{`
          /* 12deg, not 5deg: at 22px a 5deg swing moves the outermost part of
             the helix 0.63px, so the mark reads as static. */
          @keyframes rotate {
            0%, 100% { transform: rotate(0deg); }
            50% { transform: rotate(12deg); }
          }
          @keyframes bar-grow {
            0%, 100% { transform: scaleX(0.76); opacity: 0.6; }
            50% { transform: scaleX(1); opacity: 1; }
          }
          .dna-helix {
            transform-origin: 8px 16px;
            animation: rotate 3.4s ease-in-out infinite;
          }
          /* fill-box so each bar scales from its own left edge, not the viewBox's. */
          .data-bar {
            transform-box: fill-box;
            transform-origin: left center;
            animation: bar-grow 2.4s ease-in-out infinite;
          }
          .data-bar.bar-1 { animation-delay: 0.2s; }
          .data-bar.bar-2 { animation-delay: 0.6s; }
          .data-bar.bar-3 { animation-delay: 1s; }
        `}</style>
      </div>
    );
  }

  return (
    <div className={cn("relative text-gray-900 dark:text-white", className)} style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Left side: DNA Helix */}
        <g className="dna-helix">
          {/* DNA backbone lines */}
          <path
            d="M6 8 Q8 12 6 16 Q8 20 6 24"
            stroke="currentColor"
            strokeWidth="1.5"
            fill="none"
            className="dna-strand-1"
          />
          <path
            d="M10 8 Q8 12 10 16 Q8 20 10 24"
            stroke="currentColor"
            strokeWidth="1.5"
            fill="none"
            className="dna-strand-2"
          />

          {/* DNA base pairs */}
          <line x1="6" y1="10" x2="10" y2="10" stroke="currentColor" strokeWidth="1" className="base-pair bp-1" />
          <line x1="7" y1="14" x2="9" y2="14" stroke="currentColor" strokeWidth="1" className="base-pair bp-2" />
          <line x1="6" y1="18" x2="10" y2="18" stroke="currentColor" strokeWidth="1" className="base-pair bp-3" />
          <line x1="7" y1="22" x2="9" y2="22" stroke="currentColor" strokeWidth="1" className="base-pair bp-4" />
        </g>

        {/* Center: Flow particles */}
        <circle cx="16" cy="12" r="1" fill="currentColor" className="flow-particle particle-1" opacity="0" />
        <circle cx="16" cy="16" r="1" fill="currentColor" className="flow-particle particle-2" opacity="0" />
        <circle cx="16" cy="20" r="1" fill="currentColor" className="flow-particle particle-3" opacity="0" />

        {/* Right side: Data bars */}
        <g className="data-bars">
          <rect x="20" y="10" width="8" height="3" rx="1" fill="currentColor" className="data-bar bar-1" />
          <rect x="20" y="15" width="10" height="3" rx="1" fill="currentColor" className="data-bar bar-2" />
          <rect x="20" y="20" width="6" height="3" rx="1" fill="currentColor" className="data-bar bar-3" />
        </g>
      </svg>

      <style jsx>{`
        /* 12deg, not 5deg — a 5deg swing is sub-pixel travel at the sizes this
           mark actually renders at (20-30px), which is why it looked frozen. */
        @keyframes rotate {
          0%, 100% {
            transform: rotate(0deg);
          }
          50% {
            transform: rotate(12deg);
          }
        }

        @keyframes pulse-opacity {
          0%, 100% {
            opacity: 0.6;
          }
          50% {
            opacity: 1;
          }
        }

        @keyframes flow {
          0% {
            opacity: 0;
            transform: translateX(-8px);
          }
          50% {
            opacity: 1;
          }
          100% {
            opacity: 0;
            transform: translateX(8px);
          }
        }

        @keyframes bar-grow {
          0%, 100% {
            transform: scaleX(0.8);
            opacity: 0.7;
          }
          50% {
            transform: scaleX(1);
            opacity: 1;
          }
        }

        .dna-helix {
          transform-origin: 8px 16px;
          animation: rotate 4s ease-in-out infinite;
        }

        .base-pair.bp-1 {
          animation: pulse-opacity 2s ease-in-out infinite;
          animation-delay: 0s;
        }

        .base-pair.bp-2 {
          animation: pulse-opacity 2s ease-in-out infinite;
          animation-delay: 0.5s;
        }

        .base-pair.bp-3 {
          animation: pulse-opacity 2s ease-in-out infinite;
          animation-delay: 1s;
        }

        .base-pair.bp-4 {
          animation: pulse-opacity 2s ease-in-out infinite;
          animation-delay: 1.5s;
        }

        .flow-particle.particle-1 {
          animation: flow 3s ease-in-out infinite;
          animation-delay: 0s;
        }

        .flow-particle.particle-2 {
          animation: flow 3s ease-in-out infinite;
          animation-delay: 0.4s;
        }

        .flow-particle.particle-3 {
          animation: flow 3s ease-in-out infinite;
          animation-delay: 0.8s;
        }

        .data-bar.bar-1 {
          transform-origin: left center;
          animation: bar-grow 2.5s ease-in-out infinite;
          animation-delay: 0.2s;
        }

        .data-bar.bar-2 {
          transform-origin: left center;
          animation: bar-grow 2.5s ease-in-out infinite;
          animation-delay: 0.6s;
        }

        .data-bar.bar-3 {
          transform-origin: left center;
          animation: bar-grow 2.5s ease-in-out infinite;
          animation-delay: 1s;
        }
      `}</style>
    </div>
  );
}

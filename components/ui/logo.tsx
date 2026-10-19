'use client';

import { cn } from '@/lib/utils';

interface LogoProps {
  size?: number;
  className?: string;
}

export function Logo({ size = 32, className }: LogoProps) {
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
        @keyframes rotate {
          0%, 100% {
            transform: rotate(0deg);
          }
          50% {
            transform: rotate(5deg);
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

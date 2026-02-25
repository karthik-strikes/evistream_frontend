'use client';

import { useEffect, useState } from 'react';

export function MedicalVisualization() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return (
    <div className="relative w-full h-full flex items-center justify-center">
      <svg
        viewBox="0 0 500 500"
        className="w-full h-full max-w-lg"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Gradient Definitions */}
        <defs>
          <linearGradient id="blueGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#3B82F6" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#8B5CF6" stopOpacity="0.8" />
          </linearGradient>
          <linearGradient id="purpleGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#8B5CF6" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#EC4899" stopOpacity="0.8" />
          </linearGradient>
          <filter id="glow">
            <feGaussianBlur stdDeviation="3" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Floating Background Circles */}
        <circle
          cx="100"
          cy="100"
          r="40"
          fill="url(#blueGradient)"
          opacity="0.2"
          className="animate-pulse-slow"
        />
        <circle
          cx="400"
          cy="150"
          r="60"
          fill="url(#purpleGradient)"
          opacity="0.2"
          className="animate-pulse-slow"
          style={{ animationDelay: '1s' }}
        />
        <circle
          cx="350"
          cy="400"
          r="50"
          fill="url(#blueGradient)"
          opacity="0.2"
          className="animate-pulse-slow"
          style={{ animationDelay: '2s' }}
        />

        {/* Central 3D Medical Document Stack */}
        <g className="animate-float-1">
          {/* Back document */}
          <rect
            x="180"
            y="180"
            width="160"
            height="200"
            rx="8"
            fill="#E5E7EB"
            stroke="#9CA3AF"
            strokeWidth="2"
            transform="translate(20, -10)"
            opacity="0.5"
          />

          {/* Middle document */}
          <rect
            x="180"
            y="180"
            width="160"
            height="200"
            rx="8"
            fill="#F3F4F6"
            stroke="#6B7280"
            strokeWidth="2"
            transform="translate(10, -5)"
            opacity="0.7"
          />

          {/* Front document with text lines */}
          <g>
            <rect
              x="180"
              y="180"
              width="160"
              height="200"
              rx="8"
              fill="white"
              stroke="#000000"
              strokeWidth="2"
              filter="url(#glow)"
            />

            {/* Document lines */}
            <line x1="200" y1="210" x2="320" y2="210" stroke="#D1D5DB" strokeWidth="3" strokeLinecap="round" />
            <line x1="200" y1="230" x2="310" y2="230" stroke="#D1D5DB" strokeWidth="3" strokeLinecap="round" />
            <line x1="200" y1="250" x2="320" y2="250" stroke="#D1D5DB" strokeWidth="3" strokeLinecap="round" />

            {/* Highlighted data (what gets extracted) */}
            <rect x="200" y="270" width="120" height="8" rx="2" fill="url(#blueGradient)" className="animate-pulse" />
            <rect x="200" y="290" width="100" height="8" rx="2" fill="url(#purpleGradient)" className="animate-pulse" style={{ animationDelay: '0.5s' }} />

            <line x1="200" y1="310" x2="280" y2="310" stroke="#D1D5DB" strokeWidth="3" strokeLinecap="round" />
            <line x1="200" y1="330" x2="320" y2="330" stroke="#D1D5DB" strokeWidth="3" strokeLinecap="round" />
          </g>
        </g>

        {/* Data Extraction Arrows - Animated Flow */}
        <g className="animate-flow-particle">
          <path
            d="M 340 250 L 400 200"
            stroke="url(#blueGradient)"
            strokeWidth="3"
            strokeLinecap="round"
            markerEnd="url(#arrowhead)"
          />
          <circle cx="370" cy="225" r="4" fill="#3B82F6" className="animate-ping" />
        </g>

        <g className="animate-flow-particle" style={{ animationDelay: '1s' }}>
          <path
            d="M 340 280 L 400 280"
            stroke="url(#purpleGradient)"
            strokeWidth="3"
            strokeLinecap="round"
            markerEnd="url(#arrowhead)"
          />
          <circle cx="370" cy="280" r="4" fill="#8B5CF6" className="animate-ping" />
        </g>

        <g className="animate-flow-particle" style={{ animationDelay: '2s' }}>
          <path
            d="M 340 310 L 400 360"
            stroke="url(#blueGradient)"
            strokeWidth="3"
            strokeLinecap="round"
            markerEnd="url(#arrowhead)"
          />
          <circle cx="370" cy="335" r="4" fill="#3B82F6" className="animate-ping" />
        </g>

        {/* Arrowhead marker */}
        <defs>
          <marker
            id="arrowhead"
            markerWidth="10"
            markerHeight="10"
            refX="9"
            refY="3"
            orient="auto"
          >
            <polygon points="0 0, 10 3, 0 6" fill="#3B82F6" />
          </marker>
        </defs>

        {/* Extracted Data Nodes (3D-looking spheres) */}
        <g className="animate-float-2">
          <circle cx="420" cy="200" r="20" fill="url(#blueGradient)" filter="url(#glow)" />
          <circle cx="420" cy="200" r="12" fill="white" opacity="0.3" />
          <text x="420" y="205" textAnchor="middle" fill="white" fontSize="12" fontWeight="bold">D</text>
        </g>

        <g className="animate-float-3">
          <circle cx="420" cy="280" r="20" fill="url(#purpleGradient)" filter="url(#glow)" />
          <circle cx="420" cy="280" r="12" fill="white" opacity="0.3" />
          <text x="420" y="285" textAnchor="middle" fill="white" fontSize="12" fontWeight="bold">A</text>
        </g>

        <g className="animate-float-1">
          <circle cx="420" cy="360" r="20" fill="url(#blueGradient)" filter="url(#glow)" />
          <circle cx="420" cy="360" r="12" fill="white" opacity="0.3" />
          <text x="420" y="365" textAnchor="middle" fill="white" fontSize="12" fontWeight="bold">T</text>
        </g>

        {/* DNA Helix-like Structure (Medical theme) */}
        <g opacity="0.3" className="animate-spin-slow">
          <ellipse cx="250" cy="100" rx="8" ry="30" fill="url(#blueGradient)" />
          <ellipse cx="250" cy="100" rx="30" ry="8" fill="url(#purpleGradient)" />
        </g>

        {/* Orbiting Medical Icons */}
        <g className="animate-orbit">
          <circle cx="250" cy="250" r="120" stroke="#E5E7EB" strokeWidth="1" fill="none" strokeDasharray="5,5" />

          {/* Medical cross icon */}
          <g transform="translate(370, 250)">
            <rect x="-3" y="-8" width="6" height="16" fill="url(#blueGradient)" rx="1" />
            <rect x="-8" y="-3" width="16" height="6" fill="url(#blueGradient)" rx="1" />
          </g>
        </g>

        {/* Pulse Effect from Center */}
        <circle
          cx="250"
          cy="250"
          r="100"
          fill="none"
          stroke="url(#blueGradient)"
          strokeWidth="2"
          opacity="0.5"
          className="animate-pulsing-ring"
        />

        {/* Grid Background (subtle) */}
        <g opacity="0.05">
          {Array.from({ length: 10 }).map((_, i) => (
            <line
              key={`v-${i}`}
              x1={50 * i}
              y1="0"
              x2={50 * i}
              y2="500"
              stroke="black"
              strokeWidth="1"
            />
          ))}
          {Array.from({ length: 10 }).map((_, i) => (
            <line
              key={`h-${i}`}
              x1="0"
              y1={50 * i}
              x2="500"
              y2={50 * i}
              stroke="black"
              strokeWidth="1"
            />
          ))}
        </g>
      </svg>

      {/* Floating Labels */}
      <div className="absolute top-1/4 right-8 opacity-0 animate-fade-in-delay">
        <div className="px-3 py-1 bg-blue-100 text-blue-700 text-xs font-semibold rounded-full border border-blue-300">
          AI Processing
        </div>
      </div>

      <div className="absolute top-1/2 right-8 opacity-0 animate-fade-in-delay-2">
        <div className="px-3 py-1 bg-purple-100 text-purple-700 text-xs font-semibold rounded-full border border-purple-300">
          Data Extraction
        </div>
      </div>

      <div className="absolute bottom-1/4 right-8 opacity-0 animate-fade-in" style={{ animationDelay: '1.2s' }}>
        <div className="px-3 py-1 bg-pink-100 text-pink-700 text-xs font-semibold rounded-full border border-pink-300">
          Structured Output
        </div>
      </div>
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SuccessAnimationProps {
  show: boolean;
  message?: string;
  onComplete?: () => void;
  duration?: number;
}

export function SuccessAnimation({
  show,
  message = 'Success!',
  onComplete,
  duration = 3000,
}: SuccessAnimationProps) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (show) {
      setIsVisible(true);
      const timer = setTimeout(() => {
        setIsVisible(false);
        onComplete?.();
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [show, duration, onComplete]);

  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center pointer-events-none">
      {/* Backdrop with fade in */}
      <div className="absolute inset-0 bg-black/20 animate-fade-in" />

      {/* Success Card */}
      <div className="relative animate-scale-in">
        <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-sm mx-4">
          {/* Success Icon with pulse */}
          <div className="flex justify-center mb-4">
            <div className="relative">
              <div className="absolute inset-0 bg-green-500 rounded-full animate-ping opacity-75" />
              <div className="relative bg-green-500 rounded-full p-4">
                <CheckCircle2 className="h-12 w-12 text-white animate-check-draw" />
              </div>
            </div>
          </div>

          {/* Message */}
          <h3 className="text-2xl font-bold text-center text-gray-900 mb-2 animate-slide-up">
            {message}
          </h3>

          {/* Confetti/Sparkles */}
          <div className="flex justify-center gap-2 animate-fade-in-delay">
            <Sparkles className="h-5 w-5 text-yellow-400 animate-bounce" />
            <Sparkles className="h-4 w-4 text-yellow-400 animate-bounce delay-100" />
            <Sparkles className="h-5 w-5 text-yellow-400 animate-bounce delay-200" />
          </div>
        </div>
      </div>
    </div>
  );
}

// Compact toast-style success
export function SuccessToast({
  show,
  message = 'Success!',
  onComplete,
  duration = 2000,
}: SuccessAnimationProps) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (show) {
      setIsVisible(true);
      const timer = setTimeout(() => {
        setIsVisible(false);
        onComplete?.();
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [show, duration, onComplete]);

  if (!isVisible) return null;

  return (
    <div className="fixed top-4 right-4 z-[100] animate-slide-in-right">
      <div className="bg-green-500 text-white rounded-lg shadow-lg p-4 flex items-center gap-3 min-w-[300px]">
        <CheckCircle2 className="h-6 w-6 animate-check-draw" />
        <span className="font-medium">{message}</span>
      </div>
    </div>
  );
}

// Progress celebration (for milestones)
export function ProgressCelebration({
  show,
  title,
  subtitle,
  onComplete,
}: {
  show: boolean;
  title: string;
  subtitle: string;
  onComplete?: () => void;
}) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (show) {
      setIsVisible(true);
      const timer = setTimeout(() => {
        setIsVisible(false);
        onComplete?.();
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [show, onComplete]);

  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center pointer-events-none">
      <div className="absolute inset-0 bg-gradient-to-br from-blue-500/20 to-purple-500/20 animate-fade-in" />

      <div className="relative animate-scale-in-bounce">
        <div className="bg-white rounded-3xl shadow-2xl p-12 max-w-md mx-4 text-center">
          {/* Animated Trophy/Star */}
          <div className="flex justify-center mb-6">
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-r from-yellow-400 to-orange-400 rounded-full blur-xl opacity-50 animate-pulse" />
              <div className="relative text-6xl animate-bounce-slow">🎉</div>
            </div>
          </div>

          {/* Title */}
          <h2 className="text-3xl font-bold text-gray-900 mb-2 animate-slide-up">
            {title}
          </h2>

          {/* Subtitle */}
          <p className="text-lg text-gray-600 animate-slide-up delay-100">
            {subtitle}
          </p>

          {/* Sparkles */}
          <div className="mt-6 flex justify-center gap-3">
            {[...Array(5)].map((_, i) => (
              <Sparkles
                key={i}
                className={cn(
                  'h-4 w-4 text-yellow-400 animate-twinkle',
                  `delay-${i * 100}`
                )}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// Add CSS animations to globals.css:
/*
@keyframes fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes scale-in {
  from {
    opacity: 0;
    transform: scale(0.8);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes scale-in-bounce {
  0% {
    opacity: 0;
    transform: scale(0.8);
  }
  50% {
    transform: scale(1.05);
  }
  100% {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes slide-up {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes slide-in-right {
  from {
    opacity: 0;
    transform: translateX(100%);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

@keyframes check-draw {
  0% {
    stroke-dasharray: 0 100;
  }
  100% {
    stroke-dasharray: 100 100;
  }
}

@keyframes bounce-slow {
  0%, 100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-20px);
  }
}

@keyframes twinkle {
  0%, 100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.3;
    transform: scale(0.8);
  }
}

.animate-fade-in { animation: fade-in 0.3s ease-out; }
.animate-scale-in { animation: scale-in 0.4s ease-out; }
.animate-scale-in-bounce { animation: scale-in-bounce 0.6s ease-out; }
.animate-slide-up { animation: slide-up 0.4s ease-out; }
.animate-slide-in-right { animation: slide-in-right 0.3s ease-out; }
.animate-check-draw { animation: check-draw 0.5s ease-out; }
.animate-bounce-slow { animation: bounce-slow 2s infinite; }
.animate-twinkle { animation: twinkle 1.5s infinite; }
.animate-fade-in-delay { animation: fade-in 0.3s ease-out 0.3s both; }
.delay-100 { animation-delay: 0.1s; }
.delay-200 { animation-delay: 0.2s; }
*/

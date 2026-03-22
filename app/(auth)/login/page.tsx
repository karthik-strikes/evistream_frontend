'use client';

import { useState, useEffect, Suspense, useRef } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/lib/api';
import type { AuthResponse } from '@/types/api';
import { Logo } from '@/components/ui/logo';
import { getErrorMessage } from '@/lib/utils';
import { Eye, EyeOff } from 'lucide-react';

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

type LoginFormData = z.infer<typeof loginSchema>;

const TAGLINES = [
  'Extract from 100 papers in minutes.',
  'AI-generated pipelines, human-level accuracy.',
  'From PDF to structured data — automatically.',
];

function LoginContent() {
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const isDark = false; // Auth pages match the white landing page
  const [showPassword, setShowPassword] = useState(false);
  const [tagline, setTagline] = useState('');
  const [taglineIdx, setTaglineIdx] = useState(0);
  const taglineRef = useRef(0);

  // Typing animation
  useEffect(() => {
    let charIdx = 0;
    let deleting = false;
    let timeout: NodeJS.Timeout;

    const tick = () => {
      const current = TAGLINES[taglineRef.current % TAGLINES.length];
      if (!deleting) {
        charIdx++;
        setTagline(current.slice(0, charIdx));
        if (charIdx === current.length) {
          deleting = true;
          timeout = setTimeout(tick, 2000); // pause before deleting
          return;
        }
        timeout = setTimeout(tick, 45);
      } else {
        charIdx--;
        setTagline(current.slice(0, charIdx));
        if (charIdx === 0) {
          deleting = false;
          taglineRef.current++;
          setTaglineIdx(taglineRef.current);
          timeout = setTimeout(tick, 300);
          return;
        }
        timeout = setTimeout(tick, 25);
      }
    };

    timeout = setTimeout(tick, 500);
    return () => clearTimeout(timeout);
  }, []);

  const { register, handleSubmit, formState: { errors } } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginFormData) => {
    setLoading(true);
    try {
      const response = await apiClient.post<AuthResponse>('/api/v1/auth/login', data);
      apiClient.setToken(response.access_token, response.refresh_token ?? undefined);
      toast({ title: 'Success', description: 'Login successful', variant: 'success' });
      const from = searchParams.get('from') || '/dashboard';
      const safePath = from.startsWith('/') && !from.startsWith('//') ? from : '/dashboard';
      window.location.href = safePath;
    } catch (error: any) {
      toast({ title: 'Error', description: getErrorMessage(error, 'Login failed'), variant: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const d = isDark;

  return (
    <div className="flex min-h-screen" style={{ backgroundColor: d ? '#050505' : '#ffffff' }}>
      {/* Left panel */}
      <div
        className="hidden lg:flex flex-col justify-between flex-1 p-12"
        style={{
          borderRight: d ? '1px solid #111' : '1px solid #e5e7eb',
        }}
      >
        <div>
          <Link href="/" className="flex items-center gap-3">
            <Logo size={30} className={d ? '!text-white' : '!text-black'} />
            <span className="text-lg font-bold" style={{ color: d ? '#f0f0f0' : '#0a0a0a' }}>eviStreams</span>
          </Link>
        </div>

        <div className="max-w-md">
          <h2
            className="text-3xl font-bold leading-tight"
            style={{ color: d ? '#f0f0f0' : '#0a0a0a', letterSpacing: '-0.03em' }}
          >
            The fastest way to extract data from research papers.
          </h2>
          <div className="mt-5 h-6">
            <span className="text-sm font-mono" style={{ color: d ? '#555' : '#9ca3af' }}>
              {tagline}<span className="animate-pulse">|</span>
            </span>
          </div>

        </div>

        <p className="text-xs" style={{ color: d ? '#333' : '#d1d5db' }}>
          &copy; 2026 eviStreams
        </p>
      </div>

      {/* Right panel — form */}
      <div className="flex flex-col items-center justify-center flex-1 px-6 lg:px-16">
        {/* Mobile logo */}
        <div className="lg:hidden mb-8 text-center space-y-3">
          <Logo size={48} className={`mx-auto ${d ? '!text-white' : '!text-black'}`} />
          <h1 className="text-3xl font-bold" style={{ color: d ? '#f0f0f0' : '#0a0a0a' }}>eviStreams</h1>
          <p className="text-sm" style={{ color: d ? '#555' : '#6b7280' }}>Medical AI Data Extraction</p>
        </div>

        <div className="w-full max-w-sm space-y-8">
          <div>
            <h2 className="text-2xl font-semibold" style={{ color: d ? '#f0f0f0' : '#0a0a0a' }}>
              Sign in
            </h2>
            <p className="text-sm mt-1" style={{ color: d ? '#555' : '#6b7280' }}>
              Enter your credentials to continue
            </p>
          </div>

          <form method="POST" action="" onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            <div className="space-y-4">
              <div>
                <Label className="text-sm" style={{ color: d ? '#888' : '#374151' }}>Email</Label>
                <Input
                  {...register('email')}
                  type="email"
                  placeholder="you@example.com"
                  error={errors.email?.message}
                  className={`mt-2 focus:outline-none focus:ring-0 ${
                    d ? '!bg-[#0f0f0f] !border-[#242424] !text-[#e8e8e8] placeholder:!text-[#444] focus:!border-white' : 'focus:!border-black'
                  }`}
                />
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <Label className="text-sm" style={{ color: d ? '#888' : '#374151' }}>Password</Label>
                  <button
                    type="button"
                    className="text-xs"
                    style={{ color: d ? '#444' : '#9ca3af' }}
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="relative mt-2">
                  <Input
                    {...register('password')}
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    error={errors.password?.message}
                    className={`pr-10 focus:outline-none focus:ring-0 ${
                      d ? '!bg-[#0f0f0f] !border-[#242424] !text-[#e8e8e8] placeholder:!text-[#444] focus:!border-white' : 'focus:!border-black'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2"
                    style={{ color: d ? '#444' : '#9ca3af' }}
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full h-10 rounded text-sm font-medium transition-opacity duration-150"
              style={{
                backgroundColor: d ? '#ffffff' : '#0a0a0a',
                color: d ? '#000000' : '#ffffff',
                opacity: loading ? 0.5 : 1,
                cursor: loading ? 'not-allowed' : 'pointer',
              }}
            >
              {loading ? 'Signing in…' : 'Continue'}
            </button>

            <p className="text-center text-sm" style={{ color: d ? '#555' : '#6b7280' }}>
              Don&apos;t have an account?{' '}
              <Link
                href="/register"
                className="font-medium underline"
                style={{ color: d ? '#ffffff' : '#0a0a0a' }}
              >
                Sign up
              </Link>
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  );
}

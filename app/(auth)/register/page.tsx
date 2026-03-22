'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/lib/api';
import type { RegisterRequest, AuthResponse } from '@/types/api';
import { Logo } from '@/components/ui/logo';
import { getErrorMessage } from '@/lib/utils';
import { Eye, EyeOff } from 'lucide-react';

const registerSchema = z.object({
  full_name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ['confirmPassword'],
});

type RegisterFormData = z.infer<typeof registerSchema>;

const TAGLINES = [
  'Define your form. AI writes the code.',
  'Structured data from hundreds of papers.',
  'Built for systematic review teams.',
];

export default function RegisterPage() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const isDark = false; // Auth pages match the white landing page
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [tagline, setTagline] = useState('');
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
          timeout = setTimeout(tick, 2000);
          return;
        }
        timeout = setTimeout(tick, 45);
      } else {
        charIdx--;
        setTagline(current.slice(0, charIdx));
        if (charIdx === 0) {
          deleting = false;
          taglineRef.current++;
          timeout = setTimeout(tick, 300);
          return;
        }
        timeout = setTimeout(tick, 25);
      }
    };

    timeout = setTimeout(tick, 500);
    return () => clearTimeout(timeout);
  }, []);

  const { register, handleSubmit, formState: { errors } } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
  });

  const onSubmit = async (data: RegisterFormData) => {
    setLoading(true);
    try {
      const registerData: RegisterRequest = {
        email: data.email,
        password: data.password,
        full_name: data.full_name,
      };
      const response = await apiClient.post<AuthResponse>('/api/v1/auth/register', registerData);
      apiClient.setToken(response.access_token, response.refresh_token ?? undefined);
      toast({ title: 'Success', description: 'Account created', variant: 'success' });
      window.location.href = '/dashboard';
    } catch (error: any) {
      toast({ title: 'Error', description: getErrorMessage(error, 'Registration failed'), variant: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const d = isDark;

  const inputClass = `mt-2 focus:outline-none focus:ring-0 ${
    d
      ? '!bg-[#0f0f0f] !border-[#242424] !text-[#e8e8e8] placeholder:!text-[#444] focus:!border-white'
      : 'focus:!border-black'
  }`;

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
            AI-powered data extraction for medical research.
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
              Create account
            </h2>
            <p className="text-sm mt-1" style={{ color: d ? '#555' : '#6b7280' }}>
              Get started with eviStreams
            </p>
          </div>

          <form method="POST" action="" onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            <div className="space-y-4">
              <div>
                <Label className="text-sm" style={{ color: d ? '#888' : '#374151' }}>Full Name</Label>
                <Input {...register('full_name')} placeholder="John Doe" error={errors.full_name?.message} className={inputClass} />
              </div>
              <div>
                <Label className="text-sm" style={{ color: d ? '#888' : '#374151' }}>Email</Label>
                <Input {...register('email')} type="email" placeholder="you@example.com" error={errors.email?.message} className={inputClass} />
              </div>
              <div>
                <Label className="text-sm" style={{ color: d ? '#888' : '#374151' }}>Password</Label>
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
              <div>
                <Label className="text-sm" style={{ color: d ? '#888' : '#374151' }}>Confirm Password</Label>
                <div className="relative mt-2">
                  <Input
                    {...register('confirmPassword')}
                    type={showConfirm ? 'text' : 'password'}
                    placeholder="••••••••"
                    error={errors.confirmPassword?.message}
                    className={`pr-10 focus:outline-none focus:ring-0 ${
                      d ? '!bg-[#0f0f0f] !border-[#242424] !text-[#e8e8e8] placeholder:!text-[#444] focus:!border-white' : 'focus:!border-black'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm(!showConfirm)}
                    className="absolute right-3 top-1/2 -translate-y-1/2"
                    style={{ color: d ? '#444' : '#9ca3af' }}
                    tabIndex={-1}
                  >
                    {showConfirm ? <EyeOff size={15} /> : <Eye size={15} />}
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
              {loading ? 'Creating account…' : 'Create Account'}
            </button>

            <p className="text-center text-sm" style={{ color: d ? '#555' : '#6b7280' }}>
              Already have an account?{' '}
              <Link
                href="/login"
                className="font-medium underline"
                style={{ color: d ? '#ffffff' : '#0a0a0a' }}
              >
                Sign in
              </Link>
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}

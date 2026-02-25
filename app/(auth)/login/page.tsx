'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/lib/api';
import type { AuthResponse } from '@/types/api';
import { Logo } from '@/components/ui/logo';

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

type LoginFormData = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [isDark, setIsDark] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem('evistream-theme');
    setIsDark(saved !== 'light');
  }, []);

  const { register, handleSubmit, formState: { errors } } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginFormData) => {
    setLoading(true);
    try {
      const response = await apiClient.post<AuthResponse>('/api/v1/auth/login', data);
      apiClient.setToken(response.access_token);
      toast({ title: 'Success', description: 'Login successful', variant: 'success' });
      window.location.href = '/dashboard';
    } catch (error: any) {
      toast({ title: 'Error', description: error.response?.data?.detail || 'Login failed', variant: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const d = isDark;

  return (
    <div
      className="flex min-h-screen items-center justify-center px-4"
      style={{ backgroundColor: d ? '#050505' : '#ffffff' }}
    >
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center space-y-4">
          {/* Logo forced to correct color per theme */}
          <Logo size={48} className={`mx-auto ${d ? '!text-white' : '!text-black'}`} />
          <div>
            <h1 className="text-4xl font-bold" style={{ color: d ? '#f0f0f0' : '#0a0a0a' }}>
              eviStream
            </h1>
            <p className="text-sm mt-1" style={{ color: d ? '#555' : '#6b7280' }}>
              Medical AI Data Extraction
            </p>
          </div>
          <h2 className="text-2xl font-semibold" style={{ color: d ? '#f0f0f0' : '#0a0a0a' }}>
            Sign in
          </h2>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
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
              <Label className="text-sm" style={{ color: d ? '#888' : '#374151' }}>Password</Label>
              <Input
                {...register('password')}
                type="password"
                placeholder="••••••••"
                error={errors.password?.message}
                className={`mt-2 focus:outline-none focus:ring-0 ${
                  d ? '!bg-[#0f0f0f] !border-[#242424] !text-[#e8e8e8] placeholder:!text-[#444] focus:!border-white' : 'focus:!border-black'
                }`}
              />
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
  );
}

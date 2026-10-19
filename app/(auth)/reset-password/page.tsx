'use client';

import { useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import Link from 'next/link';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Logo } from '@/components/ui/logo';
import { Eye, EyeOff } from 'lucide-react';

const schema = z.object({
  new_password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .refine(v => /[A-Z]/.test(v), 'Must contain an uppercase letter')
    .refine(v => /[a-z]/.test(v), 'Must contain a lowercase letter')
    .refine(v => /[0-9]/.test(v), 'Must contain a digit'),
  confirm_password: z.string(),
}).refine(d => d.new_password === d.confirm_password, {
  message: 'Passwords do not match',
  path: ['confirm_password'],
});

type FormData = z.infer<typeof schema>;

function ResetPasswordContent() {
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const d = false;

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: FormData) => {
    if (!token) {
      toast({ title: 'Error', description: 'Missing reset token.', variant: 'error' });
      return;
    }
    setLoading(true);
    try {
      const resp = await fetch('/api/v1/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, new_password: data.new_password }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.detail || 'Reset failed');
      }
      setDone(true);
      setTimeout(() => router.push('/login'), 2500);
    } catch (err: any) {
      toast({ title: 'Error', description: err.message || 'Something went wrong.', variant: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const inputCls = `mt-2 focus:outline-none focus:ring-0 ${
    d ? '!bg-[#0f0f0f] !border-[#242424] !text-[#e8e8e8] placeholder:!text-[#444] focus:!border-white' : 'focus:!border-black'
  }`;

  return (
    <div className="flex min-h-screen items-center justify-center px-6" style={{ backgroundColor: '#ffffff' }}>
      <div className="w-full max-w-sm space-y-8">
        <div className="space-y-1">
          <Link href="/" className="flex items-center gap-2 mb-6">
            <Logo size={24} className="!text-black" />
            <span className="text-base font-semibold text-black">eviStreams</span>
          </Link>
          <h2 className="text-2xl font-semibold" style={{ color: '#0a0a0a' }}>
            Choose a new password
          </h2>
          <p className="text-sm" style={{ color: '#6b7280' }}>
            Must be at least 8 characters with uppercase, lowercase, and a digit.
          </p>
        </div>

        {done ? (
          <div className="space-y-3">
            <p className="text-sm" style={{ color: '#6b7280' }}>
              Password updated. Redirecting you to sign in…
            </p>
          </div>
        ) : !token ? (
          <div className="space-y-3">
            <p className="text-sm" style={{ color: '#ef4444' }}>
              This reset link is invalid or has expired.
            </p>
            <Link href="/login" className="text-sm font-medium underline" style={{ color: '#0a0a0a' }}>
              Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            <div>
              <Label className="text-sm" style={{ color: '#374151' }}>New password</Label>
              <div className="relative">
                <Input
                  {...register('new_password')}
                  type={showPw ? 'text' : 'password'}
                  placeholder="••••••••"
                  error={errors.new_password?.message}
                  className={`pr-10 ${inputCls}`}
                />
                <button
                  type="button"
                  onClick={() => setShowPw(!showPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2"
                  style={{ color: '#9ca3af' }}
                  tabIndex={-1}
                >
                  {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            <div>
              <Label className="text-sm" style={{ color: '#374151' }}>Confirm password</Label>
              <div className="relative">
                <Input
                  {...register('confirm_password')}
                  type={showConfirm ? 'text' : 'password'}
                  placeholder="••••••••"
                  error={errors.confirm_password?.message}
                  className={`pr-10 ${inputCls}`}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm(!showConfirm)}
                  className="absolute right-3 top-1/2 -translate-y-1/2"
                  style={{ color: '#9ca3af' }}
                  tabIndex={-1}
                >
                  {showConfirm ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full h-10 rounded text-sm font-medium transition-opacity duration-150"
              style={{
                backgroundColor: '#0a0a0a',
                color: '#ffffff',
                opacity: loading ? 0.5 : 1,
                cursor: loading ? 'not-allowed' : 'pointer',
              }}
            >
              {loading ? 'Saving…' : 'Reset password'}
            </button>

            <p className="text-center text-sm" style={{ color: '#6b7280' }}>
              <Link href="/login" className="font-medium underline" style={{ color: '#0a0a0a' }}>
                Back to sign in
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordContent />
    </Suspense>
  );
}

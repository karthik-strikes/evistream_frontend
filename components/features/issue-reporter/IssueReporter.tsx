'use client';

import { useState, useRef } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Megaphone, CheckCircle2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { issuesService } from '@/services/issues.service';
import type { IssuePriority } from '@/types/api';

// ─── Schema ──────────────────────────────────────────────────────────────────

const schema = z.object({
  title: z.string().min(1, 'Title is required').max(255),
  category: z.enum(['bug', 'ui_issue', 'feature_request', 'performance', 'other'] as const),
  priority: z.enum(['low', 'medium', 'high', 'critical'] as const),
  description: z.string().min(1, 'Description is required'),
  steps_to_reproduce: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

// ─── Priority config ──────────────────────────────────────────────────────────

const PRIORITIES: { value: IssuePriority; label: string; dot: string }[] = [
  { value: 'low',      label: 'Low',      dot: 'bg-slate-400' },
  { value: 'medium',   label: 'Medium',   dot: 'bg-amber-400' },
  { value: 'high',     label: 'High',     dot: 'bg-orange-500' },
  { value: 'critical', label: 'Critical', dot: 'bg-red-500' },
];

// ─── Shared input / textarea classes (matches site's input.tsx & textarea.tsx) ─

const inputCls = [
  'w-full rounded border border-border bg-white px-3 py-2 text-sm transition-colors',
  'dark:bg-[#0d0d0d] dark:border-[#2a2a2a] dark:text-[#e8e8e8]',
  'placeholder:text-gray-400 dark:placeholder:text-[#555555]',
  'focus:border-black dark:focus:border-[#3f3f3f] focus:outline-none',
].join(' ');

const labelCls = 'block text-sm font-medium text-gray-700 dark:text-[#c0c0c0] mb-1.5';

// ─── SuccessState ─────────────────────────────────────────────────────────────

function SuccessState() {
  return (
    <div className="flex flex-col items-center justify-center py-10 px-6 gap-4 text-center">
      <div className="relative flex items-center justify-center">
        <span className="absolute inline-flex h-16 w-16 rounded-full bg-emerald-500/20 animate-ping" />
        <CheckCircle2 className="relative h-11 w-11 text-emerald-500" strokeWidth={1.5} />
      </div>
      <div>
        <p className="text-base font-semibold text-gray-900 dark:text-[#e8e8e8]">Report Submitted</p>
        <p className="text-sm text-gray-500 dark:text-[#888] mt-1">
          Thanks — we&apos;ll look into it shortly.
        </p>
      </div>
      <div className="w-full h-0.5 rounded-full bg-gray-100 dark:bg-[#1f1f1f] overflow-hidden mt-1">
        <div className="h-full bg-emerald-500 animate-progress-fill origin-left" />
      </div>
    </div>
  );
}

// ─── Dialog Form ──────────────────────────────────────────────────────────────

function IssueReporterDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { currentUser } = useAuth();
  const [success, setSuccess] = useState(false);

  const {
    register,
    handleSubmit,
    control,
    watch,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { category: 'bug', priority: 'medium' },
  });

  const category = watch('category');

  async function onSubmit(values: FormValues) {
    await issuesService.create({
      ...values,
      page_url: typeof window !== 'undefined' ? window.location.href : undefined,
      browser_info: typeof window !== 'undefined' ? navigator.userAgent : undefined,
    });
    setSuccess(true);
    setTimeout(() => {
      setSuccess(false);
      reset();
      onClose();
    }, 2200);
  }

  function handleOpenChange(isOpen: boolean) {
    if (!isOpen && !isSubmitting) {
      reset();
      setSuccess(false);
      onClose();
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[460px] p-0 overflow-hidden gap-0 select-text">
        {success ? (
          <SuccessState />
        ) : (
          <>
            {/* Header */}
            <div className="px-6 pt-5 pb-4 border-b border-gray-100 dark:border-[#1f1f1f]">
              <DialogTitle className="text-sm font-semibold text-gray-900 dark:text-[#e8e8e8] leading-none">
                Report an Issue
              </DialogTitle>
              {currentUser?.email && (
                <p className="text-xs text-gray-400 dark:text-[#666] mt-1.5 flex items-center gap-1.5">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
                  Reporting as{' '}
                  <span className="font-medium text-gray-600 dark:text-[#aaa]">
                    {currentUser.email}
                  </span>
                </p>
              )}
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit(onSubmit)} className="px-6 py-5 space-y-4">
              {/* Title */}
              <div>
                <label className={labelCls}>
                  Title <span className="text-red-500">*</span>
                </label>
                <input
                  {...register('title')}
                  placeholder="Brief summary of the issue"
                  className={inputCls}
                />
                {errors.title && (
                  <p className="mt-1 text-xs text-red-500">{errors.title.message}</p>
                )}
              </div>

              {/* Category */}
              <div>
                <label className={labelCls}>Category</label>
                <Controller
                  name="category"
                  control={control}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="bug">Bug</SelectItem>
                        <SelectItem value="ui_issue">UI Issue</SelectItem>
                        <SelectItem value="feature_request">Feature Request</SelectItem>
                        <SelectItem value="performance">Performance</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>

              {/* Priority */}
              <div>
                <label className={labelCls}>Priority</label>
                <Controller
                  name="priority"
                  control={control}
                  render={({ field }) => (
                    <div className="grid grid-cols-4 gap-2">
                      {PRIORITIES.map(({ value, label, dot }) => {
                        const active = field.value === value;
                        return (
                          <button
                            key={value}
                            type="button"
                            onClick={() => field.onChange(value)}
                            className={[
                              'flex items-center justify-center gap-1.5 rounded border px-2 py-1.5 text-xs font-medium transition-colors',
                              active
                                ? 'border-gray-900 bg-gray-900 text-white dark:border-[#e8e8e8] dark:bg-[#e8e8e8] dark:text-black'
                                : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50 dark:border-[#2a2a2a] dark:bg-[#111111] dark:text-[#888] dark:hover:bg-[#1a1a1a]',
                            ].join(' ')}
                          >
                            <span className={`inline-block h-1.5 w-1.5 rounded-full flex-shrink-0 ${dot}`} />
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                />
              </div>

              {/* Description */}
              <div>
                <label className={labelCls}>
                  Description <span className="text-red-500">*</span>
                </label>
                <textarea
                  {...register('description')}
                  rows={3}
                  placeholder="What happened? What did you expect?"
                  className={`${inputCls} resize-none`}
                />
                {errors.description && (
                  <p className="mt-1 text-xs text-red-500">{errors.description.message}</p>
                )}
              </div>

              {/* Steps — bug only */}
              {category === 'bug' && (
                <div>
                  <label className={labelCls}>
                    Steps to Reproduce{' '}
                    <span className="font-normal text-gray-400 dark:text-[#555]">(optional)</span>
                  </label>
                  <textarea
                    {...register('steps_to_reproduce')}
                    rows={3}
                    placeholder={'1. Go to…\n2. Click on…\n3. See error'}
                    className={`${inputCls} resize-none`}
                  />
                </div>
              )}

              {/* Submit */}
              <Button
                type="submit"
                loading={isSubmitting}
                size="md"
                className="w-full"
              >
                Submit Report
              </Button>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── FAB ─────────────────────────────────────────────────────────────────────

export function IssueReporter() {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [hasMoved, setHasMoved] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  const wrapperRef = useRef<HTMLDivElement>(null);

  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
    setDragging(true);
    setHasMoved(false);
    wrapperRef.current?.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current || !dragging) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) setHasMoved(true);
    setPos({ x: dragRef.current.origX + dx, y: dragRef.current.origY + dy });
  };

  const handlePointerUp = () => {
    if (!hasMoved) setOpen(true);
    dragRef.current = null;
    setDragging(false);
  };

  return (
    <>
      <div
        ref={wrapperRef}
        className="fixed bottom-20 right-6 z-[45]"
        style={{
          transform: `translate(${pos.x}px, ${pos.y}px)`,
          cursor: dragging ? 'grabbing' : 'grab',
          touchAction: 'none',
          userSelect: 'none',
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <button
          onClick={() => {}}
          aria-label="Report an issue"
          style={dragging ? { pointerEvents: 'none' } : undefined}
          className={[
            'group relative overflow-hidden',
            'h-12 w-12 hover:w-40',
            'rounded-full bg-[#0a0a0a] hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-100',
            'text-white dark:text-black',
            'shadow-lg shadow-black/20 dark:shadow-white/10',
            'transition-[width,background-color] duration-300 ease-out-back',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-black dark:focus-visible:ring-white focus-visible:ring-offset-2',
          ].join(' ')}
        >
          {/* Sonar rings — anchored to the left circle area */}
          <span className="absolute left-0 top-0 inline-flex h-12 w-12 rounded-full bg-black/20 dark:bg-white/20 animate-pulsing-ring" style={{ animationDelay: '0s' }} />
          <span className="absolute left-0 top-0 inline-flex h-12 w-12 rounded-full bg-black/15 dark:bg-white/15 animate-pulsing-ring" style={{ animationDelay: '0.7s' }} />
          <span className="absolute left-0 top-0 inline-flex h-12 w-12 rounded-full bg-black/10 dark:bg-white/10 animate-pulsing-ring" style={{ animationDelay: '1.4s' }} />

          {/* Icon — always centered in the 48px circle */}
          <span className="absolute left-0 top-0 h-12 w-12 flex items-center justify-center">
            <Megaphone className="h-[18px] w-[18px]" style={{ transform: 'translateX(-1.5px)' }} />
          </span>

          {/* Label — fades in after circle area */}
          <span className="absolute left-12 top-0 h-12 flex items-center pr-4 whitespace-nowrap text-sm font-medium opacity-0 group-hover:opacity-100 transition-opacity duration-200 delay-100">
            Report Issue
          </span>
        </button>
      </div>

      <IssueReporterDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}

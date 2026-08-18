'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { projectsService } from '@/services';
import { Button, Textarea } from '@/components/ui';
import { useToast } from '@/hooks/use-toast';

const ml = 'text-[11px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wider';

const PLACEHOLDER = `e.g. Adults with chronic periodontitis.
Comparison of interest: scaling and root planing alone versus SRP plus systemic antibiotics.
Outcomes of interest: probing pocket depth and clinical attachment level at 3 and 6 months.`;

interface ReviewScopeSectionProps {
  projectId: string;
  reviewScope: string | null | undefined;
  onScopeChange: (scope: string | null) => void;
  editable: boolean;
}

export function ReviewScopeSection({
  projectId,
  reviewScope,
  onScopeChange,
  editable,
}: ReviewScopeSectionProps) {
  const { toast } = useToast();
  const [value, setValue] = useState(reviewScope || '');
  const [saving, setSaving] = useState(false);

  const dirty = value.trim() !== (reviewScope || '').trim();

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await projectsService.updateReviewScope(projectId, value.trim() || null);
      onScopeChange(res.review_scope ?? null);
      toast({
        title: 'Saved',
        description: 'Review scope updated. It applies to the next extraction run.',
      });
    } catch {
      toast({ title: 'Error', description: 'Failed to save review scope', variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-semibold text-gray-900 dark:text-white">Review scope</h2>
        <p className="text-[13px] text-gray-500 dark:text-zinc-400 leading-relaxed mt-1 max-w-2xl">
          Describe what this review is about — population, the comparison you care about, the
          outcomes and timepoints. Every form in this project sees it during extraction.
        </p>
      </div>

      <div className="rounded-lg border border-gray-100 dark:border-[#1f1f1f] bg-gray-50 dark:bg-[#141414] px-4 py-3">
        <p className="text-[12px] text-gray-500 dark:text-zinc-400 leading-relaxed">
          This <span className="font-semibold text-gray-700 dark:text-zinc-200">guides</span> extraction
          — it helps the model tell which arm, population or timepoint a field is asking about when a
          paper reports several. It does{' '}
          <span className="font-semibold text-gray-700 dark:text-zinc-200">not</span> filter results:
          every row found in a paper is still extracted and shown.
        </p>
      </div>

      <div>
        <label className={ml}>Scope</label>
        <Textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={PLACEHOLDER}
          rows={8}
          maxLength={4000}
          disabled={!editable || saving}
          className="resize-none text-xs mt-1.5"
        />
        <div className="flex items-center justify-between mt-1.5">
          <p className="text-[11px] text-gray-400 dark:text-zinc-500">
            {editable
              ? 'Applies to existing forms too — no need to regenerate them.'
              : 'You do not have permission to change the review scope.'}
          </p>
          <span className="text-[11px] text-gray-300 dark:text-zinc-600 tabular-nums">
            {value.length}/4000
          </span>
        </div>
      </div>

      {editable && (
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={handleSave} disabled={!dirty || saving}>
            {saving && <Loader2 size={14} className="animate-spin mr-1.5" />}
            Save scope
          </Button>
          {dirty && !saving && (
            <button
              onClick={() => setValue(reviewScope || '')}
              className="text-[12px] text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 transition-colors"
            >
              Discard
            </button>
          )}
        </div>
      )}
    </div>
  );
}

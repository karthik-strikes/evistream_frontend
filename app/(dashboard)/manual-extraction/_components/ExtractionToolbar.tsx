'use client';

import { useState } from 'react';
import { ArrowLeft, EyeOff, Sparkles, PanelLeft, ChevronDown, Check, CircleDot, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ROLE_COLORS } from '@/lib/reviewerColors';
import type { Form } from '@/types/api';

export type ExtractionMode = 'blind' | 'ai_assisted';

type FormState = 'done' | 'partial' | 'todo';

interface ExtractionToolbarProps {
  formName: string;
  docFilename: string;
  extractionMode: ExtractionMode;
  onModeChange: (mode: ExtractionMode) => void;
  onBack: () => void;
  queueOpen: boolean;
  onToggleQueue: () => void;
  showAiToggle: boolean;
  reviewerRole?: string | null;
  /**
   * The project's other forms, so a reviewer can move between the four forms
   * of one paper from here.
   *
   * There was no way to: the sidebar rail switches *documents* for the current
   * form, and Save & Next does the same, so the only route from form 1 to
   * form 2 of the same study was Back → find the paper → expand it. On a
   * four-form project that is three clicks and a scroll between every form.
   */
  forms?: Form[];
  /** formId → this reviewer's own state for it, on this paper. */
  formStates?: Record<string, FormState>;
  onSelectForm?: (form: Form) => void;
  /** This paper's assignment status, and the reviewer's switch for it. Absent
   *  when they hold no seat on the paper (browsing), where there is nothing to
   *  declare finished. */
  paperStatus?: string | null;
  onSetPaperStatus?: (next: 'completed' | 'in_progress') => void;
  settingPaperStatus?: boolean;
}

/** One form in the switcher, with the same three marks the queue strip uses. */
function StateDot({ state }: { state: FormState }) {
  if (state === 'done') {
    return (
      <span className="w-4 h-4 rounded-full bg-emerald-500 flex items-center justify-center shrink-0">
        <Check size={9} className="text-white" strokeWidth={3} />
      </span>
    );
  }
  if (state === 'partial') {
    return (
      <span className="w-4 h-4 rounded-full bg-blue-100 dark:bg-blue-400/15 border border-blue-300 dark:border-blue-500/40 flex items-center justify-center shrink-0">
        <CircleDot size={9} className="text-blue-600 dark:text-blue-400" />
      </span>
    );
  }
  return <span className="w-4 h-4 rounded-full border border-gray-300 dark:border-[#2a2a2a] shrink-0" />;
}

function FormSwitcher({
  formName, forms, formStates, onSelectForm, paperStatus, onSetPaperStatus, settingPaperStatus,
}: {
  formName: string;
  forms: Form[];
  formStates: Record<string, FormState>;
  onSelectForm: (form: Form) => void;
  paperStatus?: string | null;
  onSetPaperStatus?: ((next: 'completed' | 'in_progress') => void) | undefined;
  settingPaperStatus?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const done = forms.filter(f => formStates[f.id] === 'done').length;
  const finished = paperStatus === 'completed';

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        title="Switch to another form on this paper"
        className="flex items-center gap-1.5 text-xs font-medium text-gray-600 dark:text-zinc-300 bg-gray-100 dark:bg-[#1a1a1a] hover:bg-gray-200 dark:hover:bg-[#222] border-none cursor-pointer px-2 py-0.5 rounded-md transition-colors"
      >
        <span className="truncate max-w-[220px]">{formName}</span>
        <span className="tabular-nums text-[10.5px] text-gray-400 dark:text-zinc-500">{done}/{forms.length}</span>
        <ChevronDown className={cn('w-3 h-3 text-gray-400 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute top-[calc(100%+4px)] left-0 z-40 min-w-[280px] bg-white dark:bg-[#141414] border border-gray-200 dark:border-[#2a2a2a] rounded-xl shadow-xl p-1">
            <p className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-500">
              Forms on this paper
            </p>
            {forms.map(f => (
              <button
                key={f.id}
                type="button"
                onClick={() => { setOpen(false); onSelectForm(f); }}
                className={cn(
                  'w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left transition-colors',
                  'hover:bg-gray-50 dark:hover:bg-[#1f1f1f]',
                )}
              >
                <StateDot state={formStates[f.id] ?? 'todo'} />
                <span className={cn(
                  'text-[12.5px] truncate flex-1 min-w-0',
                  f.form_name === formName
                    ? 'font-semibold text-gray-900 dark:text-white'
                    : 'font-medium text-gray-700 dark:text-zinc-300',
                )}>
                  {f.form_name}
                </span>
              </button>
            ))}

            {/* Finishing the paper belongs next to the list of what finishing
                it means — and this is where the reviewer is standing when they
                save the last form. */}
            {onSetPaperStatus && (
              <div className="mt-1 border-t border-gray-100 dark:border-[#1f1f1f] pt-1">
                <button
                  type="button"
                  disabled={settingPaperStatus}
                  onClick={() => {
                    if (!finished && done < forms.length) {
                      const left = forms.length - done;
                      const ok = window.confirm(
                        `${left} of ${forms.length} form${forms.length === 1 ? '' : 's'} `
                        + `${left === 1 ? 'has' : 'have'} nothing saved for this paper. `
                        + 'Mark it finished anyway?',
                      );
                      if (!ok) return;
                    }
                    setOpen(false);
                    onSetPaperStatus(finished ? 'in_progress' : 'completed');
                  }}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-[12.5px] font-semibold text-gray-800 dark:text-zinc-200 hover:bg-gray-50 dark:hover:bg-[#1f1f1f] disabled:opacity-50 transition-colors"
                >
                  {settingPaperStatus && <Loader2 className="w-3 h-3 animate-spin" />}
                  {finished ? 'Reopen this paper' : 'Mark this paper complete'}
                </button>
                <p className="px-2 pb-1 text-[10.5px] text-gray-400 dark:text-zinc-600">
                  {finished
                    ? 'You marked it finished. Reopening puts it back on your queue.'
                    : 'Saving a form keeps your work; this is what says you are done.'}
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// Role hues from lib/reviewerColors — R2 was emerald, which collides with the
// app's "done / agreed" green.
const ROLE_PILL: Record<string, { label: string; cls: string }> = {
  reviewer_1:  { label: 'R1',  cls: ROLE_COLORS.reviewer_1.pill },
  reviewer_2:  { label: 'R2',  cls: ROLE_COLORS.reviewer_2.pill },
  adjudicator: { label: 'Adjudicator', cls: ROLE_COLORS.adjudicator.pill },
};

export function ExtractionToolbar({
  formName,
  docFilename,
  extractionMode,
  onModeChange,
  onBack,
  queueOpen,
  onToggleQueue,
  showAiToggle,
  reviewerRole,
  forms,
  formStates,
  onSelectForm,
  paperStatus,
  onSetPaperStatus,
  settingPaperStatus,
}: ExtractionToolbarProps) {
  const rolePill = reviewerRole ? ROLE_PILL[reviewerRole] : null;
  const canSwitch = !!forms && forms.length > 1 && !!onSelectForm;
  return (
    <div className="flex items-center gap-2 mb-3 flex-wrap">
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200 bg-transparent border-none cursor-pointer transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Back
      </button>

      {rolePill && (
        <>
          <span className="text-gray-300 dark:text-zinc-700 text-xs">·</span>
          <span className={cn('inline-flex items-center text-[10px] font-semibold rounded-full px-2 py-0.5', rolePill.cls)} title={`Extracting as ${rolePill.label}`}>
            {rolePill.label}
          </span>
        </>
      )}

      <span className="text-gray-300 dark:text-zinc-700 text-xs">·</span>
      {canSwitch ? (
        <FormSwitcher
          formName={formName}
          forms={forms!}
          formStates={formStates ?? {}}
          onSelectForm={onSelectForm!}
          paperStatus={paperStatus}
          onSetPaperStatus={onSetPaperStatus}
          settingPaperStatus={settingPaperStatus}
        />
      ) : (
        <span className="text-xs font-medium text-gray-500 dark:text-zinc-400 bg-gray-100 dark:bg-[#1a1a1a] px-2 py-0.5 rounded-md">{formName}</span>
      )}
      <span className="text-gray-300 dark:text-zinc-700 text-xs">·</span>
      <span className="text-xs font-medium text-gray-500 dark:text-zinc-400 bg-gray-100 dark:bg-[#1a1a1a] px-2 py-0.5 rounded-md truncate max-w-[220px]">{docFilename}</span>

      <div className="ml-auto flex items-center gap-2">
        {/* Queue toggle */}
        <button
          onClick={onToggleQueue}
          className={cn(
            "flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md border cursor-pointer transition-colors",
            queueOpen
              ? "text-gray-800 dark:text-zinc-200 bg-gray-100 dark:bg-[#1f1f1f] border-gray-300 dark:border-[#3a3a3a]"
              : "text-gray-500 dark:text-zinc-400 bg-transparent border-gray-200 dark:border-[#2a2a2a] hover:bg-gray-50 dark:hover:bg-[#1a1a1a]"
          )}
        >
          <PanelLeft className="w-3 h-3" />
          Queue
        </button>

        {/* AI mode toggle — only shown when AI results exist */}
        {showAiToggle && (
          <div className="flex items-center rounded-lg border border-gray-200 dark:border-[#2a2a2a] overflow-hidden">
            <button
              onClick={() => onModeChange('blind')}
              className={cn(
                "flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 cursor-pointer transition-colors border-none",
                extractionMode === 'blind'
                  ? "bg-gray-900 dark:bg-zinc-100 text-white dark:text-gray-900"
                  : "bg-white dark:bg-[#111111] text-gray-500 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-[#1a1a1a]"
              )}
            >
              <EyeOff className="w-3 h-3" />
              Blind
            </button>
            <button
              onClick={() => onModeChange('ai_assisted')}
              className={cn(
                "flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 cursor-pointer transition-colors border-none",
                extractionMode === 'ai_assisted'
                  ? "bg-gray-900 dark:bg-zinc-100 text-white dark:text-gray-900"
                  : "bg-white dark:bg-[#111111] text-gray-500 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-[#1a1a1a]"
              )}
            >
              <Sparkles className="w-3 h-3" />
              AI Assisted
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

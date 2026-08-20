'use client';

import { useMemo, useState } from 'react';
import { FileUp, Loader2, Sparkles } from 'lucide-react';
import { projectsService } from '@/services';
import { Button, Textarea } from '@/components/ui';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { ScopeChipField } from './ScopeChipField';
import { ScopeSuggestionDialog } from './ScopeSuggestionDialog';
import {
  EMPTY_DRAFT,
  EXAMPLE_DRAFT,
  FAMILIES,
  SCOPE_MAX,
  activePairs,
  composeScope,
  draftFromApi,
  draftToApi,
  isDraftEmpty,
  isScopeOverloaded,
  mergeChips,
  pairKey,
  type ReviewScopeDraft,
  type ReviewScopeStructured,
  type ScopeListKey,
  type SuggestedScopeChip,
} from '@/lib/reviewScope';

const ml = 'text-[11px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wider';

const PLACEHOLDER = `e.g. Adults with chronic periodontitis.
Comparison of interest: scaling and root planing alone versus SRP plus systemic antibiotics.
Outcomes of interest: probing pocket depth and clinical attachment level at 3 and 6 months.`;

type Mode = 'guided' | 'free';

interface ReviewScopeSectionProps {
  projectId: string;
  reviewScope: string | null | undefined;
  reviewScopeStructured?: ReviewScopeStructured | null;
  onScopeChange: (scope: string | null) => void;
  editable: boolean;
}

export function ReviewScopeSection({
  projectId,
  reviewScope,
  reviewScopeStructured,
  onScopeChange,
  editable,
}: ReviewScopeSectionProps) {
  const { toast } = useToast();

  // What is on the server, tracked locally rather than read from props: the
  // parent refreshes the project list asynchronously after a save, so comparing
  // against props would flash "Unsaved" on a scope that just saved fine.
  const [saved, setSaved] = useState(() => ({
    scope: (reviewScope || '').trim(),
    structured: reviewScopeStructured ?? null,
  }));
  const savedDraft = useMemo(() => draftFromApi(saved.structured), [saved.structured]);

  // A project that was last saved from the builder reopens in it. Anything
  // else — a hand-typed scope, or a scope from before the builder existed —
  // opens as free text, because its chips cannot be recovered from the prose.
  const [mode, setMode] = useState<Mode>(
    savedDraft ? 'guided' : reviewScope?.trim() ? 'free' : 'guided'
  );
  const [draft, setDraft] = useState<ReviewScopeDraft>(savedDraft || EMPTY_DRAFT);
  const [text, setText] = useState(reviewScope || '');
  const [saving, setSaving] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);

  const composed = useMemo(() => composeScope(draft), [draft]);
  const guidedEmpty = isDraftEmpty(draft);
  const pairs = useMemo(() => activePairs(draft), [draft]);
  const offSet = useMemo(() => new Set(draft.pairsOff), [draft.pairsOff]);
  const chosenCount = pairs.filter(([a, b]) => !offSet.has(pairKey(a, b))).length;

  const value = mode === 'guided' ? composed : text.trim();
  const tooLong = value.length > SCOPE_MAX;
  // Switching mode is itself a change worth saving even when the text is
  // identical: saving from free text is what clears the stored chips, and
  // without this the "convert this back to free text" path has Save greyed out.
  const modeChanged = (mode === 'guided') !== !!savedDraft;
  const dirty = value !== saved.scope || (!!value && modeChanged);

  const setList = (key: ScopeListKey, next: string[]) =>
    setDraft((d) => ({ ...d, [key]: next }));

  const togglePair = (a: string, b: string) => {
    const key = pairKey(a, b);
    setDraft((d) => ({
      ...d,
      pairsOff: d.pairsOff.includes(key)
        ? d.pairsOff.filter((k) => k !== key)
        : [...d.pairsOff, key],
    }));
  };

  const switchMode = (next: Mode) => {
    if (next === mode) return;
    // Guided → free hands over the composed text so nothing is lost. Free →
    // guided cannot go the other way (prose doesn't parse back into chips), so
    // the builder starts from whatever chips were last saved.
    if (next === 'free') setText(composed || text);
    setMode(next);
  };

  /**
   * Suggestions land in the builder as an unsaved draft — never on the server.
   * `setMode('guided')` directly rather than `switchMode('guided')`, which
   * re-seeds the draft from the last SAVED chips and would throw these away.
   */
  const handleSuggested = (chips: SuggestedScopeChip[], how: 'merge' | 'replace') => {
    setDraft((d) => mergeChips(d, chips, how));
    setMode('guided');
    setSuggestOpen(false);
    toast({
      title: `${chips.length} ${chips.length === 1 ? 'entry' : 'entries'} added`,
      description: 'Check them over and edit anything that is off, then save.',
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const scope = value || null;
      const structured = mode === 'guided' && !guidedEmpty ? draftToApi(draft) : null;
      const res = await projectsService.updateReviewScope(projectId, scope, structured);
      setSaved({
        scope: res.review_scope ?? '',
        structured: res.review_scope_structured ?? null,
      });
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

  const shape = [
    { label: 'Populations', count: draft.populations.length, note: draft.populations.length > 1 ? 'model resolves subgroups per paper' : '', tint: FAMILIES[0].badge },
    { label: 'Interventions', count: draft.interventions.length, note: '', tint: FAMILIES[1].badge },
    { label: 'Comparisons', count: chosenCount, note: pairs.length > 1 ? `of ${pairs.length} possible pairs` : '', tint: FAMILIES[2].badge },
    { label: 'Outcomes', count: draft.outcomes.length, note: '', tint: FAMILIES[3].badge },
    { label: 'Timepoints', count: draft.timepoints.length, note: '', tint: FAMILIES[4].badge },
  ];

  const status = !value ? 'Not set' : dirty ? 'Unsaved' : 'Set';
  const statusTint =
    status === 'Set'
      ? 'bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-300'
      : status === 'Unsaved'
        ? 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300'
        : 'bg-gray-50 text-gray-400 dark:bg-[#1a1a1a] dark:text-zinc-500';

  const footerNote = tooLong
    ? `Too long by ${value.length - SCOPE_MAX} characters — shorten some entries before saving.`
    : mode === 'guided' && isScopeOverloaded(draft)
      ? `This scope spans ${draft.interventions.length} interventions × ${draft.outcomes.length} outcomes — consider splitting into two projects sharing this library.`
      : 'Applies to the next extraction run — existing forms need no regeneration.';

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">Review scope</h2>
            <span className={cn('text-[11px] font-semibold px-2 py-0.5 rounded-full', statusTint)}>
              {status}
            </span>
          </div>
          <p className="text-[13px] text-gray-500 dark:text-zinc-400 leading-relaxed mt-1 max-w-2xl">
            Describe what this review is about — population, the comparisons you care about, the
            outcomes and timepoints. Every form in this project sees it during extraction.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {editable && (
            <button
              onClick={() => setSuggestOpen(true)}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-[#2a2a2a] px-2.5 py-1.5 text-[11px] font-semibold text-gray-600 dark:text-zinc-300 hover:bg-black/[0.025] dark:hover:bg-white/[0.03] transition-colors disabled:opacity-40"
            >
              <FileUp size={12} />
              Read from a document
            </button>
          )}
          <div className="inline-flex rounded-lg border border-gray-200 dark:border-[#2a2a2a] overflow-hidden">
          {(['guided', 'free'] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => switchMode(m)}
              className={cn(
                'px-3 py-1.5 text-[11px] font-semibold transition-colors',
                mode === m
                  ? 'bg-gray-900 text-white dark:bg-white dark:text-black'
                  : 'text-gray-500 dark:text-zinc-400 hover:bg-black/[0.025] dark:hover:bg-white/[0.03]'
              )}
            >
              {m === 'guided' ? 'Guided' : 'Free text'}
            </button>
          ))}
          </div>
        </div>
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

      {mode === 'guided' ? (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-6">
          {/* ---- chips ---- */}
          <div className="space-y-4">
            {FAMILIES.map((f) => (
              <ScopeChipField
                key={f.key}
                label={f.label}
                hint={f.hint}
                placeholder={f.placeholder}
                chipClass={f.chip}
                values={draft[f.key]}
                onChange={(next) => setList(f.key, next)}
                disabled={!editable || saving}
              />
            ))}

            {pairs.length > 1 && (
              <div className="rounded-lg border border-blue-100 dark:border-blue-900/40 bg-blue-50/50 dark:bg-blue-950/10 px-4 py-3">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-[12px] font-semibold text-blue-700 dark:text-blue-300">
                    Comparisons that matter
                  </span>
                  <span className="text-[11px] text-gray-500 dark:text-zinc-400">
                    you listed several interventions — which head-to-heads should the model prioritise?
                  </span>
                </div>
                <div className="flex flex-wrap gap-2 mt-2.5">
                  {pairs.map(([a, b]) => {
                    const on = !offSet.has(pairKey(a, b));
                    return (
                      <button
                        key={pairKey(a, b)}
                        onClick={() => togglePair(a, b)}
                        disabled={!editable || saving}
                        className={cn(
                          'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors disabled:cursor-default',
                          on
                            ? 'border-blue-200 dark:border-blue-800/60 bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300'
                            : 'border-gray-200 dark:border-[#2a2a2a] bg-white dark:bg-[#141414] text-gray-400 dark:text-zinc-500'
                        )}
                      >
                        <span
                          className={cn(
                            'w-3.5 h-3.5 rounded-[4px] border flex items-center justify-center text-[9px] font-bold text-white',
                            on
                              ? 'bg-blue-500 border-blue-500'
                              : 'bg-transparent border-gray-300 dark:border-[#3a3a3a]'
                          )}
                        >
                          {on ? '✓' : ''}
                        </span>
                        {a} vs {b}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[11px] text-gray-500 dark:text-zinc-400 mt-2.5 leading-relaxed">
                  Unticked pairs are still extracted when papers report them — this only tells the
                  model which contrasts your effect fields refer to.
                </p>
              </div>
            )}
          </div>

          {/* ---- shape + preview ---- */}
          <div className="space-y-5 lg:border-l lg:border-gray-100 lg:dark:border-[#1f1f1f] lg:pl-5">
            <div>
              <p className={ml}>Scope shape</p>
              <div className="space-y-1.5 mt-2">
                {shape.map((s) => (
                  <div key={s.label} className="flex items-center gap-2">
                    <span
                      className={cn(
                        'min-w-[22px] px-1.5 h-[17px] rounded-full inline-flex items-center justify-center text-[10px] font-bold tabular-nums',
                        s.count
                          ? s.tint
                          : 'bg-gray-100 text-gray-400 dark:bg-[#1a1a1a] dark:text-zinc-600'
                      )}
                    >
                      {s.count}
                    </span>
                    <span className="text-[12px] text-gray-600 dark:text-zinc-300">{s.label}</span>
                    <span className="text-[11px] text-gray-400 dark:text-zinc-500">{s.note}</span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <p className={ml}>What the model will see</p>
              <div className="mt-2 rounded-lg border border-gray-200 dark:border-[#2a2a2a] bg-white dark:bg-[#111111] px-3.5 py-3 min-h-[130px] font-mono text-[11px] leading-[1.8] whitespace-pre-line break-words">
                {composed ? (
                  <span className="text-gray-700 dark:text-zinc-300">{composed}</span>
                ) : (
                  <span className="text-gray-300 dark:text-zinc-600">
                    Scope preview appears here as you add entries.
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between mt-1.5 text-[11px]">
                <span className="text-gray-400 dark:text-zinc-500">
                  Injected into every extraction prompt
                </span>
                <span
                  className={cn(
                    'tabular-nums',
                    tooLong ? 'text-red-500 font-semibold' : 'text-gray-300 dark:text-zinc-600'
                  )}
                >
                  {composed.length}/{SCOPE_MAX}
                </span>
              </div>
            </div>

            {editable && (
              <button
                onClick={() => setDraft(EXAMPLE_DRAFT)}
                disabled={saving}
                className="inline-flex items-center gap-1.5 text-[12px] font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
              >
                <Sparkles size={12} />
                Fill with a multi-arm example
              </button>
            )}
          </div>
        </div>
      ) : (
        <div>
          <label className={ml}>Scope</label>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={PLACEHOLDER}
            rows={8}
            maxLength={SCOPE_MAX}
            disabled={!editable || saving}
            className="resize-none text-xs mt-1.5"
          />
          <div className="flex items-center justify-between mt-1.5">
            <p className="text-[11px] text-gray-400 dark:text-zinc-500">
              Saving as free text clears the guided builder’s entries for this project.
            </p>
            <span className="text-[11px] text-gray-300 dark:text-zinc-600 tabular-nums">
              {text.length}/{SCOPE_MAX}
            </span>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-4 flex-wrap pt-1 border-t border-gray-100 dark:border-[#1f1f1f]">
        <p
          className={cn(
            'text-[12px] pt-3',
            tooLong ? 'text-red-500' : 'text-gray-500 dark:text-zinc-400'
          )}
        >
          {editable ? footerNote : 'You do not have permission to change the review scope.'}
        </p>
        {editable && (
          <div className="flex items-center gap-3 pt-3">
            <button
              onClick={() => {
                setDraft(EMPTY_DRAFT);
                setText('');
              }}
              disabled={saving || !value}
              className="text-[12px] text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 transition-colors disabled:opacity-40 disabled:hover:text-gray-400"
            >
              Clear all
            </button>
            <Button size="sm" onClick={handleSave} disabled={!dirty || saving || tooLong}>
              {saving && <Loader2 size={14} className="animate-spin mr-1.5" />}
              Save scope
            </Button>
          </div>
        )}
      </div>

      <ScopeSuggestionDialog
        open={suggestOpen}
        projectId={projectId}
        draft={draft}
        onClose={() => setSuggestOpen(false)}
        onAccept={handleSuggested}
      />
    </div>
  );
}

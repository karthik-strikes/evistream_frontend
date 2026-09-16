'use client';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui';
import { GroupScopeSection } from '@/components/forms/GroupScopeSection';
import type { FormField, SuggestGroupsResponse } from '@/types/api';
import { groupsOf } from '@/lib/fieldScopes';

/** Saving a table's grouping. Absent when the reviewer lacks
 *  `can_create_forms` — the same permission the PATCH enforces, so the
 *  affordance and the server agree. */
export interface GroupingProps {
  /** `${formId}:${fieldName}` while that one field is being written. Keyed by
   *  form because two forms in a project routinely share a field name. */
  savingField: string | null;
  /** Resolves true when the change was persisted. The dialog stays open on
   *  false so a failed save does not discard the tagging just entered.
   *
   *  The form is named explicitly rather than taken from whatever form the page
   *  has selected: the queue's grouping nudge scans every form in the project,
   *  so the table being configured is often not the selected one — and on the
   *  queue screen there may be no selection at all. */
  onSave: (
    formId: string,
    fieldName: string,
    next: { groups: string[]; columnScopes: Record<string, string> },
  ) => Promise<boolean>;
  /** Ask the model to propose the tagging. Returns null when it could not be
   *  reached — the panel keeps whatever the reviewer already had. */
  onSuggest: (formId: string, fieldName: string) => Promise<SuggestGroupsResponse | null>;
}

/**
 * Set up a table's grouping.
 *
 * This lives in manual extraction rather than the form builder because the
 * person who knows that "scale range" is a property of the scale is the
 * reviewer being asked for it a fourth time — not whoever authored the form
 * weeks earlier. It sits on the *form picker* rather than on the extraction
 * screen itself: it is configuration, done once per form, and a button offering
 * it again on every paper is noise on the ninety-ninth document.
 */
export function GroupSetupDialog({
  field, onClose, onSave, onSuggest, saving,
}: {
  /** The table field being configured, or null when the dialog is closed. */
  field: FormField | null;
  onClose: () => void;
  onSave: (fieldName: string, next: { groups: string[]; columnScopes: Record<string, string> }) => void;
  onSuggest: (fieldName: string) => Promise<SuggestGroupsResponse | null>;
  saving?: boolean;
}) {
  return (
    <Dialog open={!!field} onOpenChange={open => { if (!open && !saving) onClose(); }}>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="capitalize">
            Grouping — {(field?.field_name ?? '').replace(/_/g, ' ')}
          </DialogTitle>
          <DialogDescription>
            Applies to this form for everyone. It changes how the form asks for a value, never
            what was already extracted — saved rows are untouched and exports are unchanged.
          </DialogDescription>
        </DialogHeader>

        {field && (
          <GroupScopeSection
            key={field.field_name}
            subformFields={field.subform_fields ?? []}
            groups={groupsOf(field)}
            onSave={next => onSave(field.field_name, next)}
            onSuggest={() => onSuggest(field.field_name)}
            saving={saving}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type ComponentProps } from 'react';
import type { ErrorIssue } from '@roller-bay/shared/errors';
import type {
  UpdateWorkOrder,
  WorkOrder,
} from '@roller-bay/shared/work-orders';
import { Button } from '@/components/ui/button';
import { ErrorNotice } from '@/components/ui/feedback';
import { Input } from '@/components/ui/input';
import { issuePath } from '@/lib/errors';
import { fieldIssues } from '@/lib/field-issues';
import { updateOrder, workOrdersKey } from './work-orders.api';

type Field = 'quantity' | 'note';

/**
 * One of an order's own fields, edited where it is shown. The edit keeps
 * the revision it started from, so a refetch neither replaces the typed
 * value nor lets the save overwrite a change nobody saw.
 */
export function OrderField({
  order,
  field,
  label,
  display,
  editable,
  note,
  inputMode,
  maxLength,
  sanitize = (text) => text,
  validate = () => undefined,
  body,
}: {
  order: WorkOrder;
  field: Field;
  label: string;
  display: string;
  editable: boolean;
  /** A short line under the value, such as why it cannot be edited. */
  note?: string;
  inputMode?: ComponentProps<'input'>['inputMode'];
  maxLength?: number;
  sanitize?: (text: string) => string;
  validate?: (text: string) => string | undefined;
  body: (text: string) => Partial<UpdateWorkOrder>;
}) {
  const id = useId();
  const [draft, setDraft] = useState<{
    text: string;
    revision: number;
  } | null>(null);
  const [invalid, setInvalid] = useState<string>();
  // Leaving an edit returns focus to the button that started it.
  const editButton = useRef<HTMLButtonElement>(null);
  const returning = useRef(false);
  useEffect(() => {
    if (!draft && returning.current) {
      returning.current = false;
      editButton.current?.focus();
    }
  }, [draft]);
  const client = useQueryClient();
  const save = useMutation({
    mutationFn: ({ text, revision }: { text: string; revision: number }) =>
      updateOrder(order.id, { expectedRevision: revision, ...body(text) }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: workOrdersKey });
      setDraft(null);
      returning.current = true;
    },
  });
  const placed = (issue: ErrorIssue) => issuePath(issue) === field;
  const error =
    invalid ??
    fieldIssues(save.error, (issue) => (placed(issue) ? field : null))[field];
  const close = () => {
    setDraft(null);
    returning.current = true;
    setInvalid(undefined);
    save.reset();
  };
  if (!draft)
    return (
      <div>
        <div className="detail-label">{label}</div>
        <div className="detail-value inline-actions">
          <span>{display}</span>
          {editable && (
            <Button
              ref={editButton}
              variant="ghost"
              size="sm"
              aria-label={`Edit ${label.toLowerCase()}`}
              onClick={() =>
                setDraft({
                  text: initialText(order, field),
                  revision: order.revision,
                })
              }
            >
              Edit
            </Button>
          )}
        </div>
        {note && <small className="detail-note">{note}</small>}
      </div>
    );
  return (
    <div>
      <label className="detail-label" htmlFor={id}>
        {label}
      </label>
      <form
        className="inline-edit"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            // Leaves the edit, not an enclosing dialog.
            event.preventDefault();
            close();
          }
        }}
        onSubmit={(event) => {
          event.preventDefault();
          const problem = validate(draft.text);
          setInvalid(problem);
          if (!problem && !save.isPending) save.mutate(draft);
        }}
      >
        <Input
          id={id}
          value={draft.text}
          autoFocus
          inputMode={inputMode}
          maxLength={maxLength}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(event) => {
            setDraft({ ...draft, text: sanitize(event.target.value) });
            setInvalid(undefined);
            save.reset();
          }}
        />
        <Button type="submit" size="sm" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={save.isPending}
          onClick={close}
        >
          Cancel
        </Button>
      </form>
      {error && (
        <small className="field-error" id={`${id}-error`}>
          {error}
        </small>
      )}
      {save.error && <ErrorNotice error={save.error} inline={placed} />}
    </div>
  );
}

const initialText = (order: WorkOrder, field: Field) =>
  field === 'quantity' ? String(order.quantity) : (order.note ?? '');

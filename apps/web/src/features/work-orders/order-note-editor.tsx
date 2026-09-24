'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import type { ErrorIssue } from '@roller-bay/shared/errors';
import type { WorkOrder } from '@roller-bay/shared/work-orders';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { ErrorNotice } from '@/components/ui/feedback';
import { TextField } from '@/components/ui/field';
import { issuePath } from '@/lib/errors';
import { showFieldIssues } from '@/lib/field-issues';
import { workOrdersKey, updateOrder } from './work-orders.api';

const formSchema = z.object({ note: z.string().trim().max(1000) });
type OrderFields = z.input<typeof formSchema>;
type OrderForm = z.output<typeof formSchema>;
const fieldName = (issue: ErrorIssue) =>
  issuePath(issue) === 'note' ? ('note' as const) : null;

/**
 * An order's note, the one field of its own that can be edited. The order is
 * created, and its blinds entered, where its fabric is allocated; its ship
 * date is set once that is done.
 */
export function OrderNoteEditor({
  order,
  close,
}: {
  order: WorkOrder;
  close: () => void;
}) {
  // Pin the record this form opened with: a background refetch must not swap
  // in a newer revision and let the save overwrite a change nobody saw.
  const [opened] = useState(order);
  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: { note: opened.note ?? '' },
  });
  const values = useWatch({ control: form.control }) as OrderFields;
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: (data: OrderForm) =>
      updateOrder(opened.id, {
        expectedRevision: opened.revision,
        note: data.note,
      }),
    onError: (error) => showFieldIssues(form, error, fieldName),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: workOrdersKey });
      close();
    },
  });
  const { errors } = form.formState;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) close();
      }}
      title={`Note for order ${opened.orderNumber}`}
    >
      <form onSubmit={form.handleSubmit((data) => mutation.mutate(data))}>
        <TextField
          label="Note"
          value={values.note}
          onChange={(v) => {
            form.setValue('note', v);
            form.clearErrors('note');
          }}
          error={errors.note?.message}
          maxLength={1000}
        />
        {mutation.error && (
          <ErrorNotice
            error={mutation.error}
            inline={(issue) => fieldName(issue) !== null}
          />
        )}
        <div className="form-actions">
          <Button
            type="button"
            variant="outline"
            onClick={close}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : 'Save note'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

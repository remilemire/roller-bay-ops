'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import type { ErrorIssue } from '@roller-bay/shared/errors';
import {
  orderQuantitySchema,
  type WorkOrder,
} from '@roller-bay/shared/work-orders';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { ErrorNotice } from '@/components/ui/feedback';
import { TextField } from '@/components/ui/field';
import { issuePath } from '@/lib/errors';
import { showFieldIssues } from '@/lib/field-issues';
import { workOrdersKey, updateOrder } from './work-orders.api';

const formSchema = z.object({
  quantity: z.string().transform(Number).pipe(orderQuantitySchema),
  note: z.string().trim().max(1000),
});
type OrderFields = z.input<typeof formSchema>;
type OrderForm = z.output<typeof formSchema>;
const fieldName = (issue: ErrorIssue) => {
  const path = issuePath(issue);
  return path === 'note' || path === 'quantity' ? path : null;
};

/**
 * An order's own editable fields: its blind count and note. The number is
 * fixed, and the ship date has its own dialog. The count is fixed while the
 * order has an allocation, whose blinds were checked against it.
 */
export function OrderEditor({
  order,
  close,
}: {
  order: WorkOrder;
  close: () => void;
}) {
  // Pin the record this form opened with: a background refetch must not swap
  // in a newer revision and let the save overwrite a change nobody saw.
  const [opened] = useState(order);
  const form = useForm<OrderFields, unknown, OrderForm>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      quantity: String(opened.quantity),
      note: opened.note ?? '',
    },
  });
  const values = useWatch({ control: form.control }) as OrderFields;
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: (data: OrderForm) =>
      updateOrder(opened.id, {
        expectedRevision: opened.revision,
        // An unchanged count is left out, so an allocated order saves its note.
        quantity: data.quantity === opened.quantity ? undefined : data.quantity,
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
      title={`Edit order ${opened.orderNumber}`}
    >
      <form
        className="form-stack"
        onSubmit={form.handleSubmit((data) => mutation.mutate(data))}
      >
        <TextField
          label="Blinds"
          value={values.quantity}
          onChange={(v) => {
            form.setValue('quantity', v.replace(/\D/g, ''));
            form.clearErrors('quantity');
          }}
          disabled={Boolean(opened.allocatedAt)}
          hint={
            opened.allocatedAt
              ? 'Fixed while the order has an allocation.'
              : undefined
          }
          error={errors.quantity && 'Enter a whole number from 1 to 10,000.'}
          maxLength={5}
          inputMode="numeric"
        />
        <TextField
          label="Note"
          value={values.note}
          onChange={(v) => {
            form.setValue('note', v);
            form.clearErrors('note');
          }}
          error={errors.note?.message}
          optional
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
            {mutation.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

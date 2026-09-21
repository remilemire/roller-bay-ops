'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import type { ErrorIssue } from '@roller-bay/shared/errors';
import {
  orderNumberSchema,
  type WorkOrder,
} from '@roller-bay/shared/work-orders';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { ErrorNotice } from '@/components/ui/feedback';
import { TextField } from '@/components/ui/field';
import { issuePath } from '@/lib/errors';
import { showFieldIssues } from '@/lib/field-issues';
import { createOrder, workOrdersKey, updateOrder } from './work-orders.api';

const formSchema = z.object({
  orderNumber: orderNumberSchema,
  note: z.string().trim().max(1000),
});
type OrderFields = z.input<typeof formSchema>;
type OrderForm = z.output<typeof formSchema>;
const FIELDS = ['orderNumber', 'note'] as const;
const fieldName = (issue: ErrorIssue) =>
  FIELDS.find((field) => field === issuePath(issue)) ?? null;

/**
 * An order's number and note. Its blinds are entered where its fabric is
 * allocated, and its ship date is set once that is done.
 */
export function OrderEditor({
  order,
  close,
}: {
  order?: WorkOrder;
  close: () => void;
}) {
  // Pin the record this form opened with: a background refetch must not swap
  // in a newer revision and let the save overwrite a change nobody saw.
  const [opened] = useState(order);
  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: {
      orderNumber: opened?.orderNumber ?? '',
      note: opened?.note ?? '',
    },
  });
  const values = useWatch({ control: form.control }) as OrderFields;
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: (data: OrderForm) =>
      opened
        ? updateOrder(opened.id, {
            expectedRevision: opened.revision,
            note: data.note,
          })
        : createOrder(data),
    onError: (error) => showFieldIssues(form, error, fieldName),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: workOrdersKey });
      close();
    },
  });
  const { errors } = form.formState;
  const set = (name: keyof OrderFields, value: string) => {
    form.setValue(name, value);
    form.clearErrors(name);
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) close();
      }}
      title={opened ? `Edit order ${opened.orderNumber}` : 'Add order'}
      description={
        opened
          ? undefined
          : 'The order number cannot be changed later. Its blinds are entered when allocating fabric, and a ship date follows.'
      }
    >
      <form onSubmit={form.handleSubmit((data) => mutation.mutate(data))}>
        <div className="stack">
          {!opened && (
            <TextField
              label="Order number"
              value={values.orderNumber}
              onChange={(v) => set('orderNumber', v.replace(/\D/g, ''))}
              error={errors.orderNumber?.message}
              required
              maxLength={6}
              inputMode="numeric"
              hint="6 digits"
            />
          )}
          <TextField
            label="Note"
            value={values.note}
            onChange={(v) => set('note', v)}
            error={errors.note?.message}
            maxLength={1000}
          />
        </div>
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
            {mutation.isPending ? 'Saving…' : 'Save order'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

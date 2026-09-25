'use client';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { ErrorIssue } from '@roller-bay/shared/errors';
import {
  orderNumberSchema,
  orderQuantitySchema,
  type WorkOrder,
} from '@roller-bay/shared/work-orders';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { ErrorNotice } from '@/components/ui/feedback';
import { TextField } from '@/components/ui/field';
import { useCanManage } from '@/features/auth';
import { ApiError } from '@/lib/api';
import { issuePath } from '@/lib/errors';
import { fieldIssues } from '@/lib/field-issues';
import { createOrder, orderList, workOrdersKey } from './work-orders.api';

type Fields = { orderNumber: string; quantity: string; note: string };
const fieldName = (issue: ErrorIssue) => {
  const path = issuePath(issue);
  return path === 'orderNumber' || path === 'quantity' || path === 'note'
    ? path
    : null;
};

/**
 * Adds an order: its number and how many blinds it has, sent as a request of
 * its own. It is not an allocation; the blinds and their fabric are planned
 * against the order afterwards, and its ship date follows that.
 */
export function OrderCreateForm({
  onCreated,
  onCancel,
}: {
  onCreated: (order: WorkOrder) => void;
  onCancel?: () => void;
}) {
  // A note stays with admins; the API refuses one from anyone else.
  const canManage = useCanManage();
  const [fields, setFields] = useState<Fields>({
    orderNumber: '',
    quantity: '',
    note: '',
  });
  const client = useQueryClient();
  const create = useMutation({
    mutationFn: async (input: Fields) => {
      try {
        return {
          created: await createOrder({
            orderNumber: input.orderNumber,
            quantity: Number(input.quantity),
            note: canManage ? input.note : null,
          }),
        };
      } catch (error) {
        if (
          !(error instanceof ApiError) ||
          !error.issues.some((issue) => issue.code === 'order_already_exists')
        )
          throw error;
        // The refusal names no order, so read the one it means to link to it.
        const found = await client.fetchQuery({
          ...orderList({ search: input.orderNumber, pageSize: 1 }),
          staleTime: 0,
        });
        return {
          taken: {
            orderNumber: input.orderNumber,
            existing: found.items[0],
          },
        };
      }
    },
    onSuccess: async (result) => {
      if (!result.created) return;
      await client.invalidateQueries({ queryKey: workOrdersKey });
      onCreated(result.created);
    },
  });
  const set = (field: keyof Fields, value: string) => {
    setFields((current) => ({ ...current, [field]: value }));
    create.reset();
  };
  const issues = fieldIssues(create.error, fieldName);
  const taken = create.data?.taken;
  const unallocated = taken?.existing && !taken.existing.allocatedAt;
  const valid =
    orderNumberSchema.safeParse(fields.orderNumber).success &&
    orderQuantitySchema.safeParse(Number(fields.quantity)).success;
  return (
    <form
      className="stack"
      onSubmit={(event) => {
        event.preventDefault();
        // The form holds its own copy, so a click during a request is ignored.
        if (!create.isPending) create.mutate(fields);
      }}
    >
      <TextField
        label="Order number"
        value={fields.orderNumber}
        onChange={(value) => set('orderNumber', value.replace(/\D/g, ''))}
        required
        maxLength={6}
        inputMode="numeric"
        hint="6 digits. It cannot be changed later."
        error={issues.orderNumber}
      />
      <TextField
        label="Blinds"
        value={fields.quantity}
        onChange={(value) => set('quantity', value.replace(/\D/g, ''))}
        required
        maxLength={5}
        inputMode="numeric"
        hint="How many blinds the order has. Its allocation must match."
        error={issues.quantity}
      />
      {canManage && (
        <TextField
          label="Note"
          value={fields.note}
          onChange={(value) => set('note', value)}
          maxLength={1000}
          error={issues.note}
        />
      )}
      {taken && (
        <p className="notice notice-warning" role="alert">
          <span>
            Order {taken.orderNumber} already exists
            {unallocated && ' and has no allocation yet'}.{' '}
            {taken.existing && (
              <Link
                className="text-link"
                href={
                  unallocated
                    ? `/allocations/new?workOrder=${taken.existing.id}`
                    : `/work-orders/${taken.existing.id}`
                }
              >
                {unallocated ? 'Allocate it' : 'Open the order'}
              </Link>
            )}
          </span>
        </p>
      )}
      {create.error && (
        <ErrorNotice
          error={create.error}
          inline={(item) => fieldName(item) !== null}
        />
      )}
      <div className="form-actions">
        {onCancel && (
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={create.isPending}
          >
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={create.isPending || !valid}>
          {create.isPending ? 'Adding…' : 'Add order'}
        </Button>
      </div>
    </form>
  );
}

/** The add-order form as a modal, for the schedule and the allocation picker. */
export function OrderCreateDialog({
  close,
  onCreated,
}: {
  close: () => void;
  onCreated: (order: WorkOrder) => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title="Add order"
    >
      <OrderCreateForm onCreated={onCreated} onCancel={close} />
    </Dialog>
  );
}

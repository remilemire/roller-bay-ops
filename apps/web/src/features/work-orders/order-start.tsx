'use client';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  orderNumberSchema,
  type WorkOrder,
} from '@roller-bay/shared/work-orders';
import { Button } from '@/components/ui/button';
import { ErrorNotice } from '@/components/ui/feedback';
import { TextField } from '@/components/ui/field';
import { ApiError } from '@/lib/api';
import { createOrder, orderList, workOrdersKey } from './work-orders.api';

/**
 * Where an order begins: its number, sent as a request of its own when Create
 * order is pressed. The blinds and the fabric follow once the order exists.
 */
export function OrderStart({
  onCreated,
}: {
  onCreated: (order: WorkOrder) => void;
}) {
  const [number, setNumber] = useState('');
  const client = useQueryClient();
  const create = useMutation({
    mutationFn: async (orderNumber: string) => {
      try {
        return { created: await createOrder({ orderNumber }) };
      } catch (error) {
        if (
          !(error instanceof ApiError) ||
          !error.issues.some((issue) => issue.code === 'order_already_exists')
        )
          throw error;
        // The refusal names no order, so read the one it means to link to it.
        const found = await client.fetchQuery({
          ...orderList({ search: orderNumber, pageSize: 1 }),
          staleTime: 0,
        });
        return { taken: { orderNumber, existing: found.items[0] } };
      }
    },
    onSuccess: async (result) => {
      if (!result.created) return;
      await client.invalidateQueries({ queryKey: workOrdersKey });
      onCreated(result.created);
    },
  });
  const taken = create.data?.taken;
  return (
    <form
      className="panel"
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate(number);
      }}
    >
      <div className="panel-body stack">
        <TextField
          label="Order number"
          value={number}
          onChange={(value) => {
            setNumber(value.replace(/\D/g, ''));
            create.reset();
          }}
          required
          maxLength={6}
          inputMode="numeric"
          hint="6 digits. It cannot be changed later."
        />
        {taken && (
          <p className="notice notice-warning" role="alert">
            <span>
              Order {taken.orderNumber} already exists
              {taken.existing?.status === 'new' && ' and has no allocation yet'}
              .{' '}
              {taken.existing && (
                <Link
                  className="text-link"
                  href={
                    taken.existing.status === 'new'
                      ? `/allocations/new?workOrder=${taken.existing.id}`
                      : `/work-orders/${taken.existing.id}`
                  }
                >
                  {taken.existing.status === 'new'
                    ? 'Allocate it'
                    : 'Open the order'}
                </Link>
              )}
            </span>
          </p>
        )}
        {create.error && <ErrorNotice error={create.error} />}
        <div className="form-actions">
          <Button
            type="submit"
            disabled={
              create.isPending || !orderNumberSchema.safeParse(number).success
            }
          >
            {create.isPending ? 'Creating…' : 'Create order'}
          </Button>
        </div>
      </div>
    </form>
  );
}

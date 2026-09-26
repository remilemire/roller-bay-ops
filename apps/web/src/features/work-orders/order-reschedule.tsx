'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { BackOrder, WorkOrder } from '@roller-bay/shared/work-orders';
import { Button } from '@/components/ui/button';
import { DateField } from '@/components/ui/date-field';
import { Dialog } from '@/components/ui/dialog';
import { ErrorNotice } from '@/components/ui/feedback';
import { TextField } from '@/components/ui/field';
import { fieldIssues } from '@/lib/field-issues';
import { issuePath } from '@/lib/errors';
import type { ErrorIssue } from '@roller-bay/shared/errors';
import { workOrdersKey, updateOrder } from './work-orders.api';

const FIELDS = {
  shipDate: 'shipDate',
  backOrder: 'purchaseOrderNumber',
  'backOrder.purchaseOrderNumber': 'purchaseOrderNumber',
  'backOrder.estimatedArrivalDate': 'estimatedArrivalDate',
} as const;
const fieldName = (issue: ErrorIssue) =>
  FIELDS[issuePath(issue) as keyof typeof FIELDS] ?? null;

export const scheduleLabel = (order: WorkOrder) =>
  order.shipDate ? 'Reschedule' : 'Schedule';

/**
 * Sets, moves or clears the ship date. An order without fabric is scheduled
 * as a back order, against the supplier PO that brings its fabric.
 */
export function OrderReschedule({
  order,
  close,
}: {
  order: WorkOrder;
  close: () => void;
}) {
  // Pin the row this opened from; see OrderEditor.
  const [opened] = useState(order);
  const backOrdered = !opened.allocatedAt;
  const [shipDate, setShipDate] = useState(opened.shipDate ?? '');
  const [purchaseOrderNumber, setPurchaseOrderNumber] = useState(
    opened.backOrder?.purchaseOrderNumber ?? '',
  );
  const [estimatedArrivalDate, setEstimatedArrivalDate] = useState(
    opened.backOrder?.estimatedArrivalDate ?? '',
  );
  // Both blank clears the back order; half of one is left for the contract
  // to refuse beside its field.
  const backOrder =
    purchaseOrderNumber || estimatedArrivalDate
      ? ({
          purchaseOrderNumber: purchaseOrderNumber || undefined,
          estimatedArrivalDate: estimatedArrivalDate || undefined,
        } as BackOrder)
      : null;
  const backOrderChanged =
    backOrdered &&
    JSON.stringify(backOrder) !== JSON.stringify(opened.backOrder);
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: (next: {
      shipDate?: string | null;
      backOrder?: BackOrder | null;
    }) =>
      updateOrder(opened.id, { expectedRevision: opened.revision, ...next }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: workOrdersKey });
      close();
    },
  });
  const errors = fieldIssues(mutation.error, fieldName);
  const edit =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      mutation.reset();
    };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) close();
      }}
      title={`${scheduleLabel(opened)} order ${opened.orderNumber}`}
      description={
        backOrdered
          ? 'No fabric is allocated yet. Schedule it as a back order, on or after its fabric is due.'
          : undefined
      }
    >
      <form
        className="form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate({
            ...(shipDate && shipDate !== opened.shipDate ? { shipDate } : {}),
            ...(backOrderChanged ? { backOrder } : {}),
          });
        }}
      >
        {backOrdered && (
          <div className="form-grid">
            <TextField
              label="Supplier PO number"
              value={purchaseOrderNumber}
              onChange={edit((value: string) =>
                setPurchaseOrderNumber(value.replace(/\D/g, '')),
              )}
              maxLength={5}
              inputMode="numeric"
              error={errors.purchaseOrderNumber}
            />
            <DateField
              label="Fabric due"
              value={estimatedArrivalDate}
              onChange={edit(setEstimatedArrivalDate)}
              error={errors.estimatedArrivalDate}
            />
          </div>
        )}
        <DateField
          label="Ship date"
          value={shipDate}
          onChange={edit(setShipDate)}
          error={errors.shipDate}
          weekdaysOnly
          defaultOpen={!backOrdered}
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
          {opened.shipDate && (
            <Button
              type="button"
              variant="outline"
              onClick={() => mutation.mutate({ shipDate: null })}
              disabled={mutation.isPending}
            >
              Unschedule
            </Button>
          )}
          <Button
            type="submit"
            disabled={
              mutation.isPending ||
              ((!shipDate || shipDate === opened.shipDate) && !backOrderChanged)
            }
          >
            {mutation.isPending
              ? 'Saving…'
              : backOrderChanged && (!shipDate || shipDate === opened.shipDate)
                ? 'Save'
                : scheduleLabel(opened)}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

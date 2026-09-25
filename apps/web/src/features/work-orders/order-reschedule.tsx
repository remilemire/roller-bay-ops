'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { WorkOrder } from '@roller-bay/shared/work-orders';
import { Button } from '@/components/ui/button';
import { DateField } from '@/components/ui/date-field';
import { Dialog } from '@/components/ui/dialog';
import { ErrorNotice } from '@/components/ui/feedback';
import { fieldIssues } from '@/lib/field-issues';
import { issuePath } from '@/lib/errors';
import type { ErrorIssue } from '@roller-bay/shared/errors';
import { workOrdersKey, updateOrder } from './work-orders.api';

const fieldName = (issue: ErrorIssue) =>
  issuePath(issue) === 'shipDate' ? ('shipDate' as const) : null;

/** Sets, moves or clears only the ship date, with the calendar already open. */
export function OrderReschedule({
  order,
  close,
}: {
  order: WorkOrder;
  close: () => void;
}) {
  // Pin the row this opened from; see OrderEditor.
  const [opened] = useState(order);
  const [shipDate, setShipDate] = useState(opened.shipDate ?? '');
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: (next: string | null) =>
      updateOrder(opened.id, {
        expectedRevision: opened.revision,
        shipDate: next,
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: workOrdersKey });
      close();
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) close();
      }}
      title={`${!opened.allocatedAt ? 'Unschedule' : opened.shipDate ? 'Reschedule' : 'Schedule'} order ${opened.orderNumber}`}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate(shipDate);
        }}
      >
        {opened.allocatedAt ? (
          <DateField
            label="Ship date"
            value={shipDate}
            onChange={(day) => {
              setShipDate(day);
              mutation.reset();
            }}
            error={fieldIssues(mutation.error, fieldName).shipDate}
            weekdaysOnly
            defaultOpen
          />
        ) : (
          <p>
            This order needs a fabric allocation. You can keep its existing date
            or remove it from the schedule.
          </p>
        )}
        {mutation.error && (
          <ErrorNotice
            error={mutation.error}
            inline={(issue) =>
              !!opened.allocatedAt && fieldName(issue) !== null
            }
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
              onClick={() => mutation.mutate(null)}
              disabled={mutation.isPending}
            >
              Unschedule
            </Button>
          )}
          {opened.allocatedAt && (
            <Button
              type="submit"
              disabled={
                mutation.isPending || !shipDate || shipDate === opened.shipDate
              }
            >
              {mutation.isPending
                ? 'Saving…'
                : opened.shipDate
                  ? 'Reschedule'
                  : 'Schedule'}
            </Button>
          )}
        </div>
      </form>
    </Dialog>
  );
}

'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { ScheduledOrder } from '@roller-bay/shared/order-schedule';
import { Button } from '@/components/ui/button';
import { DateField } from '@/components/ui/date-field';
import { Dialog } from '@/components/ui/dialog';
import { ErrorNotice } from '@/components/ui/feedback';
import { fieldIssues } from '@/lib/field-issues';
import { issuePath } from '@/lib/errors';
import type { ErrorIssue } from '@roller-bay/shared/errors';
import { orderScheduleKey, updateOrder } from './order-schedule.api';

const fieldName = (issue: ErrorIssue) =>
  issuePath(issue) === 'shipDate' ? ('shipDate' as const) : null;

/** Changes only the ship date, with the calendar already open. */
export function OrderReschedule({
  order,
  close,
}: {
  order: ScheduledOrder;
  close: () => void;
}) {
  // Pin the row this opened from; see OrderEditor.
  const [opened] = useState(order);
  const [shipDate, setShipDate] = useState(opened.shipDate);
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: () =>
      updateOrder(opened.id, { expectedRevision: opened.revision, shipDate }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: orderScheduleKey });
      close();
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) close();
      }}
      title={`Reschedule order ${opened.orderNumber}`}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate();
        }}
      >
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
          <Button
            type="submit"
            disabled={mutation.isPending || shipDate === opened.shipDate}
          >
            {mutation.isPending ? 'Saving…' : 'Reschedule'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

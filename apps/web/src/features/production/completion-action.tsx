'use client';
import { useQueryClient } from '@tanstack/react-query';
import type { Station } from '@roller-bay/shared/users';
import { completionInputSchema } from '@roller-bay/shared/production';
import { useProductionWrite } from './use-production-write';
import { Button } from '@/components/ui/button';
import { ErrorNotice } from '@/components/ui/feedback';
import { useCurrentUser } from '@/features/auth';
import {
  completionLabels,
  mutationResultSchema,
  productionKey,
} from './production.api';
export function CompletionAction({
  station,
  orderId,
  orderNumber,
  employeeIds,
  done,
}: {
  station: Station;
  orderId: string;
  orderNumber: string;
  employeeIds: string[];
  done: boolean;
}) {
  const client = useQueryClient();
  const user = useCurrentUser();
  const scope = `production:${user.id}:${orderId}:${station}`;
  const mutation = useProductionWrite({
    scope,
    path: `/production/${station}/orders/${orderId}/complete`,
    inputSchema: completionInputSchema,
    outputSchema: mutationResultSchema,
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: productionKey }),
        client.invalidateQueries({ queryKey: ['work-orders'] }),
      ]);
    },
  });
  return (
    <div className="action-group">
      {mutation.error && <ErrorNotice error={mutation.error} />}
      {mutation.pending && (
        <div className="action-group">
          <p>
            The previous completion has an uncertain result. Retry it with its
            original employees before recording another.
          </p>
          <Button
            variant="outline"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate(mutation.pending!)}
          >
            Retry original completion
          </Button>
        </div>
      )}
      <Button
        disabled={
          !employeeIds.length ||
          done ||
          mutation.isPending ||
          !!mutation.pending
        }
        onClick={() => mutation.mutate({ employeeIds })}
      >
        {done
          ? `${completionLabels[station].replace(/^./, (s) => s.toUpperCase())} recorded`
          : mutation.isPending
            ? 'Saving…'
            : station === 'cutting'
              ? 'Sign off only'
              : `Mark ${orderNumber} ${completionLabels[station]}`}
      </Button>
      {mutation.isSuccess && (
        <p role="status">
          Order {orderNumber} {completionLabels[station]} recorded.
        </p>
      )}
    </div>
  );
}

'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Station } from '@roller-bay/shared/users';
import { api } from '@/lib/api';
import { requestKey, finishRequest } from '@/lib/pending-request';
import { Button } from '@/components/ui/button';
import { ErrorNotice } from '@/components/ui/feedback';
import { useCurrentUser } from '@/features/auth/auth-boundary';
import {
  completionLabels,
  mutationResultSchema,
  productionKey,
} from './production.api';
export function CompletionAction({
  station,
  orderId,
  orderNumber,
  employeeId,
  done,
  onCompleted,
}: {
  station: Station;
  orderId: string;
  orderNumber: string;
  employeeId: string;
  done: boolean;
  onCompleted?: () => void;
}) {
  const client = useQueryClient();
  const user = useCurrentUser();
  const scope = `production:${user.id}:${orderId}:${station}`;
  const mutation = useMutation({
    mutationFn: () => {
      const body = { employeeId };
      return api(
        `/production/${station}/orders/${orderId}/complete`,
        mutationResultSchema,
        { method: 'POST', body, key: requestKey(scope, body) },
      );
    },
    onSuccess: async () => {
      finishRequest(scope);
      onCompleted?.();
      await Promise.all([
        client.invalidateQueries({ queryKey: productionKey }),
        client.invalidateQueries({ queryKey: ['work-orders'] }),
      ]);
    },
  });
  return (
    <div>
      {mutation.error && <ErrorNotice error={mutation.error} />}
      <Button
        disabled={!employeeId || done || mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        {done
          ? `${completionLabels[station]} recorded`
          : mutation.isPending
            ? 'Saving…'
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

'use client';
import { useState, type ReactNode } from 'react';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { correctionResultSchema } from '@roller-bay/shared/corrections';
import { api, ApiError } from '@/lib/api';
import {
  pendingPayload,
  requestKey,
  finishRequest,
} from '@/lib/pending-request';
import { useCurrentUser } from '@/features/auth/auth-boundary';
import { useUnsavedChanges } from '@/lib/use-unsaved-changes';
import { CorrectionReview } from './correction-review';
import { Button } from '@/components/ui/button';
import { ErrorNotice } from '@/components/ui/feedback';
import { TextField } from '@/components/ui/field';
export function CorrectionSubmit({
  endpoint,
  schema,
  makeBody,
  children,
  close,
}: {
  endpoint: string;
  schema: z.ZodType;
  makeBody: () => object;
  children: ReactNode;
  close: () => void;
}) {
  const user = useCurrentUser();
  const scope = `correction:${user.id}:${endpoint}`;
  const [reason, setReason] = useState('');
  const [review, setReview] = useState<unknown>(null);
  const [error, setError] = useState<unknown>(null);
  const [recovery, setRecovery] = useState(() =>
    schema.safeParse(pendingPayload(scope)),
  );
  const client = useQueryClient();
  useUnsavedChanges(true);
  const mutation = useMutation({
    mutationFn: async (body: unknown) => {
      const key = requestKey(scope, body);
      try {
        return await api(endpoint, correctionResultSchema, {
          method: 'POST',
          body,
          key,
        });
      } catch (error) {
        if (
          error instanceof ApiError &&
          [400, 403, 404, 409, 422].includes(error.status)
        ) {
          finishRequest(scope);
          setRecovery(schema.safeParse(undefined));
        } else {
          setRecovery(schema.safeParse(pendingPayload(scope)));
        }
        throw error;
      }
    },
    onSuccess: async () => {
      finishRequest(scope);
      await Promise.all(
        ['stock-items', 'stock-receipts', 'allocations', 'history'].map((k) =>
          client.invalidateQueries({ queryKey: [k] }),
        ),
      );
      close();
    },
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        try {
          setReview(schema.parse({ ...makeBody(), reason }));
          setError(null);
        } catch (err) {
          setError(
            err instanceof z.ZodError
              ? new ApiError(
                  400,
                  'Check the correction fields.',
                  undefined,
                  err.issues.map((i) => ({
                    message: i.message,
                    path: i.path.filter(
                      (p) => typeof p === 'string' || typeof p === 'number',
                    ),
                  })),
                )
              : err,
          );
        }
      }}
    >
      <fieldset
        hidden={review !== null}
        disabled={mutation.isPending || review !== null}
        style={{ border: 0, padding: 0 }}
      >
        {children}
        <TextField
          label="Reason for correction"
          value={reason}
          onChange={setReason}
          required
          maxLength={1000}
        />
      </fieldset>
      {(error || mutation.error) && (
        <ErrorNotice error={error ?? mutation.error} />
      )}
      {recovery.success && review === null && (
        <div className="notice">
          <p>
            An earlier correction may have succeeded. Review and retry its saved
            contents before making another change.
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => setReview(recovery.data)}
          >
            Review previous correction
          </Button>
        </div>
      )}
      {review !== null && (
        <section>
          <h3>Review correction</h3>
          <CorrectionReview value={review} />
          <p>
            These changes and your reason will remain in the record’s history.
          </p>
        </section>
      )}
      <div className="form-actions">
        <Button
          type="button"
          variant="outline"
          disabled={mutation.isPending}
          onClick={review !== null ? () => setReview(null) : close}
        >
          {review !== null ? 'Back' : 'Cancel'}
        </Button>
        {review !== null ? (
          <Button
            type="button"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate(review)}
          >
            Save correction
          </Button>
        ) : (
          <Button type="submit">Review changes</Button>
        )}
      </div>
    </form>
  );
}

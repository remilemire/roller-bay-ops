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
import type { ErrorIssue } from '@roller-bay/shared/errors';
import { issuePath } from '@/lib/errors';
import { fieldIssues } from '@/lib/field-issues';

/** Messages for the fields a correction form can place, by its own names. */
export type CorrectionFieldErrors = Partial<Record<string, string>>;
export function CorrectionSubmit({
  endpoint,
  schema,
  makeBody,
  fieldName,
  children,
  close,
}: {
  endpoint: string;
  schema: z.ZodType;
  makeBody: () => object;
  /**
   * Maps a request-body issue path to the form's own field name. The matching
   * messages reach `children` as a function, which shows them beside those
   * fields; they describe the last review or save, not edits made since.
   */
  fieldName?: (path: string) => string | null;
  children: ReactNode | ((errors: CorrectionFieldErrors) => ReactNode);
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
  const placed = (issue: ErrorIssue) => {
    const path = issuePath(issue);
    return path === 'reason' ? path : (fieldName?.(path) ?? null);
  };
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
  const shown = error ?? mutation.error;
  const errors: CorrectionFieldErrors = fieldIssues(shown, placed);
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
        {/* Keep the reason at the same spacing as the fields above it; a
            class on the fieldset would override its hidden attribute. */}
        <div className="stack">
          {typeof children === 'function' ? children(errors) : children}
          <TextField
            label="Reason for correction"
            value={reason}
            onChange={setReason}
            required
            maxLength={1000}
            error={errors.reason}
          />
        </div>
      </fieldset>
      {Boolean(shown) && (
        <ErrorNotice error={shown} inline={(issue) => placed(issue) !== null} />
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

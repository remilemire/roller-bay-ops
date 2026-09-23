'use client';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { api, ApiError } from '@/lib/api';
import {
  finishRequest,
  pendingPayload,
  requestKey,
} from '@/lib/pending-request';
import { useHydrated } from '@/lib/use-hydrated';

/** Keep the exact request available until the server has answered definitively. */
export function useIdempotentWrite<Input, Output>({
  scope,
  path,
  inputSchema,
  outputSchema,
  onSuccess,
}: {
  scope: string;
  path: string;
  inputSchema: z.ZodType<Input>;
  outputSchema: z.ZodType<Output>;
  onSuccess: (value: Output) => Promise<void> | void;
}) {
  const hydrated = useHydrated();
  const [, refreshPending] = useState(0);
  const saved = hydrated ? inputSchema.safeParse(pendingPayload(scope)) : null;
  const pending = saved?.success ? saved.data : null;
  const mutation = useMutation({
    mutationFn: async (body: Input) => {
      body = inputSchema.parse(body);
      // A local mismatch must leave the uncertain request intact.
      const key = requestKey(scope, body);
      try {
        const result = await api(path, outputSchema, {
          method: 'POST',
          body,
          key,
        });
        finishRequest(scope);
        return result;
      } catch (error) {
        // 408 and transport/5xx failures may have happened after commit.
        if (
          error instanceof ApiError &&
          error.status >= 400 &&
          error.status < 500 &&
          error.status !== 408
        )
          finishRequest(scope);
        throw error;
      } finally {
        refreshPending((value) => value + 1);
      }
    },
    onSuccess,
  });
  return { ...mutation, pending };
}

/**
 * Keeps an uncertain write's payload and key together so a lost response can
 * be retried without duplicating the operation.
 */
import { z } from 'zod';
import { ApiError } from './api';
const prefix = 'roller-bay:pending:';
const storedSchema = z.object({ key: z.uuid(), payload: z.string() });
export function pendingPayload(scope: string): unknown {
  if (typeof window === 'undefined') return undefined;
  try {
    const saved = storedSchema.parse(
      JSON.parse(sessionStorage.getItem(prefix + scope) ?? 'null'),
    );
    return JSON.parse(saved.payload);
  } catch {
    return undefined;
  }
}
export function requestKey(scope: string, body: unknown): string {
  const payload = JSON.stringify(body);
  const existing = storedSchema.safeParse(
    JSON.parse(sessionStorage.getItem(prefix + scope) ?? 'null'),
  );
  if (existing.success) {
    if (existing.data.payload !== payload)
      throw new ApiError(
        409,
        'An earlier request may have succeeded. Restore and retry that request before starting another.',
      );
    return existing.data.key;
  }
  const key = crypto.randomUUID();
  sessionStorage.setItem(prefix + scope, JSON.stringify({ key, payload }));
  return key;
}
export function finishRequest(scope: string) {
  sessionStorage.removeItem(prefix + scope);
}
export function clearPendingRequests() {
  Object.keys(sessionStorage)
    .filter((key) => key.startsWith(prefix))
    .forEach((key) => sessionStorage.removeItem(key));
}

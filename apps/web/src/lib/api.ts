import { z } from 'zod';
import {
  apiErrorSchema,
  errorIssueSchema,
  type ErrorIssue,
} from '@roller-bay/shared/errors';
export const API_URL = (
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api'
).replace(/\/$/, '');
export const SESSION_EXPIRED_EVENT = 'roller-bay:session-expired';
export class ApiError extends Error {
  readonly issues: ErrorIssue[];
  constructor(
    public readonly status: number,
    message: string,
    public readonly retryAfterMs?: number,
    issues: ErrorIssue[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
    this.issues = issues;
  }
}
// The HTTP status is authoritative, so a body without `statusCode` (a proxy
// page, an intercepted test response) still yields its message, and malformed
// details never hide it.
const errorBodySchema = apiErrorSchema.extend({
  statusCode: apiErrorSchema.shape.statusCode.optional(),
  issues: z.array(errorIssueSchema).catch([]),
});
export function queryString(values: Record<string, unknown>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values))
    if (value !== undefined && value !== null && value !== '')
      params.set(key, String(value));
  return params.size ? `?${params}` : '';
}
export async function api<T>(
  path: string,
  schema: z.ZodType<T>,
  options: {
    method?: string;
    body?: unknown;
    key?: string;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: options.method ?? 'GET',
    credentials: 'include',
    signal: options.signal,
    headers: {
      ...(options.body !== undefined
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...(options.key ? { 'Idempotency-Key': options.key } : {}),
    },
    ...(options.body !== undefined
      ? { body: JSON.stringify(options.body) }
      : {}),
  });
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const body = errorBodySchema.safeParse(payload);
    const retryAfter = response.headers.get('Retry-After');
    const retryAfterMs = retryAfter
      ? /^\d+$/.test(retryAfter)
        ? Number(retryAfter) * 1000
        : Math.max(0, Date.parse(retryAfter) - Date.now())
      : undefined;
    // Let /auth/me publish its own signed-out result; broadcasting its 401
    // would cancel the session query that needs to deliver that result.
    if (
      response.status === 401 &&
      path !== '/auth/me' &&
      typeof window !== 'undefined'
    )
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    throw new ApiError(
      response.status,
      body.success
        ? body.data.message
        : `Request failed (${response.status}). Please try again.`,
      Number.isFinite(retryAfterMs) ? retryAfterMs : undefined,
      body.success ? body.data.issues : [],
    );
  }
  const value: unknown =
    response.status === 204
      ? undefined
      : await response.json().catch(() => {
          throw new ApiError(
            502,
            'The server returned an unreadable response. Please try again.',
          );
        });
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new ApiError(
      502,
      'The server returned an unexpected response. Please refresh or try again.',
    );
  return parsed.data;
}
export const noContent = z.undefined();

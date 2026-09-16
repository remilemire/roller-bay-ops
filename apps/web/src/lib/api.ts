import { z } from 'zod';
export const API_URL = (
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api'
).replace(/\/$/, '');
export const SESSION_EXPIRED_EVENT = 'roller-bay:session-expired';
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
export function errorMessage(error: unknown): string {
  if (error instanceof z.ZodError)
    return error.issues
      .map((issue) => `${issue.path.join('.') || 'Form'}: ${issue.message}`)
      .join(' · ');
  if (error instanceof ApiError) return error.message;
  return 'Something went wrong. Your changes have not been discarded. Please try again.';
}
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
    const message = z
      .object({ message: z.union([z.string(), z.array(z.string())]) })
      .safeParse(payload);
    const retryAfter = response.headers.get('Retry-After');
    const retryAfterMs = retryAfter
      ? /^\d+$/.test(retryAfter)
        ? Number(retryAfter) * 1000
        : Math.max(0, Date.parse(retryAfter) - Date.now())
      : undefined;
    if (
      response.status === 401 &&
      path !== '/auth/me' &&
      typeof window !== 'undefined'
    )
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    throw new ApiError(
      response.status,
      message.success
        ? [message.data.message].flat().join(' · ')
        : `Request failed (${response.status}). Please try again.`,
      Number.isFinite(retryAfterMs) ? retryAfterMs : undefined,
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

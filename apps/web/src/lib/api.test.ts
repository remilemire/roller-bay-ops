import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { api, ApiError, noContent, SESSION_EXPIRED_EVENT } from './api';
import { createQueryClient } from './query-client';
describe('API boundary', () => {
  it('sends the session, JSON and the supplied retry key, and validates data', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ id: 'saved' })));
    vi.stubGlobal('fetch', fetcher);
    await expect(
      api('/receipts', z.object({ id: z.string() }), {
        method: 'POST',
        body: { data: null },
        key: 'retry-key',
      }),
    ).resolves.toEqual({ id: 'saved' });
    expect(fetcher).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        credentials: 'include',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'retry-key',
        },
        body: '{"data":null}',
      }),
    );
  });
  it('accepts 204 and rejects malformed successful responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 204 }))
        .mockResolvedValueOnce(new Response('{"id":42}')),
    );
    await expect(
      api('/item', noContent, { method: 'DELETE' }),
    ).resolves.toBeUndefined();
    await expect(
      api('/item', z.object({ id: z.string() })),
    ).rejects.toMatchObject({ status: 502 });
  });
  it('distinguishes permission failures from expired sessions and preserves retry-after', async () => {
    const expired = vi.fn();
    window.addEventListener(SESSION_EXPIRED_EVENT, expired);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response('{"message":"Forbidden"}', { status: 403 }),
        )
        .mockResolvedValueOnce(new Response('{}', { status: 401 }))
        .mockResolvedValueOnce(
          new Response('{}', { status: 429, headers: { 'Retry-After': '7' } }),
        ),
    );
    await expect(api('/item', z.unknown())).rejects.toBeInstanceOf(ApiError);
    expect(expired).not.toHaveBeenCalled();
    await expect(api('/item', z.unknown())).rejects.toMatchObject({
      status: 401,
    });
    expect(expired).toHaveBeenCalledOnce();
    await expect(api('/item', z.unknown())).rejects.toMatchObject({
      status: 429,
      retryAfterMs: 7000,
    });
    window.removeEventListener(SESSION_EXPIRED_EVENT, expired);
  });
  it('never automatically retries mutations or access errors', () => {
    const defaults = createQueryClient().getDefaultOptions();
    expect(defaults.mutations?.retry).toBe(false);
    const retry = defaults.queries!.retry as (
      count: number,
      error: Error,
    ) => boolean;
    expect(retry(0, new ApiError(409, 'conflict'))).toBe(false);
    expect(retry(0, new ApiError(401, 'expired'))).toBe(false);
    expect(retry(0, new ApiError(503, 'outage'))).toBe(true);
    expect(retry(2, new Error())).toBe(false);
  });
});

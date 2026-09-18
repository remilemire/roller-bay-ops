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
  it('carries curated field issues from the shared envelope and tolerates malformed ones', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              statusCode: 400,
              message: 'Validation failed',
              issues: [
                {
                  code: 'too_small',
                  path: ['items', 0, 'widthMm'],
                  message: 'Too small: expected number to be >0',
                },
                {
                  code: 'length_capacity',
                  path: 'plan.cuts.0',
                  message: 'Cut exceeds remaining length.',
                },
              ],
            }),
            { status: 400 },
          ),
        )
        .mockResolvedValueOnce(
          new Response('{"message":"Receipt changed","issues":"nope"}', {
            status: 409,
          }),
        )
        .mockResolvedValueOnce(
          new Response(
            '{"statusCode":429,"error":"Too Many Requests","message":"Too many requests. Try again later."}',
            { status: 429 },
          ),
        )
        .mockResolvedValueOnce(
          new Response('<html>upstream secret</html>', { status: 502 }),
        ),
    );
    await expect(api('/item', z.unknown())).rejects.toMatchObject({
      status: 400,
      message: 'Validation failed',
      issues: [
        {
          code: 'too_small',
          path: ['items', 0, 'widthMm'],
          message: 'Too small: expected number to be >0',
        },
        {
          code: 'length_capacity',
          path: 'plan.cuts.0',
          message: 'Cut exceeds remaining length.',
        },
      ],
    });
    await expect(api('/item', z.unknown())).rejects.toMatchObject({
      status: 409,
      message: 'Receipt changed',
      issues: [],
    });
    await expect(api('/item', z.unknown())).rejects.toMatchObject({
      status: 429,
      message: 'Too many requests. Try again later.',
    });
    await expect(api('/item', z.unknown())).rejects.toMatchObject({
      status: 502,
      message: 'Request failed (502). Please try again.',
      issues: [],
    });
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

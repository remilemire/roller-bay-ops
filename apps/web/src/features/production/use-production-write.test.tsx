import { beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { z } from 'zod';
import { api, ApiError } from '@/lib/api';
import { pendingPayload } from '@/lib/pending-request';
import { useProductionWrite } from './use-production-write';
vi.mock('@/lib/api', async (original) => ({
  ...(await original<typeof import('@/lib/api')>()),
  api: vi.fn(),
}));
const scope = 'production:test';
const original = { employee: 'Alex' };
function mount() {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  return renderHook(
    () =>
      useProductionWrite({
        scope,
        path: '/production/example',
        inputSchema: z.object({ employee: z.string() }),
        outputSchema: z.object({ ok: z.boolean() }),
        onSuccess: vi.fn(),
      }),
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    },
  );
}
beforeEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.mocked(api).mockReset();
});
it('allows corrected input after a definitive server rejection', async () => {
  vi.mocked(api)
    .mockRejectedValueOnce(new ApiError(409, 'Employee inactive'))
    .mockResolvedValueOnce({ ok: true });
  const { result } = mount();
  await act(async () => {
    await expect(result.current.mutateAsync(original)).rejects.toThrow(
      'Employee inactive',
    );
  });
  expect(pendingPayload(scope)).toBeUndefined();
  await act(async () => {
    await result.current.mutateAsync({ employee: 'Robin' });
  });
  expect(vi.mocked(api).mock.calls[1]![2]!.body).toEqual({ employee: 'Robin' });
  expect(vi.mocked(api).mock.calls[0]![2]!.key).not.toBe(
    vi.mocked(api).mock.calls[1]![2]!.key,
  );
});
it('recovers an uncertain request after remount with the same payload and key', async () => {
  vi.mocked(api)
    .mockRejectedValueOnce(new TypeError('Network unavailable'))
    .mockResolvedValueOnce({ ok: true });
  const first = mount();
  await act(async () => {
    await expect(first.result.current.mutateAsync(original)).rejects.toThrow();
  });
  first.unmount();
  const next = mount();
  expect(next.result.current.pending).toEqual(original);
  await act(async () => {
    await next.result.current.mutateAsync(next.result.current.pending!);
  });
  expect(vi.mocked(api).mock.calls[1]![2]).toEqual(
    vi.mocked(api).mock.calls[0]![2],
  );
  expect(pendingPayload(scope)).toBeUndefined();
});
it('does not erase an uncertain write when changed input conflicts locally', async () => {
  vi.mocked(api).mockRejectedValueOnce(new ApiError(502, 'Lost response'));
  const { result } = mount();
  await act(async () => {
    await expect(result.current.mutateAsync(original)).rejects.toThrow();
  });
  await act(async () => {
    await expect(
      result.current.mutateAsync({ employee: 'Robin' }),
    ).rejects.toThrow('earlier request');
  });
  expect(api).toHaveBeenCalledTimes(1);
  expect(pendingPayload(scope)).toEqual(original);
});
it('retains timeout responses because their commit outcome is uncertain', async () => {
  vi.mocked(api).mockRejectedValueOnce(new ApiError(408, 'Timeout'));
  const { result } = mount();
  await act(async () => {
    await expect(result.current.mutateAsync(original)).rejects.toThrow();
  });
  expect(pendingPayload(scope)).toEqual(original);
});
it('discards a saved payload the current input contract cannot retry', async () => {
  sessionStorage.setItem(
    'roller-bay:pending:' + scope,
    JSON.stringify({
      key: '11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      payload: JSON.stringify({ worker: 'Alex' }),
    }),
  );
  vi.mocked(api).mockResolvedValueOnce({ ok: true });
  const { result } = mount();
  expect(result.current.pending).toBeNull();
  await act(async () => {
    await result.current.mutateAsync(original);
  });
  expect(api).toHaveBeenCalledTimes(1);
  expect(vi.mocked(api).mock.calls[0]![2]!.key).not.toBe(
    '11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  );
});

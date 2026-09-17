import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAutosave } from './use-autosave';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});
const idle = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

it('saves a detached copy once the value has been idle', async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  const value = { po: 'A' };
  const view = renderHook(({ value }) => useAutosave(value, true, save), {
    initialProps: { value },
  });
  await idle(1500);
  view.rerender({ value: { po: 'AB' } });
  await idle(1500);
  expect(save).not.toHaveBeenCalled();
  await idle(500);
  expect(save).toHaveBeenCalledExactlyOnceWith({ po: 'AB' });
  expect(save.mock.calls[0]![0]).not.toBe(value);
});

it('does not retry a failed value until it changes', async () => {
  const save = vi.fn().mockRejectedValue(new Error('offline'));
  const view = renderHook(
    ({ value, enabled }) => useAutosave(value, enabled, save),
    { initialProps: { value: 'A', enabled: true } },
  );
  await idle(2000);
  // Editors disable autosave while their request is pending.
  view.rerender({ value: 'A', enabled: false });
  view.rerender({ value: 'A', enabled: true });
  await idle(10_000);
  expect(save).toHaveBeenCalledTimes(1);
  view.rerender({ value: 'AB', enabled: true });
  await idle(2000);
  expect(save).toHaveBeenCalledTimes(2);
});

it('saves a value again after it has succeeded once', async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  const view = renderHook(({ value }) => useAutosave(value, true, save), {
    initialProps: { value: 'A' },
  });
  await idle(2000);
  view.rerender({ value: 'B' });
  await idle(2000);
  view.rerender({ value: 'A' });
  await idle(2000);
  expect(save.mock.calls).toEqual([['A'], ['B'], ['A']]);
});

it('does nothing while disabled or after unmounting', async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  const view = renderHook(({ enabled }) => useAutosave('A', enabled, save), {
    initialProps: { enabled: false },
  });
  await idle(5000);
  view.rerender({ enabled: true });
  await idle(1000);
  view.unmount();
  await idle(5000);
  expect(save).not.toHaveBeenCalled();
});

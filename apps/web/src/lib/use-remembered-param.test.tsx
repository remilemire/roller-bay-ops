import { beforeEach, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { useRememberedParam } from './use-remembered-param';

const state = vi.hoisted(() => ({ search: '' }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(state.search),
}));
const key = 'test-tab';
const tabs = ['open', 'done', 'all'] as const;
const url = () => new URLSearchParams(window.location.search);
beforeEach(() => {
  state.search = '';
  localStorage.clear();
  window.history.replaceState(null, '', '/list');
  vi.restoreAllMocks();
});

it('shows and saves a value named in the URL, leaving the URL alone', () => {
  localStorage.setItem(key, 'all');
  state.search = 'tab=done';
  const replace = vi.spyOn(window.history, 'replaceState');
  const { result } = renderHook(() =>
    useRememberedParam('tab', key, tabs, 'open'),
  );
  expect(result.current.value).toBe('done');
  expect(localStorage.getItem(key)).toBe('done');
  expect(replace).not.toHaveBeenCalled();
});

it('reopens the saved value and names it in the URL, keeping the rest', () => {
  localStorage.setItem(key, 'all');
  state.search = 'search=1048';
  window.history.replaceState(null, '', '/list?search=1048');
  const { result } = renderHook(() =>
    useRememberedParam('tab', key, tabs, 'open'),
  );
  expect(result.current.value).toBe('all');
  expect(window.location.pathname).toBe('/list');
  expect(url().get('search')).toBe('1048');
  expect(url().get('tab')).toBe('all');
});

it('falls back on an unknown or unreadable value, or shows nothing', () => {
  localStorage.setItem(key, 'retired');
  state.search = 'tab=bogus';
  expect(
    renderHook(() => useRememberedParam('tab', key, tabs, 'open')).result
      .current.value,
  ).toBe('open');
  expect(url().get('tab')).toBe('open');

  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  expect(
    renderHook(() => useRememberedParam('tab', key, tabs, 'open')).result
      .current.value,
  ).toBe('open');

  // With no fallback there is nothing to show, and nothing to name.
  window.history.replaceState(null, '', '/list');
  expect(
    renderHook(() => useRememberedParam('tab', key, tabs)).result.current.value,
  ).toBeUndefined();
  expect(window.location.search).toBe('');
});

it('names several remembered parameters from one render', () => {
  localStorage.setItem('test-view', 'grid');
  renderHook(() => {
    useRememberedParam('view', 'test-view', ['grid', 'rows'], 'rows');
    useRememberedParam('tab', key, tabs, 'open');
  });
  expect(url().get('view')).toBe('grid');
  expect(url().get('tab')).toBe('open');
});

it('waits for the browser before choosing, and forgets on request', () => {
  localStorage.setItem(key, 'all');
  function Probe() {
    return String(useRememberedParam('tab', key, tabs, 'open').value);
  }
  // The server cannot read storage, so it renders neither value.
  expect(renderToString(<Probe />)).toBe('null');

  const { result } = renderHook(() =>
    useRememberedParam('tab', key, tabs, 'open'),
  );
  result.current.forget();
  expect(localStorage.getItem(key)).toBeNull();
});

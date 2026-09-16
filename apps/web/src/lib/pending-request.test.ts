import { it, expect } from 'vitest';
import {
  requestKey,
  finishRequest,
  pendingPayload,
  clearPendingRequests,
} from './pending-request';
it('retains the same creation key across retries and reloads without accepting changed payloads', () => {
  const data = { number: null, lines: [] };
  const first = requestKey('user:receipt', data);
  expect(requestKey('user:receipt', data)).toBe(first);
  expect(pendingPayload('user:receipt')).toEqual(data);
  expect(() => requestKey('user:receipt', { number: 'changed' })).toThrow(
    'An earlier request may have succeeded',
  );
  expect(requestKey('other-user:receipt', data)).not.toBe(first);
  finishRequest('user:receipt');
  expect(requestKey('user:receipt', data)).not.toBe(first);
  clearPendingRequests();
  expect(pendingPayload('user:receipt')).toBeUndefined();
});

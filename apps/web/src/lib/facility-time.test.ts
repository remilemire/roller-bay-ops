import { expect, it } from 'vitest';
import { dateLabel, dateTimeLabel } from './format';
import { facilityTimeToIso } from './facility-time';

it('formats instants in the configured facility time zone', () => {
  expect(dateLabel('2026-07-10T02:00:00.000Z')).toBe('Jul 9, 2026');
  expect(dateTimeLabel('2026-07-10T16:30:00.000Z')).toMatch(
    /^Jul 10, 2026, 10:30 a\.m\. MDT$/,
  );
});

it('converts facility-local correction times to UTC', () => {
  expect(facilityTimeToIso('2026-07-10T09:30')).toBe(
    '2026-07-10T15:30:00.000Z',
  );
  expect(facilityTimeToIso('2026-01-10T09:30')).toBe(
    '2026-01-10T16:30:00.000Z',
  );
});

it('rejects a local time skipped by daylight saving', () => {
  expect(() => facilityTimeToIso('2026-03-08T02:30')).toThrow(
    'daylight-saving transition',
  );
});

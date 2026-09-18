import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ApiError } from './api';
import {
  describeError,
  describeIssue,
  describeIssuePath,
  describeIssues,
  GENERIC_ERROR_MESSAGE,
  INVALID_FIELDS_MESSAGE,
} from './errors';

describe('issue labels', () => {
  it('turns Zod and cutting-plan paths into readable labels', () => {
    expect(describeIssuePath(['items', 0, 'widthMm'])).toBe('Item 1 › width');
    expect(describeIssuePath('plan.cuts.0.items.1.requirementId')).toBe(
      'Plan › cut 1 › item 2 › requirement',
    );
    expect(describeIssuePath('context.stockItems.2.remainingLengthMm')).toBe(
      'Stock item 3 › remaining length',
    );
    expect(describeIssuePath('settings.edgeTrimMm')).toBe(
      'Settings › edge trim',
    );
    expect(describeIssuePath([])).toBe('');
    expect(describeIssuePath(undefined)).toBe('');
  });
  it('rewrites default Zod messages and keeps custom sentences', () => {
    expect(
      describeIssue({
        code: 'invalid_type',
        path: ['purchaseOrderNumber'],
        message: 'Invalid input: expected string, received undefined',
      }),
    ).toBe('Purchase order number is required.');
    expect(
      describeIssue({
        path: ['quantity'],
        message: 'Too small: expected number to be >=1',
      }),
    ).toBe('Quantity is too small.');
    expect(
      describeIssue({
        path: ['lengthMm'],
        message: 'Too big: expected number to be <=100000',
      }),
    ).toBe('Length is too large.');
    expect(
      describeIssue({
        path: ['widthMm'],
        message: 'Invalid number: must be a multiple of 0.001',
      }),
    ).toBe('Width has too many decimal places.');
    expect(
      describeIssue({ path: ['fabricColorId'], message: 'Invalid UUID' }),
    ).toBe('Fabric color is invalid.');
    expect(
      describeIssue({
        path: ['items', 0],
        message: 'Remnants require an explicit length.',
      }),
    ).toBe('Item 1: Remnants require an explicit length.');
    expect(describeIssue({ message: 'Invalid input' })).toBe(
      'This value is invalid.',
    );
    expect(describeIssue({ message: 'Stock is consumed.' })).toBe(
      'Stock is consumed.',
    );
  });
});

describe('describeError', () => {
  it('describes client-side schema failures without exposing Zod text', () => {
    const result = z
      .object({ items: z.array(z.object({ widthMm: z.number() })) })
      .safeParse({ items: [{ widthMm: 'x' }] });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(describeError(result.error)).toEqual({
      message: INVALID_FIELDS_MESSAGE,
      details: ['Item 1 › width is invalid.'],
    });
  });
  it('shows the API message with its issues', () => {
    expect(
      describeError(
        new ApiError(
          409,
          'Stock availability changed or is insufficient.',
          undefined,
          [
            {
              code: 'length_capacity',
              path: 'plan.cuts.0',
              message: 'Cut exceeds remaining length.',
            },
          ],
        ),
      ),
    ).toEqual({
      message: 'Stock availability changed or is insufficient.',
      details: ['Plan › cut 1: Cut exceeds remaining length.'],
    });
    expect(describeError(new ApiError(503, 'Temporarily unavailable'))).toEqual(
      { message: 'Temporarily unavailable', details: [] },
    );
  });
  it('never shows text from other exceptions', () => {
    expect(
      describeError(
        new TypeError('fetch failed: https://internal.example/?token=secret'),
      ),
    ).toEqual({ message: GENERIC_ERROR_MESSAGE, details: [] });
    expect(describeError(undefined)).toEqual({
      message: GENERIC_ERROR_MESSAGE,
      details: [],
    });
  });
  it('dedupes repeated issues and caps the list', () => {
    const many = Array.from({ length: 12 }, (_, index) => ({
      path: ['items', index, 'widthMm'],
      message: 'Too small: expected number to be >0',
    }));
    const lines = describeIssues([...many, ...many]);
    expect(lines).toHaveLength(9);
    expect(lines[0]).toBe('Item 1 › width is too small.');
    expect(lines.at(-1)).toBe('…and 4 more.');
  });
});

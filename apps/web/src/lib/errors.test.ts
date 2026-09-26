import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ApiError } from './api';
import {
  describeError,
  describeFieldIssue,
  issuePath,
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
      'Cut 1 › item 2 › blind',
    );
    expect(describeIssuePath(['data', 'requirements', 1, 'lengthMm'])).toBe(
      'Blind 2 › length',
    );
    expect(
      describeIssuePath(
        'context.requirements.77777777-7777-4777-8777-777777777777',
      ),
    ).toBe('Blind');
    expect(describeIssuePath('plan')).toBe('Plan');
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
    ).toBe('Quantity must be at least 1.');
    expect(
      describeIssue({
        path: ['quantity'],
        message: 'Too big: expected number to be <=10000',
      }),
    ).toBe('Quantity must be at most 10,000.');
    expect(
      describeIssue({
        path: ['widthMm'],
        message: 'Too small: expected number to be >0',
      }),
    ).toBe('Width must be greater than 0.');
    expect(
      describeIssue({
        path: ['reason'],
        message: 'Too small: expected string to have >=1 characters',
      }),
    ).toBe('Reason is required.');
    expect(
      describeIssue({
        path: ['note'],
        message: 'Too big: expected string to have <=1000 characters',
      }),
    ).toBe('Note must be 1000 characters or fewer.');
    expect(
      describeIssue({
        path: ['items'],
        message: 'Too small: expected array to have >=1 items',
      }),
    ).toBe('Items needs at least one entry.');
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
    ).toBe('Fabric color is required.');
    expect(
      describeIssue({
        path: ['items', 0],
        message: 'Remnants require an explicit length.',
      }),
    ).toBe('Item 1: Remnants require an explicit length.');
    expect(
      describeIssue({ path: ['requirements'], message: 'Add at least one.' }),
    ).toBe('Blinds: Add at least one.');
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
      details: ['Cut 1: Cut exceeds remaining length.'],
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
    expect(lines[0]).toBe('Item 1 › width must be greater than 0.');
    expect(lines.at(-1)).toBe('…and 4 more.');
  });
  it('leaves issues shown beside their fields out of the notice', () => {
    const error = new ApiError(400, 'Validation failed', undefined, [
      { path: 'orderNumber', message: 'Must be 6 digits.' },
      {
        path: 'requirements',
        message: 'Too small: expected array to have >=1 items',
      },
    ]);
    expect(
      describeError(error, (issue) => issuePath(issue) === 'orderNumber'),
    ).toEqual({
      message: 'Validation failed',
      details: ['Blinds needs at least one entry.'],
    });
  });
  it('drops the label from field-level copy', () => {
    expect(
      describeFieldIssue({
        path: ['requirements', 0, 'widthMm'],
        message: 'Invalid input: expected number, received null',
      }),
    ).toBe('Required.');
    expect(
      describeFieldIssue({ path: 'orderNumber', message: 'Must be 6 digits.' }),
    ).toBe('Must be 6 digits.');
  });
});

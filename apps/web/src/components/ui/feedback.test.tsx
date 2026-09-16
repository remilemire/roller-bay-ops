import { it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@/lib/api';
import { ErrorNotice } from './feedback';

it('shows the curated API message with readable field issues and a retry action', async () => {
  const retry = vi.fn();
  render(
    <ErrorNotice
      error={
        new ApiError(
          400,
          'Complete all receipt fields before submitting.',
          undefined,
          [
            {
              code: 'invalid_type',
              path: ['items', 0, 'widthMm'],
              message: 'Invalid input: expected number, received undefined',
            },
            {
              code: 'length_capacity',
              path: 'plan.drops.0',
              message: 'Drop exceeds remaining length.',
            },
          ],
        )
      }
      retry={retry}
    />,
  );
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Complete all receipt fields before submitting.',
  );
  expect(
    screen.getAllByRole('listitem').map((item) => item.textContent),
  ).toEqual([
    'Item 1 › width is required.',
    'Plan › drop 1: Drop exceeds remaining length.',
  ]);
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(retry).toHaveBeenCalledOnce();
});

it('replaces text from other exceptions with generic copy and no details', () => {
  render(
    <ErrorNotice
      error={new Error('fetch failed: https://internal.example/?token=secret')}
    />,
  );
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Something went wrong. Your changes have not been discarded. Please try again.',
  );
  expect(screen.getByRole('alert')).not.toHaveTextContent('secret');
  expect(screen.queryByRole('list')).toBeNull();
});

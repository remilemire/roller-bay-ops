import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PlanPreview } from './plan-preview';

it('labels plan issues like other errors and keeps inline issues beside their fields', () => {
  render(
    <PlanPreview
      result={{
        valid: false,
        stockItems: [],
        issues: [
          {
            code: 'length_capacity',
            path: 'plan.cuts.0',
            message: 'Cut exceeds remaining length.',
          },
          {
            code: 'width_capacity',
            path: 'plan.cuts.0.items.1.widthMm',
            message: 'Blind exceeds the usable width.',
          },
        ],
      }}
      inline={(issue) => issue.path.endsWith('widthMm')}
    />,
  );
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Check the highlighted fields.',
  );
  expect(screen.getByRole('listitem')).toHaveTextContent(
    'Cut 1: Cut exceeds remaining length.',
  );
  expect(screen.getByRole('alert')).not.toHaveTextContent('plan.cuts');
  expect(screen.getByRole('alert')).not.toHaveTextContent('Blind exceeds');
});

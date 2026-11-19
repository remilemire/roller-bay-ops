import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { defaultMeasurementUnits } from '@roller-bay/shared/users';
import { SubmittedCuttingResults } from './submitted-cutting-results';

const stockItemId = '11111111-2222-4333-8444-555555555555';
const locationId = '22222222-2222-4333-8444-555555555555';
it('explicitly describes empty retained remnants rather than rendering a blank array', () => {
  render(
    <SubmittedCuttingResults
      units={defaultMeasurementUnits}
      items={[
        { stockItemId, expectedRevision: 1, outcome: 'consumed', scraps: [] },
      ]}
    />,
  );
  expect(screen.getByText('Fully consumed')).toBeVisible();
  expect(screen.getByText('No retained remnants.')).toBeVisible();
  expect(screen.queryByText('Scraps')).not.toBeInTheDocument();
  expect(screen.getByRole('link')).toHaveAttribute(
    'href',
    `/stock-items/${stockItemId}`,
  );
});
it('preserves measured roll fields and retained quantities with unit labels', () => {
  render(
    <SubmittedCuttingResults
      units={defaultMeasurementUnits}
      items={[
        {
          stockItemId,
          expectedRevision: 1,
          outcome: 'returned-roll',
          radialDepthMm: 10,
          tubeOuterDiameterMm: 50,
          locationId,
          scraps: [{ quantity: 2, widthMm: 762, lengthMm: 1828.8, locationId }],
        },
      ]}
    />,
  );
  expect(screen.getByText('Roll returned to stock')).toBeVisible();
  expect(screen.getByText('Radial depth')).toBeVisible();
  expect(screen.getByText('10 mm')).toBeVisible();
  expect(screen.getByText('Tube outer diameter')).toBeVisible();
  expect(screen.getByText('50 mm')).toBeVisible();
  expect(screen.getByText('Retained remnants')).toBeVisible();
  expect(screen.getByText(/2 × .*wide · .*long/)).toBeVisible();
  expect(screen.queryByText('No retained remnants.')).not.toBeInTheDocument();
});
it('renders returned-remnant dimensions without inventing roll measurements', () => {
  render(
    <SubmittedCuttingResults
      units={defaultMeasurementUnits}
      items={[
        {
          stockItemId,
          expectedRevision: 1,
          outcome: 'returned-remnant',
          widthMm: 762,
          explicitLengthMm: 1828.8,
          locationId,
          scraps: [],
        },
      ]}
    />,
  );
  expect(screen.getByText('Remnant returned to stock')).toBeVisible();
  expect(screen.getByText('Remaining length')).toBeVisible();
  expect(screen.queryByText('Radial depth')).not.toBeInTheDocument();
});

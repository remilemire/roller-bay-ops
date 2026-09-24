import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { defaultMeasurementUnits } from '@roller-bay/shared/users';
import type { AllocationDetail } from '@roller-bay/shared/allocations';
import { allocation, stock } from '../../../tests/fixtures';
import { CuttingInstructions } from './cutting-instructions';

const show = (
  snapshot: AllocationDetail = allocation,
  onCheck?: (cuts: number[]) => void,
) =>
  render(
    <CuttingInstructions
      allocation={snapshot}
      units={defaultMeasurementUnits}
      checked={[]}
      onCheck={onCheck}
    />,
  );
const value = (label: string) => screen.getByText(label).nextElementSibling;
it('shows the saved stock lengths and new-roll instructions while retaining interactive cut checks', async () => {
  const check = vi.fn();
  show(allocation, check);
  expect(value('Length before cutting (last reconciled)')).toHaveTextContent(
    '60 yd',
  );
  expect(value('Planned use')).toHaveTextContent('3 yd');
  expect(value('Estimated length after cutting')).toHaveTextContent('57 yd');
  expect(value('Tube outer diameter')).toHaveTextContent(
    'New roll: measure after the first cut.',
  );
  expect(screen.getByText(/Allocation .*Plan revision/)).toHaveTextContent(
    'Created',
  );
  expect(screen.getByText(/Location:/)).toHaveTextContent('Warehouse / A / 2');
  await userEvent.click(screen.getByRole('checkbox', { name: 'Cut 1 done' }));
  expect(check).toHaveBeenCalledWith([0]);
});
it('shows reusable offcut dimensions, quantities and origins without including waste', () => {
  const leftover = {
    stockItemId: stock.id,
    cutIndex: 0,
    widthMm: 1574.8,
    lengthMm: 2743.2,
    quantity: 2,
    reusable: true,
  };
  show({
    ...allocation,
    plannedSummary: {
      leftovers: [
        { ...leftover, kind: 'right-edge' },
        { ...leftover, kind: 'left-edge', reusable: false },
      ],
      reservations: [],
      inputAreaMm2: '0.000000',
      requiredAreaMm2: '0.000000',
      reusableAreaMm2: '0.000000',
      wasteAreaMm2: '0.000000',
      cutCount: 1,
      stockItemCount: 1,
      newRollCount: 1,
    },
  });
  expect(screen.getByRole('listitem')).toHaveTextContent(
    '2 × 62 in × 3 yd · Cut 1 · right edge',
  );
  expect(screen.queryByText(/left edge/)).not.toBeInTheDocument();
  expect(screen.getByText(/Keep remnants at least/)).toHaveTextContent(
    '10 in × 18 in',
  );
  expect(screen.getByText(/Suggestions from the plan/)).toHaveTextContent(
    'actual pieces',
  );
});
it('keeps known tube measurements and remnant instructions distinct', () => {
  const { unmount } = show({
    ...allocation,
    items: [
      {
        ...allocation.items[0]!,
        stockItem: { ...stock, isUsed: true, tubeOuterDiameterMm: 50 },
      },
    ],
  });
  expect(value('Tube outer diameter')).toHaveTextContent('50 mm');
  unmount();
  show({
    ...allocation,
    items: [
      { ...allocation.items[0]!, stockItem: { ...stock, isRemnant: true } },
    ],
  });
  expect(screen.queryByText('Tube outer diameter')).not.toBeInTheDocument();
  expect(screen.getByText('Remnant')).toBeInTheDocument();
});
it('warns about unavailable fabric and does not invent missing saved rules or offcuts', () => {
  show({
    ...allocation,
    needsReplanning: true,
    settings: null,
    plannedSummary: null,
  });
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Review this plan before cutting.',
  );
  expect(
    screen.getByText('Cutting rules were not recorded for this allocation.'),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole('heading', { name: 'Expected reusable offcuts' }),
  ).not.toBeInTheDocument();
});

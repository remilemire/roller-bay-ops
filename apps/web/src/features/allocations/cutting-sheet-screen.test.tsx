import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import {
  allocationDraftSchema,
  type AllocationDetail,
} from '@roller-bay/shared/allocations';
import type { StockItem } from '@roller-bay/shared/stock-items';
import { allocation, stock, timestamp } from '../../../tests/fixtures';
import { AllocationDetailScreen } from './allocation-detail-screen';
import { CuttingSheetScreen } from './cutting-sheet-screen';
import { allocationKey } from './allocations.api';
const detail = (props: { id: string }) => (
  <AllocationDetailScreen {...props} history={null} cancellation={() => null} />
);

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));
vi.mock('@/features/auth/auth-boundary', async () => {
  const { defaultMeasurementUnits } = await import('@roller-bay/shared/users');
  return {
    useCanManage: () => false,
    useCurrentUser: () => ({
      id: 'user-1',
      measurementUnits: defaultMeasurementUnits,
    }),
  };
});

// No station has begun cutting: the sheet prints the allocation's own plan.
const noWorksheet = () => ({
  queryKey: ['worksheet'],
  queryFn: async () => null,
});
function show(
  record: unknown,
  Screen: (props: { id: string }) => ReactNode = (props) => (
    <CuttingSheetScreen {...props} savedWorksheet={noWorksheet} />
  ),
) {
  const queries = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  queries.setQueryData([...allocationKey, allocation.id], record);
  render(
    <QueryClientProvider client={queries}>
      <Screen id={allocation.id} />
    </QueryClientProvider>,
  );
}
const withStock = (item: StockItem): AllocationDetail => ({
  ...allocation,
  items: [{ ...allocation.items[0]!, stockItem: item }],
});
const valueOf = (label: string) =>
  screen.getByText(label).nextElementSibling as HTMLElement;

it('prints the roll with its current figures and blanks for what the cutter records', async () => {
  const print = vi.spyOn(window, 'print').mockImplementation(() => {});
  show(allocation);
  expect(screen.getByRole('heading', { name: '104801' })).toBeInTheDocument();
  expect(valueOf('Current location')).toHaveTextContent('Warehouse / A / 2');
  expect(valueOf('Length before cutting')).toHaveTextContent('60 yd');
  expect(valueOf('Estimated length after cutting')).toHaveTextContent('57 yd');
  expect(
    valueOf('Location after use').querySelector('.sheet-blank'),
  ).not.toBeNull();
  expect(
    valueOf('Tube outer diameter (mm)').querySelector('.sheet-blank'),
  ).not.toBeNull();
  expect(
    valueOf('Radial depth (mm)').querySelector('.sheet-blank'),
  ).not.toBeNull();
  expect(
    screen.getByText('Leave blank if fully consumed.'),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('heading', { name: 'Record after cutting' }),
  ).toBeInTheDocument();
  expect(screen.queryByText(/Remaining width/)).not.toBeInTheDocument();
  expect(screen.getByText('Roll returned to storage')).toBeInTheDocument();
  expect(screen.getByText('Cut 1').closest('tr')).toHaveTextContent('108 in');
  expect(screen.getByText('Blind 1 · 54 in')).toBeInTheDocument();
  expect(valueOf('Minimum remnant (width × length)')).toHaveTextContent(
    '10 in × 18 in',
  );
  expect(screen.getByText(/at least 10 in × 18 in/)).toBeInTheDocument();
  expect(document.querySelectorAll('.sheet-fill')).toHaveLength(3);
  expect(
    screen.getByRole('link', { name: 'Back to allocation' }),
  ).toHaveAttribute('href', `/allocations/${allocation.id}`);
  await userEvent.click(screen.getByRole('button', { name: 'Print' }));
  expect(print).toHaveBeenCalledOnce();
});

it('prints a known tube diameter instead of a blank', () => {
  show(withStock({ ...stock, isUsed: true, tubeOuterDiameterMm: 50 }));
  const tube = valueOf('Tube outer diameter (mm)');
  expect(tube).toHaveTextContent('50');
  expect(tube.querySelector('.sheet-blank')).toBeNull();
  expect(
    screen.queryByText(/measure after the first cut/),
  ).not.toBeInTheDocument();
});

it('asks for the remaining size of a remnant instead of roll measurements', () => {
  show(
    withStock({
      ...stock,
      isRemnant: true,
      isUsed: true,
      remainingLengthMm: 5000,
      explicitLengthMm: 5000,
    }),
  );
  expect(
    valueOf('Remaining width (in)').querySelector('.sheet-blank'),
  ).not.toBeNull();
  expect(
    valueOf('Remaining length (yd)').querySelector('.sheet-blank'),
  ).not.toBeNull();
  expect(
    screen.queryByText(/Radial depth|Tube outer diameter/),
  ).not.toBeInTheDocument();
  expect(screen.getByText('Remnant returned to storage')).toBeInTheDocument();
});

it('names the reusable planned offcuts above the kept-remnants table', () => {
  const leftover = {
    stockItemId: stock.id,
    cutIndex: 0,
    widthMm: 1574.8,
    lengthMm: 2743.2,
    quantity: 1,
    reusable: true,
  };
  show({
    ...allocation,
    plannedSummary: {
      leftovers: [
        { ...leftover, kind: 'right-edge' },
        { ...leftover, kind: 'left-edge', widthMm: 25.4, reusable: false },
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
  expect(screen.getByText(/Expected reusable offcuts/)).toHaveTextContent(
    'Expected reusable offcuts: 62 in × 3 yd (Cut 1 · right edge)',
  );
  expect(screen.queryByText(/left edge/)).not.toBeInTheDocument();
  // Suggestions are a hint only; the table keeps its blank rows.
  expect(document.querySelectorAll('.sheet-fill')).toHaveLength(3);
});

it('offers no sheet for drafts or finished allocations', () => {
  show(
    allocationDraftSchema.parse({
      ...allocation,
      state: 'draft',
      data: { plan: { cuts: [] } },
    }),
  );
  expect(screen.getByText(/Drafts have no cutting sheet/)).toBeInTheDocument();
  expect(
    screen.getByRole('link', { name: 'Back to allocation' }),
  ).toHaveAttribute('href', `/allocations/${allocation.id}`);
});

it('withdraws the sheet once results are recorded', () => {
  show({ ...allocation, state: 'completed', completedAt: timestamp });
  expect(screen.getByText(/This allocation is completed/)).toBeInTheDocument();
  expect(document.querySelector('.sheet-blank')).toBeNull();
});

it('links an active allocation to its cutting sheet and hides the link afterwards', () => {
  show(allocation, detail);
  expect(screen.getByRole('link', { name: 'Cutting sheet' })).toHaveAttribute(
    'href',
    `/allocations/${allocation.id}/cutting-sheet`,
  );
});

it('keeps the cutting sheet link for completed allocation snapshots', () => {
  show({ ...allocation, state: 'completed', completedAt: timestamp }, detail);
  expect(
    screen.queryByRole('link', { name: 'Cutting sheet' }),
  ).toBeInTheDocument();
});

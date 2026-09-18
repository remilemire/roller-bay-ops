import { expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AllocationOptimization } from '@roller-bay/shared/allocations';
import { allocation, stock, ids } from '../../../tests/fixtures';
import { AllocationDetailScreen } from './allocation-detail-screen';
import { AllocationEditor } from './allocation-editor';
import { allocationKey } from './allocations.api';
import { ApiError } from '@/lib/api';

const { replace, optimize } = vi.hoisted(() => ({
  replace: vi.fn(),
  optimize: vi.fn(),
}));
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
vi.mock('@/components/ui/lookup', () => ({
  Lookup: ({ label }: { label: string }) => <div>{label}</div>,
}));
vi.mock('./allocations.api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./allocations.api')>()),
  replaceAllocation: replace,
  optimizeAllocation: optimize,
}));
const client = () =>
  new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });

it('keeps the active plan revision and edited values when a background refresh brings another revision', async () => {
  const user = userEvent.setup();
  const queries = client();
  queries.setQueryData([...allocationKey, allocation.id], allocation);
  replace.mockRejectedValue(new ApiError(409, 'Allocation changed'));
  render(
    <QueryClientProvider client={queries}>
      <AllocationDetailScreen id={allocation.id} />
    </QueryClientProvider>,
  );
  await user.click(screen.getByRole('button', { name: 'Edit plan' }));
  expect(
    screen.queryByLabelText(/Drop allowance|Edge trim|Minimum reusable/),
  ).not.toBeInTheDocument();
  await user.clear(screen.getByLabelText('Order number'));
  await user.type(screen.getByLabelText('Order number'), 'LOCAL-PLAN');
  queries.setQueryData([...allocationKey, allocation.id], {
    ...allocation,
    orderNumber: 'REMOTE-PLAN',
    revision: 2,
  });
  await user.click(screen.getByRole('button', { name: 'Update reservations' }));
  await waitFor(() =>
    expect(replace).toHaveBeenCalledWith(
      allocation.id,
      expect.objectContaining({
        expectedRevision: 1,
        orderNumber: 'LOCAL-PLAN',
      }),
    ),
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Allocation changed',
  );
  expect(screen.getByLabelText('Order number')).toHaveValue('LOCAL-PLAN');
});

it('offers generating or hand-building a plan and reports planning in one place above the actions', async () => {
  const user = userEvent.setup();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  let finish!: (result: AllocationOptimization) => void;
  optimize.mockReturnValue(
    new Promise<AllocationOptimization>((resolve) => (finish = resolve)),
  );
  render(
    <QueryClientProvider client={client()}>
      <AllocationEditor />
    </QueryClientProvider>,
  );
  // An empty plan presents the two ways to start and nothing to validate.
  const start = screen.getByText('Build it by hand').closest('.plan-start')!;
  expect(start).toContainElement(
    screen.getByRole('button', { name: 'Generate plan' }),
  );
  expect(start).toContainElement(
    screen.getByRole('button', { name: 'Add cut' }),
  );
  expect(
    screen.queryByRole('button', { name: 'Validate plan' }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Add cut' }));
  expect(screen.getByText('Cut 1')).toBeInTheDocument();
  expect(screen.queryByText('Build it by hand')).not.toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Validate plan' }),
  ).toBeInTheDocument();
  // Generating over hand-built cuts asks first, then replaces them.
  await user.click(screen.getByRole('button', { name: 'Generate plan' }));
  expect(window.confirm).toHaveBeenCalledWith(
    'Replace the current cuts with a generated plan?',
  );
  const save = screen.getByRole('button', { name: 'Save draft' });
  const above = (element: HTMLElement) =>
    Boolean(
      element.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING,
    );
  const pending = await screen.findByRole('status');
  expect(pending).toHaveTextContent('Generating a cutting plan…');
  expect(above(pending)).toBe(true);
  expect(save).toBeDisabled();
  finish({
    status: 'feasible',
    plan: allocation.plan,
    stockItems: [stock],
    summary: {
      leftovers: [],
      reservations: [{ stockItemId: ids.stock, reservedLengthMm: 2743.2 }],
      inputAreaMm2: '1.000000',
      requiredAreaMm2: '1.000000',
      reusableAreaMm2: '0.000000',
      wasteAreaMm2: '0.000000',
      cutCount: 1,
      stockItemCount: 1,
      newRollCount: 1,
    },
  });
  const result = await screen.findByText('Valid cutting plan');
  expect(above(result)).toBe(true);
  expect(screen.getByRole('status')).toContainElement(result);
  expect(
    screen.queryByText('Generating a cutting plan…'),
  ).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/Cut length/)).not.toBeInTheDocument();
  expect(screen.getByLabelText('Quantity in this cut')).toHaveValue(1);
  expect(save).toBeEnabled();
});

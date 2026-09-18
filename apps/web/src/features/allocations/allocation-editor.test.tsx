import { expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { allocation } from '../../../tests/fixtures';
import { AllocationDetailScreen } from './allocation-detail-screen';
import { allocationKey } from './allocations.api';
import { ApiError } from '@/lib/api';

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
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
}));

it('keeps the active plan revision and edited values when a background refresh brings another revision', async () => {
  const user = userEvent.setup();
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  client.setQueryData([...allocationKey, allocation.id], allocation);
  replace.mockRejectedValue(new ApiError(409, 'Allocation changed'));
  render(
    <QueryClientProvider client={client}>
      <AllocationDetailScreen id={allocation.id} />
    </QueryClientProvider>,
  );
  await user.click(screen.getByRole('button', { name: 'Edit plan' }));
  expect(
    screen.queryByLabelText(
      /Extra drop allowance|Trim per outside edge|Minimum reusable/,
    ),
  ).not.toBeInTheDocument();
  await user.clear(screen.getByLabelText('Order number'));
  await user.type(screen.getByLabelText('Order number'), 'LOCAL-PLAN');
  client.setQueryData([...allocationKey, allocation.id], {
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

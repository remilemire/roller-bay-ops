import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  QueryClient,
  QueryClientProvider,
  queryOptions,
} from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { AllocationList } from '@roller-bay/shared/allocations';
import { ids, timestamp } from '../../../tests/fixtures';
import { AllocationListScreen } from './allocation-list-screen';
import { allocationList, cancelAllocation } from './allocations.api';

const state = vi.hoisted(() => ({ search: '', replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(state.search),
  usePathname: () => '/allocations',
  useRouter: () => ({ replace: state.replace }),
}));
vi.mock('./allocations.api', async (original) => ({
  ...(await original<typeof import('./allocations.api')>()),
  allocationList: vi.fn(),
  cancelAllocation: vi.fn(),
}));
const allocation: AllocationList['items'][number] = {
  id: ids.allocation,
  orderNumber: '104801',
  createdByUserId: ids.user,
  revision: 2,
  state: 'active',
  needsReplanning: false,
  createdAt: timestamp,
  updatedAt: timestamp,
  completedAt: null,
  cancelledAt: null,
};
beforeEach(() => {
  state.search = '';
  state.replace.mockReset();
  vi.mocked(cancelAllocation).mockReset();
  vi.mocked(allocationList)
    .mockReset()
    .mockImplementation((filters = {}) =>
      queryOptions({
        queryKey: ['allocations', 'list', filters],
        queryFn: async (): Promise<AllocationList> => ({
          items: [allocation],
          total: 1,
          page: 1,
          pageSize: 25,
        }),
      }),
    );
});
function show(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

it('opens on active allocations and keeps the tab in the URL', async () => {
  state.search = 'state=bogus';
  show(<AllocationListScreen />);
  const row = (await screen.findByText('104801')).closest('tr')!;
  expect(row).toHaveTextContent('active');
  expect(allocationList).toHaveBeenLastCalledWith({
    search: '',
    page: 1,
    state: 'active',
  });
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Drafts' }));
  expect(state.replace).toHaveBeenLastCalledWith('/allocations?state=draft', {
    scroll: false,
  });
  // The default tab needs no parameter.
  await user.click(screen.getByRole('button', { name: 'Active' }));
  expect(state.replace).toHaveBeenLastCalledWith('/allocations', {
    scroll: false,
  });
});

it('asks the API for every state on the All orders tab', async () => {
  state.search = 'state=all&search=1048&page=2';
  show(<AllocationListScreen />);
  await screen.findByText('104801');
  expect(allocationList).toHaveBeenLastCalledWith({
    search: '1048',
    page: 2,
    state: '',
  });
});

it('cancels an active allocation at the listed revision after confirmation', async () => {
  vi.mocked(cancelAllocation).mockRejectedValueOnce(
    new Error('Stale revision'),
  );
  show(<AllocationListScreen />);
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole('button', { name: 'Cancel allocation 104801' }),
  );
  expect(cancelAllocation).not.toHaveBeenCalled();
  const dialog = screen.getByRole('dialog', {
    name: 'Cancel allocation 104801?',
  });
  await user.click(
    within(dialog).getByRole('button', { name: 'Cancel allocation' }),
  );
  expect(cancelAllocation).toHaveBeenLastCalledWith(ids.allocation, 2);
  // A refusal stays in the dialog rather than closing it.
  expect(await within(dialog).findByRole('alert')).toBeVisible();
  await user.click(
    within(dialog).getByRole('button', { name: 'Keep allocation' }),
  );
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('offers no cancel action once an allocation is finished', async () => {
  vi.mocked(allocationList).mockImplementation((filters = {}) =>
    queryOptions({
      queryKey: ['allocations', 'list', filters],
      queryFn: async (): Promise<AllocationList> => ({
        items: [{ ...allocation, state: 'completed', completedAt: timestamp }],
        total: 1,
        page: 1,
        pageSize: 25,
      }),
    }),
  );
  show(<AllocationListScreen />);
  await screen.findByText('104801');
  expect(screen.getByRole('columnheader', { name: 'Actions' })).toBeVisible();
  expect(
    screen.queryByRole('button', { name: /Cancel allocation/ }),
  ).toBeNull();
});

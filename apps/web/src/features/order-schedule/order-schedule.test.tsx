import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  QueryClient,
  QueryClientProvider,
  queryOptions,
} from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ApiError } from '@/lib/api';
import { calendarDateLabel } from '@/lib/format';
import { order } from '../../../tests/fixtures';
import { OrderDetailScreen } from './order-detail-screen';
import { OrderScheduleScreen } from './order-schedule-screen';
import {
  createOrder,
  deleteOrder,
  orderDetail,
  orderList,
  updateOrder,
} from './order-schedule.api';

const state = vi.hoisted(() => ({
  canManage: true,
  search: '',
  replace: vi.fn(),
  push: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(state.search),
  usePathname: () => '/order-schedule',
  useRouter: () => ({ replace: state.replace, push: state.push }),
}));
vi.mock('@/features/auth/auth-boundary', () => ({
  useCanManage: () => state.canManage,
}));
vi.mock('@/features/audit/history', () => ({ History: () => null }));
vi.mock('./order-schedule.api', async (original) => ({
  ...(await original<typeof import('./order-schedule.api')>()),
  orderList: vi.fn(),
  orderDetail: vi.fn(),
  createOrder: vi.fn(),
  updateOrder: vi.fn(),
  deleteOrder: vi.fn(),
}));
beforeEach(() => {
  Object.assign(state, { canManage: true, search: '' });
  state.replace.mockReset();
  state.push.mockReset();
  vi.mocked(orderList)
    .mockReset()
    .mockImplementation((filters = {}) =>
      queryOptions({
        queryKey: ['order-schedule', 'list', filters],
        queryFn: async () => ({
          items: [order],
          total: 1,
          page: 1,
          pageSize: 25,
        }),
      }),
    );
  vi.mocked(orderDetail)
    .mockReset()
    .mockImplementation((id) =>
      queryOptions({
        queryKey: ['order-schedule', id],
        queryFn: async () => order,
      }),
    );
  for (const write of [createOrder, updateOrder, deleteOrder])
    vi.mocked(write).mockReset();
});
function show(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

it('formats a ship date as its calendar day in every timezone', () => {
  // Midnight UTC is still Thursday evening west of Greenwich.
  expect(calendarDateLabel('2026-10-02')).toBe('Fri, Oct 2, 2026');
});

it('opens on unshipped orders and keeps the filter and search in the URL', async () => {
  state.search = 'status=bogus';
  show(<OrderScheduleScreen />);
  const user = userEvent.setup();
  const row = (await screen.findByText('104801')).closest('tr')!;
  expect(row).toHaveTextContent('Fri, Oct 2, 2026');
  expect(row).toHaveTextContent('allocated');
  expect(row).toHaveTextContent('Rush');
  expect(within(row).getByRole('link')).toHaveAttribute(
    'href',
    `/order-schedule/${order.id}`,
  );
  expect(orderList).toHaveBeenLastCalledWith({
    search: '',
    page: 1,
    status: 'open',
  });
  await user.click(screen.getByRole('button', { name: 'Shipped' }));
  expect(state.replace).toHaveBeenLastCalledWith(
    '/order-schedule?status=shipped',
    { scroll: false },
  );
  // The default tab needs no parameter.
  await user.click(screen.getByRole('button', { name: 'Open' }));
  expect(state.replace).toHaveBeenLastCalledWith('/order-schedule', {
    scroll: false,
  });
});

it('asks the API for every order on the All orders tab', async () => {
  state.search = 'status=all&search=1048&page=2';
  show(<OrderScheduleScreen />);
  await screen.findByText('104801');
  expect(orderList).toHaveBeenLastCalledWith({
    search: '1048',
    page: 2,
    status: '',
  });
});

it('hides schedule writes from employees who cannot manage', async () => {
  state.canManage = false;
  show(<OrderScheduleScreen />);
  await screen.findByText('104801');
  expect(screen.queryByRole('button', { name: 'Add order' })).toBeNull();
});

it('adds an order and shows rejected fields beside them', async () => {
  vi.mocked(createOrder).mockRejectedValueOnce(
    new ApiError(409, 'This order is already on the schedule.', undefined, [
      {
        code: 'order_already_scheduled',
        path: ['orderNumber'],
        message: 'Already scheduled.',
      },
    ]),
  );
  vi.mocked(createOrder).mockResolvedValueOnce(order);
  show(<OrderScheduleScreen />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Add order' }));
  const dialog = within(screen.getByRole('dialog'));
  const number = dialog.getByLabelText(/Order number/);
  const date = dialog.getByLabelText(/Ship date/);
  await user.type(number, '10-48x01');
  expect(number).toHaveValue('104801');

  // Saturday: caught before any request is made.
  await user.type(date, '2026-10-03');
  await user.click(dialog.getByRole('button', { name: 'Save order' }));
  await waitFor(() =>
    expect(date).toHaveAccessibleDescription(/Must be a weekday\./),
  );
  expect(createOrder).not.toHaveBeenCalled();

  await user.clear(date);
  await user.type(date, '2026-10-02');
  await user.type(dialog.getByLabelText('Note'), ' Rush ');
  await user.click(dialog.getByRole('button', { name: 'Save order' }));
  const notice = await dialog.findByRole('alert');
  expect(notice).toHaveTextContent('This order is already on the schedule.');
  expect(notice).not.toHaveTextContent('Already scheduled.');
  expect(number).toHaveAccessibleDescription(/Already scheduled\./);
  expect(createOrder).toHaveBeenLastCalledWith({
    orderNumber: '104801',
    shipDate: '2026-10-02',
    note: 'Rush',
  });

  await user.click(dialog.getByRole('button', { name: 'Save order' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

it('edits, ships, and deletes an order with the revision it shows', async () => {
  vi.mocked(updateOrder).mockResolvedValue(order);
  vi.mocked(deleteOrder).mockResolvedValue(undefined);
  show(<OrderDetailScreen id={order.id} />);
  const user = userEvent.setup();
  expect(
    await screen.findByRole('heading', { name: '104801' }),
  ).toBeInTheDocument();
  expect(screen.getByText('Ships Fri, Oct 2, 2026')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'View allocation' })).toHaveAttribute(
    'href',
    '/allocations?search=104801',
  );

  await user.click(screen.getByRole('button', { name: 'Edit' }));
  const editor = within(screen.getByRole('dialog'));
  // The order number is fixed once scheduled.
  expect(editor.queryByLabelText(/Order number/)).toBeNull();
  const date = editor.getByLabelText(/Ship date/);
  await user.clear(date);
  await user.type(date, '2026-10-09');
  await user.clear(editor.getByLabelText('Note'));
  await user.click(editor.getByRole('button', { name: 'Save order' }));
  await waitFor(() =>
    expect(updateOrder).toHaveBeenLastCalledWith(order.id, {
      expectedRevision: 3,
      shipDate: '2026-10-09',
      note: '',
    }),
  );
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

  await user.click(screen.getByRole('button', { name: 'Mark shipped' }));
  await waitFor(() =>
    expect(updateOrder).toHaveBeenLastCalledWith(order.id, {
      expectedRevision: 3,
      shipped: true,
    }),
  );

  await user.click(screen.getByRole('button', { name: 'Delete' }));
  await user.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }),
  );
  await waitFor(() => expect(deleteOrder).toHaveBeenCalledWith(order.id, 3));
  expect(state.push).toHaveBeenCalledWith('/order-schedule');
});

it('keeps a refused delete in its dialog', async () => {
  vi.mocked(deleteOrder).mockRejectedValue(
    new ApiError(
      409,
      'This order has allocations or drafts and cannot be deleted.',
    ),
  );
  show(<OrderDetailScreen id={order.id} />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Delete' }));
  const dialog = within(screen.getByRole('dialog'));
  await user.click(dialog.getByRole('button', { name: 'Delete' }));
  expect(await dialog.findByRole('alert')).toHaveTextContent(
    'This order has allocations or drafts and cannot be deleted.',
  );
  expect(state.push).not.toHaveBeenCalled();
});

it('shows employees the order without its admin actions', async () => {
  state.canManage = false;
  show(<OrderDetailScreen id={order.id} />);
  await screen.findByRole('heading', { name: '104801' });
  for (const name of ['Edit', 'Mark shipped', 'Delete'])
    expect(screen.queryByRole('button', { name })).toBeNull();
});

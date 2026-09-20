import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  QueryClient,
  QueryClientProvider,
  queryOptions,
} from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { ScheduledOrder } from '@roller-bay/shared/order-schedule';
import { ApiError } from '@/lib/api';
import { calendarDateLabel } from '@/lib/format';
import { order } from '../../../tests/fixtures';
import { OrderDetailScreen } from './order-detail-screen';
import { OrderScheduleScreen } from './order-schedule-screen';
import {
  createOrder,
  deleteOrder,
  lookupSchedulableOrders,
  orderDetail,
  orderList,
  orderRange,
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
vi.mock('@/lib/calendar-dates', async (original) => ({
  ...(await original<typeof import('@/lib/calendar-dates')>()),
  today: () => '2026-09-28',
}));
vi.mock('./order-schedule.api', async (original) => ({
  ...(await original<typeof import('./order-schedule.api')>()),
  orderList: vi.fn(),
  orderDetail: vi.fn(),
  orderRange: vi.fn(),
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
  // Monday 104790, Friday 104801 and 104820, and one order outside October.
  vi.mocked(orderRange)
    .mockReset()
    .mockImplementation((from, to) =>
      queryOptions({
        queryKey: ['order-schedule', 'range', from, to],
        queryFn: async () =>
          (
            [
              order,
              { ...order, id: 'b', orderNumber: '104820', status: 'scheduled' },
              {
                ...order,
                id: 'c',
                orderNumber: '104790',
                shipDate: '2026-09-28',
              },
              ...['1', '2', '3', '4', '5', '6'].map((n) => ({
                ...order,
                id: `d${n}`,
                orderNumber: `10483${n}`,
                shipDate: '2026-10-13',
              })),
            ] as ScheduledOrder[]
          ).filter((row) => row.shipDate >= from && row.shipDate <= to),
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

it('offers the allocation editor only orders that can still be allocated', async () => {
  const fetched = vi.fn<(url: string) => Promise<Response>>(
    async () =>
      new Response(
        JSON.stringify({ items: [order], total: 1, page: 1, pageSize: 25 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
  );
  vi.stubGlobal('fetch', fetched);
  const result = await lookupSchedulableOrders(
    '1048019',
    1,
    new AbortController().signal,
  );
  const url = new URL(String(fetched.mock.calls[0]![0]), 'http://localhost');
  expect(url.pathname).toMatch(/\/order-schedule$/);
  expect(url.searchParams.get('status')).toBe('scheduled');
  // The API caps the search at an order number's six characters.
  expect(url.searchParams.get('search')).toBe('104801');
  // The option id is the order number the allocation stores.
  expect(result).toEqual({
    total: 1,
    items: [{ id: '104801', label: '104801 · ships Fri, Oct 2, 2026' }],
  });
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
  expect(screen.queryByRole('button', { name: /Mark order/ })).toBeNull();
  expect(screen.queryByRole('columnheader', { name: 'Actions' })).toBeNull();
});

it('marks an order shipped from its row with the revision the row shows', async () => {
  vi.mocked(updateOrder).mockResolvedValueOnce(order);
  vi.mocked(updateOrder).mockRejectedValueOnce(
    new ApiError(409, 'Order changed; refresh before saving.'),
  );
  show(<OrderScheduleScreen />);
  const user = userEvent.setup();
  const button = await screen.findByRole('button', {
    name: 'Mark order 104801 shipped',
  });
  await user.click(button);
  await waitFor(() =>
    expect(updateOrder).toHaveBeenLastCalledWith(order.id, {
      expectedRevision: 3,
      shipped: true,
    }),
  );
  // A stale row is reported above the list.
  await user.click(
    await screen.findByRole('button', { name: 'Mark order 104801 shipped' }),
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Order changed; refresh before saving.',
  );
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
  await user.type(number, '10-48x01');
  expect(number).toHaveValue('104801');

  // A missing date is caught before any request is made.
  await user.click(dialog.getByRole('button', { name: 'Save order' }));
  const date = dialog.getByRole('button', { name: 'Ship date' });
  await waitFor(() =>
    expect(date).toHaveAccessibleDescription('Choose a ship date.'),
  );
  expect(createOrder).not.toHaveBeenCalled();

  // The calendar opens on the current month and offers weekdays only.
  await user.click(date);
  await user.click(dialog.getByRole('button', { name: 'Next month' }));
  await user.click(dialog.getByRole('button', { name: 'Fri, Oct 2, 2026' }));
  expect(date).toHaveTextContent('Fri, Oct 2, 2026');
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
  await user.click(editor.getByRole('button', { name: 'Ship date' }));
  await user.click(editor.getByRole('button', { name: 'Fri, Oct 9, 2026' }));
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

it('reschedules an order from its row with the calendar already open', async () => {
  vi.mocked(updateOrder).mockResolvedValue(order);
  show(<OrderScheduleScreen />);
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole('button', { name: 'Reschedule order 104801' }),
  );
  const dialog = within(
    screen.getByRole('dialog', { name: /Reschedule order/ }),
  );
  const save = dialog.getByRole('button', { name: 'Reschedule' });
  // Nothing to save until the date changes.
  expect(save).toBeDisabled();
  await user.click(dialog.getByRole('button', { name: 'Tue, Oct 6, 2026' }));
  await user.click(save);
  await waitFor(() =>
    expect(updateOrder).toHaveBeenLastCalledWith(order.id, {
      expectedRevision: 3,
      shipDate: '2026-10-06',
    }),
  );
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

it('groups the working week by day with totals and adds an order to a day', async () => {
  state.search = 'view=week';
  vi.mocked(createOrder).mockResolvedValue(order);
  show(<OrderScheduleScreen />);
  const user = userEvent.setup();
  // Today is Monday 28 September, so this is the week on show.
  expect(
    await screen.findByRole('heading', { name: 'Sep 28 – Oct 2, 2026' }),
  ).toBeInTheDocument();
  expect(orderRange).toHaveBeenLastCalledWith('2026-09-28', '2026-10-02');
  expect(
    await screen.findByText('3 orders · 1 scheduled · 2 allocated'),
  ).toBeInTheDocument();
  const friday = within(
    screen.getByRole('region', { name: 'Fri, Oct 2, 2026' }),
  );
  expect(friday.getByText('Oct 2 · 2 orders')).toBeInTheDocument();
  // This is the current week, so there is nothing to go back to.
  expect(
    screen.queryByRole('button', { name: /Back to this week/ }),
  ).toBeNull();
  expect(friday.getAllByRole('link').map((link) => link.textContent)).toEqual([
    '104801',
    '104820',
  ]);
  expect(
    within(screen.getByRole('region', { name: 'Tue, Sep 29, 2026' })).getByText(
      'No orders',
    ),
  ).toBeInTheDocument();

  await user.click(
    screen.getByRole('button', { name: 'Add order on Thu, Oct 1, 2026' }),
  );
  const dialog = within(screen.getByRole('dialog'));
  // The day it was added from is already the ship date.
  expect(dialog.getByRole('button', { name: 'Ship date' })).toHaveTextContent(
    'Thu, Oct 1, 2026',
  );
  await user.type(dialog.getByLabelText(/Order number/), '104900');
  await user.click(dialog.getByRole('button', { name: 'Save order' }));
  await waitFor(() =>
    expect(createOrder).toHaveBeenLastCalledWith({
      orderNumber: '104900',
      shipDate: '2026-10-01',
      note: '',
    }),
  );

  await user.click(screen.getByRole('button', { name: 'Next week' }));
  expect(state.replace).toHaveBeenLastCalledWith(
    '/order-schedule?view=week&week=2026-10-05',
    { scroll: false },
  );
});

it('shows any day of a week as that week, and employees a read-only board', async () => {
  state.canManage = false;
  state.search = 'view=week&week=2026-10-14';
  show(<OrderScheduleScreen />);
  expect(
    await screen.findByRole('heading', { name: 'Oct 12 – Oct 16, 2026' }),
  ).toBeInTheDocument();
  await screen.findByText('6 orders · 6 allocated');
  expect(screen.queryByRole('button', { name: /Add order/ })).toBeNull();
  expect(screen.queryByRole('button', { name: /Move order/ })).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Back to this week' }),
  ).toBeInTheDocument();
});

it('lays the month out Monday to Friday and adds an order to a day', async () => {
  state.search = 'view=month&month=2026-10';
  show(<OrderScheduleScreen />);
  const user = userEvent.setup();
  expect(
    await screen.findByRole('heading', { name: 'October 2026' }),
  ).toBeInTheDocument();
  // The grid runs from the Monday before the 1st to the Friday after the 31st.
  expect(orderRange).toHaveBeenLastCalledWith('2026-09-28', '2026-10-30');
  // September's order shows in its edge day but is not an October order.
  expect(
    await screen.findByText('8 orders · 1 scheduled · 7 allocated'),
  ).toBeInTheDocument();
  expect(
    within(
      screen.getByRole('gridcell', { name: 'Mon, Sep 28, 2026' }),
    ).getByRole('link'),
  ).toHaveTextContent('104790');
  const busy = within(
    screen.getByRole('gridcell', { name: 'Tue, Oct 13, 2026' }),
  );
  expect(busy.getByText('6 orders')).toBeInTheDocument();
  expect(busy.getByRole('link', { name: '+2 more' })).toHaveAttribute(
    'href',
    '/order-schedule?view=week&week=2026-10-13',
  );
  expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(
    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
  );
  await user.click(
    screen.getByRole('button', { name: 'Add order on Wed, Oct 21, 2026' }),
  );
  expect(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: 'Ship date',
    }),
  ).toHaveTextContent('Wed, Oct 21, 2026');
  await user.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }),
  );
  await user.click(screen.getByRole('button', { name: 'Back to this month' }));
  expect(state.replace).toHaveBeenLastCalledWith('/order-schedule?view=month', {
    scroll: false,
  });
  await user.click(screen.getByRole('button', { name: 'Previous month' }));
  expect(state.replace).toHaveBeenLastCalledWith(
    '/order-schedule?view=month&month=2026-09',
    { scroll: false },
  );
});

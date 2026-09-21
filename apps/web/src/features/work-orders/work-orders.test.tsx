import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  QueryClient,
  QueryClientProvider,
  queryOptions,
} from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type {
  WorkOrder,
  WorkOrderDetail,
  WorkOrderList,
} from '@roller-bay/shared/work-orders';
import { ApiError } from '@/lib/api';
import { calendarDateLabel } from '@/lib/format';
import { order } from '../../../tests/fixtures';
import { OrderDetailScreen } from './order-detail-screen';
import { WorkOrdersScreen } from './work-orders-screen';
import {
  createOrder,
  deleteOrder,
  lookupUnallocatedOrders,
  orderDetail,
  orderList,
  orderRange,
  unscheduledOrders,
  updateOrder,
} from './work-orders.api';

const state = vi.hoisted(() => ({
  canManage: true,
  search: '',
  replace: vi.fn(),
  push: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(state.search),
  usePathname: () => '/work-orders',
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
vi.mock('./work-orders.api', async (original) => ({
  ...(await original<typeof import('./work-orders.api')>()),
  orderList: vi.fn(),
  orderDetail: vi.fn(),
  orderRange: vi.fn(),
  unscheduledOrders: vi.fn(),
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
        queryKey: ['work-orders', 'list', filters],
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
        queryKey: ['work-orders', id],
        queryFn: async (): Promise<WorkOrderDetail> => ({
          ...order,
          lines: [],
        }),
      }),
    );
  // Monday 104790, Friday 104801 and 104820, and one order outside October.
  vi.mocked(orderRange)
    .mockReset()
    .mockImplementation((from, to) =>
      queryOptions({
        queryKey: ['work-orders', 'range', from, to],
        queryFn: async () =>
          (
            [
              order,
              { ...order, id: 'b', orderNumber: '104820', status: 'cut' },
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
            ] as WorkOrder[]
          ).filter((row) => row.shipDate! >= from && row.shipDate! <= to),
      }),
    );
  // One allocated order is still waiting for a ship date.
  vi.mocked(unscheduledOrders)
    .mockReset()
    .mockImplementation(() =>
      queryOptions({
        queryKey: ['work-orders', 'unscheduled'],
        queryFn: async (): Promise<WorkOrderList> => ({
          items: [
            {
              ...order,
              id: 'w',
              orderNumber: '104850',
              quantity: 5,
              shipDate: null,
              scheduledAt: null,
              status: 'allocated',
            },
          ],
          total: 1,
          page: 1,
          pageSize: 100,
        }),
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

it('offers the allocation editor only orders with no allocation yet', async () => {
  const fetched = vi.fn<(url: string) => Promise<Response>>(
    async () =>
      new Response(
        JSON.stringify({ items: [order], total: 1, page: 1, pageSize: 25 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
  );
  vi.stubGlobal('fetch', fetched);
  const result = await lookupUnallocatedOrders(
    '1048019',
    1,
    new AbortController().signal,
  );
  const url = new URL(String(fetched.mock.calls[0]![0]), 'http://localhost');
  expect(url.pathname).toMatch(/\/work-orders$/);
  expect(url.searchParams.get('status')).toBe('new');
  // The API caps the search at an order number's six characters.
  expect(url.searchParams.get('search')).toBe('104801');
  // The option id is the order's id, which the allocation names.
  expect(result).toEqual({
    total: 1,
    items: [{ id: order.id, label: '104801 · 14 blinds' }],
  });
});

it('opens the list on unshipped orders and keeps the filter in the URL', async () => {
  state.search = 'view=list&status=bogus';
  show(<WorkOrdersScreen />);
  const user = userEvent.setup();
  const row = (await screen.findByText('104801')).closest('tr')!;
  expect(row).toHaveTextContent('Fri, Oct 2, 2026');
  expect(row).toHaveTextContent('scheduled');
  expect(row).toHaveTextContent('Rush');
  expect(within(row).getByRole('cell', { name: '14' })).toBeInTheDocument();
  expect(within(row).getByRole('link')).toHaveAttribute(
    'href',
    `/work-orders/${order.id}`,
  );
  expect(orderList).toHaveBeenLastCalledWith({
    search: '',
    page: 1,
    status: 'open',
  });
  await user.click(screen.getByRole('button', { name: 'Shipped' }));
  expect(state.replace).toHaveBeenLastCalledWith(
    '/work-orders?view=list&status=shipped',
    { scroll: false },
  );
  // The two work queues: orders needing fabric, then orders needing a date.
  for (const [name, status] of [
    ['To allocate', 'new'],
    ['To schedule', 'unscheduled'],
  ]) {
    await user.click(screen.getByRole('button', { name }));
    expect(state.replace).toHaveBeenLastCalledWith(
      `/work-orders?view=list&status=${status}`,
      { scroll: false },
    );
  }
  // The default tab needs no parameter.
  await user.click(screen.getByRole('button', { name: 'Open' }));
  expect(state.replace).toHaveBeenLastCalledWith('/work-orders?view=list', {
    scroll: false,
  });
});

it('asks the API for every order on the All orders tab', async () => {
  state.search = 'view=list&status=all&search=1048&page=2';
  show(<WorkOrdersScreen />);
  await screen.findByText('104801');
  expect(orderList).toHaveBeenLastCalledWith({
    search: '1048',
    page: 2,
    status: '',
  });
});

it('hides schedule writes from employees who cannot manage', async () => {
  state.canManage = false;
  state.search = 'view=list';
  show(<WorkOrdersScreen />);
  await screen.findByText('104801');
  expect(screen.queryByRole('button', { name: 'Add order' })).toBeNull();
  expect(screen.queryByRole('button', { name: /Mark order/ })).toBeNull();
  expect(screen.queryByRole('columnheader', { name: 'Actions' })).toBeNull();
});

it('marks an order shipped from its row with the revision the row shows', async () => {
  state.search = 'view=list';
  vi.mocked(updateOrder).mockResolvedValueOnce(order);
  vi.mocked(updateOrder).mockRejectedValueOnce(
    new ApiError(409, 'Order changed; refresh before saving.'),
  );
  show(<WorkOrdersScreen />);
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
    new ApiError(
      409,
      'A work order with this number already exists.',
      undefined,
      [
        {
          code: 'order_already_exists',
          path: ['orderNumber'],
          message: 'Already exists.',
        },
      ],
    ),
  );
  vi.mocked(createOrder).mockResolvedValueOnce(order);
  show(<WorkOrdersScreen />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Add order' }));
  const dialog = within(screen.getByRole('dialog'));
  const number = dialog.getByLabelText(/Order number/);
  await user.type(number, '10-48x01');
  expect(number).toHaveValue('104801');
  // Its blinds are entered where its fabric is allocated, and counted there.
  expect(dialog.queryByLabelText(/Blinds/)).toBeNull();

  // An order has no ship date until fabric is allocated for it.
  expect(dialog.queryByRole('button', { name: 'Ship date' })).toBeNull();
  await user.type(dialog.getByLabelText('Note'), ' Rush ');
  await user.click(dialog.getByRole('button', { name: 'Save order' }));
  const notice = await dialog.findByRole('alert');
  expect(notice).toHaveTextContent(
    'A work order with this number already exists.',
  );
  expect(notice).not.toHaveTextContent('Already exists.');
  expect(number).toHaveAccessibleDescription(/Already exists\./);
  expect(createOrder).toHaveBeenLastCalledWith({
    orderNumber: '104801',
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
    '/allocations?state=all&search=104801',
  );

  await user.click(screen.getByRole('button', { name: 'Edit' }));
  const editor = within(screen.getByRole('dialog'));
  // The order number is fixed once created, and the date has its own dialog.
  expect(editor.queryByLabelText(/Order number/)).toBeNull();
  expect(editor.queryByRole('button', { name: 'Ship date' })).toBeNull();
  await user.clear(editor.getByLabelText('Note'));
  await user.click(editor.getByRole('button', { name: 'Save order' }));
  await waitFor(() =>
    expect(updateOrder).toHaveBeenLastCalledWith(order.id, {
      expectedRevision: 3,
      note: '',
    }),
  );
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

  // An allocated order can be taken off the schedule without touching the rest.
  await user.click(screen.getByRole('button', { name: 'Reschedule' }));
  await user.click(
    within(screen.getByRole('dialog', { name: /Reschedule order/ })).getByRole(
      'button',
      { name: 'Clear date' },
    ),
  );
  await waitFor(() =>
    expect(updateOrder).toHaveBeenLastCalledWith(order.id, {
      expectedRevision: 3,
      shipDate: null,
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
  expect(state.push).toHaveBeenCalledWith('/work-orders');
});

it('keeps a refused delete in its dialog', async () => {
  vi.mocked(deleteOrder).mockRejectedValue(
    new ApiError(
      409,
      'This order has an allocation. Cancel it before deleting the order.',
    ),
  );
  show(<OrderDetailScreen id={order.id} />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Delete' }));
  const dialog = within(screen.getByRole('dialog'));
  await user.click(dialog.getByRole('button', { name: 'Delete' }));
  expect(await dialog.findByRole('alert')).toHaveTextContent(
    'This order has an allocation. Cancel it before deleting the order.',
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
  state.search = 'view=list';
  vi.mocked(updateOrder).mockResolvedValue(order);
  show(<WorkOrdersScreen />);
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

it('groups the working week by day with totals', async () => {
  show(<WorkOrdersScreen />);
  const user = userEvent.setup();
  // Today is Monday 28 September, so this is the week on show.
  expect(
    await screen.findByRole('heading', { name: 'Sep 28 – Oct 2, 2026' }),
  ).toBeInTheDocument();
  expect(orderRange).toHaveBeenLastCalledWith('2026-09-28', '2026-10-02');
  expect(
    await screen.findByText('3 orders · 42 blinds · 2 scheduled · 1 cut'),
  ).toBeInTheDocument();
  const friday = within(
    screen.getByRole('region', { name: 'Fri, Oct 2, 2026' }),
  );
  // Each day's totals sit in its footer.
  expect(
    screen.getByRole('region', { name: 'Fri, Oct 2, 2026' }),
  ).toHaveTextContent(/Fri\s*Oct 2.*2 orders\s*28 blinds$/);
  expect(friday.getAllByRole('link').map((link) => link.textContent)).toEqual([
    '104801',
    '104820',
  ]);
  // Allocated orders with no date wait in a tray above the days, outside the
  // week's totals, to be dragged onto one.
  const tray = within(screen.getByRole('region', { name: 'To schedule' }));
  expect(tray.getByText('1 order · 5 blinds')).toBeInTheDocument();
  expect(tray.getByRole('link', { name: '104850' })).toHaveAttribute(
    'href',
    '/work-orders/w',
  );
  expect(
    tray.getByRole('button', { name: 'Move order 104850 to a day' }),
  ).toBeInTheDocument();
  // An order reaches a day by being scheduled, never by being added to it.
  const tuesday = screen.getByRole('region', { name: 'Tue, Sep 29, 2026' });
  expect(tuesday).toHaveTextContent(/No orders\s*0 orders\s*0 blinds$/);
  expect(screen.queryByRole('button', { name: /Add order on/ })).toBeNull();

  await user.click(screen.getByRole('button', { name: 'Next week' }));
  // The default view needs no parameter of its own.
  expect(state.replace).toHaveBeenLastCalledWith(
    '/work-orders?week=2026-10-05',
    { scroll: false },
  );

  await user.click(screen.getByRole('button', { name: 'List' }));
  expect(state.replace).toHaveBeenLastCalledWith('/work-orders?view=list', {
    scroll: false,
  });
});

it('shows any day of a week as that week, and employees a read-only board', async () => {
  state.canManage = false;
  state.search = 'view=week&week=2026-10-14';
  show(<WorkOrdersScreen />);
  expect(
    await screen.findByRole('heading', { name: 'Oct 12 – Oct 16, 2026' }),
  ).toBeInTheDocument();
  await screen.findByText('6 orders · 84 blinds · 6 scheduled');
  expect(screen.queryByRole('button', { name: /Add order/ })).toBeNull();
  expect(screen.queryByRole('button', { name: /Move order/ })).toBeNull();
  expect(
    within(screen.getByRole('region', { name: 'Mon, Oct 12, 2026' })).getByText(
      'No orders',
    ),
  ).toBeInTheDocument();
  await userEvent.setup().click(screen.getByRole('button', { name: 'Today' }));
  expect(state.replace).toHaveBeenLastCalledWith('/work-orders?view=week', {
    scroll: false,
  });
});

it('lays the month out Monday to Friday', async () => {
  state.search = 'view=month&month=2026-10';
  show(<WorkOrdersScreen />);
  const user = userEvent.setup();
  expect(
    await screen.findByRole('heading', { name: 'October 2026' }),
  ).toBeInTheDocument();
  // The grid runs from the Monday before the 1st to the Friday after the 31st.
  expect(orderRange).toHaveBeenLastCalledWith('2026-09-28', '2026-10-30');
  // September's order shows in its edge day but is not an October order.
  expect(
    await screen.findByText('8 orders · 112 blinds · 7 scheduled · 1 cut'),
  ).toBeInTheDocument();
  expect(
    within(
      screen.getByRole('gridcell', { name: 'Mon, Sep 28, 2026' }),
    ).getByRole('link'),
  ).toHaveTextContent('104790');
  const busy = within(
    screen.getByRole('gridcell', { name: 'Tue, Oct 13, 2026' }),
  );
  expect(busy.getByText('6 orders · 84 blinds')).toBeInTheDocument();
  expect(busy.getByRole('link', { name: '+2 more' })).toHaveAttribute(
    'href',
    '/work-orders?view=week&week=2026-10-13',
  );
  expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(
    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
  );
  expect(screen.queryByRole('button', { name: /Add order on/ })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Today' }));
  expect(state.replace).toHaveBeenLastCalledWith('/work-orders?view=month', {
    scroll: false,
  });
  await user.click(screen.getByRole('button', { name: 'Previous month' }));
  expect(state.replace).toHaveBeenLastCalledWith(
    '/work-orders?view=month&month=2026-09',
    { scroll: false },
  );
});

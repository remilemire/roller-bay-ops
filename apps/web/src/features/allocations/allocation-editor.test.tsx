import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  allocationDraftSchema,
  type AllocationOptimization,
} from '@roller-bay/shared/allocations';
import {
  allocation,
  ids,
  order,
  orderLines,
  stock,
} from '../../../tests/fixtures';
import { AllocationDetailScreen } from './allocation-detail-screen';
import { AllocationEditor } from './allocation-editor';
import { allocationKey } from './allocations.api';
import { ApiError } from '@/lib/api';

const {
  replace,
  optimize,
  createDraft,
  saveDraft,
  submit,
  saveLines,
  createOrder,
  routerReplace,
  orders,
} = vi.hoisted(() => ({
  replace: vi.fn(),
  createOrder: vi.fn(),
  routerReplace: vi.fn(),
  createDraft: vi.fn(),
  optimize: vi.fn(),
  saveDraft: vi.fn(),
  submit: vi.fn(),
  saveLines: vi.fn(),
  // Whether the order the form names already has a live allocation.
  orders: { allocated: false },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: routerReplace, push: vi.fn() }),
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
// A plain text box stands in for the searchable list: what is typed is the
// picked option's id.
vi.mock('@/components/ui/lookup', async () => {
  const { useId } = await import('react');
  return {
    Lookup: ({
      label,
      value,
      onChange,
      error,
    }: {
      label: string;
      value: string;
      onChange: (value: string) => void;
      error?: string;
    }) => {
      const id = useId();
      return (
        <label>
          {label}
          <input
            value={value}
            onChange={(event) => onChange(event.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? id : undefined}
          />
          {error && <small id={id}>{error}</small>}
        </label>
      );
    },
  };
});
vi.mock('@/features/work-orders/work-orders.api', async (original) => {
  const { queryOptions } = await import('@tanstack/react-query');
  const { order, orderLines } = await import('../../../tests/fixtures');
  return {
    ...(await original<
      typeof import('@/features/work-orders/work-orders.api')
    >()),
    // Any order id reads as the fixture order with the fixture's one blind.
    orderDetail: (id: string) =>
      queryOptions({
        queryKey: ['work-orders', id],
        queryFn: async () => ({
          ...order,
          id,
          allocatedAt: orders.allocated ? order.allocatedAt : null,
          lines: orderLines,
        }),
      }),
    saveOrderLines: saveLines,
    createOrder,
  };
});
vi.mock('./allocations.api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./allocations.api')>()),
  replaceAllocation: replace,
  optimizeAllocation: optimize,
  createAllocationDraft: createDraft,
  saveAllocationDraft: saveDraft,
  submitAllocation: submit,
}));
const draft = allocationDraftSchema.parse({
  id: allocation.id,
  state: 'draft',
  workOrderId: allocation.workOrderId,
  orderNumber: allocation.orderNumber,
  createdByUserId: allocation.createdByUserId,
  revision: 1,
  createdAt: allocation.createdAt,
  updatedAt: allocation.updatedAt,
  completedAt: null,
  cancelledAt: null,
  needsReplanning: false,
  data: {
    requirements: allocation.requirements,
    plan: allocation.plan,
  },
});
const client = () =>
  new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });

beforeEach(() => {
  orders.allocated = false;
  for (const mock of [
    replace,
    optimize,
    createDraft,
    saveDraft,
    submit,
    saveLines,
    createOrder,
    routerReplace,
  ])
    mock.mockReset();
});
/** The plan is held back until the chosen order and its blinds are read. */
const ready = async (name = 'Save draft') =>
  waitFor(() => expect(screen.getByRole('button', { name })).toBeEnabled());
const show = (ui: React.ReactNode, queries = client()) =>
  render(<QueryClientProvider client={queries}>{ui}</QueryClientProvider>);

it('keeps the active plan revision and edited values when a background refresh brings another revision', async () => {
  const user = userEvent.setup();
  orders.allocated = true;
  const queries = client();
  queries.setQueryData([...allocationKey, allocation.id], allocation);
  replace.mockRejectedValue(new ApiError(409, 'Allocation changed'));
  show(
    <AllocationDetailScreen
      id={allocation.id}
      history={null}
      cancellation={() => null}
    />,
    queries,
  );
  await user.click(screen.getByRole('button', { name: 'Edit plan' }));
  expect(
    screen.queryByLabelText(/Drop allowance|Edge trim|Minimum reusable/),
  ).not.toBeInTheDocument();
  // A replan stays with its order, whose blinds are fixed while allocated.
  expect(screen.queryByLabelText('Order number')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Width (in)')).toBeDisabled();
  await ready('Update reservations');
  // Each change re-keys the cuts, so the field is found again every time.
  const quantity = () => screen.getByLabelText('Quantity in this cut');
  await user.clear(quantity());
  await user.type(quantity(), '2');
  queries.setQueryData([...allocationKey, allocation.id], {
    ...allocation,
    revision: 2,
  });
  await user.click(screen.getByRole('button', { name: 'Update reservations' }));
  await waitFor(() =>
    expect(replace).toHaveBeenCalledWith(allocation.id, {
      expectedRevision: 1,
      plan: {
        cuts: [
          {
            stockItemId: ids.stock,
            items: [{ requirementId: ids.requirement, quantity: 2 }],
          },
        ],
      },
    }),
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Allocation changed',
  );
  expect(quantity()).toHaveValue(2);
});

it('offers generating a plan or hand-building one, and reports planning in one place', async () => {
  const user = userEvent.setup();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  let finish!: (result: AllocationOptimization) => void;
  optimize.mockReturnValue(
    new Promise<AllocationOptimization>((resolve) => (finish = resolve)),
  );
  show(<AllocationEditor workOrderId={ids.order} />);
  await ready();
  // The order's blinds arrive with it, already saved.
  expect(screen.getByLabelText('Width (in)')).toHaveValue(54);
  expect(screen.getByRole('button', { name: 'Blinds saved' })).toBeDisabled();
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
  // The API plans the order's saved blinds; the request names only the order.
  expect(optimize).toHaveBeenCalledWith(
    { workOrderId: ids.order },
    expect.anything(),
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

it('opens on the order it was reached from, with nothing to save yet', async () => {
  show(<AllocationEditor workOrderId={ids.order} />);
  expect(
    await screen.findByRole('heading', { name: 'Allocate 104801' }),
  ).toBeInTheDocument();
  await ready();
  // The order is settled; only its blinds and its plan are edited here.
  expect(screen.queryByLabelText(/Order number/)).toBeNull();
  expect(screen.getByLabelText('Width (in)')).toHaveValue(54);
  // Arriving with an order chosen is not a change to lose by leaving.
  expect(screen.getByText('Not saved yet')).toBeInTheDocument();
  expect(createDraft).not.toHaveBeenCalled();
});

it("saves the order's blinds on their own, an edited one under a new id, and holds the plan until then", async () => {
  const user = userEvent.setup();
  show(<AllocationEditor initial={draft} />);
  await ready();
  const width = screen.getByLabelText('Width (in)');
  await user.clear(width);
  // A half-entered blind is not saved; the problem shows beside its field.
  expect(screen.getByRole('status')).toHaveTextContent(
    'Save the blinds before planning fabric for them.',
  );
  for (const name of ['Save draft', 'Confirm allocation', 'Add cut'])
    expect(screen.getByRole('button', { name })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Save blinds' }));
  await waitFor(() => expect(width).toBeInvalid());
  expect(saveLines).not.toHaveBeenCalled();

  await user.type(width, '60');
  expect(width).not.toBeInvalid();
  saveLines.mockImplementation(
    async (id: string, body: { lines: typeof orderLines }) => ({
      ...order,
      id,
      allocatedAt: null,
      revision: order.revision + 1,
      lines: body.lines,
    }),
  );
  await user.click(screen.getByRole('button', { name: 'Save blinds' }));
  await waitFor(() => expect(saveLines).toHaveBeenCalledTimes(1));
  const [orderId, sent] = saveLines.mock.calls[0]!;
  expect(orderId).toBe(ids.order);
  expect(sent.expectedRevision).toBe(order.revision);
  // A saved blind never changes, so the edited one goes under a new id.
  expect(sent.lines).toEqual([
    { ...orderLines[0], id: expect.any(String), widthMm: 1524 },
  ]);
  expect(sent.lines[0].id).not.toBe(ids.requirement);
  // Nothing of the allocation was sent; its plan follows the blind to its new
  // id, which is a change to the draft that is still to be saved.
  expect(saveDraft).not.toHaveBeenCalled();
  await ready();
  expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  saveDraft.mockResolvedValue({ ...draft, revision: 2 });
  await user.click(screen.getByRole('button', { name: 'Save draft' }));
  await waitFor(() =>
    expect(saveDraft).toHaveBeenCalledWith(draft.id, 1, {
      workOrderId: ids.order,
      plan: {
        cuts: [
          {
            stockItemId: ids.stock,
            items: [{ requirementId: sent.lines[0].id, quantity: 1 }],
          },
        ],
      },
    }),
  );
});

it('saves unsaved edits to the draft before confirming it', async () => {
  const user = userEvent.setup();
  saveDraft.mockResolvedValue({ ...draft, revision: 2 });
  submit.mockResolvedValue({ ...allocation, revision: 3 });
  show(<AllocationEditor initial={draft} />);
  await ready();
  // Each change re-keys the cuts, so the field is found again every time.
  await user.clear(screen.getByLabelText('Quantity in this cut'));
  await user.type(screen.getByLabelText('Quantity in this cut'), '2');
  await user.click(screen.getByRole('button', { name: 'Confirm allocation' }));
  expect(
    screen.getByText(/Your changes are saved to the draft first\./),
  ).toBeInTheDocument();
  const dialog = screen.getByRole('dialog');
  await user.click(
    within(dialog).getByRole('button', { name: 'Confirm allocation' }),
  );
  await waitFor(() => expect(submit).toHaveBeenCalledWith(draft.id, 2));
  expect(saveDraft).toHaveBeenCalledWith(
    draft.id,
    1,
    expect.objectContaining({ workOrderId: ids.order }),
  );
});

it('leaves the confirmed allocation, not the draft saved on the way, for the page it opens', async () => {
  const user = userEvent.setup();
  createDraft.mockResolvedValue(draft);
  submit.mockResolvedValue({ ...allocation, revision: 2 });
  optimize.mockResolvedValue({
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
  const queries = client();
  show(<AllocationEditor workOrderId={ids.order} />, queries);
  await ready();
  await user.click(screen.getByRole('button', { name: 'Generate plan' }));
  await screen.findByText('Valid cutting plan');
  // Confirming a plan that was never saved saves it as a draft first.
  await user.click(screen.getByRole('button', { name: 'Confirm allocation' }));
  await user.click(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: 'Confirm allocation',
    }),
  );
  await waitFor(() => expect(submit).toHaveBeenCalledWith(draft.id, 1));
  // That page keeps an open draft against refetches, so it must not be
  // handed the draft this cached a moment ago.
  await waitFor(() =>
    expect(queries.getQueryData([...allocationKey, draft.id])).toMatchObject({
      state: 'active',
      revision: 2,
    }),
  );
});

it('offers to reload a stale draft, but not for an order that is already allocated', async () => {
  const user = userEvent.setup();
  submit.mockRejectedValueOnce(
    new ApiError(409, 'Allocation changed; refresh before submitting.'),
  );
  submit.mockRejectedValueOnce(
    new ApiError(409, 'This order already has an allocation.', undefined, [
      {
        code: 'order_already_allocated',
        path: ['workOrderId'],
        message: 'Already allocated.',
      },
    ]),
  );
  show(<AllocationEditor initial={draft} />);
  await ready('Confirm allocation');
  await user.click(screen.getByRole('button', { name: 'Confirm allocation' }));
  const confirm = within(screen.getByRole('dialog')).getByRole('button', {
    name: 'Confirm allocation',
  });
  // The open dialog hides the page behind it from the accessibility tree.
  const reload = () =>
    screen.queryByRole('button', { name: 'Reload saved draft', hidden: true });
  await user.click(confirm);
  await waitFor(() => expect(reload()).toBeInTheDocument());

  // Reloading the draft would not fix the order it names.
  await user.click(confirm);
  await waitFor(() =>
    expect(
      screen.getByText('Order 104801: Already allocated.'),
    ).toBeInTheDocument(),
  );
  expect(reload()).toBeNull();
});

it('leaves a pending new-allocation request alone while editing an active plan', async () => {
  const user = userEvent.setup();
  orders.allocated = true;
  const pending = JSON.stringify({
    key: crypto.randomUUID(),
    payload: JSON.stringify({ workOrderId: crypto.randomUUID() }),
  });
  sessionStorage.setItem('roller-bay:pending:allocation:user-1:new', pending);
  replace.mockRejectedValue(new ApiError(400, 'Validation failed'));
  show(<AllocationEditor active={allocation} />);
  expect(
    screen.getByRole('heading', { name: 'Replan 104801' }),
  ).toBeInTheDocument();
  await ready('Update reservations');
  await user.click(screen.getByRole('button', { name: 'Update reservations' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Validation failed',
  );
  expect(
    screen.queryByRole('button', { name: 'Restore earlier request' }),
  ).not.toBeInTheDocument();
  expect(
    sessionStorage.getItem('roller-bay:pending:allocation:user-1:new'),
  ).toBe(pending);
  sessionStorage.clear();
});

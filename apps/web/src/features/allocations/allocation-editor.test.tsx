import { expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  allocationDraftSchema,
  type AllocationOptimization,
} from '@roller-bay/shared/allocations';
import { allocation, stock, ids } from '../../../tests/fixtures';
import { AllocationDetailScreen } from './allocation-detail-screen';
import { AllocationEditor } from './allocation-editor';
import { allocationKey } from './allocations.api';
import { ApiError } from '@/lib/api';

const { replace, optimize, saveDraft, submit } = vi.hoisted(() => ({
  replace: vi.fn(),
  optimize: vi.fn(),
  saveDraft: vi.fn(),
  submit: vi.fn(),
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
// A plain text box stands in for the searchable list: what is typed is the
// picked option's id. The order number is one of these pickers.
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
vi.mock('./allocations.api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./allocations.api')>()),
  replaceAllocation: replace,
  optimizeAllocation: optimize,
  saveAllocationDraft: saveDraft,
  submitAllocation: submit,
}));
const draft = allocationDraftSchema.parse({
  id: allocation.id,
  state: 'draft',
  orderNumber: allocation.orderNumber,
  createdByUserId: allocation.createdByUserId,
  revision: 1,
  createdAt: allocation.createdAt,
  updatedAt: allocation.updatedAt,
  completedAt: null,
  cancelledAt: null,
  needsReplanning: false,
  data: {
    orderNumber: allocation.orderNumber,
    requirements: allocation.requirements,
    plan: allocation.plan,
  },
});
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
  await user.type(screen.getByLabelText('Order number'), '104802');
  queries.setQueryData([...allocationKey, allocation.id], {
    ...allocation,
    orderNumber: '104803',
    revision: 2,
  });
  await user.click(screen.getByRole('button', { name: 'Update reservations' }));
  await waitFor(() =>
    expect(replace).toHaveBeenCalledWith(
      allocation.id,
      expect.objectContaining({
        expectedRevision: 1,
        orderNumber: '104802',
      }),
    ),
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Allocation changed',
  );
  expect(screen.getByLabelText('Order number')).toHaveValue('104802');
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

it('picks the order number from the schedule and marks the form dirty', async () => {
  const user = userEvent.setup();
  saveDraft.mockResolvedValue({ ...draft, revision: 2 });
  render(
    <QueryClientProvider client={client()}>
      <AllocationEditor initial={draft} />
    </QueryClientProvider>,
  );
  const order = screen.getByLabelText('Order number');
  expect(order).toHaveValue('104801');
  await user.clear(order);
  await user.type(order, '104802');
  await user.click(screen.getByRole('button', { name: 'Save draft' }));
  await waitFor(() =>
    expect(saveDraft).toHaveBeenCalledWith(
      draft.id,
      1,
      expect.objectContaining({ orderNumber: '104802' }),
    ),
  );
});

it('shows submission problems beside their fields instead of listing them', async () => {
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={client()}>
      <AllocationEditor
        initial={{
          ...draft,
          data: {
            ...draft.data,
            requirements: [{ ...draft.data.requirements[0]!, widthMm: null }],
          },
        }}
      />
    </QueryClientProvider>,
  );
  await user.click(screen.getByRole('button', { name: 'Confirm allocation' }));
  const width = screen.getByLabelText('Width (in)');
  expect(width).toBeInvalid();
  expect(width).toHaveAccessibleDescription('Required.');
  const notice = screen.getByRole('alert');
  expect(notice).toHaveTextContent('Some fields are missing or invalid.');
  expect(notice).not.toHaveTextContent('width');
  await user.type(width, '54');
  expect(width).not.toBeInvalid();
});

it('saves unsaved edits to the draft before confirming it', async () => {
  const user = userEvent.setup();
  saveDraft.mockResolvedValue({ ...draft, revision: 2 });
  submit.mockResolvedValue({ ...allocation, revision: 3 });
  render(
    <QueryClientProvider client={client()}>
      <AllocationEditor initial={draft} />
    </QueryClientProvider>,
  );
  await user.clear(screen.getByLabelText('Order number'));
  await user.type(screen.getByLabelText('Order number'), '104802');
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
    expect.objectContaining({ orderNumber: '104802' }),
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
        path: ['orderNumber'],
        message: 'Already allocated.',
      },
    ]),
  );
  render(
    <QueryClientProvider client={client()}>
      <AllocationEditor initial={draft} />
    </QueryClientProvider>,
  );
  await user.click(screen.getByRole('button', { name: 'Confirm allocation' }));
  const confirm = within(screen.getByRole('dialog')).getByRole('button', {
    name: 'Confirm allocation',
  });
  // The open dialog hides the page behind it from the accessibility tree.
  const reload = () =>
    screen.queryByRole('button', { name: 'Reload saved draft', hidden: true });
  await user.click(confirm);
  await waitFor(() => expect(reload()).toBeInTheDocument());

  // Reloading the draft would not fix the order number.
  await user.click(confirm);
  await waitFor(() =>
    expect(
      screen.getByRole('textbox', { name: /Order number/, hidden: true }),
    ).toHaveAccessibleDescription('Already allocated.'),
  );
  expect(reload()).toBeNull();
});

it('leaves a pending new-allocation request alone while editing an active plan', async () => {
  const user = userEvent.setup();
  const pending = JSON.stringify({
    key: crypto.randomUUID(),
    payload: JSON.stringify({ orderNumber: '209999' }),
  });
  sessionStorage.setItem('roller-bay:pending:allocation:user-1:new', pending);
  replace.mockRejectedValue(new ApiError(400, 'Validation failed'));
  render(
    <QueryClientProvider client={client()}>
      <AllocationEditor active={allocation} />
    </QueryClientProvider>,
  );
  expect(screen.getByLabelText('Order number')).toHaveValue('104801');
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

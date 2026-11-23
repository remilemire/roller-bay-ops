import { expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { defaultMeasurementUnits } from '@roller-bay/shared/users';
import { api } from '@/lib/api';
import { ManualCutEditor } from '@/features/allocations';
import { ManualCutEditorContext, RecutActions } from './recut-actions';
import { OrderProduction } from './order-production';
import { workOrderSchema } from '@roller-bay/shared/work-orders';
vi.mock('@/features/auth', () => ({
  useCurrentUser: () => ({ id: 'staff', role: 'staff' }),
  useCanManage: () => false,
}));
vi.mock('@/features/users', () => ({
  useMeasurementUnits: () => defaultMeasurementUnits,
}));
vi.mock('@/lib/api', async (original) => ({
  ...(await original<typeof import('@/lib/api')>()),
  api: vi.fn(),
}));
it('staff can request a replacement from a shipped order with only the blind, quantity and reason', async () => {
  const line = '11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const order = '22222222-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  vi.mocked(api).mockImplementation(async (path, _schema, options) => {
    if (path.endsWith('/recut-blinds'))
      return [
        {
          id: line,
          position: 2,
          fabricColorCode: 'LINEN',
          widthMm: 508,
          lengthMm: 1016,
          quantity: 4,
        },
      ];
    if (options?.method === 'POST') return { recordId: line, revision: 1 };
    return [];
  });
  const at = '2026-11-20T12:00:00.000Z';
  const shipped = workOrderSchema.parse({
    id: order,
    orderNumber: '123456',
    status: 'shipped',
    shipDate: null,
    quantity: 4,
    note: null,
    createdAt: at,
    updatedAt: at,
    allocatedAt: at,
    cutAt: null,
    scheduledAt: null,
    shippedAt: at,
    revision: 1,
  });
  const user = userEvent.setup();
  const client = new QueryClient();
  const view = (allocatedAt: string | null) => (
    <QueryClientProvider client={client}>
      <OrderProduction order={{ ...shipped, allocatedAt }} />
    </QueryClientProvider>
  );
  const { rerender } = render(view(null));
  expect(
    screen.queryByRole('button', { name: 'Request recut' }),
  ).not.toBeInTheDocument();
  rerender(view(at));
  await user.click(screen.getByRole('button', { name: 'Request recut' }));
  await user.selectOptions(
    await screen.findByLabelText('Blind to replace'),
    line,
  );
  await user.type(
    screen.getByLabelText('Reason for recut'),
    'Flaw across face',
  );
  expect(
    screen.queryByLabelText(/assembly|after cutting/i),
  ).not.toBeInTheDocument();
  const quantity = screen.getByLabelText('Replacement quantity');
  const submit = screen.getByRole('button', { name: 'Send recut request' });
  await user.clear(quantity);
  await user.type(quantity, '5');
  expect(submit).toBeDisabled();
  await user.clear(quantity);
  await user.type(quantity, '2');
  await user.click(submit);
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  );
  expect(api).toHaveBeenCalledWith(
    `/production/orders/${order}/recuts`,
    expect.anything(),
    {
      method: 'POST',
      key: expect.any(String),
      body: {
        requirementId: line,
        quantity: 2,
        reason: 'Flaw across face',
      },
    },
  );
});

it('lets staff group pending requests for the same fabric and reselect stock that fits them together', async () => {
  const task = {
    id: crypto.randomUUID(),
    requirementId: crypto.randomUUID(),
    workOrderId: crypto.randomUUID(),
    widthMm: 250,
    lengthMm: 700,
    quantity: 1,
    fabricColorCode: 'LINEN',
    reason: 'Face flaw',
    stage: 'requested' as const,
    revision: 1,
    allocationId: null,
    worksheetId: null,
    needsCorrection: false,
    needsAssembly: true,
  };
  const peer = {
    ...task,
    id: crypto.randomUUID(),
    reason: 'Edge snag',
    widthMm: 325,
    revision: 3,
  };
  const third = {
    ...task,
    id: crypto.randomUUID(),
    reason: 'Roll short',
    widthMm: 275,
  };
  const otherFabric = {
    ...task,
    id: crypto.randomUUID(),
    reason: 'Wrong fabric',
    fabricColorCode: 'BLUE',
  };
  const small = {
    id: crypto.randomUUID(),
    isRemnant: true,
    locationLabel: 'A1',
    widthMm: 500,
    availableLengthMm: 800,
  };
  const large = { ...small, id: crypto.randomUUID(), widthMm: 1200 };
  vi.mocked(api).mockImplementation(async (path) => {
    if (path.endsWith('/stock-options')) return [large];
    if (path.endsWith('/stock')) return [small, large];
    return { recordId: task.id, revision: 2 };
  });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RecutActions
        recut={task}
        station="cutting"
        orderRecuts={[task, peer, third, otherFabric]}
      />
    </QueryClientProvider>,
  );
  await user.click(screen.getByRole('button', { name: 'Assign fabric' }));
  expect(screen.queryByRole('checkbox', { name: /Wrong fabric/ })).toBeNull();
  await user.selectOptions(await screen.findByLabelText(/Stock ·/), small.id);
  await user.click(screen.getByRole('checkbox', { name: /Edge snag/ }));
  await user.click(screen.getByRole('checkbox', { name: /Roll short/ }));
  const reserve = screen.getByRole('button', { name: 'Reserve fabric' });
  expect(reserve).toBeDisabled();
  const picker = await screen.findByLabelText(/Stock ·/);
  expect(picker.querySelector(`option[value="${small.id}"]`)).toBeNull();
  await user.selectOptions(picker, large.id);
  await user.click(reserve);
  const additionalRecuts = [peer, third].map((r) => ({
    id: r.id,
    expectedRevision: r.revision,
  }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      `/production/recuts/${task.id}/assign`,
      expect.anything(),
      {
        method: 'POST',
        key: expect.any(String),
        body: { expectedRevision: 1, stockItemId: large.id, additionalRecuts },
      },
    ),
  );
});

it('withdraws a started recut only after staff confirm the displayed worksheet is unused', async () => {
  const task = {
    id: crypto.randomUUID(),
    requirementId: crypto.randomUUID(),
    workOrderId: crypto.randomUUID(),
    quantity: 2,
    widthMm: 660,
    lengthMm: 1397,
    fabricColorCode: 'HB410-CH',
    reason: 'Fabric flaw',
    stage: 'cutting' as const,
    revision: 2,
    allocationId: crypto.randomUUID(),
    worksheetId: crypto.randomUUID(),
    worksheetRevision: 4,
    needsAssembly: true,
    needsCorrection: false,
  };
  const peer = { ...task, id: crypto.randomUUID() };
  vi.mocked(api).mockResolvedValue({ recordId: task.id, revision: 3 });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RecutActions recut={task} orderRecuts={[task, peer]} station="cutting" />
    </QueryClientProvider>,
  );
  expect(
    screen.getByRole('link', { name: /shared worksheet · 2 recuts/i }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Withdraw recut' }));
  const dialog = within(screen.getByRole('dialog'));
  await user.type(
    dialog.getByLabelText('Reason for withdrawal'),
    'Original blind passed checking',
  );
  const submit = dialog.getByRole('button', { name: 'Withdraw recut' });
  expect(submit).toBeDisabled();
  await user.click(
    dialog.getByRole('checkbox', { name: /No fabric has been cut/ }),
  );
  await user.click(submit);
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      `/production/recuts/${task.id}/withdraw`,
      expect.anything(),
      {
        method: 'POST',
        key: expect.any(String),
        body: {
          expectedRevision: 2,
          reason: 'Original blind passed checking',
          unusedWorksheet: { id: task.worksheetId, expectedRevision: 4 },
        },
      },
    ),
  );
});

it('builds a manual worksheet across two rolls even when neither fits the whole request', async () => {
  const task = {
    id: crypto.randomUUID(),
    requirementId: crypto.randomUUID(),
    workOrderId: crypto.randomUUID(),
    quantity: 2,
    widthMm: 500,
    lengthMm: 1000,
    fabricColorCode: 'LINEN',
    reason: 'Flaw',
    stage: 'requested' as const,
    revision: 1,
    allocationId: null,
    worksheetId: null,
    needsAssembly: true,
    needsCorrection: false,
  };
  const rolls = ['A', 'B'].map((locationLabel) => ({
    locationLabel,
    id: crypto.randomUUID(),
    widthMm: 600,
    availableLengthMm: 1000,
    isRemnant: true,
  }));
  vi.mocked(api).mockImplementation(async (path) => {
    if (path.endsWith('/manual-stock')) return rolls;
    if (path.endsWith('/stock')) return [];
    if (path.endsWith('/validate-plan'))
      return {
        reservations: rolls.map((r) => ({
          stockItemId: r.id,
          reservedLengthMm: 1000,
        })),
      };
    return { recordId: task.id, revision: 2 };
  });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ManualCutEditorContext.Provider
        value={(props) => <ManualCutEditor {...props} />}
      >
        <RecutActions recut={task} orderRecuts={[task]} station="cutting" />
      </ManualCutEditorContext.Provider>
    </QueryClientProvider>,
  );
  await user.click(screen.getByRole('button', { name: 'Assign fabric' }));
  await user.click(screen.getByRole('button', { name: 'Build a manual plan' }));
  for (const [i, roll] of rolls.entries()) {
    await user.click(await screen.findByRole('button', { name: 'Add cut' }));
    await user.selectOptions(
      screen.getByLabelText(`Stock item · cut ${i + 1}`),
      roll.id,
    );
    await user.click(
      screen.getAllByRole('button', { name: 'Assign a blind' })[i]!,
    );
    await user.type(screen.getAllByLabelText('Quantity in this cut')[i]!, '1');
  }
  await user.click(screen.getByRole('button', { name: 'Validate plan' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Plan fits');
  await user.click(screen.getByRole('button', { name: 'Reserve manual plan' }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      `/production/recuts/${task.id}/assign`,
      expect.anything(),
      {
        method: 'POST',
        key: expect.any(String),
        body: {
          expectedRevision: 1,
          plan: {
            cuts: rolls.map((r) => ({
              stockItemId: r.id,
              items: [{ requirementId: task.id, quantity: 1 }],
            })),
          },
        },
      },
    ),
  );
});

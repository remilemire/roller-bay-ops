import { expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { defaultMeasurementUnits } from '@roller-bay/shared/users';
import { api } from '@/lib/api';
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
  const view = (cutAt: string | null) => (
    <QueryClientProvider client={client}>
      <OrderProduction order={{ ...shipped, cutAt }} />
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

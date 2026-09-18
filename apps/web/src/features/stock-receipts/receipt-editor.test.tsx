import { it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { receiptDraft } from '../../../tests/fixtures';
import { ReceiptEditor } from './receipt-editor';
import { ReceiptDetailScreen } from './receipt-detail-screen';
import { receiptKey } from './stock-receipts.api';
import { ApiError } from '@/lib/api';
import { receipt } from '../../../tests/fixtures';
const { save, replace } = vi.hoisted(() => ({
  save: vi.fn(),
  replace: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
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
vi.mock('./stock-receipts.api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./stock-receipts.api')>()),
  saveReceiptDraft: save,
}));
it('keeps dirty values and the original expected revision after a shared draft changes', async () => {
  const user = userEvent.setup();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  save.mockRejectedValue(new ApiError(409, 'Receipt changed'));
  const view = render(
    <QueryClientProvider client={client}>
      <ReceiptEditor initial={receiptDraft} />
    </QueryClientProvider>,
  );
  await user.clear(screen.getByLabelText('Purchase-order number'));
  await user.type(screen.getByLabelText('Purchase-order number'), '11111');
  view.rerender(
    <QueryClientProvider client={client}>
      <ReceiptEditor
        initial={{
          ...receiptDraft,
          revision: 2,
          data: { ...receiptDraft.data, purchaseOrderNumber: '22222' },
        }}
      />
    </QueryClientProvider>,
  );
  expect(screen.getByLabelText('Purchase-order number')).toHaveValue('11111');
  await user.click(screen.getByRole('button', { name: 'Save draft' }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(
      receiptDraft.id,
      1,
      expect.objectContaining({ purchaseOrderNumber: '11111' }),
    ),
  );
  expect(await screen.findByRole('alert')).toHaveTextContent('Receipt changed');
  expect(screen.getByLabelText('Purchase-order number')).toHaveValue('11111');
});
it('does not unmount a dirty draft if another employee submits it during a background refresh', async () => {
  const user = userEvent.setup();
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  client.setQueryData(['history', 'stock-receipts', receiptDraft.id, 1], {
    items: [],
    total: 0,
    page: 1,
    pageSize: 25,
  });
  client.setQueryData([...receiptKey, receiptDraft.id], receiptDraft);
  render(
    <QueryClientProvider client={client}>
      <ReceiptDetailScreen id={receiptDraft.id} />
    </QueryClientProvider>,
  );
  await user.clear(screen.getByLabelText('Purchase-order number'));
  await user.type(screen.getByLabelText('Purchase-order number'), '33333');
  client.setQueryData([...receiptKey, receiptDraft.id], receipt);
  await waitFor(() =>
    expect(screen.getByLabelText('Purchase-order number')).toHaveValue('33333'),
  );
});

it('preserves a dirty draft when a background request fails', async () => {
  const user = userEvent.setup();
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  client.setQueryData(['history', 'stock-receipts', receiptDraft.id, 1], {
    items: [],
    total: 0,
    page: 1,
    pageSize: 25,
  });
  client.setQueryData([...receiptKey, receiptDraft.id], receiptDraft);
  render(
    <QueryClientProvider client={client}>
      <ReceiptDetailScreen id={receiptDraft.id} />
    </QueryClientProvider>,
  );
  await user.clear(screen.getByLabelText('Purchase-order number'));
  await user.type(screen.getByLabelText('Purchase-order number'), '44444');
  await expect(
    client.fetchQuery({
      queryKey: [...receiptKey, receiptDraft.id],
      staleTime: 0,
      queryFn: async () => {
        throw new ApiError(503, 'Connection interrupted');
      },
    }),
  ).rejects.toThrow('Connection interrupted');
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Connection interrupted',
  );
  expect(screen.getByLabelText('Purchase-order number')).toHaveValue('44444');
});

it('limits the purchase-order number to five characters and requires digits before submitting', async () => {
  const user = userEvent.setup();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  // A saved draft may hold partial or older input.
  const partial = {
    ...receiptDraft,
    data: { ...receiptDraft.data, purchaseOrderNumber: 'PO-1' },
  };
  const view = render(
    <QueryClientProvider client={client}>
      <ReceiptEditor initial={partial} />
    </QueryClientProvider>,
  );
  await user.click(screen.getByRole('button', { name: 'Submit receipt' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Purchase order number: Must be 5 digits.',
  );
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  view.unmount();
  render(
    <QueryClientProvider client={client}>
      <ReceiptEditor initial={receiptDraft} />
    </QueryClientProvider>,
  );
  const field = screen.getByLabelText('Purchase-order number');
  await user.clear(field);
  await user.type(field, '1234567');
  expect(field).toHaveValue('12345');
});

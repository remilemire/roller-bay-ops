import { it, expect, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { receiptDraft } from '../../../tests/fixtures';
import { ReceiptEditor } from './receipt-editor';
import { ReceiptDetailScreen } from './receipt-detail-screen';
import { receiptKey } from './stock-receipts.api';
import { ApiError } from '@/lib/api';
import { receipt } from '../../../tests/fixtures';
const { save, submit, replace } = vi.hoisted(() => ({
  save: vi.fn(),
  submit: vi.fn(),
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
  submitReceipt: submit,
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

it('keeps the purchase-order number to five digits and requires them before submitting', async () => {
  const user = userEvent.setup();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  // A saved draft may hold partial or older input.
  const partial = {
    ...receiptDraft,
    data: {
      purchaseOrderNumber: 'PO-1',
      items: [{ ...receiptDraft.data.items[0]!, widthMm: null }],
    },
  };
  const view = render(
    <QueryClientProvider client={client}>
      <ReceiptEditor initial={partial} />
    </QueryClientProvider>,
  );
  await user.click(screen.getByRole('button', { name: 'Submit receipt' }));
  // Problems show beside their fields rather than in the notice's list.
  expect(
    screen.getByLabelText('Purchase-order number'),
  ).toHaveAccessibleDescription('Must be 5 digits.');
  const width = screen.getByLabelText('Width (in)');
  expect(width).toBeInvalid();
  expect(width).toHaveAccessibleDescription('Required.');
  const notice = await screen.findByRole('alert');
  expect(notice).toHaveTextContent('Some fields are missing or invalid.');
  expect(notice).not.toHaveTextContent(/digits|width/i);
  await user.type(width, '54');
  expect(width).not.toBeInvalid();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  view.unmount();
  render(
    <QueryClientProvider client={client}>
      <ReceiptEditor initial={receiptDraft} />
    </QueryClientProvider>,
  );
  const field = screen.getByLabelText('Purchase-order number');
  await user.clear(field);
  await user.type(field, '12a3');
  expect(field).toHaveValue('123');
  await user.tab();
  expect(field).toBeInvalid();
  expect(field).toHaveAccessibleDescription('Must be 5 digits.');
  await user.type(field, '4567');
  expect(field).toHaveValue('12345');
  expect(field).not.toBeInvalid();
});

it('saves unsaved edits to the draft before submitting it', async () => {
  const user = userEvent.setup();
  save.mockResolvedValue({ ...receiptDraft, revision: 2 });
  submit.mockResolvedValue(receipt);
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ReceiptEditor initial={receiptDraft} />
    </QueryClientProvider>,
  );
  await user.clear(screen.getByLabelText('Purchase-order number'));
  await user.type(screen.getByLabelText('Purchase-order number'), '55555');
  await user.click(screen.getByRole('button', { name: 'Submit receipt' }));
  const dialog = screen.getByRole('dialog');
  expect(dialog).toHaveTextContent(
    'Your changes are saved to the draft first.',
  );
  await user.click(
    within(dialog).getByRole('button', { name: 'Submit receipt' }),
  );
  await waitFor(() => expect(submit).toHaveBeenCalledWith(receiptDraft.id, 2));
  expect(save).toHaveBeenCalledWith(
    receiptDraft.id,
    1,
    expect.objectContaining({ purchaseOrderNumber: '55555' }),
  );
});

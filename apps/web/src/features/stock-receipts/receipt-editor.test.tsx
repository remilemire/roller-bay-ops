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
vi.mock('@/features/auth/auth-boundary', () => ({
  useCurrentUser: () => ({ id: 'user-1' }),
}));
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
  await user.type(screen.getByLabelText('Purchase-order number'), 'LOCAL');
  view.rerender(
    <QueryClientProvider client={client}>
      <ReceiptEditor
        initial={{
          ...receiptDraft,
          revision: 2,
          data: { ...receiptDraft.data, purchaseOrderNumber: 'REMOTE' },
        }}
      />
    </QueryClientProvider>,
  );
  expect(screen.getByLabelText('Purchase-order number')).toHaveValue('LOCAL');
  await user.click(screen.getByRole('button', { name: 'Save draft' }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(
      receiptDraft.id,
      1,
      expect.objectContaining({ purchaseOrderNumber: 'LOCAL' }),
    ),
  );
  expect(await screen.findByRole('alert')).toHaveTextContent('Receipt changed');
  expect(screen.getByLabelText('Purchase-order number')).toHaveValue('LOCAL');
});
it('does not unmount a dirty draft if another employee submits it during a background refresh', async () => {
  const user = userEvent.setup();
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  client.setQueryData([...receiptKey, receiptDraft.id], receiptDraft);
  render(
    <QueryClientProvider client={client}>
      <ReceiptDetailScreen id={receiptDraft.id} />
    </QueryClientProvider>,
  );
  await user.clear(screen.getByLabelText('Purchase-order number'));
  await user.type(screen.getByLabelText('Purchase-order number'), 'KEEP THIS');
  client.setQueryData([...receiptKey, receiptDraft.id], receipt);
  await waitFor(() =>
    expect(screen.getByLabelText('Purchase-order number')).toHaveValue(
      'KEEP THIS',
    ),
  );
});

it('preserves a dirty draft when a background request fails', async () => {
  const user = userEvent.setup();
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  client.setQueryData([...receiptKey, receiptDraft.id], receiptDraft);
  render(
    <QueryClientProvider client={client}>
      <ReceiptDetailScreen id={receiptDraft.id} />
    </QueryClientProvider>,
  );
  await user.clear(screen.getByLabelText('Purchase-order number'));
  await user.type(screen.getByLabelText('Purchase-order number'), 'UNSAVED');
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
  expect(screen.getByLabelText('Purchase-order number')).toHaveValue('UNSAVED');
});

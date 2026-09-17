import { afterEach, it, expect, vi } from 'vitest';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { receiptDraft } from '../../../tests/fixtures';
import { ReceiptEditor } from './receipt-editor';
import { ReceiptDetailScreen } from './receipt-detail-screen';
import { receiptKey } from './stock-receipts.api';
import { ApiError } from '@/lib/api';
import { receipt } from '../../../tests/fixtures';
const { save, create, replace } = vi.hoisted(() => ({
  save: vi.fn(),
  create: vi.fn(),
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
  createReceiptDraft: create,
}));
afterEach(() => {
  vi.useRealTimers();
});
const idle = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
    // Mutation state arrives over several zero-delay timers, which fake
    // timers push 1 ms out when they are created during a tick.
    for (let hop = 0; hop < 5; hop++) await vi.advanceTimersByTimeAsync(1);
  });
const editor = (initial?: typeof receiptDraft) => (
  <QueryClientProvider client={new QueryClient()}>
    <ReceiptEditor initial={initial} />
  </QueryClientProvider>
);
const revised = (revision: number, purchaseOrderNumber: string) => ({
  ...receiptDraft,
  revision,
  data: { ...receiptDraft.data, purchaseOrderNumber },
});
it('autosaves an idle draft without replacing input typed during the request', async () => {
  vi.useFakeTimers();
  let finish!: (draft: typeof receiptDraft) => void;
  save.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
  render(editor(receiptDraft));
  const input = screen.getByLabelText('Purchase-order number');
  fireEvent.change(input, { target: { value: 'PO-1' } });
  await idle(1500);
  expect(save).not.toHaveBeenCalled();
  await idle(500);
  expect(save).toHaveBeenCalledExactlyOnceWith(
    receiptDraft.id,
    1,
    expect.objectContaining({ purchaseOrderNumber: 'PO-1' }),
  );
  expect(input).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
  fireEvent.change(input, { target: { value: 'PO-12' } });
  finish(revised(2, 'PO-1'));
  await idle(0);
  expect(input).toHaveValue('PO-12');
  expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  save.mockResolvedValueOnce(revised(3, 'PO-12'));
  await idle(2000);
  expect(save).toHaveBeenLastCalledWith(
    receiptDraft.id,
    2,
    expect.objectContaining({ purchaseOrderNumber: 'PO-12' }),
  );
  expect(screen.getByText('All changes saved')).toBeInTheDocument();
  await idle(10_000);
  expect(save).toHaveBeenCalledTimes(2);
});
it('stops autosaving after a conflict and keeps the input', async () => {
  vi.useFakeTimers();
  save.mockRejectedValue(new ApiError(409, 'Receipt changed'));
  render(editor(receiptDraft));
  const input = screen.getByLabelText('Purchase-order number');
  fireEvent.change(input, { target: { value: 'LOCAL' } });
  await idle(2000);
  expect(screen.getByRole('alert')).toHaveTextContent('Receipt changed');
  fireEvent.change(input, { target: { value: 'LOCAL-2' } });
  await idle(10_000);
  expect(save).toHaveBeenCalledTimes(1);
  expect(input).toHaveValue('LOCAL-2');
});
it('does not create a draft automatically', async () => {
  vi.useFakeTimers();
  render(editor());
  fireEvent.change(screen.getByLabelText('Purchase-order number'), {
    target: { value: 'PO-NEW' },
  });
  await idle(10_000);
  expect(create).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
});
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

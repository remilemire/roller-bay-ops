import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { stock, ids, user } from '../../../tests/fixtures';
import { StockCorrectionEditor } from './stock-correction-editor';
import { defaultMeasurementUnits } from '@roller-bay/shared/users';
vi.mock('@/features/auth/auth-boundary', () => ({
  useCurrentUser: () => ({
    ...user,
    measurementUnits: defaultMeasurementUnits,
  }),
  useCanManage: () => true,
}));
vi.mock('@/components/ui/lookup', () => ({
  Lookup: ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: string;
    onChange: (value: string) => void;
  }) => (
    <label>
      {label}
      <input value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  ),
}));
const result = {
  eventId: ids.receipt,
  recordId: ids.stock,
  revision: 2,
  affectedAllocationIds: [],
  createdStockItemIds: [],
};
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function TestProvider({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}
beforeEach(() => sessionStorage.clear());
afterEach(() => vi.unstubAllGlobals());
it('pins stock and units during refetch, reviews changes and retries the exact uncertain submission', async () => {
  const requests: { body: unknown; key: string | null }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      requests.push({
        body: JSON.parse(String(init.body)),
        key: new Headers(init.headers).get('Idempotency-Key'),
      });
      if (requests.length === 1) throw new TypeError('Connection lost');
      return response(result);
    }),
  );
  const close = vi.fn();
  const Wrapper = wrapper();
  const rendered = render(
    <StockCorrectionEditor item={stock} close={close} />,
    { wrapper: Wrapper },
  );
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  const actor = userEvent.setup();
  const width = screen.getByLabelText('Width (in)');
  await actor.clear(width);
  await actor.type(width, '80');
  rendered.rerender(
    <StockCorrectionEditor
      item={{ ...stock, revision: 99, widthMm: 100 }}
      close={close}
    />,
  );
  expect(width).toHaveValue('80');
  await actor.type(
    screen.getByLabelText('Reason for correction'),
    'Measured width again',
  );
  await actor.click(screen.getByRole('button', { name: 'Review changes' }));
  expect(requests).toHaveLength(0);
  await actor.click(screen.getByRole('button', { name: 'Save correction' }));
  await screen.findByRole('alert');
  await actor.click(screen.getByRole('button', { name: 'Save correction' }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
  expect(requests[0]!.body).toMatchObject({
    expectedRevision: stock.revision,
    reason: 'Measured width again',
    changes: { widthMm: 2032 },
  });
  expect((requests[0]!.body as { changes: object }).changes).not.toHaveProperty(
    'radialDepthMm',
  );
});

it('keeps user input on a definite revision conflict and requires an explicit fresh attempt', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      response({ message: 'Stock changed; refresh before correcting.' }, 409),
    ),
  );
  const actor = userEvent.setup();
  render(<StockCorrectionEditor item={stock} close={vi.fn()} />, {
    wrapper: wrapper(),
  });
  await actor.type(
    screen.getByLabelText('Reason for correction'),
    'Count discrepancy',
  );
  await actor.click(screen.getByRole('button', { name: 'Review changes' }));
  await actor.click(screen.getByRole('button', { name: 'Save correction' }));
  expect(
    await screen.findByText('Stock changed; refresh before correcting.'),
  ).toBeVisible();
  await actor.click(screen.getByRole('button', { name: 'Back' }));
  expect(screen.getByLabelText('Reason for correction')).toHaveValue(
    'Count discrepancy',
  );
  expect(sessionStorage.length).toBe(0);
});

it('shows a rejected correction value beside its field instead of listing it', async () => {
  const actor = userEvent.setup();
  render(<StockCorrectionEditor item={stock} close={vi.fn()} />, {
    wrapper: wrapper(),
  });
  const width = screen.getByLabelText('Width (in)');
  await actor.clear(width);
  await actor.type(width, '0');
  await actor.type(screen.getByLabelText('Reason for correction'), 'Typo');
  await actor.click(screen.getByRole('button', { name: 'Review changes' }));
  expect(width).toBeInvalid();
  expect(width).toHaveAccessibleDescription('Must be greater than 0.');
  const notice = screen.getByRole('alert');
  expect(notice).toHaveTextContent('Check the correction fields.');
  expect(notice).not.toHaveTextContent(/width/i);
});

import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { stock, ids, user, timestamp } from '../../../tests/fixtures';
import { History } from './history';
import { defaultMeasurementUnits } from '@roller-bay/shared/users';
vi.mock('@/features/auth/auth-boundary', () => ({
  useCurrentUser: () => ({
    ...user,
    measurementUnits: defaultMeasurementUnits,
  }),
  useCanManage: () => true,
}));
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
it('shows audit actor, reason and before/after measurements without private profile fields', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      response({
        items: [
          {
            id: ids.receipt,
            actorId: user.id,
            actorName: 'Warehouse admin',
            createdAt: timestamp,
            action: 'stock.corrected',
            reason: 'Measured on the cutting table',
            changes: [
              {
                recordType: 'stock-items',
                recordId: stock.id,
                before: { type: 'stock-items', value: stock },
                after: {
                  type: 'stock-items',
                  value: { ...stock, widthMm: 2032, revision: 2 },
                },
              },
            ],
          },
        ],
        total: 1,
        page: 1,
        pageSize: 25,
      }),
    ),
  );
  render(<History type="stock-items" id={stock.id} />, { wrapper: wrapper() });
  const summary = await screen.findByText(/Warehouse admin/);
  await userEvent.click(summary);
  expect(screen.getByText('Measured on the cutting table')).toBeVisible();
  expect(screen.getByText('80 in')).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Before' })).toBeVisible();
  expect(screen.getByRole('heading', { name: 'After' })).toBeVisible();
});

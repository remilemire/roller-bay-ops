import { expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { DashboardScreen } from './dashboard-screen';

vi.mock('@/lib/api', async (original) => ({
  ...(await original<typeof import('@/lib/api')>()),
  api: vi.fn(),
}));

it('shows pending requests in place of receipt drafts and refreshes the count after assignment', async () => {
  let pending = 2;
  vi.mocked(api).mockImplementation(async (path) =>
    path === '/production/recuts/pending-count'
      ? { total: pending }
      : { items: [], total: 0, page: 1, pageSize: 25 },
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <DashboardScreen />
    </QueryClientProvider>,
  );
  const card = screen.getByRole('link', { name: /Recuts awaiting fabric/ });
  expect(await within(card).findByText('2')).toBeVisible();
  expect(card).toHaveAttribute('href', '/stations?station=cutting&view=recuts');
  expect(
    screen.queryByRole('link', { name: /Receipt drafts/ }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole('heading', { name: 'Active allocations' }),
  ).toBeVisible();

  pending = 0;
  await client.invalidateQueries({ queryKey: ['production'] });
  expect(await within(card).findByText('0')).toBeVisible();
});

import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocationsScreen } from './locations-screen';
import { listLocations, saveLocation } from './locations.api';

const state = vi.hoisted(() => ({ canManage: true }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/locations',
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock('@/features/auth/auth-boundary', () => ({
  useCanManage: () => state.canManage,
}));
vi.mock('./locations.api', async (original) => ({
  ...(await original<typeof import('./locations.api')>()),
  listLocations: vi.fn(),
  saveLocation: vi.fn(),
}));
const zone = {
  id: 'zone-1',
  name: 'Warehouse',
  parent: '',
  parentId: '',
  sortOrder: '0',
};
const section = {
  id: 'section-1',
  name: 'A',
  parent: 'Warehouse',
  parentId: zone.id,
  sortOrder: '0',
};
const level = {
  id: 'level-1',
  name: 'Top',
  parent: 'Warehouse / A',
  parentId: section.id,
  sortOrder: '0',
};
beforeEach(() => {
  state.canManage = true;
  vi.mocked(listLocations)
    .mockReset()
    .mockImplementation(async (kind, _search, page) => ({
      items: [kind === 'zones' ? zone : kind === 'sections' ? section : level],
      total: 1,
      page,
      pageSize: 25,
    }));
  vi.mocked(saveLocation).mockReset();
});
function showLocations() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <LocationsScreen />
    </QueryClientProvider>,
  );
}
it('nests levels in their section and zone, with collapsible branches', async () => {
  showLocations();
  const user = userEvent.setup();
  const leaf = await screen.findByText('Top');
  const sectionBranch = screen
    .getByRole('button', { name: 'A section' })
    .closest('li')!;
  const zoneBranch = screen
    .getByRole('button', { name: 'Warehouse zone' })
    .closest('li')!;
  expect(sectionBranch).toContainElement(leaf);
  expect(zoneBranch).toContainElement(sectionBranch);
  expect(listLocations).toHaveBeenCalledWith(
    'sections',
    '',
    1,
    expect.any(AbortSignal),
    zone.id,
  );
  expect(listLocations).toHaveBeenCalledWith(
    'levels',
    '',
    1,
    expect.any(AbortSignal),
    section.id,
  );
  await user.click(screen.getByRole('button', { name: 'A section' }));
  expect(screen.queryByText('Top')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'A section' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
});
it('creates a level using the section where Add level was clicked', async () => {
  showLocations();
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole('button', { name: 'Add level to Warehouse / A' }),
  );
  const dialog = within(screen.getByRole('dialog'));
  expect(dialog.queryByLabelText('Display order')).not.toBeInTheDocument();
  expect(dialog.getByText('Section: Warehouse / A')).toBeVisible();
  await user.type(dialog.getByLabelText('Level'), 'Bottom');
  await user.click(dialog.getByRole('button', { name: 'Save record' }));
  await waitFor(() =>
    expect(saveLocation).toHaveBeenCalledWith('levels', undefined, {
      name: 'Bottom',
      parentId: section.id,
    }),
  );
});
it('loads additional children without dropping the existing branch', async () => {
  vi.mocked(listLocations).mockImplementation(async (kind, _search, page) => ({
    items: [
      kind === 'zones'
        ? zone
        : kind === 'sections'
          ? section
          : page === 1
            ? level
            : { ...level, id: 'level-2', name: 'Bottom' },
    ],
    total: kind === 'levels' ? 26 : 1,
    page,
    pageSize: 25,
  }));
  showLocations();
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole('button', { name: 'Load more levels' }),
  );
  expect(await screen.findByText('Bottom')).toBeVisible();
  expect(screen.getByText('Top')).toBeVisible();
  expect(listLocations).toHaveBeenCalledWith(
    'levels',
    '',
    2,
    expect.any(AbortSignal),
    section.id,
  );
});
it('allows employees to browse the hierarchy without management controls', async () => {
  state.canManage = false;
  showLocations();
  expect(await screen.findByText('Top')).toBeVisible();
  expect(
    screen.queryByRole('button', { name: /Add|Edit|Delete/ }),
  ).not.toBeInTheDocument();
});

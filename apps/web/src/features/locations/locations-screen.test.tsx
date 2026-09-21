import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocationsScreen } from './locations-screen';
import { listLocations, saveLocation } from './locations.api';
import { ApiError } from '@/lib/api';

const state = vi.hoisted(() => ({ canManage: true, search: '' }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams({ search: state.search }),
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
  state.search = '';
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
it('shows a rejected level label beside its field', async () => {
  vi.mocked(saveLocation).mockRejectedValue(
    new ApiError(409, 'Validation failed', undefined, [
      { path: 'label', message: 'This section already has that level.' },
    ]),
  );
  showLocations();
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole('button', { name: 'Add level to Warehouse / A' }),
  );
  const dialog = within(screen.getByRole('dialog'));
  const level = dialog.getByLabelText('Level');
  await user.type(level, 'Top');
  await user.click(dialog.getByRole('button', { name: 'Save record' }));
  const notice = await dialog.findByRole('alert');
  expect(notice).toHaveTextContent('Validation failed');
  expect(notice).not.toHaveTextContent(/level/i);
  expect(level).toHaveAccessibleDescription(
    'This section already has that level.',
  );
  await user.type(level, ' 2');
  expect(level).not.toBeInvalid();
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
it('searches every branch and reorders none of them', async () => {
  state.search = 'top';
  showLocations();
  await screen.findByText('Top');
  for (const [kind, parentId] of [
    ['sections', zone.id],
    ['levels', section.id],
  ])
    expect(listLocations).toHaveBeenCalledWith(
      kind,
      'top',
      1,
      expect.any(AbortSignal),
      parentId,
    );
  for (const handle of screen.getAllByRole('button', { name: /^Reorder / }))
    expect(handle).toBeDisabled();
});

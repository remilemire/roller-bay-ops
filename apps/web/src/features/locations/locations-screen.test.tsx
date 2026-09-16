import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocationsScreen } from './locations-screen';

const state = vi.hoisted(() => ({
  params: '',
  replace: vi.fn(),
  canManage: true,
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(state.params),
  usePathname: () => '/locations',
  useRouter: () => ({ replace: state.replace }),
}));
vi.mock('@/features/auth/auth-boundary', () => ({
  useCanManage: () => state.canManage,
}));

beforeEach(() => {
  state.params = '';
  state.canManage = true;
  state.replace.mockClear();
});

function showLocations() {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  for (const kind of ['zones', 'sections', 'levels']) {
    const params = new URLSearchParams(state.params);
    client.setQueryData(
      [
        'locations',
        kind,
        params.get(`${kind}-search`) ?? '',
        Number(params.get(`${kind}-page`) ?? 1),
      ],
      {
        items: [
          {
            id: kind,
            name: `${kind} example`,
            parent: 'Warehouse / A',
            parentId: 'parent',
            sortOrder: '0',
          },
        ],
        total: 60,
      },
    );
  }
  render(
    <QueryClientProvider client={client}>
      <LocationsScreen />
    </QueryClientProvider>,
  );
}

it('shows all three location lists and their own creation controls together', () => {
  showLocations();
  for (const [title, singular] of [
    ['Zones', 'zone'],
    ['Sections', 'section'],
    ['Levels', 'level'],
  ] as const) {
    const panel = within(screen.getByRole('region', { name: title }));
    expect(panel.getByText(`${title.toLowerCase()} example`)).toBeVisible();
    expect(
      panel.getByRole('button', { name: `Add ${singular}` }),
    ).toBeVisible();
  }
});

it('changes only the selected list page and resets only its page when searching', async () => {
  state.params = 'zones-page=2&sections-page=3&levels-search=upper';
  showLocations();
  const user = userEvent.setup();
  const zones = within(screen.getByRole('region', { name: 'Zones' }));
  await user.click(zones.getByRole('button', { name: 'Next' }));
  expect(state.replace).toHaveBeenLastCalledWith(
    '/locations?zones-page=3&sections-page=3&levels-search=upper',
    { scroll: false },
  );
  await user.type(zones.getByRole('searchbox'), 'Warehouse');
  await user.click(zones.getByRole('button', { name: 'Search' }));
  expect(state.replace).toHaveBeenLastCalledWith(
    '/locations?sections-page=3&levels-search=upper&zones-search=Warehouse',
    { scroll: false },
  );
});

it('keeps all location lists readable without management controls for employees', () => {
  state.canManage = false;
  showLocations();
  expect(screen.getAllByRole('table')).toHaveLength(3);
  expect(
    screen.queryByRole('button', { name: /Add|Edit|Delete/ }),
  ).not.toBeInTheDocument();
});

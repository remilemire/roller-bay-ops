import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CatalogScreen } from './catalog-screen';
import { listCatalog, saveCatalog } from './catalog.api';
import { ApiError } from '@/lib/api';

const state = vi.hoisted(() => ({ canManage: true, search: '' }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams({ search: state.search }),
  usePathname: () => '/fabric-catalog',
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock('@/features/auth/auth-boundary', async () => {
  const { defaultMeasurementUnits } = await import('@roller-bay/shared/users');
  return {
    useCanManage: () => state.canManage,
    useCurrentUser: () => ({ measurementUnits: defaultMeasurementUnits }),
  };
});
vi.mock('./catalog.api', async (original) => ({
  ...(await original<typeof import('./catalog.api')>()),
  listCatalog: vi.fn(),
  saveCatalog: vi.fn(),
}));
const manufacturer = {
  id: 'manufacturer-1',
  name: 'Acme',
  parentId: '',
  parent: '',
  manufacturer: '',
  thicknessMm: null,
};
const material = {
  id: 'material-1',
  name: 'Blackout',
  parentId: manufacturer.id,
  parent: 'Acme',
  manufacturer: 'Acme',
  thicknessMm: null,
};
const color = {
  id: 'color-1',
  name: 'AB-12',
  parentId: material.id,
  parent: 'Blackout',
  manufacturer: 'Acme',
  thicknessMm: 0.425,
};
beforeEach(() => {
  state.canManage = true;
  state.search = '';
  vi.mocked(listCatalog)
    .mockReset()
    .mockImplementation(async (kind, _search, page) => ({
      items: [
        kind === 'manufacturers'
          ? manufacturer
          : kind === 'materials'
            ? material
            : color,
      ],
      total: 1,
      page,
      pageSize: 25,
    }));
  vi.mocked(saveCatalog).mockReset();
});
function showCatalog() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <CatalogScreen />
    </QueryClientProvider>,
  );
}
it('nests colors in their material and manufacturer, loading colors on expand', async () => {
  showCatalog();
  const user = userEvent.setup();
  const materialToggle = await screen.findByRole('button', {
    name: 'Blackout material',
  });
  expect(materialToggle).toHaveAttribute('aria-expanded', 'false');
  expect(listCatalog).not.toHaveBeenCalledWith(
    'colors',
    expect.anything(),
    expect.anything(),
    expect.anything(),
    expect.anything(),
  );
  await user.click(materialToggle);
  const leaf = await screen.findByText('AB-12');
  const materialBranch = materialToggle.closest('li')!;
  const manufacturerBranch = screen
    .getByRole('button', { name: 'Acme manufacturer' })
    .closest('li')!;
  expect(materialBranch).toContainElement(leaf);
  expect(manufacturerBranch).toContainElement(materialBranch);
  expect(listCatalog).toHaveBeenCalledWith(
    'materials',
    '',
    1,
    expect.any(AbortSignal),
    manufacturer.id,
  );
  expect(listCatalog).toHaveBeenCalledWith(
    'colors',
    '',
    1,
    expect.any(AbortSignal),
    material.id,
  );
});
it('creates a color using the material where Add color was clicked', async () => {
  showCatalog();
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole('button', {
      name: 'Add color to Acme / Blackout',
    }),
  );
  const dialog = within(screen.getByRole('dialog'));
  expect(dialog.getByText('Material: Acme / Blackout')).toBeVisible();
  await user.type(dialog.getByLabelText('Color code'), 'CD-34');
  await user.type(dialog.getByLabelText(/^Thickness \(mm\)/), '0.5');
  await user.click(dialog.getByRole('button', { name: 'Save record' }));
  await waitFor(() =>
    expect(saveCatalog).toHaveBeenCalledWith('colors', undefined, {
      name: 'CD-34',
      parentId: material.id,
      thicknessMm: 0.5,
    }),
  );
});
it('shows rejected values beside the color code and thickness fields', async () => {
  vi.mocked(saveCatalog).mockRejectedValue(
    new ApiError(400, 'Validation failed', undefined, [
      { path: ['code'], message: 'Use letters, digits, and hyphens.' },
      { path: 'thicknessMm', message: 'Too small: expected number to be >0' },
    ]),
  );
  showCatalog();
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole('button', {
      name: 'Add color to Acme / Blackout',
    }),
  );
  const dialog = within(screen.getByRole('dialog'));
  await user.type(dialog.getByLabelText('Color code'), 'CD 34');
  await user.type(dialog.getByLabelText(/^Thickness \(mm\)/), '0');
  await user.click(dialog.getByRole('button', { name: 'Save record' }));
  const notice = await dialog.findByRole('alert');
  expect(notice).toHaveTextContent('Validation failed');
  expect(notice).not.toHaveTextContent(/code|thickness/i);
  expect(dialog.getByLabelText('Color code')).toHaveAccessibleDescription(
    'Use letters, digits, and hyphens.',
  );
  const thickness = dialog.getByLabelText(/^Thickness \(mm\)/);
  expect(thickness).toHaveAccessibleDescription('Too small.');
  await user.type(thickness, '.5');
  expect(thickness).not.toBeInvalid();
});

it('allows employees to browse the hierarchy without management controls', async () => {
  state.canManage = false;
  showCatalog();
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole('button', { name: 'Blackout material' }),
  );
  expect(await screen.findByText('AB-12')).toBeVisible();
  expect(
    screen.queryByRole('button', { name: /Add|Edit|Delete/ }),
  ).not.toBeInTheDocument();
});
it('searches every branch, opening a material found only by its colors', async () => {
  state.search = 'ab-1';
  showCatalog();
  expect(await screen.findByText('AB-12')).toBeVisible();
  for (const [kind, parentId] of [
    ['manufacturers', ''],
    ['materials', manufacturer.id],
    ['colors', material.id],
  ])
    expect(listCatalog).toHaveBeenCalledWith(
      kind,
      'ab-1',
      1,
      expect.any(AbortSignal),
      parentId,
    );
});
it('leaves a material closed when the search found it by name', async () => {
  state.search = 'black';
  showCatalog();
  expect(
    await screen.findByRole('button', { name: 'Blackout material' }),
  ).toHaveAttribute('aria-expanded', 'false');
});

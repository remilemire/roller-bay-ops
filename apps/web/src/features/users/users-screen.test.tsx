import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { defaultMeasurementUnits, type User } from '@roller-bay/shared/users';
import { ApiError } from '@/lib/api';
import { UsersScreen } from './users-screen';
import {
  listUsers,
  setUserActivation,
  setUserRole,
  transferOwnership,
} from './users.api';

const person = (id: string, name: string, role: User['role']): User => ({
  id,
  name,
  role,
  stations: [],
  isActive: true,
  email: `${name.split(' ')[0]!.toLowerCase()}@example.com`,
  createdAt: '2026-09-16T12:00:00.000Z',
  measurementUnits: defaultMeasurementUnits,
  colorTheme: 'slate',
});
const owner = person('owner-1', 'Olive Owner', 'owner');
const admin = person('admin-1', 'Ada Admin', 'admin');
const member = person('user-1', 'Uma User', 'staff');
const state = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/users',
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock('@/features/auth/auth-boundary', () => ({
  useCurrentUser: () => state.current,
  useCanManage: () => (state.current as User).role !== 'staff',
}));
vi.mock('./users.api', async (original) => ({
  ...(await original<typeof import('./users.api')>()),
  listUsers: vi.fn(),
  setUserActivation: vi.fn(),
  setUserRole: vi.fn(),
  transferOwnership: vi.fn(),
}));
beforeEach(() => {
  state.current = admin;
  vi.mocked(listUsers)
    .mockReset()
    .mockResolvedValue({
      items: [admin, owner, { ...member, isActive: false }],
      total: 3,
      page: 1,
      pageSize: 25,
    });
  vi.mocked(setUserActivation).mockReset();
  vi.mocked(setUserRole).mockReset();
  vi.mocked(transferOwnership).mockReset();
});
function showUsers() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <UsersScreen />
    </QueryClientProvider>,
  );
  return invalidate;
}
const rowFor = async (name: string) =>
  (await screen.findByText(name)).closest('tr')!;

it('does not request the directory for an ordinary user', () => {
  state.current = member;
  showUsers();
  expect(screen.getByText('Admins only')).toBeInTheDocument();
  expect(listUsers).not.toHaveBeenCalled();
});

it('offers an admin no actions on the owner or themselves, and no transfer', async () => {
  showUsers();
  expect(within(await rowFor('Olive Owner')).queryAllByRole('button')).toEqual(
    [],
  );
  expect(within(await rowFor('Ada Admin')).queryAllByRole('button')).toEqual(
    [],
  );
  const row = within(await rowFor('Uma User'));
  expect(row.getByRole('button', { name: 'Make admin' })).toBeInTheDocument();
  expect(row.getByRole('button', { name: 'Reactivate' })).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Transfer ownership' }),
  ).toBeNull();
});

it('changes a role only after confirmation and keeps the dialog open on failure', async () => {
  vi.mocked(setUserRole)
    .mockRejectedValueOnce(new ApiError(503, 'User storage is unavailable.'))
    .mockResolvedValueOnce({ ...member, role: 'admin' });
  showUsers();
  const user = userEvent.setup();
  await user.click(
    within(await rowFor('Uma User')).getByRole('button', {
      name: 'Make admin',
    }),
  );
  expect(setUserRole).not.toHaveBeenCalled();
  const dialog = within(screen.getByRole('dialog'));
  await user.click(dialog.getByRole('button', { name: 'Make admin' }));
  expect(await dialog.findByRole('alert')).toHaveTextContent(
    'User storage is unavailable.',
  );
  await user.click(dialog.getByRole('button', { name: 'Make admin' }));
  expect(setUserRole).toHaveBeenLastCalledWith(member.id, 'admin', []);
  expect(listUsers).toHaveBeenCalledTimes(2);
});

it('lets the owner transfer ownership to an active user and refreshes the session', async () => {
  state.current = owner;
  vi.mocked(listUsers).mockResolvedValue({
    items: [admin, owner, { ...member, isActive: false }],
    total: 3,
    page: 1,
    pageSize: 25,
  });
  vi.mocked(transferOwnership).mockResolvedValue({
    previousOwner: { ...owner, role: 'admin' },
    newOwner: { ...admin, role: 'owner' },
  });
  const invalidate = showUsers();
  const user = userEvent.setup();
  // Inactive users cannot receive ownership.
  expect(
    within(await rowFor('Uma User')).queryByRole('button', {
      name: 'Transfer ownership',
    }),
  ).toBeNull();
  await user.click(
    within(await rowFor('Ada Admin')).getByRole('button', {
      name: 'Transfer ownership',
    }),
  );
  await user.click(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: 'Transfer ownership',
    }),
  );
  expect(transferOwnership).toHaveBeenCalledWith(admin.id);
  await vi.waitFor(() =>
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['auth', 'me'] }),
  );
});

'use client';
import { useState } from 'react';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  stationSchema,
  type Station,
  type User,
} from '@roller-bay/shared/users';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/input';
import {
  Empty,
  ErrorNotice,
  Loading,
  PageHeading,
  Pagination,
  Status,
} from '@/components/ui/feedback';
import { SearchToolbar } from '@/components/ui/search-toolbar';
import { dateLabel } from '@/lib/format';
import { useListParams } from '@/lib/use-list-params';
import { useCanManage, useCurrentUser, sessionKey } from '@/features/auth';
import {
  listUsers,
  setUserActivation,
  setUserRole,
  transferOwnership,
  usersKey,
} from './users.api';
type AssignableRole = Exclude<User['role'], 'owner'>;
type PendingAction =
  | {
      kind: 'role';
      target: User;
      role: AssignableRole;
      stations?: Station[];
    }
  | { kind: 'activation'; target: User; isActive: boolean }
  | { kind: 'transfer'; target: User };
const confirmation = (action: PendingAction) =>
  action.kind === 'transfer'
    ? {
        title: `Transfer ownership to ${action.target.name}?`,
        description:
          'You become an admin. Only the new owner can transfer ownership again.',
        confirm: 'Transfer ownership',
      }
    : action.kind === 'activation'
      ? action.isActive
        ? {
            title: `Reactivate ${action.target.name}?`,
            description: 'They can sign in again with their current role.',
            confirm: 'Reactivate',
          }
        : {
            title: `Deactivate ${action.target.name}?`,
            description:
              'They lose access on their next request. Their records and role are kept.',
            confirm: 'Deactivate',
          }
      : {
          title: `Change role for ${action.target.name}`,
          description: 'Role changes take effect on their next request.',
          confirm: 'Save role',
        };
const roleOptions: { value: AssignableRole; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'production', label: 'Production' },
  { value: 'staff', label: 'Staff' },
  { value: 'admin', label: 'Admin' },
];
const roleDescriptions: Record<AssignableRole, string> = {
  pending: 'Signed in, but waiting for an administrator to grant access.',
  production: 'Limited to assigned production stations and personal settings.',
  staff: 'Standard receipt, allocation, stock, and order workflows.',
  admin: 'Staff access plus administration and user management.',
};
const editableRole = (user: User): AssignableRole => {
  if (user.role === 'owner')
    throw new Error('Ownership changes require an ownership transfer.');
  return user.role;
};
export function UsersScreen() {
  const canManage = useCanManage();
  if (!canManage)
    return (
      <>
        <PageHeading title="Users" />
        <section className="panel">
          <Empty title="Admins only">
            Ask an admin or the owner to manage user access.
          </Empty>
        </section>
      </>
    );
  return <UserDirectory />;
}
function UserDirectory() {
  const params = useListParams();
  const current = useCurrentUser();
  const client = useQueryClient();
  const [action, setAction] = useState<PendingAction | null>(null);
  const query = useQuery({
    queryKey: [...usersKey, params.search, params.page],
    queryFn: ({ signal }) => listUsers(params.search, params.page, signal),
    placeholderData: keepPreviousData,
  });
  const mutation = useMutation({
    // The refreshed list is authoritative; the responses are not displayed.
    mutationFn: async (next: PendingAction) => {
      if (next.kind === 'transfer') await transferOwnership(next.target.id);
      else if (next.kind === 'activation')
        await setUserActivation(next.target.id, next.isActive);
      else await setUserRole(next.target.id, next.role, next.stations ?? []);
    },
    onSuccess: async (_result, next) => {
      setAction(null);
      await Promise.all([
        client.invalidateQueries({ queryKey: usersKey }),
        // A transfer changes the signed-in user's own role.
        next.kind === 'transfer' &&
          client.invalidateQueries({ queryKey: sessionKey }),
      ]);
    },
  });
  const open = (next: PendingAction) => {
    mutation.reset();
    setAction(next);
  };
  const copy = action && confirmation(action);
  return (
    <>
      <PageHeading title="Users" />
      <SearchToolbar
        search={params.search}
        onSearch={(search) => params.set({ search })}
        placeholder="Search by name or email…"
      />
      <section className="panel" aria-label="User directory">
        {query.isPending ? (
          <Loading />
        ) : query.error ? (
          <ErrorNotice error={query.error} retry={() => void query.refetch()} />
        ) : !query.data.items.length ? (
          <Empty title="No matching users">
            People appear here after their first Microsoft sign-in.
          </Empty>
        ) : (
          <div className="data-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Access</th>
                  <th>Joined</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {query.data.items.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.name}</strong>
                      <small>{row.email}</small>
                    </td>
                    <td>
                      <Status value={row.role} />
                    </td>
                    <td>
                      <Status value={row.isActive ? 'active' : 'inactive'} />
                    </td>
                    <td>{dateLabel(row.createdAt)}</td>
                    <td>
                      {/* The owner changes only through a transfer, and
                          self-service changes could lock the actor out. */}
                      {row.id === current.id ? (
                        <span className="muted">You</span>
                      ) : row.role === 'owner' ? null : (
                        <div className="inline-actions">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              open({
                                kind: 'role',
                                target: row,
                                role: editableRole(row),
                                stations: row.stations ?? [],
                              })
                            }
                          >
                            Change role
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              open({
                                kind: 'activation',
                                target: row,
                                isActive: !row.isActive,
                              })
                            }
                          >
                            {row.isActive ? 'Deactivate' : 'Reactivate'}
                          </Button>
                          {current.role === 'owner' &&
                            row.isActive &&
                            ['staff', 'admin'].includes(row.role) && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  open({ kind: 'transfer', target: row })
                                }
                              >
                                Transfer ownership
                              </Button>
                            )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {query.data && (
          <Pagination
            page={params.page}
            total={query.data.total}
            onPage={(page) => params.set({ page })}
          />
        )}
      </section>
      <Dialog
        open={!!action}
        onOpenChange={(next) => {
          if (!next && !mutation.isPending) setAction(null);
        }}
        title={copy?.title ?? ''}
        description={copy?.description}
      >
        {action?.kind === 'role' && (
          <div className="role-form">
            <Field label="Role" htmlFor="user-role">
              <Select
                id="user-role"
                value={action.role}
                onChange={(event) =>
                  setAction({
                    ...action,
                    role: event.target.value as AssignableRole,
                  })
                }
              >
                {roleOptions.map((role) => (
                  <option value={role.value} key={role.value}>
                    {role.label}
                  </option>
                ))}
              </Select>
            </Field>
            <p className="muted role-description">
              {roleDescriptions[action.role]}
            </p>
            {action.role === 'production' && (
              <fieldset className="role-stations">
                <legend>Allowed stations</legend>
                <div className="role-station-grid">
                  {stationSchema.options.map((station) => (
                    <label className="role-station-option" key={station}>
                      <input
                        type="checkbox"
                        checked={action.stations?.includes(station) ?? false}
                        onChange={(event) =>
                          setAction({
                            ...action,
                            stations: event.target.checked
                              ? [...(action.stations ?? []), station]
                              : (action.stations ?? []).filter(
                                  (value) => value !== station,
                                ),
                          })
                        }
                      />
                      <span>{station}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
          </div>
        )}
        {mutation.error && <ErrorNotice error={mutation.error} />}
        <div className="form-actions">
          <Button
            variant="outline"
            disabled={mutation.isPending}
            onClick={() => setAction(null)}
          >
            Cancel
          </Button>
          <Button
            variant={
              action?.kind === 'activation' && !action.isActive
                ? 'destructive'
                : 'default'
            }
            disabled={mutation.isPending}
            onClick={() => action && mutation.mutate(action)}
          >
            {mutation.isPending ? 'Saving…' : copy?.confirm}
          </Button>
        </div>
      </Dialog>
    </>
  );
}

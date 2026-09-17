'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { User } from '@roller-bay/shared/users';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
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
import { useCanManage, useCurrentUser } from '@/features/auth/auth-boundary';
import { sessionKey } from '@/features/auth/auth.queries';
import {
  listUsers,
  setUserActivation,
  setUserRole,
  transferOwnership,
  usersKey,
} from './users.api';
type PendingAction =
  | { kind: 'role'; target: User; role: 'user' | 'admin' }
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
      : action.role === 'admin'
        ? {
            title: `Make ${action.target.name} an admin?`,
            description:
              'Admins can change the catalog, locations, and stock, and manage users.',
            confirm: 'Make admin',
          }
        : {
            title: `Remove admin access from ${action.target.name}?`,
            description: 'They keep receipt and allocation workflows.',
            confirm: 'Remove admin',
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
  });
  const mutation = useMutation({
    // The refreshed list is authoritative; the responses are not displayed.
    mutationFn: async (next: PendingAction) => {
      if (next.kind === 'transfer') await transferOwnership(next.target.id);
      else if (next.kind === 'activation')
        await setUserActivation(next.target.id, next.isActive);
      else await setUserRole(next.target.id, next.role);
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
        key={params.search}
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
                                role: row.role === 'admin' ? 'user' : 'admin',
                              })
                            }
                          >
                            {row.role === 'admin'
                              ? 'Remove admin'
                              : 'Make admin'}
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
                          {current.role === 'owner' && row.isActive && (
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

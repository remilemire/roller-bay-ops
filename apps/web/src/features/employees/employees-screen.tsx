'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  employeeListSchema,
  employeeInputSchema,
  employeeSchema,
  type Employee,
} from '@roller-bay/shared/employees';
import { api } from '@/lib/api';
import { useCanManage } from '@/features/auth/auth-boundary';
import { listUsers } from '@/features/users/users.api';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/field';
import { Lookup } from '@/components/ui/lookup';
import { Dialog } from '@/components/ui/dialog';
import {
  PageHeading,
  Loading,
  ErrorNotice,
  Status,
} from '@/components/ui/feedback';
export function EmployeesScreen() {
  const canManage = useCanManage();
  return canManage ? (
    <EmployeeDirectory />
  ) : (
    <p>Only admins can manage employees.</p>
  );
}
function EmployeeDirectory() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['employees'],
    queryFn: () => api('/employees', employeeListSchema),
  });
  const [editing, setEditing] = useState<Employee | null | undefined>();
  const [search, setSearch] = useState('');
  return (
    <>
      <PageHeading
        title="Employees"
        description="Names and initials used to record completed work."
      >
        <Button onClick={() => setEditing(null)}>Add employee</Button>
      </PageHeading>
      <TextField label="Find employee" value={search} onChange={setSearch} />
      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        <ErrorNotice error={query.error} />
      ) : (
        <section className="panel">
          <div className="data-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Initials</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {query.data
                  .filter((e) =>
                    `${e.name} ${e.initials}`
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                  )
                  .map((e) => (
                    <tr key={e.id}>
                      <td>{e.name}</td>
                      <td>{e.initials}</td>
                      <td>
                        <Status value={e.isActive ? 'active' : 'inactive'} />
                      </td>
                      <td>
                        <Button variant="outline" onClick={() => setEditing(e)}>
                          Edit
                        </Button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {!query.data.length && (
              <p className="panel-body">
                Add employees so stations can attribute completed work.
              </p>
            )}
          </div>
        </section>
      )}
      {editing !== undefined && (
        <EmployeeEditor
          employee={editing}
          close={() => setEditing(undefined)}
          saved={async () => {
            setEditing(undefined);
            await client.invalidateQueries({ queryKey: ['employees'] });
            await client.invalidateQueries({
              queryKey: ['production', 'employees'],
            });
          }}
        />
      )}
    </>
  );
}
function EmployeeEditor({
  employee,
  close,
  saved,
}: {
  employee: Employee | null;
  close: () => void;
  saved: () => Promise<void>;
}) {
  const [name, setName] = useState(employee?.name ?? '');
  const [initials, setInitials] = useState(employee?.initials ?? '');
  const [active, setActive] = useState(employee?.isActive ?? true);
  const [linkedUserId, setLinkedUserId] = useState(
    employee?.linkedUserId ?? '',
  );
  const mutation = useMutation({
    mutationFn: () => {
      const body = employeeInputSchema.parse({
        name,
        initials,
        isActive: active,
        linkedUserId: linkedUserId || null,
      });
      return api(
        employee ? `/employees/${employee.id}` : '/employees',
        employeeSchema,
        {
          method: employee ? 'PUT' : 'POST',
          body: employee
            ? { ...body, expectedRevision: employee.revision }
            : body,
        },
      );
    },
    onSuccess: saved,
  });
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v && !mutation.isPending) close();
      }}
      title={employee ? 'Edit employee' : 'Add employee'}
    >
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
      >
        <TextField
          label="Full name"
          value={name}
          onChange={setName}
          required
          maxLength={120}
        />
        <TextField
          label="Initials"
          value={initials}
          onChange={setInitials}
          required
          maxLength={12}
        />
        <label>
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
          />{' '}
          Active
        </label>
        <Lookup
          label="Linked application account (optional)"
          value={linkedUserId}
          onChange={setLinkedUserId}
          queryKey={['users', 'employee-link']}
          load={async (search, page, signal) => {
            const data = await listUsers(search, page, signal);
            return {
              total: data.total,
              items: data.items.map((u) => ({ id: u.id, label: u.name })),
            };
          }}
        />
        {linkedUserId && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => setLinkedUserId('')}
          >
            Remove account link
          </Button>
        )}
        <p className="muted">
          Inactive employees remain in past completion records.
        </p>
        {mutation.error && <ErrorNotice error={mutation.error} />}
        <div className="form-actions">
          <Button
            type="button"
            variant="outline"
            disabled={mutation.isPending}
            onClick={close}
          >
            Cancel
          </Button>
          <Button disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : 'Save employee'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

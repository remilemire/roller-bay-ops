'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  employeeListSchema,
  employeeInputSchema,
  employeeSchema,
  type Employee,
} from '@roller-bay/shared/employees';
import type { ErrorIssue } from '@roller-bay/shared/errors';
import { issuePath } from '@/lib/errors';
import { fieldIssues } from '@/lib/field-issues';
import { useListParams } from '@/lib/use-list-params';
import { api } from '@/lib/api';
import { useCanManage } from '@/features/auth';
import { listUsers } from '@/features/users';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/field';
import { Lookup } from '@/components/ui/lookup';
import { Dialog } from '@/components/ui/dialog';
import { SearchToolbar } from '@/components/ui/search-toolbar';
import {
  Empty,
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
  const params = useListParams();
  const employees =
    query.data?.filter((employee) =>
      `${employee.name} ${employee.initials}`
        .toLowerCase()
        .includes(params.search.toLowerCase()),
    ) ?? [];
  return (
    <>
      <PageHeading
        title="Employees"
        description="Names and initials used to record completed work."
      >
        <Button onClick={() => setEditing(null)}>Add employee</Button>
      </PageHeading>
      <SearchToolbar
        search={params.search}
        onSearch={(search) => params.set({ search })}
        placeholder="Find employee…"
      />
      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        <ErrorNotice error={query.error} retry={() => void query.refetch()} />
      ) : (
        <section className="panel">
          <div className="data-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Initials</th>
                  <th>Status</th>
                  <th className="table-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((e) => (
                  <tr key={e.id}>
                    <td>{e.name}</td>
                    <td>{e.initials}</td>
                    <td>
                      <Status value={e.isActive ? 'active' : 'inactive'} />
                    </td>
                    <td className="table-actions">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditing(e)}
                      >
                        Edit
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!employees.length && (
              <Empty
                title={
                  params.search ? 'No matching employees' : 'No employees yet'
                }
              >
                {params.search
                  ? 'Try another name or initials.'
                  : 'Add employees so stations can attribute completed work.'}
              </Empty>
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
const employeeFieldName = (issue: ErrorIssue) => {
  const path = issuePath(issue);
  return path === 'name' || path === 'initials' || path === 'linkedUserId'
    ? path
    : null;
};
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
  const [errors, setErrors] = useState<
    Partial<Record<'name' | 'initials' | 'linkedUserId', string>>
  >({});
  const clearError = (field: keyof typeof errors) =>
    setErrors((current) => ({ ...current, [field]: undefined }));
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
    onError: (error) => setErrors(fieldIssues(error, employeeFieldName)),
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
        className="form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
      >
        <TextField
          label="Full name"
          value={name}
          onChange={(value) => {
            setName(value);
            clearError('name');
          }}
          error={errors.name}
          required
          maxLength={120}
        />
        <TextField
          label="Initials"
          value={initials}
          onChange={(value) => {
            setInitials(value);
            clearError('initials');
          }}
          error={errors.initials}
          required
          maxLength={12}
        />
        <Lookup
          label="Linked application account"
          optional
          value={linkedUserId}
          onChange={(value) => {
            setLinkedUserId(value);
            clearError('linkedUserId');
          }}
          error={errors.linkedUserId}
          queryKey={['users', 'employee-link']}
          load={async (search, page, signal) => {
            const data = await listUsers(search, page, signal);
            return {
              total: data.total,
              items: data.items.map((u) => ({ id: u.id, label: u.name })),
            };
          }}
        />
        <label className="check-field">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
          />{' '}
          Active
        </label>
        <p className="muted">
          Inactive employees remain in past completion records.
        </p>
        {mutation.error && (
          <ErrorNotice
            error={mutation.error}
            inline={(issue) => employeeFieldName(issue) !== null}
          />
        )}
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

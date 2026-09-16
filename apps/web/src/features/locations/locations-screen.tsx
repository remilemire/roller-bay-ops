'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Pencil, Trash2, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { TextField } from '@/components/ui/field';
import { Lookup } from '@/components/ui/lookup';
import {
  Empty,
  ErrorNotice,
  Loading,
  PageHeading,
  Pagination,
} from '@/components/ui/feedback';
import { SearchToolbar } from '@/components/ui/search-toolbar';
import { useListParams } from '@/lib/use-list-params';
import { useCanManage } from '@/features/auth/auth-boundary';
import {
  locationsKey,
  listLocations,
  saveLocation,
  deleteLocation,
  type LocationKind,
  type LocationRow,
} from './locations.api';
const formSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name or label.'),
  parentId: z.string(),
  sortOrder: z.string(),
});
export function LocationsScreen() {
  return (
    <>
      <PageHeading title="Locations" />
      <div className="stack">
        <LocationList kind="zones" title="Zones" />
        <LocationList kind="sections" title="Sections" />
        <LocationList kind="levels" title="Levels" />
      </div>
    </>
  );
}
function LocationList({ kind, title }: { kind: LocationKind; title: string }) {
  const params = useListParams(kind);
  const query = useQuery({
    queryKey: [...locationsKey, kind, params.search, params.page],
    queryFn: ({ signal }) =>
      listLocations(kind, params.search, params.page, signal),
  });
  const canManage = useCanManage();
  const [editing, setEditing] = useState<LocationRow | 'new' | null>(null);
  const [deleting, setDeleting] = useState<LocationRow | null>(null);
  const client = useQueryClient();
  const remove = useMutation({
    mutationFn: () => deleteLocation(kind, deleting!.id),
    onSuccess: async () => {
      setDeleting(null);
      await client.invalidateQueries({ queryKey: locationsKey });
    },
  });
  return (
    <>
      <section className="panel" aria-labelledby={`${kind}-heading`}>
        <div className="panel-heading">
          <h2 id={`${kind}-heading`}>{title}</h2>
          {canManage && (
            <Button onClick={() => setEditing('new')}>
              <Plus size={17} />
              Add{' '}
              {kind === 'levels'
                ? 'level'
                : kind === 'sections'
                  ? 'section'
                  : 'zone'}
            </Button>
          )}
        </div>
        <div className="panel-body">
          <SearchToolbar
            key={`${kind}-${params.search}`}
            search={params.search}
            onSearch={(search) => params.set({ search })}
            placeholder={`Search ${kind}…`}
          />
        </div>
        {query.isPending ? (
          <Loading />
        ) : query.error ? (
          <ErrorNotice error={query.error} retry={() => void query.refetch()} />
        ) : !query.data.items.length ? (
          <Empty
            title={params.search ? `No matching ${kind}` : `No ${kind} yet`}
          />
        ) : (
          <div className="data-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{kind === 'levels' ? 'Level' : 'Name'}</th>
                  {kind !== 'zones' && (
                    <th>{kind === 'levels' ? 'Zone / section' : 'Zone'}</th>
                  )}
                  <th>Display order</th>
                  {canManage && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {query.data.items.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <div className="cell-leading">
                        <span className="cell-icon">
                          <MapPin size={17} />
                        </span>
                        <strong>{row.name}</strong>
                      </div>
                    </td>
                    {kind !== 'zones' && <td>{row.parent}</td>}
                    <td>{row.sortOrder}</td>
                    {canManage && (
                      <td>
                        <div className="inline-actions">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Edit ${row.name}`}
                            onClick={() => setEditing(row)}
                          >
                            <Pencil size={16} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Delete ${row.name}`}
                            onClick={() => {
                              remove.reset();
                              setDeleting(row);
                            }}
                          >
                            <Trash2 size={16} />
                          </Button>
                        </div>
                      </td>
                    )}
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
      {editing && (
        <LocationEditor
          kind={kind}
          row={editing === 'new' ? undefined : editing}
          close={() => setEditing(null)}
        />
      )}
      <Dialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setDeleting(null);
        }}
        title={`Delete ${deleting?.name ?? ''}?`}
        description="Records in use cannot be deleted."
      >
        {remove.error && <ErrorNotice error={remove.error} />}
        <div className="form-actions">
          <Button variant="outline" onClick={() => setDeleting(null)}>
            Keep record
          </Button>
          <Button
            variant="destructive"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
          >
            Delete
          </Button>
        </div>
      </Dialog>
    </>
  );
}
function LocationEditor({
  kind,
  row,
  close,
}: {
  kind: LocationKind;
  row?: LocationRow;
  close: () => void;
}) {
  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: row?.name ?? '',
      parentId: row?.parentId ?? '',
      sortOrder: row?.sortOrder ?? '0',
    },
  });
  const values = useWatch({ control: form.control }) as z.infer<
    typeof formSchema
  >;
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: (data: z.infer<typeof formSchema>) =>
      saveLocation(kind, row?.id, data),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: locationsKey }),
        client.invalidateQueries({ queryKey: ['stock-items'] }),
      ]);
      close();
    },
  });
  const parentKind = kind === 'levels' ? 'sections' : 'zones';
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) close();
      }}
      title={`${row ? 'Edit' : 'Add'} ${kind === 'levels' ? 'level' : kind === 'sections' ? 'section' : 'zone'}`}
      description="Labels can be letters or numbers. Existing parent locations stay fixed."
    >
      <form onSubmit={form.handleSubmit((data) => mutation.mutate(data))}>
        <div className="stack">
          <TextField
            label={kind === 'levels' ? 'Level' : 'Name'}
            value={values.name}
            onChange={(v) => form.setValue('name', v)}
            required
            maxLength={kind === 'zones' ? 120 : 40}
          />
          {kind !== 'zones' && !row && (
            <Lookup
              label={kind === 'levels' ? 'Section' : 'Zone'}
              value={values.parentId}
              onChange={(v) => form.setValue('parentId', v)}
              queryKey={[...locationsKey, parentKind]}
              load={async (search, page, signal) => {
                const data = await listLocations(
                  parentKind,
                  search,
                  page,
                  signal,
                );
                return {
                  total: data.total,
                  items: data.items.map((i) => ({ id: i.id, label: i.name })),
                };
              }}
            />
          )}
          <TextField
            label="Display order"
            type="number"
            value={values.sortOrder}
            onChange={(v) => form.setValue('sortOrder', v)}
            required
            hint="Zero or a positive whole number."
          />
        </div>
        {form.formState.errors.name && (
          <p className="notice notice-error" role="alert">
            {form.formState.errors.name.message}
          </p>
        )}
        {mutation.error && <ErrorNotice error={mutation.error} />}
        <div className="form-actions">
          <Button
            type="button"
            variant="outline"
            onClick={close}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : 'Save record'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

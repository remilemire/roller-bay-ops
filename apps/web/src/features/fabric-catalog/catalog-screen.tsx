'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Pencil, Trash2, SwatchBook } from 'lucide-react';
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
  catalogKey,
  listCatalog,
  saveCatalog,
  deleteCatalog,
  type CatalogKind,
  type CatalogRow,
} from './catalog.api';
const formSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name or color code.'),
  parentId: z.string(),
  thickness: z.string(),
});
export function CatalogScreen() {
  const params = useListParams();
  const kind: CatalogKind =
    params.get('view') === 'materials'
      ? 'materials'
      : params.get('view') === 'manufacturers'
        ? 'manufacturers'
        : 'colors';
  const query = useQuery({
    queryKey: [...catalogKey, kind, params.search, params.page],
    queryFn: ({ signal }) =>
      listCatalog(kind, params.search, params.page, signal),
  });
  const canManage = useCanManage();
  const [editing, setEditing] = useState<CatalogRow | 'new' | null>(null);
  const [deleting, setDeleting] = useState<CatalogRow | null>(null);
  const client = useQueryClient();
  const remove = useMutation({
    mutationFn: () => deleteCatalog(kind, deleting!.id),
    onSuccess: async () => {
      setDeleting(null);
      await client.invalidateQueries({ queryKey: catalogKey });
    },
  });
  return (
    <>
      <PageHeading title="Fabric catalog">
        {canManage && (
          <Button onClick={() => setEditing('new')}>
            <Plus size={17} />
            Add{' '}
            {kind === 'colors'
              ? 'color'
              : kind === 'materials'
                ? 'material'
                : 'manufacturer'}
          </Button>
        )}
      </PageHeading>
      <SearchToolbar
        key={`${kind}-${params.search}`}
        search={params.search}
        onSearch={(search) => params.set({ search })}
        placeholder="Search the catalog…"
      >
        <div className="tabs">
          {(['colors', 'materials', 'manufacturers'] as const).map((tab) => (
            <button
              key={tab}
              className={`tab ${tab === kind ? 'active' : ''}`}
              onClick={() => params.set({ view: tab, search: '' })}
            >
              {tab[0]!.toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
      </SearchToolbar>
      <section className="panel">
        {query.isPending ? (
          <Loading />
        ) : query.error ? (
          <ErrorNotice error={query.error} retry={() => void query.refetch()} />
        ) : !query.data.items.length ? (
          <Empty title="Your catalog starts here">
            Add manufacturers, materials, then their fabric colors.
          </Empty>
        ) : (
          <div className="data-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{kind === 'colors' ? 'Color code' : 'Name'}</th>
                  {kind !== 'manufacturers' && (
                    <th>
                      {kind === 'colors'
                        ? 'Material / manufacturer'
                        : 'Manufacturer'}
                    </th>
                  )}
                  {kind === 'colors' && <th>Thickness</th>}
                  {canManage && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {query.data.items.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <div className="cell-leading">
                        <span className="cell-icon">
                          <SwatchBook size={17} />
                        </span>
                        <strong>{row.name}</strong>
                      </div>
                    </td>
                    {kind !== 'manufacturers' && (
                      <td>
                        {row.parent}
                        {kind === 'colors' && <small>{row.manufacturer}</small>}
                      </td>
                    )}
                    {kind === 'colors' && (
                      <td>{Number(row.thickness).toFixed(3)} mm</td>
                    )}
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
        <CatalogEditor
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
function CatalogEditor({
  kind,
  row,
  close,
}: {
  kind: CatalogKind;
  row?: CatalogRow;
  close: () => void;
}) {
  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: row?.name ?? '',
      parentId: row?.parentId ?? '',
      thickness: row?.thickness ?? '',
    },
  });
  const values = useWatch({ control: form.control }) as z.infer<
    typeof formSchema
  >;
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: (data: z.infer<typeof formSchema>) =>
      saveCatalog(kind, row?.id, data),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: catalogKey }),
        client.invalidateQueries({ queryKey: ['stock-items'] }),
      ]);
      close();
    },
  });
  const parentKind = kind === 'colors' ? 'materials' : 'manufacturers';
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) close();
      }}
      title={`${row ? 'Edit' : 'Add'} ${kind === 'colors' ? 'color' : kind === 'materials' ? 'material' : 'manufacturer'}`}
    >
      <form onSubmit={form.handleSubmit((data) => mutation.mutate(data))}>
        <div className="stack">
          <TextField
            label={kind === 'colors' ? 'Color code' : 'Name'}
            value={values.name}
            onChange={(v) => form.setValue('name', v)}
            required
            maxLength={kind === 'colors' ? 10 : 120}
          />
          {kind !== 'manufacturers' && (
            <Lookup
              label={kind === 'colors' ? 'Material' : 'Manufacturer'}
              value={values.parentId}
              onChange={(v) => form.setValue('parentId', v)}
              selectedLabel={row?.parent}
              queryKey={[...catalogKey, parentKind]}
              load={async (search, page, signal) => {
                const data = await listCatalog(
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
          {kind === 'colors' && (
            <TextField
              label="Thickness (mm)"
              type="number"
              value={values.thickness}
              onChange={(v) => form.setValue('thickness', v)}
              required
              hint="Accurate to 0.001 mm."
            />
          )}
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

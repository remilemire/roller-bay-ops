'use client';
import { useState } from 'react';
import {
  useQuery,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Plus,
  Pencil,
  Trash2,
  MapPin,
  ChevronDown,
  ChevronRight,
  Layers,
  Folder,
} from 'lucide-react';
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
import styles from './locations-screen.module.css';
const formSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name or label.'),
  parentId: z.string(),
  sortOrder: z.string(),
});
type EditingLocation = {
  kind: LocationKind;
  row?: LocationRow;
  parent?: LocationRow;
};
const singular = { zones: 'zone', sections: 'section', levels: 'level' };
export function LocationsScreen() {
  const params = useListParams();
  const canManage = useCanManage();
  const [editing, setEditing] = useState<EditingLocation | null>(null);
  const [deleting, setDeleting] = useState<{
    kind: LocationKind;
    row: LocationRow;
  } | null>(null);
  const client = useQueryClient();
  const query = useQuery({
    queryKey: [...locationsKey, 'zones', params.search, params.page],
    queryFn: ({ signal }) =>
      listLocations('zones', params.search, params.page, signal),
  });
  const remove = useMutation({
    mutationFn: () => deleteLocation(deleting!.kind, deleting!.row.id),
    onSuccess: async () => {
      setDeleting(null);
      await client.invalidateQueries({ queryKey: locationsKey });
    },
  });
  const actions: TreeActions = {
    canManage,
    edit: setEditing,
    remove: (kind, row) => {
      remove.reset();
      setDeleting({ kind, row });
    },
  };
  return (
    <>
      <PageHeading title="Locations">
        {canManage && (
          <Button onClick={() => setEditing({ kind: 'zones' })}>
            <Plus size={17} />
            Add zone
          </Button>
        )}
      </PageHeading>
      <SearchToolbar
        key={params.search}
        search={params.search}
        onSearch={(search) => params.set({ search })}
        placeholder="Search zones…"
      />
      <section className="panel" aria-label="Location hierarchy">
        {query.isPending ? (
          <Loading />
        ) : query.error ? (
          <ErrorNotice error={query.error} retry={() => void query.refetch()} />
        ) : !query.data.items.length ? (
          <Empty title={params.search ? 'No matching zones' : 'No zones yet'}>
            Add a zone, then its sections and levels.
          </Empty>
        ) : (
          <ul className={styles.tree}>
            {query.data.items.map((row) => (
              <LocationNode
                key={row.id}
                kind="zones"
                row={row}
                actions={actions}
              />
            ))}
          </ul>
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
        <LocationEditor {...editing} close={() => setEditing(null)} />
      )}
      <Dialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setDeleting(null);
        }}
        title={`Delete ${deleting?.row.name ?? ''}?`}
        description="Records in use cannot be deleted."
      >
        {remove.error && <ErrorNotice error={remove.error} />}
        <div className="form-actions">
          <Button
            variant="outline"
            disabled={remove.isPending}
            onClick={() => setDeleting(null)}
          >
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
type TreeActions = {
  canManage: boolean;
  edit: (value: EditingLocation) => void;
  remove: (kind: LocationKind, row: LocationRow) => void;
};
function LocationNode({
  kind,
  row,
  actions,
}: {
  kind: LocationKind;
  row: LocationRow;
  actions: TreeActions;
}) {
  const [expanded, setExpanded] = useState(true);
  const childKind =
    kind === 'zones' ? 'sections' : kind === 'sections' ? 'levels' : null;
  const Icon =
    kind === 'zones' ? MapPin : kind === 'sections' ? Folder : Layers;
  const address = [row.parent, row.name].filter(Boolean).join(' / ');
  return (
    <li className={styles.node}>
      <div className={styles.row}>
        {childKind ? (
          <button
            className={styles.label}
            aria-label={`${row.name} ${singular[kind]}`}
            aria-expanded={expanded}
            aria-controls={`children-${row.id}`}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            <Icon size={18} />
            <strong>{row.name}</strong>
            <span className={styles.kind}>{singular[kind]}</span>
          </button>
        ) : (
          <div className={`${styles.label} ${styles.leaf}`}>
            <Icon size={18} />
            <strong>{row.name}</strong>
            <span className={styles.kind}>level</span>
          </div>
        )}
        {actions.canManage && (
          <div className={styles.actions}>
            {childKind && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setExpanded(true);
                  actions.edit({ kind: childKind, parent: row });
                }}
                aria-label={`Add ${singular[childKind]} to ${address}`}
              >
                <Plus size={15} />
                Add {singular[childKind]}
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Edit ${singular[kind]} ${address}`}
              onClick={() => actions.edit({ kind, row })}
            >
              <Pencil size={15} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Delete ${singular[kind]} ${address}`}
              onClick={() => actions.remove(kind, row)}
            >
              <Trash2 size={15} />
            </Button>
          </div>
        )}
      </div>
      {childKind && (
        <div
          id={`children-${row.id}`}
          hidden={!expanded}
          className={styles.children}
        >
          {expanded && (
            <LocationChildren kind={childKind} parent={row} actions={actions} />
          )}
        </div>
      )}
    </li>
  );
}
function LocationChildren({
  kind,
  parent,
  actions,
}: {
  kind: LocationKind;
  parent: LocationRow;
  actions: TreeActions;
}) {
  const query = useInfiniteQuery({
    queryKey: [...locationsKey, 'children', kind, parent.id],
    initialPageParam: 1,
    queryFn: ({ signal, pageParam }) =>
      listLocations(kind, '', pageParam, signal, parent.id),
    getNextPageParam: (last) =>
      last.page * last.pageSize < last.total ? last.page + 1 : undefined,
  });
  return (
    <>
      {query.isPending ? (
        <Loading />
      ) : (
        <>
          {query.error && (
            <ErrorNotice
              error={query.error}
              retry={() =>
                void (query.isFetchNextPageError
                  ? query.fetchNextPage()
                  : query.refetch())
              }
            />
          )}
          {query.data &&
            (query.data.pages[0]!.total === 0 ? (
              <p className={styles.empty}>No {kind} yet.</p>
            ) : (
              <ul className={styles.tree}>
                {query.data.pages
                  .flatMap((page) => page.items)
                  .map((row) => (
                    <LocationNode
                      key={row.id}
                      kind={kind}
                      row={row}
                      actions={actions}
                    />
                  ))}
              </ul>
            ))}
          {query.hasNextPage && (
            <Button
              variant="ghost"
              size="sm"
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {query.isFetchingNextPage ? 'Loading…' : `Load more ${kind}`}
            </Button>
          )}
        </>
      )}
    </>
  );
}
function LocationEditor({
  kind,
  row,
  close,
  parent,
}: {
  kind: LocationKind;
  row?: LocationRow;
  parent?: LocationRow;
  close: () => void;
}) {
  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: row?.name ?? '',
      parentId: row?.parentId ?? parent?.id ?? '',
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
          {parent && (
            <p>
              {kind === 'levels' ? 'Section' : 'Zone'}:{' '}
              {parent.parent ? `${parent.parent} / ` : ''}
              {parent.name}
            </p>
          )}
          {kind !== 'zones' && !row && !parent && (
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

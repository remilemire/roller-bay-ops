'use client';
import { useState } from 'react';
import {
  infiniteQueryOptions,
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
  Factory,
  Layers,
  SwatchBook,
  ChevronDown,
  ChevronRight,
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
} from '@/components/ui/feedback';
import { SearchToolbar } from '@/components/ui/search-toolbar';
import styles from '@/components/ui/tree.module.css';
import { useListParams } from '@/lib/use-list-params';
import { useCanManage } from '@/features/auth/auth-boundary';
import { useMeasurementUnits } from '@/features/users/use-measurement-units';
import type { ErrorIssue } from '@roller-bay/shared/errors';
import { issuePath } from '@/lib/errors';
import { showFieldIssues } from '@/lib/field-issues';
import {
  fieldInput,
  fieldLabel,
  fieldSuffix,
  fieldValue,
} from '@/lib/measurements';
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
type EditingCatalog = {
  kind: CatalogKind;
  row?: CatalogRow;
  parent?: CatalogRow;
};
const singular = {
  manufacturers: 'manufacturer',
  materials: 'material',
  colors: 'color',
};
const treeQuery = (kind: CatalogKind, parentId: string, search: string) =>
  infiniteQueryOptions({
    queryKey: [...catalogKey, 'tree', kind, parentId, search],
    initialPageParam: 1,
    queryFn: ({ signal, pageParam }) =>
      listCatalog(kind, search, pageParam, signal, parentId),
    getNextPageParam: (last) =>
      last.page * last.pageSize < last.total ? last.page + 1 : undefined,
  });
export function CatalogScreen() {
  const params = useListParams();
  const canManage = useCanManage();
  const [editing, setEditing] = useState<EditingCatalog | null>(null);
  const [deleting, setDeleting] = useState<{
    kind: CatalogKind;
    row: CatalogRow;
  } | null>(null);
  const client = useQueryClient();
  const query = useInfiniteQuery(treeQuery('manufacturers', '', params.search));
  const remove = useMutation({
    mutationFn: () => deleteCatalog(deleting!.kind, deleting!.row.id),
    onSuccess: async () => {
      setDeleting(null);
      await client.invalidateQueries({ queryKey: catalogKey });
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
      <PageHeading title="Fabric catalog">
        {canManage && (
          <Button onClick={() => setEditing({ kind: 'manufacturers' })}>
            <Plus size={17} />
            Add manufacturer
          </Button>
        )}
      </PageHeading>
      <SearchToolbar
        search={params.search}
        onSearch={(search) => params.set({ search })}
        placeholder="Search manufacturers…"
      />
      <section className="panel" aria-label="Catalog hierarchy">
        {query.isPending ? (
          <Loading />
        ) : query.error ? (
          <ErrorNotice error={query.error} retry={() => void query.refetch()} />
        ) : !query.data.pages[0]!.total ? (
          <Empty
            title={
              params.search
                ? 'No matching manufacturers'
                : 'No manufacturers yet'
            }
          >
            Add a manufacturer, then its materials and colors.
          </Empty>
        ) : (
          <CatalogTree
            kind="manufacturers"
            rows={query.data.pages.flatMap((page) => page.items)}
            actions={actions}
          />
        )}
        {query.hasNextPage && (
          <Button
            variant="ghost"
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {query.isFetchingNextPage ? 'Loading…' : 'Load more manufacturers'}
          </Button>
        )}
      </section>
      {editing && <CatalogEditor {...editing} close={() => setEditing(null)} />}
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
  edit: (value: EditingCatalog) => void;
  remove: (kind: CatalogKind, row: CatalogRow) => void;
};
function CatalogTree({
  kind,
  rows,
  actions,
}: {
  kind: CatalogKind;
  rows: CatalogRow[];
  actions: TreeActions;
}) {
  return (
    <ul className={styles.tree}>
      {rows.map((row) => (
        <CatalogNode key={row.id} kind={kind} row={row} actions={actions} />
      ))}
    </ul>
  );
}
function CatalogNode({
  kind,
  row,
  actions,
}: {
  kind: CatalogKind;
  row: CatalogRow;
  actions: TreeActions;
}) {
  const units = useMeasurementUnits();
  // Every open branch is a request on load and after each save. Materials
  // start closed so a full catalog stays well inside the API rate limit.
  const [expanded, setExpanded] = useState(kind === 'manufacturers');
  const childKind =
    kind === 'manufacturers'
      ? 'materials'
      : kind === 'materials'
        ? 'colors'
        : null;
  const Icon =
    kind === 'manufacturers'
      ? Factory
      : kind === 'materials'
        ? Layers
        : SwatchBook;
  const address = [kind === 'colors' && row.manufacturer, row.parent, row.name]
    .filter(Boolean)
    .join(' / ');
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
            <span className={styles.kind}>
              color
              {row.thicknessMm !== null &&
                ` · ${fieldLabel(units, 'thickness', row.thicknessMm)}`}
            </span>
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
            <CatalogChildren kind={childKind} parent={row} actions={actions} />
          )}
        </div>
      )}
    </li>
  );
}
function CatalogChildren({
  kind,
  parent,
  actions,
}: {
  kind: CatalogKind;
  parent: CatalogRow;
  actions: TreeActions;
}) {
  const query = useInfiniteQuery(treeQuery(kind, parent.id, ''));
  if (query.isPending) return <Loading />;
  return (
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
          <CatalogTree
            kind={kind}
            rows={query.data.pages.flatMap((page) => page.items)}
            actions={actions}
          />
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
  );
}
// Request-body keys, which differ by record kind, and the form fields that
// edit them.
const BODY_FIELDS = {
  name: 'name',
  code: 'name',
  materialId: 'parentId',
  manufacturerId: 'parentId',
  thicknessMm: 'thickness',
} as const;
const fieldName = (issue: ErrorIssue) =>
  BODY_FIELDS[issuePath(issue) as keyof typeof BODY_FIELDS] ?? null;
function CatalogEditor({
  kind,
  row,
  parent,
  close,
}: {
  kind: CatalogKind;
  row?: CatalogRow;
  parent?: CatalogRow;
  close: () => void;
}) {
  // Pin the units this form opened with: a session refetch must not relabel
  // or reinterpret dirty input.
  const liveUnits = useMeasurementUnits();
  const [units] = useState(liveUnits);
  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: row?.name ?? '',
      parentId: row?.parentId ?? parent?.id ?? '',
      thickness: fieldInput(units, 'thickness', row?.thicknessMm ?? null),
    },
  });
  const values = useWatch({ control: form.control }) as z.infer<
    typeof formSchema
  >;
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: (data: z.infer<typeof formSchema>) =>
      saveCatalog(kind, row?.id, {
        name: data.name,
        parentId: data.parentId,
        thicknessMm: fieldValue(units, 'thickness', data.thickness),
      }),
    onError: (error) => showFieldIssues(form, error, fieldName),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: catalogKey }),
        client.invalidateQueries({ queryKey: ['stock-items'] }),
      ]);
      close();
    },
  });
  const parentKind = kind === 'colors' ? 'materials' : 'manufacturers';
  const { errors } = form.formState;
  const set = (name: keyof z.infer<typeof formSchema>, value: string) => {
    form.setValue(name, value);
    form.clearErrors(name);
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) close();
      }}
      title={`${row ? 'Edit' : 'Add'} ${singular[kind]}`}
    >
      <form onSubmit={form.handleSubmit((data) => mutation.mutate(data))}>
        <div className="stack">
          <TextField
            label={kind === 'colors' ? 'Color code' : 'Name'}
            value={values.name}
            onChange={(v) => set('name', v)}
            error={errors.name?.message}
            required
            maxLength={kind === 'colors' ? 10 : 120}
          />
          {parent && (
            <p>
              {kind === 'colors' ? 'Material' : 'Manufacturer'}:{' '}
              {parent.parent ? `${parent.parent} / ` : ''}
              {parent.name}
            </p>
          )}
          {/* New records take the branch they were added from; existing
              ones can move, because the API accepts a new parent on PATCH. */}
          {kind !== 'manufacturers' && row && (
            <Lookup
              label={kind === 'colors' ? 'Material' : 'Manufacturer'}
              value={values.parentId}
              onChange={(v) => set('parentId', v)}
              error={errors.parentId?.message}
              selectedLabel={row.parent}
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
              label={`Thickness (${fieldSuffix(units, 'thickness')})`}
              type="number"
              value={values.thickness}
              onChange={(v) => set('thickness', v)}
              error={errors.thickness?.message}
              required
              hint="Stored to the nearest 0.001 mm."
            />
          )}
        </div>
        {mutation.error && (
          <ErrorNotice
            error={mutation.error}
            inline={(issue) => fieldName(issue) !== null}
          />
        )}
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

'use client';
import { useId, useState } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type KeyboardCoordinateGetter,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { CSS } from '@dnd-kit/utilities';
import {
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
  GripVertical,
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
import { useListParams } from '@/lib/use-list-params';
import { useCanManage } from '@/features/auth/auth-boundary';
import {
  locationsKey,
  listLocations,
  saveLocation,
  deleteLocation,
  moveLocation,
  type LocationKind,
  type LocationRow,
} from './locations.api';
import styles from './locations-screen.module.css';
const formSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name or label.'),
  parentId: z.string(),
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
  const query = useInfiniteQuery({
    queryKey: [...locationsKey, 'zones', params.search],
    initialPageParam: 1,
    queryFn: ({ signal, pageParam }) =>
      listLocations('zones', params.search, pageParam, signal),
    getNextPageParam: (last) =>
      last.page * last.pageSize < last.total ? last.page + 1 : undefined,
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
        ) : !query.data.pages[0]!.total ? (
          <Empty title={params.search ? 'No matching zones' : 'No zones yet'}>
            Add a zone, then its sections and levels.
          </Empty>
        ) : (
          <LocationTree
            kind="zones"
            rows={query.data.pages.flatMap((page) => page.items)}
            actions={actions}
            reorderDisabled={!!params.search || query.isFetching}
          />
        )}
        {params.search && canManage && (
          <p className={styles.empty}>Clear search to reorder zones.</p>
        )}
        {query.hasNextPage && (
          <Button
            variant="ghost"
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {query.isFetchingNextPage ? 'Loading…' : 'Load more zones'}
          </Button>
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
function LocationTree({
  kind,
  rows,
  actions,
  reorderDisabled,
}: {
  kind: LocationKind;
  rows: LocationRow[];
  actions: TreeActions;
  reorderDisabled: boolean;
}) {
  const id = useId();
  const client = useQueryClient();
  // Keep the gesture stable across background refetches and hold its final
  // position until the server's authoritative ordering has been refreshed.
  const [preview, setPreview] = useState<LocationRow[] | null>(null);
  const displayed = preview ?? rows;
  // Align centers explicitly: expanded branches can be much taller than their
  // siblings, so edge-based keyboard coordinates may never reach a new target.
  const keyboardCoordinates: KeyboardCoordinateGetter = (
    event,
    { context, currentCoordinates },
  ) => {
    if (event.code !== 'ArrowUp' && event.code !== 'ArrowDown') return;
    event.preventDefault();
    const { active, over, collisionRect, droppableRects } = context;
    if (!active || !collisionRect) return;
    const index = displayed.findIndex(
      (row) => row.id === (over?.id ?? active.id),
    );
    const next = displayed[index + (event.code === 'ArrowDown' ? 1 : -1)];
    const target = next && droppableRects.get(next.id);
    if (!target) return;
    return {
      x: currentCoordinates.x,
      y:
        currentCoordinates.y +
        target.top +
        target.height / 2 -
        collisionRect.top -
        collisionRect.height / 2,
    };
  };
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: keyboardCoordinates,
    }),
  );
  const mutation = useMutation({
    mutationFn: ({
      rowId,
      targetId,
      position,
    }: {
      rowId: string;
      targetId: string;
      position: 'before' | 'after';
    }) => moveLocation(kind, rowId, { targetId, position }),
    onSettled: async () => {
      await client.invalidateQueries({ queryKey: locationsKey });
      setPreview(null);
    },
  });
  const disabled = reorderDisabled || mutation.isPending;
  const finish = ({ active, over }: DragEndEvent) => {
    const from = displayed.findIndex((row) => row.id === active.id);
    const to = displayed.findIndex((row) => row.id === over?.id);
    if (from < 0 || to < 0 || from === to) {
      setPreview(null);
      return;
    }
    setPreview(arrayMove(displayed, from, to));
    mutation.mutate({
      rowId: String(active.id),
      targetId: String(over!.id),
      position: from < to ? 'after' : 'before',
    });
  };
  return (
    <>
      {mutation.error && <ErrorNotice error={mutation.error} />}
      <span className="sr-only" role="status">
        {mutation.isPending
          ? 'Saving order…'
          : mutation.isSuccess
            ? 'Order saved.'
            : ''}
      </span>
      <DndContext
        id={id}
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis]}
        accessibility={{
          screenReaderInstructions: {
            draggable:
              'Press Space to pick up this row, use Up and Down to move it, then Space to drop. Press Escape to cancel.',
          },
          announcements: {
            onDragStart: ({ active }) =>
              `Picked up ${rows.find((row) => row.id === active.id)?.name}.`,
            onDragOver: ({ over }) =>
              over
                ? `Position ${displayed.findIndex((row) => row.id === over.id) + 1} of ${displayed.length}.`
                : undefined,
            onDragEnd: ({ active }) =>
              `Dropped ${rows.find((row) => row.id === active.id)?.name}.`,
            onDragCancel: () => 'Reordering cancelled.',
          },
        }}
        onDragStart={() => {
          mutation.reset();
          setPreview(rows);
        }}
        onDragCancel={() => setPreview(null)}
        onDragEnd={finish}
      >
        <SortableContext
          items={displayed.map((row) => row.id)}
          strategy={verticalListSortingStrategy}
        >
          <ul className={styles.tree}>
            {displayed.map((row) => (
              <LocationNode
                key={row.id}
                kind={kind}
                row={row}
                actions={actions}
                reorderDisabled={disabled}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    </>
  );
}
function LocationNode({
  kind,
  row,
  actions,
  reorderDisabled,
}: {
  kind: LocationKind;
  row: LocationRow;
  actions: TreeActions;
  reorderDisabled: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const {
    setNodeRef,
    setActivatorNodeRef,
    isDragging,
    transform,
    transition,
    attributes,
    listeners,
  } = useSortable({
    id: row.id,
    disabled: reorderDisabled || !actions.canManage,
    transition: { duration: 240, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
  });
  const childKind =
    kind === 'zones' ? 'sections' : kind === 'sections' ? 'levels' : null;
  const Icon =
    kind === 'zones' ? MapPin : kind === 'sections' ? Folder : Layers;
  const address = [row.parent, row.name].filter(Boolean).join(' / ');
  return (
    <li
      ref={setNodeRef}
      className={`${styles.node} ${isDragging ? styles.dragging : ''}`}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
      }}
    >
      <div className={styles.row}>
        {actions.canManage && (
          <button
            ref={setActivatorNodeRef}
            type="button"
            className={styles.dragHandle}
            {...attributes}
            {...listeners}
            disabled={reorderDisabled}
            aria-label={`Reorder ${singular[kind]} ${address}`}
            title="Drag to reorder, or press Space and use the arrow keys"
          >
            <GripVertical size={17} />
          </button>
        )}
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
              <LocationTree
                kind={kind}
                rows={query.data.pages.flatMap((page) => page.items)}
                actions={actions}
                reorderDisabled={query.isFetching}
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

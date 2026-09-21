'use client';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Scissors } from 'lucide-react';
import { useState } from 'react';
import type { AllocationList } from '@roller-bay/shared/allocations';
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
import { useListParams } from '@/lib/use-list-params';
import { dateLabel, shortId } from '@/lib/format';
import {
  allocationKey,
  allocationList,
  cancelAllocation,
} from './allocations.api';

type AllocationRow = AllocationList['items'][number];

// Allocations open on the work in hand; `all` adds drafts and finished work.
const tabs = [
  { value: 'active', label: 'Active' },
  { value: 'draft', label: 'Drafts' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'all', label: 'All orders' },
];
export function AllocationListScreen() {
  const params = useListParams();
  const state = tabs.some((tab) => tab.value === params.get('state'))
    ? params.get('state')
    : 'active';
  const query = useQuery(
    allocationList({
      search: params.search,
      page: params.page,
      state: state === 'all' ? '' : state,
    }),
  );
  // Pin the row the dialog opened on; the revision the employee saw is the one
  // the cancellation is checked against.
  const [cancelling, setCancelling] = useState<AllocationRow | null>(null);
  const client = useQueryClient();
  const cancelMutation = useMutation({
    mutationFn: (item: AllocationRow) =>
      cancelAllocation(item.id, item.revision),
    onSuccess: async () => {
      setCancelling(null);
      await Promise.all([
        client.invalidateQueries({ queryKey: allocationKey }),
        client.invalidateQueries({ queryKey: ['stock-items'] }),
        // Cancelling returns the order to `new`.
        client.invalidateQueries({ queryKey: ['work-orders'] }),
      ]);
    },
  });
  const closeCancel = () => {
    setCancelling(null);
    cancelMutation.reset();
  };
  return (
    <>
      <PageHeading title="Allocations">
        <Button asChild>
          <Link href="/allocations/new">
            <Plus size={17} />
            New allocation
          </Link>
        </Button>
      </PageHeading>
      <SearchToolbar
        key={params.search}
        search={params.search}
        onSearch={(search) => params.set({ search })}
        placeholder="Search order number…"
      >
        <div className="tabs">
          {tabs.map((tab) => (
            <button
              key={tab.value}
              className={`tab ${state === tab.value ? 'active' : ''}`}
              onClick={() =>
                params.set({ state: tab.value === 'active' ? '' : tab.value })
              }
            >
              {tab.label}
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
          <Empty title="No allocations here yet">
            Start with the blinds your next order needs.
          </Empty>
        ) : (
          <div className="data-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Last updated</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {query.data.items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <Link
                        className="cell-leading"
                        href={`/allocations/${item.id}`}
                      >
                        <span className="cell-icon">
                          <Scissors size={17} />
                        </span>
                        <span>
                          <strong>
                            {item.orderNumber ?? 'Untitled allocation'}
                          </strong>
                          <small>{shortId(item.id)}</small>
                        </span>
                      </Link>
                    </td>
                    <td>{dateLabel(item.updatedAt)}</td>
                    <td>
                      <Status
                        value={
                          item.needsReplanning ? 'needs-replanning' : item.state
                        }
                      />
                    </td>
                    <td>
                      {item.state === 'active' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          // Every row has this button; name the order it acts on.
                          aria-label={`Cancel allocation ${item.orderNumber ?? shortId(item.id)}`}
                          onClick={() => setCancelling(item)}
                        >
                          Cancel allocation
                        </Button>
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
        open={!!cancelling}
        onOpenChange={(open) => !open && closeCancel()}
        title={
          cancelling
            ? `Cancel allocation ${cancelling.orderNumber ?? shortId(cancelling.id)}?`
            : 'Cancel allocation?'
        }
        description="The order stays in history and its reservations are released. No stock measurements are changed."
      >
        {cancelMutation.error && <ErrorNotice error={cancelMutation.error} />}
        <div className="form-actions">
          <Button
            variant="outline"
            onClick={closeCancel}
            disabled={cancelMutation.isPending}
          >
            Keep allocation
          </Button>
          <Button
            variant="destructive"
            onClick={() => cancelling && cancelMutation.mutate(cancelling)}
            disabled={cancelMutation.isPending}
          >
            Cancel allocation
          </Button>
        </div>
      </Dialog>
    </>
  );
}

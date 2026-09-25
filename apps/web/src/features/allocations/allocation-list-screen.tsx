'use client';
import Link from 'next/link';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Plus, Scissors } from 'lucide-react';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Button } from '@/components/ui/button';
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
import { allocationList } from './allocations.api';

// Allocations open on the work in hand; `all` adds drafts and finished work.
const tabs = [
  { value: 'active', label: 'Active' },
  { value: 'draft', label: 'Drafts' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'all', label: 'All allocations' },
];
export function AllocationListScreen() {
  const params = useListParams();
  const state = tabs.some((tab) => tab.value === params.get('state'))
    ? params.get('state')
    : 'active';
  const query = useQuery({
    ...allocationList({
      search: params.search,
      page: params.page,
      state: state === 'all' ? '' : state,
    }),
    // Keep the rows on screen while a search typed or a page turned loads.
    placeholderData: keepPreviousData,
  });
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
        search={params.search}
        onSearch={(search) => params.set({ search })}
        placeholder="Search order number…"
      >
        <SegmentedControl
          label="Allocation status"
          value={state}
          options={tabs}
          onChange={(value) =>
            params.set({ state: value === 'active' ? '' : value })
          }
        />
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
                  <th className="table-actions">Actions</th>
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
                    <td className="table-actions">
                      {item.state === 'active' && (
                        <Button asChild variant="ghost" size="sm">
                          <Link
                            href={`/allocations/${item.id}?action=record-cutting-results`}
                            aria-label={`Record cutting results for allocation ${item.orderNumber ?? shortId(item.id)}`}
                          >
                            Record cutting results
                          </Link>
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
    </>
  );
}

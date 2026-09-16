'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Plus, Scissors } from 'lucide-react';
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
export function AllocationListScreen() {
  const params = useListParams();
  const state = ['draft', 'active', 'completed', 'cancelled'].includes(
    params.get('state'),
  )
    ? params.get('state')
    : '';
  const query = useQuery(
    allocationList({ search: params.search, page: params.page, state }),
  );
  return (
    <>
      <PageHeading
        eyebrow="ON THE CUTTING FLOOR"
        title="Allocations"
        description="Plan the cuts. Reserve the fabric. Record what remains."
      >
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
          {[
            { value: '', label: 'All orders' },
            { value: 'active', label: 'Active' },
            { value: 'draft', label: 'Drafts' },
            { value: 'completed', label: 'Completed' },
            { value: 'cancelled', label: 'Cancelled' },
          ].map((tab) => (
            <button
              key={tab.value}
              className={`tab ${state === tab.value ? 'active' : ''}`}
              onClick={() => params.set({ state: tab.value })}
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
                  <th>Revision</th>
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
                    <td>{item.revision}</td>
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

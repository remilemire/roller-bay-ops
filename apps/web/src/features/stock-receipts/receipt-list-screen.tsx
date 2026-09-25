'use client';
import Link from 'next/link';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Plus, PackagePlus } from 'lucide-react';
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
import { receiptList } from './stock-receipts.api';
export function ReceiptListScreen() {
  const params = useListParams();
  const draft = params.get('state') === 'draft';
  const query = useQuery({
    ...receiptList({
      search: params.search,
      page: params.page,
      state: draft ? 'draft' : 'submitted',
    }),
    // Keep the rows on screen while a search typed or a page turned loads.
    placeholderData: keepPreviousData,
  });
  return (
    <>
      <PageHeading title="Stock receipts">
        <Button asChild>
          <Link href="/stock-receipts/new">
            <Plus size={17} />
            New receipt
          </Link>
        </Button>
      </PageHeading>
      <SearchToolbar
        search={params.search}
        onSearch={(search) => params.set({ search })}
        placeholder="Search purchase-order number…"
      >
        <SegmentedControl
          label="Receipt status"
          value={draft ? 'draft' : 'submitted'}
          options={[
            { value: 'submitted', label: 'Submitted' },
            { value: 'draft', label: 'Drafts' },
          ]}
          onChange={(value) =>
            params.set({ state: value === 'draft' ? 'draft' : null })
          }
        />
      </SearchToolbar>
      <section className="panel">
        {query.isPending ? (
          <Loading />
        ) : query.error ? (
          <ErrorNotice error={query.error} retry={() => void query.refetch()} />
        ) : !query.data.items.length ? (
          <Empty title={draft ? 'No unfinished receipts' : 'No receipts yet'}>
            Record your next fabric delivery to get started.
          </Empty>
        ) : (
          <div className="data-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Purchase order</th>
                  <th>{draft ? 'Last saved' : 'Submitted'}</th>
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
                        href={`/stock-receipts/${item.id}`}
                      >
                        <span className="cell-icon">
                          <PackagePlus size={17} />
                        </span>
                        <span>
                          <strong>
                            {item.purchaseOrderNumber ?? 'Untitled receipt'}
                          </strong>
                          <small>{shortId(item.id)}</small>
                        </span>
                      </Link>
                    </td>
                    <td>{dateLabel(item.submittedAt ?? item.updatedAt)}</td>
                    <td>
                      <Status value={item.state} />
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

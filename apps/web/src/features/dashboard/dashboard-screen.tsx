'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  Layers3,
  PackagePlus,
  Scissors,
  FilePenLine,
  Plus,
  ArrowRight,
} from 'lucide-react';
import { stockList } from '@/features/stock-items/stock-items.api';
import { receiptList } from '@/features/stock-receipts/stock-receipts.api';
import { allocationList } from '@/features/allocations/allocations.api';
import { Button } from '@/components/ui/button';
import {
  PageHeading,
  ErrorNotice,
  Empty,
  Loading,
  Status,
  TextLink,
} from '@/components/ui/feedback';
import { count, dateLabel } from '@/lib/format';
export function DashboardScreen() {
  const stock = useQuery(stockList({ pageSize: 1 }));
  const active = useQuery(allocationList({ state: 'active', pageSize: 5 }));
  const receiptDrafts = useQuery(receiptList({ state: 'draft', pageSize: 1 }));
  const allocationDrafts = useQuery(
    allocationList({ state: 'draft', pageSize: 1 }),
  );
  const receipts = useQuery(receiptList({ pageSize: 4 }));
  const stats = [
    {
      label: 'Stock items on hand',
      value: stock.data?.total,
      Icon: Layers3,
      error: stock.error,
      href: '/stock-items',
    },
    {
      label: 'Active allocations',
      value: active.data?.total,
      Icon: Scissors,
      error: active.error,
      href: '/allocations?state=active',
    },
    {
      label: 'Receipt drafts',
      value: receiptDrafts.data?.total,
      Icon: PackagePlus,
      error: receiptDrafts.error,
      href: '/stock-receipts?state=draft',
    },
    {
      label: 'Allocation drafts',
      value: allocationDrafts.data?.total,
      Icon: FilePenLine,
      error: allocationDrafts.error,
      href: '/allocations?state=draft',
    },
  ];
  return (
    <>
      <PageHeading title="Overview">
        <Button asChild variant="outline">
          <Link href="/allocations/new">
            <Scissors size={17} />
            New order
          </Link>
        </Button>
        <Button asChild>
          <Link href="/stock-receipts/new">
            <Plus size={17} />
            Receive fabric
          </Link>
        </Button>
      </PageHeading>
      <div className="stats-grid">
        {stats.map(({ label, value, Icon, error, href }) => (
          <Link href={href} className="panel stat" key={label}>
            <div className="stat-label">
              <span>{label}</span>
              <span className="stat-icon">
                <Icon size={17} />
              </span>
            </div>
            <div className="stat-value">
              {error ? '—' : value === undefined ? '…' : count(value)}
            </div>
            {error && (
              <div className="stat-note">Unable to load · open to retry</div>
            )}
          </Link>
        ))}
      </div>
      <div className="section-grid">
        <section className="panel">
          <div className="panel-heading">
            <h2>Active allocations</h2>
            <TextLink href="/allocations?state=active">View all</TextLink>
          </div>
          {active.isPending ? (
            <Loading label="Loading allocations…" />
          ) : active.error ? (
            <ErrorNotice
              error={active.error}
              retry={() => void active.refetch()}
            />
          ) : !active.data.items.length ? (
            <Empty title="No active allocations">
              Confirmed allocations will appear here.
            </Empty>
          ) : (
            <div className="data-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Created</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {active.data.items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <Link
                          className="cell-leading"
                          href={`/allocations/${item.id}`}
                        >
                          <span className="cell-icon">
                            <Scissors size={16} />
                          </span>
                          <strong>{item.orderNumber}</strong>
                        </Link>
                      </td>
                      <td>{dateLabel(item.createdAt)}</td>
                      <td>
                        <Status
                          value={
                            item.needsReplanning
                              ? 'needs-replanning'
                              : item.state
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <section className="panel">
          <div className="panel-heading">
            <h2>Recent receipts</h2>
            <TextLink href="/stock-receipts">All receipts</TextLink>
          </div>
          {receipts.isPending ? (
            <Loading label="Loading receipts…" />
          ) : receipts.error ? (
            <ErrorNotice error={receipts.error} />
          ) : !receipts.data.items.length ? (
            <Empty title="No stock receipts">
              Submitted receipts will appear here.
            </Empty>
          ) : (
            <div>
              {receipts.data.items.map((item) => (
                <Link
                  href={`/stock-receipts/${item.id}`}
                  key={item.id}
                  className="arrival-row"
                >
                  <span className="cell-icon">
                    <PackagePlus size={17} />
                  </span>
                  <span>
                    <strong>{item.purchaseOrderNumber}</strong>
                    <small>
                      {item.submittedAt ? dateLabel(item.submittedAt) : 'Draft'}
                    </small>
                  </span>
                  <ArrowRight size={16} />
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}

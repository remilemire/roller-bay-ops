'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowUpRight,
  Layers3,
  PackagePlus,
  Scissors,
  FilePenLine,
  MapPin,
  Plus,
  ArrowRight,
} from 'lucide-react';
import { useCurrentUser } from '@/features/auth/auth-boundary';
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
  const user = useCurrentUser();
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
      note: 'Rolls and retained remnants',
      error: stock.error,
      href: '/stock-items',
    },
    {
      label: 'Active allocations',
      value: active.data?.total,
      Icon: Scissors,
      note: 'Orders reserved for production',
      error: active.error,
      href: '/allocations?state=active',
    },
    {
      label: 'Receipt drafts',
      value: receiptDrafts.data?.total,
      Icon: PackagePlus,
      note: 'Ready for your team to resume',
      error: receiptDrafts.error,
      href: '/stock-receipts?state=draft',
    },
    {
      label: 'Allocation drafts',
      value: allocationDrafts.data?.total,
      Icon: FilePenLine,
      note: 'Plans taking shape',
      error: allocationDrafts.error,
      href: '/allocations?state=draft',
    },
  ];
  return (
    <>
      <PageHeading
        eyebrow="A LITTLE CLARITY FOR YOUR DAY"
        title={`Welcome back, ${user.name.split(' ')[0]}.`}
        description="Here’s what’s happening across your workspace."
      >
        <Button asChild>
          <Link href="/stock-receipts/new">
            <Plus size={17} />
            Receive fabric
          </Link>
        </Button>
      </PageHeading>
      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow">FROM THE SHELF TO THE CUTTING TABLE</div>
          <h2>
            The right fabric.
            <br />
            Right where you need it.
          </h2>
          <p>
            Turn an order into a cutting plan, with your available stock in
            view.
          </p>
          <TextLink href="/allocations/new">Plan an allocation</TextLink>
        </div>
        <div className="hero-art" aria-hidden="true">
          <span className="fabric-roll" />
          <span className="fabric-roll" />
          <span className="fabric-roll" />
        </div>
      </section>
      <div className="stats-grid">
        {stats.map(({ label, value, Icon, note, error, href }) => (
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
            <div className="stat-note">
              {error ? 'Unable to load · open to retry' : note}
            </div>
          </Link>
        ))}
      </div>
      <div className="section-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>In production</h2>
              <p>Your most recent active allocations</p>
            </div>
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
            <Empty title="A clear cutting table">
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
        <div className="stack">
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Make your next move</h2>
                <p>Everyday workflows, one click away</p>
              </div>
              <ArrowUpRight size={19} />
            </div>
            <div className="panel-body quick-actions">
              {[
                {
                  href: '/stock-receipts/new',
                  title: 'Receive fabric',
                  note: 'Log an arrival',
                  Icon: PackagePlus,
                },
                {
                  href: '/allocations/new',
                  title: 'Plan an order',
                  note: 'Find the best fit',
                  Icon: Scissors,
                },
                {
                  href: '/stock-items',
                  title: 'Find fabric',
                  note: 'Explore your stock',
                  Icon: Layers3,
                },
                {
                  href: '/locations',
                  title: 'Find a location',
                  note: 'Know where to look',
                  Icon: MapPin,
                },
              ].map(({ href, title, note, Icon }) => (
                <Link key={href} href={href} className="quick-action">
                  <Icon size={20} />
                  <span>
                    <strong>{title}</strong>
                    <small>{note}</small>
                  </span>
                </Link>
              ))}
            </div>
          </section>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Recent arrivals</h2>
                <p>Latest submitted stock receipts</p>
              </div>
              <TextLink href="/stock-receipts">All receipts</TextLink>
            </div>
            {receipts.isPending ? (
              <Loading label="Loading receipts…" />
            ) : receipts.error ? (
              <ErrorNotice error={receipts.error} />
            ) : !receipts.data.items.length ? (
              <Empty title="Room for your first arrival">
                Received deliveries will appear here.
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
                        {item.submittedAt
                          ? dateLabel(item.submittedAt)
                          : 'Draft'}
                      </small>
                    </span>
                    <ArrowRight size={16} />
                  </Link>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

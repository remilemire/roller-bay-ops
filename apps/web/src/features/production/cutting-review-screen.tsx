'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { ErrorNotice, Loading, PageHeading } from '@/components/ui/feedback';
import { dateTimeLabel } from '@/lib/format';
import { worksheets, employeeNames } from './production.api';

export function CuttingReviewScreen() {
  const query = useQuery(worksheets());
  return (
    <div className="stack">
      <PageHeading title="Review cutting results">
        <Button asChild variant="outline">
          <Link href="/stations">Back to stations</Link>
        </Button>
      </PageHeading>
      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        <ErrorNotice error={query.error} retry={() => void query.refetch()} />
      ) : (
        <section className="panel">
          <div className="data-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Cutters</th>
                  <th>Started</th>
                  <th>Results</th>
                  <th className="table-actions">Action</th>
                </tr>
              </thead>
              <tbody>
                {query.data.map((s) => (
                  <tr key={s.id}>
                    <td>
                      {s.orderNumber}
                      {s.isRecut ? ' · Recut' : ''}
                    </td>
                    <td className="table-cell-wrap">
                      {employeeNames(s.employees)}
                    </td>
                    <td>{dateTimeLabel(s.startedAt)}</td>
                    <td>{s.submittedAt ? 'Awaiting review' : 'Incomplete'}</td>
                    <td className="table-actions">
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/stations/review/${s.id}`}>Open</Link>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!query.data.length && (
              <p className="panel-body">No cutting results awaiting review.</p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

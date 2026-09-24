'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { historySchema, type AuditRecordType } from '@roller-bay/shared/audit';
import { api } from '@/lib/api';
import { dateTimeLabel, shortId } from '@/lib/format';
import { useMeasurementUnits } from '@/features/users';
import { Loading, ErrorNotice, Pagination } from '@/components/ui/feedback';
import { RecordValues } from '@/components/records/record-values';
function AuditTime({ value }: { value: string }) {
  return <time dateTime={value}>{dateTimeLabel(value)}</time>;
}
export function History({ type, id }: { type: AuditRecordType; id: string }) {
  const [page, setPage] = useState(1);
  const units = useMeasurementUnits();
  const query = useQuery({
    queryKey: ['history', type, id, page],
    queryFn: ({ signal }) =>
      api(`/${type}/${id}/history?page=${page}`, historySchema, { signal }),
  });
  return (
    <section className="panel history no-print">
      <div className="panel-heading">
        <h2>History</h2>
      </div>
      <div className="panel-body">
        {query.isPending ? (
          <Loading />
        ) : query.error ? (
          <ErrorNotice error={query.error} retry={() => void query.refetch()} />
        ) : (
          <>
            {!query.data?.items.length && (
              <p className="muted">
                No recorded history. Changes made before audit tracking began
                are not available.
              </p>
            )}
            {query.data?.items.map((event) => (
              <details key={event.id}>
                <summary>
                  {event.action.replaceAll('.', ' · ').replaceAll('-', ' ')} —{' '}
                  {event.actorName} · <AuditTime value={event.createdAt} />
                </summary>
                {event.reason && (
                  <p>
                    <strong>Reason:</strong> {event.reason}
                  </p>
                )}
                {event.changes
                  .filter((c) => c.recordType === type && c.recordId === id)
                  .map((change, i) => (
                    <div key={i} className="audit-change">
                      <div>
                        <h3>Before</h3>
                        <RecordValues
                          units={units}
                          value={change.before?.value}
                        />
                      </div>
                      <div>
                        <h3>After</h3>
                        <RecordValues
                          units={units}
                          value={change.after?.value}
                        />
                      </div>
                    </div>
                  ))}
                {event.changes.length > 1 && (
                  <details>
                    <summary>Related records</summary>
                    <ul>
                      {event.changes
                        .filter((c) => c.recordId !== id)
                        .map((c) => (
                          <li key={`${c.recordType}:${c.recordId}`}>
                            <Link href={`/${c.recordType}/${c.recordId}`}>
                              {c.recordType} · {shortId(c.recordId)}
                            </Link>
                          </li>
                        ))}
                    </ul>
                  </details>
                )}
              </details>
            ))}
          </>
        )}
      </div>
      {query.data && (
        <Pagination page={page} total={query.data.total} onPage={setPage} />
      )}
    </section>
  );
}

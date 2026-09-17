'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { historySchema, type AuditRecordType } from '@roller-bay/shared/audit';
import type { MeasurementField } from '@roller-bay/shared/users';
import { api } from '@/lib/api';
import { useHydrated } from '@/lib/use-hydrated';
import { dateLabel, shortId } from '@/lib/format';
import { fieldLabel } from '@/lib/measurements';
import { useMeasurementUnits } from '@/features/users/use-measurement-units';
import { Loading, ErrorNotice, Pagination } from '@/components/ui/feedback';
const measurements: Record<string, MeasurementField> = {
  widthMm: 'rollWidth',
  lengthMm: 'rollLength',
  initialLengthMm: 'rollLength',
  explicitLengthMm: 'rollLength',
  remainingLengthMm: 'rollLength',
  radialDepthMm: 'radialDepth',
  tubeOuterDiameterMm: 'tubeDiameter',
  measurementThicknessMm: 'thickness',
  reservedLengthMm: 'rollLength',
  lengthAllowanceMm: 'dropAllowance',
  edgeTrimMm: 'edgeTrim',
  minimumRemnantWidthMm: 'minimumRemnantWidth',
  minimumRemnantLengthMm: 'minimumRemnantLength',
};
const labels: Record<string, string> = {
  fabricColorId: 'Fabric',
  locationId: 'Location',
  initialLengthMm: 'Initial length',
  explicitLengthMm: 'Measured length',
  radialDepthMm: 'Radial depth',
  tubeOuterDiameterMm: 'Tube outer diameter',
  measurementThicknessMm: 'Thickness used',
  widthMm: 'Width',
  lengthMm: 'Length',
  remainingLengthMm: 'Remaining length',
  purchaseOrderNumber: 'Purchase order',
  orderNumber: 'Production order',
  voidedAt: 'Voided',
  consumedAt: 'Consumed',
  sourceStockItemId: 'Source stock',
  stockItemId: 'Stock item',
  isUsed: 'Previously used',
  isRemnant: 'Remnant',
};
export function RecordValues({
  value,
  field = '',
  referenceLabels = {},
  section = '',
}: {
  value: unknown;
  field?: string;
  section?: string;
  referenceLabels?: Record<string, string>;
}) {
  const units = useMeasurementUnits();
  const measurement =
    section === 'requirements' && field === 'widthMm'
      ? 'blindWidth'
      : section === 'requirements' && field === 'lengthMm'
        ? 'finishedDrop'
        : section === 'drops' && field === 'lengthMm'
          ? 'dropLength'
          : measurements[field];
  if (value === null || value === undefined) return <span>—</span>;
  if (typeof value === 'number')
    return (
      <span>{measurement ? fieldLabel(units, measurement, value) : value}</span>
    );
  if (typeof value === 'boolean') return <span>{value ? 'Yes' : 'No'}</span>;
  if (typeof value === 'string') {
    if (referenceLabels[value])
      return <span title={value}>{referenceLabels[value]}</span>;
    if (field === 'stockItemId' || field === 'sourceStockItemId')
      return <Link href={`/stock-items/${value}`}>{shortId(value)}</Link>;
    if (field.endsWith('Id') || field === 'id')
      return <span title={value}>{shortId(value)}</span>;
    if (field.endsWith('At') && value) return <span>{dateLabel(value)}</span>;
    return (
      <span>
        {['returned-roll', 'returned-remnant'].includes(value)
          ? value.replaceAll('-', ' ')
          : value}
      </span>
    );
  }
  if (Array.isArray(value))
    return (
      <ol>
        {value.map((v, i) => (
          <li key={i}>
            <RecordValues
              section={section}
              referenceLabels={referenceLabels}
              value={v}
            />
          </li>
        ))}
      </ol>
    );
  return (
    <dl className="audit-values">
      {Object.entries(value)
        .filter(
          ([k]) =>
            ![
              'revision',
              'expectedRevision',
              'expectedUpdatedAt',
              'updatedAt',
              'createdAt',
              'createdByUserId',
              'submittedByUserId',
              'stockVersions',
              'stockEffects',
              'idempotencyKey',
            ].includes(k),
        )
        .map(([k, v]) => (
          <div key={k}>
            <dt className="detail-label">
              {labels[k] ??
                k
                  .replace(/([A-Z])/g, ' $1')
                  .replace(/^./, (s) => s.toUpperCase())}
            </dt>
            <dd style={{ margin: 0 }}>
              <RecordValues
                referenceLabels={referenceLabels}
                value={v}
                field={k}
                section={['requirements', 'drops'].includes(k) ? k : section}
              />
            </dd>
          </div>
        ))}
    </dl>
  );
}
function AuditTime({ value }: { value: string }) {
  const hydrated = useHydrated();
  return (
    <time dateTime={value}>
      {hydrated
        ? new Intl.DateTimeFormat(undefined, {
            dateStyle: 'medium',
            timeStyle: 'short',
          }).format(new Date(value))
        : value}
    </time>
  );
}
export function History({ type, id }: { type: AuditRecordType; id: string }) {
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ['history', type, id, page],
    queryFn: ({ signal }) =>
      api(`/${type}/${id}/history?page=${page}`, historySchema, { signal }),
  });
  return (
    <section className="panel no-print">
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
                    <div key={i} className="details-grid">
                      <div>
                        <h3>Before</h3>
                        <RecordValues value={change.before?.value} />
                      </div>
                      <div>
                        <h3>After</h3>
                        <RecordValues value={change.after?.value} />
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
            {query.data && (
              <Pagination
                page={page}
                total={query.data.total}
                onPage={setPage}
              />
            )}
          </>
        )}
      </div>
    </section>
  );
}

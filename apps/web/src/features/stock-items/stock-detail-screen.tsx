'use client';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Pencil, Trash2 } from 'lucide-react';
import { useCanManage } from '@/features/auth';
import { useMeasurementUnits } from '@/features/users';
import { Button } from '@/components/ui/button';
import {
  PageHeading,
  ErrorNotice,
  Loading,
  Status,
} from '@/components/ui/feedback';
import { dateLabel, shortId } from '@/lib/format';
import { InfoTip } from '@/components/ui/info-tip';
import { fieldLabel, measurementHelp } from '@/lib/measurements';
import { stockDetail } from './stock-items.api';
import { StockCorrectionEditor } from './stock-correction-editor';
/** `history` is the stock item's audit history, composed by the route. */
export function StockDetailScreen({
  id,
  history,
}: {
  id: string;
  history: ReactNode;
}) {
  const query = useQuery(stockDetail(id));
  const admin = useCanManage();
  const units = useMeasurementUnits();
  const [edit, setEdit] = useState(false);
  const [remove, setRemove] = useState(false);
  if (query.isPending) return <Loading />;
  if (!query.data)
    return (
      <ErrorNotice error={query.error} retry={() => void query.refetch()} />
    );
  const item = query.data;
  const details: [label: string, value: string, help?: string][] = [
    ['Width', fieldLabel(units, 'rollWidth', item.widthMm)],
    [
      'Remaining length',
      fieldLabel(units, 'rollLength', item.remainingLengthMm),
    ],
    ['Initial length', fieldLabel(units, 'rollLength', item.initialLengthMm)],
    [
      'Location',
      `${item.zoneName} / ${item.sectionLabel} / ${item.locationLabel}`,
    ],
    ['Manufacturer', item.manufacturerName],
    ['Material', item.materialName],
    [
      'Tube outer diameter',
      item.tubeOuterDiameterMm === null
        ? 'Not measured'
        : fieldLabel(units, 'tubeDiameter', item.tubeOuterDiameterMm),
      measurementHelp.tubeDiameter,
    ],
    [
      'Radial depth',
      item.radialDepthMm === null
        ? 'Not measured'
        : fieldLabel(units, 'radialDepth', item.radialDepthMm),
      measurementHelp.radialDepth,
    ],
    ['Created', dateLabel(item.createdAt)],
  ];
  return (
    <>
      {query.error && (
        <ErrorNotice error={query.error} retry={() => void query.refetch()} />
      )}
      <PageHeading
        eyebrow={`STOCK ITEM · ${shortId(item.id)}`}
        title={item.fabricColorCode}
        description={item.id}
      >
        {admin && !item.voidedAt && (
          <>
            <Button variant="outline" onClick={() => setRemove(true)}>
              <Trash2 size={16} />
              Void record
            </Button>
            <Button onClick={() => setEdit(true)}>
              <Pencil size={16} />
              Correct stock
            </Button>
          </>
        )}
      </PageHeading>
      <section className="panel">
        <div className="panel-heading">
          <h2>Fabric details</h2>
          <Status
            value={
              item.voidedAt
                ? 'voided'
                : item.consumedAt
                  ? 'consumed'
                  : item.isRemnant
                    ? 'remnant'
                    : item.isUsed
                      ? 'used-roll'
                      : 'new-roll'
            }
          />
        </div>
        <div className="panel-body stack">
          <div className="details-grid">
            {details.map(([label, value, help]) => (
              <div key={label}>
                <div className="detail-label">
                  {label}
                  {help && <InfoTip text={help} />}
                </div>
                <div className="detail-value">{value}</div>
              </div>
            ))}
          </div>
          {item.sourceStockItemId && (
            <p className="muted">
              Created from{' '}
              <Link
                className="text-link"
                href={`/stock-items/${item.sourceStockItemId}`}
              >
                {shortId(item.sourceStockItemId)}
              </Link>
            </p>
          )}
          <p className="muted">
            Remaining roll length is calculated from its measurements.
            Reservations are managed through allocations.
          </p>
        </div>
      </section>
      {history}
      {edit && (
        <StockCorrectionEditor item={item} close={() => setEdit(false)} />
      )}
      {remove && (
        <StockCorrectionEditor
          item={item}
          voiding
          close={() => setRemove(false)}
        />
      )}
    </>
  );
}

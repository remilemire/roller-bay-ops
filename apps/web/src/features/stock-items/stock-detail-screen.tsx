'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Pencil, Trash2 } from 'lucide-react';
import { useCanManage } from '@/features/auth/auth-boundary';
import { useMeasurementUnits } from '@/features/users/use-measurement-units';
import { Button } from '@/components/ui/button';
import {
  PageHeading,
  ErrorNotice,
  Loading,
  Status,
} from '@/components/ui/feedback';
import { dateLabel, shortId } from '@/lib/format';
import { fieldLabel } from '@/lib/measurements';
import { stockDetail } from './stock-items.api';
import { StockCorrectionEditor } from './stock-correction-editor';
import { History } from '@/features/audit/history';
export function StockDetailScreen({ id }: { id: string }) {
  const query = useQuery(stockDetail(id));
  const admin = useCanManage();
  const units = useMeasurementUnits();
  const [edit, setEdit] = useState(false);
  const [remove, setRemove] = useState(false);
  if (query.isPending) return <Loading />;
  if (!query.data) return <ErrorNotice error={query.error} />;
  const item = query.data;
  const details = [
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
    ],
    [
      'Radial depth',
      item.radialDepthMm === null
        ? 'Not measured'
        : fieldLabel(units, 'radialDepth', item.radialDepthMm),
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
        <div className="panel-body">
          <div className="details-grid">
            {details.map(([label, value]) => (
              <div key={label}>
                <div className="detail-label">{label}</div>
                <div className="detail-value">{value}</div>
              </div>
            ))}
          </div>
          {item.sourceStockItemId && (
            <p className="muted" style={{ marginTop: 24 }}>
              Created from{' '}
              <Link
                className="text-link"
                href={`/stock-items/${item.sourceStockItemId}`}
              >
                {shortId(item.sourceStockItemId)}
              </Link>
            </p>
          )}
          <p className="muted" style={{ marginTop: 24 }}>
            Remaining roll length is calculated from its measurements.
            Reservations are managed through allocations.
          </p>
        </div>
      </section>
      <History type="stock-items" id={id} />
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

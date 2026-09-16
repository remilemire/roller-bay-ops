'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Trash2 } from 'lucide-react';
import { useCanManage } from '@/features/auth/auth-boundary';
import { useMeasurementUnits } from '@/features/users/use-measurement-units';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import {
  PageHeading,
  ErrorNotice,
  Loading,
  Status,
} from '@/components/ui/feedback';
import { dimension, dateLabel, shortId } from '@/lib/format';
import { fieldLabel } from '@/lib/measurements';
import { stockDetail, deleteStock, stockKey } from './stock-items.api';
import { StockEditor } from './stock-editor';
export function StockDetailScreen({ id }: { id: string }) {
  const query = useQuery(stockDetail(id));
  const admin = useCanManage();
  const units = useMeasurementUnits();
  const client = useQueryClient();
  const router = useRouter();
  const [edit, setEdit] = useState(false);
  const [remove, setRemove] = useState(false);
  const deletion = useMutation({
    mutationFn: () => deleteStock(id),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: stockKey });
      router.push('/stock-items');
    },
  });
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
        : dimension(item.tubeOuterDiameterMm),
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
        {admin && (
          <>
            <Button variant="outline" onClick={() => setRemove(true)}>
              <Trash2 size={16} />
              Delete
            </Button>
            <Button onClick={() => setEdit(true)}>
              <Pencil size={16} />
              Edit stock
            </Button>
          </>
        )}
      </PageHeading>
      <section className="panel">
        <div className="panel-heading">
          <h2>Fabric details</h2>
          <Status
            value={
              item.consumedAt
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
      {edit && <StockEditor item={item} close={() => setEdit(false)} />}
      <Dialog
        open={remove}
        onOpenChange={setRemove}
        title="Delete this stock item?"
        description="Linked stock cannot be deleted. Mark used-up fabric as consumed to keep its history."
      >
        {deletion.error && <ErrorNotice error={deletion.error} />}
        <div className="form-actions">
          <Button variant="outline" onClick={() => setRemove(false)}>
            Keep stock
          </Button>
          <Button
            variant="destructive"
            disabled={deletion.isPending}
            onClick={() => deletion.mutate()}
          >
            Delete stock
          </Button>
        </div>
      </Dialog>
    </>
  );
}

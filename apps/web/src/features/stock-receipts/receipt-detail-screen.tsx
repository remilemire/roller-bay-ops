'use client';
import { useCanManage } from '@/features/auth';
import { Button } from '@/components/ui/button';
import { ReceiptCorrectionEditor } from './receipt-correction-editor';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { z } from 'zod';
import { stockReceiptRecordSchema } from '@roller-bay/shared/stock-receipts';
import { useQuery } from '@tanstack/react-query';
import { receiptDetail } from './stock-receipts.api';
import { ReceiptEditor } from './receipt-editor';
import {
  ErrorNotice,
  Loading,
  PageHeading,
  Status,
} from '@/components/ui/feedback';
import { dateLabel, shortId } from '@/lib/format';
import { fieldLabel } from '@/lib/measurements';
import { useMeasurementUnits } from '@/features/users';
/** `history` is the receipt's audit history, composed by the route. */
export function ReceiptDetailScreen({
  id,
  history,
}: {
  id: string;
  history: ReactNode;
}) {
  const query = useQuery(receiptDetail(id));
  if (query.isPending) return <Loading />;
  if (!query.data)
    return (
      <ErrorNotice error={query.error} retry={() => void query.refetch()} />
    );
  return (
    <>
      {query.error && (
        <ErrorNotice error={query.error} retry={() => void query.refetch()} />
      )}
      <ReceiptRecord key={id} receipt={query.data} history={history} />
    </>
  );
}
function ReceiptRecord({
  receipt,
  history,
}: {
  receipt: z.infer<typeof stockReceiptRecordSchema>;
  history: ReactNode;
}) {
  const units = useMeasurementUnits();
  const admin = useCanManage();
  const [correcting, setCorrecting] = useState(false);
  // A background submission by another employee must not unmount unsaved input.
  const [draft, setDraft] = useState(
    receipt.state === 'draft' ? receipt : null,
  );
  if (draft)
    return (
      <>
        <ReceiptEditor initial={draft} onSubmitted={() => setDraft(null)} />
        {history}
      </>
    );
  if (receipt.state === 'draft') return <Loading />;
  return (
    <>
      <PageHeading
        eyebrow="RECEIVED FABRIC"
        title={receipt.purchaseOrderNumber}
        description={`Submitted ${dateLabel(receipt.submittedAt)} · ${shortId(receipt.id)}`}
      >
        <Status value="submitted" />
        {admin && (
          <Button onClick={() => setCorrecting(true)}>Correct receipt</Button>
        )}
      </PageHeading>
      <section className="panel">
        <div className="panel-heading">
          <h2>
            {receipt.items
              .filter((i) => !i.voidedAt)
              .reduce((sum, i) => sum + i.quantity, 0)}{' '}
            rolls received
          </h2>
        </div>
        <div className="data-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Fabric</th>
                <th>Width</th>
                <th>Received length</th>
                <th>Quantity</th>
                <th>Stock items</th>
              </tr>
            </thead>
            <tbody>
              {receipt.items.map((line) => (
                <tr key={line.id}>
                  <td>
                    {line.stockItems[0]?.fabricColorCode ?? line.fabricColorId}
                  </td>
                  <td>{fieldLabel(units, 'rollWidth', line.widthMm)}</td>
                  <td>
                    {fieldLabel(units, 'rollLength', line.initialLengthMm)}
                  </td>
                  <td>{line.voidedAt ? 'Voided' : line.quantity}</td>
                  <td>
                    <div className="inline-actions">
                      {line.stockItemIds.map((stock) => (
                        <Link
                          key={stock}
                          className="text-link"
                          href={`/stock-items/${stock}`}
                        >
                          {shortId(stock)}
                        </Link>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {history}
      {correcting && (
        <ReceiptCorrectionEditor
          id={receipt.id}
          close={() => setCorrecting(false)}
        />
      )}
    </>
  );
}

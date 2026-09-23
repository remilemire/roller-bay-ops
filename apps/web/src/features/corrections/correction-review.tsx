import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  stockCorrectionSchema,
  stockVoidSchema,
  receiptCorrectionSchema,
  completionCorrectionSchema,
} from '@roller-bay/shared/corrections';
import { RecordValues } from '@/features/audit/history';
import { shortId } from '@/lib/format';
const stockLink = (id: string) => (
  <Link className="text-link" href={`/stock-items/${id}`}>
    {shortId(id)}
  </Link>
);
export function CorrectionReview({ value }: { value: unknown }) {
  const client = useQueryClient();
  // Lookup labels are already loaded by the form. Keep the ID as a fallback.
  const options = z.object({
    items: z.array(z.object({ id: z.string(), label: z.string() })),
  });
  const labels = Object.fromEntries(
    client
      .getQueryCache()
      .findAll({ predicate: (query) => query.queryKey.includes('lookup') })
      .flatMap((query) => {
        const result = options.safeParse(query.state.data);
        return result.success
          ? result.data.items.map((item) => [item.id, item.label])
          : [];
      }),
  );
  const stock = stockCorrectionSchema.safeParse(value);
  if (stock.success)
    return (
      <div className="stack">
        <p>
          <strong>Reason:</strong> {stock.data.reason}
        </p>
        <h4>Corrected stock values</h4>
        <RecordValues referenceLabels={labels} value={stock.data.changes} />
      </div>
    );
  const cutting = completionCorrectionSchema.safeParse(value);
  if (cutting.success)
    return (
      <div className="stack">
        <p>
          <strong>Reason:</strong> {cutting.data.reason}
        </p>
        {cutting.data.unusedStockItemIds.map((id) => (
          <section key={id}>
            <h4>Mark unused · {stockLink(id)}</h4>
            <p>
              Restore the stock record from before this result and void any
              retained pieces recorded from it.
            </p>
          </section>
        ))}
        {cutting.data.additionalItems.map((item) => (
          <section key={item.stockItemId}>
            <h4>Add actual usage · {stockLink(item.stockItemId)}</h4>
            <RecordValues
              referenceLabels={labels}
              value={Object.fromEntries(
                Object.entries(item).filter(
                  ([key]) => !['stockItemId', 'expectedRevision'].includes(key),
                ),
              )}
            />
          </section>
        ))}
        {cutting.data.items.map((item) => {
          const removed = item.removeRetainedPieceIds;
          const stockItemId = item.outcome.stockItemId;
          const outcome = Object.fromEntries(
            Object.entries(item.outcome).filter(
              ([key]) =>
                !['stockItemId', 'expectedRevision', 'scraps'].includes(key),
            ),
          );
          return (
            <section className="stack" key={stockItemId}>
              <h4>Cutting result · {stockLink(stockItemId)}</h4>
              <RecordValues referenceLabels={labels} value={outcome} />
              {item.retainedPieces.map((piece, index) => (
                <div key={piece.id ?? index}>
                  <strong>
                    {piece.id ? (
                      <>Keep piece {stockLink(piece.id)}</>
                    ) : (
                      'Create new piece'
                    )}
                  </strong>
                  <RecordValues
                    referenceLabels={labels}
                    value={{
                      widthMm: piece.widthMm,
                      lengthMm: piece.lengthMm,
                      locationId: piece.locationId,
                    }}
                  />
                </div>
              ))}
              {!!removed.length && (
                <div>
                  <strong>Void pieces entered by mistake</strong>
                  <ul>
                    {removed.map((id) => (
                      <li key={id}>{stockLink(id)}</li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          );
        })}
      </div>
    );
  const receipt = receiptCorrectionSchema.safeParse(value);
  if (
    receipt.success &&
    typeof value === 'object' &&
    value !== null &&
    ('operations' in value || 'purchaseOrderNumber' in value)
  )
    return (
      <div className="stack">
        <p>
          <strong>Reason:</strong> {receipt.data.reason}
        </p>
        {receipt.data.purchaseOrderNumber && (
          <p>
            <strong>Purchase order:</strong> {receipt.data.purchaseOrderNumber}
          </p>
        )}
        {receipt.data.operations.map((op, index) => (
          <section key={index} className="stack">
            <h4>
              {op.action === 'add'
                ? 'Add missing receipt line'
                : op.action === 'remove'
                  ? `Void receipt line ${shortId(op.lineId)}`
                  : `Correct receipt line ${shortId(op.lineId)}`}
            </h4>
            {op.action !== 'remove' && (
              <RecordValues referenceLabels={labels} value={op.data} />
            )}
            {op.action === 'update' && !!op.removeStockItemIds.length && (
              <div>
                <strong>Void rolls entered by mistake</strong>
                <ul>
                  {op.removeStockItemIds.map((id) => (
                    <li key={id}>{stockLink(id)}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        ))}
      </div>
    );
  const voiding = stockVoidSchema.safeParse(value);
  return voiding.success ? (
    <div className="stack">
      <p>
        <strong>Reason:</strong> {voiding.data.reason}
      </p>
      <p>
        This stock record will be voided and removed from available inventory.
        Its history remains accessible.
      </p>
    </div>
  ) : null;
}

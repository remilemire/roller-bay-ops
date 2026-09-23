'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import {
  receiptCorrectionContextSchema,
  receiptCorrectionSchema,
} from '@roller-bay/shared/corrections';
import { api } from '@/lib/api';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { TextField, ChoiceField } from '@/components/ui/field';
import { Lookup } from '@/components/ui/lookup';
import { Loading, ErrorNotice } from '@/components/ui/feedback';
import {
  lookupColors,
  catalogKey,
} from '@/features/fabric-catalog/catalog.api';
import {
  lookupLocations,
  locationsKey,
} from '@/features/locations/locations.api';
import { useMeasurementUnits } from '@/features/users/use-measurement-units';
import { fieldInput, fieldValue, fieldSuffix } from '@/lib/measurements';
import { shortId } from '@/lib/format';
import { CorrectionSubmit } from '@/features/corrections/correction-submit';
import { Blockers } from '@/features/corrections/blockers';
type Context = z.infer<typeof receiptCorrectionContextSchema>;
export function ReceiptCorrectionEditor({
  id,
  close,
}: {
  id: string;
  close: () => void;
}) {
  const query = useQuery({
    queryKey: ['stock-receipts', id, 'correction-context'],
    queryFn: ({ signal }) =>
      api(
        `/stock-receipts/${id}/correction-context`,
        receiptCorrectionContextSchema,
        { signal },
      ),
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title="Correct receipt"
      description="Correct only the affected lines. Rolls entered by mistake are voided, with their history preserved."
    >
      {query.isPending ? (
        <Loading />
      ) : query.data ? (
        <ReceiptCorrectionForm context={query.data} close={close} />
      ) : (
        <ErrorNotice error={query.error} />
      )}
    </Dialog>
  );
}
// Request-body line keys and the form fields that edit them.
const LINE_FIELDS: Record<string, string> = {
  fabricColorId: 'fabricColorId',
  widthMm: 'width',
  initialLengthMm: 'length',
  quantity: 'quantity',
  locationId: 'locationId',
};
function ReceiptCorrectionForm({
  context,
  close,
}: {
  context: Context;
  close: () => void;
}) {
  const [original] = useState(context);
  const live = useMeasurementUnits();
  const [units] = useState(live);
  const [number, setNumber] = useState(context.record.purchaseOrderNumber);
  const [lines, setLines] = useState(
    context.record.items
      .filter((i) => !i.voidedAt)
      .map((i) => ({
        key: i.id,
        lineId: i.id,
        action: 'keep',
        fabricColorId: i.fabricColorId,
        width: fieldInput(units, 'rollWidth', i.widthMm),
        length: fieldInput(units, 'rollLength', i.initialLengthMm),
        quantity: String(i.quantity),
        locationId: i.locationId,
        removeIds: [] as string[],
      })),
  );
  const update = (index: number, patch: Partial<(typeof lines)[number]>) =>
    setLines(lines.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  return (
    <CorrectionSubmit
      endpoint={`/stock-receipts/${context.record.id}/corrections`}
      schema={receiptCorrectionSchema}
      close={close}
      // Operations list only the changed lines, so their indexes are mapped
      // back to the line each one came from.
      fieldName={(path) => {
        if (path === 'purchaseOrderNumber') return path;
        const [, operation, key] =
          path.match(/^operations\.(\d+)\.data\.(\w+)$/) ?? [];
        const line = lines.filter((l) => l.action !== 'keep')[
          Number(operation)
        ];
        const field = key && LINE_FIELDS[key];
        return line && field ? `${line.key}.${field}` : null;
      }}
      makeBody={() => ({
        expectedRevision: original.record.revision,
        // Omit an unchanged number so older receipts that predate the
        // five-digit format can still have their lines corrected.
        purchaseOrderNumber:
          number === original.record.purchaseOrderNumber ? undefined : number,
        stockVersions: original.eligibility.map((e) => ({
          stockItemId: e.stockItemId,
          expectedRevision: e.revision,
        })),
        operations: lines
          .filter((l) => l.action !== 'keep')
          .map((l) =>
            l.action === 'remove'
              ? { action: 'remove', lineId: l.lineId }
              : {
                  action: l.lineId ? 'update' : 'add',
                  ...(l.lineId
                    ? { lineId: l.lineId, removeStockItemIds: l.removeIds }
                    : {}),
                  data: {
                    fabricColorId: l.fabricColorId,
                    widthMm: fieldValue(units, 'rollWidth', l.width),
                    initialLengthMm: fieldValue(units, 'rollLength', l.length),
                    quantity: Number(l.quantity),
                    locationId: l.locationId,
                  },
                },
          ),
      })}
    >
      {(errors) => (
        <>
          <TextField
            label="Purchase order number"
            value={number}
            onChange={setNumber}
            required
            maxLength={5}
            inputMode="numeric"
            error={errors.purchaseOrderNumber}
          />
          {!original.baselineAvailable && (
            <p className="notice">
              This older receipt can have its purchase-order reference
              corrected. Adjust current stock separately for other mistakes.
            </p>
          )}
          {original.baselineAvailable && (
            <div className="stack">
              {lines.map((line, index) => {
                const record = original.record.items.find(
                  (i) => i.id === line.lineId,
                );
                const eligibility = original.eligibility.filter((e) =>
                  record?.stockItemIds.includes(e.stockItemId),
                );
                return (
                  <section className="panel" key={line.key}>
                    <div className="panel-body stack">
                      <h3>
                        {record?.stockItems[0]?.fabricColorCode ??
                          'New receipt line'}
                      </h3>
                      {line.lineId && (
                        <ChoiceField
                          label="Action"
                          value={line.action}
                          onChange={(action) => update(index, { action })}
                          options={[
                            { value: 'keep', label: 'Keep unchanged' },
                            { value: 'update', label: 'Correct line' },
                            { value: 'remove', label: 'Void line' },
                          ]}
                        />
                      )}
                      {line.action !== 'keep' && (
                        <Blockers items={eligibility} />
                      )}
                      {['update', 'add'].includes(line.action) && (
                        <div className="stack">
                          <Lookup
                            label="Fabric"
                            value={line.fabricColorId}
                            onChange={(fabricColorId) =>
                              update(index, { fabricColorId })
                            }
                            error={errors[`${line.key}.fabricColorId`]}
                            queryKey={catalogKey}
                            load={lookupColors}
                          />
                          <TextField
                            label={`Width (${fieldSuffix(units, 'rollWidth')})`}
                            value={line.width}
                            onChange={(width) => update(index, { width })}
                            error={errors[`${line.key}.width`]}
                            type="number"
                            required
                          />
                          <TextField
                            label={`Length per roll (${fieldSuffix(units, 'rollLength')})`}
                            value={line.length}
                            onChange={(length) => update(index, { length })}
                            error={errors[`${line.key}.length`]}
                            type="number"
                            required
                          />
                          <TextField
                            label="Quantity"
                            value={line.quantity}
                            onChange={(quantity) => update(index, { quantity })}
                            error={errors[`${line.key}.quantity`]}
                            type="number"
                            required
                          />
                          <Lookup
                            label="Original destination"
                            value={line.locationId}
                            onChange={(locationId) =>
                              update(index, { locationId })
                            }
                            error={errors[`${line.key}.locationId`]}
                            queryKey={locationsKey}
                            load={lookupLocations}
                          />
                          {record &&
                            Number(line.quantity) < record.quantity && (
                              <fieldset>
                                <legend>Select rolls entered by mistake</legend>
                                {record.stockItems
                                  .filter((s) => !s.voidedAt)
                                  .map((stock) => (
                                    <label
                                      className="correction-check"
                                      key={stock.id}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={line.removeIds.includes(
                                          stock.id,
                                        )}
                                        disabled={
                                          !!eligibility.find(
                                            (e) => e.stockItemId === stock.id,
                                          )?.blockers.length
                                        }
                                        onChange={(e) =>
                                          update(index, {
                                            removeIds: e.target.checked
                                              ? [...line.removeIds, stock.id]
                                              : line.removeIds.filter(
                                                  (id) => id !== stock.id,
                                                ),
                                          })
                                        }
                                      />
                                      {shortId(stock.id)}
                                    </label>
                                  ))}
                              </fieldset>
                            )}
                        </div>
                      )}
                      {!line.lineId && (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() =>
                            setLines(lines.filter((_, i) => i !== index))
                          }
                        >
                          Remove new line
                        </Button>
                      )}
                    </div>
                  </section>
                );
              })}
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setLines([
                    ...lines,
                    {
                      key: crypto.randomUUID(),
                      lineId: '',
                      action: 'add',
                      fabricColorId: '',
                      width: '',
                      length: '',
                      quantity: '1',
                      locationId: '',
                      removeIds: [],
                    },
                  ])
                }
              >
                Add missing line
              </Button>
            </div>
          )}
        </>
      )}
    </CorrectionSubmit>
  );
}

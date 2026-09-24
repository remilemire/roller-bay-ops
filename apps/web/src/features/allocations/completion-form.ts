import { z } from 'zod';
import type { FieldPath } from 'react-hook-form';
import {
  completeAllocationSchema,
  type AllocationDetail,
} from '@roller-bay/shared/allocations';
import type { StockItem } from '@roller-bay/shared/stock-items';
import type { MeasurementUnits } from '@roller-bay/shared/users';
import { nullableNumber } from '@/lib/format';
import { fieldInput, fieldValue } from '@/lib/measurements';
export const completionFormSchema = z.object({
  items: z.array(
    z.object({
      stockItemId: z.string(),
      expectedRevision: z.number().int().positive(),
      outcome: z.string(),
      tube: z.string(),
      depth: z.string(),
      width: z.string(),
      length: z.string(),
      locationId: z.string(),
      scraps: z.array(
        z.object({
          width: z.string(),
          length: z.string(),
          quantity: z.string(),
          locationId: z.string(),
        }),
      ),
    }),
  ),
});
export type CompletionForm = z.infer<typeof completionFormSchema>;
const PAYLOAD_FIELDS: Record<string, string> = {
  tubeOuterDiameterMm: 'tube',
  radialDepthMm: 'depth',
  explicitLengthMm: 'length',
  widthMm: 'width',
  lengthMm: 'length',
};
/**
 * The form field that shows an issue reported against the completion payload,
 * or null when the issue belongs to no single field.
 */
export function completionFieldName(
  path: string,
  form?: CompletionForm,
): FieldPath<CompletionForm> | null {
  const match = path.match(
    /^(items\.\d+\.(?:scraps\.\d+\.)?)(outcome|locationId|quantity|\w+Mm)$/,
  );
  if (!match) return null;
  const field = PAYLOAD_FIELDS[match[2]!] ?? match[2]!;
  let prefix = match[1]!;
  if (form) {
    const used = form.items.filter((item) => item.outcome !== 'unused');
    const row = used[Number(prefix.split('.')[1])];
    if (!row) return null;
    prefix = prefix.replace(/^items\.\d+/, `items.${form.items.indexOf(row)}`);
  }
  return `${prefix}${field}` as FieldPath<CompletionForm>;
}
// Every measurement follows the given units in both directions.
export function completionToForm(
  allocation: AllocationDetail,
  units: MeasurementUnits,
): CompletionForm {
  return {
    items: allocation.items.map(({ stockItem }) =>
      completionItemToForm(stockItem, units),
    ),
  };
}
export function completionItemToForm(
  stock: StockItem,
  units: MeasurementUnits,
): CompletionForm['items'][number] {
  return {
    stockItemId: stock.id,
    expectedRevision: stock.revision,
    outcome: '',
    tube: fieldInput(units, 'tubeDiameter', stock.tubeOuterDiameterMm),
    depth: '',
    width: fieldInput(units, 'rollWidth', stock.widthMm),
    length: '',
    locationId: stock.locationId,
    scraps: [],
  };
}

export function completionFromForm(
  form: CompletionForm,
  expectedRevision: number,
  units: MeasurementUnits,
) {
  const unused = form.items
    .filter((item) => item.outcome === 'unused')
    .map((item) => item.stockItemId);
  return completeAllocationSchema.parse({
    expectedRevision,
    ...(unused.length ? { unusedStockItemIds: unused } : {}),
    items: form.items
      .filter((item) => item.outcome !== 'unused')
      .map((item) => ({
        stockItemId: item.stockItemId,
        expectedRevision: item.expectedRevision,
        outcome: item.outcome,
        ...(item.outcome === 'consumed'
          ? item.tube.trim()
            ? {
                tubeOuterDiameterMm: fieldValue(
                  units,
                  'tubeDiameter',
                  item.tube,
                ),
              }
            : {}
          : item.outcome === 'returned-roll'
            ? {
                radialDepthMm: fieldValue(units, 'radialDepth', item.depth),
                locationId: item.locationId,
                ...(item.tube.trim()
                  ? {
                      tubeOuterDiameterMm: fieldValue(
                        units,
                        'tubeDiameter',
                        item.tube,
                      ),
                    }
                  : {}),
              }
            : {
                widthMm: fieldValue(units, 'rollWidth', item.width),
                explicitLengthMm: fieldValue(units, 'rollLength', item.length),
                locationId: item.locationId,
              }),
        scraps: item.scraps.map((s) => ({
          widthMm: fieldValue(units, 'rollWidth', s.width),
          lengthMm: fieldValue(units, 'rollLength', s.length),
          quantity: nullableNumber(s.quantity),
          locationId: s.locationId,
        })),
      })),
  });
}
/**
 * Recover the original stock revision tokens as well as measurements so
 * retries preserve the request.
 */
export function completionRecovery(
  body: z.infer<typeof completeAllocationSchema>,
  allocation: AllocationDetail,
  units: MeasurementUnits,
): CompletionForm {
  const initial = completionToForm(allocation, units);
  const recovered = body.items.map((item) => {
    const base = initial.items.find(
      (i) => i.stockItemId === item.stockItemId,
    ) ?? {
      stockItemId: item.stockItemId,
      expectedRevision: item.expectedRevision,
      outcome: '',
      tube: '',
      depth: '',
      width: '',
      length: '',
      locationId: '',
      scraps: [],
    };
    return {
      ...base,
      stockItemId: item.stockItemId,
      expectedRevision: item.expectedRevision,
      outcome: item.outcome,
      tube:
        'tubeOuterDiameterMm' in item
          ? fieldInput(units, 'tubeDiameter', item.tubeOuterDiameterMm ?? null)
          : base.tube,
      depth:
        'radialDepthMm' in item
          ? fieldInput(units, 'radialDepth', item.radialDepthMm)
          : '',
      width:
        'widthMm' in item
          ? fieldInput(units, 'rollWidth', item.widthMm)
          : base.width,
      length:
        'explicitLengthMm' in item
          ? fieldInput(units, 'rollLength', item.explicitLengthMm)
          : '',
      locationId: 'locationId' in item ? item.locationId : base.locationId,
      scraps: item.scraps.map((s) => ({
        width: fieldInput(units, 'rollWidth', s.widthMm),
        length: fieldInput(units, 'rollLength', s.lengthMm),
        quantity: String(s.quantity),
        locationId: s.locationId,
      })),
    };
  });
  return {
    items: [
      ...initial.items.map((item) =>
        body.unusedStockItemIds?.includes(item.stockItemId)
          ? { ...item, outcome: 'unused' }
          : (recovered.find((row) => row.stockItemId === item.stockItemId) ??
            item),
      ),
      ...recovered.filter(
        (row) =>
          !initial.items.some((item) => item.stockItemId === row.stockItemId),
      ),
    ],
  };
}

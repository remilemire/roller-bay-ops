import { z } from 'zod';
import type { FieldPath } from 'react-hook-form';
import {
  completeAllocationSchema,
  type AllocationDetail,
} from '@roller-bay/shared/allocations';
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
): FieldPath<CompletionForm> | null {
  const match = path.match(
    /^(items\.\d+\.(?:scraps\.\d+\.)?)(outcome|locationId|quantity|\w+Mm)$/,
  );
  if (!match) return null;
  const field = PAYLOAD_FIELDS[match[2]!] ?? match[2]!;
  return `${match[1]}${field}` as FieldPath<CompletionForm>;
}
// Every measurement follows the given units in both directions.
export function completionToForm(
  allocation: AllocationDetail,
  units: MeasurementUnits,
): CompletionForm {
  return {
    items: allocation.items.map(({ stockItem }) => ({
      stockItemId: stockItem.id,
      expectedRevision: stockItem.revision,
      outcome: '',
      tube: fieldInput(units, 'tubeDiameter', stockItem.tubeOuterDiameterMm),
      depth: '',
      width: fieldInput(units, 'rollWidth', stockItem.widthMm),
      length: '',
      locationId: stockItem.locationId,
      scraps: [],
    })),
  };
}
export function completionFromForm(
  form: CompletionForm,
  expectedRevision: number,
  units: MeasurementUnits,
) {
  return completeAllocationSchema.parse({
    expectedRevision,
    items: form.items.map((item) => ({
      stockItemId: item.stockItemId,
      expectedRevision: item.expectedRevision,
      outcome: item.outcome,
      ...(item.outcome === 'consumed'
        ? item.tube.trim()
          ? {
              tubeOuterDiameterMm: fieldValue(units, 'tubeDiameter', item.tube),
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
  return {
    items: body.items.map((item) => {
      const base = initial.items.find(
        (i) => i.stockItemId === item.stockItemId,
      )!;
      return {
        ...base,
        stockItemId: item.stockItemId,
        expectedRevision: item.expectedRevision,
        outcome: item.outcome,
        tube:
          'tubeOuterDiameterMm' in item
            ? fieldInput(
                units,
                'tubeDiameter',
                item.tubeOuterDiameterMm ?? null,
              )
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
    }),
  };
}

import { z } from 'zod';
import {
  completeAllocationSchema,
  type AllocationDetail,
} from '@roller-bay/shared/allocations';
import {
  widthInput,
  lengthInput,
  widthValue,
  lengthValue,
  nullableNumber,
} from '@/lib/format';
export const completionFormSchema = z.object({
  items: z.array(
    z.object({
      stockItemId: z.string(),
      expectedUpdatedAt: z.string(),
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
export function completionToForm(allocation: AllocationDetail): CompletionForm {
  return {
    items: allocation.items.map(({ stockItem }) => ({
      stockItemId: stockItem.id,
      expectedUpdatedAt: stockItem.updatedAt,
      outcome: '',
      tube: String(stockItem.tubeOuterDiameterMm ?? ''),
      depth: '',
      width: widthInput(stockItem.widthMm),
      length: '',
      locationId: stockItem.locationId,
      scraps: [],
    })),
  };
}
export function completionFromForm(
  form: CompletionForm,
  expectedRevision: number,
) {
  return completeAllocationSchema.parse({
    expectedRevision,
    items: form.items.map((item) => ({
      stockItemId: item.stockItemId,
      expectedUpdatedAt: item.expectedUpdatedAt,
      outcome: item.outcome,
      ...(item.outcome === 'consumed'
        ? item.tube.trim()
          ? { tubeOuterDiameterMm: nullableNumber(item.tube) }
          : {}
        : item.outcome === 'returned-roll'
          ? {
              radialDepthMm: nullableNumber(item.depth),
              locationId: item.locationId,
              ...(item.tube.trim()
                ? { tubeOuterDiameterMm: nullableNumber(item.tube) }
                : {}),
            }
          : {
              widthMm: widthValue(item.width),
              explicitLengthMm: lengthValue(item.length),
              locationId: item.locationId,
            }),
      scraps: item.scraps.map((s) => ({
        widthMm: widthValue(s.width),
        lengthMm: lengthValue(s.length),
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
): CompletionForm {
  const initial = completionToForm(allocation);
  return {
    items: body.items.map((item) => {
      const base = initial.items.find(
        (i) => i.stockItemId === item.stockItemId,
      )!;
      return {
        ...base,
        stockItemId: item.stockItemId,
        expectedUpdatedAt: item.expectedUpdatedAt,
        outcome: item.outcome,
        tube:
          'tubeOuterDiameterMm' in item
            ? String(item.tubeOuterDiameterMm ?? '')
            : base.tube,
        depth: 'radialDepthMm' in item ? String(item.radialDepthMm) : '',
        width: 'widthMm' in item ? widthInput(item.widthMm) : base.width,
        length:
          'explicitLengthMm' in item ? lengthInput(item.explicitLengthMm) : '',
        locationId: 'locationId' in item ? item.locationId : base.locationId,
        scraps: item.scraps.map((s) => ({
          width: widthInput(s.widthMm),
          length: lengthInput(s.lengthMm),
          quantity: String(s.quantity),
          locationId: s.locationId,
        })),
      };
    }),
  };
}

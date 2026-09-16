import { z } from 'zod';
import {
  stockReceiptDraftDataSchema,
  type StockReceiptDraftData,
} from '@roller-bay/shared/stock-receipts';
import type { MeasurementUnits } from '@roller-bay/shared/users';
import { nullableNumber, nullableText } from '@/lib/format';
import { fieldInput, fieldValue } from '@/lib/measurements';
export const receiptFormSchema = z.object({
  purchaseOrderNumber: z.string(),
  items: z.array(
    z.object({
      fabricColorId: z.string(),
      width: z.string(),
      length: z.string(),
      quantity: z.string(),
      locationId: z.string(),
    }),
  ),
});
export type ReceiptForm = z.infer<typeof receiptFormSchema>;
export const emptyReceiptLine = () => ({
  fabricColorId: '',
  width: '',
  length: '',
  quantity: '',
  locationId: '',
});
// Form strings are expressed in the given units; callers must convert back
// with the same units so a saved value never drifts.
export function receiptToForm(
  data: StockReceiptDraftData | undefined,
  units: MeasurementUnits,
): ReceiptForm {
  return {
    purchaseOrderNumber: data?.purchaseOrderNumber ?? '',
    items: data?.items.map((i) => ({
      fabricColorId: i.fabricColorId ?? '',
      width: fieldInput(units, 'rollWidth', i.widthMm),
      length: fieldInput(units, 'rollLength', i.initialLengthMm),
      quantity: String(i.quantity ?? ''),
      locationId: i.locationId ?? '',
    })) ?? [emptyReceiptLine()],
  };
}
export function receiptFromForm(form: ReceiptForm, units: MeasurementUnits) {
  return stockReceiptDraftDataSchema.parse({
    purchaseOrderNumber: nullableText(form.purchaseOrderNumber),
    items: form.items.map((i) => ({
      fabricColorId: nullableText(i.fabricColorId),
      widthMm: fieldValue(units, 'rollWidth', i.width),
      initialLengthMm: fieldValue(units, 'rollLength', i.length),
      quantity: nullableNumber(i.quantity),
      locationId: nullableText(i.locationId),
    })),
  });
}

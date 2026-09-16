import { z } from 'zod';
import {
  stockReceiptDraftDataSchema,
  type StockReceiptDraftData,
} from '@roller-bay/shared/stock-receipts';
import {
  widthInput,
  lengthInput,
  widthValue,
  lengthValue,
  nullableNumber,
  nullableText,
} from '@/lib/format';
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
export function receiptToForm(data?: StockReceiptDraftData): ReceiptForm {
  return {
    purchaseOrderNumber: data?.purchaseOrderNumber ?? '',
    items: data?.items.map((i) => ({
      fabricColorId: i.fabricColorId ?? '',
      width: widthInput(i.widthMm),
      length: lengthInput(i.initialLengthMm),
      quantity: String(i.quantity ?? ''),
      locationId: i.locationId ?? '',
    })) ?? [emptyReceiptLine()],
  };
}
export function receiptFromForm(form: ReceiptForm) {
  return stockReceiptDraftDataSchema.parse({
    purchaseOrderNumber: nullableText(form.purchaseOrderNumber),
    items: form.items.map((i) => ({
      fabricColorId: nullableText(i.fabricColorId),
      widthMm: widthValue(i.width),
      initialLengthMm: lengthValue(i.length),
      quantity: nullableNumber(i.quantity),
      locationId: nullableText(i.locationId),
    })),
  });
}

import { z } from 'zod';
import { stockItemSchema } from '../stock-items/index.js';

const uuid = z.uuid().transform((value) => value.toLowerCase());
const dimension = z.number().positive().max(999999999.999).multipleOf(0.001);
const lineFields = {
  fabricColorId: uuid,
  widthMm: dimension,
  initialLengthMm: dimension,
  quantity: z.number().int().positive(),
  locationId: uuid,
};
export const stockReceiptItemInputSchema = z.strictObject({
  ...lineFields,
  quantity: lineFields.quantity.max(1000).default(1),
});
export const createStockReceiptSchema = z
  .strictObject({
    purchaseOrderNumber: z.string().trim().min(1).max(50),
    items: z.array(stockReceiptItemInputSchema).min(1).max(100),
  })
  .refine(
    (value) =>
      value.items.reduce((total, item) => total + item.quantity, 0) <= 1000,
    {
      path: ['items'],
      message: 'A stock receipt may contain at most 1,000 rolls.',
    },
  );
export const idempotencyKeySchema = uuid;
export const stockReceiptQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(50).optional(),
});
export const stockReceiptSummarySchema = z.object({
  id: z.uuid(),
  purchaseOrderNumber: z.string(),
  submittedByUserId: z.uuid(),
  submittedAt: z.iso.datetime(),
});
export const stockReceiptItemSchema = z.object({
  ...lineFields,
  id: z.uuid(),
  stockReceiptId: z.uuid(),
  stockItemIds: z.array(z.uuid()),
});
export const stockReceiptSchema = stockReceiptSummarySchema.extend({
  items: z.array(stockReceiptItemSchema),
});
export const stockReceiptDetailSchema = stockReceiptSummarySchema.extend({
  items: z.array(
    stockReceiptItemSchema.extend({ stockItems: z.array(stockItemSchema) }),
  ),
});
export const stockReceiptListSchema = z.object({
  items: z.array(stockReceiptSummarySchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type CreateStockReceipt = z.infer<typeof createStockReceiptSchema>;
export type StockReceiptQuery = z.infer<typeof stockReceiptQuerySchema>;

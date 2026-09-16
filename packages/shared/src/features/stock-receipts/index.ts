import { z } from 'zod';
import { stockItemSchema } from '../stock-items/index.js';

export const stockReceiptStateSchema = z.enum(['draft', 'submitted']);

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
  state: stockReceiptStateSchema.optional(),
});
export const stockReceiptSummarySchema = z.object({
  state: z.literal('submitted'),
  createdByUserId: z.uuid(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  revision: z.number().int().positive(),
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
// Drafts retain typed values but permit fields that have not been filled in yet.
const draftField = <T extends z.ZodType>(schema: T) =>
  schema.nullish().transform((value) => value ?? null);
export const stockReceiptDraftDataSchema = z
  .strictObject({
    purchaseOrderNumber: draftField(z.string().trim().min(1).max(50)),
    items: z
      .array(
        z.strictObject({
          fabricColorId: draftField(uuid),
          widthMm: draftField(dimension),
          initialLengthMm: draftField(dimension),
          quantity: draftField(lineFields.quantity.max(1000)),
          locationId: draftField(uuid),
        }),
      )
      .max(100)
      .default([]),
  })
  .refine(
    (value) =>
      value.items.reduce((sum, item) => sum + (item.quantity ?? 0), 0) <= 1000,
    'A stock receipt may contain at most 1,000 rolls.',
  );
export const createStockReceiptDraftSchema = z.strictObject({
  data: stockReceiptDraftDataSchema,
});
export const stockReceiptDraftRevisionSchema = z.strictObject({
  expectedRevision: z.number().int().positive().max(2147483646),
});
export const updateStockReceiptDraftSchema =
  stockReceiptDraftRevisionSchema.extend({ data: stockReceiptDraftDataSchema });
export const stockReceiptDraftSummarySchema = z.object({
  id: uuid,
  state: z.literal('draft'),
  purchaseOrderNumber: z.string().nullable(),
  createdByUserId: uuid,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  revision: z.number().int().positive(),
  submittedAt: z.null(),
  submittedByUserId: z.null(),
});
export const stockReceiptDraftSchema = stockReceiptDraftSummarySchema.extend({
  data: stockReceiptDraftDataSchema,
});
export const stockReceiptRecordSchema = z.discriminatedUnion('state', [
  stockReceiptDetailSchema,
  stockReceiptDraftSchema,
]);
export type StockReceiptDraftData = z.infer<typeof stockReceiptDraftDataSchema>;
export const stockReceiptListSchema = z.object({
  items: z.array(
    z.discriminatedUnion('state', [
      stockReceiptSummarySchema,
      stockReceiptDraftSummarySchema,
    ]),
  ),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type CreateStockReceipt = z.infer<typeof createStockReceiptSchema>;
export type StockReceiptQuery = z.infer<typeof stockReceiptQuerySchema>;

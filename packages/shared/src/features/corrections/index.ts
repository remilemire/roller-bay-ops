import { z } from 'zod';
import {
  updateStockItemSchema,
  stockItemSchema,
  stockEffectSchema,
  stockCuttingOutcomeSchema,
} from '../stock-items/index.js';
import {
  purchaseOrderNumberSchema,
  stockReceiptItemInputSchema,
  stockReceiptDetailSchema,
} from '../stock-receipts/index.js';
import { allocationDetailSchema } from '../allocations/index.js';
const uuid = z.uuid().transform((v) => v.toLowerCase());
export const correctionBaseSchema = z.strictObject({
  reason: z.string().trim().min(1).max(1000),
  expectedRevision: z.number().int().positive().max(2147483646),
});
export const correctionKeySchema = z.uuid().transform((v) => v.toLowerCase());
export const stockCorrectionSchema = correctionBaseSchema.extend({
  changes: updateStockItemSchema,
});
export const stockVoidSchema = correctionBaseSchema;
const stockVersionSchema = z.strictObject({
  stockItemId: uuid,
  expectedRevision: z.number().int().positive(),
});
export const receiptCorrectionSchema = correctionBaseSchema.extend({
  purchaseOrderNumber: purchaseOrderNumberSchema.optional(),
  operations: z
    .array(
      z.discriminatedUnion('action', [
        z.strictObject({
          action: z.literal('add'),
          data: stockReceiptItemInputSchema,
        }),
        z.strictObject({
          action: z.literal('update'),
          lineId: uuid,
          data: stockReceiptItemInputSchema,
          removeStockItemIds: z.array(uuid).max(1000).default([]),
        }),
        z.strictObject({ action: z.literal('remove'), lineId: uuid }),
      ]),
    )
    .max(100)
    .default([]),
  stockVersions: z.array(stockVersionSchema).max(1000).default([]),
});
export const completionCorrectionSchema = correctionBaseSchema
  .extend({
    items: z
      .array(
        z.strictObject({
          outcome: stockCuttingOutcomeSchema,
          // Existing pieces must be retained by ID or explicitly selected for voiding.
          removeRetainedPieceIds: z.array(uuid).max(1000).default([]),
          retainedPieces: z
            .array(
              z.strictObject({
                id: uuid.optional(),
                widthMm: z
                  .number()
                  .positive()
                  .max(999999999.999)
                  .multipleOf(0.001),
                lengthMm: z
                  .number()
                  .positive()
                  .max(999999999.999)
                  .multipleOf(0.001),
                locationId: uuid,
              }),
            )
            .max(1000),
        }),
      )
      .max(10000)
      .default([]),
    additionalItems: z.array(stockCuttingOutcomeSchema).max(1000).default([]),
    unusedStockItemIds: z.array(uuid).max(1000).default([]),
    stockVersions: z.array(stockVersionSchema).max(11000),
  })
  .refine(
    (v) =>
      v.items.length + v.additionalItems.length + v.unusedStockItemIds.length >
      0,
    'Select a result to correct, mark unused, or add.',
  )
  .refine((v) => {
    const ids = [
      ...v.items.map((i) => i.outcome.stockItemId),
      ...v.additionalItems.map((i) => i.stockItemId),
      ...v.unusedStockItemIds,
    ];
    return new Set(ids).size === ids.length;
  }, 'Change each stock item only once.')
  .refine(
    (v) => v.items.every((i) => i.outcome.scraps.length === 0),
    'Use individually identified retained pieces for corrections.',
  )
  .refine(
    (v) => v.items.reduce((n, i) => n + i.retainedPieces.length, 0) <= 1000,
    'At most 1,000 retained pieces.',
  );
export const correctionResultSchema = z.object({
  eventId: uuid,
  recordId: uuid,
  revision: z.number().int().positive(),
  affectedAllocationIds: z.array(uuid),
  createdStockItemIds: z.array(uuid),
});
export const correctionBlockerSchema = z.object({
  code: z.enum(['legacy', 'changed', 'voided', 'reserved', 'downstream']),
  message: z.string(),
  allocationIds: z.array(uuid),
  stockItemIds: z.array(uuid),
});
export const correctionEligibilitySchema = z.object({
  stockItemId: uuid,
  revision: z.number().int().positive(),
  blockers: z.array(correctionBlockerSchema),
});
export const receiptCorrectionContextSchema = z.object({
  record: stockReceiptDetailSchema,
  baselineAvailable: z.boolean(),
  eligibility: z.array(correctionEligibilitySchema),
});
export const completionCorrectionContextSchema = z.object({
  record: allocationDetailSchema,
  baselineAvailable: z.boolean(),
  effects: z.array(stockEffectSchema),
  stockItems: z.array(stockItemSchema),
  eligibility: z.array(correctionEligibilitySchema),
});
export type StockCorrection = z.infer<typeof stockCorrectionSchema>;
export type ReceiptCorrection = z.infer<typeof receiptCorrectionSchema>;
export type CompletionCorrection = z.infer<typeof completionCorrectionSchema>;
export type CorrectionResult = z.infer<typeof correctionResultSchema>;
export type CorrectionEligibility = z.infer<typeof correctionEligibilitySchema>;

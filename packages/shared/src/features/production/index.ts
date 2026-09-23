import { z } from 'zod';
import { stationSchema, measurementUnitsSchema } from '../users/index.js';
import {
  allocationDetailSchema,
  completeAllocationSchema,
} from '../allocations/index.js';
import { workOrderSchema } from '../work-orders/index.js';
export const completionInputSchema = z.strictObject({ employeeId: z.uuid() });
export const milestoneCorrectionSchema = z
  .strictObject({
    expectedRevision: z.number().int().positive(),
    employeeId: z.uuid().nullable(),
    completedAt: z.iso.datetime().nullable(),
    reason: z.string().trim().min(1).max(1000),
  })
  .refine(
    (v) => (v.employeeId === null) === (v.completedAt === null),
    'Supply both employee and completion time, or clear both.',
  );
export const productionCompletionSchema = z.object({
  workOrderId: z.uuid(),
  station: stationSchema,
  employeeId: z.uuid(),
  employeeName: z.string(),
  employeeInitials: z.string(),
  completedAt: z.iso.datetime(),
  recordedAt: z.iso.datetime(),
  recordedByUserId: z.uuid(),
});
export const productionCompletionsSchema = z.array(productionCompletionSchema);
export const stationQuerySchema = z
  .strictObject({
    search: z
      .string()
      .trim()
      .regex(/^\d{0,6}$/)
      .default(''),
    page: z.coerce.number().int().min(1).max(1000000).default(1),
    view: z.enum(['queue', 'completed', 'all']).default('queue'),
    // The browser supplies the station's local day as explicit UTC bounds.
    from: z.iso.datetime().optional(),
    to: z.iso.datetime().optional(),
  })
  .refine(
    (v) => v.view !== 'completed' || (!!v.from && !!v.to && v.from < v.to),
    'Completed view needs a valid time range.',
  );
export const stationOrderSchema = workOrderSchema.extend({
  completions: productionCompletionsSchema,
});
export const stationOrderListSchema = z.object({
  items: z.array(stationOrderSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

// Drafts retain the operator's text and units, including incomplete measurements.
const field = z.string().max(100);
export const cuttingDraftFormSchema = z.object({
  items: z
    .array(
      z.object({
        stockItemId: z.uuid(),
        expectedRevision: z.number().int().positive(),
        outcome: field,
        tube: field,
        depth: field,
        width: field,
        length: field,
        locationId: field,
        scraps: z
          .array(
            z.object({
              width: field,
              length: field,
              quantity: field,
              locationId: field,
            }),
          )
          .max(1000),
      }),
    )
    .max(10000),
});
export const cuttingDraftSchema = z.strictObject({
  form: cuttingDraftFormSchema,
  units: measurementUnitsSchema,
  checkedCuts: z.array(z.number().int().nonnegative()).max(10000),
});
export const worksheetSaveSchema = z.strictObject({
  expectedRevision: z.number().int().positive(),
  draft: cuttingDraftSchema,
});
export const worksheetSubmitSchema = z.strictObject({
  expectedRevision: z.number().int().positive(),
  results: completeAllocationSchema,
  draft: cuttingDraftSchema.optional(),
});
export const worksheetReviewSchema = z.strictObject({
  expectedRevision: z.number().int().positive(),
  resolution: z
    .strictObject({
      reason: z.string().trim().min(1).max(1000),
      results: completeAllocationSchema,
    })
    .optional(),
});
export const worksheetReturnSchema = z.strictObject({
  expectedRevision: z.number().int().positive(),
  reason: z.string().trim().min(1).max(1000),
});
export const worksheetSchema = z.object({
  id: z.uuid(),
  allocationId: z.uuid(),
  workOrderId: z.uuid(),
  orderNumber: z.string(),
  revision: z.number().int().positive(),
  employeeId: z.uuid(),
  employeeName: z.string(),
  employeeInitials: z.string(),
  startedAt: z.iso.datetime(),
  abandonedAt: z.iso.datetime().nullable().default(null),
  skippedAt: z.iso.datetime().nullable().default(null),
  submittedAt: z.iso.datetime().nullable(),
  reviewedAt: z.iso.datetime().nullable(),
  startedByUserId: z.uuid(),
  submittedByUserId: z.uuid().nullable(),
  reviewedByUserId: z.uuid().nullable(),
  snapshot: allocationDetailSchema,
  draft: cuttingDraftSchema.nullable(),
  results: completeAllocationSchema.nullable(),
});
export const worksheetListSchema = z.array(
  worksheetSchema.omit({ snapshot: true, draft: true, results: true }),
);
export type ProductionCompletion = z.infer<typeof productionCompletionSchema>;
export type StationQuery = z.infer<typeof stationQuerySchema>;
export type Worksheet = z.infer<typeof worksheetSchema>;
export type CuttingDraft = z.infer<typeof cuttingDraftSchema>;
export type WorksheetSave = z.infer<typeof worksheetSaveSchema>;
export type WorksheetSubmit = z.infer<typeof worksheetSubmitSchema>;
export type MilestoneCorrection = z.infer<typeof milestoneCorrectionSchema>;

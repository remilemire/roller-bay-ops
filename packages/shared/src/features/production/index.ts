import { z } from 'zod';
import { stationSchema, measurementUnitsSchema } from '../users/index.js';
import {
  allocationDetailSchema,
  completeAllocationSchema,
} from '../allocations/index.js';
import { workOrderSchema } from '../work-orders/index.js';
export const completionEmployeeSchema = z.object({
  employeeId: z.uuid(),
  employeeName: z.string(),
  employeeInitials: z.string(),
});
// Attribution is a set: sorted ids keep replay hashes and retry keys
// independent of the order employees were chosen in.
const employeeIdsSchema = z
  .array(z.uuid())
  .min(1)
  .max(20)
  .refine((ids) => new Set(ids).size === ids.length, 'List each employee once.')
  .transform((ids) => [...ids].sort());
export const completionInputSchema = z.strictObject({
  employeeIds: employeeIdsSchema,
});
// A cutting sheet is begun by one cutter.
export const worksheetBeginSchema = z.strictObject({ employeeId: z.uuid() });
export const milestoneCorrectionSchema = z
  .strictObject({
    expectedRevision: z.number().int().positive(),
    employeeIds: employeeIdsSchema.nullable(),
    completedAt: z.iso.datetime().nullable(),
    reason: z.string().trim().min(1).max(1000),
  })
  .refine(
    (v) => (v.employeeIds === null) === (v.completedAt === null),
    'Supply employees and completion time, or clear both.',
  );
export const productionCompletionSchema = z.object({
  workOrderId: z.uuid(),
  station: stationSchema,
  employees: z.array(completionEmployeeSchema).min(1),
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
  hasCuttingWorksheet: z.boolean(),
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
  employeeIds: employeeIdsSchema,
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
export type CompletionInput = z.infer<typeof completionInputSchema>;
export type StationQuery = z.infer<typeof stationQuerySchema>;
export type Worksheet = z.infer<typeof worksheetSchema>;
export type CuttingDraft = z.infer<typeof cuttingDraftSchema>;
export type WorksheetSave = z.infer<typeof worksheetSaveSchema>;
export type WorksheetSubmit = z.infer<typeof worksheetSubmitSchema>;
export type MilestoneCorrection = z.infer<typeof milestoneCorrectionSchema>;

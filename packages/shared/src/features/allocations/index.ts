import { z } from 'zod';
import {
  stockItemSchema,
  stockCuttingOutcomeSchema,
  legacyStockCuttingOutcomeSchema,
  recordedStockCuttingOutcomeSchema,
} from '../stock-items/index.js';

export const allocationStateSchema = z.enum([
  'draft',
  'active',
  'completed',
  'cancelled',
]);

const dimension = z.number().nonnegative().max(999999999.999).multipleOf(0.001);
const id = z.uuid().transform((value) => value.toLowerCase());
const quantity = z.number().int().min(1).max(10000);

export const cuttingRequirementSchema = z.strictObject({
  id,
  fabricColorId: id,
  widthMm: dimension.positive(),
  lengthMm: dimension.positive(),
  lengthAllowanceMm: dimension,
  quantity,
});

// Trusted availability snapshot supplied by the application, not the solver.
export const cuttingStockSchema = z.strictObject({
  id,
  fabricColorId: id,
  widthMm: dimension.positive(),
  remainingLengthMm: dimension,
  reservedLengthMm: dimension,
  isRemnant: z.boolean(),
  isUsed: z.boolean(),
  consumedAt: z.iso.datetime().nullable(),
  voidedAt: z.iso.datetime().nullable().optional(),
});

export const cuttingContextSchema = z.strictObject({
  requirements: z.array(cuttingRequirementSchema).min(1).max(1000),
  stockItems: z.array(cuttingStockSchema).max(10000),
  settings: z.strictObject({
    edgeTrimMm: dimension.positive(),
    minimumRemnantWidthMm: dimension.positive(),
    minimumRemnantLengthMm: dimension.positive(),
  }),
});

// Each cut spans the full stock width. Items are ordered left to right;
// quantities represent adjacent copies. Rotation and nesting are not supported.
export const cuttingPlanSchema = z.strictObject({
  cuts: z
    .array(
      z.strictObject({
        stockItemId: id,
        lengthMm: dimension.positive(),
        items: z
          .array(z.strictObject({ requirementId: id, quantity }))
          .min(1)
          .max(1000),
      }),
    )
    .min(1)
    .max(10000),
});

export type CuttingContext = z.infer<typeof cuttingContextSchema>;
export type CuttingPlan = z.infer<typeof cuttingPlanSchema>;

export const cuttingSettingsSchema = cuttingContextSchema.shape.settings;
export const allocationIdempotencyKeySchema = id;
export const cuttingPlanSummarySchema = z.object({
  leftovers: z.array(
    z.object({
      stockItemId: id,
      cutIndex: z.number().int().nonnegative().nullable(),
      kind: z.enum(['left-edge', 'right-edge', 'shortening', 'remnant-tail']),
      widthMm: dimension,
      lengthMm: dimension,
      quantity: z.number().int().positive(),
      reusable: z.boolean(),
    }),
  ),
  reservations: z.array(
    z.object({ stockItemId: id, reservedLengthMm: dimension }),
  ),
  inputAreaMm2: z.string().regex(/^\d+\.\d{6}$/),
  requiredAreaMm2: z.string().regex(/^\d+\.\d{6}$/),
  reusableAreaMm2: z.string().regex(/^\d+\.\d{6}$/),
  wasteAreaMm2: z.string().regex(/^\d+\.\d{6}$/),
  cutCount: z.number().int().nonnegative(),
  stockItemCount: z.number().int().nonnegative(),
  newRollCount: z.number().int().nonnegative(),
});
export const allocationRequirementInputSchema = cuttingRequirementSchema.omit({
  lengthAllowanceMm: true,
});
// Stored plans retain the rules they were prepared with. Older snapshots lack
// the global allowance; their per-requirement allowances remain authoritative.
export const allocationSettingsSchema = cuttingSettingsSchema.extend({
  dropAllowanceMm: dimension.optional(),
});
const planningFields = {
  requirements: z.array(allocationRequirementInputSchema).min(1).max(1000),
};
const revision = z.number().int().positive().max(2147483646);
const previewFields = {
  ...planningFields,
  allocationId: id.optional(),
  expectedRevision: revision.optional(),
};
const previewRevision = (value: {
  allocationId?: string;
  expectedRevision?: number;
}) =>
  (value.allocationId === undefined) === (value.expectedRevision === undefined);
export const optimizeAllocationSchema = z
  .strictObject({
    ...previewFields,
    maxTimeSeconds: z.number().positive().max(60).default(5),
  })
  .refine(
    previewRevision,
    'Provide allocationId and expectedRevision together.',
  );
export const validateAllocationSchema = z
  .strictObject({ ...previewFields, plan: cuttingPlanSchema })
  .refine(
    previewRevision,
    'Provide allocationId and expectedRevision together.',
  );
const allocationSubmission = z.strictObject({
  orderNumber: z.string().trim().min(1).max(50),
  ...planningFields,
  plan: cuttingPlanSchema,
});
export const createAllocationSchema = allocationSubmission.refine(
  (value) =>
    value.plan.cuts.reduce((total, cut) => total + cut.items.length, 0) <=
    10000,
  'An allocation may contain at most 10,000 cut assignments.',
);
export const replaceAllocationSchema = createAllocationSchema.safeExtend({
  expectedRevision: revision,
});
export const cancelAllocationSchema = z.strictObject({
  expectedRevision: revision,
});
export const completeAllocationSchema = z
  .strictObject({
    expectedRevision: revision,
    items: z.array(stockCuttingOutcomeSchema).min(1).max(10000),
  })
  .refine(
    (value) =>
      value.items.reduce(
        (sum, item) =>
          sum + item.scraps.reduce((n, scrap) => n + scrap.quantity, 0),
        0,
      ) <= 1000,
    'A completion may create at most 1,000 retained scraps.',
  );
// Legacy timestamp submissions may only replay an already committed completion.
export const completeAllocationRequestSchema = z.union([
  completeAllocationSchema,
  z
    .strictObject({
      expectedRevision: revision,
      items: z.array(legacyStockCuttingOutcomeSchema).min(1).max(10000),
    })
    .refine(
      (value) =>
        value.items.reduce(
          (sum, item) =>
            sum + item.scraps.reduce((n, piece) => n + piece.quantity, 0),
          0,
        ) <= 1000,
      'A completion may create at most 1,000 retained scraps.',
    ),
]);
export type CompleteAllocationRequest = z.infer<
  typeof completeAllocationRequestSchema
>;
export const allocationQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(50).optional(),
  state: allocationStateSchema.optional(),
});
export const allocationSummarySchema = z.object({
  id,
  orderNumber: z.string(),
  createdByUserId: id,
  revision,
  state: allocationStateSchema.exclude(['draft']),
  needsReplanning: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
  cancelledAt: z.iso.datetime().nullable(),
});
export const allocationCompletionSchema = z.object({
  submittedByUserId: id,
  items: z.array(recordedStockCuttingOutcomeSchema),
  createdStockItemIds: z.array(id),
  affectedAllocationIds: z.array(id),
});
export const allocationDetailSchema = allocationSummarySchema.extend({
  requirements: z.array(cuttingRequirementSchema),
  plan: cuttingPlanSchema,
  settings: allocationSettingsSchema.nullable(),
  plannedSummary: cuttingPlanSummarySchema.nullable(),
  items: z.array(
    z.object({
      id,
      stockItemId: id,
      reservedLengthMm: dimension,
      stockItem: stockItemSchema,
    }),
  ),
  completion: allocationCompletionSchema.nullable(),
  correctedAt: z.iso.datetime().nullable(),
});
const draftField = <T extends z.ZodType>(schema: T) =>
  schema.nullish().transform((value) => value ?? null);
export const allocationDraftDataSchema = z
  .strictObject({
    orderNumber: draftField(z.string().trim().min(1).max(50)),
    requirements: z
      .array(
        z.strictObject({
          id,
          fabricColorId: draftField(id),
          widthMm: draftField(dimension.positive()),
          lengthMm: draftField(dimension.positive()),
          lengthAllowanceMm: draftField(dimension),
          quantity: draftField(quantity),
        }),
      )
      .max(1000)
      .default([]),
    settings: z
      .strictObject({
        edgeTrimMm: draftField(dimension.positive()),
        minimumRemnantWidthMm: draftField(dimension.positive()),
        minimumRemnantLengthMm: draftField(dimension.positive()),
        dropAllowanceMm: dimension.optional(),
      })
      .prefault({}),
    plan: z
      .strictObject({
        cuts: z
          .array(
            z.strictObject({
              stockItemId: draftField(id),
              lengthMm: draftField(dimension.positive()),
              items: z
                .array(
                  z.strictObject({
                    requirementId: id,
                    quantity: draftField(quantity),
                  }),
                )
                .max(1000)
                .default([]),
            }),
          )
          .max(10000)
          .default([]),
      })
      .prefault({}),
  })
  .superRefine(validateDraftAssignments);

function validateDraftAssignments(
  value: {
    requirements: { id: string }[];
    plan: { cuts: { items: { requirementId: string }[] }[] };
  },
  ctx: z.RefinementCtx,
) {
  // Draft dimensions may be unfinished, but assignment links must already
  // resolve within this draft so replacement saves preserve a coherent graph.
  const ids = new Set(value.requirements.map((item) => item.id));
  if (ids.size !== value.requirements.length)
    ctx.addIssue({
      code: 'custom',
      path: ['requirements'],
      message: 'Requirement IDs must be unique.',
    });
  let assignments = 0;
  value.plan.cuts.forEach((cut, i) => {
    const assigned = new Set<string>();
    cut.items.forEach((item, j) => {
      if (!ids.has(item.requirementId) || assigned.has(item.requirementId))
        ctx.addIssue({
          code: 'custom',
          path: ['plan', 'cuts', i, 'items', j, 'requirementId'],
          message:
            'Assignments must reference a unique requirement in this draft.',
        });
      assigned.add(item.requirementId);
      assignments++;
    });
  });
  if (assignments > 10000)
    ctx.addIssue({
      code: 'custom',
      path: ['plan'],
      message: 'An allocation may contain at most 10,000 cut assignments.',
    });
}

export const allocationDraftInputSchema = z
  .strictObject({
    orderNumber: allocationDraftDataSchema.shape.orderNumber,
    requirements: z
      .array(
        allocationDraftDataSchema.shape.requirements
          .unwrap()
          .element.omit({ lengthAllowanceMm: true }),
      )
      .max(1000)
      .default([]),
    plan: allocationDraftDataSchema.shape.plan,
  })
  .superRefine(validateDraftAssignments);
export type AllocationDraftInput = z.infer<typeof allocationDraftInputSchema>;

export const createAllocationDraftSchema = z.strictObject({
  data: allocationDraftInputSchema,
});
export const allocationDraftRevisionSchema = z.strictObject({
  expectedRevision: revision,
});
export const updateAllocationDraftSchema = allocationDraftRevisionSchema.extend(
  { data: allocationDraftInputSchema },
);
export const allocationDraftSummarySchema = z.object({
  id,
  state: z.literal('draft'),
  orderNumber: z.string().nullable(),
  createdByUserId: id,
  revision,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  completedAt: z.null(),
  cancelledAt: z.null(),
  needsReplanning: z.literal(false),
});
export const allocationDraftSchema = allocationDraftSummarySchema.extend({
  data: allocationDraftDataSchema,
});
export const allocationRecordSchema = z.discriminatedUnion('state', [
  allocationDetailSchema,
  allocationDraftSchema,
]);
export type AllocationDraftData = z.infer<typeof allocationDraftDataSchema>;
export const allocationListSchema = z.object({
  items: z.array(
    z.discriminatedUnion('state', [
      allocationSummarySchema,
      allocationDraftSummarySchema,
    ]),
  ),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type OptimizeAllocation = z.infer<typeof optimizeAllocationSchema>;
export type ValidateAllocation = z.infer<typeof validateAllocationSchema>;
export type CreateAllocation = z.infer<typeof createAllocationSchema>;
export type ReplaceAllocation = z.infer<typeof replaceAllocationSchema>;
export type CompleteAllocation = z.infer<typeof completeAllocationSchema>;
export type AllocationQuery = z.infer<typeof allocationQuerySchema>;
export type AllocationCompletion = z.infer<typeof allocationCompletionSchema>;

const planningStock = z.array(stockItemSchema);
export const allocationValidationSchema = z.discriminatedUnion('valid', [
  z.object({
    valid: z.literal(true),
    summary: cuttingPlanSummarySchema,
    stockItems: planningStock,
  }),
  z.object({
    valid: z.literal(false),
    issues: z.array(
      z.object({ code: z.string(), path: z.string(), message: z.string() }),
    ),
    stockItems: planningStock,
  }),
]);
export const allocationOptimizationSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('feasible'),
    plan: cuttingPlanSchema,
    summary: cuttingPlanSummarySchema,
    stockItems: planningStock,
  }),
  z.object({ status: z.literal('infeasible'), stockItems: planningStock }),
  z.object({
    status: z.literal('unknown'),
    reason: z.enum(['search_limit', 'model_limit']),
    stockItems: planningStock,
  }),
]);
export type AllocationDetail = z.infer<typeof allocationDetailSchema>;
export type AllocationList = z.infer<typeof allocationListSchema>;
export type AllocationValidation = z.infer<typeof allocationValidationSchema>;
export type AllocationOptimization = z.infer<
  typeof allocationOptimizationSchema
>;

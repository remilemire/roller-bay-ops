import { z } from 'zod';

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

// Each drop is cut across the stock first. Items are ordered left to right;
// quantities represent adjacent copies. Rotation and nesting are not supported.
export const cuttingPlanSchema = z.strictObject({
  drops: z
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

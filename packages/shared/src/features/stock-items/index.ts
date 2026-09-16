import { z } from 'zod';

const dimension = z.number().nonnegative().max(999999999.999).multipleOf(0.001);
const positiveDimension = dimension.positive();
const nullableDimension = dimension.nullable();
const tubeDiameter = z
  .number()
  .int()
  .positive()
  .max(2147483647)
  .multipleOf(5)
  .nullable();
const fields = {
  fabricColorId: z.uuid(),
  isRemnant: z.boolean(),
  isUsed: z.boolean(),
  widthMm: positiveDimension,
  initialLengthMm: positiveDimension,
  explicitLengthMm: nullableDimension,
  radialDepthMm: nullableDimension,
  tubeOuterDiameterMm: tubeDiameter,
  locationId: z.uuid(),
  sourceStockItemId: z.uuid().nullable(),
  consumedAt: z.iso.datetime().nullable(),
};

export const createStockItemSchema = z
  .strictObject({
    ...fields,
    isRemnant: fields.isRemnant.default(false),
    isUsed: fields.isUsed.default(false),
    explicitLengthMm: fields.explicitLengthMm.default(null),
    radialDepthMm: fields.radialDepthMm.default(null),
    tubeOuterDiameterMm: fields.tubeOuterDiameterMm.default(null),
    sourceStockItemId: fields.sourceStockItemId.default(null),
    consumedAt: fields.consumedAt.default(null),
  })
  .superRefine((value, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });
    if (value.isRemnant) {
      if (value.explicitLengthMm === null)
        issue('explicitLengthMm', 'Remnants require an explicit length.');
      if (value.radialDepthMm !== null)
        issue('radialDepthMm', 'Remnants use explicit length, not roll depth.');
      if (value.tubeOuterDiameterMm !== null)
        issue(
          'tubeOuterDiameterMm',
          'Flat remnants do not have a tube diameter.',
        );
    } else {
      if (!value.isUsed && value.tubeOuterDiameterMm !== null)
        issue(
          'tubeOuterDiameterMm',
          'Unused rolls cannot have a tube diameter.',
        );
      if (value.isUsed && value.tubeOuterDiameterMm === null)
        issue('tubeOuterDiameterMm', 'Used rolls require a tube diameter.');
      if (value.explicitLengthMm !== null)
        issue('explicitLengthMm', 'Explicit length is reserved for remnants.');
      if (value.sourceStockItemId !== null)
        issue(
          'sourceStockItemId',
          'Only remnants can reference a source item.',
        );
      if (value.radialDepthMm !== null && value.tubeOuterDiameterMm === null)
        issue(
          'tubeOuterDiameterMm',
          'A roll depth requires its tube diameter.',
        );
    }
  });

// Validate supplied fields here; cross-field rules need the current record and
// are checked by the service after merging the patch under a row lock.
export const updateStockItemSchema = z
  .strictObject(fields)
  .omit({ fabricColorId: true, isRemnant: true, sourceStockItemId: true })
  .partial()
  .refine(
    (value) => Object.values(value).some((field) => field !== undefined),
    'Provide at least one field.',
  );

const queryBoolean = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true');
const queryDimension = z.coerce
  .number()
  .nonnegative()
  .max(999999999.999)
  .multipleOf(0.001);
export const stockItemQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(120).optional(),
  fabricColorId: z.uuid().optional(),
  locationId: z.uuid().optional(),
  sectionId: z.uuid().optional(),
  zoneId: z.uuid().optional(),
  isRemnant: queryBoolean.optional(),
  isConsumed: queryBoolean.default(false),
  minWidthMm: queryDimension.optional(),
  minRemainingLengthMm: queryDimension.optional(),
});

export const stockItemSchema = z.object({
  ...fields,
  id: z.uuid(),
  stockReceiptItemId: z.uuid().nullable(),
  measurementThicknessMm: z
    .number()
    .positive()
    .max(9999999.999)
    .multipleOf(0.001)
    .nullable(),
  remainingLengthMm: dimension,
  fabricColorCode: z.string(),
  materialId: z.uuid(),
  materialName: z.string(),
  manufacturerId: z.uuid(),
  manufacturerName: z.string(),
  locationLabel: z.string(),
  sectionId: z.uuid(),
  sectionLabel: z.string(),
  zoneId: z.uuid(),
  zoneName: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const stockItemListSchema = z.object({
  items: z.array(stockItemSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type CreateStockItem = z.infer<typeof createStockItemSchema>;
export type UpdateStockItem = z.infer<typeof updateStockItemSchema>;
export type StockItemQuery = z.infer<typeof stockItemQuerySchema>;
export type StockItem = z.infer<typeof stockItemSchema>;
export type StockItemList = z.infer<typeof stockItemListSchema>;

const retainedScrapSchema = z.strictObject({
  widthMm: positiveDimension,
  lengthMm: positiveDimension,
  locationId: z.uuid().transform((value) => value.toLowerCase()),
  quantity: z.number().int().min(1).max(100).default(1),
});
const cuttingOutcomeFields = {
  stockItemId: z.uuid().transform((value) => value.toLowerCase()),
  expectedUpdatedAt: z.iso.datetime(),
  scraps: z.array(retainedScrapSchema).max(100).default([]),
};
export const stockCuttingOutcomeSchema = z.discriminatedUnion('outcome', [
  z.strictObject({
    ...cuttingOutcomeFields,
    outcome: z.literal('consumed'),
    tubeOuterDiameterMm: tubeDiameter.unwrap().optional(),
  }),
  z.strictObject({
    ...cuttingOutcomeFields,
    outcome: z.literal('returned-roll'),
    radialDepthMm: positiveDimension,
    tubeOuterDiameterMm: tubeDiameter.unwrap().optional(),
    locationId: z.uuid().transform((value) => value.toLowerCase()),
  }),
  z.strictObject({
    ...cuttingOutcomeFields,
    outcome: z.literal('returned-remnant'),
    widthMm: positiveDimension,
    explicitLengthMm: positiveDimension,
    locationId: z.uuid().transform((value) => value.toLowerCase()),
  }),
]);
export type StockCuttingOutcome = z.infer<typeof stockCuttingOutcomeSchema>;

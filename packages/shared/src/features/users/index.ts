import { z } from 'zod';

export const userRoles = ['user', 'admin', 'owner'] as const;

export const userRoleSchema = z.enum(userRoles);

export type UserRole = z.infer<typeof userRoleSchema>;

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email().max(254));

export const lengthUnits = ['in', 'ft', 'yd', 'mm', 'cm', 'm'] as const;

export const lengthUnitSchema = z.enum(lengthUnits);

export type LengthUnit = z.infer<typeof lengthUnitSchema>;

// Each measurement a user may present in a unit of their choice.
export const measurementFields = [
  'rollWidth',
  'rollLength',
  'blindWidth',
  'finishedDrop',
  'dropAllowance',
  'dropLength',
  'edgeTrim',
  'minimumRemnantWidth',
  'minimumRemnantLength',
  'thickness',
  'radialDepth',
  'tubeDiameter',
] as const;

export const measurementFieldSchema = z.enum(measurementFields);

export type MeasurementField = z.infer<typeof measurementFieldSchema>;

export const measurementUnitsSchema = z.record(
  measurementFieldSchema,
  lengthUnitSchema,
);

export type MeasurementUnits = z.infer<typeof measurementUnitsSchema>;

export const defaultMeasurementUnits: MeasurementUnits = {
  rollWidth: 'in',
  rollLength: 'yd',
  blindWidth: 'in',
  finishedDrop: 'in',
  dropAllowance: 'in',
  dropLength: 'in',
  edgeTrim: 'in',
  minimumRemnantWidth: 'in',
  minimumRemnantLength: 'in',
  thickness: 'mm',
  radialDepth: 'mm',
  tubeDiameter: 'mm',
};

export const updateMeasurementUnitsSchema = z
  .partialRecord(measurementFieldSchema, lengthUnitSchema)
  .refine(
    (value) => Object.keys(value).length > 0,
    'Choose at least one measurement.',
  );

export type UpdateMeasurementUnits = z.infer<
  typeof updateMeasurementUnitsSchema
>;

/**
 * Combine a stored selection with the defaults. Stored values may be partial
 * or predate a change to the offered units; anything unrecognized falls back
 * per field instead of failing the whole user record.
 */
export function resolveMeasurementUnits(stored: unknown): MeasurementUnits {
  const source: Record<string, unknown> =
    typeof stored === 'object' && stored !== null
      ? (stored as Record<string, unknown>)
      : {};
  const units = { ...defaultMeasurementUnits };
  for (const field of measurementFields) {
    const parsed = lengthUnitSchema.safeParse(source[field]);
    if (parsed.success) units[field] = parsed.data;
  }
  return units;
}

export const userSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(120),
  role: userRoleSchema,
  isActive: z.boolean(),
  email: emailSchema,
  createdAt: z.iso.datetime(),
  measurementUnits: measurementUnitsSchema,
});

export type User = z.infer<typeof userSchema>;

export const updateUserActivationSchema = z.strictObject({
  isActive: z.boolean(),
});

export type UpdateUserActivation = z.infer<typeof updateUserActivationSchema>;

export const updateUserRoleSchema = z.strictObject({
  role: userRoleSchema.exclude(['owner']),
});

export type UpdateUserRole = z.infer<typeof updateUserRoleSchema>;

export const transferOwnershipSchema = z.strictObject({
  newOwnerId: z.uuid(),
});

export type TransferOwnership = z.infer<typeof transferOwnershipSchema>;

export const ownershipTransferResultSchema = z.object({
  previousOwner: userSchema,
  newOwner: userSchema,
});

export type OwnershipTransferResult = z.infer<
  typeof ownershipTransferResultSchema
>;

import { z } from 'zod';

const nameSchema = z.string().trim().min(1).max(120);
const labelSchema = z.string().trim().min(1).max(40);
const sortOrderSchema = z.number().int().min(0).max(2147483647);
const editableZone = { name: nameSchema, sortOrder: sortOrderSchema };
const editableLocation = { label: labelSchema, sortOrder: sortOrderSchema };
const nonempty = (value: object) =>
  Object.values(value).some((field) => field !== undefined);

export const moveLocationSchema = z.strictObject({
  targetId: z.uuid(),
  position: z.enum(['before', 'after']),
});
export type MoveLocation = z.infer<typeof moveLocationSchema>;

export const createLocationZoneSchema = z.strictObject({
  ...editableZone,
  sortOrder: sortOrderSchema.default(0),
});
export const createLocationSectionSchema = z.strictObject({
  ...editableLocation,
  zoneId: z.uuid(),
  sortOrder: sortOrderSchema.default(0),
});
export const createLocationSchema = z.strictObject({
  ...editableLocation,
  sectionId: z.uuid(),
  sortOrder: sortOrderSchema.default(0),
});
export const updateLocationZoneSchema = z
  .strictObject(editableZone)
  .partial()
  .refine(nonempty, 'Provide at least one field.');
export const updateLocationSectionSchema = z
  .strictObject(editableLocation)
  .partial()
  .refine(nonempty, 'Provide at least one field.');
export const updateLocationSchema = z
  .strictObject(editableLocation)
  .partial()
  .refine(nonempty, 'Provide at least one field.');

const pagination = {
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(120).optional(),
};
export const locationZoneQuerySchema = z.strictObject(pagination);
export const locationSectionQuerySchema = z.strictObject({
  ...pagination,
  zoneId: z.uuid().optional(),
});
export const locationQuerySchema = z.strictObject({
  ...pagination,
  sectionId: z.uuid().optional(),
  zoneId: z.uuid().optional(),
});

const recordFields = {
  id: z.uuid(),
  sortOrder: sortOrderSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
};
export const locationZoneSchema = z.object({
  ...recordFields,
  name: nameSchema,
});
export const locationSectionSchema = z.object({
  ...recordFields,
  label: labelSchema,
  zoneId: z.uuid(),
  zoneName: nameSchema,
});
export const locationSchema = z.object({
  ...recordFields,
  label: labelSchema,
  sectionId: z.uuid(),
  sectionLabel: labelSchema,
  zoneId: z.uuid(),
  zoneName: nameSchema,
});
const pageFields = {
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
};
export const locationZoneListSchema = z.object({
  ...pageFields,
  items: z.array(locationZoneSchema),
});
export const locationSectionListSchema = z.object({
  ...pageFields,
  items: z.array(locationSectionSchema),
});
export const locationListSchema = z.object({
  ...pageFields,
  items: z.array(locationSchema),
});

export type CreateLocationZone = z.infer<typeof createLocationZoneSchema>;
export type UpdateLocationZone = z.infer<typeof updateLocationZoneSchema>;
export type LocationZoneQuery = z.infer<typeof locationZoneQuerySchema>;
export type LocationZone = z.infer<typeof locationZoneSchema>;
export type LocationZoneList = z.infer<typeof locationZoneListSchema>;
export type CreateLocationSection = z.infer<typeof createLocationSectionSchema>;
export type UpdateLocationSection = z.infer<typeof updateLocationSectionSchema>;
export type LocationSectionQuery = z.infer<typeof locationSectionQuerySchema>;
export type LocationSection = z.infer<typeof locationSectionSchema>;
export type LocationSectionList = z.infer<typeof locationSectionListSchema>;
export type CreateLocation = z.infer<typeof createLocationSchema>;
export type UpdateLocation = z.infer<typeof updateLocationSchema>;
export type LocationQuery = z.infer<typeof locationQuerySchema>;
export type Location = z.infer<typeof locationSchema>;
export type LocationList = z.infer<typeof locationListSchema>;

import { z } from 'zod';

const nameSchema = z.string().trim().min(1).max(120);
export const colorCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9-]{1,10}$/);
export const thicknessMmSchema = z
  .number()
  .positive()
  .max(9999999.999)
  .multipleOf(0.001);

export const createManufacturerSchema = z.strictObject({ name: nameSchema });
export const createFabricMaterialSchema = z.strictObject({
  name: nameSchema,
  manufacturerId: z.uuid(),
});
export const createFabricColorSchema = z.strictObject({
  code: colorCodeSchema,
  materialId: z.uuid(),
  thicknessMm: thicknessMmSchema,
});

const nonempty = (value: object) =>
  Object.values(value).some((field) => field !== undefined);
export const updateManufacturerSchema = createManufacturerSchema
  .partial()
  .refine(nonempty, 'Provide at least one field.');
export const updateFabricMaterialSchema = createFabricMaterialSchema
  .partial()
  .refine(nonempty, 'Provide at least one field.');
export const updateFabricColorSchema = createFabricColorSchema
  .partial()
  .refine(nonempty, 'Provide at least one field.');

const pagination = {
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(120).optional(),
};
export const manufacturerQuerySchema = z.strictObject(pagination);
export const fabricMaterialQuerySchema = z.strictObject({
  ...pagination,
  manufacturerId: z.uuid().optional(),
});
export const fabricColorQuerySchema = z.strictObject({
  ...pagination,
  materialId: z.uuid().optional(),
  manufacturerId: z.uuid().optional(),
});

const recordFields = { id: z.uuid(), createdAt: z.iso.datetime() };
export const manufacturerSchema = z.object({
  ...recordFields,
  name: nameSchema,
});
export const fabricMaterialSchema = z.object({
  ...recordFields,
  name: nameSchema,
  manufacturerId: z.uuid(),
  manufacturerName: nameSchema,
});
export const fabricColorSchema = z.object({
  ...recordFields,
  code: colorCodeSchema,
  thicknessMm: thicknessMmSchema,
  materialId: z.uuid(),
  materialName: nameSchema,
  manufacturerId: z.uuid(),
  manufacturerName: nameSchema,
});
const pageFields = {
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
};
export const manufacturerListSchema = z.object({
  items: z.array(manufacturerSchema),
  ...pageFields,
});
export const fabricMaterialListSchema = z.object({
  items: z.array(fabricMaterialSchema),
  ...pageFields,
});
export const fabricColorListSchema = z.object({
  items: z.array(fabricColorSchema),
  ...pageFields,
});

export type CreateManufacturer = z.infer<typeof createManufacturerSchema>;
export type UpdateManufacturer = z.infer<typeof updateManufacturerSchema>;
export type CreateFabricMaterial = z.infer<typeof createFabricMaterialSchema>;
export type UpdateFabricMaterial = z.infer<typeof updateFabricMaterialSchema>;
export type CreateFabricColor = z.infer<typeof createFabricColorSchema>;
export type UpdateFabricColor = z.infer<typeof updateFabricColorSchema>;
export type ManufacturerQuery = z.infer<typeof manufacturerQuerySchema>;
export type FabricMaterialQuery = z.infer<typeof fabricMaterialQuerySchema>;
export type FabricColorQuery = z.infer<typeof fabricColorQuerySchema>;
export type Manufacturer = z.infer<typeof manufacturerSchema>;
export type FabricMaterial = z.infer<typeof fabricMaterialSchema>;
export type FabricColor = z.infer<typeof fabricColorSchema>;
export type ManufacturerList = z.infer<typeof manufacturerListSchema>;
export type FabricMaterialList = z.infer<typeof fabricMaterialListSchema>;
export type FabricColorList = z.infer<typeof fabricColorListSchema>;

import { z } from 'zod';

// The six-digit production order number (0–9, leading zeros kept). Allocations
// reference work orders by this number.
export const orderNumberSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Must be 6 digits.');
// Furthest step reached; derived, never stored. Fabric is allocated before an
// order is given a ship date, so `scheduled` follows `allocated`.
export const orderStatusSchema = z.enum([
  'new',
  'allocated',
  'scheduled',
  'cut',
  'shipped',
]);

// Orders ship on weekdays. A date-only string parses as UTC midnight, so this
// reads the calendar's weekday whatever the timezone.
export const shipDateSchema = z.iso
  .date()
  .refine(
    (value) => ![0, 6].includes(new Date(value).getUTCDay()),
    'Must be a weekday.',
  );

const revision = z.number().int().positive().max(2147483646);
// A blank note clears the note.
const noteSchema = z
  .string()
  .trim()
  .max(1000)
  .nullable()
  .transform((value) => value || null);

// An order starts without a ship date; it gets one once fabric is allocated.
export const createWorkOrderSchema = z.strictObject({
  orderNumber: orderNumberSchema,
  note: noteSchema.default(null),
});
// The order number is fixed once created. A null ship date takes the order
// off the schedule. `shipped` stamps or clears the shipped milestone; the
// server owns the timestamp.
export const updateWorkOrderSchema = z
  .strictObject({
    expectedRevision: revision,
    shipDate: shipDateSchema.nullable().optional(),
    note: noteSchema.optional(),
    shipped: z.boolean().optional(),
  })
  .refine(
    ({ shipDate, note, shipped }) =>
      [shipDate, note, shipped].some((field) => field !== undefined),
    'Provide at least one field.',
  );
export const deleteWorkOrderSchema = z.strictObject({
  expectedRevision: revision,
});

const id = z.uuid().transform((value) => value.toLowerCase());
const dimension = z.number().positive().max(999999999.999).multipleOf(0.001);
// A blind on the order: its fabric, finished width and drop, and how many.
// Every field is required; a half-entered blind stays in the form.
export const workOrderLineSchema = z.strictObject({
  id,
  fabricColorId: id,
  widthMm: dimension,
  lengthMm: dimension,
  quantity: z.number().int().min(1).max(10000),
});
// The whole list, in order. A saved blind never changes: the list keeps it as
// it is, drops it, or adds a new one, so a changed blind arrives under a new
// id. Plans made for the old one go on saying what they were made for.
export const saveWorkOrderLinesSchema = z
  .strictObject({
    expectedRevision: revision,
    lines: z.array(workOrderLineSchema).max(1000),
  })
  .refine(
    ({ lines }) => new Set(lines.map((line) => line.id)).size === lines.length,
    { path: ['lines'], message: 'Blind IDs must be unique.' },
  );

export const workOrderQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(6).optional(),
  // `open` lists every order that has not shipped; `unscheduled` lists the
  // allocated orders still waiting for a ship date.
  status: z
    .enum(['open', 'unscheduled', ...orderStatusSchema.options])
    .optional(),
  // Inclusive ship-date bounds, for the week and month views.
  shipDateFrom: z.iso.date().optional(),
  shipDateTo: z.iso.date().optional(),
});

export const workOrderSchema = z.object({
  id: z.uuid(),
  orderNumber: z.string(),
  shipDate: z.iso.date().nullable(),
  // The total of its blinds' quantities; zero until blinds are entered.
  quantity: z.number().int().nonnegative(),
  note: z.string().nullable(),
  status: orderStatusSchema,
  createdAt: z.iso.datetime(),
  // When the ship date was set; null while the order has none.
  scheduledAt: z.iso.datetime().nullable(),
  allocatedAt: z.iso.datetime().nullable(),
  cutAt: z.iso.datetime().nullable(),
  shippedAt: z.iso.datetime().nullable(),
  updatedAt: z.iso.datetime(),
  revision: z.number().int().positive(),
});
export const workOrderDetailSchema = workOrderSchema.extend({
  lines: z.array(workOrderLineSchema),
});
export const workOrderListSchema = z.object({
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  items: z.array(workOrderSchema),
});

export type OrderStatus = z.infer<typeof orderStatusSchema>;
export type CreateWorkOrder = z.infer<typeof createWorkOrderSchema>;
export type UpdateWorkOrder = z.infer<typeof updateWorkOrderSchema>;
export type DeleteWorkOrder = z.infer<typeof deleteWorkOrderSchema>;
export type WorkOrderQuery = z.infer<typeof workOrderQuerySchema>;
export type WorkOrder = z.infer<typeof workOrderSchema>;
export type WorkOrderLine = z.infer<typeof workOrderLineSchema>;
export type SaveWorkOrderLines = z.infer<typeof saveWorkOrderLinesSchema>;
export type WorkOrderDetail = z.infer<typeof workOrderDetailSchema>;
export type WorkOrderList = z.infer<typeof workOrderListSchema>;

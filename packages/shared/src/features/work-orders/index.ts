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

// The blinds on the order. An allocation's blinds must add up to it.
export const orderQuantitySchema = z.number().int().min(1).max(1000000);

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
  quantity: orderQuantitySchema,
  note: noteSchema.default(null),
});
// The order number is fixed once created. A null ship date takes the order
// off the schedule. `shipped` stamps or clears the shipped milestone; the
// server owns the timestamp.
export const updateWorkOrderSchema = z
  .strictObject({
    expectedRevision: revision,
    shipDate: shipDateSchema.nullable().optional(),
    quantity: orderQuantitySchema.optional(),
    note: noteSchema.optional(),
    shipped: z.boolean().optional(),
  })
  .refine(
    ({ shipDate, quantity, note, shipped }) =>
      [shipDate, quantity, note, shipped].some((field) => field !== undefined),
    'Provide at least one field.',
  );
export const deleteWorkOrderSchema = z.strictObject({
  expectedRevision: revision,
});

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
  quantity: z.number().int().positive(),
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
export type WorkOrderList = z.infer<typeof workOrderListSchema>;

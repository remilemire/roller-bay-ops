import { z } from 'zod';

// The six-digit production order number (0–9, leading zeros kept). Allocations
// reference scheduled orders by this number.
export const orderNumberSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Must be 6 digits.');
// Furthest milestone reached; derived from the timestamps, never stored.
export const orderStatusSchema = z.enum([
  'scheduled',
  'allocated',
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

export const createScheduledOrderSchema = z.strictObject({
  orderNumber: orderNumberSchema,
  shipDate: shipDateSchema,
  note: noteSchema.default(null),
});
// The order number is fixed once scheduled. `shipped` stamps or clears the
// shipped milestone; the server owns the timestamp.
export const updateScheduledOrderSchema = z
  .strictObject({
    expectedRevision: revision,
    shipDate: shipDateSchema.optional(),
    note: noteSchema.optional(),
    shipped: z.boolean().optional(),
  })
  .refine(
    ({ shipDate, note, shipped }) =>
      [shipDate, note, shipped].some((field) => field !== undefined),
    'Provide at least one field.',
  );
export const deleteScheduledOrderSchema = z.strictObject({
  expectedRevision: revision,
});

export const scheduledOrderQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(6).optional(),
  // `open` lists every order that has not shipped.
  status: z.enum(['open', ...orderStatusSchema.options]).optional(),
  // Inclusive ship-date bounds, for the week and month views.
  shipDateFrom: z.iso.date().optional(),
  shipDateTo: z.iso.date().optional(),
});

export const scheduledOrderSchema = z.object({
  id: z.uuid(),
  orderNumber: z.string(),
  shipDate: z.iso.date(),
  note: z.string().nullable(),
  status: orderStatusSchema,
  scheduledAt: z.iso.datetime(),
  allocatedAt: z.iso.datetime().nullable(),
  cutAt: z.iso.datetime().nullable(),
  shippedAt: z.iso.datetime().nullable(),
  updatedAt: z.iso.datetime(),
  revision: z.number().int().positive(),
});
export const scheduledOrderListSchema = z.object({
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  items: z.array(scheduledOrderSchema),
});

export type OrderStatus = z.infer<typeof orderStatusSchema>;
export type CreateScheduledOrder = z.infer<typeof createScheduledOrderSchema>;
export type UpdateScheduledOrder = z.infer<typeof updateScheduledOrderSchema>;
export type DeleteScheduledOrder = z.infer<typeof deleteScheduledOrderSchema>;
export type ScheduledOrderQuery = z.infer<typeof scheduledOrderQuerySchema>;
export type ScheduledOrder = z.infer<typeof scheduledOrderSchema>;
export type ScheduledOrderList = z.infer<typeof scheduledOrderListSchema>;

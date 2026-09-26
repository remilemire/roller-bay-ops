import { z } from 'zod';
import { purchaseOrderNumberSchema } from '../stock-receipts/index.js';

// The six-digit production order number (0–9, leading zeros kept). Allocations
// reference work orders by this number.
export const orderNumberSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Must be 6 digits.');
// Furthest step reached; derived, never stored. A promised date survives
// allocation cancellation, with missing fabric flagged separately.
export const orderStatusSchema = z.enum([
  'new',
  'allocated',
  'scheduled',
  'cut',
  'assembled',
  'checked',
  'shipped',
  'cancelled',
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

// How many blinds the order has; its allocation's blinds must add up to it.
export const orderQuantitySchema = z.number().int().min(1).max(10000);
// Fabric on its way: the supplier's purchase order and when it should
// arrive, on any day. It lets an order be scheduled before its fabric is
// allocated, and stays on the order afterwards as a record. The number is
// supplier paperwork; it links to no stock receipt.
export const backOrderSchema = z.strictObject({
  purchaseOrderNumber: purchaseOrderNumberSchema,
  estimatedArrivalDate: z.iso.date(),
});
/** Whether a ship date comes too early for fabric still on its way. */
export const shipsBeforeArrival = (
  shipDate: string | null,
  backOrder: BackOrder | null,
) => !!shipDate && !!backOrder && shipDate < backOrder.estimatedArrivalDate;
export const shipDateBeforeArrivalMessage =
  "Must be on or after the fabric's estimated arrival.";
// An order starts unallocated, so a ship date on creation needs a back order.
export const createWorkOrderSchema = z
  .strictObject({
    orderNumber: orderNumberSchema,
    quantity: orderQuantitySchema,
    note: noteSchema.default(null),
    backOrder: backOrderSchema.nullable().default(null),
    shipDate: shipDateSchema.nullable().default(null),
  })
  .superRefine(({ shipDate, backOrder }, ctx) => {
    if (shipDate && !backOrder)
      ctx.addIssue({
        code: 'custom',
        path: ['shipDate'],
        message: 'Enter back-order details to schedule a new order.',
      });
    else if (shipsBeforeArrival(shipDate, backOrder))
      ctx.addIssue({
        code: 'custom',
        path: ['shipDate'],
        message: shipDateBeforeArrivalMessage,
      });
  });
// The order number is fixed once created. A null ship date takes the order
// off the schedule. Production completions have dedicated attributed writes.
export const updateWorkOrderSchema = z
  .strictObject({
    expectedRevision: revision,
    shipDate: shipDateSchema.nullable().optional(),
    quantity: orderQuantitySchema.optional(),
    note: noteSchema.optional(),
    // Null clears it.
    backOrder: backOrderSchema.nullable().optional(),
  })
  .refine(
    ({ shipDate, quantity, note, backOrder }) =>
      [shipDate, quantity, note, backOrder].some(
        (field) => field !== undefined,
      ),
    'Provide at least one field.',
  );
export const deleteWorkOrderSchema = z.strictObject({
  expectedRevision: revision,
});

const id = z.uuid().transform((value) => value.toLowerCase());

export const workOrderQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(6).optional(),
  // `open` lists every order that has not shipped; `unscheduled` lists the
  // allocated or back-ordered orders still waiting for a ship date;
  // `unallocated` lists the
  // open orders an allocation can be made for.
  status: z
    .enum(['open', 'unscheduled', 'unallocated', ...orderStatusSchema.options])
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
  backOrder: backOrderSchema.nullable().default(null),
  status: orderStatusSchema,
  createdAt: z.iso.datetime(),
  // When the ship date was set; null while the order has none.
  scheduledAt: z.iso.datetime().nullable(),
  allocatedAt: z.iso.datetime().nullable(),
  cutAt: z.iso.datetime().nullable(),
  assembledAt: z.iso.datetime().nullable().default(null),
  checkedAt: z.iso.datetime().nullable().default(null),
  shippedAt: z.iso.datetime().nullable(),
  cancelledAt: z.iso.datetime().nullable().default(null),
  cancellationReason: z.string().nullable().default(null),
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
export type BackOrder = z.infer<typeof backOrderSchema>;
export type CreateWorkOrder = z.infer<typeof createWorkOrderSchema>;
export type UpdateWorkOrder = z.infer<typeof updateWorkOrderSchema>;
export type DeleteWorkOrder = z.infer<typeof deleteWorkOrderSchema>;
export type WorkOrderQuery = z.infer<typeof workOrderQuerySchema>;
export type WorkOrder = z.infer<typeof workOrderSchema>;
export type WorkOrderList = z.infer<typeof workOrderListSchema>;

export const orderCancellationSchema = z.strictObject({
  expectedRevision: revision,
  allocationId: id.nullable(),
  expectedAllocationRevision: revision.nullable(),
  worksheetId: id.nullable(),
  expectedWorksheetRevision: revision.nullable(),
  skipCuttingResults: z.boolean().default(false),
  reason: z.string().trim().min(1).max(1000),
});
export const orderCancellationContextSchema = z.object({
  order: workOrderSchema,
  allocation: z
    .object({ id, revision, completedAt: z.iso.datetime().nullable() })
    .nullable(),
  worksheet: z
    .object({ id, revision, submittedAt: z.iso.datetime().nullable() })
    .nullable(),
  outstandingCuttingResults: z.boolean(),
});
export type OrderCancellation = z.infer<typeof orderCancellationSchema>;

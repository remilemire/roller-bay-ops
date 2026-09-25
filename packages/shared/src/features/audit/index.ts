import { z } from 'zod';
import { employeeSchema } from '../employees/index.js';
import {
  completionEmployeeSchema,
  productionCompletionSchema,
  worksheetSchema,
} from '../production/index.js';
import { stockSnapshotSchema } from '../stock-items/index.js';
import { stockReceiptRecordSchema } from '../stock-receipts/index.js';
import {
  allocationDetailSchema,
  allocationDraftSchema,
} from '../allocations/index.js';
import { workOrderSchema } from '../work-orders/index.js';
export const auditRecordTypeSchema = z.enum([
  'employees',
  'production',
  'cutting-worksheets',
  'stock-items',
  'stock-receipts',
  'allocations',
  'work-orders',
]);
// Snapshots recorded while a completion credited exactly one employee.
const legacyProductionSnapshotSchema = productionCompletionSchema
  .omit({ employees: true })
  .extend(completionEmployeeSchema.shape)
  .transform(({ employeeId, employeeName, employeeInitials, ...rest }) => ({
    ...rest,
    employees: [{ employeeId, employeeName, employeeInitials }],
  }));
export const auditSnapshotSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('employees'), value: employeeSchema }),
  z.object({
    type: z.literal('production'),
    value: z.union([
      productionCompletionSchema,
      legacyProductionSnapshotSchema,
    ]),
  }),
  z.object({ type: z.literal('cutting-worksheets'), value: worksheetSchema }),
  z.object({ type: z.literal('stock-items'), value: stockSnapshotSchema }),
  z.object({
    type: z.literal('stock-receipts'),
    value: stockReceiptRecordSchema,
  }),
  z.object({
    type: z.literal('allocations'),
    // Snapshots recorded while allocations named their order by number only.
    value: z.discriminatedUnion('state', [
      allocationDetailSchema.partial({ workOrderId: true }),
      allocationDraftSchema.partial({ workOrderId: true }),
    ]),
  }),
  z.object({
    type: z.literal('work-orders'),
    // Snapshots recorded before orders had a creation time lack it. While an
    // order held its own blinds, a change to them recorded them, and its
    // quantity was their total, zero for an order without any.
    value: workOrderSchema.partial({ createdAt: true }).extend({
      quantity: z.number().int().nonnegative(),
      lines: z
        .array(
          z.object({
            id: z.uuid(),
            fabricColorId: z.uuid(),
            widthMm: z.number(),
            lengthMm: z.number(),
            quantity: z.number().int(),
          }),
        )
        .optional(),
    }),
  }),
]);
export const auditChangeSchema = z.object({
  recordType: auditRecordTypeSchema,
  recordId: z.uuid(),
  before: auditSnapshotSchema.nullable(),
  after: auditSnapshotSchema.nullable(),
});
export const auditEventSchema = z.object({
  id: z.uuid(),
  actorId: z.uuid(),
  actorName: z.string(),
  createdAt: z.iso.datetime(),
  action: z.string(),
  reason: z.string().nullable(),
  changes: z.array(auditChangeSchema),
});
export const historyQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export const historySchema = z.object({
  items: z.array(auditEventSchema),
  total: z.number().int().nonnegative(),
  page: z.number(),
  pageSize: z.number(),
});
export type AuditChange = z.infer<typeof auditChangeSchema>;
export type AuditSnapshot = z.infer<typeof auditSnapshotSchema>;
export type AuditRecordType = z.infer<typeof auditRecordTypeSchema>;

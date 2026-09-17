import { z } from 'zod';
import { stockSnapshotSchema } from '../stock-items/index.js';
import { stockReceiptRecordSchema } from '../stock-receipts/index.js';
import { allocationRecordSchema } from '../allocations/index.js';
export const auditRecordTypeSchema = z.enum([
  'stock-items',
  'stock-receipts',
  'allocations',
]);
export const auditSnapshotSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('stock-items'), value: stockSnapshotSchema }),
  z.object({
    type: z.literal('stock-receipts'),
    value: stockReceiptRecordSchema,
  }),
  z.object({ type: z.literal('allocations'), value: allocationRecordSchema }),
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

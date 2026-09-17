import {
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  uuid,
  varchar,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import type { AuditSnapshot, AuditRecordType } from '@roller-bay/shared/audit';
import type { CorrectionResult } from '@roller-bay/shared/corrections';
export const auditEvents = pgTable('audit_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  // Snapshot identity survives profile renames and is never joined into private user data.
  actorId: uuid('actor_id').notNull(),
  actorName: varchar('actor_name', { length: 120 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  action: varchar('action', { length: 80 }).notNull(),
  reason: varchar('reason', { length: 1000 }),
});
export const auditChanges = pgTable(
  'audit_changes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => auditEvents.id, { onDelete: 'restrict' }),
    position: integer('position').notNull(),
    recordType: varchar('record_type', { length: 32 })
      .$type<AuditRecordType>()
      .notNull(),
    recordId: uuid('record_id').notNull(),
    before: jsonb('before').$type<AuditSnapshot>(),
    after: jsonb('after').$type<AuditSnapshot>(),
  },
  (t) => [
    index('audit_changes_record_idx').on(t.recordType, t.recordId, t.eventId),
    uniqueIndex('audit_changes_event_position_unique').on(
      t.eventId,
      t.position,
    ),
  ],
);
export const correctionRequests = pgTable(
  'correction_requests',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    actorId: uuid('actor_id').notNull(),
    scope: varchar('scope', { length: 80 }).notNull(),
    recordId: uuid('record_id').notNull(),
    key: uuid('key').notNull(),
    requestHash: varchar('request_hash', { length: 64 }).notNull(),
    result: jsonb('result').$type<CorrectionResult>().notNull(),
  },
  (t) => [
    uniqueIndex('correction_requests_scope_key_unique').on(
      t.actorId,
      t.scope,
      t.recordId,
      t.key,
    ),
  ],
);

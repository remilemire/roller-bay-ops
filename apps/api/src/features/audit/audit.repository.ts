import { and, asc, count, desc, eq, inArray } from 'drizzle-orm';
import { Injectable } from '@nestjs/common';
import type { AuditChange, AuditRecordType } from '@roller-bay/shared/audit';
import type { DatabaseTransaction } from '../../database/database.service.js';
import { users } from '../users/users.table.js';
import {
  auditEvents,
  auditChanges,
  correctionRequests,
} from './audit.table.js';
@Injectable()
export class AuditRepository {
  async findActor(tx: DatabaseTransaction, actorId: string) {
    const [actor] = await tx
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, actorId));
    return actor;
  }
  async insertEvent(
    tx: DatabaseTransaction,
    input: typeof auditEvents.$inferInsert,
    changes: AuditChange[],
  ) {
    const [event] = await tx.insert(auditEvents).values(input).returning();
    for (let offset = 0; offset < changes.length; offset += 100)
      await tx.insert(auditChanges).values(
        changes.slice(offset, offset + 100).map((c, i) => ({
          ...c,
          eventId: event!.id,
          position: offset + i,
        })),
      );
    return event!.id;
  }
  async findRequest(
    tx: DatabaseTransaction,
    actorId: string,
    scope: string,
    recordId: string,
    key: string,
  ) {
    const [row] = await tx
      .select()
      .from(correctionRequests)
      .where(
        and(
          eq(correctionRequests.actorId, actorId),
          eq(correctionRequests.scope, scope),
          eq(correctionRequests.recordId, recordId),
          eq(correctionRequests.key, key),
        ),
      );
    return row;
  }
  async insertRequest(
    tx: DatabaseTransaction,
    input: typeof correctionRequests.$inferInsert,
  ) {
    await tx.insert(correctionRequests).values(input);
  }
  async history(
    tx: DatabaseTransaction,
    recordType: AuditRecordType,
    recordId: string,
    query: { page: number; pageSize: number },
  ) {
    const eventIds = tx
      .select({ id: auditChanges.eventId })
      .from(auditChanges)
      .where(
        and(
          eq(auditChanges.recordType, recordType),
          eq(auditChanges.recordId, recordId),
        ),
      );
    const where = inArray(auditEvents.id, eventIds);
    const events = await tx
      .select()
      .from(auditEvents)
      .where(where)
      .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);
    const [total] = await tx
      .select({ total: count() })
      .from(auditEvents)
      .where(where);
    const changes = events.length
      ? await tx
          .select()
          .from(auditChanges)
          .where(
            inArray(
              auditChanges.eventId,
              events.map((e) => e.id),
            ),
          )
          .orderBy(asc(auditChanges.position))
      : [];
    return {
      ...query,
      total: total!.total,
      items: events.map((e) => ({
        ...e,
        createdAt: e.createdAt.toISOString(),
        changes: changes.filter((c) => c.eventId === e.id),
      })),
    };
  }
}

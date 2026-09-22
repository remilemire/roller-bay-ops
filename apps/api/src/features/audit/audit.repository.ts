import type { AuditChange, AuditRecordType } from '@roller-bay/shared/audit';
import { and, asc, count, desc, eq, inArray } from 'drizzle-orm';
import type { DatabaseExecutor } from '../../database/database-executor.js';
import { users } from '../users/users.table.js';
import {
  auditChanges,
  auditEvents,
  correctionRequests,
} from './audit.table.js';
export class AuditRepository {
  constructor(private readonly db: DatabaseExecutor) {}
  async findActor(actorId: string) {
    const [actor] = await this.db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, actorId));
    return actor;
  }
  async insertEvent(
    input: typeof auditEvents.$inferInsert,
    changes: AuditChange[],
  ) {
    const [event] = await this.db.insert(auditEvents).values(input).returning();
    for (let offset = 0; offset < changes.length; offset += 100)
      await this.db.insert(auditChanges).values(
        changes.slice(offset, offset + 100).map((c, i) => ({
          ...c,
          eventId: event!.id,
          position: offset + i,
        })),
      );
    return event!.id;
  }
  async findRequest(
    actorId: string,
    scope: string,
    recordId: string,
    key: string,
  ) {
    const [row] = await this.db
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
  async insertRequest(input: typeof correctionRequests.$inferInsert) {
    await this.db.insert(correctionRequests).values(input);
  }
  async history(
    recordType: AuditRecordType,
    recordId: string,
    query: {
      page: number;
      pageSize: number;
    },
  ) {
    const eventIds = this.db
      .select({ id: auditChanges.eventId })
      .from(auditChanges)
      .where(
        and(
          eq(auditChanges.recordType, recordType),
          eq(auditChanges.recordId, recordId),
        ),
      );
    const where = inArray(auditEvents.id, eventIds);
    const events = await this.db
      .select()
      .from(auditEvents)
      .where(where)
      .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);
    const [total] = await this.db
      .select({ total: count() })
      .from(auditEvents)
      .where(where);
    const changes = events.length
      ? await this.db
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

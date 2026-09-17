import {
  Injectable,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  auditChangeSchema,
  historySchema,
  type AuditChange,
  type AuditRecordType,
} from '@roller-bay/shared/audit';
import {
  correctionResultSchema,
  type CorrectionResult,
} from '@roller-bay/shared/corrections';
import {
  DatabaseService,
  type DatabaseTransaction,
} from '../../database/database.service.js';
import { AuditRepository } from './audit.repository.js';
// Object-key order must not change the identity of a normalized request.
export function canonicalJson(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.entries(value)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
    .join(',')}}`;
}
@Injectable()
export class AuditService {
  constructor(
    private readonly database: DatabaseService,
    private readonly repository: AuditRepository,
  ) {}
  async record(
    tx: DatabaseTransaction,
    actorId: string,
    action: string,
    changes: AuditChange[],
    reason: string | null = null,
  ) {
    const actor = await this.repository.findActor(tx, actorId);
    if (!actor) throw new UnauthorizedException();
    const snapshots = changes.map((c) => auditChangeSchema.parse(c));
    return this.repository.insertEvent(
      tx,
      { actorId, actorName: actor.name, action, reason },
      snapshots,
    );
  }
  async replay(
    tx: DatabaseTransaction,
    actorId: string,
    scope: string,
    recordId: string,
    key: string,
    input: unknown,
  ) {
    const requestHash = createHash('sha256')
      .update(canonicalJson(input))
      .digest('hex');
    const previous = await this.repository.findRequest(
      tx,
      actorId,
      scope,
      recordId,
      key,
    );
    if (previous && previous.requestHash !== requestHash)
      throw new ConflictException(
        'This correction key was used with different changes.',
      );
    return {
      requestHash,
      result: previous ? correctionResultSchema.parse(previous.result) : null,
    };
  }
  async remember(
    tx: DatabaseTransaction,
    actorId: string,
    scope: string,
    recordId: string,
    key: string,
    requestHash: string,
    result: CorrectionResult,
  ) {
    const parsed = correctionResultSchema.parse(result);
    await this.repository.insertRequest(tx, {
      actorId,
      scope,
      recordId,
      key,
      requestHash,
      result: parsed,
    });
    return parsed;
  }
  history(
    type: AuditRecordType,
    id: string,
    query: { page: number; pageSize: number },
  ) {
    return this.database.db.transaction(
      async (tx) =>
        historySchema.parse(await this.repository.history(tx, type, id, query)),
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }
}

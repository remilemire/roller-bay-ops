import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
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
import { createHash } from 'node:crypto';
import type { UnitOfWorkContext } from '../../unit-of-work/unit-of-work-context.js';
import { UnitOfWork } from '../../unit-of-work/unit-of-work.js';
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
  constructor(private readonly unitOfWork: UnitOfWork) {}
  async record(
    context: UnitOfWorkContext,
    actorId: string,
    action: string,
    changes: AuditChange[],
    reason: string | null = null,
  ) {
    const actor = await context.audit.findActor(actorId);
    if (!actor) throw new UnauthorizedException();
    const snapshots = changes.map((c) => auditChangeSchema.parse(c));
    return context.audit.insertEvent(
      { actorId, actorName: actor.name, action, reason },
      snapshots,
    );
  }
  async replay(
    context: UnitOfWorkContext,
    actorId: string,
    scope: string,
    recordId: string,
    key: string,
    input: unknown,
  ) {
    const requestHash = createHash('sha256')
      .update(canonicalJson(input))
      .digest('hex');
    const previous = await context.audit.findRequest(
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
    context: UnitOfWorkContext,
    actorId: string,
    scope: string,
    recordId: string,
    key: string,
    requestHash: string,
    result: CorrectionResult,
  ) {
    const parsed = correctionResultSchema.parse(result);
    await context.audit.insertRequest({
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
    query: {
      page: number;
      pageSize: number;
    },
  ) {
    return this.unitOfWork.readOnlyTransaction(async (context) =>
      historySchema.parse(await context.audit.history(type, id, query)),
    );
  }
}

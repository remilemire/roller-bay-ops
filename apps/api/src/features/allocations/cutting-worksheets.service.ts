import {
  ConflictException,
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import type { z } from 'zod';
import type { worksheetReviewSchema } from '@roller-bay/shared/production';
import { randomUUID } from 'node:crypto';
import {
  worksheetSchema,
  type WorksheetSave,
  type WorksheetSubmit,
} from '@roller-bay/shared/production';
import { sql } from 'drizzle-orm';
import {
  DatabaseService,
  type DatabaseTransaction,
} from '../../database/database.service.js';
import { AuditService, canonicalJson } from '../audit/audit.service.js';
import { EmployeesRepository } from '../employees/employees.repository.js';
import { WorkOrdersRepository } from '../work-orders/work-orders.repository.js';
import { AllocationsRepository } from './allocations.repository.js';
import { AllocationsService } from './allocations.service.js';
import {
  CuttingWorksheetsRepository,
  type WorksheetRow,
} from './cutting-worksheets.repository.js';
import { allocationOperation } from './allocations.operation.js';
export const presentWorksheet = (row: WorksheetRow) =>
  worksheetSchema.parse({
    ...row,
    startedAt: row.startedAt.toISOString(),
    abandonedAt: row.abandonedAt?.toISOString() ?? null,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
  });
@Injectable()
export class CuttingWorksheetsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly allocations: AllocationsService,
    private readonly audit: AuditService,
  ) {}
  private transaction<T>(fn: (tx: DatabaseTransaction) => Promise<T>) {
    return allocationOperation(() =>
      this.database.db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
        await tx.execute(sql`SET LOCAL statement_timeout = '30s'`);
        return fn(tx);
      }),
    );
  }
  private validateDraft(row: WorksheetRow, draft: WorksheetSave['draft']) {
    const ids = row.snapshot.items.map((i) => i.stockItemId);
    if (
      draft.form.items.length !== ids.length ||
      new Set(draft.form.items.map((i) => i.stockItemId)).size !== ids.length ||
      draft.form.items.some((i) => !ids.includes(i.stockItemId))
    )
      throw new BadRequestException(
        'Draft stock must match the cutting sheet.',
      );
    if (draft.checkedCuts.some((i) => i >= row.snapshot.plan.cuts.length))
      throw new BadRequestException('Unknown cut.');
  }
  async findForOrder(id: string) {
    return this.transaction(async (tx) => {
      const row = await new CuttingWorksheetsRepository(tx).forOrder(id);
      return row ? presentWorksheet(row) : null;
    });
  }
  async find(id: string) {
    return this.transaction(async (tx) => {
      const row = await new CuttingWorksheetsRepository(tx).find(id);
      if (!row) throw new NotFoundException('Cutting worksheet not found.');
      return presentWorksheet(row);
    });
  }
  async list() {
    return this.transaction(async (tx) =>
      (await new CuttingWorksheetsRepository(tx).list()).map((row) => {
        const {
          snapshot: _,
          draft: __,
          results: ___,
          ...summary
        } = presentWorksheet(row);
        void _;
        void __;
        void ___;
        return summary;
      }),
    );
  }
  begin(orderId: string, employeeId: string, actor: string) {
    return this.transaction(async (tx) => {
      const repo = new CuttingWorksheetsRepository(tx);
      const allocation = await repo.allocationForOrder(orderId);
      if (!allocation)
        throw new ConflictException('Allocate this order before cutting.');
      // Allocation -> order -> stock is shared with allocation mutations.
      const header = await new AllocationsRepository({ db: tx }).findById(
        allocation.id,
        true,
      );
      if (!header) throw new NotFoundException('Allocation not found.');
      const existing = await repo.forAllocation(allocation.id);
      if (existing) return presentWorksheet(existing);
      const order = await new WorkOrdersRepository({
        db: tx,
      }).findByIdForUpdate(orderId);
      if (!order?.allocatedAt)
        throw new ConflictException('Allocate this order before cutting.');
      if (order.cutAt || order.shippedAt)
        throw new ConflictException('This order is already cut or shipped.');
      const employee = await new EmployeesRepository({ db: tx }).find(
        employeeId,
        true,
      );
      if (!employee?.isActive)
        throw new ConflictException('Choose an active employee.');
      const snapshot = await this.allocations.worksheetSnapshot(
        tx,
        allocation.id,
      );
      const stocks = await repo.lockStock(
        snapshot.items.map((item) => item.stockItemId),
      );
      // Re-read after stock locks: another reconciliation may have finished while waiting.
      const lockedSnapshot = await this.allocations.worksheetSnapshot(
        tx,
        allocation.id,
      );
      if (lockedSnapshot.needsReplanning)
        throw new ConflictException(
          'This allocation needs replanning before cutting.',
        );
      const baselines: WorksheetRow['baselines'] = {};
      for (const stock of stocks) {
        const previous = await repo.latestForStock(stock.id);
        if (previous && !previous.submittedAt)
          throw new ConflictException(
            `Finish and submit the cutting results for order ${previous.orderNumber} before using this fabric again.`,
          );
        const previousOutcome = previous?.results?.items.find(
          (i) => i.stockItemId === stock.id,
        );
        if (
          previous &&
          !previous.reviewedAt &&
          previousOutcome?.outcome === 'consumed'
        )
          throw new ConflictException(
            'This fabric has been reported consumed. Review its cutting results before continuing.',
          );
        baselines[stock.id] = {
          revision: stock.revision,
          predecessorId: previous && !previous.reviewedAt ? previous.id : null,
        };
      }
      const row = await repo.create({
        allocationId: allocation.id,
        workOrderId: orderId,
        orderNumber: order.orderNumber,
        employeeId: employee.id,
        employeeName: employee.name,
        employeeInitials: employee.initials,
        startedByUserId: actor,
        snapshot: lockedSnapshot,
        baselines,
      });
      const result = presentWorksheet(row);
      await this.audit.record(tx, actor, 'cutting.started', [
        {
          recordType: 'cutting-worksheets',
          recordId: row.id,
          before: null,
          after: { type: 'cutting-worksheets', value: result },
        },
      ]);
      return result;
    });
  }
  save(id: string, input: WorksheetSave) {
    return this.transaction(async (tx) => {
      const repo = new CuttingWorksheetsRepository(tx);
      const row = await repo.find(id, true);
      if (!row) throw new NotFoundException('Worksheet not found.');
      if (row.submittedAt || row.abandonedAt)
        throw new ConflictException('This sheet is submitted or abandoned.');
      if (canonicalJson(row.draft) === canonicalJson(input.draft))
        return presentWorksheet(row);
      if (row.revision !== input.expectedRevision)
        throw new ConflictException(
          'Worksheet changed; reload before saving. Your input has been preserved.',
        );
      this.validateDraft(row, input.draft);
      return presentWorksheet(await repo.update(id, { draft: input.draft }));
    });
  }
  submit(id: string, input: WorksheetSubmit, actor: string) {
    return this.transaction(async (tx) => {
      const repo = new CuttingWorksheetsRepository(tx);
      const row = await repo.find(id, true);
      if (!row) throw new NotFoundException('Worksheet not found.');
      if (row.abandonedAt)
        throw new ConflictException('This sheet was abandoned.');
      if (row.submittedAt) {
        if (canonicalJson(row.results) === canonicalJson(input.results))
          return presentWorksheet(row);
        throw new ConflictException('Results already submitted.');
      }
      if (row.revision !== input.expectedRevision)
        throw new ConflictException(
          'Worksheet changed; reload before submitting.',
        );
      if (input.draft) this.validateDraft(row, input.draft);
      const ids = row.snapshot.items.map((i) => i.stockItemId);
      if (
        input.results.expectedRevision !== row.snapshot.revision ||
        input.results.items.length !== ids.length ||
        new Set(input.results.items.map((i) => i.stockItemId)).size !==
          ids.length ||
        input.results.items.some(
          (i) =>
            !ids.includes(i.stockItemId) ||
            i.expectedRevision !== row.baselines[i.stockItemId]?.revision,
        )
      )
        throw new BadRequestException(
          'Results must match the saved cutting sheet and stock revisions.',
        );
      const result = presentWorksheet(
        await repo.update(id, {
          results: input.results,
          ...(input.draft ? { draft: input.draft } : {}),
          submittedAt: new Date(),
          submittedByUserId: actor,
        }),
      );
      await this.audit.record(tx, actor, 'cutting.submitted', [
        {
          recordType: 'cutting-worksheets',
          recordId: id,
          before: { type: 'cutting-worksheets', value: presentWorksheet(row) },
          after: { type: 'cutting-worksheets', value: result },
        },
      ]);
      return result;
    });
  }
  abandon(id: string, expectedRevision: number, reason: string, actor: string) {
    return this.transaction(async (tx) => {
      const repo = new CuttingWorksheetsRepository(tx);
      const initial = await repo.find(id);
      if (!initial) throw new NotFoundException('Worksheet not found.');
      await new AllocationsRepository({ db: tx }).findById(
        initial.allocationId,
        true,
      );
      const order = await new WorkOrdersRepository({
        db: tx,
      }).findByIdForUpdate(initial.workOrderId);
      const row = (await repo.find(id, true))!;
      if (row.abandonedAt) return presentWorksheet(row);
      await repo.lockStock(Object.keys(row.baselines));
      if (
        row.revision !== expectedRevision ||
        row.submittedAt ||
        row.reviewedAt ||
        order?.cutAt ||
        order?.assembledAt ||
        order?.checkedAt ||
        order?.shippedAt ||
        (await repo.hasSuccessors(id))
      )
        throw new ConflictException(
          'Only an unsubmitted sheet with no recorded production or later use can be abandoned.',
        );
      const result = presentWorksheet(
        await repo.update(id, { abandonedAt: new Date() }),
      );
      await this.audit.record(
        tx,
        actor,
        'cutting.abandoned',
        [
          {
            recordType: 'cutting-worksheets',
            recordId: id,
            before: {
              type: 'cutting-worksheets',
              value: presentWorksheet(row),
            },
            after: { type: 'cutting-worksheets', value: result },
          },
        ],
        reason,
      );
      return result;
    });
  }
  returnForCorrection(
    id: string,
    expectedRevision: number,
    reason: string,
    actor: string,
  ) {
    return this.transaction(async (tx) => {
      const repo = new CuttingWorksheetsRepository(tx);
      const row = await repo.find(id, true);
      if (!row) throw new NotFoundException('Worksheet not found.');
      if (
        row.abandonedAt ||
        row.reviewedAt ||
        row.revision !== expectedRevision
      )
        throw new ConflictException(
          'Worksheet changed or has been reconciled.',
        );
      const result = presentWorksheet(
        await repo.update(id, { submittedAt: null, submittedByUserId: null }),
      );
      await this.audit.record(
        tx,
        actor,
        'cutting.returned',
        [
          {
            recordType: 'cutting-worksheets',
            recordId: id,
            before: {
              type: 'cutting-worksheets',
              value: presentWorksheet(row),
            },
            after: { type: 'cutting-worksheets', value: result },
          },
        ],
        reason,
      );
      return result;
    });
  }
  review(
    id: string,
    expectedRevision: number,
    actor: string,
    resolution?: z.infer<typeof worksheetReviewSchema>['resolution'],
  ) {
    return this.transaction(async (tx) => {
      const repo = new CuttingWorksheetsRepository(tx);
      const initial = await repo.find(id);
      if (!initial) throw new NotFoundException('Worksheet not found.');
      await new AllocationsRepository({ db: tx }).findById(
        initial.allocationId,
        true,
      );
      const row = (await repo.find(id, true))!;
      if (row.reviewedAt) return presentWorksheet(row);
      if (
        row.abandonedAt ||
        row.revision !== expectedRevision ||
        !row.results ||
        !row.submittedAt
      )
        throw new ConflictException(
          'Submit results and refresh before reviewing.',
        );
      const stocks = await repo.lockStock(Object.keys(row.baselines));
      const results = structuredClone(resolution?.results ?? row.results);
      if (
        resolution &&
        (results.expectedRevision !== row.snapshot.revision ||
          results.items.length !== Object.keys(row.baselines).length ||
          new Set(results.items.map((i) => i.stockItemId)).size !==
            results.items.length ||
          results.items.some((i) => !row.baselines[i.stockItemId]))
      )
        throw new BadRequestException(
          'Resolution must cover the original stock items.',
        );
      for (const outcome of results.items) {
        const baseline = row.baselines[outcome.stockItemId]!;
        const previous = baseline.predecessorId
          ? await repo.find(baseline.predecessorId)
          : null;
        if (previous && !previous.reviewedAt)
          throw new ConflictException(
            `Review order ${previous.orderNumber} first; it used the same fabric earlier.`,
          );
        const expected = previous
          ? previous.appliedStockRevisions?.[outcome.stockItemId]
          : baseline.revision;
        const stock = stocks.find((s) => s.id === outcome.stockItemId);
        if (
          !resolution &&
          (expected === undefined || stock?.revision !== expected)
        )
          throw new ConflictException(
            'Stock changed outside this cutting sequence. Review the discrepancy before applying these measurements.',
          );
        if (!resolution) outcome.expectedRevision = expected!;
      }
      // Only a reviewed predecessor can advance an observation's revision token.
      await this.allocations.complete(
        row.allocationId,
        results,
        actor,
        randomUUID(),
        tx,
        row.id,
      );
      const updatedStock = await repo.lockStock(Object.keys(row.baselines));
      const result = presentWorksheet(
        await repo.update(id, {
          reviewedAt: new Date(),
          reviewedByUserId: actor,
          appliedStockRevisions: Object.fromEntries(
            updatedStock.map((s) => [s.id, s.revision]),
          ),
        }),
      );
      await this.audit.record(
        tx,
        actor,
        'cutting.reviewed',
        [
          {
            recordType: 'cutting-worksheets',
            recordId: id,
            before: {
              type: 'cutting-worksheets',
              value: presentWorksheet(row),
            },
            after: { type: 'cutting-worksheets', value: result },
          },
        ],
        resolution?.reason ?? null,
      );
      return result;
    });
  }
}

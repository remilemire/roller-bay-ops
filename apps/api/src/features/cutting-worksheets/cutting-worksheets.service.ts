import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { z } from 'zod';
import type {
  WorksheetSave,
  WorksheetSubmit,
  worksheetReviewSchema,
} from '@roller-bay/shared/production';
import type { AllocationDetail } from '@roller-bay/shared/allocations';
import {
  DatabaseService,
  type DatabaseTransaction,
} from '../../database/database.service.js';
import { AuditService, canonicalJson } from '../audit/audit.service.js';
import { EmployeesService } from '../employees/employees.service.js';
import { CuttingWorksheetsRepository } from './cutting-worksheets.repository.js';
import type { WorksheetRecord } from './cutting-worksheets.table.js';
import {
  presentWorksheet,
  presentWorksheetSummary,
} from './cutting-worksheets.presenter.js';
import { worksheetOperation } from './cutting-worksheets.operation.js';
type StockRevision = { id: string; revision: number };
@Injectable()
export class CuttingWorksheetsService {
  constructor(
    private readonly repository: CuttingWorksheetsRepository,
    private readonly database: DatabaseService,
    private readonly employees: EmployeesService,
    private readonly audit: AuditService,
  ) {}
  private operation<T>(
    fn: (tx: DatabaseTransaction) => Promise<T>,
    readOnly = false,
  ) {
    return worksheetOperation(() => this.database.transaction(fn, readOnly));
  }
  private validateDraft(row: WorksheetRecord, draft: WorksheetSave['draft']) {
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
  findForOrder(id: string) {
    return this.operation(async (tx) => {
      const row = await this.repository.forOrder(tx, id);
      return row ? presentWorksheet(row) : null;
    }, true);
  }
  find(id: string) {
    return this.operation(
      async (tx) => presentWorksheet(await this.requireRecord(tx, id)),
      true,
    );
  }
  list() {
    return this.operation(
      async (tx) =>
        (await this.repository.list(tx)).map(presentWorksheetSummary),
      true,
    );
  }
  async requireRecord(tx: DatabaseTransaction, id: string, lock = false) {
    const row = await this.repository.find(tx, id, lock);
    if (!row) throw new NotFoundException('Cutting worksheet not found.');
    return row;
  }
  async forAllocation(tx: DatabaseTransaction, id: string) {
    const row = await this.repository.forAllocation(tx, id);
    return row ? presentWorksheet(row) : null;
  }
  async assertPlanMutable(tx: DatabaseTransaction, allocationId: string) {
    if (await this.repository.forAllocation(tx, allocationId))
      throw new ConflictException(
        'Cutting has begun; resolve the working sheet before changing this allocation.',
      );
  }
  async assertReconciliationAllowed(
    tx: DatabaseTransaction,
    allocationId: string,
    worksheetId?: string,
  ) {
    const row = await this.repository.forAllocation(tx, allocationId);
    if (row && row.id !== worksheetId)
      throw new ConflictException(
        'Review the saved cutting worksheet to reconcile this allocation.',
      );
  }
  async assertStockReconciliationAllowed(
    tx: DatabaseTransaction,
    stockIds: string[],
  ) {
    for (const id of stockIds) {
      const pending = await this.repository.latestForStock(tx, id);
      if (pending && !pending.reviewedAt)
        throw new ConflictException(
          `Review pending cutting results for order ${pending.orderNumber} first.`,
        );
    }
  }
  // The workflow holds allocation, order and sorted stock locks before capturing this sequence.
  async start(
    tx: DatabaseTransaction,
    snapshot: AllocationDetail,
    stocks: StockRevision[],
    employeeId: string,
    actor: string,
  ) {
    const employee = await this.employees.requireActive(tx, employeeId);
    if (snapshot.needsReplanning)
      throw new ConflictException(
        'This allocation needs replanning before cutting.',
      );
    const baselines: WorksheetRecord['baselines'] = {};
    for (const stock of stocks) {
      const previous = await this.repository.latestForStock(tx, stock.id);
      if (previous && !previous.submittedAt)
        throw new ConflictException(
          `Finish and submit the cutting results for order ${previous.orderNumber} before using this fabric again.`,
        );
      const outcome = previous?.results?.items.find(
        (i) => i.stockItemId === stock.id,
      );
      if (previous && !previous.reviewedAt && outcome?.outcome === 'consumed')
        throw new ConflictException(
          'This fabric has been reported consumed. Review its cutting results before continuing.',
        );
      baselines[stock.id] = {
        revision: stock.revision,
        predecessorId: previous && !previous.reviewedAt ? previous.id : null,
      };
    }
    const row = await this.repository.create(tx, {
      allocationId: snapshot.id,
      workOrderId: snapshot.workOrderId,
      orderNumber: snapshot.orderNumber,
      employeeId: employee.id,
      employeeName: employee.name,
      employeeInitials: employee.initials,
      startedByUserId: actor,
      snapshot,
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
  }
  save(id: string, input: WorksheetSave) {
    return this.operation(async (tx) => {
      const row = await this.repository.find(tx, id, true);
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
      return presentWorksheet(
        await this.repository.update(tx, id, { draft: input.draft }),
      );
    });
  }
  submit(id: string, input: WorksheetSubmit, actor: string) {
    return this.operation(async (tx) => {
      const row = await this.repository.find(tx, id, true);
      if (!row) throw new NotFoundException('Worksheet not found.');
      if (row.abandonedAt)
        throw new ConflictException('This sheet was abandoned.');
      if (row.submittedAt) {
        if (
          canonicalJson(row.results) === canonicalJson(input.results) &&
          (!input.draft ||
            canonicalJson(row.draft) === canonicalJson(input.draft))
        )
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
        await this.repository.update(tx, id, {
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
  returnForCorrection(
    id: string,
    expectedRevision: number,
    reason: string,
    actor: string,
  ) {
    return this.operation(async (tx) => {
      const row = await this.repository.find(tx, id, true);
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
        await this.repository.update(tx, id, {
          submittedAt: null,
          submittedByUserId: null,
        }),
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
  async abandon(
    tx: DatabaseTransaction,
    row: WorksheetRecord,
    expectedRevision: number,
    reason: string,
    actor: string,
  ) {
    if (row.abandonedAt) return presentWorksheet(row);
    if (
      row.revision !== expectedRevision ||
      row.submittedAt ||
      row.reviewedAt ||
      (await this.repository.hasSuccessors(tx, row.id))
    )
      throw new ConflictException(
        'Only an unsubmitted sheet with no recorded production or later use can be abandoned.',
      );
    const result = presentWorksheet(
      await this.repository.update(tx, row.id, { abandonedAt: new Date() }),
    );
    await this.audit.record(
      tx,
      actor,
      'cutting.abandoned',
      [
        {
          recordType: 'cutting-worksheets',
          recordId: row.id,
          before: { type: 'cutting-worksheets', value: presentWorksheet(row) },
          after: { type: 'cutting-worksheets', value: result },
        },
      ],
      reason,
    );
    return result;
  }
  async prepareReview(
    tx: DatabaseTransaction,
    row: WorksheetRecord,
    expectedRevision: number,
    stocks: StockRevision[],
    resolution?: z.infer<typeof worksheetReviewSchema>['resolution'],
  ) {
    if (
      row.abandonedAt ||
      row.revision !== expectedRevision ||
      !row.results ||
      !row.submittedAt
    )
      throw new ConflictException(
        'Submit results and refresh before reviewing.',
      );
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
        ? await this.repository.find(tx, baseline.predecessorId)
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
    return results;
  }
  async markReviewed(
    tx: DatabaseTransaction,
    row: WorksheetRecord,
    updatedStock: StockRevision[],
    actor: string,
    reason: string | null,
  ) {
    const result = presentWorksheet(
      await this.repository.update(tx, row.id, {
        reviewedAt: new Date(),
        reviewedByUserId: actor,
        // A fresh physical resolution is not the historical observation preceding
        // already captured successor sheets. Those must resolve their own discrepancy.
        appliedStockRevisions:
          reason === null
            ? Object.fromEntries(updatedStock.map((s) => [s.id, s.revision]))
            : null,
      }),
    );
    const eventId = await this.audit.record(
      tx,
      actor,
      'cutting.reviewed',
      [
        {
          recordType: 'cutting-worksheets',
          recordId: row.id,
          before: { type: 'cutting-worksheets', value: presentWorksheet(row) },
          after: { type: 'cutting-worksheets', value: result },
        },
      ],
      reason,
    );
    return { worksheet: result, eventId };
  }
}

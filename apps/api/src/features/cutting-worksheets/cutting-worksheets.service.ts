import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AllocationDetail } from '@roller-bay/shared/allocations';
import type {
  WorksheetSave,
  WorksheetSubmit,
  worksheetReviewSchema,
} from '@roller-bay/shared/production';
import type { z } from 'zod';
import type { UnitOfWorkContext } from '../../unit-of-work/unit-of-work-context.js';
import { UnitOfWork } from '../../unit-of-work/unit-of-work.js';
import { AuditService, canonicalJson } from '../audit/index.js';
import { EmployeesService } from '../employees/index.js';
import { worksheetOperation } from './cutting-worksheets.operation.js';
import {
  presentWorksheet,
  presentWorksheetSummary,
} from './cutting-worksheets.presenter.js';
import type { WorksheetRecord } from './cutting-worksheets.table.js';
type StockRevision = {
  id: string;
  revision: number;
};
@Injectable()
export class CuttingWorksheetsService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly employees: EmployeesService,
    private readonly audit: AuditService,
  ) {}
  private operation<T>(
    fn: (context: UnitOfWorkContext) => Promise<T>,
    readOnly = false,
  ) {
    return worksheetOperation(() =>
      readOnly
        ? this.unitOfWork.readOnlyTransaction(fn)
        : this.unitOfWork.transaction(fn),
    );
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
    return this.operation(async (context) => {
      const row = await context.cuttingWorksheets.forOrder(id);
      return row ? presentWorksheet(row) : null;
    }, true);
  }
  find(id: string) {
    return this.operation(
      async (context) =>
        presentWorksheet(await this.requireRecord(context, id)),
      true,
    );
  }
  list() {
    return this.operation(
      async (context) =>
        (await context.cuttingWorksheets.list()).map(presentWorksheetSummary),
      true,
    );
  }
  async requireRecord(context: UnitOfWorkContext, id: string, lock = false) {
    const row = await context.cuttingWorksheets.find(id, lock);
    if (!row) throw new NotFoundException('Cutting worksheet not found.');
    return row;
  }
  async forAllocation(context: UnitOfWorkContext, id: string) {
    const row = await context.cuttingWorksheets.forAllocation(id);
    return row ? presentWorksheet(row) : null;
  }
  async assertPlanMutable(context: UnitOfWorkContext, allocationId: string) {
    if (await context.cuttingWorksheets.forAllocation(allocationId))
      throw new ConflictException(
        'Cutting has begun; resolve the working sheet before changing this allocation.',
      );
  }
  async assertReconciliationAllowed(
    context: UnitOfWorkContext,
    allocationId: string,
    worksheetId?: string,
  ) {
    const row = await context.cuttingWorksheets.forAllocation(allocationId);
    if (row && row.id !== worksheetId)
      throw new ConflictException(
        'Review the saved cutting worksheet to reconcile this allocation.',
      );
  }
  async assertStockReconciliationAllowed(
    context: UnitOfWorkContext,
    stockIds: string[],
  ) {
    for (const id of stockIds) {
      const pending = await context.cuttingWorksheets.latestForStock(id);
      if (pending && !pending.reviewedAt && !pending.skippedAt)
        throw new ConflictException(
          `Review pending cutting results for order ${pending.orderNumber} first.`,
        );
    }
  }
  // The workflow holds allocation, order and sorted stock locks before capturing this sequence.
  async start(
    context: UnitOfWorkContext,
    snapshot: AllocationDetail,
    stocks: StockRevision[],
    employeeId: string,
    actor: string,
  ) {
    const employee = await this.employees.requireActive(context, employeeId);
    if (snapshot.needsReplanning)
      throw new ConflictException(
        'This allocation needs replanning before cutting.',
      );
    const baselines: WorksheetRecord['baselines'] = {};
    for (const stock of stocks) {
      const previous = await context.cuttingWorksheets.latestForStock(stock.id);
      if (previous && !previous.submittedAt && !previous.skippedAt)
        throw new ConflictException(
          `Finish and submit the cutting results for order ${previous.orderNumber} before using this fabric again.`,
        );
      const outcome = previous?.results?.items.find(
        (i) => i.stockItemId === stock.id,
      );
      if (
        previous &&
        !previous.reviewedAt &&
        !previous.skippedAt &&
        outcome?.outcome === 'consumed'
      )
        throw new ConflictException(
          'This fabric has been reported consumed. Review its cutting results before continuing.',
        );
      baselines[stock.id] = {
        revision: stock.revision,
        predecessorId: previous && !previous.reviewedAt ? previous.id : null,
      };
    }
    const row = await context.cuttingWorksheets.create({
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
    await this.audit.record(context, actor, 'cutting.started', [
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
    return this.operation(async (context) => {
      const row = await context.cuttingWorksheets.find(id, true);
      if (!row) throw new NotFoundException('Worksheet not found.');
      if (row.submittedAt || row.abandonedAt || row.skippedAt)
        throw new ConflictException('This sheet is submitted or closed.');
      if (canonicalJson(row.draft) === canonicalJson(input.draft))
        return presentWorksheet(row);
      if (row.revision !== input.expectedRevision)
        throw new ConflictException(
          'Worksheet changed; reload before saving. Your input has been preserved.',
        );
      this.validateDraft(row, input.draft);
      return presentWorksheet(
        await context.cuttingWorksheets.update(id, { draft: input.draft }),
      );
    });
  }
  async submitInTransaction(
    context: UnitOfWorkContext,
    id: string,
    input: WorksheetSubmit,
    actor: string,
  ) {
    const row = await context.cuttingWorksheets.find(id, true);
    if (!row) throw new NotFoundException('Worksheet not found.');
    if (row.abandonedAt || row.skippedAt)
      throw new ConflictException(
        'This sheet was closed without recording results.',
      );
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
      (input.results.unusedStockItemIds?.length ?? 0) > 0 ||
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
      await context.cuttingWorksheets.update(id, {
        results: input.results,
        ...(input.draft ? { draft: input.draft } : {}),
        submittedAt: new Date(),
        submittedByUserId: actor,
      }),
    );
    await this.audit.record(context, actor, 'cutting.submitted', [
      {
        recordType: 'cutting-worksheets',
        recordId: id,
        before: { type: 'cutting-worksheets', value: presentWorksheet(row) },
        after: { type: 'cutting-worksheets', value: result },
      },
    ]);
    return result;
  }
  returnForCorrection(
    id: string,
    expectedRevision: number,
    reason: string,
    actor: string,
  ) {
    return this.operation(async (context) => {
      const row = await context.cuttingWorksheets.find(id, true);
      if (!row) throw new NotFoundException('Worksheet not found.');
      if (
        row.abandonedAt ||
        row.skippedAt ||
        row.reviewedAt ||
        row.revision !== expectedRevision
      )
        throw new ConflictException(
          'Worksheet changed or has been reconciled.',
        );
      const result = presentWorksheet(
        await context.cuttingWorksheets.update(id, {
          submittedAt: null,
          submittedByUserId: null,
        }),
      );
      await this.audit.record(
        context,
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
    context: UnitOfWorkContext,
    row: WorksheetRecord,
    expectedRevision: number,
    reason: string,
    actor: string,
  ) {
    if (row.abandonedAt) return presentWorksheet(row);
    if (
      row.skippedAt ||
      row.revision !== expectedRevision ||
      row.submittedAt ||
      row.reviewedAt ||
      (await context.cuttingWorksheets.hasSuccessors(row.id))
    )
      throw new ConflictException(
        'Only an unsubmitted sheet with no recorded production or later use can be abandoned.',
      );
    const result = presentWorksheet(
      await context.cuttingWorksheets.update(row.id, {
        abandonedAt: new Date(),
      }),
    );
    await this.audit.record(
      context,
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
  async closeWithoutReconciliation(
    context: UnitOfWorkContext,
    row: WorksheetRecord,
  ) {
    if (row.reviewedAt || row.abandonedAt || row.skippedAt)
      throw new ConflictException('The cutting worksheet is already resolved.');
    const saved = await context.cuttingWorksheets.update(row.id, {
      skippedAt: new Date(),
    });
    return {
      recordType: 'cutting-worksheets' as const,
      recordId: row.id,
      before: {
        type: 'cutting-worksheets' as const,
        value: presentWorksheet(row),
      },
      after: {
        type: 'cutting-worksheets' as const,
        value: presentWorksheet(saved),
      },
    };
  }
  async prepareReview(
    context: UnitOfWorkContext,
    row: WorksheetRecord,
    expectedRevision: number,
    stocks: StockRevision[],
    resolution?: z.infer<typeof worksheetReviewSchema>['resolution'],
  ) {
    if (
      row.abandonedAt ||
      row.skippedAt ||
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
        ? await context.cuttingWorksheets.find(baseline.predecessorId)
        : null;
      if (previous?.skippedAt && !resolution)
        throw new ConflictException(
          'Previous cutting results were skipped. Resolve this stock discrepancy using verified measurements.',
        );
      if (previous && !previous.reviewedAt && !previous.skippedAt)
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
    context: UnitOfWorkContext,
    row: WorksheetRecord,
    updatedStock: StockRevision[],
    actor: string,
    reason: string | null,
  ) {
    const result = presentWorksheet(
      await context.cuttingWorksheets.update(row.id, {
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
      context,
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

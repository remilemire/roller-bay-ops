import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CorrectionEligibility } from '@roller-bay/shared/corrections';
import type {
  StockEffect,
  StockSnapshot,
} from '@roller-bay/shared/stock-items';
import type { UnitOfWorkContext } from '../../unit-of-work/unit-of-work-context.js';
import { snapshotWrite, stockSnapshot } from './stock-items.audit.js';
import { stockItemsOperation } from './stock-items.operation.js';
import type { StockItemWrite } from './stock-items.repository.js';
/**
 * The stock side of corrections to recorded workflows: receipts and cutting
 * results correct their own records and apply the stock changes here.
 */
@Injectable()
export class StockCorrectionsService {
  async lockForCorrection(context: UnitOfWorkContext, ids: string[]) {
    const repository = context.stockItems;
    return stockItemsOperation(async () =>
      (await repository.lockRows(ids)).map(stockSnapshot),
    );
  }
  async eligibility(
    context: UnitOfWorkContext,
    effects: StockEffect[],
    ids: string[],
    excludeAllocationId?: string,
  ): Promise<CorrectionEligibility[]> {
    const repository = context.stockItems;
    const refs = await repository.allocationReferences(ids);
    const children = await repository.descendants(ids);
    const baseline = new Map(effects.map((e) => [e.stockItemId, e]));
    const results: CorrectionEligibility[] = [];
    for (const id of ids) {
      const row = await repository.findById(id);
      if (!row) throw new NotFoundException('Stock item not found.');
      const blockers: CorrectionEligibility['blockers'] = [];
      const add = (
        code: CorrectionEligibility['blockers'][number]['code'],
        message: string,
        allocationIds: string[] = [],
        stockItemIds: string[] = [],
      ) => blockers.push({ code, message, allocationIds, stockItemIds });
      const effect = baseline.get(id);
      if (!effect)
        add(
          'legacy',
          'No trustworthy historical stock baseline exists. Use a current-stock adjustment.',
        );
      else if (effect.after.revision !== row.revision)
        add(
          'changed',
          'Stock changed after this workflow. Use a current-stock adjustment.',
        );
      if (row.voidedAt) add('voided', 'This stock record is voided.');
      const active = refs
        .filter((r) => r.stockItemId === id && !r.completedAt)
        .map((r) => r.allocationId);
      const completed = refs
        .filter(
          (r) =>
            r.stockItemId === id &&
            r.completedAt &&
            r.allocationId !== excludeAllocationId &&
            (!effect ||
              r.completedAt.getTime() >
                new Date(effect.after.updatedAt).getTime()),
        )
        .map((r) => r.allocationId);
      const downstream = children
        .filter((r) => r.sourceStockItemId === id && !baseline.has(r.id))
        .map((r) => r.id);
      if (active.length)
        add(
          'reserved',
          'Release or reassign reservations before correcting.',
          active,
        );
      if (completed.length || downstream.length)
        add(
          'downstream',
          'Later production or retained pieces depend on this stock.',
          completed,
          downstream,
        );
      results.push({ stockItemId: id, revision: row.revision, blockers });
    }
    return results;
  }
  async requireCorrectionEligible(
    context: UnitOfWorkContext,
    effects: StockEffect[],
    versions: {
      stockItemId: string;
      expectedRevision: number;
    }[],
    ids: string[],
    excludeAllocationId?: string,
  ) {
    const expected = new Map(
      versions.map((v) => [v.stockItemId, v.expectedRevision]),
    );
    if (expected.size !== versions.length)
      throw new BadRequestException('Duplicate stock revision.');
    const eligibility = await this.eligibility(
      context,
      effects,
      ids,
      excludeAllocationId,
    );
    for (const item of eligibility) {
      if (item.blockers.length)
        throw new ConflictException({
          message: 'Some stock cannot be corrected.',
          issues: item.blockers.map((b) => ({
            code: b.code,
            path: `stock.${item.stockItemId}`,
            message: b.message,
          })),
        });
      if (expected.get(item.stockItemId) !== item.revision)
        throw new ConflictException(
          'Stock changed; refresh before correcting.',
        );
    }
  }
  async applySnapshots(
    context: UnitOfWorkContext,
    changes: {
      before: StockSnapshot | null;
      value: StockSnapshot | StockItemWrite;
    }[],
  ): Promise<StockEffect[]> {
    const repository = context.stockItems;
    const effects: StockEffect[] = [];
    for (const change of changes) {
      const write =
        'id' in change.value ? snapshotWrite(change.value) : change.value;
      const id = change.before?.id ?? (await repository.create(write));
      if (change.before) await repository.update(id, write);
      const after = stockSnapshot((await repository.findById(id))!);
      effects.push({
        calculationThicknessMm: null,
        stockItemId: id,
        sourceStockItemId: after.sourceStockItemId,
        before: change.before,
        after,
      });
    }
    return effects;
  }
}

import { Injectable } from '@nestjs/common';
import {
  allocationDetailSchema,
  allocationDraftDataSchema,
  allocationDraftSchema,
} from '@roller-bay/shared/allocations';
import type { UnitOfWorkContext } from '../../unit-of-work/unit-of-work-context.js';
import { StockItemsService } from '../stock-items/index.js';
import { allocationSummary } from './allocations.presenter.js';
import type {
  AllocationRecord,
  RequirementRow,
} from './allocations.repository.js';
import { CuttingRulesService } from './cutting-rules.service.js';
/** Stored blinds as numbers; a draft's unfinished fields stay null. */
export const requirementsOf = (rows: RequirementRow[]) =>
  rows.map((row) => ({
    id: row.id,
    fabricColorId: row.fabricColorId,
    widthMm: row.widthMm === null ? null : Number(row.widthMm),
    lengthMm: row.lengthMm === null ? null : Number(row.lengthMm),
    quantity: row.quantity,
  }));
/** The public reading of an allocation that every workflow returns. */
@Injectable()
export class AllocationDetailsService {
  constructor(
    private readonly stockItems: StockItemsService,
    private readonly cuttingRules: CuttingRulesService,
  ) {}
  /** A draft's blinds and plan as saved, with the plan's allowance on each blind. */
  async formData(context: UnitOfWorkContext, header: AllocationRecord) {
    return allocationDraftDataSchema.parse({
      requirements: this.cuttingRules.apply(
        requirementsOf(await context.allocations.requirements(header.id)),
        header.settings,
      ).requirements,
      settings: header.settings ?? {},
      plan: await context.allocations.plan(header.id),
    });
  }
  async load(context: UnitOfWorkContext, header: AllocationRecord) {
    if (header.isDraft)
      return allocationDraftSchema.parse({
        ...allocationSummary(header, false),
        data: await this.formData(context, header),
      });
    const items = await context.allocations.items(header.id);
    const stock = await this.stockItems.findForAllocation(context, {
      stockIds: items.map((item) => item.stockItemId!),
    });
    const byId = new Map(stock.map((item) => [item.id, item]));
    const affected = await context.allocations.affectedAllocations(undefined, [
      header.id,
    ]);
    const plan = await context.allocations.plan(header.id);
    const requirements = await context.allocations.requirements(header.id);
    return allocationDetailSchema.parse({
      ...allocationSummary(header, affected.length > 0),
      requirements: this.cuttingRules.apply(
        requirementsOf(requirements),
        header.settings,
      ).requirements,
      plan,
      settings: header.settings,
      plannedSummary: header.plannedSummary,
      completion: header.effectiveCompletion ?? header.completion,
      correctedAt: header.correctedAt?.toISOString() ?? null,
      items: items.map((item) => ({
        ...item,
        reservedLengthMm: Number(item.reservedLengthMm),
        stockItem: byId.get(item.stockItemId!),
      })),
    });
  }
}

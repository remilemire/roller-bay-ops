import { Injectable } from '@nestjs/common';
import {
  allocationDetailSchema,
  allocationDraftDataSchema,
  allocationDraftSchema,
} from '@roller-bay/shared/allocations';
import type { UnitOfWorkContext } from '../../unit-of-work/unit-of-work-context.js';
import { StockItemsService } from '../stock-items/index.js';
import { WorkOrdersService } from '../work-orders/index.js';
import { allocationSummary } from './allocations.presenter.js';
import type { AllocationRecord } from './allocations.repository.js';
import { CuttingRulesService } from './cutting-rules.service.js';
export type OrderLine = Awaited<
  ReturnType<WorkOrdersService['linesById']>
>[number];
export const requirementsOf = (lines: OrderLine[]) =>
  lines.map((line) => ({
    id: line.id,
    fabricColorId: line.fabricColorId,
    widthMm: Number(line.widthMm),
    lengthMm: Number(line.lengthMm),
    quantity: line.quantity,
  }));
/** The public reading of an allocation that every workflow returns. */
@Injectable()
export class AllocationDetailsService {
  constructor(
    private readonly stockItems: StockItemsService,
    private readonly cuttingRules: CuttingRulesService,
    private readonly orders: WorkOrdersService,
  ) {}
  /**
   * A draft reads with the blinds its order has now. An assignment of a
   * blind since taken off the order is left out, so the draft opens, shows
   * what is unplanned, and cannot be confirmed until that is planned again.
   */
  async formData(context: UnitOfWorkContext, header: AllocationRecord) {
    const { lines } = await this.orders.lines(context, header.workOrderId);
    const onOrder = new Set(lines.map((line) => line.id));
    const plan = await context.allocations.plan(header.id);
    return allocationDraftDataSchema.parse({
      requirements: this.cuttingRules.apply(
        requirementsOf(lines),
        header.settings,
      ).requirements,
      settings: header.settings ?? {},
      plan: {
        cuts: plan.cuts.map((cut) => ({
          ...cut,
          items: cut.items.filter((item) => onOrder.has(item.requirementId)),
        })),
      },
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
    // A confirmed plan assigns every blind its order had, and they are fixed
    // while it is live, so the blinds its cuts point at are the blinds it was
    // made for, even after a cancelled order's blinds change.
    const plan = await context.allocations.plan(header.id);
    const lines = await this.orders.linesById(context, [
      ...new Set(
        plan.cuts.flatMap((cut) => cut.items.map((item) => item.requirementId)),
      ),
    ]);
    return allocationDetailSchema.parse({
      ...allocationSummary(header, affected.length > 0),
      requirements: this.cuttingRules.apply(
        requirementsOf(lines),
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

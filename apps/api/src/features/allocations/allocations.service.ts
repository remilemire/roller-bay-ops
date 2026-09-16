/**
 * Reservation-changing writes lock the allocation header, then stock in a
 * common order before checking availability.
 */
import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  allocationDetailSchema,
  allocationDraftSchema,
  allocationDraftDataSchema,
  createAllocationSchema,
  type AllocationDraftData,
  type AllocationQuery,
  type CreateAllocation,
  type ReplaceAllocation,
  type CompleteAllocation,
} from '@roller-bay/shared/allocations';
import { StockItemsService } from '../stock-items/stock-items.service.js';
import type { DatabaseTransaction } from '../../database/database.service.js';
import {
  AllocationsRepository,
  type AllocationRecord,
} from './allocations.repository.js';
import { allocationOperation } from './allocations.operation.js';
import { allocationSummary } from './allocations.presenter.js';
import {
  requireActiveRevision,
  requireDraftRevision,
} from './allocation.rules.js';
import { buildCuttingContext } from './allocation-cutting-context.js';
import { validateCuttingPlan } from './cutting-plan/cutting-plan.validator.js';
import { toLengthUnits } from './cutting-plan/cutting-dimensions.js';

const hash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

@Injectable()
export class AllocationsService {
  constructor(
    private readonly repository: AllocationsRepository,
    private readonly stockItems: StockItemsService,
  ) {}

  create(input: CreateAllocation, userId: string, key: string) {
    const requestHash = hash(input);
    return allocationOperation(() =>
      this.repository.withTransaction(async (repository, tx) => {
        const header = await repository.create({
          orderNumber: input.orderNumber,
          createdByUserId: userId,
          idempotencyKey: key,
          requestHash,
        });
        if (!header) {
          const previous = await repository.findByKey(userId, key);
          if (!previous || previous.requestHash !== requestHash)
            throw new ConflictException(
              'This Idempotency-Key was used for a different allocation.',
            );
          return this.detail(repository, tx, previous);
        }
        return this.confirmPlan(repository, tx, header, input, false);
      }),
    );
  }

  createDraft(data: AllocationDraftData, userId: string, key: string) {
    const requestHash = hash({ mode: 'draft', data });
    return allocationOperation(() =>
      this.repository.withTransaction(async (repository, tx) => {
        const header = await repository.create({
          orderNumber: data.orderNumber,
          settings: data.settings,
          createdByUserId: userId,
          idempotencyKey: key,
          requestHash,
        });
        if (!header) {
          const previous = await repository.findByKey(userId, key);
          if (!previous || previous.requestHash !== requestHash)
            throw new ConflictException(
              'This Idempotency-Key was used for a different allocation.',
            );
          return this.detail(repository, tx, previous);
        }
        await repository.replacePlan(header.id, data);
        return this.detail(repository, tx, header);
      }),
    );
  }

  updateDraft(id: string, revision: number, data: AllocationDraftData) {
    return allocationOperation(() =>
      this.repository.withTransaction(async (repository, tx) => {
        requireDraftRevision(await repository.findById(id, true), revision);
        await repository.replacePlan(id, data);
        const header = await repository.update(id, {
          orderNumber: data.orderNumber,
          settings: data.settings,
        });
        return this.detail(repository, tx, header);
      }),
    );
  }

  deleteDraft(id: string, revision: number) {
    return allocationOperation(() =>
      this.repository.withTransaction(async (repository) => {
        requireDraftRevision(await repository.findById(id, true), revision);
        await repository.delete(id);
      }),
    );
  }

  submitDraft(id: string, revision: number) {
    return allocationOperation(() =>
      this.repository.withTransaction(async (repository, tx) => {
        const header = await repository.findById(id, true);
        if (!header) throw new NotFoundException('Allocation not found.');
        // Match the submitted draft revision before lifecycle checks so a lost
        // response can be retried without reserving fabric again.
        if (!header.isDraft && header.submittedDraftRevision === revision)
          return this.detail(repository, tx, header);
        requireDraftRevision(header, revision);
        const input = createAllocationSchema.safeParse(
          await this.formData(repository, header),
        );
        if (!input.success)
          throw new BadRequestException({
            message: 'Complete all allocation fields before submitting.',
            issues: input.error.issues,
          });
        return this.confirmPlan(repository, tx, header, input.data, true);
      }),
    );
  }

  private async confirmPlan(
    repository: AllocationsRepository,
    tx: DatabaseTransaction,
    header: AllocationRecord,
    input: CreateAllocation,
    fromDraft: boolean,
  ) {
    const summary = await this.validateForWrite(
      repository,
      tx,
      input,
      header.id,
    );
    await repository.replacePlan(header.id, input, summary);
    const saved = fromDraft
      ? await repository.update(header.id, {
          isDraft: false,
          confirmedAt: new Date(),
          submittedDraftRevision: header.revision,
          settings: input.settings,
          plannedSummary: summary,
        })
      : await repository.initializePlan(header.id, input.settings, summary);
    return this.detail(repository, tx, saved);
  }

  replace(id: string, input: ReplaceAllocation) {
    return allocationOperation(() =>
      this.repository.withTransaction(async (repository, tx) => {
        const header = requireActiveRevision(
          await repository.findById(id, true),
          input.expectedRevision,
        );
        const current = await repository.items(id);
        const summary = await this.validateForWrite(
          repository,
          tx,
          input,
          header.id,
          current.map((item) => item.stockItemId!),
        );
        await repository.replacePlan(id, input, summary);
        const saved = await repository.update(id, {
          orderNumber: input.orderNumber,
          settings: input.settings,
          plannedSummary: summary,
        });
        return this.detail(repository, tx, saved);
      }),
    );
  }

  cancel(id: string, revision: number) {
    return allocationOperation(() =>
      this.repository.withTransaction(async (repository, tx) => {
        const header = await repository.findById(id, true);
        if (!header) throw new NotFoundException('Allocation not found.');
        if (header.cancelledAt) return this.detail(repository, tx, header);
        requireActiveRevision(header, revision);
        const items = await repository.items(id);
        await this.stockItems.findForAllocation(tx, {
          stockIds: items.map((item) => item.stockItemId!),
          lock: true,
        });
        return this.detail(
          repository,
          tx,
          await repository.update(id, {
            cancelledAt: new Date(),
          }),
        );
      }),
    );
  }

  complete(id: string, input: CompleteAllocation, userId: string, key: string) {
    const requestHash = hash(input);
    return allocationOperation(() =>
      this.repository.withTransaction(async (repository, tx) => {
        const header = await repository.findById(id, true);
        if (!header) throw new NotFoundException('Allocation not found.');
        // Completion changes stock and creates remnants. Check its replay identity
        // before checking the active revision, which the original commit advanced.
        if (
          header.completedAt &&
          header.completionKey === key &&
          header.completion?.submittedByUserId === userId
        ) {
          if (header.completionRequestHash !== requestHash)
            throw new ConflictException(
              'This completion key was used with different results.',
            );
          return this.detail(repository, tx, header);
        }
        requireActiveRevision(header, input.expectedRevision);
        const allocated = await repository.items(id);
        const ids = allocated.map((item) => item.stockItemId!);
        if (
          new Set(input.items.map((item) => item.stockItemId)).size !==
            input.items.length ||
          input.items.length !== ids.length ||
          input.items.some((item) => !ids.includes(item.stockItemId))
        )
          throw new BadRequestException(
            'Provide exactly one cutting result for every allocated stock item.',
          );
        await this.stockItems.findForAllocation(tx, {
          stockIds: ids,
          lock: true,
        });
        const now = new Date();
        const createdStockItemIds = await this.stockItems.recordCuttingResults(
          input.items,
          tx,
          now,
        );
        let saved = await repository.update(id, {
          completedAt: now,
          completionKey: key,
          completionRequestHash: requestHash,
          completion: {
            submittedByUserId: userId,
            items: input.items,
            createdStockItemIds,
            affectedAllocationIds: [],
          },
        });
        // Retire this order's reservations before looking for shortages in the
        // remaining orders; observed measurements are kept even if stock is short.
        const affectedAllocationIds = await repository.affectedAllocations(ids);
        saved = await repository.saveCompletionFlags(id, {
          ...saved.completion!,
          affectedAllocationIds,
        });
        return this.detail(repository, tx, saved);
      }),
    );
  }

  list(query: AllocationQuery) {
    return allocationOperation(() =>
      this.repository.withTransaction(async (repository) => {
        const result = await repository.list(query);
        const affected = new Set(
          await repository.affectedAllocations(
            undefined,
            result.items.map((item) => item.id),
          ),
        );
        return {
          ...result,
          items: result.items.map((row) =>
            allocationSummary(row, affected.has(row.id)),
          ),
        };
      }, true),
    );
  }
  findById(id: string) {
    return allocationOperation(() =>
      this.repository.withTransaction(async (repository, tx) => {
        const header = await repository.findById(id);
        if (!header) throw new NotFoundException('Allocation not found.');
        return this.detail(repository, tx, header);
      }, true),
    );
  }

  private async validateForWrite(
    repository: AllocationsRepository,
    tx: DatabaseTransaction,
    input: CreateAllocation,
    excludeId?: string,
    previousIds: string[] = [],
  ) {
    await this.stockItems.requireColors(
      input.requirements.map((item) => item.fabricColorId),
      tx,
    );
    const selected = [
      ...new Set(input.plan.drops.map((drop) => drop.stockItemId)),
    ];
    // Replanning releases old stock as well as claiming new stock. Lock their
    // union before excluding this order's existing reservation from availability.
    const locked = await this.stockItems.findForAllocation(tx, {
      stockIds: [...new Set([...selected, ...previousIds])],
      lock: true,
    });
    if (selected.some((id) => !locked.some((stock) => stock.id === id)))
      throw new NotFoundException('A selected stock item does not exist.');
    const reservations = await repository.reservations(selected, excludeId);
    const result = validateCuttingPlan(
      buildCuttingContext(
        input,
        locked.filter((stock) => selected.includes(stock.id)),
        reservations,
      ),
      input.plan,
    );
    if (!result.valid) {
      const conflict = result.issues.some((issue) =>
        ['consumed_stock', 'reserved_remnant', 'length_capacity'].includes(
          issue.code,
        ),
      );
      const error = {
        message: conflict
          ? 'Stock availability changed or is insufficient.'
          : 'Cutting plan is invalid.',
        issues: result.issues,
      };
      if (conflict) throw new ConflictException(error);
      throw new BadRequestException(error);
    }
    // SQL numeric(12,3) must be able to store the validator's aggregate reservation.
    if (
      result.summary.reservations.some(
        (item) => toLengthUnits(item.reservedLengthMm) > 999999999999n,
      )
    )
      throw new BadRequestException(
        'Reservation exceeds the supported stock range.',
      );
    return result.summary;
  }

  private async formData(
    repository: AllocationsRepository,
    header: AllocationRecord,
  ) {
    return allocationDraftDataSchema.parse({
      orderNumber: header.orderNumber,
      requirements: (await repository.requirements(header.id)).map((item) => ({
        id: item.id,
        fabricColorId: item.fabricColorId,
        quantity: item.quantity,
        widthMm: item.widthMm === null ? null : Number(item.widthMm),
        lengthMm: item.lengthMm === null ? null : Number(item.lengthMm),
        lengthAllowanceMm:
          item.lengthAllowanceMm === null
            ? null
            : Number(item.lengthAllowanceMm),
      })),
      settings: header.settings ?? {},
      plan: await repository.plan(header.id),
    });
  }

  private async detail(
    repository: AllocationsRepository,
    tx: DatabaseTransaction,
    header: AllocationRecord,
  ) {
    if (header.isDraft)
      return allocationDraftSchema.parse({
        ...allocationSummary(header, false),
        data: await this.formData(repository, header),
      });
    const items = await repository.items(header.id);
    const stock = await this.stockItems.findForAllocation(tx, {
      stockIds: items.map((item) => item.stockItemId!),
    });
    const byId = new Map(stock.map((item) => [item.id, item]));
    const affected = await repository.affectedAllocations(undefined, [
      header.id,
    ]);
    return allocationDetailSchema.parse({
      ...allocationSummary(header, affected.length > 0),
      requirements: (await repository.requirements(header.id)).map((item) => ({
        id: item.id,
        fabricColorId: item.fabricColorId,
        quantity: item.quantity,
        widthMm: Number(item.widthMm),
        lengthMm: Number(item.lengthMm),
        lengthAllowanceMm: Number(item.lengthAllowanceMm),
      })),
      plan: await repository.plan(header.id),
      settings: header.settings,
      plannedSummary: header.plannedSummary,
      completion: header.completion,
      items: items.map((item) => ({
        ...item,
        reservedLengthMm: Number(item.reservedLengthMm),
        stockItem: byId.get(item.stockItemId!),
      })),
    });
  }
}

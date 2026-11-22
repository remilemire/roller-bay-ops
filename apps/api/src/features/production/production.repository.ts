import type { StationQuery } from '@roller-bay/shared/production';
import type { Station } from '@roller-bay/shared/users';
import {
  and,
  asc,
  count,
  eq,
  exists,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  notInArray,
  getTableColumns,
  type SQL,
  lt,
  not,
  or,
  sql,
} from 'drizzle-orm';
import { recuts } from './recuts.table.js';
import { fabricColors } from '../fabric-catalog/tables.js';
import { allocations, allocationRequirements } from '../allocations/tables.js';
import { cuttingWorksheets } from '../cutting-worksheets/tables.js';
import type { DatabaseExecutor } from '../../database/database-executor.js';
import { milestoneTimestampField, workOrders } from '../work-orders/tables.js';
import type {
  CompletionRecord,
  CompletionValues,
} from './production-completions.table.js';
import {
  productionCompletionEmployees,
  productionCompletions,
} from './production-completions.table.js';
export class ProductionRepository {
  constructor(private readonly db: DatabaseExecutor) {}
  async findRecut(id: string) {
    return (await this.recutRows(eq(recuts.id, id)))[0];
  }
  recutsForPlan(allocationId: string) {
    return this.recutRows(eq(recuts.allocationId, allocationId));
  }
  recutsForOrder(id: string) {
    return this.recutRows(eq(recuts.workOrderId, id));
  }
  private recutRows(condition: SQL) {
    return this.db
      .select({
        ...getTableColumns(recuts),
        sourceId: allocationRequirements.allocationId,
        fabricColorId: fabricColors.id,
        fabricColorCode: fabricColors.code,
        widthMm: sql<number>`${allocationRequirements.widthMm}::float8`,
        lengthMm: sql<number>`${allocationRequirements.lengthMm}::float8`,
        worksheetId: cuttingWorksheets.id,
        needsCorrection: sql<boolean>`${cuttingWorksheets.results} IS NOT NULL AND ${cuttingWorksheets.submittedAt} IS NULL`,
      })
      .from(recuts)
      .innerJoin(
        allocationRequirements,
        eq(allocationRequirements.id, recuts.requirementId),
      )
      .innerJoin(
        fabricColors,
        eq(fabricColors.id, allocationRequirements.fabricColorId),
      )
      .leftJoin(
        cuttingWorksheets,
        and(
          eq(cuttingWorksheets.allocationId, recuts.allocationId),
          isNull(cuttingWorksheets.abandonedAt),
          isNull(cuttingWorksheets.skippedAt),
        ),
      )
      .where(condition)
      .orderBy(asc(recuts.createdAt), asc(recuts.id));
  }
  recutBlinds(orderId: string) {
    return this.db
      .select({
        id: allocationRequirements.id,
        position: allocationRequirements.position,
        fabricColorCode: fabricColors.code,
        widthMm: sql<number>`${allocationRequirements.widthMm}::float8`,
        lengthMm: sql<number>`${allocationRequirements.lengthMm}::float8`,
        quantity: allocationRequirements.quantity,
      })
      .from(allocationRequirements)
      .innerJoin(
        allocations,
        eq(allocations.id, allocationRequirements.allocationId),
      )
      .innerJoin(
        fabricColors,
        eq(fabricColors.id, allocationRequirements.fabricColorId),
      )
      .where(
        and(
          eq(allocations.workOrderId, orderId),
          eq(allocations.isRecut, false),
          eq(allocations.isDraft, false),
          isNull(allocations.releasedAt),
          isNull(allocations.cancelledAt),
        ),
      )
      .orderBy(asc(allocationRequirements.position));
  }
  async createRecut(input: typeof recuts.$inferInsert) {
    const [row] = await this.db
      .insert(recuts)
      .values(input)
      .returning({ id: recuts.id });
    return (await this.recutRows(eq(recuts.id, row!.id)))[0]!;
  }
  async updateRecut(
    id: string,
    values: Pick<typeof recuts.$inferInsert, 'stage' | 'allocationId'>,
  ) {
    await this.db
      .update(recuts)
      .set({ ...values, revision: sql`${recuts.revision}+1` })
      .where(eq(recuts.id, id));
    return (await this.recutRows(eq(recuts.id, id)))[0]!;
  }
  async pendingRecutCount() {
    const [row] = await this.db
      .select({ total: count() })
      .from(recuts)
      .innerJoin(workOrders, eq(workOrders.id, recuts.workOrderId))
      .where(
        and(
          eq(recuts.stage, 'requested'),
          isNull(workOrders.deletedAt),
          isNull(workOrders.cancelledAt),
          isNotNull(workOrders.allocatedAt),
        ),
      );
    return row!;
  }
  async hasUncutRecuts(orderId: string) {
    const rows = await this.db
      .select({ id: recuts.id })
      .from(recuts)
      .where(
        and(
          eq(recuts.workOrderId, orderId),
          inArray(recuts.stage, ['requested', 'cutting']),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }
  async openRecuts(orderId: string) {
    return this.recutRows(
      and(
        eq(recuts.workOrderId, orderId),
        notInArray(recuts.stage, ['accepted', 'withdrawn']),
      )!,
    );
  }
  /** A page of the station's orders by id, with the station's own data. */
  async list(station: Station, query: StationQuery) {
    const stamp = workOrders[milestoneTimestampField[station]];
    // A released plan's sheet is history, even when the same order is allocated again.
    const hasWorksheet = (state: 'any' | 'submitted' | 'returned') =>
      exists(
        this.db
          .select({ id: cuttingWorksheets.id })
          .from(cuttingWorksheets)
          .innerJoin(
            allocations,
            eq(allocations.id, cuttingWorksheets.allocationId),
          )
          .where(
            and(
              eq(cuttingWorksheets.workOrderId, workOrders.id),
              eq(allocations.isRecut, false),
              isNull(allocations.cancelledAt),
              isNull(allocations.releasedAt),
              isNull(cuttingWorksheets.abandonedAt),
              isNull(cuttingWorksheets.skippedAt),
              state === 'returned'
                ? isNotNull(cuttingWorksheets.results)
                : undefined,
              state === 'returned'
                ? isNull(cuttingWorksheets.submittedAt)
                : undefined,
              state === 'submitted'
                ? isNotNull(cuttingWorksheets.submittedAt)
                : undefined,
            ),
          ),
      );
    const recutWork = exists(
      this.db
        .select({ id: recuts.id })
        .from(recuts)
        .leftJoin(
          cuttingWorksheets,
          and(
            eq(cuttingWorksheets.allocationId, recuts.allocationId),
            isNull(cuttingWorksheets.abandonedAt),
            isNull(cuttingWorksheets.skippedAt),
          ),
        )
        .where(
          and(
            eq(recuts.workOrderId, workOrders.id),
            station === 'cutting'
              ? or(
                  inArray(recuts.stage, ['requested', 'cutting']),
                  and(
                    isNotNull(cuttingWorksheets.results),
                    isNull(cuttingWorksheets.submittedAt),
                  ),
                )
              : station === 'assembly' || station === 'checking'
                ? eq(recuts.stage, station)
                : sql`false`,
          ),
        ),
    );
    const where = and(
      query.view === 'recuts'
        ? exists(
            this.db
              .select({ id: recuts.id })
              .from(recuts)
              .where(
                and(
                  eq(recuts.workOrderId, workOrders.id),
                  eq(recuts.stage, 'requested'),
                ),
              ),
          )
        : undefined,
      isNull(workOrders.deletedAt),
      isNull(workOrders.cancelledAt),
      isNotNull(workOrders.allocatedAt),
      query.search
        ? ilike(workOrders.orderNumber, `%${query.search}%`)
        : undefined,
      query.view === 'queue'
        ? or(
            recutWork,
            station === 'cutting' ? hasWorksheet('returned') : undefined,
            and(
              isNull(stamp),
              isNull(workOrders.shippedAt),
              station === 'cutting'
                ? or(
                    workOrders.cutAwaitingRecuts,
                    not(hasWorksheet('submitted')),
                  )
                : undefined,
            ),
          )
        : undefined,
      query.view === 'completed'
        ? and(gte(stamp, new Date(query.from!)), lt(stamp, new Date(query.to!)))
        : undefined,
    );
    const rows = await this.db
      .select({
        id: workOrders.id,
        hasCuttingWorksheet: sql<boolean>`${hasWorksheet('any')}`,
        worksheetNeedsCorrection: sql<boolean>`${hasWorksheet('returned')}`,
      })
      .from(workOrders)
      .where(where)
      .orderBy(asc(workOrders.shipDate), asc(workOrders.orderNumber))
      .limit(25)
      .offset((query.page - 1) * 25);
    const [total] = await this.db
      .select({ total: count() })
      .from(workOrders)
      .where(where);
    const completions = rows.length
      ? await this.withEmployees(
          await this.db
            .select()
            .from(productionCompletions)
            .where(
              inArray(
                productionCompletions.workOrderId,
                rows.map((row) => row.id),
              ),
            ),
        )
      : [];
    const replacements = rows.length
      ? await this.recutRows(
          inArray(
            recuts.workOrderId,
            rows.map((row) => row.id),
          ),
        )
      : [];
    const items = rows.map((row) => ({
      ...row,
      recuts: replacements.filter((r) => r.workOrderId === row.id),
      completions: completions.filter((c) => c.workOrderId === row.id),
    }));
    return { items, total: total!.total, page: query.page, pageSize: 25 };
  }
  async completions(orderId: string) {
    return this.withEmployees(
      await this.db
        .select()
        .from(productionCompletions)
        .where(eq(productionCompletions.workOrderId, orderId)),
    );
  }
  private async withEmployees(
    rows: (typeof productionCompletions.$inferSelect)[],
  ): Promise<CompletionRecord[]> {
    const people = rows.length
      ? await this.db
          .select()
          .from(productionCompletionEmployees)
          .where(
            inArray(
              productionCompletionEmployees.workOrderId,
              rows.map((row) => row.workOrderId),
            ),
          )
          .orderBy(
            asc(productionCompletionEmployees.employeeName),
            asc(productionCompletionEmployees.employeeId),
          )
      : [];
    return rows.map((row) => ({
      ...row,
      employees: people
        .filter(
          (p) => p.workOrderId === row.workOrderId && p.station === row.station,
        )
        .map(({ employeeId, employeeName, employeeInitials }) => ({
          employeeId,
          employeeName,
          employeeInitials,
        })),
    }));
  }
  async save(
    workOrderId: string,
    station: Station,
    values: CompletionValues | null,
  ) {
    if (values) {
      const { employees, ...milestone } = values;
      await this.db
        .insert(productionCompletions)
        .values({ ...milestone, workOrderId, station })
        .onConflictDoUpdate({
          target: [
            productionCompletions.workOrderId,
            productionCompletions.station,
          ],
          set: milestone,
        });
      await this.db
        .delete(productionCompletionEmployees)
        .where(
          and(
            eq(productionCompletionEmployees.workOrderId, workOrderId),
            eq(productionCompletionEmployees.station, station),
          ),
        );
      await this.db
        .insert(productionCompletionEmployees)
        .values(employees.map((e) => ({ ...e, workOrderId, station })));
    } else
      // The cascade removes the credited employees.
      await this.db
        .delete(productionCompletions)
        .where(
          and(
            eq(productionCompletions.workOrderId, workOrderId),
            eq(productionCompletions.station, station),
          ),
        );
  }
}

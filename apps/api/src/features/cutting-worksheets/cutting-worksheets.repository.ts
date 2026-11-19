import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  sql,
} from 'drizzle-orm';
import type { DatabaseExecutor } from '../../database/database-executor.js';
import {
  cuttingWorksheetEmployees,
  cuttingWorksheets,
  type WorksheetEmployee,
  type WorksheetRecord,
} from './cutting-worksheets.table.js';
type WorksheetRow = typeof cuttingWorksheets.$inferSelect;
export class CuttingWorksheetsRepository {
  constructor(private readonly db: DatabaseExecutor) {}
  private async withEmployees(
    rows: WorksheetRow[],
  ): Promise<WorksheetRecord[]> {
    const people = rows.length
      ? await this.db
          .select()
          .from(cuttingWorksheetEmployees)
          .where(
            inArray(
              cuttingWorksheetEmployees.worksheetId,
              rows.map((row) => row.id),
            ),
          )
          .orderBy(
            asc(cuttingWorksheetEmployees.employeeName),
            asc(cuttingWorksheetEmployees.employeeId),
          )
      : [];
    return rows.map((row) => ({
      ...row,
      employees: people
        .filter((p) => p.worksheetId === row.id)
        .map(({ employeeId, employeeName, employeeInitials }) => ({
          employeeId,
          employeeName,
          employeeInitials,
        })),
    }));
  }
  private async first(rows: WorksheetRow[]) {
    return (await this.withEmployees(rows.slice(0, 1)))[0];
  }
  async find(id: string, lock = false) {
    const q = this.db
      .select()
      .from(cuttingWorksheets)
      .where(eq(cuttingWorksheets.id, id));
    return this.first(await (lock ? q.for('no key update') : q));
  }
  async forAllocation(id: string) {
    return this.first(
      await this.db
        .select()
        .from(cuttingWorksheets)
        .where(
          and(
            eq(cuttingWorksheets.allocationId, id),
            isNull(cuttingWorksheets.abandonedAt),
            isNull(cuttingWorksheets.skippedAt),
          ),
        ),
    );
  }
  async forOrder(id: string) {
    return this.first(
      await this.db
        .select()
        .from(cuttingWorksheets)
        .where(
          and(
            eq(cuttingWorksheets.workOrderId, id),
            isNull(cuttingWorksheets.abandonedAt),
            isNull(cuttingWorksheets.skippedAt),
          ),
        )
        .orderBy(desc(cuttingWorksheets.startedAt)),
    );
  }
  async list({ includeIncomplete }: { includeIncomplete: boolean }) {
    return this.withEmployees(
      await this.db
        .select()
        .from(cuttingWorksheets)
        .where(
          and(
            includeIncomplete
              ? undefined
              : isNotNull(cuttingWorksheets.submittedAt),
            isNull(cuttingWorksheets.reviewedAt),
            isNull(cuttingWorksheets.abandonedAt),
            isNull(cuttingWorksheets.skippedAt),
          ),
        )
        .orderBy(asc(cuttingWorksheets.sequence)),
    );
  }
  async hasSuccessors(id: string) {
    return (
      (
        await this.db
          .select({ id: cuttingWorksheets.id })
          .from(cuttingWorksheets)
          .where(
            and(
              isNull(cuttingWorksheets.abandonedAt),
              sql`EXISTS (SELECT 1 FROM jsonb_each(${cuttingWorksheets.baselines}) b WHERE b.value->>'predecessorId' = ${id})`,
            ),
          )
          .limit(1)
      ).length > 0
    );
  }
  async latestForStock(id: string) {
    return this.first(
      await this.db
        .select()
        .from(cuttingWorksheets)
        .where(
          and(
            sql`${cuttingWorksheets.baselines} ? ${id}`,
            isNull(cuttingWorksheets.abandonedAt),
          ),
        )
        .orderBy(desc(cuttingWorksheets.sequence)),
    );
  }
  async create(
    values: typeof cuttingWorksheets.$inferInsert,
    employees: WorksheetEmployee[],
  ) {
    const [row] = await this.db
      .insert(cuttingWorksheets)
      .values(values)
      .returning();
    await this.insertEmployees(row!.id, employees);
    return (await this.first([row!]))!;
  }
  private insertEmployees(worksheetId: string, employees: WorksheetEmployee[]) {
    return this.db
      .insert(cuttingWorksheetEmployees)
      .values(employees.map((e) => ({ ...e, worksheetId })));
  }
  /** Replaces the sheet's employees when given, and advances its revision. */
  async update(
    id: string,
    values: Partial<typeof cuttingWorksheets.$inferInsert>,
    employees?: WorksheetEmployee[],
  ) {
    if (employees) {
      await this.db
        .delete(cuttingWorksheetEmployees)
        .where(eq(cuttingWorksheetEmployees.worksheetId, id));
      await this.insertEmployees(id, employees);
    }
    const [row] = await this.db
      .update(cuttingWorksheets)
      .set({ ...values, revision: sql`${cuttingWorksheets.revision}+1` })
      .where(eq(cuttingWorksheets.id, id))
      .returning();
    return (await this.first([row!]))!;
  }
}

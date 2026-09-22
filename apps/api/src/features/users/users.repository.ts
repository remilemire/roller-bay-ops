import type {
  ColorTheme,
  Station,
  UpdateMeasurementUnits,
  UserQuery,
  UserRole,
} from '@roller-bay/shared/users';
import { asc, count, eq, ilike, or, sql } from 'drizzle-orm';
import type { DatabaseExecutor } from '../../database/database-executor.js';
import type { MicrosoftProfile } from './microsoft-profile.schema.js';
import { UserEmailConflictError } from './users.errors.js';
import { users } from './users.table.js';
export type UserRecord = typeof users.$inferSelect;
function isEmailUniqueViolation(error: unknown): boolean {
  const seen = new Set<object>();
  while (typeof error === 'object' && error !== null && !seen.has(error)) {
    seen.add(error);
    if (
      'code' in error &&
      error.code === '23505' &&
      'constraint' in error &&
      error.constraint === 'users_email_unique'
    )
      return true;
    error = 'cause' in error ? error.cause : undefined;
  }
  return false;
}
export class UsersRepository {
  constructor(private readonly db: DatabaseExecutor) {}
  async findById(id: string) {
    const [user] = await this.db.select().from(users).where(eq(users.id, id));
    return user;
  }
  async list(query: UserQuery) {
    const pattern =
      query.search && `%${query.search.replace(/[\\%_]/g, '\\$&')}%`;
    const where = pattern
      ? or(ilike(users.name, pattern), ilike(users.email, pattern))
      : undefined;
    const items = await this.db
      .select()
      .from(users)
      .where(where)
      .orderBy(asc(users.name), asc(users.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);
    const [result] = await this.db
      .select({ total: count() })
      .from(users)
      .where(where);
    return { items, total: result!.total };
  }
  /** Only the Microsoft subject identifies an existing account. */
  upsertMicrosoftProfile(profile: MicrosoftProfile) {
    return profileQuery(async () => {
      const [user] = await this.db
        .insert(users)
        .values(profile)
        .onConflictDoUpdate({
          target: users.microsoftSubjectId,
          set: { name: profile.name, email: profile.email },
        })
        .returning();
      if (!user)
        throw new Error('The database did not return the synchronized user.');
      return user;
    });
  }
  updateMicrosoftProfile(profile: MicrosoftProfile) {
    return profileQuery(async () => {
      const [user] = await this.db
        .update(users)
        .set({ name: profile.name, email: profile.email })
        .where(eq(users.microsoftSubjectId, profile.microsoftSubjectId))
        .returning();
      return user;
    });
  }
  async findOwner() {
    const [owner] = await this.db
      .select()
      .from(users)
      .where(eq(users.role, 'owner'));
    return owner;
  }
  async setRoleAndStations(id: string, role: UserRole, stations: Station[]) {
    const [row] = await this.db
      .update(users)
      .set({ role, stations })
      .where(eq(users.id, id))
      .returning();
    return row!;
  }
  setRole(id: string, role: UserRole) {
    return this.update(id, { role });
  }
  setActivation(id: string, isActive: boolean) {
    return this.update(id, { isActive });
  }
  // A jsonb concatenation merges the patch in one statement, so concurrent
  // changes to different fields never overwrite each other and no table lock
  // is needed for a user's own preference.
  async setMeasurementUnits(id: string, patch: UpdateMeasurementUnits) {
    const [user] = await this.db
      .update(users)
      .set({
        measurementUnits: sql`${users.measurementUnits} || ${JSON.stringify(patch)}::jsonb`,
      })
      .where(eq(users.id, id))
      .returning();
    if (!user) throw new Error('The user no longer exists.');
    return user;
  }
  setColorTheme(id: string, colorTheme: ColorTheme) {
    return this.update(id, { colorTheme });
  }
  // Serializes owner changes and bootstrap even when no owner row exists.
  lockForAdministration() {
    return this.db.execute(
      sql`LOCK TABLE ${users} IN SHARE ROW EXCLUSIVE MODE`,
    );
  }
  private async update(
    id: string,
    values: {
      role?: UserRole;
      isActive?: boolean;
      colorTheme?: ColorTheme;
    },
  ) {
    const [user] = await this.db
      .update(users)
      .set(values)
      .where(eq(users.id, id))
      .returning();
    if (!user) throw new Error('The user no longer exists.');
    return user;
  }
}
async function profileQuery<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (isEmailUniqueViolation(error))
      throw new UserEmailConflictError({ cause: error });
    throw error;
  }
}

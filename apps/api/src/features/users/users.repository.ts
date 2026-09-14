import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type { UserRole } from '@roller-bay/shared/users';
import { DatabaseService } from '../../database/database.service.js';
import { users } from './users.table.js';
import type { MicrosoftProfile } from './microsoft-profile.schema.js';
import { UserEmailConflictError } from './users.errors.js';

export type UserRecord = typeof users.$inferSelect;

type UsersDatabase = Pick<
  DatabaseService['db'],
  'select' | 'insert' | 'update' | 'execute' | 'transaction'
>;

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

@Injectable()
export class UsersRepository {
  private readonly db: UsersDatabase;

  constructor(@Inject(DatabaseService) connection: { db: UsersDatabase }) {
    this.db = connection.db;
  }

  async findById(id: string) {
    const [user] = await this.db.select().from(users).where(eq(users.id, id));
    return user;
  }

  // Call on the standalone repository: the email-conflict retry requires
  // autocommit queries because a SQL error aborts an explicit transaction.
  async synchronize(profile: MicrosoftProfile) {
    // Only the Microsoft subject identifies an existing account.
    try {
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
    } catch (error) {
      if (!isEmailUniqueViolation(error)) throw error;

      // Concurrent inserts can hit the secondary email index before the
      // subject conflict is resolved. Update only if that subject now exists.
      try {
        const [user] = await this.db
          .update(users)
          .set({ name: profile.name, email: profile.email })
          .where(eq(users.microsoftSubjectId, profile.microsoftSubjectId))
          .returning();
        if (user) return user;
      } catch (retryError) {
        if (!isEmailUniqueViolation(retryError)) throw retryError;
      }
      throw new UserEmailConflictError({ cause: error });
    }
  }

  async findOwner() {
    const [owner] = await this.db
      .select()
      .from(users)
      .where(eq(users.role, 'owner'));
    return owner;
  }

  setRole(id: string, role: UserRole) {
    return this.update(id, { role });
  }

  setActivation(id: string, isActive: boolean) {
    return this.update(id, { isActive });
  }

  async withLockedTransaction<T>(
    operation: (repository: UsersRepository) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
      // This lock serializes all writes to users, including profile updates
      // during login. Reads remain available. It also protects bootstrap when
      // there is no owner row to lock. Keep the callback short and DB-only.
      await tx.execute(sql`LOCK TABLE ${users} IN SHARE ROW EXCLUSIVE MODE`);
      // Reuse this repository's queries on the transaction connection.
      return operation(new UsersRepository({ db: tx }));
    });
  }

  private async update(
    id: string,
    values: { role?: UserRole; isActive?: boolean },
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

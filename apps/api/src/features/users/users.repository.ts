import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import { users } from './users.table.js';
import type { MicrosoftProfile } from './microsoft-profile.schema.js';
import { UserEmailConflictError } from './users.errors.js';

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
  constructor(private readonly database: DatabaseService) {}

  async findById(id: string) {
    const [user] = await this.database.db
      .select()
      .from(users)
      .where(eq(users.id, id));
    return user;
  }

  async synchronize(profile: MicrosoftProfile) {
    // Only the Microsoft subject identifies an existing account.
    try {
      const [user] = await this.database.db
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
        const [user] = await this.database.db
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
}

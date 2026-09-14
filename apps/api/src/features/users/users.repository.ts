import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import { users } from './users.table.js';

export type MicrosoftProfile = Pick<
  typeof users.$inferInsert,
  'microsoftSubjectId' | 'name' | 'email'
>;

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
    // Subject-based upsert is atomic, including simultaneous first logins.
    // Email conflicts with any other subject abort the statement entirely.
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
  }
}

import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { emailSchema, userSchema } from '@roller-bay/shared/users';
import { z } from 'zod';
import { UsersRepository } from './users.repository.js';

export const microsoftProfileSchema = z.object({
  microsoftSubjectId: z.string().min(1).max(255),
  name: z.string().trim().min(1).max(120),
  email: emailSchema,
});

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if ('code' in error && error.code === '23505') return true;
  return (
    'cause' in error && error.cause !== error && isUniqueViolation(error.cause)
  );
}

@Injectable()
export class UsersService {
  constructor(private readonly repository: UsersRepository) {}

  async synchronizeMicrosoftProfile(
    input: z.input<typeof microsoftProfileSchema>,
  ) {
    const profile = microsoftProfileSchema.parse(input);
    try {
      return this.toPublic(await this.repository.synchronize(profile));
    } catch (error) {
      if (isUniqueViolation(error))
        throw new ConflictException(
          'Account profile conflict. Contact an administrator.',
        );
      throw new ServiceUnavailableException('User storage is unavailable.');
    }
  }

  async findById(id: string) {
    try {
      const user = await this.repository.findById(id);
      return user ? this.toPublic(user) : undefined;
    } catch {
      throw new ServiceUnavailableException('User storage is unavailable.');
    }
  }

  private toPublic(user: Awaited<ReturnType<UsersRepository['synchronize']>>) {
    return userSchema.parse({
      ...user,
      createdAt: user.createdAt.toISOString(),
    });
  }
}

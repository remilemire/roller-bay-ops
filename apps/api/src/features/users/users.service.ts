import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { userSchema } from '@roller-bay/shared/users';
import { UsersRepository } from './users.repository.js';
import {
  microsoftProfileSchema,
  type MicrosoftProfileInput,
} from './microsoft-profile.schema.js';
import { UserEmailConflictError } from './users.errors.js';

@Injectable()
export class UsersService {
  constructor(private readonly repository: UsersRepository) {}

  async synchronizeMicrosoftProfile(input: MicrosoftProfileInput) {
    const profile = microsoftProfileSchema.parse(input);
    try {
      return this.toPublic(await this.repository.synchronize(profile));
    } catch (error) {
      if (error instanceof UserEmailConflictError)
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

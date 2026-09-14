import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { userSchema, type User } from '@roller-bay/shared/users';
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
    let user: User;
    try {
      user = this.toPublic(await this.repository.synchronize(profile));
    } catch (error) {
      if (error instanceof UserEmailConflictError)
        throw new ConflictException(
          'Account profile conflict. Contact an administrator.',
        );
      throw new ServiceUnavailableException('User storage is unavailable.');
    }
    if (!user.isActive)
      throw new ForbiddenException('Your account is deactivated.');
    return user;
  }

  async findById(id: string) {
    try {
      const user = await this.repository.findById(id);
      return user ? this.toPublic(user) : undefined;
    } catch {
      throw new ServiceUnavailableException('User storage is unavailable.');
    }
  }

  async setActivation(id: string, isActive: boolean) {
    let user: User | undefined;
    try {
      const updated = await this.repository.setActivation(id, isActive);
      user = updated ? this.toPublic(updated) : undefined;
    } catch {
      throw new ServiceUnavailableException('User storage is unavailable.');
    }
    if (!user) throw new NotFoundException('User not found.');
    return user;
  }

  private toPublic(user: Awaited<ReturnType<UsersRepository['synchronize']>>) {
    return userSchema.parse({
      ...user,
      createdAt: user.createdAt.toISOString(),
    });
  }
}

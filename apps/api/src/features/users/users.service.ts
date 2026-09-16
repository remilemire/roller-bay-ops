import { hasAnyRole } from '../../common/authorization/roles.js';
import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { userSchema, type UserRole } from '@roller-bay/shared/users';
import type { Environment } from '../../config/environment.js';
import { UsersRepository, type UserRecord } from './users.repository.js';
import {
  microsoftProfileSchema,
  type MicrosoftProfileInput,
} from './microsoft-profile.schema.js';
import { UserEmailConflictError } from './users.errors.js';

@Injectable()
export class UsersService {
  constructor(
    private readonly repository: UsersRepository,
    private readonly config: ConfigService<Environment, true>,
  ) {}

  async synchronizeMicrosoftProfile(input: MicrosoftProfileInput) {
    const profile = microsoftProfileSchema.parse(input);
    try {
      const user = await this.repository.synchronize(profile);
      if (!user.isActive)
        throw new ForbiddenException('Your account is deactivated.');
      const bootstrapEmail = this.config.get('BOOTSTRAP_OWNER_EMAIL', {
        infer: true,
      });
      if (
        bootstrapEmail &&
        user.email === bootstrapEmail &&
        user.role !== 'owner'
      ) {
        return await this.repository.withLockedTransaction(async (users) => {
          const current = await this.requireUser(users, user.id);
          if (!current.isActive)
            throw new ForbiddenException('Your account is deactivated.');
          if (current.email !== bootstrapEmail || (await users.findOwner()))
            return this.toPublic(current);
          return this.toPublic(await users.setRole(current.id, 'owner'));
        });
      }
      return this.toPublic(user);
    } catch (error) {
      if (error instanceof UserEmailConflictError)
        throw new ConflictException(
          'Account profile conflict. Contact an administrator.',
        );
      this.rethrowStorageError(error);
    }
  }

  async findById(id: string) {
    try {
      const user = await this.repository.findById(id);
      return user ? this.toPublic(user) : undefined;
    } catch (error) {
      this.rethrowStorageError(error);
    }
  }

  async setActivation(actorId: string, id: string, isActive: boolean) {
    try {
      return await this.repository.withLockedTransaction(async (users) => {
        await this.requireActor(users, actorId, ['admin']);
        const target = await this.requireUser(users, id);
        if (target.role === 'owner' && !isActive)
          throw new ForbiddenException('The owner cannot be deactivated.');
        return this.toPublic(await users.setActivation(id, isActive));
      });
    } catch (error) {
      this.rethrowStorageError(error);
    }
  }

  async transferOwnership(actorId: string, newOwnerId: string) {
    try {
      return await this.repository.withLockedTransaction(async (users) => {
        const currentOwner = await this.requireActor(users, actorId, ['owner']);
        if (actorId === newOwnerId)
          throw new ConflictException(
            'Choose a different user to receive ownership.',
          );
        const recipient = await this.requireUser(users, newOwnerId);
        if (!recipient.isActive)
          throw new ConflictException(
            'Activate the recipient before transferring ownership.',
          );
        // Release the unique owner slot first; both role changes commit together.
        const previousOwner = await users.setRole(currentOwner.id, 'admin');
        const newOwner = await users.setRole(recipient.id, 'owner');
        return {
          previousOwner: this.toPublic(previousOwner),
          newOwner: this.toPublic(newOwner),
        };
      });
    } catch (error) {
      this.rethrowStorageError(error);
    }
  }

  async setRole(actorId: string, id: string, role: 'user' | 'admin') {
    try {
      return await this.repository.withLockedTransaction(async (users) => {
        await this.requireActor(users, actorId, ['admin', 'owner']);
        const target = await this.requireUser(users, id);
        if (target.role === 'owner')
          throw new ForbiddenException(
            'Change the owner through an ownership transfer.',
          );
        return this.toPublic(await users.setRole(id, role));
      });
    } catch (error) {
      this.rethrowStorageError(error);
    }
  }

  private async requireUser(users: UsersRepository, id: string) {
    const user = await users.findById(id);
    if (!user) throw new NotFoundException('User not found.');
    return user;
  }

  private async requireActor(
    users: UsersRepository,
    id: string,
    roles: UserRole[],
  ) {
    const actor = await users.findById(id);
    if (!actor?.isActive || !hasAnyRole(actor.role, roles))
      throw new ForbiddenException('Your role cannot perform this action.');
    return actor;
  }

  private rethrowStorageError(error: unknown): never {
    if (error instanceof HttpException) throw error;
    throw new ServiceUnavailableException('User storage is unavailable.');
  }

  private toPublic(user: UserRecord) {
    return userSchema.parse({
      ...user,
      createdAt: user.createdAt.toISOString(),
    });
  }
}

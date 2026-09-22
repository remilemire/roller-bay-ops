import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  resolveColorTheme,
  resolveMeasurementUnits,
  userSchema,
  type ColorTheme,
  type Station,
  type UpdateMeasurementUnits,
  type UserQuery,
  type UserRole,
} from '@roller-bay/shared/users';
import { hasAnyRole } from '../../common/authorization/roles.js';
import type { Environment } from '../../config/environment.js';
import { UnitOfWork } from '../../unit-of-work/unit-of-work.js';
import {
  microsoftProfileSchema,
  type MicrosoftProfile,
  type MicrosoftProfileInput,
} from './microsoft-profile.schema.js';
import { UserEmailConflictError } from './users.errors.js';
import { UsersRepository, type UserRecord } from './users.repository.js';
@Injectable()
export class UsersService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly repository: UsersRepository,
    private readonly config: ConfigService<Environment, true>,
  ) {}
  async synchronizeMicrosoftProfile(input: MicrosoftProfileInput) {
    const profile = microsoftProfileSchema.parse(input);
    try {
      const user = await this.synchronizeProfile(profile);
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
        return await this.unitOfWork.transaction(async (context) => {
          await context.users.lockForAdministration();
          const current = await this.requireUser(context.users, user.id);
          if (!current.isActive)
            throw new ForbiddenException('Your account is deactivated.');
          if (
            current.email !== bootstrapEmail ||
            (await context.users.findOwner())
          )
            return this.toPublic(current);
          return this.toPublic(
            await context.users.setRole(current.id, 'owner'),
          );
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
  private async synchronizeProfile(profile: MicrosoftProfile) {
    // A failed SQL statement aborts an explicit transaction. Retry against the
    // standalone repository after the first autocommit statement has ended.
    try {
      return await this.repository.upsertMicrosoftProfile(profile);
    } catch (error) {
      if (!(error instanceof UserEmailConflictError)) throw error;
      try {
        const user = await this.repository.updateMicrosoftProfile(profile);
        if (user) return user;
      } catch (retryError) {
        if (!(retryError instanceof UserEmailConflictError)) throw retryError;
      }
      throw error;
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
  async list(query: UserQuery) {
    try {
      const { items, total } = await this.unitOfWork.readOnlyTransaction(
        async (context) => context.users.list(query),
      );
      return {
        items: items.map((user) => this.toPublic(user)),
        total,
        page: query.page,
        pageSize: query.pageSize,
      };
    } catch (error) {
      this.rethrowStorageError(error);
    }
  }
  async setActivation(actorId: string, id: string, isActive: boolean) {
    try {
      return await this.unitOfWork.transaction(async (context) => {
        await context.users.lockForAdministration();
        await this.requireActor(context.users, actorId, ['admin']);
        const target = await this.requireUser(context.users, id);
        if (target.role === 'owner' && !isActive)
          throw new ForbiddenException('The owner cannot be deactivated.');
        return this.toPublic(await context.users.setActivation(id, isActive));
      });
    } catch (error) {
      this.rethrowStorageError(error);
    }
  }
  async transferOwnership(actorId: string, newOwnerId: string) {
    try {
      return await this.unitOfWork.transaction(async (context) => {
        await context.users.lockForAdministration();
        const currentOwner = await this.requireActor(context.users, actorId, [
          'owner',
        ]);
        if (actorId === newOwnerId)
          throw new ConflictException(
            'Choose a different user to receive ownership.',
          );
        const recipient = await this.requireUser(context.users, newOwnerId);
        if (!recipient.isActive)
          throw new ConflictException(
            'Activate the recipient before transferring ownership.',
          );
        // Release the unique owner slot first; both role changes commit together.
        const previousOwner = await context.users.setRole(
          currentOwner.id,
          'admin',
        );
        const newOwner = await context.users.setRole(recipient.id, 'owner');
        return {
          previousOwner: this.toPublic(previousOwner),
          newOwner: this.toPublic(newOwner),
        };
      });
    } catch (error) {
      this.rethrowStorageError(error);
    }
  }
  async setRole(
    actorId: string,
    id: string,
    role: 'station' | 'user' | 'admin',
    stations: Station[] = [],
  ) {
    try {
      return await this.unitOfWork.transaction(async (context) => {
        await context.users.lockForAdministration();
        await this.requireActor(context.users, actorId, ['admin', 'owner']);
        const target = await this.requireUser(context.users, id);
        if (target.role === 'owner')
          throw new ForbiddenException(
            'Change the owner through an ownership transfer.',
          );
        return this.toPublic(
          await context.users.setStationRole(
            id,
            role,
            role === 'station' ? stations : [],
          ),
        );
      });
    } catch (error) {
      this.rethrowStorageError(error);
    }
  }
  async setMeasurementUnits(userId: string, patch: UpdateMeasurementUnits) {
    try {
      return this.toPublic(
        await this.repository.setMeasurementUnits(userId, patch),
      );
    } catch (error) {
      this.rethrowStorageError(error);
    }
  }
  async setColorTheme(userId: string, colorTheme: ColorTheme) {
    try {
      return this.toPublic(
        await this.repository.setColorTheme(userId, colorTheme),
      );
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
    throw new ServiceUnavailableException('User storage is unavailable.', {
      cause: error,
    });
  }
  private toPublic(user: UserRecord) {
    return userSchema.parse({
      ...user,
      createdAt: user.createdAt.toISOString(),
      measurementUnits: resolveMeasurementUnits(user.measurementUnits),
      colorTheme: resolveColorTheme(user.colorTheme),
    });
  }
}

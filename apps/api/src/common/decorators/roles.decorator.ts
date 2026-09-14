import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '@roller-bay/shared/users';

export const REQUIRED_ROLES = 'requiredRoles';
export const Roles = (...roles: UserRole[]) =>
  SetMetadata(REQUIRED_ROLES, roles);

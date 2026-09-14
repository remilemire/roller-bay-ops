import type { UserRole } from '@roller-bay/shared/users';

const rank: Record<UserRole, number> = { user: 0, admin: 1, owner: 2 };

export function hasAnyRole(
  role: UserRole,
  requiredRoles: readonly UserRole[],
): boolean {
  return requiredRoles.some((required) => rank[role] >= rank[required]);
}

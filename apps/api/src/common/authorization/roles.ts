import type { UserRole } from '@roller-bay/shared/users';

// Production access is a separate restricted profile, not a lower staff tier.
// Staff and administrators may still use production workflows, while pending
// accounts receive only endpoints that opt into that role explicitly.
const grantedRoles: Record<UserRole, readonly UserRole[]> = {
  pending: ['pending'],
  production: ['production'],
  staff: ['production', 'staff'],
  admin: ['production', 'staff', 'admin'],
  owner: ['production', 'staff', 'admin', 'owner'],
};

export function hasAnyRole(
  role: UserRole,
  requiredRoles: readonly UserRole[],
): boolean {
  return requiredRoles.some((required) =>
    grantedRoles[role].includes(required),
  );
}

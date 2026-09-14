import { z } from 'zod';

export const userRoles = ['user', 'admin', 'owner'] as const;

export const userRoleSchema = z.enum(userRoles);

export type UserRole = z.infer<typeof userRoleSchema>;

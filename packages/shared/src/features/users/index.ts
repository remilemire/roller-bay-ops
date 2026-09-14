import { z } from 'zod';

export const userRoles = ['user', 'admin', 'owner'] as const;

export const userRoleSchema = z.enum(userRoles);

export type UserRole = z.infer<typeof userRoleSchema>;

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email().max(254));

export const userSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(120),
  role: userRoleSchema,
  isActive: z.boolean(),
  email: emailSchema,
  createdAt: z.iso.datetime(),
});

export type User = z.infer<typeof userSchema>;

export const updateUserActivationSchema = z.strictObject({
  isActive: z.boolean(),
});

export type UpdateUserActivation = z.infer<typeof updateUserActivationSchema>;

import { z } from 'zod';
export const employeeInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  initials: z
    .string()
    .trim()
    .min(1)
    .max(12)
    .transform((v) => v.toUpperCase()),
  isActive: z.boolean().default(true),
  linkedUserId: z.uuid().nullable().default(null),
});
export const employeeSchema = employeeInputSchema.extend({
  id: z.uuid(),
  revision: z.number().int().positive(),
  createdAt: z.iso.datetime(),
});
export const employeeUpdateSchema = employeeInputSchema.extend({
  expectedRevision: z.number().int().positive(),
});
export const employeeListSchema = z.array(employeeSchema);
export type Employee = z.infer<typeof employeeSchema>;
export type EmployeeInput = z.infer<typeof employeeInputSchema>;
export type EmployeeUpdate = z.infer<typeof employeeUpdateSchema>;

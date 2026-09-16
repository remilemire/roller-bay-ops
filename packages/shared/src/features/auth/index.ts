import { z } from 'zod';
import { userSchema } from '../users/index.js';

export const currentUserSchema = userSchema;
export type { User as CurrentUser } from '../users/index.js';

export const loginErrorCodeSchema = z.enum([
  'account_not_eligible',
  'account_inactive',
  'account_conflict',
  'sign_in_failed',
  'unavailable',
]);
export type LoginErrorCode = z.infer<typeof loginErrorCodeSchema>;

import { userSchema } from '../users/index.js';

export const currentUserSchema = userSchema;
export type { User as CurrentUser } from '../users/index.js';

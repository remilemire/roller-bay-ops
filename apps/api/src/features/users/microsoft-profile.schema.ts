import { emailSchema } from '@roller-bay/shared/users';
import { z } from 'zod';

export const microsoftProfileSchema = z.object({
  microsoftSubjectId: z.string().min(1).max(255),
  name: z.string().trim().min(1).max(120),
  email: emailSchema,
});

export type MicrosoftProfileInput = z.input<typeof microsoftProfileSchema>;
export type MicrosoftProfile = z.infer<typeof microsoftProfileSchema>;

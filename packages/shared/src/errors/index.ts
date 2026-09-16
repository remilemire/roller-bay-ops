import { z } from 'zod';

/**
 * One field-level detail attached to an error response. Accepts Zod issues
 * (array paths) and cutting-plan validator issues (dotted string paths); any
 * other keys an issue carries are dropped at the API boundary.
 */
export const errorIssueSchema = z.object({
  code: z.string().optional(),
  path: z
    .union([z.string(), z.array(z.union([z.string(), z.number()]))])
    .optional(),
  message: z.string().min(1),
});

/**
 * Every non-2xx JSON body the API emits. `message` is always curated copy an
 * operator can act on; internal details stay in the API log. Unknown keys are
 * stripped rather than rejected so the rate limiter's middleware-written 429
 * body still parses.
 */
export const apiErrorSchema = z.object({
  statusCode: z.number().int().min(400).max(599),
  message: z.string().min(1),
  issues: z.array(errorIssueSchema).optional(),
});

export type ErrorIssue = z.infer<typeof errorIssueSchema>;
export type ApiErrorBody = z.infer<typeof apiErrorSchema>;

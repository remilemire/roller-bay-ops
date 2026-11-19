import { z } from 'zod';

// Only admission and optional refinement are bounded. No setting truncates
// the placements considered when deciding whether an admitted order fits.
export const planningEnvironment = {
  CUTTING_MAX_BLINDS: z.coerce.number().int().min(1).max(10000).default(512),
  CUTTING_REFINEMENT_SECONDS: z.coerce.number().min(0).max(60).default(5),
  CUTTING_MAX_PATTERNS: z.coerce
    .number()
    .int()
    .positive()
    .max(10000)
    .default(2000),
  CUTTING_MAX_PATTERN_NODES: z.coerce
    .number()
    .int()
    .positive()
    .max(10000000)
    .default(100000),
  CUTTING_MAX_ASSIGNMENTS: z.coerce
    .number()
    .int()
    .positive()
    .max(10000)
    .default(6000),
  ALLOCATION_BODY_LIMIT_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .max(16777216)
    .default(4 * 1024 * 1024),
  CUTTING_QUEUE_NAME: z
    .string()
    .regex(/^[a-zA-Z0-9_-]+$/)
    .default('roller-bay-cutting'),
  CUTTING_JOB_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(1),
  CUTTING_RESULT_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .max(604800)
    .default(3600),
};
export const planningSettingsSchema = z.object(planningEnvironment);
export type PlanningSettings = z.infer<typeof planningSettingsSchema>;
export const planningDefaults = planningSettingsSchema.parse({});

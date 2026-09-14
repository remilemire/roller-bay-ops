import { z } from 'zod';

export const environmentSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  DATABASE_URL: z
    .url()
    .refine(
      (value) => ['postgres:', 'postgresql:'].includes(new URL(value).protocol),
      'DATABASE_URL must be a PostgreSQL connection URL.',
    ),
  REDIS_URL: z
    .url()
    .refine(
      (value) => ['redis:', 'rediss:'].includes(new URL(value).protocol),
      'REDIS_URL must be a Redis connection URL (redis:// or rediss://).',
    ),
  WEB_ORIGIN: z.url().default('http://localhost:3000'),
});

export type Environment = z.infer<typeof environmentSchema>;

export function validateEnvironment(
  values: Record<string, unknown>,
): Environment {
  return environmentSchema.parse(values);
}

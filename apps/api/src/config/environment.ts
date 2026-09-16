import { z } from 'zod';
import {
  cuttingSettingsSchema,
  cuttingRequirementSchema,
} from '@roller-bay/shared/allocations';
import { emailSchema } from '@roller-bay/shared/users';

const httpUrl = z.url().refine((value) => {
  const url = new URL(value);
  return (
    ['http:', 'https:'].includes(url.protocol) &&
    !url.username &&
    !url.password &&
    !url.hash &&
    !url.search
  );
}, 'Must be an HTTP(S) URL without credentials, query, or fragment.');

export const environmentSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    DATABASE_URL: z
      .url()
      .refine(
        (value) =>
          ['postgres:', 'postgresql:'].includes(new URL(value).protocol),
        'DATABASE_URL must be a PostgreSQL connection URL.',
      ),
    REDIS_URL: z
      .url()
      .refine(
        (value) => ['redis:', 'rediss:'].includes(new URL(value).protocol),
        'REDIS_URL must be a Redis connection URL (redis:// or rediss://).',
      ),
    CUTTING_EDGE_TRIM_MM: z.coerce
      .number()
      .pipe(cuttingSettingsSchema.shape.edgeTrimMm)
      .default(25.4),
    CUTTING_MINIMUM_REMNANT_WIDTH_MM: z.coerce
      .number()
      .pipe(cuttingSettingsSchema.shape.minimumRemnantWidthMm)
      .default(1524),
    CUTTING_MINIMUM_REMNANT_LENGTH_MM: z.coerce
      .number()
      .pipe(cuttingSettingsSchema.shape.minimumRemnantLengthMm)
      .default(1524),
    CUTTING_DROP_ALLOWANCE_MM: z
      .preprocess(
        (value) =>
          typeof value === 'string' && value.trim() === '' ? NaN : value,
        z.coerce
          .number()
          .pipe(cuttingRequirementSchema.shape.lengthAllowanceMm),
      )
      .default(254),
    SOLVER_URL: httpUrl
      .default('http://127.0.0.1:8001')
      .refine(
        (value) => new URL(value).pathname === '/',
        'SOLVER_URL must contain only an origin.',
      ),
    SOLVER_API_KEY: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().min(32).optional(),
    ),
    WEB_ORIGIN: httpUrl
      .default('http://localhost:3000')
      .refine(
        (value) => new URL(value).pathname === '/',
        'WEB_ORIGIN must contain only an origin.',
      )
      .transform((value) => new URL(value).origin),
    MICROSOFT_TENANT_ID: z.uuid(),
    MICROSOFT_CLIENT_ID: z.uuid(),
    MICROSOFT_CLIENT_SECRET: z.string().min(1),
    MICROSOFT_CALLBACK_URL: httpUrl.refine(
      (value) => new URL(value).pathname === '/api/auth/callback',
      'Callback path must be /api/auth/callback.',
    ),
    AUTH_ALLOWED_DOMAIN: z
      .string()
      .trim()
      .toLowerCase()
      .regex(
        /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/,
      )
      .max(253),
    BOOTSTRAP_OWNER_EMAIL: z.preprocess(
      (value) =>
        typeof value === 'string' && value.trim() === '' ? undefined : value,
      emailSchema.optional(),
    ),
    RATE_LIMIT_WINDOW_SECONDS: z.coerce
      .number()
      .int()
      .min(1)
      .max(3600)
      .default(60),
    RATE_LIMIT_API_LIMIT: z.coerce
      .number()
      .int()
      .min(1)
      .max(1000000)
      .default(600),
    RATE_LIMIT_LOGIN_LIMIT: z.coerce
      .number()
      .int()
      .min(1)
      .max(1000000)
      .default(30),
    AUTH_SESSION_SECRET: z.string().min(32),
    AUTH_SESSION_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(60)
      .max(2_592_000)
      .default(604_800),
    // Exact proxy IPs/CIDRs, never a blanket trust setting or hop count.
    TRUSTED_PROXY_IPS: z
      .string()
      .default('')
      .transform((value) =>
        value
          .split(',')
          .map((part) => part.trim())
          .filter(Boolean),
      )
      .pipe(z.array(z.union([z.ipv4(), z.ipv6(), z.cidrv4(), z.cidrv6()]))),
  })
  .superRefine((value, ctx) => {
    for (const key of ['WEB_ORIGIN', 'MICROSOFT_CALLBACK_URL'] as const) {
      const url = new URL(value[key]);
      if (
        url.protocol !== 'https:' &&
        (value.NODE_ENV === 'production' ||
          !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
      ) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message:
            'HTTPS is required except on a local development loopback address.',
        });
      }
    }
  });

export type Environment = z.infer<typeof environmentSchema>;

export function validateEnvironment(
  values: Record<string, unknown>,
): Environment {
  return environmentSchema.parse(values);
}

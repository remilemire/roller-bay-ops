// Where the integration suites find PostgreSQL and Redis. The defaults are the
// compose services, whose credentials are already public in compose.yaml, so
// the suites need no shell setup and never read a .env file.
export const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgresql://roller_bay:roller_bay_local@localhost:5434/roller_bay_ops';
export const testRedisUrl =
  process.env.TEST_REDIS_URL ?? 'redis://localhost:6380';

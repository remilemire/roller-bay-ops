import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/features/**/*.table.ts',
  out: './drizzle',
  // Generating SQL needs no live connection; migrate/studio require DATABASE_URL.
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
  strict: true,
  verbose: true,
});

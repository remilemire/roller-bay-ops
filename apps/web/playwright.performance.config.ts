import { defineConfig } from '@playwright/test';
import config from './playwright.config';

// Run separately from functional tests: timing depends on the host's load.
export default defineConfig({
  ...config,
  testDir: './tests/performance',
  outputDir: './test-results/glass-performance',
  workers: 1,
  fullyParallel: false,
  timeout: 120000,
  use: { ...config.use, trace: 'off' },
});

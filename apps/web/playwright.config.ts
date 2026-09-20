import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  // A committed `.only` would silently drop every other browser test.
  forbidOnly: !!process.env.CI,
  use: {
    baseURL: 'http://localhost:3100',
    // Pinned so dates never depend on the machine, and west of Greenwich on
    // purpose: there a calendar day handled as a local time shows as the day
    // before, which is the slip the date helpers exist to prevent.
    timezoneId: 'America/Edmonton',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: 'tablet',
      use: { ...devices['iPad (gen 7)'], defaultBrowserType: 'chromium' },
    },
  ],
  webServer: {
    command: 'npx next dev --port 3100',
    url: 'http://localhost:3100',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});

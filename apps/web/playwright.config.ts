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
    // The production build: it is what ships, and unlike a second `next dev`
    // it does not fight a running dev server for the dev lock.
    command: 'npx next build && npx next start --port 3100',
    url: 'http://localhost:3100',
    // A reused production server is never rebuilt and would serve stale code;
    // a port that is already taken failing the run is the louder mistake.
    reuseExistingServer: false,
    timeout: 180000,
    // Set, not inherited: Next only fills variables that are undefined, so
    // these win over any .env file and a local run builds what CI builds.
    env: { NEXT_PUBLIC_API_URL: '/api', API_ORIGIN: '', API_PROXY_SECRET: '' },
  },
});

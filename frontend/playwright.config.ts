import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against a running stack (real backend + imported data):
 *   E2E_BASE_URL=http://localhost:8081 npx playwright test     (docker compose)
 *   npx playwright test                                        (vite dev server on :5173)
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    locale: 'en-GB',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});

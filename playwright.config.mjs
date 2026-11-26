import { defineConfig, devices } from '@playwright/test';

// Keep the test server isolated from the development server on port 4173.
// Playwright starts one fresh server shared by the runner and all workers.
const webServerPort = 4174;
const baseURL = `http://127.0.0.1:${webServerPort}`;

const browserProjects = [
  { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  { name: 'webkit', use: { ...devices['Desktop Safari'] } },
];

export default defineConfig({
  testDir: './tests/browser',
  testMatch: '**/*.spec.mjs',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: browserProjects,
  webServer: {
    command: `pnpm build && pnpm exec vite --config vite.config.mjs --host 127.0.0.1 --port ${webServerPort} --strictPort`,
    url: `${baseURL}/tests/browser/fixture.html`,
    // Always launch a fresh server; never reuse a potentially stale dev server.
    reuseExistingServer: false,
    timeout: 120_000,
  },
});

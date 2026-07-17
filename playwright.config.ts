// Playwright end-to-end tests: the site driven in a real browser, complementing
// the pure-logic unit tests under test/ (which run on `npm test`). Run with
// `npm run test:e2e`.
//
// The app is launched in open mode (MBBB_NO_AUTH) against an isolated fixture
// data dir (MBBB_DATA_DIR) seeded by e2e/global-setup.ts, so tests never touch
// real data and run identically on a fresh CI checkout that has no data/ at all.
import { defineConfig, devices } from '@playwright/test';
import { E2E_DATA_DIR } from './e2e/global-setup';

const PORT = 4173;
const HOST = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  // A stray `test.only` left in a spec fails the CI run rather than silently
  // skipping its siblings.
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  globalSetup: './e2e/global-setup.ts',

  use: {
    baseURL: HOST,
    trace: 'on-first-retry',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    command: `npx vite dev --port ${PORT} --strictPort`,
    url: HOST,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      MBBB_NO_AUTH: '1',
      MBBB_DATA_DIR: E2E_DATA_DIR,
    },
  },
});

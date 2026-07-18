// Playwright end-to-end tests: the site driven in a real browser, complementing
// the pure-logic unit tests under test/ (which run on `npm test`). Run with
// `npm run test:e2e`.
//
// The app is launched in open mode (MBBB_NO_AUTH) against an isolated fixture
// data dir (MBBB_DATA_DIR) seeded by e2e/seed.mjs, so tests never touch real
// data and run identically on a fresh CI checkout that has no data/ at all.
//
// We run the *production build* (adapter-node `node build`), not `vite dev`:
// it's the artifact that actually deploys, and it shares one server instance
// across requests (the dev server re-instantiates modules per request).
//
// The data dir is seeded as the first step of the webServer command — before the
// server boots — rather than in a Playwright globalSetup. That ordering matters:
// the webServer readiness probe boots the server (opening the sqlite stores)
// concurrently with globalSetup, and a wipe from there would unlink those files
// under the server's open connections, breaking every later write with SQLite's
// "attempt to write a readonly database" (READONLY_DBMOVED). See e2e/seed.mjs.
import { defineConfig, devices } from '@playwright/test';
import { E2E_DATA_DIR } from './e2e/seed.mjs';

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

  use: {
    baseURL: HOST,
    trace: 'on-first-retry',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    // Seed the data dir, build once, then serve the adapter-node output — in that
    // order, so the wipe completes before the server opens the sqlite stores.
    // ORIGIN lets the built server accept same-origin form POSTs (SvelteKit's
    // CSRF check); PORT is where adapter-node listens.
    command: 'node e2e/seed.mjs && npm run build && node build',
    url: HOST,
    // Always start a fresh server. The seed wipes the data dir each run; a reused
    // server would still hold open connections to the pre-wipe sqlite files
    // (unlinked-but-open), serving stale RSVPs. A fresh process opens the freshly
    // seeded dir. (Requires port 4173 to be free — it always is in CI.)
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      MBBB_NO_AUTH: '1',
      MBBB_DATA_DIR: E2E_DATA_DIR,
      PORT: String(PORT),
      ORIGIN: HOST,
    },
  },
});

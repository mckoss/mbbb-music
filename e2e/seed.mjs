// Prepare the isolated e2e data dir, then hand off to the built server. This is
// the FIRST step of the Playwright webServer command (see playwright.config.ts),
// run before `node build` boots — so the wipe happens once, up front, and never
// again while the server holds the sqlite files open.
//
// Why here and not a Playwright globalSetup? The webServer's `url` readiness
// probe boots the server — opening members/rsvps/activity.db — concurrently with
// globalSetup. A wipe from globalSetup then unlinks those files out from under
// the server's already-open connections, and every subsequent write fails with
// SQLite's "attempt to write a readonly database" (SQLITE_READONLY_DBMOVED: the
// file's inode moved). Sequencing the wipe ahead of the server in one shell
// command removes that race entirely — nothing deletes the dir after boot.
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** The isolated data dir the e2e app runs against (passed to the app as MBBB_DATA_DIR). */
export const E2E_DATA_DIR = resolve(here, '.data');

export function seedDataDir() {
  // A clean slate each run, so a prior run's mutations (RSVPs, edits) can't leak
  // in. gigs.ts reads gigs.json fresh per request, so seeding just that file is
  // enough; the sqlite stores (members/rsvps/activity) are created lazily on
  // first use and degrade to empty when absent — exactly the CI cold-start shape.
  rmSync(E2E_DATA_DIR, { recursive: true, force: true });
  mkdirSync(E2E_DATA_DIR, { recursive: true });
  cpSync(resolve(here, 'fixtures/gigs.json'), resolve(E2E_DATA_DIR, 'gigs.json'));
}

// Seed only when run directly (`node e2e/seed.mjs`), not when the Playwright
// config imports this module for the E2E_DATA_DIR constant.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  seedDataDir();
}

// Seed an isolated data dir before the app boots, so browser tests never read or
// write the real data/ (which, in CI, doesn't exist at all). The dev server is
// launched with MBBB_DATA_DIR pointed here (see playwright.config.ts) and
// MBBB_NO_AUTH, so it runs open (admin) against just this fixture gig list.
//
// gigs.ts reads gigs.json fresh on every request, so writing it here — before any
// test navigates — is enough; other stores (catalog, users, rsvps) degrade to
// empty when their files are absent, which is exactly the CI cold-start shape.
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** The isolated data dir the e2e app runs against. Kept in sync with playwright.config.ts. */
export const E2E_DATA_DIR = resolve(here, '.data');

export default function globalSetup() {
  // Start from a clean slate so a prior run's mutations (RSVPs, edits) can't leak
  // into this one.
  rmSync(E2E_DATA_DIR, { recursive: true, force: true });
  mkdirSync(E2E_DATA_DIR, { recursive: true });
  cpSync(resolve(here, 'fixtures/gigs.json'), resolve(E2E_DATA_DIR, 'gigs.json'));
}

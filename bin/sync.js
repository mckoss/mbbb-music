#!/usr/bin/env node
// Phase 1 Drive asset sync — command-line entry point.
//
// Thin wrapper over the reusable sync core (src/sync). Parses flags, picks a
// Drive client (real or built-in synthetic fixture), runs the sync, and prints
// a human-readable summary. The same core powers the Express admin route.

import { loadConfig } from '../src/sync/config.js';
import { runSync } from '../src/sync/sync.js';
import { createGoogleDriveClient, createFixtureDriveClient } from '../src/sync/drive-client.js';
import { FIXTURE_FILES, FIXTURE_FOLDERS } from '../src/sync/sample-fixture.js';

const HELP = `mbbb-sync — Phase 1 Google Drive asset sync

Syncs the two configured Drive source folders into the gitignored data/
directory: downloads only score PDFs, MP3s, and MuseScore files, groups them by
song under data/<song-title-slug>/ with canonical slug filenames, and maintains
data/manifest.json for incremental, idempotent refreshes.

USAGE
  node bin/sync.js [options]
  npm run sync -- [options]
  npm run sync:demo            # run against built-in synthetic fixture data

OPTIONS
  --fixture           Use the built-in synthetic fixture instead of real Drive.
                      Requires no credentials; safe for offline demos and CI.
  --data-dir <path>   Override the data directory (default: ./data or MBBB_DATA_DIR).
  --dry-run           Classify and plan only; do not download or write manifest.
  --json              Print the full machine-readable sync report as JSON.
  -h, --help          Show this help.

CONFIGURATION (real Drive — not required for --fixture)
  MBBB_DATA_DIR              Data directory (default: ./data)
  MBBB_DRIVE_FOLDER_1_ID     First Drive source folder id
  MBBB_DRIVE_FOLDER_1_LABEL  Optional label for folder 1
  MBBB_DRIVE_FOLDER_2_ID     Second Drive source folder id
  MBBB_DRIVE_FOLDER_2_LABEL  Optional label for folder 2

CREDENTIALS (real Drive — choose one; not required for --fixture)
  MBBB_GOOGLE_ACCESS_TOKEN   A ready OAuth bearer token (simplest; not refreshed).
  MBBB_GOOGLE_CLIENT_ID      \\
  MBBB_GOOGLE_CLIENT_SECRET   > Refresh-token grant; mints/refreshes tokens itself.
  MBBB_GOOGLE_REFRESH_TOKEN  /
  MBBB_GOOGLE_TOKEN_FILE     Optional path to a JSON token object; loaded only if
                             set and the file exists. Fills any gaps above.

  --fixture needs no credentials and is for demos/CI. Without it, a run with no
  credentials fails fast with guidance.

EXAMPLES
  node bin/sync.js --fixture
  node bin/sync.js --fixture --dry-run --json
`;

function parseArgs(argv) {
  const opts = { help: false, fixture: false, dryRun: false, json: false, dataDir: undefined };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '-h':
      case '--help':
        opts.help = true;
        break;
      case '--fixture':
        opts.fixture = true;
        break;
      case '--dry-run':
        opts.dryRun = true;
        break;
      case '--json':
        opts.json = true;
        break;
      case '--data-dir':
        opts.dataDir = argv[++i];
        break;
      default:
        if (arg.startsWith('--data-dir=')) {
          opts.dataDir = arg.slice('--data-dir='.length);
        } else {
          throw new Error(`Unknown argument: ${arg} (try --help)`);
        }
    }
  }
  return opts;
}

function printSummary(report) {
  const s = report.summary;
  const mode = report.dryRun ? ' (dry run)' : '';
  console.log(`\nDrive sync complete${mode} @ ${report.timestamp}`);
  console.log(`  data dir : ${report.dataDir}`);
  console.log(`  manifest : ${report.manifestPath}`);
  console.log(`  sources  : ${report.sources.map((x) => x.label).join(', ')}`);
  console.log(
    `  seen=${s.seen} new=${s.new} changed=${s.changed} unchanged=${s.unchanged} ` +
      `deleted=${s.deleted} ignored=${s.ignored} downloaded=${s.downloaded} failed=${s.failed}`,
  );
  for (const a of report.actions.downloaded) {
    console.log(`    + ${a.localPath} [${a.status}]`);
  }
  for (const a of report.actions.deleted) {
    console.log(`    - archived ${a.name || a.id}`);
  }
  if (report.actions.failed.length) {
    for (const a of report.actions.failed) {
      console.log(`    ! FAILED ${a.localPath}: ${a.error}`);
    }
  }
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(String(err.message || err));
    process.exit(2);
  }

  if (opts.help) {
    process.stdout.write(HELP);
    return;
  }

  const overrides = {};
  if (opts.dataDir) overrides.dataDir = opts.dataDir;

  let driveClient;
  if (opts.fixture) {
    overrides.sources = FIXTURE_FOLDERS;
    driveClient = createFixtureDriveClient({ files: FIXTURE_FILES });
  }

  const config = loadConfig(overrides);

  if (!opts.fixture) {
    if (!config.sources.length) {
      console.error(
        'No Drive source folders configured. Set MBBB_DRIVE_FOLDER_1_ID and ' +
          'MBBB_DRIVE_FOLDER_2_ID, or run with --fixture for a credential-free demo.',
      );
      process.exit(2);
    }
    driveClient = createGoogleDriveClient(config);
  }

  const logger = opts.json
    ? { info() {}, warn: (m) => console.error(m), error: (m) => console.error(m) }
    : { info: (m) => console.log(m), warn: (m) => console.warn(m), error: (m) => console.error(m) };

  const report = await runSync({ driveClient, config, dryRun: opts.dryRun, logger });

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printSummary(report);
  }
}

main().catch((err) => {
  console.error(`\nSync failed: ${err?.message || err}`);
  process.exit(1);
});

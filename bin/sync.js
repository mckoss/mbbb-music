#!/usr/bin/env node
// Phase 1 Drive asset sync — command-line entry point.
//
// Thin wrapper over the reusable sync core (src/sync). Parses flags, picks a
// Drive client (real or built-in synthetic fixture), runs the sync, and prints
// a human-readable summary. The same core powers the Express admin route.

import { resolve } from 'node:path';

import { loadConfig } from '../src/sync/config.js';
import { runSync } from '../src/sync/sync.js';
import { createGoogleDriveClient, createFixtureDriveClient } from '../src/sync/drive-client.js';
import { FIXTURE_FILES, FIXTURE_FOLDERS } from '../src/sync/sample-fixture.js';

const HELP = `mbbb-sync — Phase 1 Google Drive asset sync

Scans each configured Drive source folder recursively (layout:
<source>/<song-title>/<asset>) and syncs into the gitignored data/ directory:
downloads only score PDFs, MP3s, and MuseScore files, groups them by song (the
top-level folder under each source) under data/<song-title-slug>/ with canonical
slug filenames, and maintains data/manifest.json for incremental, idempotent
refreshes.

USAGE
  node bin/sync.js [options]
  npm run sync -- [options]
  npm run sync:demo            # run against built-in synthetic fixture data

OPTIONS
  --fixture           Use the built-in synthetic fixture instead of real Drive.
                      Requires no credentials; safe for offline demos and CI.
                      Writes to tmp/fixture-data and refuses the real data dir,
                      so synthetic data never touches your real assets.
  --data-dir <path>   Override the data directory (default: config.json dataDir or
                      ./data; for --fixture, default tmp/fixture-data).
  --dry-run           Classify and plan only; do not download or write manifest.
  --json              Print the full machine-readable sync report as JSON.
  -h, --help          Show this help.

CONFIGURATION (real Drive — not required for --fixture)
  Source folders and the Google service account are read from a git-ignored
  config.json in the repo root, or — if absent — from the MBBB_CONFIG_JSON
  environment variable holding the same JSON. See config.example.json:

    {
      "dataDir": "data",
      "sources": [ { "id": "<drive-folder-id>", "label": "scores" }, ... ],
      "google":  { "serviceAccount": { ...service-account key... } }
    }

  Authentication is by Google service account only, embedded inline in the
  "google.serviceAccount" block (the JSON key Google Cloud gives you). The source
  folders are public, so no folder sharing is needed — the service account just
  provides Drive API credentials.

  --fixture needs no credentials and is for demos/CI. Without it, a run with no
  service account fails fast with guidance.

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

  const dups = report.duplicates || [];
  if (dups.length) {
    console.log(
      `\nDuplicate content: ${s.duplicateGroups} group(s), ${s.duplicateFiles} file(s) ` +
        '(identical bytes, regardless of path/source):',
    );
    for (const g of dups) {
      console.log(`  [${g.count}×] sha256 ${g.sha256.slice(0, 12)}…`);
      for (const f of g.files) {
        console.log(`        ${f.localPath || f.id}${f.sourceFolderLabel ? `  (${f.sourceFolderLabel})` : ''}`);
      }
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
    // Synthetic fixture runs must NEVER write into the real data directory.
    // Default them to a throwaway sandbox and hard-refuse the real data dir.
    const realDataDir = loadConfig().dataDir;
    overrides.dataDir = resolve(opts.dataDir || 'tmp/fixture-data');
    if (overrides.dataDir === realDataDir) {
      console.error(
        `Refusing to run --fixture against the real data directory (${realDataDir}). ` +
          'Synthetic fixture data must not co-mingle with real assets. Omit --data-dir ' +
          '(defaults to tmp/fixture-data) or point it at a throwaway directory.',
      );
      process.exit(2);
    }
    overrides.sources = FIXTURE_FOLDERS;
    driveClient = createFixtureDriveClient({ files: FIXTURE_FILES });
  }

  const config = loadConfig(overrides);

  if (!opts.fixture) {
    if (!config.sources.length) {
      console.error(
        'No Drive source folders configured. Add a "sources" array to config.json ' +
          '(or MBBB_CONFIG_JSON), or run with --fixture for a credential-free demo.',
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

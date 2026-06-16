#!/usr/bin/env node
// One-time (idempotent) backfill of per-blob provenance sidecars.
//
// Walks the existing content-addressable store and writes data/cas/origins/<sha>.json
// for every blob that lacks one, recovering as much provenance as the current
// manifest still records. Going forward, bin/sync.js writes these automatically the
// first time each blob is stored; this script seeds the ones created before that.
//
// Safe to re-run: existing sidecars are never overwritten (provenance is write-once).

import { resolve } from 'node:path';

import { loadConfig } from '../src/sync/config.js';
import { recoverOrigins } from '../src/sync/origins.js';

const HELP = `mbbb-backfill-origins — seed per-blob provenance sidecars

Writes data/cas/origins/<sha>.json for every blob in the store that lacks one,
recovering provenance from data/manifest.json. Blobs no manifest entry references
(true orphans) get a minimal record marking their origin unknown.

USAGE
  node bin/backfill-origins.js [options]
  npm run origins:backfill -- [options]

OPTIONS
  --data-dir <path>   Override the data directory (default: config.json dataDir or ./data).
  --dry-run           Report what would be written without writing any sidecars.
  --json              Print the machine-readable result as JSON.
  -h, --help          Show this help.
`;

function parseArgs(argv) {
  const opts = { help: false, dryRun: false, json: false, dataDir: undefined };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '-h':
      case '--help':
        opts.help = true;
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
        if (arg.startsWith('--data-dir=')) opts.dataDir = arg.slice('--data-dir='.length);
        else throw new Error(`Unknown argument: ${arg} (try --help)`);
    }
  }
  return opts;
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
  const config = loadConfig(overrides);
  const casDir = resolve(config.dataDir, 'cas');

  const result = await recoverOrigins({
    casDir,
    manifestPath: config.manifestPath,
    dryRun: opts.dryRun,
    onProgress: opts.json ? () => {} : (m) => console.log(m),
  });

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(
      `\nDone${opts.dryRun ? ' (dry run)' : ''}: ${result.written} sidecar(s) ` +
        `${opts.dryRun ? 'would be ' : ''}written ` +
        `(${result.recovered} recovered from manifest, ${result.upgraded} upgraded from unknown, ` +
        `${result.orphans} orphan(s) with no recoverable origin), ${result.skipped} already present.`,
    );
  }
}

main().catch((err) => {
  console.error(`\nBackfill failed: ${err?.message || err}`);
  process.exit(1);
});

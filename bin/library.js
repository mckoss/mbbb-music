#!/usr/bin/env node
// Library tool — inspect and open the synced music library from the manifest.
//
// Subcommands:
//   list                 Print the library grouped by song (slug), listing the
//                        detected instrument-key-part of every live asset.
//   open <prefix>        Open every PDF and MP3 whose song slug starts with the
//                        given prefix, using the OS default viewer/player.
//
// Ignored and deleted manifest entries are always excluded.

import { readFileSync, copyFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import os from 'node:os';

import { loadConfig } from '../src/sync/config.js';
import { slugify } from '../src/sync/slugify.js';

const OPEN_CONFIRM_THRESHOLD = 25;

const HELP = `mbbb-library — inspect and open the synced music library

Reads data/manifest.json (the sync manifest) and operates on live assets only
(ignored and deleted entries are skipped).

USAGE
  node bin/library.js list [options]
  node bin/library.js open <prefix> [options]
  npm run library -- list
  npm run library -- open uptown

SUBCOMMANDS
  list                For each song (shown as a slug), an indented list of the
                      instrument-key-part of every live asset.
  open <prefix>       Open every PDF and MP3 whose song slug starts with <prefix>
                      in the OS default app. The prefix is slugified, so
                      "Uptown Funk" and "uptown-funk" match the same songs.

OPTIONS
  --data-dir <path>   Data directory holding manifest.json + cas/ (default:
                      config dataDir or ./data).
  --manifest <path>   Read this manifest file directly (cas/ is taken from its
                      directory). Overrides --data-dir.
  --json              (list) Emit the report as JSON instead of text.
  -y, --yes           (open) Skip the confirmation guard when more than
                      ${OPEN_CONFIRM_THRESHOLD} files match.
  -h, --help          Show this help.
`;

function parseArgs(argv) {
  const opts = {
    command: undefined,
    prefix: undefined,
    help: false,
    json: false,
    yes: false,
    dataDir: undefined,
    manifest: undefined,
  };
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') opts.help = true;
    else if (arg === '--json') opts.json = true;
    else if (arg === '-y' || arg === '--yes') opts.yes = true;
    else if (arg === '--data-dir') opts.dataDir = argv[++i];
    else if (arg.startsWith('--data-dir=')) opts.dataDir = arg.slice('--data-dir='.length);
    else if (arg === '--manifest') opts.manifest = argv[++i];
    else if (arg.startsWith('--manifest=')) opts.manifest = arg.slice('--manifest='.length);
    else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg} (try --help)`);
    else positionals.push(arg);
  }
  opts.command = positionals[0];
  opts.prefix = positionals[1];
  return opts;
}

/** True for a manifest entry that still represents a present, downloaded asset. */
function isLive(entry) {
  const status = entry.status || '';
  return status !== 'deleted' && !status.startsWith('ignored');
}

function liveAssets(manifest) {
  return Object.values(manifest.files || {}).filter(isLive);
}

// --- list -------------------------------------------------------------------

/**
 * The instrument-key-part descriptor for one asset. When no instrument was
 * detected (audio, MuseScore source, exported notes), fall back to the asset
 * type so the line still says what the file is.
 */
function descriptorOf(entry) {
  const parts = [entry.instrumentSlug, entry.key, entry.partNumber].filter((p) => p != null && p !== '');
  if (parts.length) return parts.join('-');
  if (entry.assetType === 'pdf') return `pdf (${entry.originalName || entry.driveFileId})`;
  return entry.assetType || 'unknown';
}

/** Build the grouped, sorted list model from a manifest. */
function buildList(manifest) {
  const bySong = new Map(); // slug -> { slug, title, descriptors: Map<string, count> }

  for (const entry of liveAssets(manifest)) {
    const title = entry.songTitle || '(unknown)';
    const slug = slugify(title) || '(unknown)';
    if (!bySong.has(slug)) bySong.set(slug, { slug, title, descriptors: new Map() });
    const song = bySong.get(slug);
    const d = descriptorOf(entry);
    song.descriptors.set(d, (song.descriptors.get(d) || 0) + 1);
  }

  return [...bySong.values()]
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .map((song) => ({
      slug: song.slug,
      title: song.title,
      assets: [...song.descriptors.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([descriptor, count]) => ({ descriptor, count })),
    }));
}

function printList(report) {
  let songCount = 0;
  let assetCount = 0;
  for (const song of report) {
    songCount += 1;
    const titleNote = song.title && song.title !== song.slug ? `  (${song.title})` : '';
    const songAssets = song.assets.reduce((n, a) => n + a.count, 0);
    assetCount += songAssets;
    console.log(`${song.slug}${titleNote}  — ${songAssets} asset${songAssets === 1 ? '' : 's'}`);
    for (const a of song.assets) {
      console.log(`    ${a.descriptor}${a.count > 1 ? `  ×${a.count}` : ''}`);
    }
  }
  console.log(`\n${songCount} song${songCount === 1 ? '' : 's'}, ${assetCount} live assets.`);
}

// --- open -------------------------------------------------------------------

/**
 * Build an OS opener. On WSL, files are copied into the Windows temp dir and
 * launched with the Windows default app (a Linux path can't be opened by a
 * Windows viewer); on macOS/Linux the native opener is used directly.
 */
function makeOpener() {
  const isWsl = process.platform === 'linux' && /microsoft/i.test(os.release());
  if (isWsl) {
    const winTempWin = execFileSync('powershell.exe', ['-NoProfile', '-Command', 'echo $env:TEMP'], {
      encoding: 'utf8',
    }).trim();
    const tempDir = execFileSync('wslpath', ['-u', winTempWin], { encoding: 'utf8' }).trim();
    return {
      tempDir,
      open(localPath) {
        const winPath = execFileSync('wslpath', ['-w', localPath], { encoding: 'utf8' }).trim();
        execFileSync('powershell.exe', ['-NoProfile', '-Command', `Start-Process '${winPath}'`], { stdio: 'ignore' });
      },
    };
  }
  const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
  return {
    tempDir: os.tmpdir(),
    open(localPath) {
      execFileSync(cmd, [localPath], { stdio: 'ignore' });
    },
  };
}

/** A safe, OS-friendly filename with the extension matching the asset type. */
function targetName(entry) {
  const ext = entry.assetType === 'mp3' ? '.mp3' : '.pdf';
  const base = String(entry.originalName || entry.driveFileId)
    .replace(/\.[^.]+$/, '') // drop any existing extension; we set it from assetType
    .replace(/[^A-Za-z0-9._ -]+/g, '_')
    .slice(0, 80)
    .trim();
  return `${base || 'asset'}-${entry.sha256.slice(0, 8)}${ext}`;
}

function runOpen(manifest, casDir, prefix, opts) {
  const wanted = slugify(prefix);
  if (!wanted) {
    console.error('open requires a non-empty <prefix>, e.g. `library open uptown`.');
    process.exit(2);
  }

  // PDFs and MP3s whose song slug starts with the prefix; dedup identical bytes.
  const seen = new Set();
  const matches = [];
  for (const entry of liveAssets(manifest)) {
    if (entry.assetType !== 'pdf' && entry.assetType !== 'mp3') continue;
    if (!entry.sha256) continue;
    if (!slugify(entry.songTitle || '').startsWith(wanted)) continue;
    if (seen.has(entry.sha256)) continue;
    seen.add(entry.sha256);
    matches.push(entry);
  }

  if (!matches.length) {
    console.log(`No PDF or MP3 assets match song prefix "${wanted}".`);
    return;
  }

  const songs = [...new Set(matches.map((e) => slugify(e.songTitle || '') || '(unknown)'))].sort();
  console.log(`${matches.length} file(s) match "${wanted}" across ${songs.length} song(s): ${songs.join(', ')}`);

  if (matches.length > OPEN_CONFIRM_THRESHOLD && !opts.yes) {
    console.error(
      `Refusing to open ${matches.length} files at once (more than ${OPEN_CONFIRM_THRESHOLD}). ` +
        'Re-run with --yes to open them all, or use a longer prefix.',
    );
    process.exit(1);
  }

  const opener = makeOpener();
  let opened = 0;
  for (const entry of matches) {
    const blob = resolve(casDir, entry.sha256);
    const dest = resolve(opener.tempDir, `mbbb-lib-${targetName(entry)}`);
    try {
      copyFileSync(blob, dest);
      opener.open(dest);
      opened += 1;
      console.log(`  opened ${entry.assetType}: ${entry.originalName || entry.driveFileId}`);
    } catch (err) {
      console.error(`  FAILED ${entry.originalName || entry.driveFileId}: ${err.message || err}`);
    }
  }
  console.log(`\nOpened ${opened} of ${matches.length} file(s).`);
}

// --- entry ------------------------------------------------------------------

function loadManifest(opts) {
  const manifestPath = opts.manifest || loadConfig({ dataDir: opts.dataDir }).manifestPath;
  try {
    return { manifest: JSON.parse(readFileSync(manifestPath, 'utf8')), manifestPath };
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      console.error(`No manifest found at ${manifestPath}. Run a sync first (node bin/sync.js).`);
      process.exit(1);
    }
    console.error(`Failed to read manifest (${manifestPath}): ${err.message || err}`);
    process.exit(1);
  }
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(String(err.message || err));
    process.exit(2);
  }
  if (opts.help || !opts.command) {
    if (!opts.command && !opts.help) console.error('A subcommand is required: `list` or `open <prefix>`.\n');
    process.stdout.write(HELP);
    process.exit(opts.help ? 0 : 2);
  }

  if (opts.command === 'list') {
    const { manifest } = loadManifest(opts);
    const report = buildList(manifest);
    if (opts.json) console.log(JSON.stringify(report, null, 2));
    else printList(report);
    return;
  }

  if (opts.command === 'open') {
    const { manifest, manifestPath } = loadManifest(opts);
    const casDir = resolve(dirname(manifestPath), 'cas');
    runOpen(manifest, casDir, opts.prefix ?? '', opts);
    return;
  }

  console.error(`Unknown subcommand: ${opts.command} (expected "list" or "open"; try --help).`);
  process.exit(2);
}

main();

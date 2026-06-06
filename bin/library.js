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
import { DEFAULT_KEY_BY_SLUG } from '../src/sync/instruments.js';

const OPEN_CONFIRM_THRESHOLD = 25;

const HELP = `mbbb-library — inspect and open the synced music library

Reads data/manifest.json (the sync manifest) and operates on live assets only
(ignored and deleted entries are skipped).

USAGE
  node bin/library.js list [options]
  node bin/library.js open <prefix> [options]
  npm run library -- list
  npm run library -- open uptown-funk-trumpet-bflat

SUBCOMMANDS
  list                For each song (shown as a slug), an indented list of the
                      instrument-key-part of every live asset.
  open <prefix>       Open every PDF and MP3 whose identifier starts with
                      <prefix> in the OS default app. The identifier is
                      "<song>-<instrument>-<key>-<part>" (exactly the slugs shown
                      by \`list\`), so the prefix can target a whole song
                      (\`uptown-funk\`) or a single part
                      (\`uptown-funk-trumpet-bflat\`).

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
 * The instrument-key-part descriptor for one asset. The descriptor is anchored
 * on a detected instrument, with the instrument's default key folded in when no
 * explicit key was detected (so a B♭ trumpet reads "trumpet-bflat"). A stray
 * key or part number with no instrument is not a real part; those fall back to
 * naming the file so it's identifiable. (Part numbers below 1 are
 * voicing/version artifacts, not parts, and are dropped.)
 */
function descriptorOf(entry) {
  if (entry.instrumentSlug) {
    const part = Number.isInteger(entry.partNumber) && entry.partNumber >= 1 ? entry.partNumber : null;
    const key = entry.key || DEFAULT_KEY_BY_SLUG[entry.instrumentSlug] || null;
    return [entry.instrumentSlug, key, part].filter((p) => p != null && p !== '').join('-');
  }
  return `${entry.assetType || 'file'} (${entry.originalName || entry.driveFileId})`;
}

/**
 * The slug identifier `open` matches a prefix against:
 * "<song>-<instrument>-<key>-<part>" for instrument parts, or just "<song>" for
 * assets with no detected instrument (audio, notes). A prefix can therefore
 * target a whole song or drill down to a single part.
 */
function assetMatchKey(entry) {
  const songSlug = slugify(entry.songTitle || '') || 'unknown';
  return entry.instrumentSlug ? `${songSlug}-${descriptorOf(entry)}` : songSlug;
}

/**
 * Index/admin folders that hold copies organized by something other than song
 * (by instrument, by file type, notes). Their top-level folder name is NOT a
 * song, so when the same content also lives under a real song folder that copy
 * wins. Detected by the band's numbered-bucket naming and the "indexed by
 * instrument" container.
 */
function isContainerFolder(name) {
  const n = String(name || '');
  return /indexed by instrument/i.test(n) || /^\d+\s+(notes|audio|full scores|musescore|indexed)/i.test(n);
}

/**
 * Build a source-priority lookup (label -> rank, lower = higher priority) from
 * the configured source order, appending any manifest-only labels after it.
 */
function buildPriority(manifest, opts) {
  const pri = new Map();
  let next = 0;
  try {
    for (const s of loadConfig({ dataDir: opts.dataDir }).sources || []) {
      if (s.label && !pri.has(s.label)) pri.set(s.label, next++);
    }
  } catch {
    // No config (e.g. --manifest only) — fall back to first-seen order below.
  }
  for (const e of Object.values(manifest.files || {})) {
    if (e.sourceFolderLabel && !pri.has(e.sourceFolderLabel)) pri.set(e.sourceFolderLabel, next++);
  }
  return pri;
}

/**
 * Pick the canonical location for one content blob: the copy in the
 * highest-priority source wins; within a source, a real song folder beats an
 * index/admin container; otherwise keep the first seen.
 */
function isMoreCanonical(candidate, current, pri) {
  const rank = (e) => (pri.has(e.sourceFolderLabel) ? pri.get(e.sourceFolderLabel) : Number.MAX_SAFE_INTEGER);
  if (rank(candidate) !== rank(current)) return rank(candidate) < rank(current);
  const container = (e) => (isContainerFolder(e.originalFolder) ? 1 : 0);
  if (container(candidate) !== container(current)) return container(candidate) < container(current);
  return false;
}

/**
 * Collapse the live manifest to one canonical entry per unique content blob
 * (CAS sha256), choosing the highest-priority location for each. This is the
 * shared basis for both `list` and `open`, so a file is attributed to the same
 * song regardless of which subcommand surfaces it.
 *
 * @returns {{ canonical: Map<string, object>, liveCount: number }}
 */
function canonicalByContent(manifest, pri) {
  const canonical = new Map(); // sha (or id fallback) -> entry
  let liveCount = 0;
  for (const entry of liveAssets(manifest)) {
    liveCount += 1;
    const key = entry.sha256 || `id:${entry.driveFileId}`;
    const cur = canonical.get(key);
    if (!cur || isMoreCanonical(entry, cur, pri)) canonical.set(key, entry);
  }
  return { canonical, liveCount };
}

/**
 * Build the grouped, sorted list model. Each unique content blob (CAS sha256)
 * is listed exactly once, attributed to its canonical (highest-priority) song.
 */
function buildList(manifest, pri) {
  const { canonical } = canonicalByContent(manifest, pri);

  // Group the canonical entries by song. Distinct files that share a descriptor
  // collapse to one line (duplicate source copies aren't worth enumerating).
  const bySong = new Map();
  for (const entry of canonical.values()) {
    const title = entry.songTitle || '(unknown)';
    const slug = slugify(title) || '(unknown)';
    if (!bySong.has(slug)) bySong.set(slug, { slug, title, fileCount: 0, descriptors: new Set() });
    const song = bySong.get(slug);
    song.fileCount += 1;
    song.descriptors.add(descriptorOf(entry));
  }

  const songs = [...bySong.values()]
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .map((song) => ({
      slug: song.slug,
      title: song.title,
      fileCount: song.fileCount,
      assets: [...song.descriptors].sort((a, b) => a.localeCompare(b)),
    }));

  return { songs, uniqueCount: canonical.size };
}

function printList({ songs, uniqueCount }) {
  for (const song of songs) {
    const titleNote = song.title && song.title !== song.slug ? `  (${song.title})` : '';
    console.log(`${song.slug}${titleNote}  — ${song.fileCount} file${song.fileCount === 1 ? '' : 's'}`);
    for (const d of song.assets) {
      console.log(`    ${d}`);
    }
  }
  console.log(`\n${songs.length} song${songs.length === 1 ? '' : 's'}, ${uniqueCount} unique files.`);
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

function runOpen(manifest, casDir, prefix, pri, opts) {
  const wanted = slugify(prefix);
  if (!wanted) {
    console.error('open requires a non-empty <prefix>, e.g. `library open uptown`.');
    process.exit(2);
  }

  // Work from the canonical-by-content view (same as `list`), so each blob is
  // opened once and matched against its canonical song — a file filed under an
  // index folder still opens when its real song is requested. Match the prefix
  // against the full "<song>-<instrument>-<key>-<part>" identifier, so the
  // prefix can target a whole song ("uptown-funk") or one part
  // ("uptown-funk-trumpet-bflat").
  const { canonical } = canonicalByContent(manifest, pri);
  const matches = [];
  for (const entry of canonical.values()) {
    if (entry.assetType !== 'pdf' && entry.assetType !== 'mp3') continue;
    if (!entry.sha256) continue;
    if (!assetMatchKey(entry).startsWith(wanted)) continue;
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
    const report = buildList(manifest, buildPriority(manifest, opts));
    if (opts.json) console.log(JSON.stringify(report, null, 2));
    else printList(report);
    return;
  }

  if (opts.command === 'open') {
    const { manifest, manifestPath } = loadManifest(opts);
    const casDir = resolve(dirname(manifestPath), 'cas');
    runOpen(manifest, casDir, opts.prefix ?? '', buildPriority(manifest, opts), opts);
    return;
  }

  console.error(`Unknown subcommand: ${opts.command} (expected "list" or "open"; try --help).`);
  process.exit(2);
}

main();

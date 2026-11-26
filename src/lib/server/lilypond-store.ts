// Server-only record of LilyPond builds (see src/lilypond/pipeline.js). Outputs
// are stored content-addressed in data/cas like synced files; this file records
// which outputs belong to which song plus each build's fidelity report, in the
// writable data/lilypond/state.json. A Drive re-sync never touches it.

import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { copyFile, mkdir, rename, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { loadConfig } from '../../sync/config.js';
import { lilypondEntries } from '../../lilypond/catalog-entries.js';

export interface LilypondOutput {
  sha256: string;
  name: string;
  kind: 'score' | 'part' | 'audio' | 'source';
  format?: string;
  part?: string;
  size?: number;
}

export interface PartCheck {
  reference: string;
  drums: boolean;
  notes: number;
  match: number;
}

export interface OmrPartReport {
  part: string;
  bars: number;
  notes: string[];
  skipped?: string;
  failed?: boolean;
}

export interface LilypondReport {
  title: string;
  origin?: 'omr';
  omr?: OmrPartReport[];
  parts: { name: string; slug: string; drums: boolean }[];
  checks: PartCheck[] | null;
  passed: boolean;
  warnings: string[];
  versions: Record<string, string>;
}

export interface LilypondBuild {
  title: string;
  /** How the master was made: converted from MuseScore, or read from part PDFs. */
  origin?: 'mscz' | 'omr';
  builtAt: string;
  builtBy: string | null;
  /** The MuseScore master's hash, or for OMR builds a hash over the part PDFs used. */
  masterSha256: string;
  outputs: LilypondOutput[];
  report: LilypondReport;
}

interface StateFile {
  songs: Record<string, LilypondBuild>;
}

function statePath(): string {
  return resolve(loadConfig().dataDir, 'lilypond', 'state.json');
}

export function readState(): StateFile {
  try {
    const parsed = JSON.parse(readFileSync(statePath(), 'utf8'));
    return { songs: parsed.songs ?? {} };
  } catch {
    return { songs: {} };
  }
}

function writeState(data: StateFile): void {
  const path = statePath();
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  renameSync(tmp, path);
}

/** mtime of the state file (catalog cache invalidation), or -1 when absent. */
export function stateMtimeMs(): number {
  try {
    return statSync(statePath()).mtimeMs;
  } catch {
    return -1;
  }
}

/** Manifest-shaped entries for every stored LilyPond output. */
export function catalogEntries(): Record<string, object> {
  return lilypondEntries(readState());
}

function sha256File(path: string): Promise<string> {
  return new Promise((ok, fail) => {
    const h = createHash('sha256');
    createReadStream(path)
      .on('data', (d) => h.update(d))
      .on('error', fail)
      .on('end', () => ok(h.digest('hex')));
  });
}

/** Copy a file into the content store; returns its hash and size. */
export async function storeBlob(path: string): Promise<{ sha256: string; size: number }> {
  const sha256 = await sha256File(path);
  const casDir = resolve(loadConfig().dataDir, 'cas');
  const dest = resolve(casDir, sha256);
  const { size } = await stat(path);
  if (!existsSync(dest)) {
    await mkdir(casDir, { recursive: true });
    const tmp = `${dest}.tmp-${process.pid}`;
    await copyFile(path, tmp);
    await rename(tmp, dest);
  }
  return { sha256, size };
}

/** Record (replace) a song's build. */
export function recordBuild(slug: string, build: LilypondBuild): void {
  const data = readState();
  data.songs[slug] = build;
  writeState(data);
}

/** Remove a song's LilyPond outputs from the library (blobs stay in the CAS). */
export function removeBuild(slug: string): boolean {
  const data = readState();
  if (!data.songs[slug]) return false;
  delete data.songs[slug];
  writeState(data);
  return true;
}

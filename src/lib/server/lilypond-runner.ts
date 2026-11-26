// Admin-only LilyPond build queue. Songs are converted one at a time inside the
// web server (so outputs land on the same data volume the app serves). State is
// in-memory per process — fine for the single Railway instance; finished builds
// are durable in data/lilypond/state.json.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { convertMscz } from '../../lilypond/pipeline.js';
import { casPath, getCatalog } from './library.js';
import { recordBuild, removeBuild, storeBlob, type LilypondOutput } from './lilypond-store.js';

export interface JobLine {
  t: number;
  msg: string;
}

export interface Job {
  slug: string;
  title: string;
  requestedBy: string | null;
  status: 'queued' | 'running' | 'done' | 'failed';
  queuedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  error: string | null;
  lines: JobLine[];
  outputs: number;
  passed: boolean | null;
}

const MAX_RECENT = 30;
const MAX_LINES = 60;

const jobs: Job[] = []; // newest last
let working = false;

export function getJobs(): Job[] {
  return jobs.slice(-MAX_RECENT);
}

/** Songs that have a MuseScore master the pipeline can convert. */
function convertible(slug: string) {
  const tune = getCatalog().tunes.find((t) => t.slug === slug);
  const master = tune?.musescore?.find((m) => m.sha256);
  return tune && master?.sha256 ? { tune, masterSha: master.sha256 } : null;
}

/**
 * Queue songs for a LilyPond build (skipping ones already queued or running).
 * Returns the slugs actually queued and those that have no MuseScore master.
 */
export function enqueue(slugs: string[], requestedBy: string | null): { queued: string[]; skipped: string[] } {
  const queued: string[] = [];
  const skipped: string[] = [];
  for (const slug of [...new Set(slugs)]) {
    const c = convertible(slug);
    if (!c) {
      skipped.push(slug);
      continue;
    }
    if (jobs.some((j) => j.slug === slug && (j.status === 'queued' || j.status === 'running'))) continue;
    jobs.push({
      slug,
      title: c.tune.title,
      requestedBy,
      status: 'queued',
      queuedAt: Date.now(),
      startedAt: null,
      finishedAt: null,
      error: null,
      lines: [],
      outputs: 0,
      passed: null,
    });
    queued.push(slug);
  }
  while (jobs.length > MAX_RECENT * 2) {
    const i = jobs.findIndex((j) => j.status === 'done' || j.status === 'failed');
    if (i < 0) break;
    jobs.splice(i, 1);
  }
  void work();
  return { queued, skipped };
}

/** Every song with a MuseScore master. */
export function allConvertibleSlugs(): string[] {
  return getCatalog()
    .tunes.filter((t) => t.musescore?.some((m) => m.sha256))
    .map((t) => t.slug);
}

/** Take a song's LilyPond outputs out of the library. */
export function revert(slug: string): boolean {
  return removeBuild(slug);
}

async function runJob(job: Job) {
  const c = convertible(job.slug);
  if (!c) throw new Error('This song no longer has a MuseScore master.');
  const say = (msg: string) => {
    job.lines.push({ t: Date.now(), msg });
    if (job.lines.length > MAX_LINES) job.lines.splice(0, job.lines.length - MAX_LINES);
  };
  const workDir = await mkdtemp(join(tmpdir(), 'mbbb-lilypond-'));
  try {
    const { outputs, report } = await convertMscz({
      input: casPath(c.masterSha),
      songSlug: (c.tune as { displaySlug?: string }).displaySlug || job.slug,
      title: c.tune.title,
      workDir: join(workDir, 'build'),
      log: say,
    });
    say(`Storing ${outputs.length} files`);
    const stored: LilypondOutput[] = [];
    for (const o of outputs) {
      const { sha256, size } = await storeBlob(o.path);
      stored.push({ sha256, size, name: o.name, kind: o.kind, ...(o.format ? { format: o.format } : {}), ...(o.part ? { part: o.part } : {}) });
    }
    recordBuild(job.slug, {
      title: c.tune.title,
      builtAt: new Date().toISOString(),
      builtBy: job.requestedBy,
      masterSha256: c.masterSha,
      outputs: stored,
      report,
    });
    job.outputs = stored.length;
    job.passed = report.passed;
    for (const w of report.warnings) say(`Warning: ${w}`);
    say(report.passed ? 'Done — every pitched part matches the MuseScore master.' : 'Done — some parts differ from the MuseScore master; see the report.');
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function work() {
  if (working) return;
  working = true;
  try {
    for (;;) {
      const job = jobs.find((j) => j.status === 'queued');
      if (!job) break;
      job.status = 'running';
      job.startedAt = Date.now();
      try {
        await runJob(job);
        job.status = 'done';
      } catch (err) {
        job.status = 'failed';
        job.error = err instanceof Error ? err.message : String(err);
        job.lines.push({ t: Date.now(), msg: `Failed: ${job.error}` });
      }
      job.finishedAt = Date.now();
    }
  } finally {
    working = false;
  }
}

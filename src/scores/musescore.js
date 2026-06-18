// Locate and drive the locally-installed MuseScore 4 command-line binary.
//
// MuseScore is a native GUI application, not an npm package — it can't be a
// project dependency or vendored into this (public) repo. So we treat it as a
// declared, self-checking prerequisite: find the binary, confirm it's v4, and
// surface a clear install hint if it's missing. A headless container/Dockerfile
// for server-side builds is intentionally out of scope for this CLI-only slice.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';

const execFileP = promisify(execFile);

// Default install locations by platform. macOS ships the CLI inside the .app
// bundle and does NOT put `mscore` on PATH, so the absolute path is the
// reliable default here. Linux/Windows fall through to PATH / Program Files.
const PLATFORM_DEFAULTS = {
  darwin: ['/Applications/MuseScore 4.app/Contents/MacOS/mscore'],
  win32: ['C:/Program Files/MuseScore 4/bin/MuseScore4.exe'],
  linux: [],
};

const PATH_NAMES = ['mscore', 'musescore', 'MuseScore4', 'mscore4'];

const INSTALL_HINT =
  'MuseScore 4 was not found.\n' +
  '  Install it from https://musescore.org/download (the CLI is the app binary),\n' +
  '  or point MSCORE_BIN at the executable, e.g.\n' +
  '    macOS:   export MSCORE_BIN="/Applications/MuseScore 4.app/Contents/MacOS/mscore"\n' +
  '    Linux:   export MSCORE_BIN="$(which mscore)"\n';

/** Candidate binary paths in priority order: MSCORE_BIN, platform default, PATH. */
function candidates(env) {
  const out = [];
  if (env.MSCORE_BIN) out.push(env.MSCORE_BIN);
  out.push(...(PLATFORM_DEFAULTS[process.platform] ?? []));
  out.push(...PATH_NAMES);
  return out;
}

/** Parse the major version from `mscore --version` output ("MuseScore4 4.7.2"). */
function majorVersion(versionLine) {
  const m = String(versionLine).match(/(\d+)\.\d+(?:\.\d+)?/);
  return m ? Number(m[1]) : null;
}

/**
 * Resolve a working MuseScore 4 binary. Tries each candidate's `--version`;
 * returns the first that runs and reports major version 4. Throws with an
 * install hint if none work.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<{ bin: string, version: string }>}
 */
export async function resolveMscore(env = process.env) {
  let sawWrongVersion = null;
  for (const bin of candidates(env)) {
    // Absolute paths that don't exist can be skipped without spawning.
    if (bin.includes('/') && !bin.startsWith('.') && !existsSync(bin)) continue;
    let version;
    try {
      ({ stdout: version } = await execFileP(bin, ['--version']));
    } catch {
      continue; // not on PATH / not executable — try the next candidate
    }
    version = version.trim();
    const major = majorVersion(version);
    if (major === 4) return { bin, version };
    if (major != null) sawWrongVersion = version; // found MuseScore, wrong major
  }
  const detail = sawWrongVersion
    ? `Found "${sawWrongVersion}", but this tool targets MuseScore 4 (CLI behavior varies by version).\n`
    : '';
  throw new Error(detail + INSTALL_HINT);
}

/**
 * A signal death (e.g. SIGABRT) means MuseScore aborted rather than exiting with
 * a status. On macOS, MuseScore 4 intermittently aborts during Qt GUI startup
 * (`QApplication` → `createPlatformIntegration`) — a race against WindowServer
 * that kills the process *before it does any work*. Those are safe to retry. A
 * clean non-zero exit, by contrast, is a real conversion error we must not mask.
 */
function isStartupCrash(err) {
  return Boolean(err && err.signal);
}

/**
 * Run the MuseScore binary with the given args, retrying the GUI-startup abort
 * described above (the process produces nothing on crash, so a relaunch is
 * idempotent). Returns stdout (utf8). MuseScore can emit large JSON (e.g.
 * `--score-parts`), so the buffer cap is generous.
 *
 * @param {string} bin
 * @param {string[]} args
 * @param {{ attempts?: number }} [opts]
 * @returns {Promise<string>}
 */
export async function runMscore(bin, args, { attempts = 10 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const { stdout } = await execFileP(bin, args, { maxBuffer: 256 * 1024 * 1024 });
      return stdout;
    } catch (err) {
      lastErr = err;
      if (!isStartupCrash(err) || attempt === attempts) throw err;
      // else: transient Qt-startup abort — relaunch.
    }
  }
  throw lastErr;
}

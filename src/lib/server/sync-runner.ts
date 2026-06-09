// Runs the Drive sync inside the web server (so it writes the same data volume
// the app serves) as a single-flight background job, broadcasting progress to
// any number of SSE subscribers. State is in-memory (per process), which is fine
// for the single Railway instance.

import { loadConfig } from '../../sync/config.js';
import { runSync } from '../../sync/sync.js';
import { createGoogleDriveClient } from '../../sync/drive-client.js';

export interface SyncLine {
  t: number;
  level: 'info' | 'warn' | 'error';
  msg: string;
}

export interface SyncState {
  running: boolean;
  startedAt: number | null;
  finishedAt: number | null;
  lines: SyncLine[];
  summary: Record<string, number> | null;
  error: string | null;
}

type Event =
  | { type: 'start' }
  | { type: 'line'; line: SyncLine }
  | { type: 'done'; summary: Record<string, number> }
  | { type: 'error'; error: string }
  | { type: 'end' }
  | { type: 'state'; state: SyncState };

const MAX_LINES = 400; // bound memory for a big first sync

let state: SyncState = { running: false, startedAt: null, finishedAt: null, lines: [], summary: null, error: null };
const subscribers = new Set<(ev: Event) => void>();

function emit(ev: Event) {
  for (const s of subscribers) {
    try {
      s(ev);
    } catch {
      /* a dead subscriber shouldn't break the run */
    }
  }
}

function addLine(level: SyncLine['level'], msg: string) {
  const line: SyncLine = { t: Date.now(), level, msg };
  state.lines.push(line);
  if (state.lines.length > MAX_LINES) state.lines.splice(0, state.lines.length - MAX_LINES);
  emit({ type: 'line', line });
}

export function getState(): SyncState {
  return state;
}

export function subscribe(cb: (ev: Event) => void): () => void {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

/** Start a sync if one isn't already running. Returns the (possibly running) state. */
export function startSync(): SyncState {
  if (state.running) return state;
  state = { running: true, startedAt: Date.now(), finishedAt: null, lines: [], summary: null, error: null };
  emit({ type: 'start' });

  (async () => {
    try {
      const config = loadConfig();
      const logger = {
        info: (m: unknown) => addLine('info', String(m)),
        warn: (m: unknown) => addLine('warn', String(m)),
        error: (m: unknown) => addLine('error', String(m)),
      };
      const driveClient = createGoogleDriveClient(config, { logger });
      const report = (await runSync({ driveClient, config, logger })) as {
        summary: Record<string, number>;
      };
      state.summary = report.summary;
      emit({ type: 'done', summary: report.summary });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      state.error = msg;
      addLine('error', msg);
      emit({ type: 'error', error: msg });
    } finally {
      state.running = false;
      state.finishedAt = Date.now();
      emit({ type: 'end' });
    }
  })();

  return state;
}

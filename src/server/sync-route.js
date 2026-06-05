// Express-callable entry point for hosted refreshes. This is framework-light: it
// returns a plain async (req, res) handler so the repo does not need Express
// installed during Phase 1. A future app mounts it, e.g.:
//
//   import express from 'express';
//   import { createSyncHandler } from './src/server/sync-route.js';
//   const app = express();
//   app.post('/admin/sync', createSyncHandler());
//
// The handler reuses the exact same sync core as the CLI.

import { syncDriveAssets } from '../sync/index.js';

/**
 * Create an Express request handler that triggers a Drive sync and responds
 * with the JSON sync report.
 *
 * NOTE: production should guard this behind admin auth and a single-flight lock
 * (e.g. a Postgres advisory lock) to prevent overlapping runs, per
 * docs/design.md → Incremental Drive Sync.
 *
 * @param {Object} [options]
 * @param {Object} [options.driveClient]  Inject a client (default: real Google client).
 * @param {Object} [options.configOverrides]
 * @param {object} [options.logger]
 * @returns {(req: any, res: any) => Promise<void>}
 */
export function createSyncHandler({ driveClient, configOverrides, logger } = {}) {
  return async function syncHandler(req, res) {
    const dryRun = Boolean(req?.query?.dryRun === '1' || req?.body?.dryRun);
    try {
      const report = await syncDriveAssets({ driveClient, configOverrides, dryRun, logger });
      res.status(200).json({ ok: true, report });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  };
}

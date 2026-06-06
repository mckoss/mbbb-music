// Public entry point for the Phase 1 Drive sync. Import this from the CLI, an
// Express route, a worker, or a test. It wires config + a DriveClient and
// delegates to the pure `runSync` core.

import { loadConfig } from './config.js';
import { runSync } from './sync.js';
import { createGoogleDriveClient } from './drive-client.js';

/**
 * High-level convenience: build config, pick a Drive client, and run a sync.
 * Suitable as the body of an Express admin route or a CLI command.
 *
 * @param {Object} [options]
 * @param {Object} [options.configOverrides]  Passed to loadConfig.
 * @param {Object} [options.driveClient]       Inject a client (e.g. fixture/tests).
 * @param {boolean} [options.dryRun]
 * @param {() => Date} [options.now]
 * @param {object} [options.logger]
 * @returns {Promise<object>} Sync report.
 */
export async function syncDriveAssets({ configOverrides, driveClient, dryRun, now, logger } = {}) {
  const config = loadConfig(configOverrides);
  const client = driveClient || createGoogleDriveClient(config);
  return runSync({ driveClient: client, config, dryRun, now, logger });
}

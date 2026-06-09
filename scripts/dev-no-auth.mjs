#!/usr/bin/env node
// Run the dev server in OPEN MODE (no Google sign-in) for local/LAN testing,
// without editing config.json. Sets MBBB_NO_AUTH so web auth is force-disabled
// (see src/lib/server/auth.ts) and binds to the LAN (--host) so other devices
// — e.g. an iPad on the same Wi-Fi — can connect. Extra args pass through, so
// `npm run dev:no-auth -- --port 5174` works.
//
// SAFETY: this only disables auth via an env var at runtime; config.json is left
// untouched and production-ready. Never set MBBB_NO_AUTH in a real deployment.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const viteBin = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
const args = ['dev', '--host', ...process.argv.slice(2)];

console.warn('\n⚠️  Auth DISABLED (MBBB_NO_AUTH) — open mode, for local testing only.\n');

const child = spawn(process.execPath, [viteBin, ...args], {
  stdio: 'inherit',
  env: { ...process.env, MBBB_NO_AUTH: 'true' },
});
child.on('exit', (code) => process.exit(code ?? 0));

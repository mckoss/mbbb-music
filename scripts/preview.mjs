// Run `vite preview` as close to production as possible. In production the
// sync/web config comes from the MBBB_CONFIG_JSON env var (not a config.json
// file) — and the bundled preview server can't resolve the repo-root file
// anyway. So for local convenience we inject that env var from config.json when
// it's present and the var isn't already set, then hand off to vite preview.
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

if (!process.env.MBBB_CONFIG_JSON) {
  try {
    const text = readFileSync(resolve(root, 'config.json'), 'utf8');
    JSON.parse(text); // fail fast on a malformed config rather than serving empty
    process.env.MBBB_CONFIG_JSON = text;
    console.log('preview: injected MBBB_CONFIG_JSON from config.json (production-like).');
  } catch (err) {
    console.warn(
      `preview: no MBBB_CONFIG_JSON set and config.json unavailable (${err.message}); serving an empty catalog.`
    );
  }
}

const bin = resolve(root, 'node_modules', '.bin', process.platform === 'win32' ? 'vite.cmd' : 'vite');
const child = spawn(bin, ['preview', ...process.argv.slice(2)], { stdio: 'inherit', env: process.env });
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});

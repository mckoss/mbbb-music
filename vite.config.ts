import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { enhancedImages } from '@sveltejs/enhanced-img';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

// In a git worktree the gitignored paths (node_modules/, data/) are symlinks into
// the main checkout, so their real paths sit *outside* this root. Vite's dev
// server refuses to serve files outside server.fs.allow — which by default is
// just the project root — so the client runtime (…/@sveltejs/kit/.../entry.js)
// is blocked and the page never hydrates (every button goes dead). Allow the
// symlink targets explicitly. Dev-server only; server.fs has no effect on builds,
// and in a normal (non-worktree) checkout these realpaths are inside root anyway.
function symlinkTargets(): string[] {
  const out: string[] = [];
  for (const name of ['node_modules', 'data']) {
    try {
      out.push(fs.realpathSync(path.join(root, name)));
    } catch {
      // Path may not exist (e.g. fresh checkout before install) — skip it.
    }
  }
  return out;
}

export default defineConfig({
  // enhancedImages must precede sveltekit() so <enhanced:img> is transformed
  // (build-time resize/compression to modern formats) before SvelteKit runs.
  plugins: [enhancedImages(), sveltekit()],
  server: { fs: { allow: [root, ...symlinkTargets()] } },
});

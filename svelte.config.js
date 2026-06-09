import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// Single source of truth for the app version: package.json. Exposing it through
// kit.version.name means `import { version } from '$app/environment'` returns the
// same string shown in the UI, so the two can never drift.
const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8'));

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    // Railway is the deploy target; adapter-node produces a plain Node server.
    adapter: adapter(),
    version: { name: pkg.version },
  },
};

export default config;

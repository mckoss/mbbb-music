import { enhancedImages } from '@sveltejs/enhanced-img';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  // enhancedImages must precede sveltekit() so <enhanced:img> is transformed
  // (build-time resize/compression to modern formats) before SvelteKit runs.
  plugins: [enhancedImages(), sveltekit()],
});

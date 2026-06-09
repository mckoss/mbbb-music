// A tiny module-resolution hook for `node --test`. TypeScript/SvelteKit source
// imports sibling modules with a ".js" specifier (e.g. `../gig.js`) even though
// the file on disk is ".ts". Node's built-in type-stripping doesn't rewrite the
// extension, so a relative ".js" import of a ".ts" source fails to resolve under
// the test runner. This hook retries such imports against the ".ts" source.
//
// Registered via the test script (`node --import ./test/loader.mjs ...`). It is
// test-only infra and does not affect the dev server or production build, which
// resolve modules through Vite instead.

import { register } from 'node:module';

// Resolve the hook module relative to this file's URL.
register('./loader-hooks.mjs', import.meta.url);

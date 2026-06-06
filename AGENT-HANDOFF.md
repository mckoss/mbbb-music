# Agent Handoff

Working context for picking this project up on another machine (or in a fresh
agent session). For the product vision and full design, read
[README.md](README.md) and [docs/design.md](docs/design.md) — this file is the
"where we are / how to resume" layer on top of those.

Last updated: 2026-06-06.

## TL;DR state

- **Phase 1 (Drive sync): done.** A reusable, content-addressable Drive sync
  (`src/sync`, CLI at `bin/sync.js`). Native Google files (Docs/Sheets/Slides)
  are exported to PDF. Manifest at `data/manifest.json`, blobs at
  `data/cas/<sha256>`. `data/` is gitignored.
- **Library CLI: done.** `bin/library.js` (`list` / `open <prefix>`) reads the
  manifest, dedups by content hash, and attributes each blob to its canonical
  song (highest-priority source; real song folder beats an index folder).
- **Web interface: player core done.** SvelteKit (TypeScript, Svelte 5,
  `adapter-node`). Collection browse + Score/Performance overlay + a single
  shared audio transport, served from the manifest + CAS over HTTP. Gig Packets
  is a placeholder; auth/gigs/admin are deferred.
- Tests: `npm test` → 63 passing. `npm run check` (svelte-check) clean.
  `npm run build` succeeds. Branch `main` is the working branch.

## Resume on a new machine

```bash
git clone <repo> && cd mbbb-music
npm install                 # installs Node core dep + SvelteKit dev tooling
npm test                    # 63 tests, no network/credentials needed
npm run sync:demo           # synthetic fixture sync into tmp/ (no creds)
```

**Important — real music does NOT travel via git.** `data/` (manifest + blobs)
is gitignored and contains private, copyrighted material. To get real data on a
new machine you must either:

1. Re-sync from Drive: create `config.json` in the repo root (see
   `config.example.json`) with the two Drive source folder ids and a Google
   service-account key, then `node bin/sync.js`. (Blobs are cached by hash, so
   re-syncs are cheap/idempotent.) — OR —
2. Copy the `data/` directory over out-of-band (scp/rsync/USB). It's
   self-contained: `data/manifest.json` + `data/cas/`.

The web app needs a populated `data/` to show real music:

```bash
npm run dev                 # http://localhost:5173
```

## Commands

| Command | What |
|---|---|
| `npm run sync` | Sync real Drive → `data/` (needs `config.json`) |
| `npm run sync:demo` | Synthetic fixture sync (no credentials) |
| `npm run library -- list` | Catalog grouped by song |
| `npm run library -- open <prefix>` | Open PDFs/MP3s/MuseScore by `<song>-<instrument>-<key>` prefix |
| `npm run dev` | SvelteKit dev server |
| `npm run build` / `npm run preview` | Production build (adapter-node) / preview |
| `npm run check` | svelte-check (type-check) |
| `npm test` | Node test runner (`test/*.test.js`) |

## Architecture / where things live

- `src/sync/` — framework-agnostic core (plain **JS + JSDoc**). `sync.js`
  (orchestration), `drive-client.js` (Drive REST + `files.export` for native
  files), `classify.js`, `metadata.js`, `instruments.js`, `slugify.js`,
  `manifest.js`, `config.js`.
- `src/sync/catalog.js` — **shared catalog model** used by BOTH the CLI and the
  web app. `buildCatalog(manifest, sourceLabels)` collapses the manifest to one
  entry per unique CAS blob, attributes each to its canonical song, and groups
  into tunes → `{ parts, scores, audio, musescore }`. Also exports the dedup
  primitives (`canonicalByContent`, `sourcePriority`, `descriptorOf`, etc.).
- `bin/sync.js`, `bin/library.js` — CLI entry points.
- `src/lib/server/library.ts` — **server-only** loader: reads `data/manifest.json`
  via `loadConfig`, builds + caches the catalog (invalidates on manifest mtime),
  indexes blob hashes.
- `src/routes/api/catalog/+server.ts` — `GET /api/catalog` (catalog JSON).
- `src/routes/blob/[sha]/+server.ts` — `GET /blob/<sha256>` streams a CAS blob
  (Content-Type, Range support for audio, immutable cache, `?dl=<name>`); serves
  only manifest-known hashes (path-traversal-safe).
- `src/routes/+layout.svelte` — global chrome (instrument + format selectors,
  tabs) + mounts the Score overlay; `+layout.ts` loads the catalog.
- `src/routes/+page.svelte` — Collection two-pane view.
- `src/lib/components/` — `TuneList`, `TuneDetail`, `AudioPlayer`, `ScoreOverlay`.
- `src/lib/audio.ts` — single shared `HTMLAudioElement` transport (store +
  play/toggle/seek/restart).
- `src/lib/stores.ts`, `format.ts`, `resolve.ts`, `types.ts` — client state/helpers.

## Conventions (follow these)

- Core (`src/sync`, `bin/`) is **JS + JSDoc**; the web app is **TypeScript**. TS
  imports the JS core fine (allowJs).
- Dependencies pinned to **exact** versions (no `^`/`~`); `.npmrc` has
  `save-exact=true`; commit the lockfile; bump deliberately.
- `data/`, `config.json`, `tmp/` are gitignored. **Never commit music, the
  manifest, or credentials.** Tests/demos use synthetic fixtures only.
- Commit messages end with the Co-Authored-By trailer; branch off `main` only if
  asked — work has been committing straight to `main` per the owner's requests.

## Deferred (needs owner decisions, not just code)

- **Auth / access**: Google OAuth + allowlist/invite. Blocks any real deploy.
  See design "Access And Privacy" + Open Questions.
- **Gig Packets + attendance**: needs gig data in **Postgres** (mutable,
  multi-writer data shouldn't live in git). UI tab is a placeholder.
- **Admin / import UI**, **MuseScore build worker**, **PWA performance view**,
  **transposition** — later phases in the design milestones.

## Known small TODOs (cosmetic)

- `TuneDetail` "No part for …" shows the instrument *slug* instead of its pretty
  label.
- `src/app.html` references `/favicon.png` which doesn't exist yet (harmless 404).
- The web look was verified via SSR HTML + endpoints, not a real visual pass —
  worth eyeballing `npm run dev` and tuning palette/spacing.

## Suggested next steps

1. Visual pass on the player UI in a browser; tweak to taste.
2. Decide the auth model so the app can be gated before deploy.
3. Stand up Postgres + build Gig Packets/attendance.
4. Optional: re-run `node bin/sync.js` to backfill `songTitleSlug` into existing
   manifest entries (metadata is recomputed every sync; no re-downloads).

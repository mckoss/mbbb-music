# MBBB Music

The Mutiny Bay Brass Band music library and distribution app.

The goal is to turn the band's sheet-music collection into a searchable,
instrument-aware catalog that can produce useful packets for practice and
performance: PDFs, audio, set lists, and per-player downloads. The files currently
live in Google Drive, but the product imports them into app-owned storage instead
of treating Drive paths or original filenames as permanent library structure.
Player downloads use standardized app-generated filenames.

This repository is public and contains only code, documentation, schemas, and
sample fixtures that are safe to publish. The actual band music library, generated
PDFs, MP3s, and any copyrighted source material live in private storage outside
this repo.

## Current Status

The project is moving from design into implementation. Today the repo contains:

- The product design and architecture: [docs/design.md](docs/design.md)
- A working interactive prototype with sample data: [docs/index.html](docs/index.html)
- Working rules for contributors and agents: [AGENTS.md](AGENTS.md)

Next up is the first production slice (app scaffold, catalog schema, and importer);
see the milestones in [docs/design.md](docs/design.md) for the planned build order.

## Phase 1: Drive Asset Sync

A reusable Drive asset sync lives under `src/sync/`, with a CLI entry point at
`bin/sync.js` and an Express-callable handler at `src/server/sync-route.js`. It
downloads only real asset files (score PDFs, MP3s, MuseScore files), groups them
by song under `data/<song-title-slug>/` with canonical lowercase slug filenames
(e.g. `bad-guy-trumpet-bflat-2.pdf`), ignores Drive shortcuts and non-asset
files, and maintains `data/manifest.json` for incremental, idempotent refreshes.
`data/` is gitignored — synced music never enters this public repo.

It needs no install (Node 20+, zero dependencies). Try it against built-in
synthetic fixtures, no Google credentials required:

```bash
npm run sync:demo          # sync synthetic fixture data into ./data
node bin/sync.js --help    # all options
npm test                   # slug, classification, and manifest-diff tests
```

To run against **real** Google Drive, configure the two source folders via
`MBBB_DRIVE_FOLDER_1_ID` / `MBBB_DRIVE_FOLDER_2_ID` and provide OAuth
credentials (the `--fixture` flag is only for credential-free demos/CI):

| Variable | Purpose |
| --- | --- |
| `MBBB_GOOGLE_ACCESS_TOKEN` | A ready OAuth bearer token. Simplest; not auto-refreshed. |
| `MBBB_GOOGLE_CLIENT_ID` + `MBBB_GOOGLE_CLIENT_SECRET` + `MBBB_GOOGLE_REFRESH_TOKEN` | Refresh-token grant; the client mints and re-mints access tokens itself. |
| `MBBB_GOOGLE_TOKEN_FILE` | Optional path to a JSON token object, loaded only when set and the file exists; its fields fill any gaps in the above. Never defaulted to a private path. |

The client uses Drive v3 `files.list` (folder-scoped, `trashed=false`, paginated)
and `files.get?alt=media`, built on Node 20's global `fetch` with zero
dependencies. With no credentials, a non-`--fixture` run fails fast with guidance.
The Changes API + persisted `startPageToken` delta listing is a later refinement.

## Open Questions

- Which Google Drive folders or local paths are current import sources?
- Which instruments and named parts should be first-class in the catalog?
- Which output format matters first: letter PDFs, 7x5 lyre PDFs, per-instrument
  zip files, or a web/PWA performance view?
- How complete and clean are the MuseScore source files compared with the PDF and
  MP3 collection?
- What access model should the live site use for band members?

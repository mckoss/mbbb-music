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
`bin/sync.js` and an Express-callable handler at `src/server/sync-route.js`. Each
configured source folder is scanned **recursively** — the band's Drive is laid
out as `<source>/<song-title>/<asset>` (and may nest deeper), so the top-level
folder under each source is treated as the song. The sync downloads only real
asset files (score PDFs, MP3s, MuseScore files) and groups them under
`data/<source-slug>/<song-slug>/` with canonical lowercase slug filenames (e.g.
`bad-guy-trumpet-bflat-2.pdf`). The source prefix keeps two libraries from
colliding on a same-named song. It **de-duplicates by content** (SHA-256):
identical bytes are downloaded once; every other copy stays in the manifest,
flagged a duplicate and redirected to the original — never a second file on disk.
When the same content sits in several folders, an optional `deprioritize` list in
config.json (e.g. by-instrument re-index folders) keeps those copies from being
picked as the canonical download, so the real song-folder copy wins.
Drive shortcuts and non-asset files are ignored, and `data/manifest.json` tracks
everything for incremental, idempotent refreshes. The end-of-sync report lists
all duplicate sets. `data/` is gitignored — synced music never enters this repo.

Install once (`npm install`), then try it against built-in synthetic fixtures,
no Google credentials required:

```bash
npm install               # one dependency: google-auth-library (service-account JWT)
npm run sync:demo          # sync synthetic fixture data into ./data
node bin/sync.js --help    # all options
npm test                   # slug, classification, and manifest-diff tests
```

To run against **real** Google Drive, configure two things: the Drive **source
folders** to sync and a Google **service-account key** for API access. The source
folders are public, so no folder sharing is needed — the service account just
supplies Drive API credentials. `google-auth-library` signs the JWT and
mints/refreshes access tokens. (The `--fixture` flag is only for credential-free
demos/CI.)

The full config is one JSON document, read from a git-ignored `config.json` in the
repo root, or — if that file is absent — from the `MBBB_CONFIG_JSON` environment
variable holding the same JSON. `config.json` is tried first, then
`MBBB_CONFIG_JSON`. Its shape (`sources` accepts any number of folders):

```json
{
  "dataDir": "data",
  "sources": [
    { "id": "<drive-folder-id>", "label": "scores" },
    { "id": "<drive-folder-id>", "label": "recordings" }
  ],
  "google": { "serviceAccount": { "client_email": "...", "private_key": "...", "...": "..." } }
}
```

### Create a service account

1. In the [Google Cloud Console](https://console.cloud.google.com/), create (or
   pick) a project and enable the **Google Drive API** for it.
2. Under **APIs & Services → Credentials**, create a **Service Account**.
3. On that service account, open **Keys → Add key → Create new key → JSON** and
   download the key file. That downloaded JSON object is exactly what goes in the
   `google.serviceAccount` field below — `client_email`, `private_key`, and the
   rest. Treat it as a secret; never commit it.

A Drive folder's id is the last path segment of its URL, e.g.
`https://drive.google.com/drive/folders/<this-part-is-the-id>`.

### Local setup (config.json)

Copy the example and fill it in:

```bash
cp config.example.json config.json
```

Then edit `config.json`: list your folder ids under `sources`, and paste the
entire downloaded service-account JSON as the value of `google.serviceAccount`.
`config.json` is git-ignored, so the key stays out of the repo. Verify:

```bash
node bin/sync.js --dry-run        # lists/classifies real Drive files without downloading
```

### Railway setup (MBBB_CONFIG_JSON)

Railway has no checked-in `config.json`, so provide the same JSON through the
`MBBB_CONFIG_JSON` environment variable. In the Railway service's **Variables**
tab, add a variable named `MBBB_CONFIG_JSON` whose value is the whole config
document as a single JSON string (folders **and** the `serviceAccount` block). The
downloaded key already encodes its `private_key` newlines as `\n` inside the JSON
string, so pasting the JSON verbatim works — no extra escaping needed.

If you already have a working local `config.json`, generate the one-line value to
paste from it:

```bash
node -e "process.stdout.write(JSON.stringify(require('./config.json')))"
```

The sync reads no other environment variables; `MBBB_CONFIG_JSON` carries
everything.

The client uses Drive v3 `files.list` (folder-scoped, `trashed=false`, paginated)
and `files.get?alt=media`, built on Node 20's global `fetch`. With no service
account, a non-`--fixture` run fails fast with guidance. The Changes API +
persisted `startPageToken` delta listing is a later refinement.

## Open Questions

- Which Google Drive folders or local paths are current import sources?
- Which instruments and named parts should be first-class in the catalog?
- Which output format matters first: letter PDFs, 7x5 lyre PDFs, per-instrument
  zip files, or a web/PWA performance view?
- How complete and clean are the MuseScore source files compared with the PDF and
  MP3 collection?
- What access model should the live site use for band members?

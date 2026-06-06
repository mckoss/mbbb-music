# AGENTS.md - MBBB Music

Context and working rules for coding agents taking over this repository.

## What This Is

MBBB Music is a public design repository for a future Mutiny Bay Brass Band music
library and distribution app.

The product goal is to turn the band's sheet-music collection into an
app-owned, searchable, instrument-aware catalog that can produce useful packets
for practice and performance: PDFs, audio, set lists, and per-player downloads.

The project is moving from design into implementation. The repo currently
contains the product design, a working interactive prototype, and these working
rules; the first production slices (app scaffold, catalog schema, importer) are
next.

## Hard Rules

1. Keep this repository public-safe. Do not commit copyrighted sheet music,
   generated PDFs, MP3s, MuseScore files, private Google Drive exports, member
   contact details, credentials, or other private band material.
2. Treat Google Drive as an import source, not the durable product model. The
   future app should import files into app-owned catalog records and app-managed
   storage.
3. Player-facing downloads should use standardized, app-generated filenames.
   Do not expose original Drive folder paths or messy source filenames as the
   user-facing structure.
4. Preserve iPad/tablet performance use as a first-class requirement. Large
   controls, outdoor-readable views, offline-ready packets, and set-list order
   matter.
5. Keep changes scoped. This repo is early-stage design work; avoid inventing a
   full framework or backend until the next implementation step is explicit.

## Current Repository Shape

```text
README.md        - Project overview and open questions
docs/README.md   - Links for the hosted docs surface
docs/design.md   - Main product/design document
docs/index.html  - Static interactive design prototype
docs/app.js      - Prototype data and behavior
docs/styles.css  - Prototype styling
docs/assets/     - Public-safe visual assets
src/sync/        - Phase 1 Drive asset sync core (reusable service)
src/server/      - Express-callable handler for hosted refreshes
bin/sync.js      - Phase 1 sync CLI entry point
test/            - node:test suites (slug, classify, manifest, sync)
package.json     - Scripts/metadata; ESM, one runtime dep (google-auth-library)
```

The docs surface is plain HTML, CSS, and JavaScript under `docs/`, suitable for
GitHub Pages. The Phase 1 Drive sync (`src/sync`, `bin/sync.js`) runs on Node
20+ with a single dependency (`google-auth-library`, for service-account JWT
signing) and uses the built-in `node:test` runner. Synced music lands in the
gitignored `data/` directory and never enters this public repo.

## Local Workflow

For the current static prototype, open `docs/index.html` directly in a browser
or serve the repo with any simple static server if browser security restrictions
become relevant.

Useful checks:

```bash
git status --short
python3 -m http.server 8000 --directory docs   # serve the static prototype
npm test                                        # Phase 1 sync test suites
npm run sync:demo                               # sync synthetic fixtures into ./data
node bin/sync.js --help                         # Phase 1 sync CLI options
```

Then visit `http://localhost:8000/` for the prototype. The Phase 1 sync needs
`npm install` (one dependency, `google-auth-library`); run with `--fixture` to
exercise it without Google credentials.

If a future app is added, update this file with the new install, run, test, and
deploy commands before assuming another agent will know them.

## Dependencies

There is no blanket "no-dependency" rule for this project. Depending on
mainstream, well-maintained libraries is fine when a dependency removes real
hand-rolled complexity. The constraints are about control, not abstinence:

- Declare every runtime dependency explicitly in `package.json`; don't lean on
  transitive packages.
- Pin exact versions — no `^`/`~` ranges — so a version only changes when we
  deliberately bump it. Commit `package-lock.json` so installs are reproducible.
- Update deliberately: bump a version in its own change, never as a silent side
  effect of something else.
- Prefer the Node standard library for small, stable needs; reach for a
  dependency when it genuinely earns its weight.

The `docs/` prototype is a separate case: it stays buildless (plain HTML/CSS/JS)
so GitHub Pages serves it directly — a deployment choice for the frontend, not a
rule for the Node tooling.

## Product Model

The main design source of truth is `docs/design.md`. Important concepts:

- Tune: the musical work as the band knows it.
- Arrangement: a version or revision of a tune.
- Part: playable music for a specific instrument or role.
- Asset: an app-managed file, including provenance from Drive or upload.
- Output recipe: generated or packaged formats such as letter PDF, 7x5 lyre
  PDF, iPad view, instrument zip, section zip, full-band packet, set-list
  packet, and MP3 bundle.
- Member: Google-account-backed participant with instruments, part preferences,
  and role.
- Gig: scheduled event with logistics, attendance, and ordered set list.

Do not let source folder layout leak into these concepts. Folder names and
filenames are import evidence, not product architecture.

## Instrument Naming

Use normalized player-facing instrument labels. The current initial list is in
both `docs/design.md` and `docs/index.html`:

- Alto saxophone (E-flat)
- Baritone saxophone (E-flat)
- Clarinet (B-flat)
- Drums / percussion
- Euphonium / baritone (B-flat)
- Flute
- French horn (F)
- Mellophone (F)
- Melodica
- Soprano saxophone (B-flat)
- Tenor saxophone (B-flat)
- Trombone (B-flat)
- Trumpet (B-flat)
- Tuba / sousaphone (B-flat)

Default instrument tuning belongs in the visible name unless it adds noise, such
as percussion or concert-pitch C instruments.

## Static Prototype Guidance

The current prototype is intentionally direct:

- `docs/app.js` keeps sample tune, member, gig, set-list, and attendance data in
  JavaScript arrays.
- `docs/index.html` defines the app shell, collection view, gig packet view, and
  score/performance view.
- `docs/styles.css` contains the full visual system.

When editing the prototype:

- Keep the prototype buildless — plain HTML/CSS/JS that GitHub Pages serves
  directly — unless Mike explicitly asks for a real app scaffold. This is a
  deployment choice for `docs/`, not a project-wide no-dependency rule (see
  [Dependencies](#dependencies)).
- Do not add real private data to sample arrays.
- Make the Collection, Gig Packets, and Performance flows remain usable on both
  desktop and tablet widths.
- Keep buttons, selects, and score controls large enough for field use.
- If changing `docs/index.html`, update CSS/JS cache-busting query strings when
  needed so GitHub Pages refreshes cleanly.

## Future App Direction

The likely production direction, per `docs/design.md`:

- Google accounts for member/admin sign-in.
- Railway for the deployed app and background workers.
- App-owned catalog database and private file storage.
- Importers for Google Drive, local folders, manual uploads, and future bulk
  import jobs.
- Packet generation by instrument, section, full band, and gig set list.
- PDF and audio downloads first; MuseScore-generated outputs only where source
  quality supports them.
- Tablet/offline workflow as a primary user journey, not a later mobile polish
  pass.

Before implementing backend code, clarify the first production slice. Good
candidate slices are:

- Catalog schema plus private fixture importer.
- Instrument packet filename and manifest generator.
- Admin import review screen.
- Gig/set-list packet prototype.
- Static prototype extraction into a small real app.

## Privacy And Source Material

Actual music assets should live outside this public repo in private storage.
Safe repository contents include code, documentation, schemas, sample fixtures,
and public-safe visual assets. Unsafe contents include:

- Band music PDFs, scans, MP3s, MIDI files, and MuseScore sources.
- Raw Google Drive exports or filenames if they reveal private library contents
  beyond intentional samples.
- Member email addresses, phone numbers, attendance details, or private notes.
- API keys, service-account keys, tokens, cookies, and the local `config.json`.

When in doubt, add a tiny synthetic fixture instead of a real file.

## Commit Guidance

Mike's broader rule for active software projects is to ask before committing.
Make the code or docs change, verify it, show the diff summary, and wait for an
explicit commit request.

For this repo specifically, keep commits focused: one design update, prototype
change, importer experiment, or documentation pass at a time.


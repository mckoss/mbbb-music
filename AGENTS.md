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
6. Production is the normal validation environment for this repository. Once a
   user-requested change is implemented in its worktree and its relevant tests,
   checks, and build pass, that success is standing authorization to bump the
   version, commit, and push the branch to `main` without asking again. This
   does not turn a design discussion into authorization to implement, excuse
   failed or skipped verification, or authorize unrelated outward actions.
   After the commit has landed and the deployment is verified, dispose of the
   clean worktree and local branch without asking again.

## Current Repository Shape

```text
README.md        - Project overview and open questions
PLAN.md          - Music production pipeline plan (LilyPond masters, OMR); read first for pipeline work
docs/README.md   - Links for the hosted docs surface
docs/design.md   - Main product/design document
docs/index.html  - Static interactive design prototype
docs/app.js      - Prototype data and behavior
docs/styles.css  - Prototype styling
docs/assets/     - Public-safe visual assets
src/sync/        - Phase 1 Drive asset sync core (reusable service)
src/lilypond/    - LilyPond pipeline: .mscz -> MusicXML -> .ly + fixups -> PDFs, MIDI, MP3
src/omr/         - PDF-only songs: Audiveris OMR per part -> bar repair -> merged draft master
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
npm run map:update                              # refresh the committed public OSM basemap
node bin/sync.js --help                         # Phase 1 sync CLI options
```

Then visit `http://localhost:8000/` for the prototype. The Phase 1 sync needs
`npm install` (one dependency, `google-auth-library`); run with `--fixture` to
exercise it without Google credentials.

The member roster's offline map is generated from public OpenStreetMap vector
data and committed at `static/maps/member-map.json`. Refresh it only with
`npm run map:update`; the updater fetches roads, coastlines, and place names but
never reads member profiles or the gitignored `data/` directory. Keep the visible
OpenStreetMap attribution when changing the map renderer.

The Gig-sheet import (`src/lib/server/gig-sheet.ts`, parsing in
`src/lib/gig-sheet.ts`) reads the band's availability Google Sheet once a day
(server `init` hook) and on demand from the admin-only **Sync Gig Sheet** button
on `/gigs`. The sheet link, column→gig links, player→member links and the last
report live in the gitignored `data/gig-sheet.json` — never commit the sheet id.
It only ever adds gigs and marks them canceled (CANCELLED text or a red title);
website-entered RSVPs always
win and disagreements show a "Gig Sheet Conflict" flag on the gig roster.
Deleting a gig leaves a tombstone in `data/gig-sheet.json` so the sync never
re-creates it; admins can "Allow re-import" from the sync panel.
The parser finds the player-name and instrument columns by what their cells
hold (sheets grow helper columns like "#" or leftover answers beside the
names), reads a day range and year after a header's date as part of the date,
and never cuts a title down to a fragment. An imported gig's auto-given name
(`autoNames` in the state) is updated from the sheet only while nobody has
renamed it on the site. Both gig pages link to the configured sheet.
The admin-only **Sync Contacts** button on `/members`
(`src/lib/server/contacts-sheet.ts`) reads the same spreadsheet's "Contacts"
tab and fills only never-edited member-profile fields; contacts without an
account are listed for an admin to add explicitly.

Every non-dry-run sync writes a history record to the gitignored
`data/sync-history/` (`src/sync/history.js`, diffing the manifest before vs after
the run); admins read it at `/admin/sync-history`. Tests pass temp data dirs, so
their runs never touch the real history.
Per-file tracing lives at `/library-status/files/<drive id>`; the explanation is
the pure `describeHandling` in `src/sync/file-handling.js` — keep it in step with
`buildCatalog` when placement, masking, or dedup rules change.
A file deleted in Drive stays in the library on its stored copy
(`isKeptAfterDriveRemoval` in `src/sync/catalog.js`) until an admin archives it
(the admin-only `archived` file correction); never drop removed files from the
catalog on sync.
Folder shortcuts are followed during the walk. A song folder reached through a
shortcut is flagged `songFolderLinked` and treated as a real song folder even in
a loose (`foldered: false`) source; a shortcut to a folder already walked is
skipped via the shared visited set.
Every Drive file must be represented: in a song, on Extra Files, or — when the
app has no copy (Google Form, over 100 MB, unreadable shortcut) — as a
link-only Extra Files entry (`linkOnlyExtra` in `src/sync/catalog.js`). Only OS
junk, folders, and archived files are exempt.

If a future app is added, update this file with the new install, run, test, and
deploy commands before assuming another agent will know them.

## Deployment Image (Railway)

Railway builds the root `Dockerfile` (it takes precedence over Railway's default
builder). Every system tool the server needs is installed there, never by hand
on a running service: Node 24, LilyPond (`lilypond`, `musicxml2ly`), MuseScore
Studio 4.7.7 (the band's scores are saved by 4.6.x; older versions refuse to open
them), Xvfb, `unzip`, and fluidsynth with the FluidR3 General MIDI soundfont
plus `lame` (MIDI → MP3 for the LilyPond pipeline; `SOUNDFONT_PATH` points at
the soundfont), and Audiveris 5.11 (OMR; bundles its own Java, needs
`libgtk-3-0t64` even headless; `AUDIVERIS_BIN`) with Tesseract English data in
`/root/.config/AudiverisLtd/audiveris/tessdata`. MuseScore 4.7 needs an X display even for CLI exports,
so `scripts/mscore-headless.sh` is installed as `/usr/local/bin/mscore`, runs it
under `xvfb-run`, and `MSCORE_BIN` points the app at it. The app runs from
`/app`, as it did under Railway's default builder.

When you add a system dependency, add it to the `Dockerfile` and to the cloud dev
environment's setup script together, and check that the image builds
(`docker build -t mbbb .`); the build fails if `lilypond`, `mscore`,
`fluidsynth`, `lame` or Audiveris does not run, or the soundfont is missing. In a cloud dev
container the proxy re-signs HTTPS, so a local build needs its CA
(`/root/.ccr/ca-bundle.crt`) copied in and set as `CURL_CA_BUNDLE` and
`NODE_EXTRA_CA_CERTS` in a scratch copy of the Dockerfile; never commit that.

## LilyPond Pipeline (admin-only)

`src/lilypond/` turns a song's MuseScore master into LilyPond-engraved output:
MuseScore exports MusicXML (and a reference MIDI), `musicxml2ly --absolute
--midi` converts it, the fixup rules in `fixups.js` correct it (drum staves,
drum sounds by family, accidentals in part names, MuseScore layout breaks), and
`generate.js` writes one LilyPond source per output: full score (Letter), each
part in Letter and Lyre, and a MIDI score (repeats unfolded, one channel per
instrument) that fluidsynth + lame render to `<song>-band.mp3`. `midi.js`
compares LilyPond's MIDI with MuseScore's, part by part; a build "passes" when
every pitched part matches at least 95% (drums compare timing only).

Admins start builds on the Generated tab (`/library-status/generated-scores`);
the queue runs in the server (`src/lib/server/lilypond-runner.ts`) behind
`/admin/lilypond`, which re-checks the admin role (PLAN.md decision 9). Outputs
are stored in `data/cas`, recorded in the gitignored `data/lilypond/state.json`,
and join the catalog as the generated source `lilypond`, which supersedes the
song's MuseScore-built parts and band mix and masks replaced manual parts.
Removing a build brings those back. Test against a throwaway data dir (an
`MBBB_CONFIG_JSON` with its own `dataDir`), never the real library.

A rebuild replaces the song's previous LilyPond output (one copy per generated
file; no generation history). Files a generated part masks — the band's own
Drive PDFs, or MuseScore-built parts — are never dropped: players see them in
every part picker as "older version" entries after the current part
(`partsForFormat(..., { withOlder: true })` in `src/lib/resolve.ts`), while
packets and downloads keep only current files. Each song's page under the
Generated tab (`/library-status/generated-scores/<slug>`) lists **all versions**
of every part and the full score by origin (original Drive PDFs, MuseScore-built,
LilyPond, draft), plus the MuseScore master and every recording; previews the
LilyPond files (including the `.ly` source); and has a side-by-side viewer with
up to three panes (default: original, MuseScore-built, LilyPond) for any part or
the full score. Song titles on Library Status and the Generated tab link to this
page (with `?from=` for the back link), and admins can build, rebuild (with AI
for PDF-only songs) or remove the LilyPond output from it directly. LilyPond PDFs print no title block of their own: the same
app-owned header and render-date stamp as MuseScore-built parts
(`src/scores/stamp.js`, via `stampOutput` in `src/lilypond/pipeline.js`) is
drawn into the reserved top band (1" Letter, 0.5" Lyre). Swing marked in the score (`<swing>`) is applied
to the MIDI with LilyPond's `\applySwing`, and the fidelity check matches
onsets within 0.05 beats.

PDF-only songs (no MuseScore master) get a **draft** master instead
(`src/omr/`): `select-parts.js` picks one PDF per part (Letter preferred, shared
role charts and drums skipped), Audiveris reads each, `score.js` repairs bar
counts against the measure numbers printed at each system start (read from the
PDF text layer), adds the transposition and MIDI sound OMR can't know, and
merges the parts; `renderMusicXml` then engraves a full score and band MP3. Draft
outputs use the ordinary source `lilypond-omr`, so they sit beside the band's
PDFs and mask nothing. OMR misreads (a wrong bar length, a missed line) are
listed in the report.

**AI correction pass** (`src/omr/correct.js`, admin-only "Build with AI", shown
only when the server has `ANTHROPIC_API_KEY` — a Railway service variable; the
cloud dev environment has no key). Per page of each part PDF, Claude Opus 5.5
(`claude-opus-5-5`, effort `high`, structured JSON output, server-side refusal
fallback, cached system prompt) sees the page image (`pdf-image.js`) beside the
OMR reading in the compact one-line-per-bar notation of `compact.js`, and returns
the page's bars. Every returned bar is parsed and checked against the time
signature (`validatePage`); valid pages replace the OMR bars, invalid bars keep
the OMR reading, and each call's tokens and USD cost go into the build report.
Tests stub the client (`stream(params).finalMessage()`); no test calls the API.

**Never hide a feature without saying why.** When an admin feature is off for a
missing setting (a key, a tool, a config value), keep its control visible but
disabled and show an admin-only note naming the missing setting and the exact
steps to enable it.

**Railway variables are staged.** Adding or editing a service variable in
Railway does nothing until someone clicks **Deploy** on the staged-changes
banner; a push-triggered code deploy does not apply them. Check a variable is
live by listing variable *names* through the Railway API, never values.

## Isolated Changes With Git Worktrees

Every code change runs its whole lifecycle in a git worktree:
**isolate → modify → commit → push → then dispose.** Creating the worktree is
the **first** step — make it *before* touching any code, not after starting to
edit in the main checkout. Push the worktree's branch straight to the remote; do
**not** merge the branch back into the main checkout first — that adds churn and
obscures which checkout you're operating in.

1. **Isolate.** Create the worktree and symlink the three gitignored paths a
   fresh checkout lacks — `data/` (manifest + content-addressed blobs),
   `config.json` (Drive credentials), and `node_modules/` — from the main
   checkout, so a re-sync, the web server, and the tests work without re-fetching
   ~1000 files from Drive or reinstalling dependencies:

   ```bash
   git worktree add -b <branch> ../mbbb-music-<name>
   cd ../mbbb-music-<name>
   ln -s ../mbbb-music/data data
   ln -s ../mbbb-music/config.json config.json
   ln -s ../mbbb-music/node_modules node_modules
   ```

   With those three symlinks the worktree is immediately **testable** — no
   re-sync, no `npm install`. `npm run check`, `npm run build`, and `npm test`
   resolve through the linked `node_modules`, and the web server serves the real,
   pre-populated catalog through the linked `data/` (manifest, content-addressed
   blobs, and the render cache — so scores render without re-rasterizing). Run it
   with `npm run dev`, or `MBBB_NO_AUTH=true npm run dev:no-auth` for an open
   LAN/dev session that skips Google sign-in (a synthetic admin). `check`,
   `build`, the tests, and the no-auth dev server need none of `config.json`'s
   secrets — only a real Drive re-sync does — so you can verify a change end to
   end without ever touching credentials.

   If a dev server is already running in the main checkout, **stop it first**,
   then start the dev server in the worktree so it reuses port **5173** — the
   worktree's running app is the one you're changing. Vite picks the next free
   port (5174…) if 5173 is still held, so leaving the old server up would serve
   the worktree on the wrong port and the main checkout's stale code on 5173.
   Stop the worktree's server and restart the main checkout's on 5173 only after
   you dispose of the worktree.

2. **Modify** the code. If the change affects classification, re-sync here — it
   writes **through** the `data` symlink to the shared manifest the running
   server reads (intentional, not a leak).

   After you finish modifying, run the relevant verification
   (`check`/`build`/tests). Passing verification authorizes Commit and Push per
   Hard Rule 6; continue without another approval prompt.

3. **Commit** in the worktree after verification passes, staging only the files
   you changed (`git add <paths>` — never `git add -A`; the `data`/`node_modules`
   symlinks show as untracked because the trailing-slash `.gitignore` patterns
   don't match symlinks). Bump the version here too — the worktree's
   `package.json` is clean, which avoids fighting unrelated uncommitted edits in
   the main checkout.

4. **Push** the branch from the worktree straight to the remote
   (`git push origin <branch>:main`, since this repo works direct-to-main).
   Passing the relevant verification for a user-requested change is the
   repository's standing go-ahead for this push.

5. **Dispose** automatically after the push has landed and the deployment is
   verified. Do not ask for another confirmation. Remove the symlinks, then run
   `git worktree remove <path>` and delete the local branch.

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

## Test & Demo Safety

Tests and demos must NEVER read or write the real, co-located data in the repo
(the gitignored `data/` directory holds the rebuilt music library):

- Tests write only to OS temp dirs (`mkdtemp(os.tmpdir())`), never `./data`.
- The `--fixture` demo writes to a throwaway sandbox (`tmp/fixture-data`) and
  hard-refuses to run against the real data directory, so synthetic fixture data
  can never co-mingle with or clobber real assets.
- When invoking the CLI by hand to try something, pass `--data-dir <throwaway>`
  unless you specifically intend to touch the real library.

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
  directly — unless a real app scaffold is explicitly requested. This is a
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

## Versioning

All browser-originated writes carry the version of the client bundle that made
the request. Native/enhanced forms are stamped centrally with
`_clientVersion`; programmatic mutations must use `writeFetch` from
`src/lib/client-version.ts`, which sends `x-mbbb-client-version`. Server code
must treat missing/invalid version context as a legacy/unknown client and use
presence-aware patches for additive fields so an older form cannot erase newer
data.

The app carries a semantic version (`MAJOR.MINOR.PATCH`) that is bumped with
every push.

- **Single source of truth:** `package.json`'s `version` field. `svelte.config.js`
  reads it into `kit.version.name`, so `import { version } from '$app/environment'`
  returns the same string. The masthead shows it as small `v X.Y.Z` text
  (`src/routes/+layout.svelte`). Never hard-code the version anywhere else — the
  package.json value and the UI must always match.
- **Bump every push.** Before pushing, raise the version to match the change:
  - **MINOR** (`0.2.x` → `0.3.0`) for a new feature or user-visible enhancement.
  - **PATCH** (`0.2.1` → `0.2.2`) for a bug fix or small, non-feature change.
  - **MAJOR** is reserved for a breaking change or a deliberate milestone — ask
    the maintainer before bumping it.
- Use judgement: when a push mixes a feature and fixes, bump MINOR. Reset PATCH
  to 0 on a MINOR bump (e.g. `0.2.4` → `0.3.0`).
- One bump per push, not per commit; the version reflects what ships.
- **Keep `package-lock.json` in sync.** Whenever you commit a `package.json`
  change (a version bump included), update `package-lock.json` in the same commit
  so its `version` fields match — run `npm install --package-lock-only`, then
  `git add package-lock.json`. The lockfile must never lag `package.json`.

## Commit Guidance

For a user-requested change, commit and push after the relevant tests, checks,
and build pass; do not ask for a separate commit/push confirmation. Production
testing is the expected review loop for this repository. After the pushed
commit is live and verified, dispose of its clean worktree without asking.

For this repo specifically, keep commits focused: one design update, prototype
change, importer experiment, or documentation pass at a time.

**Linear history — no merge commits, ever.** This repo keeps a fully linear
history. Land work by rebasing the branch onto the current `main` (a
fast-forward push), or, when a GitHub PR is used, **squash-merge** it. Defer the
rebase until the feature is ready to push — don't integrate with `main`
prematurely; the only reason to integrate a branch early is to cherry-pick a
single commit out of it. This is enforced: the GitHub repo has
`allow_merge_commit` disabled (only squash and rebase merges are allowed), and
locally `merge.ff = only` (a non-fast-forward `git merge` errors instead of
creating a merge commit) with `pull.rebase = true`.

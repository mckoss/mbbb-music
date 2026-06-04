# MBBB Music Design

## Problem

Mutiny Bay Brass Band has a useful but unwieldy music library currently sitting in
Google Drive. That location is an import artifact, not the long-term product model.
The future app should own a catalog and app-managed file storage for sheet music,
MuseScore files, MP3 practice tracks, and possibly MIDI files. Band members need
different slices of the same library:

- iPad/tablet users want an offline folder or web/PWA experience.
- Paper users want printable PDFs.
- Some players want standard 8.5x11 pages for a book.
- Some players want smaller 7x5 pages for lyre-mounted music.
- Each player needs only the parts that apply to their instrument, including
  sub-parts such as Trumpet 1 and Trumpet 2.
- Practice should include audio when available.

The first project goal is to design a catalog and sync system, not write code yet.

## Goals

- Build a public GitHub project for the software and design.
- Keep the actual music files private unless the band explicitly decides otherwise.
- Import the existing music files into an app-owned catalog and storage system.
- Track title, arrangement, source asset, instrument, part, output format, and
  audio availability.
- Let a musician download a ready-to-use package for their instrument.
- Treat iPad/tablet field use as a primary target: large touch controls,
  outdoor-readable performance views, and offline-ready packets.
- Let an admin add files through Drive, local upload, bulk filesystem import, or a
  future web interface.
- Make the admin/back-office upload flow simple enough for non-technical band
  leaders to use without understanding GitHub, code, or the storage model.
- Let a band leader or member create a gig with date, address, schedule details,
  ordered set list, and attendance tracking.
- Let players view or print music in gig set-list order for their own instrument.
- Use Google accounts for member/admin sign-in and site access, with an optional
  invitation or shared secret-code step if needed for simple member onboarding.
- Support generated outputs from MuseScore where the source files are good enough.
- Make the complete inventory visible even when some works are incomplete or
  messy, then evolve the library toward more uniform source and output coverage.
- Run the deployed app and background workers on Railway.

## Non-Goals For The First Pass

- Do not treat the current Drive organization as a user-facing information
  architecture.
- Do not assume every tune has a clean MuseScore master.
- Do not require a MuseScore master, practice audio file, or pre-split
  per-instrument PDF before a tune can appear in the catalog.
- Do not publish copyrighted PDFs, MP3s, or score files in this public repository.
- Do not build the production performance viewer until the catalog and packet
  workflow are proven.
- Do not build automatic transposition until source quality, instrument mappings,
  and generated-output workflows are proven.

## Users

- Band librarian / admin: imports files, fixes metadata, resolves duplicates,
  approves generated outputs, and builds set packets.
- Band leader / gig organizer: creates gigs, enters logistics, builds ordered set
  lists, and checks attendance by player and instrument.
- Player: selects instrument and gets the current music packet with relevant parts
  and practice audio; confirms availability for gigs.
- Section lead: checks that parts exist for their section and may download a
  section packet.

## Core Data Model

### Tune

A tune is the musical work as the band knows it.

- Title
- Alternate titles
- Composer / arranger, if known
- Style or set tags
- Status: active, archive, draft, needs cleanup
- Notes

### Arrangement

Some tunes may have multiple arrangements or revisions.

- Tune reference
- Version label
- Source authority: MuseScore master, PDF set, scanned image, manual upload
- Revision date
- Source asset references
- Build status

### Part

A part is a playable score for a specific instrument or role.

- Arrangement reference
- Instrument family
- Instrument
- Part label, such as Trumpet 1, Trumpet 2, Trombone, Tuba, Drum, Conductor
- Transposition/key, if useful
- Source asset reference
- Generated output references
- Print recipes available
- Availability status for each user-facing asset: score, part PDF, performance
  view, and practice audio

### Instrument Naming

Instrument and part labels should come from the imported part filenames where
possible, then be normalized for the player-facing picker. The picker should
include default instrument tuning in the visible name, except for drums/percussion
and concert-pitch C instruments where a suffix would add noise.

A Drive sample of five tune bundles, including Track Suit and Iron Man, found
these useful part labels across the PDF filenames:

- Track Suit: Alto saxophone, Euphonium, Trumpet
- Iron Man: Alto saxophone, Baritone saxophone, Drum set, Euphonium, Melodica,
  Soprano saxophone, Tenor saxophone, Trombone, Trumpet, Tuba
- Moliendo Cafe: Alto saxophone, Baritone saxophone, Bass drums, Clarinet in
  B-flat, Congas, Drumset, Euphonium, Flute, Horn in F, Tenor saxophone,
  Trombone, Trumpet in B-flat, Tuba
- Matador: Alto saxophone, Baritone horn, Baritone saxophone, Bass drum,
  Clarinet in B-flat, Flute, Marching tenor drums, Mellophone, Snare drum,
  Tenor saxophone, Trombone, Trumpet in B-flat, Tuba
- Hot to Go: Alto saxophone, Baritone saxophone, Bass drums, Cymbals,
  Euphonium, Melodica, Snare drum, Sousaphone, Tenor drums, Tenor saxophone,
  Trombone, Trumpet

Initial player-facing instrument options:

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

### Asset

An asset is a physical file.

- Type: MuseScore, PDF, MP3, MIDI, image, other
- App-managed storage location: local filesystem, private object store, or
  generated cache
- Import provenance, if useful: original filename, original folder, Drive file id,
  upload batch, or importer job id
- Checksum
- Size
- Modified time
- Import time
- Linked tune / arrangement / part, if known

### Output Recipe

An output recipe defines what the system can build.

- Letter PDF, 8.5x11
- Lyre PDF, 7x5
- iPad/tablet performance view
- Per-instrument zip
- Section zip
- Full-band packet
- Set-list packet
- MP3 practice bundle

### Member

A member is a band participant who can sign in and optionally appear on gig
attendance lists.

- Display name
- Email / Google account identity
- Instrument or instruments
- Default part preferences, such as Trumpet 1 or Trumpet 2
- Role: member, librarian, admin
- Active / inactive status

### Gig

A gig is a scheduled performance or rehearsal event with logistics, attendance, and
an ordered set list.

- Name
- Date
- Venue name
- Address
- Call / arrival time
- Performance start time
- Performance end time or estimated duration
- Public/private notes
- Parking, dress, contact, or setup notes
- Created by
- Status: draft, published, completed, canceled

### Set List Item

A set list item links a gig to an arrangement in performance order.

- Gig reference
- Position
- Tune / arrangement reference
- Optional notes, such as cuts, repeats, solo order, or segue instructions
- Visibility: everyone, admin-only, section-specific

### Attendance

Attendance records each member's availability for a gig.

- Gig reference
- Member reference
- Response: no response, confirmed yes, confirmed no
- Instrument / part for this gig
- Optional comment
- Updated time

## iPad / Tablet Target

iPads are a first-class performance device for this project, not just a smaller
desktop screen. Many performers will use tablets in the field, where sunlight,
wind, gloves, stands, and unreliable connectivity matter.

### Tablet Requirements

- Treat tablet use as a viewing and interaction context, not as a separate paper
  size.
- Use the 8.5x11 PDF/image output for iPad display unless a future source calls
  for a different aspect ratio.
- Provide a performance score view for each player and instrument.
- Include a print action with output choices such as 8.5x11 and 7x5 lyre.
- Keep controls large enough for quick stage use.
- Favor set-list order over catalog browsing during a gig.
- Show the current tune, part, page position, and next tune clearly.
- Support offline caching or a downloadable packet before leaving home.
- Avoid dependence on constant network access at the gig site.
- Make page advance gestures simple: tap or swipe, with no tiny controls.
- Preserve printable PDF fallback for players who prefer paper.

### Tablet Open Questions

- Should the first performance implementation be a PDF packet viewer, a PWA with
  cached PDFs, or a purpose-built page-by-page performance UI?
- Do performers need annotation support, or is read-only music enough for the
  first pass?
- Which iPad orientations should be optimized first: portrait, landscape, or both?
- Should tablet packets include audio links, or keep performance mode music-only?

## Source Strategy

### Import Sources

Google Drive is only the current place where the files happen to live. The product
should treat Drive, local filesystem folders, manual uploads, and future bulk import
jobs as equivalent intake sources.

After import, the durable source of truth should be the app catalog plus
app-managed storage. Original Drive paths, folder structure, and file ids can be
kept as provenance for debugging or re-imports, but they should not define the
library identity and should not appear in performer workflows.

Original source filenames should also stay hidden from players. During
synchronization, the importer can parse messy Drive filenames to infer tune,
instrument, part, and source provenance, but accepted assets should receive
canonical app filenames or object keys. Downloaded parts and packets should be
named by normalized app metadata, not by the original Drive filename.

The importer should avoid destructive behavior against any external source:

- Never delete original source files during import.
- Never rename original source files during import.
- Identify duplicates by checksum, normalized title, embedded metadata, import
  batch, and optional source-specific ids such as Drive file ids.
- Copy accepted files into app-managed local storage or private object storage.
- Let an admin resolve ambiguous matches in the web UI later.

### Source Quality Realities

The existing library is useful but not uniform. The catalog and import workflow
should expect these cases from day one:

- A tune may have no MuseScore file, which means lyre PDFs, alternate page sizes,
  and generated practice audio may not be available yet.
- A tune may have no MP3 or exact-score performance recording for at-home
  practice.
- A tune may have one combined PDF that contains many instrument parts, requiring
  page-range extraction or manual review before player-specific downloads work.
- A tune may have cleanly split per-instrument PDFs, which should be easy to
  accept and map directly.
- Different tunes may have different combinations of source score, full score,
  part PDFs, practice audio, and reference performances.

The first importer should prioritize visibility and classification over perfect
normalization. It is acceptable for a tune to be visible with missing-output
badges such as "needs MuseScore source", "needs MP3", or "combined PDF needs
splitting". Admin screens should make these gaps easy to find and fix over time.

### App Catalog And Storage As Source Of Truth

The app should own the catalog metadata and canonical asset locations:

- Tune grouping
- Instrument and part mapping
- Output recipe availability
- Human decisions about duplicates
- Current / archived state
- Canonical storage path or object key for each accepted asset
- Canonical download filename pattern for each generated part, score, audio, or
  packet artifact

This means Drive is just one possible music-file inbox. The app becomes the
library, and runtime links should point to app-managed music or audio assets rather
than original Drive locations or original Drive filenames.

### Out-of-Band Uploads

The web UI can later upload files directly into an import queue. Bulk filesystem
imports should use the same asset model as Drive imports. The app can optionally
record external provenance or mirror accepted uploads elsewhere, but that should be
a separate archival decision rather than the core storage model.

### Storage Layers And Repositories

Not all "data" is the same kind of data, and conflating it leads to bad storage
choices. Separate three layers:

- **Upstream raw source.** Google Drive directories where originals live
  (`.mscz`, original PDFs, original MP3s). Content originates here, but its
  structure does not define the library.
- **Source of truth.** The generator code, output recipes, catalog metadata, and
  the sync manifest. These are small, text, diffable, and inspectable, and they
  belong in a private git repository.
- **Rebuildable cache.** Generated part PDFs, lyre layouts, transcoded MP3s, and
  packets. These are derived artifacts keyed by content, stored on a persistent
  volume or private object storage, and can always be regenerated from the
  upstream source plus the recipes.

Repository topology keeps copyrighted material off the public web:

- **Public code repo** (this repository): code, docs, schemas, synthetic
  fixtures, public-safe assets, and the GitHub Pages prototype.
- **Private data/generator repo:** the importer, the output recipes, catalog
  metadata, and the text manifest. Real binary assets do not live in git history;
  they are the rebuildable cache above.

A git repository can safely sync between a local machine and a server only with a
single writer per branch. Treat authored catalog content and recipes as one-way
(edited locally or by a single server-side job, then pulled), and keep mutable,
concurrent, user-generated data (attendance, gig RSVPs, member profiles, job
state) in Postgres rather than round-tripping it through git.

### Incremental Drive Sync

A refresh runs on a server cron schedule or an admin UI trigger; both invoke the
same idempotent import job. The job is delta-based and cache-retaining rather than
a full re-download and rebuild:

1. **List (delta).** Use the Google Drive Changes API with a persisted
   `startPageToken`, so each run only sees files changed since the last sync.
   Drive provides `id`, `modifiedTime`, `md5Checksum`, and `version`.
2. **Diff.** Compare each Drive file against the manifest and classify it as new,
   changed, unchanged, or deleted. Unchanged files are skipped. Deleted files are
   marked archived; local content is never deleted.
3. **Fetch.** Download only new or changed files into a raw-input cache keyed by
   `driveFileId + md5Checksum`. A file whose checksum is already present is not
   re-fetched.
4. **Build.** Generate outputs (see MuseScore Automation). Skip any output whose
   inputs and recipe are unchanged; rebuild only what is affected.
5. **Publish.** Update the manifest with the new outputs, checksums, and Drive
   provenance.

Because every phase is checksum- and delta-gated, the job is safe to run
repeatedly. Guard against overlapping runs (cron firing while a UI trigger is
already running) with a single-flight lock, such as a Postgres advisory lock.

### Recipes, Filenames, And The Manifest

An **output recipe** defines how one derived artifact is produced from a source
file — the settings, not the file. Examples mirror the Output Recipe list: letter
PDF, 7x5 lyre PDF, MP3 export at a given bitrate. Recipes live as versioned config
in the private repo alongside the generator code.

Stored files use readable canonical slug filenames, never opaque hashes, so the
directory tree and any git diff of the manifest stay human-inspectable. Examples:
`mbbb_bad-guy_trumpet-1_lyre.pdf`, `mbbb_bad-guy_full_mp3.mp3`. This follows the
existing canonical-filename pattern rather than naming files by checksum.

The rebuild decision lives in the manifest, not in the filename. Each manifest row
records the slug filename plus its `inputChecksum`, `recipeVersion`, and
`toolVersion`. The job rebuilds when the freshly computed values differ from the
stored ones, then overwrites the file in place under the same slug name. Bumping a
`recipeVersion` (for example, changing lyre margins) invalidates and rebuilds only
the matching outputs across the library, even though the source files are
unchanged. Browser and CDN freshness is handled with ETag/Last-Modified or a
`?v=<short-hash>` URL suffix, so files keep stable slug names on disk.

The manifest belongs in Postgres, which the sync job writes on every run and which
is queryable for admin review. For git-level inspectability, the job can export a
read-only text snapshot of the manifest into the private repo as a one-way commit,
avoiding any multi-writer git conflict.

### Deployment Notes For Storage

Railway container filesystems are ephemeral and are wiped on each deploy, restart,
or crash. Persistent storage requires a mounted volume:

- Clone or pull the private data/generator repo and hold the raw-input cache and
  generated outputs on a mounted volume so they survive restarts.
- Keep to a single replica while the cache lives on a volume, since a Railway
  volume attaches to one instance and a git working copy with concurrent writers
  can corrupt.
- If the audio library outgrows the volume, back the cache with private object
  storage and treat the volume as a warm cache.

## MuseScore Automation

MuseScore is promising as a build engine. The official MuseScore handbook documents
command-line export via `--export-to`, score/part export options, JSON job files,
and score media/parts output. It can export score data, parts, PDFs, MIDI, and media
formats, which makes it plausible to generate most derived artifacts from clean
`.mscz` masters.

Relevant docs:

- https://musescore.org/en/handbook/4/command-line-usage
- https://handbook.musescore.org/appendix

### Best Case

For tunes with a clean MuseScore master:

- Import `.mscz`.
- Generate individual part PDFs.
- Generate letter and lyre layouts from recipes.
- Export MP3 or MIDI practice tracks.
- Cache outputs with build metadata.
- Rebuild only when the source score or recipe changes.

### Risks

- Headless MuseScore on Railway may require system packages, fonts, audio libraries,
  or a container image rather than a simple Node buildpack.
- MuseScore CLI behavior can vary by version.
- Existing MuseScore files may not have well-defined excerpts/parts.
- A 7x5 lyre layout may require score-specific engraving adjustments, not just page
  scaling.
- MP3 export may be slower and less reliable than PDF generation.

### Practical Position

Treat MuseScore as an optional build engine at first. The catalog should work with
plain PDFs and MP3s. Once the catalog is stable, add a worker that attempts
MuseScore builds and records whether each output is generated, manually supplied,
or failed.

## Railway Architecture

### Services

- Web app: catalog UI, gig/set-list UI, attendance UI, download endpoints, admin
  review screens.
- Worker: import jobs, classification, duplicate detection, output builds.
- Database: Railway Postgres for catalog metadata and job state.
- Private file storage: app-managed local filesystem or object storage for source
  assets and generated artifacts.

### Suggested Stack

- TypeScript web app, likely SvelteKit or a small Node/Express app.
- Postgres with a migration tool.
- Google Drive API only as one optional importer.
- Google OAuth for sign-in.
- DB-backed job queue initially, with a separate Railway worker process.
- Object storage for app-owned music, audio, generated zips, and PDFs when local
  filesystem storage is not enough.
- Dockerfile if MuseScore CLI becomes part of the production build path.

### Deployment Shape

Railway project:

- `web`: serves the UI and download requests.
- `worker`: scheduled or always-on import/build worker.
- `postgres`: metadata.
- environment variables for Google OAuth, optional importer credentials, storage
  credentials, session secret, and admin/member access configuration.

## Access And Privacy

The GitHub repository can be public, but the music library should be private. The
site should use Google OAuth for member and admin login before exposing copyrighted
sheet music, practice audio, gig packets, or attendance lists.

David's requested access model is a password-protected or members-only area on
`mutinybaybrassband.com`. The implementation can still run as an app on Railway,
but the user-facing entry point should be able to live behind a band-site
members-only link, subdomain, or reverse proxy. The product should feel like a
band resource rather than a public GitHub demo.

Recommended initial access model:

- Admin-only import/review screens.
- Member access for downloads, gig music, and attendance responses.
- No public file listing.
- Signed or time-limited download URLs if object storage is used.
- Admins can assign member roles and default instruments after first Google login.
- Access can initially be limited to an allowlist of member email addresses or a
  configured Google Workspace/domain rule if the band has one.
- If allowlisting proves too fussy for launch, support an invite flow or shared
  access code that lets a signed-in Google user request or activate member access
  without creating another password.

## Web UI Concepts

The player-facing app is a single-page interface with three surfaces: a
persistent global header, two tabbed primary views (Collection and Gig Packets),
and a full-screen Score/Performance overlay reached from either view. Every
visible control maps to an obvious result, and global selections apply uniformly
across all views rather than being repeated per row. The description below
reflects the current static prototype under `docs/`; the Admin and future views
that follow it are planned but not yet built.

### Global Chrome

Present on every primary view:

- Brand lockup: band logo, name, and a one-line description of the app.
- Instrument selector: the normalized player-facing instrument list, used as the
  single global instrument choice for all music and packets.
- Print format selector: 8.5x11 letter or 7x5 lyre, applied to every part,
  download, and score.
- Primary navigation tabs: Collection and Gig Packets. The Score view is not a
  tab; it opens as a full-screen overlay and hides the tabs while active.

Part selection is intentionally not global. It appears only in the
selected-music panel, and only when the chosen instrument has more than one part.

### Collection View

A two-pane browse-and-detail layout.

Library pane (left):

- Heading and a live count of titles matching the current search.
- Search-by-title field that filters the list as the user types.
- Scrollable list of music tiles. Each tile shows the tune title plus two
  per-tune actions, Score and Audio. The selected tile is highlighted.

Selected-music pane (right):

- Selected tune title with its active part, print format, and last-modified date.
- A compact embedded practice player directly under the title: play/pause
  toggle, beginning reset, current time, and a draggable scrubber. It does not
  repeat the title or audio label.
- Reference performances, shown only when the tune has them. Each reference has a
  short description and either a Play action (uploaded MP3) or a Watch link that
  opens an external video in a new window.
- Downloads row: PDF (selected instrument/part/format), MuseScore (full-score
  source), and Audio (canonical generated MP3), all using standardized
  app-generated filenames.
- Part selector and an Open Score action at the top of the pane. The part
  selector is hidden when the instrument has a single part; Open Score launches
  the full-screen performance view.

### Gig Packets View

A two-pane gig-picker and gig-detail layout.

Gig picker (left):

- Month calendar with gig dates highlighted and selectable and the active gig
  marked; non-gig days are inert.
- A gig dropdown for direct selection. Calendar and dropdown stay in sync.

Gig detail (right):

- Gig identity and logistics: name, date/time, location and address, arrival
  time, and notes.
- A Download Packet action for the member's packet in the global instrument,
  part, and format.
- Gig music: the set list in performance order, grouped into named sections such
  as Set One and Set Two, with each entry numbered. Entries reuse the Collection
  music tiles (title plus Score and Audio actions), so the global
  instrument/format selectors apply without per-row controls.
- Roster and attendance: a summary of response counts (confirmed yes, no
  response, confirmed no) followed by the full band roster, each member showing
  name, instrument, and response state. The complete roster appears on every gig
  so quiet or pending players still show up. (Attendance is read-only in the
  prototype; per-member confirm/update is planned.)

### Score / Performance View

A full-screen surface for one selected part, opened from a Score or Open Score
action and dismissed back to wherever it was opened.

- App chrome and tabs are hidden while the score is open.
- Toolbar: tune title, the active part and format, a print-format selector, a
  back-to-collection action, and a Print action.
- A practice player (beginning, play, pause, progress, scrubber, and time) that
  shares the same audio transport state as the Collection's embedded player.
- The score page itself, sized to the selected print format (8.5x11 or 7x5 lyre).

### Page Transitions

- Tabs switch between Collection and Gig Packets without leaving the page.
- Selecting a tune tile's title selects and highlights it and updates the
  selected-music pane in place; it does not navigate.
- A tile's Audio action selects the tune, highlights it, and starts the embedded
  player in place, restarting playback when the tune changes. It never leaves the
  current view.
- A tile's Score action, and the selected pane's Open Score action, select the
  tune and open the full-screen Score view. Opening a score pushes a browser
  history entry recording the originating view (Collection or Gig).
- Leaving the Score view returns to the originating view via the back action, the
  Escape key, or the browser Back button; all three resolve to the same return
  target.
- Changing the global instrument, part, or print format re-renders the selected
  tune, gig music, and score consistently, so every surface reflects the same
  current selection.
- Audio is a single shared transport: position and play state are continuous
  across the compact Collection player and the Score view's practice player.

### Admin View

- Provide a simple web backend for band leaders to upload content and manage the
  library without touching GitHub, command lines, or raw storage folders.
- See new import jobs from Drive, filesystem, or upload sources.
- Upload one or more files directly from the browser into the same import queue
  used by Drive and filesystem imports.
- Match files to existing tunes.
- Create a tune/arrangement/part from imported files.
- Resolve duplicates.
- Flag incomplete works, such as missing MuseScore source, missing MP3, or
  combined PDFs that need splitting.
- Mark a file as source, generated, archive, or ignored.
- Trigger build recipes.
- Request instrument-aware transposition for supported source scores.
- Review build failures.
- Create and edit gigs.
- Build ordered set lists from the catalog of practiced works.
- See attendance summary by name, instrument, and response.
- Track roster status counts for no response, confirmed yes, and confirmed no.
- Keep a canonical roster separate from per-gig response status so quiet or
  pending players still appear on each gig page.
- Manage members, roles, and default instruments.

### Future Performance View

A PWA could cache the current packet offline, show PDFs full-screen, and keep
practice audio controls next to the score. This should come after the download
workflow, because offline web performance and page-turn ergonomics are separate
product problems.

### Future Instrument Transposition

A later feature could take a part written for one instrument and generate a part
for another instrument, including key transposition and range-aware adjustment. For
example, a player on E-flat alto horn might want to read a B-flat euphonium part,
or a C concert part might need conversion for a B-flat instrument.

This should be treated as an advanced build feature, not an initial catalog task.
It depends on reliable source material, instrument metadata, and a review workflow
so the generated part can be checked before use.

Requirements to explore:

- Track concert pitch, written pitch, transposition interval, clef, and playable
  range for each supported instrument.
- Convert between C, B-flat, E-flat, and other transposing instruments.
- Preserve musical intent while choosing octaves that fit the target instrument's
  practical range.
- Flag notes that fall outside the target range instead of silently producing a
  bad part.
- Prefer MuseScore/source-score conversion where possible; scanned PDFs may need
  manual re-entry or OCR before transposition is feasible.
- Store generated transposed parts separately from original parts, with clear
  labels and review status.

## Tradeoffs

| Decision | Option A | Option B | Recommendation |
|---|---|---|---|
| Source of truth | External folders | App catalog plus app-managed storage | App catalog/storage; external sources only feed imports |
| Music assets in repo | Store files in GitHub | Keep files private | Keep public repo code/docs only |
| Generated outputs | Pre-generate and cache | Generate on demand | Cache outputs; rebuild on source/recipe changes |
| MuseScore dependency | Required from day one | Optional build worker | Optional until source quality is known |
| UI scope | Downloads first | Full performance viewer | Downloads first, PWA later |
| Upload path | Drive only | Drive, filesystem, and web upload | Common import queue for all sources |
| Gig workflow | Music catalog only | Gigs, set lists, and attendance | Include in backlog now; build after catalog basics |
| Transposition | Manual arranging | Automatic instrument-aware generation | Future feature after source quality and review workflow are proven |
| Auth | Public links | Google account member/admin access | Google OAuth with allowlist/roles, plus invite or access-code fallback if needed |
| Source uniformity | Require complete clean sources | Accept incomplete/mixed sources | Import and show inventory first; flag gaps for cleanup |

## Milestones

### Phase 0: Inventory And Design

- Identify the current import sources, including any Drive folders.
- Export a read-only inventory of files for import planning.
- Define canonical instrument and part names.
- Define initial metadata schema.
- Decide first target output: likely per-instrument zip.
- Decide how the app will appear from `mutinybaybrassband.com`: members-only
  page, subdomain, link to Railway-hosted app, or reverse proxy.

### Phase 1: Catalog MVP

- Google OAuth login with an admin/member role model.
- Member profiles with name, email, instrument, and default part.
- Import files into app-managed storage.
- Detect duplicates.
- Manually classify tunes, arrangements, parts, and audio.
- Track missing or incomplete assets without blocking catalog visibility.
- Browse/search catalog.
- Download app-stored music assets by instrument and part.

### Phase 2: Packet Builder

- Generate per-instrument zip files.
- Include PDFs and MP3 practice tracks.
- Add set-list packet support.
- Cache artifacts with checksums.
- Use a canonical filename recipe for generated downloads, such as app prefix,
  gig or tune identity, instrument/part, and output format.

### Phase 3: Gig Backlog

- Create/edit gigs with date, venue, address, arrival time, performance time, and
  notes.
- Build ordered set lists from cataloged works.
- Let players confirm attendance.
- Show leaders/admins attendance by player name and instrument.
- Generate gig-specific instrument packets in set-list order.
- Let players view gig music from the site as a filtered, ordered collection with
  per-tune score and audio actions.

### Phase 4: MuseScore Builds

- Prototype MuseScore CLI in a worker container.
- Generate PDFs from `.mscz` files.
- Generate or attach MP3/MIDI outputs.
- Evaluate 7x5 lyre formatting quality.

### Phase 5: Practice / Performance UI

- Full score/performance view.
- Print controls for 8.5x11 and 7x5 lyre output.
- Tablet-friendly PDF/image viewer using 8.5x11 content for iPad.
- Audio player with play, pause, beginning, and visible progress.
- Reference-performance list under the player for YouTube videos, alternate
  videos, and non-canonical MP3 recordings attached to a tune.
- Offline/PWA cache.
- Page-turn and set-list flow.

### Phase 6: Transposition Backlog

- Define instrument transposition and playable-range metadata.
- Prototype MuseScore-based part transposition from clean source scores.
- Generate alternate-instrument parts with clear labels and review status.
- Add warnings for out-of-range notes and ambiguous octave choices.
- Keep original parts intact; never overwrite source music.

## Open Questions

- What are the current import sources, including any Google Drive folders?
- Which Google accounts/email domains should be allowed at launch?
- Should first access use a strict allowlist, an invite flow, a shared access
  code after Google login, or some combination?
- How should the app integrate with `mutinybaybrassband.com`: embedded
  members-only area, subdomain, link out to Railway, or proxy?
- Who should have admin rights to create gigs, manage set lists, and view
  attendance?
- Which instruments/parts should be supported first?
- Does the band already have a canonical set list or active/inactive distinction?
- What fields are required for gigs beyond date, address, arrival time, performance
  time, and notes?
- Should attendance responses be visible to all members or only leaders/admins?
- Should set lists support multiple sets, breaks, encores, or repeated tunes?
- How much of the library has MuseScore source versus only PDFs?
- Are the MuseScore files full scores with excerpts/parts, or individual part files?
- Are MP3s generated from scores, recorded by humans, or collected from elsewhere?
- How common are combined all-parts PDFs, and do they have consistent page order
  or bookmarks that can drive splitting?
- What minimum admin upload workflow would David consider comfortable for the
  first real site?
- Which transposition pairs matter most, such as C to B-flat, B-flat euphonium to
  E-flat alto horn, or other common substitutions?
- Who should review and approve generated transposed parts before players use them?
- Should Drive provenance be retained indefinitely, or only until import quality is
  verified?
- Should the first app-managed storage target be Railway volume storage, S3-style
  object storage, or another private file store?
- What is the copyright/licensing position for member-only distribution?

## Near-Term Design Tasks

- Add current import-source ids/paths and an example inventory.
- Draft the database schema.
- Draft the import matching rules.
- Draft gig, set-list, member, and attendance schemas.
- Decide the Google OAuth allowlist and admin bootstrap process.
- Pick the first web framework.
- Decide whether MuseScore gets a separate prototype before app implementation.

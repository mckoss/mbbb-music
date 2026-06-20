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
folder under each source is treated as the song. The sync downloads asset files
(score PDFs, MP3s, MuseScore files) into a **content-addressable store** — and
native Google editor files (Docs, Sheets, Slides, Drawings), which have no binary
form, are exported to PDF and stored the same way so they can be displayed
alongside the scores. Each blob lives at `data/cas/<sha256>`, named purely by the
SHA-256 of
its bytes. There is no song/source directory tree on disk — `data/manifest.json`
holds all the metadata (provenance, source, original filename, detected
song/instrument/key/part) and maps each Drive file to its hash.

This makes **de-duplication intrinsic**: identical bytes hash to the same name,
so the same content in two folders (or two sources) is stored exactly once, with
no priority rules to configure. The store is also a durable **cache** — once a
blob is present it is never re-downloaded, so rebuilding the manifest (or adding
a future source like "generated from MuseScore master") costs no re-fetch. Drive
shortcuts and non-asset files are ignored; the manifest drives incremental,
idempotent refreshes and the end-of-sync report lists any content that appears in
more than one Drive location. `data/` is gitignored — synced music never enters
this repo.

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

### Inspecting the library (`bin/library.js`)

Once a sync has populated `data/`, `bin/library.js` reads the manifest to inspect
and open what's in the store. It has two subcommands:

```bash
node bin/library.js list                        # catalog grouped by song
npm run library -- list --json                  # same, as JSON
node bin/library.js open uptown-funk            # open a whole song
node bin/library.js open uptown-funk-trumpet-bflat   # ...or one part
node bin/library.js --help                      # all options
```

`list` prints every live asset grouped by song (shown as a slug), each as an
indented `instrument-key-part` descriptor with the instrument's default key
folded in (a B♭ trumpet reads `trumpet-bflat`). Each unique content file (CAS
blob) is counted once: identical bytes appearing in several Drive folders or
sources are collapsed, and a copy filed under an index folder (e.g. "50 Indexed
By Instrument") is attributed to the real song that holds the same bytes in a
higher-priority source.

`open <prefix>` opens every PDF and MP3 whose identifier
(`<song>-<instrument>-<key>-<part>`, exactly the slugs `list` shows) **starts
with `<prefix>`** in your OS default app — so the prefix can target a whole song
(`uptown-funk`) or drill down to a single part (`uptown-funk-trumpet-bflat`).
CAS blobs are content-addressed with no extension, so each match is copied to a
throwaway temp location with a readable name and the correct `.pdf`/`.mp3`
extension before launching (on WSL via `Start-Process`, otherwise
`open`/`xdg-open`); the blobs in `data/cas/` are never modified. To avoid
opening a flood of windows, more than 25 matches requires `--yes`.

## Print formatting (score PDFs)

`bin/build-scores.js` (`npm run build-scores -- <file>.mscz`) renders a MuseScore
file into per-instrument part PDFs in two **print formats**, tuned for two very
different reading situations. All the layout decisions live in one place —
`src/scores/formats.js` — so they can be re-tuned and re-rendered. This section
records *why* the numbers are what they are.

### The fundamental unit: staff space (Spatium)

Every notation size scales off one master lever, MuseScore's **Spatium** (called
`staffSpace` in the code): the distance between two adjacent staff lines, in
millimetres. A five-line staff is four spaces tall, so total staff height ≈
`4 × staffSpace`. Note heads, stems, flags, beams, and clefs all scale with it.
Horizontal and vertical *system* spacing is expressed in **staff-spaces (`sp`)**,
so those distances scale off the Spatium automatically. Get the Spatium right and
everything else follows.

| Decision | Letter (music stand) | Lyre (flip-folder card) |
| --- | --- | --- |
| **Staff space (Spatium)** | **1.75 mm** → ~7.0 mm staff | **1.35 mm** → ~5.4 mm staff |
| Reading distance | 24–36" (a music stand) | ~12–18" (clipped to the instrument) |
| Physical sheet | 8.5 × 11 portrait | 8.5 × 11 portrait (carrier) |
| Finished size | full sheet | 7 × 5.5 card, top-left corner |
| Margins | 0.5" all sides | 0.25" all sides, 0.5" top band |
| Priority | readability first | space conservation first |

### Letter — the music-stand part (`staffSpace: 1.75 mm`)

1.75 mm is the long-standing standard for instrumental parts read at arm's length
on a stand (~7.0 mm staff height, MuseScore's "raster 3"). Page count doesn't
matter here, so the layout is deliberately roomy: generous system gaps
(`minSystemDistance: 12 sp`, `maxSystemDistance: 20 sp`), default note spacing (no
horizontal compression), and the page is left to justify comfortably.
Multi-measure rests are consolidated (standard for any single part), and the
score's first-system indent is reclaimed since a part needs no indent. The PDF
keeps MuseScore's own title block, with a render date stamped bottom-right.

### Lyre — the flip-folder card (`staffSpace: 1.35 mm`)

The lyre card clips to the instrument and is read much closer, so it trades
readability for density. **1.35 mm is a deliberate floor**, the bottom of the
recommended 1.35–1.45 mm lyre range (~5.4 mm staff): below ~1.30 mm, ledger lines
and accidentals start to degrade. From that floor, everything else is squeezed to
pack the most music onto a small card while staying legible:

- **Horizontal** (more bars per system): `measureSpacing: 1.3` (down from ~1.5),
  `minNoteDistance: 0.4 sp` (down from ~0.6), `minMeasureWidth: 2.0 sp` to crush
  sparse/rest bars.
- **Vertical** (more systems per page): vertical justification stays on, so system
  gaps follow the *spread* range — `maxSystemSpread` is capped at **5 sp** (down
  from MuseScore's default 32 sp), which is what actually keeps systems tight
  enough to fit more per page. Padding above/below the outer staves is zeroed
  (`staffUpper/LowerBorder: 0`), and oversized text (chord symbols, rehearsal
  marks, staff text) is trimmed so it doesn't inflate system bounding boxes.

These compression numbers are the **floor** profile: the right choice only for a
part long enough to need every bit of the card. A short part rendered at the floor
just floats in tiny 1.35 mm notes with the bottom half of the card empty — so the
floor is a *minimum*, not the size we always use (see fit-to-card below).

### Fit-to-card: growing the notes to fill the page

For a part with slack, 1.35 mm wastes the card. So the lyre build does a
**fit-to-card search**: it renders the part at a ladder of staff spaces and keeps
the **largest one that doesn't add a page** over the floor. Short parts come out
big and readable; long parts stay at the floor where they belong — automatically,
per part.

This works because **page count is monotonic in staff space**: bigger notes ⇒ more
vertical space per system ⇒ fewer systems per page ⇒ more pages. So "the largest
size that holds the page count" is well-defined, and you find it by measuring (you
can't predict bars-per-system from the notes, and MuseScore has no auto-grow mode —
so we render, count pages with `pdf-lib`, and pick).

The ladder is a rounded, nearly geometric progression — equal *ratio* steps
(≈ 8.9% each), because perceived size scales multiplicatively, so the rungs look
evenly spaced rather than bunched at the small end:

| Rung | Staff space | ≈ staff height | Note |
| --- | --- | --- | --- |
| 0 (floor) | **1.35 mm** | 5.4 mm | legibility floor; long parts land here |
| 1 | **1.5 mm** | 6.0 mm | |
| 2 | **1.6 mm** | 6.4 mm | |
| 3 | **1.75 mm** | 7.0 mm | ≈ the letter / music-stand size |
| 4 (ceiling) | **1.9 mm** | 7.6 mm | cap, so a tiny part doesn't get comical |

**Pack and fill are different goals**, so the spacing eases *with* the size: as the
rung climbs from floor to ceiling, the compression knobs are interpolated back
toward roomy values — `maxSystemSpread` 5 → 20 sp (systems spread down to fill the
card instead of clustering at the top), `measureSpacing` 1.3 → 1.5, and
`minNoteDistance` 0.4 → 0.6 sp. So bigger notes also breathe horizontally and
vertically rather than staying crushed.

Cost is bounded: each rung is one *batched* MuseScore run over all parts (reusing
the batch-reliability trick), so the whole search is `ladder.length` runs total,
independent of part count. The build prints the chosen staff space and the page
floor it achieved for each part, e.g.
`✓ tune-trumpet-bflat-lyre.pdf — spatium 1.60 mm, floor 1 pg`.

### The lyre card: page geometry and the two cuts

The card is a **7" wide × 5.5" tall** finished piece (5.5" matches the band's
flip-folder window), but it's *printed on a plain portrait 8.5 × 11 Letter sheet*
so players can use ordinary stock. The card is pinned to the sheet's **top-left
corner**, which means its top and left edges are the paper's own edges — no cut
needed there. Two cuts finish it:

1. **Right edge at 7"** — lops off the 1.5" right margin (a single guillotine pass).
2. **Bottom edge at 5.5"** — and because 5.5" is *exactly half* of the 11" sheet,
   this is the same half-sheet cut you'd make anyway, so it costs no extra pass.

(Earlier revisions printed on *landscape* Letter; portrait is what makes the
bottom cut coincide with the half-sheet line, saving a pass.) Pinning to the
top-left also matters because consumer printers swallow up to ~1/4" of
non-printable border at the paper edges — the 0.25" card margin clears it so the
first system and the header aren't clipped. Faint dashed cut guides mark the two
trimmed edges.

### Header and page-number overlay

Both formats overlay small corner text *on top of* the rendered music (via
`pdf-lib`, in `src/scores/stamp.js`), reserving no layout space. The lyre format
**strips MuseScore's title frame** (reclaiming roughly a system of height) and
replaces it with a compact 8 pt bold **"Title – Instrument"** header in the
top-left band, with the render date top-right (the bottom is left entirely to
music). Letter keeps its full title block and stamps the date bottom-right.

Page numbers appear **only on multi-page parts**, and only once: on lyre they ride
in the header as `Title – Instrument – p 2`; on letter they're appended to the
bottom-right date as `– Page 2`. A single-sheet part shows no page number at all.

## Web interface (SvelteKit)

A SvelteKit app (TypeScript, Svelte 5, `adapter-node` for Railway) serves the
player-facing library. It reads the same `data/manifest.json` and
content-addressable store the sync produces — no separate database yet.

```bash
npm run dev        # dev server (Vite) at http://localhost:5173
npm run build      # production build (adapter-node)
npm run preview    # preview the production build
npm run check      # svelte-check (type-check)
```

The current slice is the **player core** (catalog browse + scores + audio):

- **Collection** — two-pane browse/detail. Search titles; pick a tune; the
  detail pane shows the part for the globally selected instrument (with a part
  selector when an instrument has more than one), a shared audio player, PDF /
  MuseScore / MP3 downloads with app-generated filenames, and a format-sized PDF
  preview.
- **Score / Performance overlay** — full-screen real PDF sized to letter or 7×5.5
  lyre, with the same audio transport; closes on Escape or browser Back.
- A **single shared audio transport** stays continuous between the Collection
  player and the Score overlay.
- **Sign-in** — Google OAuth with role-based access (see
  [Authentication](#authentication-google-sign-in) below).
- **Gig Packets** is a placeholder; gigs and the admin/import UI are deferred
  (see the milestones in [docs/design.md](docs/design.md)).

Architecture: the manifest→catalog model is shared with the CLI in
`src/sync/catalog.js` (`buildCatalog`); `src/lib/server/library.ts` loads and
caches it. `GET /api/catalog` returns the tune catalog; `GET /blob/<sha256>`
streams a CAS blob with the right `Content-Type`, `Range` support (audio
scrubbing), and immutable caching, serving only manifest-known hashes. `data/`
stays gitignored; the app needs a populated `data/` (run a sync) to show real
music.

### Authentication (Google sign-in)

The site can require Google sign-in with role-based access. Members sign in with
their Google account, are matched against an allowlist, and get a 30-day signed
session cookie; the role is resolved live per request.

- **Roles:** `admin` (view everything + manage users), `member` and `organizer`
  (view the library). A signed-in account that isn't on the allowlist lands on a
  `/pending` page until an admin grants it a role.
- **Gate:** unauthenticated → `/login`; signed-in but no role → `/pending`;
  members → library + Library Status; `/admin/users` → admins only. `/blob` and
  `/api/*` are gated too. Admins manage members from the **Users** tab.
- **Allowlist storage:** roles live in a writable `data/users.json` (gitignored,
  like the rest of `data/`), bootstrapped from `auth.admins` (those emails are
  always admin and can't be removed in the UI).
- **Open mode:** if the `auth` block is omitted (or `clientId`/`clientSecret`/
  `cookieSecret` are blank) the site runs **open** — full access, no sign-in —
  with a startup warning. So local dev/preview works before you set credentials.

Two different Google credentials are involved, and they are **not** the same:
`google.serviceAccount` is for the Drive **sync** only; the `auth` block is the
web **sign-in** OAuth client.

#### Where to get the credentials

Add an `auth` block to `config.json` as a top-level sibling of `google`:

```jsonc
{
  "dataDir": "data",
  "sources": [ /* ...unchanged... */ ],
  "google": { "serviceAccount": { /* ...unchanged... */ } },

  "auth": {
    "clientId": "1234567890-abcdef.apps.googleusercontent.com",
    "clientSecret": "GOCSPX-xxxxxxxxxxxxxxxx",
    "cookieSecret": "PASTE_A_LONG_RANDOM_STRING_HERE",
    "admins": ["you@gmail.com"]
  }
}
```

Where each value comes from:

| Field | How to get it |
| --- | --- |
| `clientId` / `clientSecret` | Google Cloud Console → **APIs & Services → Credentials → Create credentials → OAuth client ID → Web application**. Copy the two values it shows. |
| `cookieSecret` | Any long random string (signs the session cookie). Generate with `openssl rand -base64 48`. Keep it stable — changing it logs everyone out. |
| `admins` | Your email(s). These are always admin and can't be removed in the UI; grant everyone else from the **Users** tab. |

**Leave `redirectUri` out** — it's optional and only overrides the auto value
(`<origin>/auth/callback`), e.g. behind a proxy that rewrites the host.

#### Redirect URI (required in the Google Console)

This app uses the **server-side authorization-code flow** (browser → Google →
back to `/auth/callback`, which the server exchanges). Google validates the
redirect URI against the client's allowlist, so under the OAuth **Web
application** client's *Authorized redirect URIs* you must add one per origin:

```
http://localhost:5173/auth/callback     # vite dev
http://localhost:4173/auth/callback     # npm run preview (if used)
https://your-prod-host/auth/callback    # production
```

(A client-side Google Identity Services / Firebase setup configures *JavaScript
origins* instead and skips this — but this app intentionally uses the
server-session model, so the redirect URI is required.)

One-time, also configure the **OAuth consent screen** (External; scopes
`openid`, `email`, `profile` — all non-sensitive, no Google verification
needed). While it's in **Testing**, add each member as a *Test user*, or
**Publish app** to allow any Google account (still gated by your allowlist —
unlisted users land on `/pending`).

For Railway, the same `auth` block goes inside the `MBBB_CONFIG_JSON` value, and
`data/` (which holds `users.json`) needs persistent storage to retain granted
roles across deploys.

## Open Questions

- Which Google Drive folders or local paths are current import sources?
- Which instruments and named parts should be first-class in the catalog?
- Which output format matters first: letter PDFs, 7×5.5 lyre PDFs, per-instrument
  zip files, or a web/PWA performance view?
- How complete and clean are the MuseScore source files compared with the PDF and
  MP3 collection?

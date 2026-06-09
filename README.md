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
- **Score / Performance overlay** — full-screen real PDF sized to letter or 7×5
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
- Which output format matters first: letter PDFs, 7x5 lyre PDFs, per-instrument
  zip files, or a web/PWA performance view?
- How complete and clean are the MuseScore source files compared with the PDF and
  MP3 collection?

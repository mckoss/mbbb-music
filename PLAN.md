# PLAN.md - Music Production Pipeline

Working plan for moving the band's music from "whatever is in Drive" to
app-owned, version-controlled masters that render every player-facing output.
This file carries decisions and next steps across agent sessions; update it when
a decision changes or a step lands. The broader product design stays in
`docs/design.md` (see its MuseScore Automation and Milestones sections, which
this plan extends).

**Public-safety:** this repository is public (AGENTS.md Hard Rule 1). Keep this
file to decisions, architecture and aggregate counts. Song titles, Drive folder
or file IDs, member names and any music content belong in the private scores
repository (below) or in the gitignored `data/` volume, never here.

## Decisions (as of 2026-11)

1. **LilyPond is the long-term master format.** Each song is eventually mastered
   as LilyPond source (`.ly`). During the transition the app supports both
   MuseScore (`.mscz`) and LilyPond masters, chosen per song.
2. **MuseScore becomes a converter, not the renderer.** Its CLI exports
   `.mscz` -> MusicXML; `musicxml2ly` (shipped with LilyPond) plus a versioned
   set of deterministic *fixup rules* produces `.ly`. Current MuseScore cannot
   export LilyPond directly. MuseScore stays in the pipeline for conversion and,
   for now, MP3 practice audio.
3. **LilyPond renders everything player-facing.** Per-part letter and 7x5 lyre
   layouts are LilyPond templates (paper size, staff size, margins, header),
   replacing the MuseScore style/fit-rung ladder in `src/scores/formats.js` and
   the post-hoc header stamping. LilyPond also emits PNG/SVG pages and MIDI.
4. **A private GitHub repository holds the ground truth** (working name
   `mbbb-scores`): masters and the inputs needed to rebuild them, but no
   renderings (PDF, PNG, SVG, MIDI, MP3). Renderings are build outputs, built by
   the app into `data/cas/`.
5. **Git is the lineage layer for the text masters.** A commit is a version. The
   app records the source commit SHA on every output it builds. Commits carry
   provenance trailers (source master hash, converter/fixup revisions, and for
   AI-assisted work the prompt id/hash, model and cost). Pull requests are the
   human review gate: CI renders and checks; merging publishes.
6. **AI is used only to extract music from PDFs** where no MuseScore master
   exists (optical music recognition). Everything else (conversion,
   transposition, rendering, verification) is deterministic. Not planned: AI
   visual QA of renders, AI classification, AI arranging, a general prompt
   library.
7. **Drive stays the import source, and becomes an export target too.** Some
   members use Drive instead of the website, so newly generated parts are also
   published to a Drive folder they can reach, with standardized app-generated
   filenames (Hard Rule 3). This needs write access for the app's service
   account on that one export folder (today it is `drive.readonly`).
8. **Most pressing deliverables:** E-flat alto horn parts, usually transcribed
   from trombone and occasionally from saxophone; and trumpet parts covering
   alto sax melody lines now that the band has fewer sax players.

## Pipeline Shape

```text
.mscz master --(MuseScore CLI)--> MusicXML --(musicxml2ly + fixups rN)--> song.ly
PDF-only part --(OMR: Audiveris + Opus 5.5 correction)--> MusicXML/.ly (draft PR)
song.ly --(part templates + transposition)--> letter PDF, lyre PDF, PNG/SVG, MIDI
outputs --> data/cas (website) and the Drive export folder (Drive-only members)
```

### Private scores repository (proposed layout)

```text
songs/<song-slug>/
  meta.yaml      # title, arranger, mode: mscz|ly, source master (Drive id + sha256)
  music.ly       # notes, one variable per part, written at concert pitch
  parts.ly       # parts, instruments, transpositions, \tag selections
fixups/          # versioned post-musicxml2ly rules, re-applied every conversion
templates/       # may instead live in this public repo (layout, no music)
```

- **`mode: mscz`**: the `.mscz` in Drive is the master; `.ly` is regenerated
  from it by the pipeline bot and never hand-edited (fixes go into `fixups/`).
- **`mode: ly`**: the song has migrated, or never had a MuseScore master
  (PDF-only songs extracted by OMR). Hand and AI edits land via PRs.
- **Access:** the app clones the repo into `data/scores/` and pulls on a push
  webhook (and in the daily job). It writes through a GitHub App or a
  fine-grained token scoped to that repository only, held in Railway config.
  Keep collaborators to the core music team: arrangements are copyrighted.

## Verification

- **Conversion fidelity (no AI):** MuseScore and LilyPond both export MIDI.
  Compare note events (pitch, onset, duration) per part between the MuseScore
  MIDI and the LilyPond MIDI. This catches transposition errors, dropped
  measures and broken repeats. Only passing parts publish automatically.
- **OMR accuracy:** score OMR output against songs that have both a PDF and a
  `.mscz` master, using the same MIDI comparison, before trusting it on PDF-only
  songs. Also LilyPond bar checks, consistent key/time signatures, instrument
  range checks, and equal measure counts across a song's parts.
- **Human gate:** outputs land as drafts or PRs with side-by-side page images;
  an admin publishes.

## PDF -> Notation (the one AI step)

1. First pass with a dedicated OMR engine (Audiveris, open source, MusicXML out).
2. Convert to `.ly`.
3. Claude Opus 5.5 (`claude-opus-5-5`, via `@anthropic-ai/sdk`) correction
   loop, one system (line of music) at a time: original page crop + render of
   the current guess + that system's source -> targeted edits; at most 2-3
   rounds; uncertain measures get `% CHECK:` comments.
4. The automatic checks above, then a PR for human review (`mode: ly`).

Notes: set `output_config.effort` explicitly (Opus 5.5 defaults to `medium`),
use structured outputs for the edit list, enable the refusal fallback, cache the
stable system prompt, and use the Batch API (half price) for bulk backfills.
Record tokens and cost per run. Pricing: $4 / $20 per million input/output
tokens. If handwritten parts defeat stage 1, measure Opus 5.5 as the primary
transcriber instead. Keep whichever wins on the accuracy scores.

## Transposition Reference

Write music at concert pitch and let LilyPond produce each written part. A
transposed part is deterministic; the judgment call is **range**, so the tool
range-fits by octave per phrase and flags the measures it moved.

| Source part (written) | Target part (written) | Interval | Notes |
|---|---|---|---|
| Trombone, bass clef, concert pitch | E-flat alto horn | concert up a major 6th (`\transpose es c'`) | Low trombone notes land below the horn's range: octave up per phrase |
| E-flat alto sax | E-flat alto horn | same written pitch | Range check only: sax parts run higher than the horn |
| E-flat alto sax | B-flat trumpet | written down a perfect 4th | Range check for trumpet |
| B-flat tenor sax | B-flat trumpet | written down an octave | Same key; range check |
| Concert pitch (score) | B-flat trumpet | concert up a major 2nd (`\transpose bes c'`) | |

The band's trombone parts are bass clef at concert pitch (confirmed 2026-11), so
trombone sources need no transposition step beyond the target instrument's.
Practical ranges for our players are still to be confirmed with the horn and
trumpet sections, since the range-fit step depends on them.

## Inventory (aggregate only)

Drive library crawl, 2026-11 (read-only, filenames and metadata only). Counts
only; the per-song list belongs in the private scores repository.

| | Songs |
|---|---|
| Song folders in the library | 52 |
| MuseScore master + PDF parts | 21 |
| PDF-only (no MuseScore master found) | 31 |
| Trombone part but no alto horn part, `.mscz` master available | 17 |
| Trombone part but no alto horn part, PDF-only | 19 |
| Alto sax part but no trumpet part | 1 (PDF-only) |

Observations that matter for the pipeline:

- Members usually keep a song's `.mscz` and its PDF renders in the same song
  folder. The app's song folders are mostly shortcuts into a second shared
  tree, which also holds the only copies of a few songs.
- The PDF-only parts look engraved (notation-software export names, extractable
  text), not scanned, which favors OMR. A handful of songs exist only as one
  combined all-parts PDF and may be scans.
- A few PDF-only songs may have recoverable masters (recent MuseScore-style
  exports, a zip that may contain a source), so check before running OMR.
- Duplicates are common ("Copy of" files, versioned exports, wrapper folders),
  and some instrument-index folders hold files found nowhere else.
- **Privacy:** an instrument-index folder in the library also contains copies of
  member-information and contact documents. Importers and any future Drive
  crawler must stay restricted to music file types and never ingest those.

## Phases

1. **Experiments** (local, nothing committed):
   - a. `.mscz` -> MusicXML -> `.ly` -> letter/lyre on 4-5 representative songs
     (a drum part, D.S./coda, divisi, transposed horn and sax parts), scored by
     the MIDI comparison.
   - b. OMR on PDFs of songs that also have a `.mscz`, scored the same way,
     before and after the Opus 5.5 correction pass, with cost per page.
   - Decision gate: adopt LilyPond rendering only if most parts pass with a
     small set of fixup rules.
2. **Transcription quick win:** alto horn from trombone for the 17 songs with
   a `.mscz` master, using the deterministic transposition table and
   range-fitting, delivered as letter and lyre PDFs (and to the Drive export
   folder). The one alto-sax-to-trumpet need is PDF-only, so it waits for OMR.
3. **Private scores repository** (owner approval needed to create it and its
   bot credentials): layout above, templates, `fixups/`, CI that compiles every
   changed song and runs the MIDI check.
4. **App integration:** pipeline steps (convert -> commit with trailers -> build
   letter/lyre), lineage recorded by commit SHA, draft/publish, published
   generated parts mask the manual PDFs they replace (by lineage rather than by
   Drive source label), and an admin view of open score PRs with previews.
5. **Drive export:** write access on one export folder; mirror published
   outputs with standardized names.
6. **OMR backfill** of PDF-only songs, prioritizing those that need alto horn
   or trumpet parts (19 trombone-sourced, per the inventory).

## Open Questions

- Where MuseScore runs for conversion: a Railway container, or the owner's Mac
  as a job-pulling worker.
- Whether original source PDFs for PDF-only songs are stored in the private
  repo (Git LFS) or stay in Drive, referenced by hash.
- Practical written ranges for alto horn and trumpet players.
- Location and sharing of the Drive export folder; whether it replaces or sits
  beside the current library folders.
- Monthly cap for API spending on the OMR step.

## Design Notes Borrowed From manga-maker

- An inputs snapshot on every version (upstream version ids or content hashes)
  gives exact staleness ("out of date because the master changed") without
  guessing from modified times.
- Separate "out of date" (direct) from "waiting on an earlier step"
  (transitive), and regenerate only on request.
- Picking the winner among drafts is itself a recorded, versioned step.
- Avoid its weaknesses: declare pipeline steps once instead of per domain, and
  always record which prompt revision and full request produced an AI output.

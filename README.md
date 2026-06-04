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

## Open Questions

- Which Google Drive folders or local paths are current import sources?
- Which instruments and named parts should be first-class in the catalog?
- Which output format matters first: letter PDFs, 7x5 lyre PDFs, per-instrument
  zip files, or a web/PWA performance view?
- How complete and clean are the MuseScore source files compared with the PDF and
  MP3 collection?
- What access model should the live site use for band members?

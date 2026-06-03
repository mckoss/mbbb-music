# MBBB Music

Design repository for a Mutiny Bay Brass Band music library and distribution site.

The goal is to turn the band's Drive-based sheet-music collection into a searchable,
instrument-aware catalog that can produce useful packets for practice and
performance: PDFs, audio, set lists, and per-player downloads.

This repository is public and should contain only code, documentation, schemas, and
sample fixtures that are safe to publish. The actual band music library, generated
PDFs, MP3s, and any copyrighted source material should live in private storage.

## Current Status

- Design and static prototyping only.
- No deployable application code yet.
- Main design document: [docs/design.md](docs/design.md)
- Static user-interface prototype: [docs/index.html](docs/index.html)

## Initial Questions

- Which Google Drive folders are the current source folders?
- Which instruments and named parts should be first-class in the catalog?
- Which output format matters first: letter PDFs, 7x5 lyre PDFs, per-instrument
  zip files, or a web/PWA performance view?
- How complete and clean are the MuseScore source files compared with the PDF and
  MP3 collection?
- What access model should the live site use for band members?

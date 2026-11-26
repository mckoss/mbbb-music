// Turn recorded LilyPond builds into manifest-shaped entries so the shared
// catalog model (src/sync/catalog.js) places, masks and serves them exactly like
// synced files. Pure — the server store reads/writes the state file.
//
// State shape (data/lilypond/state.json):
//   { songs: { [songSlug]: {
//       title, builtAt, builtBy, masterSha256, origin?: 'mscz' | 'omr',
//       outputs: [{ sha256, name, kind, format?, part?, size? }],
//       report: { parts, checks, passed, warnings, versions } } } }

/** Source label for app-built LilyPond output (a generated, superseding source). */
export const LILYPOND_SOURCE = 'lilypond';

/**
 * Source label for draft builds read from a PDF-only song's parts by OMR. An
 * ordinary (not generated) source: its score and band audio sit beside the
 * band's own PDFs and mask nothing until OMR output is trusted.
 */
export const LILYPOND_OMR_SOURCE = 'lilypond-omr';

const MIME = { pdf: 'application/pdf', mp3: 'audio/mpeg', ly: 'text/x-lilypond' };

/** Asset type and MIME type for an output filename. */
export function outputType(name) {
  const ext = String(name).split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf') return { assetType: 'pdf', mimeType: MIME.pdf };
  if (ext === 'mp3') return { assetType: 'mp3', mimeType: MIME.mp3 };
  return { assetType: 'file', mimeType: MIME[ext] ?? 'application/octet-stream' };
}

/**
 * Manifest entries for every stored output, keyed `lilypond:<slug>:<name>`.
 * `songAssigned` pins each to its song regardless of filename matching.
 *
 * @param {{ songs?: Record<string, any> }} state
 * @returns {Record<string, object>}
 */
export function lilypondEntries(state) {
  const files = {};
  for (const [slug, song] of Object.entries(state?.songs ?? {})) {
    for (const o of song.outputs ?? []) {
      if (!o?.sha256 || !o?.name) continue;
      const label = song.origin === 'omr' ? LILYPOND_OMR_SOURCE : LILYPOND_SOURCE;
      const id = `${label}:${slug}:${o.name}`;
      files[id] = {
        driveFileId: id,
        sha256: o.sha256,
        originalName: o.name,
        ...outputType(o.name),
        size: o.size ?? null,
        status: 'synced',
        sourceFolderLabel: label,
        originalFolder: `${song.title || slug} (LilyPond)`,
        songTitle: song.title || slug,
        songTitleSlug: slug,
        songAssigned: true,
        modifiedTime: song.builtAt ?? null,
      };
    }
  }
  return files;
}

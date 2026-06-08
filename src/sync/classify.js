// Classify a raw Google Drive file into an accepted asset type, or mark it
// ignored. Phase 1 downloads real asset bytes: score PDFs, MP3 audio, and
// MuseScore files. Native Google editor files (Docs/Sheets/Slides/Drawings)
// have no binary form, but Drive can export them to PDF — so they are accepted
// as `pdf` assets and fetched via export rather than ignored. Images (JPEG) are
// accepted as `image` (embeddable in the web view); uploaded Office documents
// (.docx) as `doc` and zip archives as `archive` — both download-only, since
// Drive can only export *native* Google files, not uploaded binaries. Folders
// and other unsupported types are ignored (recorded, never fetched). The Drive
// client resolves shortcuts to their targets before classification, so a
// shortcut reaching here is one whose target was unreadable — also ignored.

/** Drive mime type for shortcut entries (pointers, not real bytes). */
const SHORTCUT_MIME = 'application/vnd.google-apps.shortcut';
/** Drive mime type for folders. */
const FOLDER_MIME = 'application/vnd.google-apps.folder';

/** Exact filenames that are throwaway OS/system cruft, not real assets. */
const JUNK_NAMES = new Set(['delete', 'thumbs.db', 'desktop.ini']);

/**
 * True for OS/system junk that should never be treated as an asset: macOS
 * AppleDouble sidecars ("._name"), .DS_Store and other dotfiles, and known
 * throwaway names. Such files are recorded as ignored, never fetched, and are
 * excluded from the catalog.
 *
 * @param {string|null|undefined} name
 */
export function isJunkName(name) {
  const n = String(name ?? '').trim();
  if (!n) return false;
  if (n.startsWith('.')) return true; // .DS_Store, ._resource-forks, dotfiles
  return JUNK_NAMES.has(n.toLowerCase());
}

// Native Google editor types that have no binary form but export cleanly to PDF.
// A PDF export drops straight into the existing content-addressable PDF path:
// the exported bytes are downloaded, hashed, and stored/served like any other
// PDF asset. Other google-apps types (forms, sites, scripts, …) have no useful
// PDF export and remain ignored.
const NATIVE_PDF_EXPORT = new Set([
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.spreadsheet',
  'application/vnd.google-apps.presentation',
  'application/vnd.google-apps.drawing',
]);

/**
 * Accepted asset types keyed by canonical name. Each entry knows the file
 * extension used for the canonical local filename plus how to recognize the
 * type from mime type and/or filename extension.
 *
 * @typedef {{ type: string, ext: string, mimes: string[], exts: string[] }} AssetKind
 * @type {AssetKind[]}
 */
const ASSET_KINDS = [
  { type: 'pdf', ext: 'pdf', mimes: ['application/pdf'], exts: ['pdf'] },
  {
    type: 'mp3',
    ext: 'mp3',
    mimes: ['audio/mpeg', 'audio/mp3'],
    exts: ['mp3'],
  },
  {
    type: 'musescore',
    ext: 'mscz',
    // MuseScore files rarely carry a registered mime type from Drive; detect by
    // extension. .mscz is compressed, .mscx is the uncompressed XML form.
    mimes: ['application/x-musescore', 'application/vnd.musescore'],
    exts: ['mscz', 'mscx'],
  },
  // Images embed directly in the web view (cover art, photos of charts, …).
  { type: 'image', ext: 'jpg', mimes: ['image/jpeg'], exts: ['jpg', 'jpeg'] },
  // Uploaded Word documents — NOT native Google Docs (those export to PDF in
  // NATIVE_PDF_EXPORT above). Drive cannot export an uploaded .docx, so it is
  // served for download rather than rendered.
  {
    type: 'doc',
    ext: 'docx',
    mimes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    exts: ['docx'],
  },
  // Zip archives — download-only.
  { type: 'archive', ext: 'zip', mimes: ['application/zip', 'application/x-zip-compressed'], exts: ['zip'] },
];

function extensionOf(name) {
  const m = String(name ?? '').match(/\.([^.\/\\]+)$/);
  return m ? m[1].toLowerCase() : '';
}

/**
 * How the sync should fetch an accepted asset's bytes.
 *   { mode: 'media' }                            — download binary content (alt=media)
 *   { mode: 'export', mimeType: 'application/pdf' } — render a native file via files.export
 *
 * @typedef {{ mode: 'media' } | { mode: 'export', mimeType: string }} DownloadSpec
 */

/**
 * @typedef {Object} Classification
 * @property {string|null} assetType  One of 'pdf' | 'mp3' | 'musescore', or null when ignored.
 * @property {string|null} ext        Canonical extension for the asset, or null.
 * @property {boolean} ignored        True when the file should not be downloaded.
 * @property {string|null} ignoreReason  Human-readable reason when ignored.
 * @property {DownloadSpec|null} download  How to fetch the bytes, or null when ignored.
 */

/**
 * Classify a Drive file object.
 *
 * @param {{ id?: string, name?: string, mimeType?: string, shortcutDetails?: object }} file
 * @returns {Classification}
 */
export function classifyDriveFile(file) {
  const mimeType = file?.mimeType ?? '';
  const name = file?.name ?? '';

  if (mimeType === FOLDER_MIME) {
    return ignore('folder');
  }
  // Shortcuts are pointers; identify by mime type or the presence of
  // shortcutDetails regardless of the (sometimes spoofed) target mime.
  if (mimeType === SHORTCUT_MIME || file?.shortcutDetails) {
    return ignore('google-drive-shortcut');
  }
  // OS/system junk (._sidecars, .DS_Store, "delete", …) — never an asset.
  if (isJunkName(name)) {
    return ignore('junk');
  }
  // Native Google editor files (Docs/Sheets/Slides/Drawings) have no binary
  // asset, but export to PDF — accept them as PDFs fetched via export. Other
  // google-apps types have no useful export and stay ignored.
  if (mimeType.startsWith('application/vnd.google-apps')) {
    if (NATIVE_PDF_EXPORT.has(mimeType)) {
      return {
        assetType: 'pdf',
        ext: 'pdf',
        ignored: false,
        ignoreReason: null,
        download: { mode: 'export', mimeType: 'application/pdf' },
      };
    }
    return ignore('google-native-file');
  }

  const ext = extensionOf(name);
  for (const kind of ASSET_KINDS) {
    const mimeMatch = kind.mimes.includes(mimeType);
    const extMatch = kind.exts.includes(ext);
    if (mimeMatch || extMatch) {
      return { assetType: kind.type, ext: kind.ext, ignored: false, ignoreReason: null, download: { mode: 'media' } };
    }
  }

  return ignore(ext ? `unsupported-type:${ext}` : 'unknown-type');
}

function ignore(reason) {
  return { assetType: null, ext: null, ignored: true, ignoreReason: reason, download: null };
}

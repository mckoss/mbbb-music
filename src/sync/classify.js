// Classify a raw Google Drive file into an accepted asset type, or mark it
// ignored. Phase 1 downloads only real asset bytes: score PDFs, MP3 audio, and
// MuseScore files. Google Drive shortcut files, folders, native Google Docs,
// and unrelated file types are ignored (recorded, never fetched).

/** Drive mime type for shortcut entries (pointers, not real bytes). */
const SHORTCUT_MIME = 'application/vnd.google-apps.shortcut';
/** Drive mime type for folders. */
const FOLDER_MIME = 'application/vnd.google-apps.folder';

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
];

function extensionOf(name) {
  const m = String(name ?? '').match(/\.([^.\/\\]+)$/);
  return m ? m[1].toLowerCase() : '';
}

/**
 * @typedef {Object} Classification
 * @property {string|null} assetType  One of 'pdf' | 'mp3' | 'musescore', or null when ignored.
 * @property {string|null} ext        Canonical extension for the asset, or null.
 * @property {boolean} ignored        True when the file should not be downloaded.
 * @property {string|null} ignoreReason  Human-readable reason when ignored.
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
  // Native Google editor files (Docs/Sheets/Slides/etc.) have no real binary
  // asset to download.
  if (mimeType.startsWith('application/vnd.google-apps')) {
    return ignore('google-native-file');
  }

  const ext = extensionOf(name);
  for (const kind of ASSET_KINDS) {
    const mimeMatch = kind.mimes.includes(mimeType);
    const extMatch = kind.exts.includes(ext);
    if (mimeMatch || extMatch) {
      return { assetType: kind.type, ext: kind.ext, ignored: false, ignoreReason: null };
    }
  }

  return ignore(ext ? `unsupported-type:${ext}` : 'unknown-type');
}

function ignore(reason) {
  return { assetType: null, ext: null, ignored: true, ignoreReason: reason };
}

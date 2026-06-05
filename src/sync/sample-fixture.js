// Synthetic, public-safe Drive fixture for offline demos and tests. No real
// band music, no copyrighted bytes — every "asset" is a tiny text placeholder.
// File names mimic the messy real-world patterns the importer must parse.

export const FIXTURE_FOLDERS = [
  { id: 'folder-bad-guy', label: 'Bad Guy' },
  { id: 'folder-track-suit', label: 'Track Suit' },
];

/**
 * DriveFile-shaped fixture records. `content` is auto-hashed into md5/size by
 * the fixture Drive client.
 */
export const FIXTURE_FILES = [
  // --- Bad Guy folder ---
  {
    id: 'bg-tpt-1',
    name: 'Bad Guy - Trumpet in B-flat.pdf',
    mimeType: 'application/pdf',
    modifiedTime: '2026-01-02T10:00:00.000Z',
    version: '3',
    folderId: 'folder-bad-guy',
    folderName: 'Bad Guy',
    content: 'SYNTHETIC-PDF: bad guy trumpet part 1',
  },
  {
    id: 'bg-tpt-2',
    name: 'Bad Guy - Trumpet in B-flat 2.pdf',
    mimeType: 'application/pdf',
    modifiedTime: '2026-01-02T10:00:00.000Z',
    version: '3',
    folderId: 'folder-bad-guy',
    folderName: 'Bad Guy',
    content: 'SYNTHETIC-PDF: bad guy trumpet part 2',
  },
  {
    id: 'bg-alto',
    name: 'Bad Guy - Alto Saxophone.pdf',
    mimeType: 'application/pdf',
    modifiedTime: '2026-01-02T10:00:00.000Z',
    version: '1',
    folderId: 'folder-bad-guy',
    folderName: 'Bad Guy',
    content: 'SYNTHETIC-PDF: bad guy alto sax part',
  },
  {
    id: 'bg-mp3',
    name: 'Bad Guy Practice Track.mp3',
    mimeType: 'audio/mpeg',
    modifiedTime: '2026-01-02T10:00:00.000Z',
    version: '2',
    folderId: 'folder-bad-guy',
    folderName: 'Bad Guy',
    content: 'SYNTHETIC-MP3: bad guy practice audio',
  },
  {
    id: 'bg-mscz',
    name: 'Bad Guy.mscz',
    mimeType: 'application/octet-stream',
    modifiedTime: '2026-01-02T10:00:00.000Z',
    version: '5',
    folderId: 'folder-bad-guy',
    folderName: 'Bad Guy',
    content: 'SYNTHETIC-MSCZ: bad guy musescore source',
  },
  {
    // Shortcut pointer — must be ignored.
    id: 'bg-shortcut',
    name: 'Reference Performance (YouTube).pdf',
    mimeType: 'application/vnd.google-apps.shortcut',
    modifiedTime: '2026-01-02T10:00:00.000Z',
    folderId: 'folder-bad-guy',
    folderName: 'Bad Guy',
    shortcutDetails: { targetId: 'external-thing', targetMimeType: 'application/pdf' },
  },
  {
    // Native Google Doc — no real bytes, must be ignored.
    id: 'bg-doc',
    name: 'Arranging Notes',
    mimeType: 'application/vnd.google-apps.document',
    modifiedTime: '2026-01-02T10:00:00.000Z',
    folderId: 'folder-bad-guy',
    folderName: 'Bad Guy',
  },
  {
    // Unsupported asset type — must be ignored.
    id: 'bg-cover',
    name: 'cover-art.jpg',
    mimeType: 'image/jpeg',
    modifiedTime: '2026-01-02T10:00:00.000Z',
    folderId: 'folder-bad-guy',
    folderName: 'Bad Guy',
    content: 'SYNTHETIC-JPG',
  },

  // --- Track Suit folder ---
  {
    id: 'ts-euph',
    name: 'Track Suit - Euphonium.pdf',
    mimeType: 'application/pdf',
    modifiedTime: '2026-01-03T10:00:00.000Z',
    version: '1',
    folderId: 'folder-track-suit',
    folderName: 'Track Suit',
    content: 'SYNTHETIC-PDF: track suit euphonium part',
  },
  {
    id: 'ts-tpt',
    name: 'Track Suit - Trumpet.pdf',
    mimeType: 'application/pdf',
    modifiedTime: '2026-01-03T10:00:00.000Z',
    version: '1',
    folderId: 'folder-track-suit',
    folderName: 'Track Suit',
    content: 'SYNTHETIC-PDF: track suit trumpet part',
  },
  {
    id: 'ts-mp3',
    name: 'Track Suit.mp3',
    mimeType: 'audio/mpeg',
    modifiedTime: '2026-01-03T10:00:00.000Z',
    version: '1',
    folderId: 'folder-track-suit',
    folderName: 'Track Suit',
    content: 'SYNTHETIC-MP3: track suit audio',
  },
];

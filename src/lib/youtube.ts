// Reference videos are stored as a plain YouTube URL on a song (a `videoUrl`
// correction — see corrections.ts). Unlike audio/scores, a video is NOT a synced
// Drive blob; it's an external link. These helpers parse the pasted URL down to
// its 11-char video id so we can canonicalize it on save and derive a thumbnail
// (img.youtube.com, no API key) for the score view — pure functions, safe to
// import on both the server (normalize) and the client (display).

/** The 11-char video id from any common YouTube URL form, or null. */
export function youtubeId(url: string): string | null {
  const s = url.trim();
  if (!s) return null;
  // watch?v=ID, youtu.be/ID, /embed/ID, /shorts/ID, /v/ID — id is 11 chars of
  // [A-Za-z0-9_-]. Match the v= query param first, then any /path/ID form.
  const m =
    s.match(/[?&]v=([A-Za-z0-9_-]{11})/) ??
    s.match(/(?:youtu\.be\/|\/embed\/|\/shorts\/|\/v\/)([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  // A bare id pasted on its own.
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  return null;
}

/** Canonical watch URL for a video id. */
export function youtubeWatchUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`;
}

/** Thumbnail URL for a video id (medium quality, 320×180). */
export function youtubeThumb(id: string): string {
  return `https://img.youtube.com/vi/${id}/mqdefault.jpg`;
}

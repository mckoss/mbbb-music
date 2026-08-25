// Build a tiny PCM WAV containing the whole count-in. Playing one ordinary
// media element is substantially more reliable in an installed iPad PWA than
// scheduling Web Audio oscillators, and it follows the same audio route as the
// practice recording itself.

export const COUNT_IN_LEAD_SECONDS = 0.12;

const SAMPLE_RATE = 22_050;
const CLICK_SECONDS = 0.09;

function ascii(view: DataView, offset: number, value: string) {
  for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
}

/** Return a mono, 16-bit PCM WAV with one click per beat and an accented last beat. */
export function buildCountInWav(beats: number, beatSeconds: number): ArrayBuffer {
  if (!Number.isInteger(beats) || beats < 1) throw new RangeError('beats must be a positive integer');
  if (!Number.isFinite(beatSeconds) || beatSeconds <= 0) {
    throw new RangeError('beatSeconds must be positive');
  }

  const duration = COUNT_IN_LEAD_SECONDS + beats * beatSeconds;
  const frames = Math.ceil(duration * SAMPLE_RATE);
  const dataBytes = frames * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  ascii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(view, 8, 'WAVE');
  ascii(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(view, 36, 'data');
  view.setUint32(40, dataBytes, true);

  const clickFrames = Math.round(CLICK_SECONDS * SAMPLE_RATE);
  const attackFrames = Math.round(0.005 * SAMPLE_RATE);
  for (let beat = 0; beat < beats; beat++) {
    const accent = beat === beats - 1;
    const frequency = accent ? 1320 : 880;
    const peak = accent ? 0.72 : 0.45;
    const start = Math.round((COUNT_IN_LEAD_SECONDS + beat * beatSeconds) * SAMPLE_RATE);
    for (let i = 0; i < clickFrames && start + i < frames; i++) {
      const seconds = i / SAMPLE_RATE;
      const attack = Math.min(1, i / attackFrames);
      const decay = Math.exp(-48 * Math.max(0, seconds - 0.005));
      const sample = Math.sin(2 * Math.PI * frequency * seconds) * peak * attack * decay;
      view.setInt16(44 + (start + i) * 2, Math.round(sample * 32767), true);
    }
  }

  return buffer;
}

// Color + display styling per content source, used by the Library Status grid
// and its legend. Sources are matched by keyword (not exact label) so a rename
// or a brand-new repo still resolves to a sensible color, falling back to gray.

export interface SourceStyle {
  /** Background color of the indicator square / legend swatch. */
  color: string;
  /** High-contrast text color for the count drawn on the square. */
  text: string;
  /** Friendly display name for the legend. */
  name: string;
}

const NEUTRAL: SourceStyle = { color: '#9aa0a6', text: '#ffffff', name: 'Other' };

// Red is reserved for unreachable items (see UNREACHABLE_STYLE), so Mike Koss is
// purple.
export function sourceStyle(label: string | null | undefined): SourceStyle {
  const l = (label ?? '').toLowerCase();
  if (l.includes('arrangement')) return { color: '#2e9e4f', text: '#ffffff', name: 'Arrangements' };
  if (l.includes('mbbb') || l.includes('song-library'))
    return { color: '#f2c200', text: '#332a00', name: 'MBBB Song Library' };
  if (l.includes('honk')) return { color: '#2f6df0', text: '#ffffff', name: 'HONK! All-Stars' };
  if (l.includes('koss')) return { color: '#7c3aed', text: '#ffffff', name: 'Mike Koss' };
  return label ? { ...NEUTRAL, name: label } : NEUTRAL;
}

// Shown (in red) when a score/part exists only as a shortcut whose target the
// sync can't read — a permissions/visibility gap to fix in Drive.
export const UNREACHABLE_STYLE: SourceStyle = {
  color: '#d8413a',
  text: '#ffffff',
  name: 'Unreachable (permissions)',
};

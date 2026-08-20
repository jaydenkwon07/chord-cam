// chords — static fingering table for the frozen Phase 1 vocabulary, as DATA.
// Textbook open-chord shapes. Strings are numbered 1..6, 1 = high E (thinnest),
// 6 = low E (thickest); fret 0 means an open string. Fretted positions drive the
// AR target rings; open/muted strings are drawn as informational nut markers.

export interface FretPosition {
  string: number; // 1..6, 1 = high E
  fret: number; // 1..3 for the open-chord vocabulary
}

export interface Fingering {
  frets: FretPosition[]; // fingered positions (fret >= 1)
  open: number[]; // strings played open (fret 0)
  muted: number[]; // strings not played
}

const FINGERINGS: Record<string, Fingering> = {
  C: { frets: [{ string: 5, fret: 3 }, { string: 4, fret: 2 }, { string: 2, fret: 1 }], open: [3, 1], muted: [6] },
  A: { frets: [{ string: 4, fret: 2 }, { string: 3, fret: 2 }, { string: 2, fret: 2 }], open: [5, 1], muted: [6] },
  G: { frets: [{ string: 6, fret: 3 }, { string: 5, fret: 2 }, { string: 1, fret: 3 }], open: [4, 3, 2], muted: [] },
  E: { frets: [{ string: 5, fret: 2 }, { string: 4, fret: 2 }, { string: 3, fret: 1 }], open: [6, 2, 1], muted: [] },
  D: { frets: [{ string: 3, fret: 2 }, { string: 2, fret: 3 }, { string: 1, fret: 2 }], open: [4], muted: [6, 5] },
  Em: { frets: [{ string: 5, fret: 2 }, { string: 4, fret: 2 }], open: [6, 3, 2, 1], muted: [] },
  Am: { frets: [{ string: 4, fret: 2 }, { string: 3, fret: 2 }, { string: 2, fret: 1 }], open: [5, 1], muted: [6] },
  Dm: { frets: [{ string: 3, fret: 2 }, { string: 2, fret: 3 }, { string: 1, fret: 1 }], open: [4], muted: [6, 5] },
};

export function fingering(chord: string): Fingering {
  const f = FINGERINGS[chord];
  if (!f) throw new Error(`No fingering for chord "${chord}"`);
  return f;
}

export function hasFingering(chord: string): boolean {
  return chord in FINGERINGS;
}

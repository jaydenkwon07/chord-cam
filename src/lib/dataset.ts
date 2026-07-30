// Dataset types + the take-based split. The split partitions on take-id so
// near-identical consecutive frames from one recorded burst can never straddle
// train and test — the thing the prompt flags as mattering more than the model.

export interface Sample {
  chord: string;
  takeId: string;
  vector: number[];
  timestamp: number;
}

export function splitByTake(
  samples: Sample[],
  testTakeIds: Set<string>,
): { train: Sample[]; test: Sample[] } {
  const train: Sample[] = [];
  const test: Sample[] = [];
  for (const s of samples) {
    (testTakeIds.has(s.takeId) ? test : train).push(s);
  }
  return { train, test };
}

// Distinct take-ids for a chord, ordered by when the take was first recorded.
function takesForChord(samples: Sample[], chord: string): string[] {
  const firstSeen = new Map<string, number>();
  for (const s of samples) {
    if (s.chord !== chord) continue;
    if (!firstSeen.has(s.takeId)) firstSeen.set(s.takeId, s.timestamp);
  }
  return [...firstSeen.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([takeId]) => takeId);
}

// Hold out up to `perChord` of each chord's most-recent takes for the test set,
// but never all of a chord's takes (a chord always keeps >=1 take for training).
export function chooseTestTakes(samples: Sample[], perChord: number): Set<string> {
  const chords = new Set(samples.map((s) => s.chord));
  const testTakes = new Set<string>();
  for (const chord of chords) {
    const takes = takesForChord(samples, chord);
    const holdOut = Math.min(perChord, Math.max(0, takes.length - 1));
    for (const takeId of takes.slice(takes.length - holdOut)) {
      testTakes.add(takeId);
    }
  }
  return testTakes;
}

// The take that contains the most recently recorded sample — used to undo the
// last take. Works from the dataset itself, so it's correct even after reload.
export function mostRecentTakeId(samples: Sample[]): string | null {
  let newest: Sample | null = null;
  for (const s of samples) {
    if (newest === null || s.timestamp > newest.timestamp) newest = s;
  }
  return newest ? newest.takeId : null;
}

export interface ChordCount {
  samples: number;
  takes: number;
}

export function takeCountsByChord(samples: Sample[]): Record<string, ChordCount> {
  const out: Record<string, ChordCount> = {};
  const seenTakes: Record<string, Set<string>> = {};
  for (const s of samples) {
    if (!out[s.chord]) {
      out[s.chord] = { samples: 0, takes: 0 };
      seenTakes[s.chord] = new Set();
    }
    out[s.chord].samples++;
    seenTakes[s.chord].add(s.takeId);
  }
  for (const chord of Object.keys(out)) {
    out[chord].takes = seenTakes[chord].size;
  }
  return out;
}

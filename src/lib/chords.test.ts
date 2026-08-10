import { describe, expect, test } from "vitest";
import { fingering, hasFingering, type Fingering } from "./chords.ts";
import vocab from "../data/vocabulary.json";

describe("chords fingering table", () => {
  test("C major is the textbook x32010 shape", () => {
    expect(fingering("C")).toEqual<Fingering>({
      frets: [
        { string: 5, fret: 3 },
        { string: 4, fret: 2 },
        { string: 2, fret: 1 },
      ],
      open: [3, 1],
      muted: [6],
    });
  });

  test("every frozen-vocabulary chord has a fingering", () => {
    for (const chord of vocab.chords) {
      expect(hasFingering(chord)).toBe(true);
    }
  });

  test("hasFingering is false for an unknown chord", () => {
    expect(hasFingering("B7")).toBe(false);
  });

  test("fingering throws on an unknown chord", () => {
    expect(() => fingering("B7")).toThrow();
  });

  test("each chord accounts for all 6 strings exactly once", () => {
    for (const chord of vocab.chords) {
      const f = fingering(chord);
      const strings = [...f.frets.map((p) => p.string), ...f.open, ...f.muted].sort();
      expect(strings).toEqual([1, 2, 3, 4, 5, 6]);
    }
  });

  test("fretted positions are strings 1..6 and frets 1..3", () => {
    for (const chord of vocab.chords) {
      for (const p of fingering(chord).frets) {
        expect(p.string).toBeGreaterThanOrEqual(1);
        expect(p.string).toBeLessThanOrEqual(6);
        expect(p.fret).toBeGreaterThanOrEqual(1);
        expect(p.fret).toBeLessThanOrEqual(3);
      }
    }
  });
});

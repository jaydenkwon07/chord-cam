import { describe, expect, test } from "vitest";
import {
  chooseTestTakes,
  mostRecentTakeId,
  splitByTake,
  takeCountsByChord,
  type Sample,
} from "./dataset.ts";

function sample(chord: string, takeId: string, i: number): Sample {
  return { chord, takeId, vector: [i], timestamp: i };
}

// Two takes per chord, several frames each.
function dataset(): Sample[] {
  const out: Sample[] = [];
  let i = 0;
  for (const chord of ["C", "G"]) {
    for (const take of ["1", "2"]) {
      for (let f = 0; f < 3; f++) out.push(sample(chord, `${chord}-${take}`, i++));
    }
  }
  return out;
}

describe("splitByTake", () => {
  test("puts exactly the named takes in test and the rest in train", () => {
    const data = dataset();
    const { train, test } = splitByTake(data, new Set(["C-2", "G-2"]));
    expect(test.every((s) => s.takeId === "C-2" || s.takeId === "G-2")).toBe(true);
    expect(train.some((s) => s.takeId === "C-2")).toBe(false);
    expect(train.length + test.length).toBe(data.length);
  });

  test("no take-id ever appears in both train and test (no frame leakage)", () => {
    const data = dataset();
    const { train, test } = splitByTake(data, new Set(["C-1"]));
    const trainTakes = new Set(train.map((s) => s.takeId));
    const testTakes = new Set(test.map((s) => s.takeId));
    for (const t of testTakes) expect(trainTakes.has(t)).toBe(false);
  });
});

describe("chooseTestTakes", () => {
  test("holds out the requested number of takes per chord", () => {
    const testTakes = chooseTestTakes(dataset(), 1);
    // One take per chord -> 2 total, and they are real take-ids.
    expect(testTakes.size).toBe(2);
    const { train, test } = splitByTake(dataset(), testTakes);
    // Every chord still has training data left.
    expect(new Set(train.map((s) => s.chord))).toEqual(new Set(["C", "G"]));
    expect(test.length).toBeGreaterThan(0);
  });

  test("never holds out every take of a chord", () => {
    // Chord with a single take must not be fully moved to test.
    const data = [sample("D", "D-1", 0), sample("D", "D-1", 1)];
    const testTakes = chooseTestTakes(data, 5);
    expect(testTakes.has("D-1")).toBe(false);
  });
});

describe("mostRecentTakeId", () => {
  test("returns null for an empty dataset", () => {
    expect(mostRecentTakeId([])).toBeNull();
  });

  test("returns the take-id of the latest-timestamp sample", () => {
    const data = [
      sample("C", "C-1", 100),
      sample("G", "G-1", 300), // newest
      sample("C", "C-1", 150),
      sample("G", "G-1", 250),
    ];
    expect(mostRecentTakeId(data)).toBe("G-1");
  });
});

describe("takeCountsByChord", () => {
  test("reports sample and take counts per chord", () => {
    const counts = takeCountsByChord(dataset());
    expect(counts["C"].samples).toBe(6);
    expect(counts["C"].takes).toBe(2);
  });
});

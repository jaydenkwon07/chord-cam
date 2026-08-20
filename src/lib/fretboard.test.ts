import { describe, expect, test } from "vitest";
import type { FretPosition } from "./chords.ts";
import {
  applyHomography,
  cellToCanonical,
  computeHomography,
  fretGrid,
  fretWireU,
  project,
  type Point,
} from "./fretboard.ts";

function close(a: Point, b: Point, tol = 1e-9): void {
  expect(Math.abs(a.x - b.x)).toBeLessThan(tol);
  expect(Math.abs(a.y - b.y)).toBeLessThan(tol);
}

describe("computeHomography / applyHomography", () => {
  // Canonical corners, in the fixed order computeHomography expects (App order
  // [nutTop, nutBottom, fret3Top, fret3Bottom]; top handles are the low-E side,
  // so v = 1 up top, v = 0 at the bottom).
  const canonical: Point[] = [
    { x: 0, y: 1 },
    { x: 0, y: 0 },
    { x: 1, y: 1 },
    { x: 1, y: 0 },
  ];

  test("round-trips: canonical corners map back to the input image corners", () => {
    // An arbitrary convex quad with perspective (not axis-aligned).
    const corners: Point[] = [
      { x: 0.2, y: 0.3 },
      { x: 0.25, y: 0.8 },
      { x: 0.9, y: 0.2 },
      { x: 0.8, y: 0.7 },
    ];
    const H = computeHomography(corners);
    expect(H).not.toBeNull();
    for (let i = 0; i < 4; i++) {
      close(applyHomography(H!, canonical[i]), corners[i]);
    }
  });

  test("maps the canonical centre to the quad centre for an axis-aligned rectangle", () => {
    const corners: Point[] = [
      { x: 0.1, y: 0.2 },
      { x: 0.1, y: 0.6 },
      { x: 0.7, y: 0.2 },
      { x: 0.7, y: 0.6 },
    ];
    const H = computeHomography(corners)!;
    close(applyHomography(H, { x: 0.5, y: 0.5 }), { x: 0.4, y: 0.4 });
  });

  test("returns null for degenerate (collinear) corners", () => {
    const collinear: Point[] = [
      { x: 0.1, y: 0.1 },
      { x: 0.2, y: 0.2 },
      { x: 0.3, y: 0.3 },
      { x: 0.4, y: 0.4 },
    ];
    expect(computeHomography(collinear)).toBeNull();
  });

  test("returns null when not given exactly 4 corners", () => {
    expect(computeHomography([{ x: 0, y: 0 }])).toBeNull();
  });
});

describe("fret geometry", () => {
  test("fret-wire distances span 0 at the nut to 1 at fret 3, monotonic", () => {
    expect(fretWireU(0)).toBeCloseTo(0, 12);
    expect(fretWireU(3)).toBeCloseTo(1, 12);
    expect(fretWireU(0)).toBeLessThan(fretWireU(1));
    expect(fretWireU(1)).toBeLessThan(fretWireU(2));
    expect(fretWireU(2)).toBeLessThan(fretWireU(3));
  });

  test("cellToCanonical places strings across v and frets along u", () => {
    expect(cellToCanonical({ string: 1, fret: 1 }).y).toBeCloseTo(0, 12); // high E
    expect(cellToCanonical({ string: 6, fret: 1 }).y).toBeCloseTo(1, 12); // low E
    expect(cellToCanonical({ string: 3, fret: 1 }).y).toBeCloseTo(0.4, 12);
    // fret cell centres increase along the neck
    const u1 = cellToCanonical({ string: 1, fret: 1 }).x;
    const u2 = cellToCanonical({ string: 1, fret: 2 }).x;
    const u3 = cellToCanonical({ string: 1, fret: 3 }).x;
    expect(u1).toBeLessThan(u2);
    expect(u2).toBeLessThan(u3);
  });

  test("an open string (fret 0) sits at the nut (u = 0)", () => {
    expect(cellToCanonical({ string: 4, fret: 0 }).x).toBeCloseTo(0, 12);
  });

  test("fretGrid returns one segment per string and nut..N fret lines", () => {
    const corners: Point[] = [
      { x: 0.1, y: 0.2 },
      { x: 0.1, y: 0.6 },
      { x: 0.7, y: 0.2 },
      { x: 0.7, y: 0.6 },
    ];
    const H = computeHomography(corners)!;
    const grid = fretGrid(H, 3);
    expect(grid.strings).toHaveLength(6);
    expect(grid.frets).toHaveLength(4); // nut + frets 1,2,3
    // The nut line (frets[0]) runs between the two nut corners. Its endpoints
    // are the canonical (0,0)=high-E and (0,1)=low-E ends, which map to the
    // bottom (corners[1]) and top (corners[0]) nut handles respectively.
    close(grid.frets[0].a, corners[1]);
    close(grid.frets[0].b, corners[0]);
  });

  test("high E projects below low E when the top handles are up-screen", () => {
    // Axis-aligned quad, top handles at the smaller y (top of frame).
    const corners: Point[] = [
      { x: 0.1, y: 0.2 }, // nutTop
      { x: 0.1, y: 0.6 }, // nutBottom
      { x: 0.7, y: 0.2 }, // fret3Top
      { x: 0.7, y: 0.6 }, // fret3Bottom
    ];
    const H = computeHomography(corners)!;
    const highE = project({ string: 1, fret: 1 }, H); // high E
    const lowE = project({ string: 6, fret: 1 }, H); // low E
    // High E must render lower on screen (larger y) than low E.
    expect(highE.y).toBeGreaterThan(lowE.y);
  });

  test("flipStrings inverts the string orientation", () => {
    const corners: Point[] = [
      { x: 0.1, y: 0.2 }, // nutTop
      { x: 0.1, y: 0.6 }, // nutBottom
      { x: 0.7, y: 0.2 }, // fret3Top
      { x: 0.7, y: 0.6 }, // fret3Bottom
    ];
    const H = computeHomography(corners, true)!;
    const highE = project({ string: 1, fret: 1 }, H);
    const lowE = project({ string: 6, fret: 1 }, H);
    // Flipped: high E now renders higher on screen (smaller y) than low E.
    expect(highE.y).toBeLessThan(lowE.y);
  });

  test("project maps a fret position through H consistently with cellToCanonical", () => {
    const corners: Point[] = [
      { x: 0.1, y: 0.2 },
      { x: 0.1, y: 0.6 },
      { x: 0.7, y: 0.2 },
      { x: 0.7, y: 0.6 },
    ];
    const H = computeHomography(corners)!;
    const cell: FretPosition = { string: 5, fret: 3 };
    close(project(cell, H), applyHomography(H, cellToCanonical(cell)));
  });
});

import { describe, expect, test } from "vitest";
import { applyHomography, computeHomography, type Point } from "./fretboard.ts";

function close(a: Point, b: Point, tol = 1e-9): void {
  expect(Math.abs(a.x - b.x)).toBeLessThan(tol);
  expect(Math.abs(a.y - b.y)).toBeLessThan(tol);
}

describe("computeHomography / applyHomography", () => {
  // Canonical corners, in the fixed order computeHomography expects.
  const canonical: Point[] = [
    { x: 0, y: 0 },
    { x: 0, y: 1 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
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

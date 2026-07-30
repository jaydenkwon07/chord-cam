import { describe, expect, test } from "vitest";
import { normalize, type Landmark } from "./normalize.ts";

// Build 21 distinct, deterministic landmarks so scale/rotation tests are
// meaningful. Wrist (0) and middle MCP (9) get fixed spots; the rest fan out.
function makeLandmarks(): Landmark[] {
  const pts: Landmark[] = [];
  for (let i = 0; i < 21; i++) {
    pts.push({
      x: 0.3 + i * 0.01,
      y: 0.6 - i * 0.015,
      z: (i % 5) * 0.002,
    });
  }
  // Wrist and middle-MCP in a clean configuration (z=0) for the canonical check.
  pts[0] = { x: 0.5, y: 0.7, z: 0 };
  pts[9] = { x: 0.5, y: 0.4, z: 0 }; // straight above the wrist in image space
  return pts;
}

function translate(pts: Landmark[], dx: number, dy: number, dz: number): Landmark[] {
  return pts.map((p) => ({ x: p.x + dx, y: p.y + dy, z: p.z + dz }));
}

function scaleAboutOrigin(pts: Landmark[], k: number): Landmark[] {
  return pts.map((p) => ({ x: p.x * k, y: p.y * k, z: p.z * k }));
}

function rotateXY(pts: Landmark[], phi: number): Landmark[] {
  const c = Math.cos(phi);
  const s = Math.sin(phi);
  return pts.map((p) => ({ x: p.x * c - p.y * s, y: p.x * s + p.y * c, z: p.z }));
}

function expectClose(a: number[], b: number[], tol = 1e-9): void {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i++) {
    expect(Math.abs(a[i] - b[i])).toBeLessThan(tol);
  }
}

describe("normalize", () => {
  test("produces a 63-dim vector (21 landmarks x 3 coords)", () => {
    expect(normalize(makeLandmarks())).toHaveLength(63);
  });

  test("maps the wrist to the origin", () => {
    const v = normalize(makeLandmarks());
    expect(Math.abs(v[0])).toBeLessThan(1e-9);
    expect(Math.abs(v[1])).toBeLessThan(1e-9);
    expect(Math.abs(v[2])).toBeLessThan(1e-9);
  });

  test("is invariant to translation (where the hand sits in frame)", () => {
    const base = makeLandmarks();
    expectClose(normalize(base), normalize(translate(base, 0.2, -0.1, 0.05)));
  });

  test("is invariant to scale (how far the hand is from the camera)", () => {
    const base = makeLandmarks();
    expectClose(normalize(base), normalize(scaleAboutOrigin(base, 2.5)));
  });

  test("is invariant to in-plane rotation (hand tilt/roll)", () => {
    const base = makeLandmarks();
    expectClose(normalize(base), normalize(rotateXY(base, 0.7)), 1e-9);
  });

  test("rotates the middle MCP onto the canonical +X axis at unit distance", () => {
    // With wrist(0) and MCP9 z=0 and MCP9 exactly one hand-size from the wrist,
    // the normalized MCP9 (index 9 -> coords 27,28,29) sits at (1, 0, 0).
    const v = normalize(makeLandmarks());
    expect(Math.abs(v[27] - 1)).toBeLessThan(1e-9);
    expect(Math.abs(v[28])).toBeLessThan(1e-9);
    expect(Math.abs(v[29])).toBeLessThan(1e-9);
  });

  test("returns finite zeros for a degenerate hand (wrist == middle MCP)", () => {
    const pts = makeLandmarks();
    pts[9] = { ...pts[0] };
    const v = normalize(pts);
    expect(v).toHaveLength(63);
    expect(v.every((n) => Number.isFinite(n))).toBe(true);
    expect(v.every((n) => n === 0)).toBe(true);
  });
});

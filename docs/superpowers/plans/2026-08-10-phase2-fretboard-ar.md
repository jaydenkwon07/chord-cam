# Phase 2 — Fretboard Localization + AR Fingering Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Practice" mode that overlays where fingers go for a chosen chord on the player's real fretboard (calibrated once by dragging 4 corners), turning the target rings green when the Phase 1 classifier agrees the hand matches.

**Architecture:** A new *pure geometry* layer (`chords.ts` fingering table, `fretboard.ts` homography + projection) maps a canonical fretboard rectangle onto the four image corners the user drags, then projects each fretted note into display coordinates. A second stacked canvas draws the grid + target rings; the existing Phase 1 `classify_chord` seam is reused unchanged to drive a whole-chord match indicator. Overlay geometry and the classifier are fully independent.

**Tech Stack:** TypeScript (strict), React 19, Vite, MediaPipe Tasks (existing), vitest. No new runtime dependencies.

## Global Constraints

- **Client-side only. No backend. No new runtime dependencies** beyond the existing `react`, `react-dom`, `@mediapipe/tasks-vision`. New code is pure TS + canvas.
- **TypeScript strict + `verbatimModuleSyntax`:** every type-only import MUST use `import type`; every relative import path MUST include the `.ts` extension (e.g. `./chords.ts`). JSON imports rely on `resolveJsonModule` (already on).
- **`noUnusedLocals` / `noUnusedParameters` are on** — no dead code or unused args.
- **Testing policy (matches CLAUDE.md):** vitest covers the *pure seams only* (`chords.ts`, `fretboard.ts`). Canvas / DOM / MediaPipe glue (`overlayDraw.ts`, `App.tsx` additions) stays untested at the edges, exactly like `draw.ts` and `useHandLandmarker.ts` — verify those via `npm run build` (tsc typecheck) and live `npm run dev`.
- **Coordinates:** all pure geometry works in NORMALIZED display coordinates (0..1 of canvas width/height) so it is resolution-independent. Pixel scaling happens ONLY in the drawing edge (`overlayDraw.ts`).
- **Frozen vocabulary:** `C A G E D Em Am Dm`, read from `src/data/vocabulary.json`. Do not add chords.
- **Overlay geometry is independent of the classifier.** The match check uses landmarks via `classify_chord`; it must NOT consume the homography.
- **Commits:** small, behaviour-described. **Do NOT add a `Co-Authored-By` trailer** (repo-wide rule in `~/Code/Projects/CLAUDE.md`).
- **Honesty copy (from the spec):** the UI must state that a "match" means "the current hand shape classifies as the target chord," not that every finger is verified on the right string, and that it inherits Phase 1 confusers (notably Dm↔Am).

**Useful commands:**
- Run one test file: `npx vitest run src/lib/chords.test.ts`
- Run all tests: `npm test`
- Typecheck + build: `npm run build`
- Dev server: `npm run dev`

---

## File Structure

- `src/lib/chords.ts` (new) — static fingering table + `fingering()` / `hasFingering()`. Pure data.
- `src/lib/chords.test.ts` (new) — table consistency tests.
- `src/lib/fretboard.ts` (new) — `computeHomography`, `applyHomography`, `cellToCanonical`, `project`, `fretGrid`, geometry constants/types. Pure math.
- `src/lib/fretboard.test.ts` (new) — homography round-trip, projection, grid tests.
- `src/overlayDraw.ts` (new) — `OverlayScene` type + `drawOverlay(ctx, scene)`. Canvas edge, imports `sizeCanvasToVideo` from `draw.ts`.
- `src/App.tsx` (modify) — add `"overlay"` mode, second overlay `<canvas>`, calibration drag handles, `localStorage` persistence, the overlay draw loop, and the match indicator + caveat copy.
- `DECISIONS.md` (modify) — append the Phase 2 build note.
- `CLAUDE.md` (modify, untracked/gitignored) — flip the roadmap MUTABLE STATUS to reflect Phase 2 landing (only if a status block exists; do not touch load-bearing sections).

---

## Task 1: Chord fingering table (`chords.ts`)

**Files:**
- Create: `src/lib/chords.ts`
- Test: `src/lib/chords.test.ts`

**Interfaces:**
- Consumes: `src/data/vocabulary.json` (`{ chords: string[] }`) in the test only.
- Produces:
  - `interface FretPosition { string: number; fret: number }`
  - `interface Fingering { frets: FretPosition[]; open: number[]; muted: number[] }`
  - `function fingering(chord: string): Fingering` (throws on unknown chord)
  - `function hasFingering(chord: string): boolean`

- [ ] **Step 1: Write the failing test**

Create `src/lib/chords.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/chords.test.ts`
Expected: FAIL — cannot resolve `./chords.ts`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/chords.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/chords.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/chords.ts src/lib/chords.test.ts
git commit -m "Add chord fingering table for the frozen vocabulary"
```

---

## Task 2: Homography solve (`fretboard.ts` core)

**Files:**
- Create: `src/lib/fretboard.ts`
- Test: `src/lib/fretboard.test.ts`

**Interfaces:**
- Produces:
  - `interface Point { x: number; y: number }`
  - `type Mat3 = readonly number[]` (length 9, row-major)
  - `interface Segment { a: Point; b: Point }`
  - `const STRINGS = 6`, `const CALIBRATED_FRETS = 3`
  - `function computeHomography(corners: Point[]): Mat3 | null` — maps canonical corners `[(0,0),(0,1),(1,0),(1,1)]` (order: nut@string1, nut@string6, fret3@string1, fret3@string6) to the four image corners; `null` if degenerate.
  - `function applyHomography(H: Mat3, p: Point): Point`

- [ ] **Step 1: Write the failing test**

Create `src/lib/fretboard.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/fretboard.test.ts`
Expected: FAIL — cannot resolve `./fretboard.ts`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/fretboard.ts`:

```ts
// fretboard — pure geometry mapping a canonical fretboard rectangle onto the
// image (display) plane the player calibrated, and back out to target dots.
// All points are NORMALIZED display coordinates (0..1 of canvas width/height),
// so the math is resolution-independent; the drawing edge scales to pixels.
// Canonical coords: u along the neck (0 = nut, 1 = fret 3), v across the strings
// (0 = string 1 / high E, 1 = string 6 / low E).

export interface Point {
  x: number;
  y: number;
}

export type Mat3 = readonly number[]; // length 9, row-major

export interface Segment {
  a: Point;
  b: Point;
}

export const STRINGS = 6;
export const CALIBRATED_FRETS = 3; // the nut -> fret 3 span the user calibrates

// The canonical corners the four dragged image corners correspond to, in order:
// [nut@string1, nut@string6, fret3@string1, fret3@string6].
const CANONICAL_CORNERS: Point[] = [
  { x: 0, y: 0 },
  { x: 0, y: 1 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
];

// Solve an n x n linear system A x = b by Gaussian elimination with partial
// pivoting. Returns null if the matrix is singular (degenerate calibration).
function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    if (Math.abs(M[pivot][col]) < 1e-12) return null;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

// Build the homography H (3x3, H[8] = 1) mapping CANONICAL_CORNERS -> the four
// image corners the user dragged, in the same order. Returns null if the corners
// are degenerate (collinear/coincident -> non-invertible).
export function computeHomography(corners: Point[]): Mat3 | null {
  if (corners.length !== 4) return null;
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x: u, y: v } = CANONICAL_CORNERS[i];
    const { x, y } = corners[i];
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]);
    b.push(x);
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y]);
    b.push(y);
  }
  const h = solveLinear(A, b);
  if (!h) return null;
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

// Apply a homography to a canonical point, returning image (display) coords.
export function applyHomography(H: Mat3, p: Point): Point {
  const d = H[6] * p.x + H[7] * p.y + H[8];
  return {
    x: (H[0] * p.x + H[1] * p.y + H[2]) / d,
    y: (H[3] * p.x + H[4] * p.y + H[5]) / d,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/fretboard.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/fretboard.ts src/lib/fretboard.test.ts
git commit -m "Add fretboard homography solve (4-corner calibration)"
```

---

## Task 3: Cell projection + grid (`fretboard.ts`)

**Files:**
- Modify: `src/lib/fretboard.ts`
- Test: `src/lib/fretboard.test.ts` (add cases)

**Interfaces:**
- Consumes: `FretPosition` from `./chords.ts` (Task 1); `Mat3`, `Point`, `Segment`, `applyHomography`, `STRINGS`, `CALIBRATED_FRETS` (Task 2).
- Produces:
  - `function fretWireU(n: number): number` — nut-to-fret-wire-n distance as a fraction of the calibrated span (equal temperament); `fretWireU(0) === 0`, `fretWireU(3) === 1`.
  - `function cellToCanonical(cell: FretPosition): Point` — canonical (u,v); fret 0 → u=0 (nut).
  - `function project(cell: FretPosition, H: Mat3): Point`
  - `function fretGrid(H: Mat3, numFrets: number): { strings: Segment[]; frets: Segment[] }`

- [ ] **Step 1: Write the failing test**

Add to `src/lib/fretboard.test.ts` (add the new imports to the existing import line: `cellToCanonical, fretGrid, fretWireU, project`; add a `FretPosition` import from `./chords.ts`):

```ts
import type { FretPosition } from "./chords.ts";
import { cellToCanonical, fretGrid, fretWireU, project } from "./fretboard.ts";

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
    // The nut line (frets[0]) runs between the two nut corners.
    close(grid.frets[0].a, corners[0]);
    close(grid.frets[0].b, corners[1]);
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/fretboard.test.ts`
Expected: FAIL — `fretWireU`/`cellToCanonical`/`project`/`fretGrid` not exported.

- [ ] **Step 3: Write minimal implementation**

Add to the TOP import area of `src/lib/fretboard.ts` (imports must be at file top):

```ts
import type { FretPosition } from "./chords.ts";
```

Append to `src/lib/fretboard.ts`:

```ts
// Distance from the nut to fret-wire n as a fraction of the calibrated span
// (nut -> fret CALIBRATED_FRETS), using equal-temperament spacing.
export function fretWireU(n: number): number {
  const span = 1 - Math.pow(2, -CALIBRATED_FRETS / 12);
  return (1 - Math.pow(2, -n / 12)) / span;
}

// Canonical u of a fretted note at fret f: the midpoint between fret-wires
// (f-1) and f, where a finger actually presses.
function cellCenterU(fret: number): number {
  return (fretWireU(fret - 1) + fretWireU(fret)) / 2;
}

// Canonical v of a string (1 = high E -> 0, 6 = low E -> 1).
function stringV(string: number): number {
  return (string - 1) / (STRINGS - 1);
}

// Canonical (u,v) for a fret position. fret 0 (open) sits at the nut (u = 0).
export function cellToCanonical(cell: FretPosition): Point {
  return {
    x: cell.fret === 0 ? 0 : cellCenterU(cell.fret),
    y: stringV(cell.string),
  };
}

// Project a fret position into image (display) coords via H.
export function project(cell: FretPosition, H: Mat3): Point {
  return applyHomography(H, cellToCanonical(cell));
}

// The string and fret line segments for drawing the calibration grid, in image
// (display) coords. strings: one per string across the span; frets: nut..numFrets.
export function fretGrid(H: Mat3, numFrets: number): { strings: Segment[]; frets: Segment[] } {
  const strings: Segment[] = [];
  for (let s = 1; s <= STRINGS; s++) {
    const v = stringV(s);
    strings.push({
      a: applyHomography(H, { x: 0, y: v }),
      b: applyHomography(H, { x: 1, y: v }),
    });
  }
  const frets: Segment[] = [];
  for (let n = 0; n <= numFrets; n++) {
    const u = fretWireU(n);
    frets.push({
      a: applyHomography(H, { x: u, y: 0 }),
      b: applyHomography(H, { x: u, y: 1 }),
    });
  }
  return { strings, frets };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/fretboard.test.ts`
Expected: PASS (all fretboard tests, old + new).

- [ ] **Step 5: Commit**

```bash
git add src/lib/fretboard.ts src/lib/fretboard.test.ts
git commit -m "Add fret-cell projection and calibration grid geometry"
```

---

## Task 4: Overlay canvas renderer (`overlayDraw.ts`)

**Files:**
- Create: `src/overlayDraw.ts`

**Interfaces:**
- Consumes: `Point`, `Segment` from `./lib/fretboard.ts`; `sizeCanvasToVideo` from `./draw.ts` (already exported).
- Produces:
  - `interface OverlayScene { grid: { strings: Segment[]; frets: Segment[] } | null; targets: Point[]; openMarkers: Point[]; mutedMarkers: Point[]; matched: boolean }`
  - `function drawOverlay(ctx: CanvasRenderingContext2D, scene: OverlayScene): void`

**Note:** Canvas glue — no unit test, per the testing policy (same as `draw.ts`). Verified by typecheck + live use in Task 6.

- [ ] **Step 1: Write the module**

Create `src/overlayDraw.ts`:

```ts
import type { Point, Segment } from "./lib/fretboard.ts";

// Overlay renderer for Practice mode. Draws in normalized display coords scaled
// to the canvas; the overlay canvas sits above the (CSS-mirrored) video and the
// landmark canvas, and is NOT itself mirrored — calibration corners are captured
// in display space, so everything derived from them is already display-aligned.

export interface OverlayScene {
  grid: { strings: Segment[]; frets: Segment[] } | null;
  targets: Point[]; // fretted-position ring centres, normalized
  openMarkers: Point[]; // nut-edge circle markers, normalized
  mutedMarkers: Point[]; // nut-edge cross markers, normalized
  matched: boolean; // classifier agrees the current shape == target
}

const RING_RADIUS_PX = 16;

export function drawOverlay(ctx: CanvasRenderingContext2D, scene: OverlayScene): void {
  const { width, height } = ctx.canvas;
  ctx.clearRect(0, 0, width, height);
  const px = (p: Point) => ({ x: p.x * width, y: p.y * height });

  // Faint fret/string grid.
  if (scene.grid) {
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    for (const seg of [...scene.grid.strings, ...scene.grid.frets]) {
      const a = px(seg.a);
      const b = px(seg.b);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }

  // Target rings: dashed hollow while unmatched, solid green fill when matched.
  ctx.strokeStyle = scene.matched ? "#22c55e" : "#e5e5e5";
  ctx.lineWidth = 3;
  ctx.setLineDash(scene.matched ? [] : [6, 4]);
  for (const t of scene.targets) {
    const c = px(t);
    ctx.beginPath();
    ctx.arc(c.x, c.y, RING_RADIUS_PX, 0, Math.PI * 2);
    if (scene.matched) {
      ctx.fillStyle = "rgba(34,197,94,0.35)";
      ctx.fill();
    }
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // Open (circle) and muted (cross) markers at the nut.
  ctx.font = `${Math.round(height * 0.03)}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#cfcfcf";
  for (const o of scene.openMarkers) {
    const c = px(o);
    ctx.fillText("○", c.x, c.y); // ○
  }
  ctx.fillStyle = "#ff6b6b";
  for (const m of scene.mutedMarkers) {
    const c = px(m);
    ctx.fillText("✕", c.x, c.y); // ✕
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run build`
Expected: builds with no type errors.

- [ ] **Step 3: Commit**

```bash
git add src/overlayDraw.ts
git commit -m "Add Practice-mode overlay canvas renderer"
```

---

## Task 5: Practice mode scaffold — calibration drag + persistence + live grid

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `computeHomography`, `fretGrid`, `type Point` from `./lib/fretboard.ts`; `drawOverlay`, `type OverlayScene` from `./overlayDraw.ts`; `sizeCanvasToVideo` from `./draw.ts`; existing `useHandLandmarker` (`videoRef`, `latestRef`).
- Produces: a working `"overlay"` mode where the user drags 4 corners, sees a live fret grid, and the calibration persists across reload. Target rings + match come in Task 6.

**Note:** DOM/canvas edge — verified via `npm run build` + live `npm run dev`, no unit test.

- [ ] **Step 1: Add the overlay canvas, mode, and calibration state**

In `src/App.tsx`:

1. Extend the mode type and add a third toggle button (the toggle currently maps `["capture", "recognize"]` — change to `["capture", "recognize", "overlay"]` and label `overlay` as `"Practice"`):

```tsx
type Mode = "capture" | "recognize" | "overlay";
```

2. Add refs/state near the other refs:

```tsx
const overlayCanvasRef = useRef<HTMLCanvasElement>(null);

const CALIBRATION_KEY = "chord-cam-calibration";
type Corners = [Point, Point, Point, Point]; // nutTop, nutBottom, fret3Top, fret3Bottom (normalized)

const [corners, setCorners] = useState<Corners | null>(() => {
  try {
    const raw = localStorage.getItem(CALIBRATION_KEY);
    return raw ? (JSON.parse(raw) as Corners) : null;
  } catch {
    return null;
  }
});
const [calibrating, setCalibrating] = useState(false);
const cornersRef = useRef<Corners | null>(corners);
cornersRef.current = corners;
```

(Add `import { computeHomography, fretGrid, type Point } from "./lib/fretboard.ts";` and `import { drawOverlay, type OverlayScene } from "./overlayDraw.ts";` and `import { sizeCanvasToVideo } from "./draw.ts";` to the top imports.)

3. Add the overlay canvas element directly AFTER the existing landmark `<canvas ref={canvasRef} .../>` so it stacks on top:

```tsx
<canvas ref={overlayCanvasRef} style={fill} />
```

- [ ] **Step 2: Add default corners + Practice controls**

Add a helper and controls. When entering Practice with no calibration, seed a centered default quad the user then drags:

```tsx
const DEFAULT_CORNERS: Corners = [
  { x: 0.3, y: 0.35 },
  { x: 0.3, y: 0.65 },
  { x: 0.7, y: 0.35 },
  { x: 0.7, y: 0.65 },
];

const startCalibration = () => {
  setCorners((c) => c ?? DEFAULT_CORNERS);
  setCalibrating(true);
};

const finishCalibration = () => {
  if (corners) localStorage.setItem(CALIBRATION_KEY, JSON.stringify(corners));
  setCalibrating(false);
};
```

Add a Practice control panel (render only when `mode === "overlay"`), mirroring the capture panel's style helpers:

```tsx
{mode === "overlay" && (
  <div style={{ ...panel({ top: 12, right: 12 }), width: 280, gap: 10 }}>
    <span style={dim}>Practice — overlay fingering on your fretboard</span>
    {!corners || calibrating ? (
      <>
        <span style={dim}>
          Drag the 4 handles to the corners of your fretboard: nut &amp; fret 3,
          high-E &amp; low-E side.
        </span>
        <button onClick={finishCalibration} disabled={!corners} style={bigButton}>
          Done calibrating
        </button>
      </>
    ) : (
      <button onClick={() => setCalibrating(true)} style={smallButton}>
        Recalibrate
      </button>
    )}
  </div>
)}
```

- [ ] **Step 3: Render draggable handles while calibrating**

Add handle DOM elements (absolute-positioned divs) over the video when `mode === "overlay" && calibrating`. Convert pointer position to normalized coords via the overlay canvas bounding rect:

```tsx
{mode === "overlay" && calibrating && corners && (
  <>
    {corners.map((c, i) => (
      <div
        key={i}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (e.buttons === 0) return;
          const rect = overlayCanvasRef.current?.getBoundingClientRect();
          if (!rect) return;
          const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
          const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
          setCorners((prev) => {
            if (!prev) return prev;
            const next = [...prev] as Corners;
            next[i] = { x, y };
            return next;
          });
        }}
        style={{
          position: "absolute",
          left: `calc(${c.x * 100}% - 12px)`,
          top: `calc(${c.y * 100}% - 12px)`,
          width: 24,
          height: 24,
          borderRadius: "50%",
          border: "2px solid #fff",
          background: "rgba(21,101,192,0.7)",
          cursor: "grab",
          touchAction: "none",
        }}
      />
    ))}
  </>
)}
```

- [ ] **Step 4: Draw the live grid each frame**

Add a `useEffect` that runs an rAF loop while `mode === "overlay"`, drawing just the grid (targets/markers arrive in Task 6):

```tsx
useEffect(() => {
  if (mode !== "overlay") return;
  const video = videoRef.current;
  const canvas = overlayCanvasRef.current;
  if (!video || !canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  let active = true;
  let rafId = 0;
  const loop = () => {
    if (!active) return;
    rafId = requestAnimationFrame(loop);
    if (video.readyState < 2) return;
    sizeCanvasToVideo(canvas, video);

    const c = cornersRef.current;
    const H = c ? computeHomography(c) : null;
    const scene: OverlayScene = {
      grid: H ? fretGrid(H, 3) : null,
      targets: [],
      openMarkers: [],
      mutedMarkers: [],
      matched: false,
    };
    drawOverlay(ctx, scene);
  };
  rafId = requestAnimationFrame(loop);
  return () => {
    active = false;
    cancelAnimationFrame(rafId);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };
}, [mode]);
```

- [ ] **Step 5: Typecheck**

Run: `npm run build`
Expected: no type errors.

- [ ] **Step 6: Manual verification**

Run: `npm run dev`, open the app, click **Practice**. Confirm:
- Four handles appear; dragging each moves it and the white fret grid follows in real time.
- The grid looks like a fretboard (6 string lines, 4 fret lines) when the handles frame a rectangle.
- Click **Done calibrating** → handles disappear, grid stays. Reload the page, return to Practice → grid is still there (persisted). **Recalibrate** brings the handles back.

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx
git commit -m "Add Practice mode: 4-corner calibration, persistence, live grid"
```

---

## Task 6: Target rings + whole-chord match indicator

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `fingering` from `./lib/chords.ts`; `project` from `./lib/fretboard.ts`; existing `useRecognizer` (returns `{ label, confidence, handVisible }`), `createKnnClassifier`, `getAllSamples`; the Task 5 overlay loop and `cornersRef`.
- Produces: target rings for the selected chord that turn green on match, open/muted nut markers, a chord picker, a live match readout, and the honesty caveat copy.

- [ ] **Step 1: Build the classifier in Practice mode too**

The classifier `useEffect` currently rebuilds only when `mode === "recognize"`. Change its guard and the `useRecognizer` call to also cover overlay:

```tsx
// classifier effect guard:
if (mode !== "recognize" && mode !== "overlay") return;
```

```tsx
const recognition = useRecognizer(
  latestRef,
  mode === "recognize" || mode === "overlay" ? classifier : null,
);
```

- [ ] **Step 2: Add target chord state + a matched ref**

```tsx
const [targetChord, setTargetChord] = useState<string>(CHORDS[0]);
const targetChordRef = useRef(targetChord);
targetChordRef.current = targetChord;

const matchedRef = useRef(false);
matchedRef.current =
  recognition.handVisible && recognition.label === targetChord;
```

- [ ] **Step 3: Feed targets/markers/matched into the overlay loop**

Update the scene construction inside the Task 5 rAF loop to project the target chord's positions (replace the `scene` literal from Task 5, Step 4):

```tsx
const c = cornersRef.current;
const H = c ? computeHomography(c) : null;
let targets: Point[] = [];
let openMarkers: Point[] = [];
let mutedMarkers: Point[] = [];
if (H) {
  const f = fingering(targetChordRef.current);
  targets = f.frets.map((p) => project(p, H));
  openMarkers = f.open.map((s) => project({ string: s, fret: 0 }, H));
  mutedMarkers = f.muted.map((s) => project({ string: s, fret: 0 }, H));
}
const scene: OverlayScene = {
  grid: H ? fretGrid(H, 3) : null,
  targets,
  openMarkers,
  mutedMarkers,
  matched: matchedRef.current,
};
drawOverlay(ctx, scene);
```

Add `import { fingering } from "./lib/chords.ts";` and extend the fretboard import to include `project`. The loop's `useEffect` dependency array stays `[mode]` — it reads the live values through refs, so no re-subscribe on every keystroke.

- [ ] **Step 4: Add the chord picker + match readout + caveat to the Practice panel**

Extend the Practice control panel (from Task 5, Step 2) so that when calibrated and not calibrating, the user can pick a target and see the live match state:

```tsx
{corners && !calibrating && (
  <>
    <span style={dim}>Target chord</span>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {CHORDS.map((c) => (
        <button
          key={c}
          onClick={() => setTargetChord(c)}
          style={toggle(targetChord === c)}
        >
          {c}
        </button>
      ))}
    </div>
    <span
      style={{
        ...pill,
        background: matchedRef.current ? "#0a7d2c" : "#333",
      }}
    >
      {!recognition.handVisible
        ? "show your fretting hand"
        : matchedRef.current
          ? `MATCH · ${targetChord}`
          : `not yet · reads ${recognition.label ?? "?"}`}
    </span>
    <span style={{ ...dim, fontSize: 11 }}>
      "Match" means your hand shape classifies as {targetChord} — it doesn't
      verify each finger's string. Inherits Phase 1 confusers (e.g. Dm/Am).
    </span>
  </>
)}
```

- [ ] **Step 5: Typecheck**

Run: `npm run build`
Expected: no type errors.

- [ ] **Step 6: Manual verification**

Run: `npm run dev`, go to **Practice**, calibrate, then:
- Pick each chord → dashed rings jump to the correct fretted positions; open strings show ○ and muted show ✕ at the nut.
- Fret the shown chord on the real guitar → rings turn solid green and the readout shows `MATCH · <chord>` (requires a recorded dataset from Capture mode; if none, the classifier is null and the readout stays neutral — confirm no crash).
- Fret a *different* chord → readout shows `not yet · reads <other>`.

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx
git commit -m "Overlay target fingering rings + whole-chord match indicator"
```

---

## Task 7: Live verification + decisions log

**Files:**
- Modify: `DECISIONS.md`
- Modify: `CLAUDE.md` (only its MUTABLE STATUS/roadmap note; leave load-bearing sections alone)

- [ ] **Step 1: Full test + build gate**

Run: `npm test && npm run build`
Expected: all vitest suites pass; build clean.

- [ ] **Step 2: End-to-end live check**

Run `npm run dev`. With a guitar in playing position and a dataset already recorded:
- Calibrate once; verify rings land on the right frets for at least C, G, D, Em (a spread of shapes).
- Confirm the green match fires when you fret the target and clears when you don't.
- Note honestly whether Dm vs Am behaves as the caveat warns.

- [ ] **Step 3: Append the decision log**

Add a `0008` entry to `DECISIONS.md` recording: the manual-calibration + static-tracking choice, the homography approach, that the match check reuses `classify_chord` (whole-chord, inherits confusers), and the live-verification result (which chords landed well, any misalignment observed).

- [ ] **Step 4: Update the roadmap status**

In `CLAUDE.md`, mark Phase 2 as delivered in whatever mutable status/roadmap note is appropriate. Do NOT edit non-goals, seams, or the reality-check section.

- [ ] **Step 5: Commit**

```bash
git add DECISIONS.md
git commit -m "Phase 2 live verification + decisions log (0008)"
```

(`CLAUDE.md` is gitignored — its edit is on-disk only, not committed.)

---

## Self-Review

**Spec coverage:**
- Manual 4-corner calibration → Task 2 (`computeHomography`) + Task 5 (drag UI). ✓
- Static assumption + Recalibrate button → Task 5 (persistence, Recalibrate). ✓
- Overlay + whole-chord match reusing `classify_chord` → Task 6 (`useRecognizer`, `matchedRef`). ✓
- Minimal dashed rings, green on match, no finger numbers → Task 4 (`drawOverlay`). ✓
- Fingering table for frozen vocab → Task 1. ✓
- Homography/project/grid pure seams + tests → Tasks 2–3. ✓
- Degenerate calibration returns null → Task 2 (tested) + Task 5 (grid null → nothing drawn). ✓
- No-hand / no-dataset handling → Task 6 (readout neutral, classifier null guarded). ✓
- Honesty caveats in UI → Task 6, Step 4. ✓
- Third mode alongside capture/recognize → Task 5. ✓
- Testing policy (pure seams tested, edges verified live) → Tasks 1–3 tested; 4–6 build+manual. ✓

**Placeholder scan:** No TBD/TODO; every code step has real code. ✓

**Type consistency:** `Point`/`Mat3`/`Segment`/`FretPosition`/`Fingering`/`OverlayScene` are defined once and consumed with matching shapes; `fingering()`, `computeHomography()`, `applyHomography()`, `cellToCanonical()`, `project()`, `fretGrid()`, `drawOverlay()` signatures match across producer and consumer tasks; `Corners` is a local 4-tuple of `Point`. ✓

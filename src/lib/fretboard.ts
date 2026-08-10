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

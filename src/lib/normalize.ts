// normalize — the load-bearing seam (CLAUDE.md). Turns 21 raw MediaPipe
// image-space landmarks into a position/scale/roll-invariant 63-dim pose vector,
// so the classifier sees hand *pose*, not where the hand sits in frame or how
// far away it is. Pure function; see DECISIONS.md 0003 for the scheme.

export interface Landmark {
  x: number;
  y: number;
  z: number;
}

const WRIST = 0;
const MIDDLE_MCP = 9;
const EPSILON = 1e-9;

export function normalize(landmarks: Landmark[]): number[] {
  const wrist = landmarks[WRIST];

  // 1. Translate to a wrist origin.
  const translated = landmarks.map((p) => ({
    x: p.x - wrist.x,
    y: p.y - wrist.y,
    z: p.z - wrist.z,
  }));

  // 2. Scale by the (3D) wrist -> middle-MCP distance: a stable hand-size measure.
  const m = translated[MIDDLE_MCP];
  const size = Math.hypot(m.x, m.y, m.z);
  if (size < EPSILON) return new Array(landmarks.length * 3).fill(0);

  // 3. Rotate in the image (x-y) plane so wrist -> MCP9 lands on +X. Removing
  //    this angle cancels in-plane roll/tilt. z is untouched by the rotation.
  const theta = Math.atan2(m.y, m.x);
  const cos = Math.cos(-theta);
  const sin = Math.sin(-theta);

  const out: number[] = [];
  for (const p of translated) {
    const sx = p.x / size;
    const sy = p.y / size;
    const sz = p.z / size;
    out.push(sx * cos - sy * sin, sx * sin + sy * cos, sz);
  }
  return out;
}

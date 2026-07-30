# DECISIONS

Light log of real forks. Keep it short — this is a toy, not a thesis.

## 0001 — MediaPipe WASM + model loaded from CDN (Phase 0)

The `HandLandmarker` WASM fileset and `hand_landmarker.task` model are fetched
from jsDelivr / Google storage at runtime rather than vendored into the repo.

- **Why:** simplest possible spike, still "no backend." No copy step, no
  `public/` assets to keep in sync with the `@mediapipe/tasks-vision` version.
- **Cost:** first load needs network; not usable fully offline.
- **Alternative if wanted later:** copy `node_modules/@mediapipe/tasks-vision/wasm`
  into `public/` and drop the `.task` file alongside it, then point
  `WASM_BASE` / `MODEL_URL` in `src/useHandLandmarker.ts` at local paths.

## 0002 — Camera angle verdict (Phase 0 gate) — PASS

Ran the spike with a guitar in playing position, camera facing the player.

- **Verdict: PASS.** Landmarks stay tracked, hands are tracked nicely, no major
  collapses/dropout observed. The self-facing angle works well enough to build
  the recognizer on. Proceeding to Phase 1.

## 0003 — `normalize` scheme (Phase 1, load-bearing)

Turns the 21 raw MediaPipe *image-space* landmarks (`{x,y,z}`, the same coords
`detect_hand` returns; no mirroring applied) into a position/scale/roll-invariant
63-dim pose vector:

1. **Translate** to a wrist origin — subtract landmark 0 from every point.
2. **Scale** by the 3D distance wrist(0) → middle-finger MCP(9), a stable
   hand-size measure. Divides x, y, **and** z by the same factor (MediaPipe z is
   ~the same scale as x, so this is legitimate and keeps finger-curl-toward-camera
   depth — the key self-facing signal — comparable across distance).
3. **Rotate** in the image (x-y) plane so the wrist→MCP9 vector lands on a fixed
   axis, removing in-plane roll/tilt. z is left untouched by the rotation (roll
   is a 2D concern; full 3D canonicalization is deliberately out of scope for the
   baseline).

Degenerate frames (wrist ≈ MCP9) return a zero vector rather than NaNs.

**Why 3D, not 2D:** the whole risk of this project is the oblique self-facing
view where depth distinguishes shapes. Dropping z would throw away the signal
occlusion is fighting over. Revisit if the eval says z hurts more than helps.

## 0005 — Classifier = KNN, and the first honest eval

Baseline `classify_chord` is KNN (k=5) over the normalized vectors — no training
step, swappable behind the `Classifier` interface if an MLP is ever warranted.

First dataset: 5,265 samples, 11–15 takes/chord, C/G/D/Em/Am.

- **Single held-out split (last 3 takes/chord):** 83% overall, but C cratered to
  37%, read as Am 164×. **This was a split artifact**, not a real weakness — the
  "last 3 takes" happened to be a correlated late recording session; holding out
  that whole block at once starved the classifier of same-condition C data.
- **Leave-one-take-out CV (62 folds, the trustworthy number):** **91.4%**
  overall. C is actually the *strongest* at 95.4%. The genuine soft spot is
  **D (84.5%)**, confused with Em and Am; also G↔Em (~85 each way).
- The CLAUDE.md-predicted C↔Am confuser is basically a non-issue on this data
  (C→Am 4.5%). The predicted confuser was wrong here; the eval, not intuition,
  found D.

**Caveat honestly stated:** LOTO always has same-session takes in training, so
~91% may be optimistic for a brand-new session (lighting/camera drift). Real live
accuracy likely sits between 83% and 91%. Recording takes across more varied
sessions and re-running `npm run eval` / `loto` will tighten this.

Harnesses: `npm run eval -- <json> [k] [testTakes]` (single split),
`scripts/loto.ts` (cross-val), `scripts/diag.ts` (per-take breakdown).

## 0004 — Fretting-hand selection

Capture and live inference both act on a single hand. A UI toggle picks which
MediaPipe handedness label ("Left"/"Right") is the fretting hand; if only one
hand is detected it's used regardless. The toggle exists because the mirrored
feed can make the label read inverted (see Phase 0 note) — set it to whatever
label showed on your fretting hand in the overlay.

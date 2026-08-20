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

## 0006 — Full 8-chord vocabulary eval

Vocabulary expanded to the full frozen Phase 1 set (`C A G E D Em Am Dm`); new
dataset recorded with real takes for the three additions (A: 19, E: 16, Dm: 20
takes), 13,132 samples total, 155 takes across all 8 chords.

- **Leave-one-take-out CV (155 folds): 95.5%** overall — higher than the
  5-chord baseline (91.4%), not lower, despite more classes.
- **The C/Dm/Am/D confuser family predicted in 0001-era eval notes is real**
  and is now the dominant error source: Dm↔C (93+22), Dm↔Am (32+74), D↔Dm
  (40+52), D↔Em (15+57), D↔Am (15+33). These are exactly the compact
  three-finger open shapes sharing string/fret geometry that `normalize()`
  makes position-invariant.
- A, G are near-perfect (99.9%, 97.7%); E and Em are solid (~97% each) —
  E↔Am fear from early notes stays a non-issue.
- Datasets are gitignored (`/data`) and passed by path to `npm run eval` /
  `scripts/loto.ts` — not committed, since they're large personal recordings.

## 0007 — C/Dm/Am/D confuser family: mostly bad takes, a real residue underneath

Dug into the 0006 confuser family with `scripts/diag.ts` (per-take LOTO). Per-take
accuracy is bimodal, not uniformly mediocre: most takes score 100% or close to
it, but 11 takes (6.9% of samples) score 0–85% and account for **84% of the
total error mass** in C/D/Dm/Am. Those 11 cluster into two tight windows —
5 consecutive takes (C, C, C, D, Am) in a 3-minute span on 2026-07-30, and 5
consecutive Dm takes in an 80-second span on 2026-08-04 — the same
session-drift artifact 0005 already caught once for C/Am.

Re-running LOTO with just those 11 takes excluded:

| | original | bad takes excluded |
|---|---|---|
| Overall | 95.5% | **97.5%** |
| C | 94.0% | 99.1% |
| Am | 96.9% | 98.6% |
| D | 91.9% | 96.3% |
| Dm | 90.6% | 93.8% |
| C↔Dm confusion | 93 | 3 |

C's confusion with Dm nearly vanishes once the bad takes are dropped — that
part of 0006's confuser story was mostly session noise, not shape overlap.

**What's left is real and didn't move when the noise was removed:**

- **Dm↔Am (74→75, unchanged).** Both are compact minor-shape three-finger
  clusters; `normalize()`'s position/scale/roll invariance is exactly what
  makes them close — it can't see *which string* a finger lands on, only
  relative finger geometry, and that's genuinely similar between these two.
- **D→Em (57→52, barely moved).** Surprising since D (3 fingers) and Em
  (2 fingers, sparse) shouldn't be geometrically close. Best working
  hypothesis: occlusion, not shape — D's third finger (high on the B string)
  intermittently drops out of detection and the landmark set collapses
  toward Em's. Unconfirmed; would need frame-level inspection to be sure.

**Action:** re-record the two flagged session windows (2026-07-30 18:13–18:17,
2026-08-04 19:44–19:46) with a camera/position check first, then re-run
`scripts/loto.ts` — expect a landing near 97.5%, with Dm↔Am and D→Em standing
as the honest residual ceiling for this vocabulary, not a bug to keep chasing.

## 0004 — Fretting-hand selection

Capture and live inference both act on a single hand. A UI toggle picks which
MediaPipe handedness label ("Left"/"Right") is the fretting hand; if only one
hand is detected it's used regardless. The toggle exists because the mirrored
feed can make the label read inverted (see Phase 0 note) — set it to whatever
label showed on your fretting hand in the overlay.

## 0008 — Phase 2: fretboard overlay, and the string-orientation fix

Phase 2 adds the AR fingering overlay Phase 1 skipped. Locked design (from the
approved spec, unchanged here):

- **Localization = one-time manual 4-corner calibration**, no auto CV, no
  per-frame tracking — static assumption + a Recalibrate button. Auto-detection
  would re-fight the oblique, low-contrast self-facing angle every frame; not
  worth it for a personal tool.
- **Geometry = a full projective homography** from a canonical fretboard
  rectangle (nut → fret 3, 6 strings, equal-temperament fret spacing) onto the
  four dragged image corners. Pure, vitest-tested (`fretboard.ts`); the
  fingering table (`chords.ts`) is hand-authored data, tested for consistency.
- **Correctness check = whole-chord, reusing Phase 1 `classify_chord`.** The
  rings are a reference diagram; the green "MATCH" state is the classifier's
  opinion of the overall shape, not per-finger verification. It therefore
  **inherits Phase 1's confusers** — notably Dm↔Am (0007) — so a Dm target can
  read "match" while Am is fretted. The UI copy says this out loud.

**Live-verification finding (the reason Task 7 exists):** calibration drag works
and the grid tracks the fretboard, but the target rings drew **upside down** —
in the self-facing playing view high E sits at the *bottom* of the frame, while
the overlay assumed high E on top, so every ring landed on the mirror-image
string. Same class of mirror ambiguity as the fretting-hand toggle (0004).

- **Fix:** flipped the canonical v-axis so the default is high-E-at-bottom
  (commit `aa12b8e`), then added a **persisted "flip strings" toggle**
  (`computeHomography(corners, flipStrings)`, commit `0c13d97`) for setups where
  a different mirror/camera/handedness inverts it. Default matches the observed
  orientation; the toggle survives reload.

**Status: not fully live-verified yet.** Confirmed live: calibration + the
upside-down finding. *Pending:* re-checking ring alignment across a spread of
shapes (C, G, D, Em) after the fix, and confirming the green match fires/clears
correctly. Merge to `main` is held until that passes.

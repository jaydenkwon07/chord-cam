# Phase 2 — Fretboard localization + AR fingering overlay (design)

Date: 2026-08-10
Status: approved (design), not yet planned

Phase 1 (fixed-vocab chord recognizer from hand landmarks) shipped to `main` at
95.5% / 97.5% LOTO accuracy. Phase 2 adds the geometry Phase 1 deliberately
skipped: locate the fretboard in the frame, then draw where fingers go for a
chosen chord over the live video, with a live match indicator.

---

## Scope

**In.** Point the self-facing camera at the guitar, calibrate the fretboard once
by dragging 4 corners, pick a target chord from the frozen vocabulary, and see
dashed rings on the *actual* fretboard showing where fingers go — turning
solid/green when the Phase 1 classifier says the current hand shape matches the
target.

**Out (non-goals, on purpose):**

- **No automatic fretboard detection** — no Hough/edge CV, no ML for the guitar
  itself. Manual calibration only. (Auto-detection re-fights the oblique,
  low-contrast, self-facing angle Phase 0 flagged as the hard case, every frame.)
- **No live tracking of a moving guitar** — static assumption + a Recalibrate
  button. Calibrate once with the camera on a stand and the player seated; if it
  drifts, tap Recalibrate and redo the drag.
- **No per-finger verification** — the correctness check is whole-chord, reusing
  Phase 1's `classify_chord`. The rings are a reference diagram; the green state
  is the classifier's opinion of the overall shape.
- **No barre chords / capo / full-neck** — same frozen open-chord vocabulary as
  Phase 1: `C A G E D Em Am Dm`.

## Locked decisions (from brainstorming)

1. **Detection:** one-time manual calibration (drag 4 corners), no ML, no auto CV.
2. **Tracking:** static assumption + manual Recalibrate button. No optical flow.
3. **Feedback:** overlay + live whole-chord correctness check (reuse Phase 1
   `classify_chord`).
4. **Check granularity:** whole-chord match (predicted label vs target), not
   per-finger.
5. **Overlay style:** minimal dashed hollow rings marking target positions,
   solidifying + filling green on match. No finger numbers, no per-finger color
   coding — cleanest over live video, least clutter competing with the real hand.

## Architecture — new seams, Phase 1 untouched

Phase 1's seams (`normalize`, `classify_chord`, `smooth`, `evaluate`) are
unchanged. Phase 2 adds a parallel *geometry* pipeline and reuses the classifier
for the match check.

```
calibration (4 dragged corners) ──► computeHomography() ──► H  (canonical fretboard ⇄ image)
                                                              │
target chord ──► fingering(chord) ──► [{string, fret}, …] ───┤
                                                              ▼
                                                project(cell, H) ──► image-space target dots
                                                              │
                                                              ▼
                                                  drawOverlay(dots, matchState) ──► canvas

live landmarks ──► normalize ──► classify_chord ──► smooth ──► matchState = (predicted === target)
```

### New pure seams (`src/lib/`, vitest-tested)

- **`chords.ts`** — `fingering(chord) -> Fingering`, where
  `Fingering = { frets: { string: number; fret: number }[]; open: number[]; muted: number[] }`.
  A small hand-authored textbook table for the 8 chords. Strings numbered 1–6
  (1 = high E, 6 = low E, by convention); fret 0 is open. Data-first, per project
  discipline (metric/data before geometry before UI).

- **`fretboard.ts`**
  - `computeHomography(corners: Point[4]) -> Mat3` — maps a canonical unit
    fretboard rectangle (nut → fret 3, 6 strings) onto the four image points the
    user dragged. A full projective homography (not affine) so the oblique
    self-facing perspective maps correctly. Solves the standard 8-DOF
    4-point correspondence.
  - `project(cell: { string: number; fret: number }, H: Mat3) -> Point` — maps a
    canonical (string, fret-cell-center) coordinate into image space. Fret
    positions use equal-temperament spacing (fret n at
    `1 − (1/2)^(n/12)` of scale length) baked into the canonical coordinates so
    spacing looks physically right. A fretted finger sits between fret-wires
    (cell center), an open string sits at/behind the nut.
  - `fretGrid(H: Mat3, numFrets: number) -> { strings: Segment[]; frets: Segment[] }`
    — the string and fret line segments in image space, for drawing the
    calibration grid so the user can see the fit while dragging.

### New edge pieces (impure; verified live, not unit-tested)

- **Calibration UI** — 4 draggable corner handles on the canvas (nut-top,
  nut-bottom, fret3-top, fret3-bottom, in mirrored display space). Persists the 4
  points (and derived `H`) to `localStorage` so a mid-session reload keeps
  calibration. A "Recalibrate" button re-enters the drag flow.
- **`drawOverlay`** — canvas rendering, mirrored to match the CSS-flipped video
  (same `translate + scale(-1)` trick as `draw.ts`): dashed hollow rings at the
  target dots, transitioning to solid + green fill on match.

### Third mode

Add an `overlay` mode ("Practice") alongside the existing `capture` / `recognize`
toggle in `App.tsx`. In this mode:

- If not calibrated → show the calibration prompt with 4 draggable handles + a
  "Done" button; the live fret grid previews the current fit.
- Once calibrated → a chord picker (frozen vocab) sets the target; dashed target
  rings render on the fretboard; a live match indicator (driven by the smoothed
  `classify_chord` output) shows target vs predicted.
- A "Recalibrate" button re-enters calibration.

## The correctness check — honest about what "match" means

`matchState = smooth(predictions) === targetChord`, gated on hand-visible and a
confidence floor. Two caveats are load-bearing and belong in the UI copy, not
just here:

- **"Match" means "the current hand shape classifies as the target chord," not
  "every finger is verified on the correct string."** Whole-chord check by
  design; the overlay rings are a reference diagram, the green state is the
  classifier's opinion.
- It **inherits Phase 1's real confusers** (DECISIONS.md 0007) — notably
  **Dm↔Am**. A Dm target can read "match" while the player is actually fretting
  Am. Confidence is shown so this is visible; the UI must not claim the check is
  stricter than it is.

## Error handling / degenerate cases

- **No hand / no fretting hand:** match indicator shows a neutral "—" state
  (reuse the Phase 1 hand-visible gating), rings stay dashed.
- **Not calibrated:** overlay mode routes to the calibration flow; no rings are
  drawn against an undefined `H`.
- **Degenerate calibration** (collinear/coincident corners → non-invertible
  homography): `computeHomography` returns `null`; the UI keeps the user in the
  drag flow with a "move the corners apart" hint rather than drawing garbage.
- **No dataset / classifier null:** match indicator is disabled with the existing
  "record chords in Capture mode first" messaging; the reference rings still draw
  (geometry does not depend on the classifier).

## Testing

- **`chords.ts`:** fingering-table consistency — every vocab chord present, string
  numbers in 1–6, frets in valid range, no string both fretted and listed
  open/muted.
- **`fretboard.ts`:** homography round-trip (projecting the canonical rectangle's
  4 corners through `H` lands back on the 4 input image points within tolerance);
  known-geometry fret-spacing checks; `null` return on degenerate input.
- **Calibration drag + canvas drawing:** verified live in the browser, not
  unit-tested — edge glue, same policy as the MediaPipe layer in Phase 1.

## Build order (data → geometry → UI, per project rules)

1. `chords.ts` fingering table + tests — the data.
2. `fretboard.ts` homography / project / grid + tests — the geometry.
3. Calibration UI (drag 4 corners, store `H`, Recalibrate button).
4. `drawOverlay` — dashed target rings, mirrored.
5. Wire the live match indicator to `classify_chord`.
6. Live verification on the webcam.

## Definition of done — Phase 2

Point the self-facing camera at the guitar, calibrate once by dragging the 4
corners, pick any chord in the frozen vocabulary, and see correctly-placed target
rings on the real fretboard that turn green when the classifier agrees the hand
matches — with the honesty caveats (whole-chord check, inherited confusers)
visible in the UI. Then decide whether Phase 3 is worth it.

# chord-cam

Live-camera guitar chord recognizer. A self-facing camera watches the player;
the app names the chord being fretted, in real time, from the fretting hand's
shape alone. No audio.

This is a for-fun, learn-the-technology project. It is **not** trying to be a
universal any-chord recognizer. The bar is: a small, genuinely working app for
the main open chords, that I understand end to end. More chords come later, or
they don't — either is fine.

The discipline here (seams, eval-first, explicit non-goals) is borrowed from
`omr-transposer`, but deliberately *lighter ceremony*. Don't over-engineer a toy.

---

## Non-goals (say no on purpose)

- **No LLM in the recognition pipeline.** Chord recognition is a computer-vision
  + small-classifier problem. An LLM never reads the hand. (Same spirit as
  omr-transposer's "never use an LLM to read notation from an image.")
- **No audio.** Recognition is from fingering/vision only. Audio could later
  *disambiguate* shape-vs-sounding-chord, but it is out of scope and not a
  crutch we lean on.
- **No barre chords, no full-neck positions, no capo** in phase 1. Fixed
  vocabulary of open chords only.
- **No AR fingering overlay yet.** That is phase 2 and depends on fretboard
  tracking we are explicitly deferring.
- **No native app yet.** Web first. iOS is a later port, not a starting point.
- **No "cover every chord" scope creep.** The vocabulary is frozen per phase.

---

## The honest reality check (read before believing any demo)

- **The self-facing angle is the hard case, chosen on purpose.** A camera facing
  the player sees the *back* of the fretting hand and the fretboard obliquely —
  the view most prone to hiding which fret each fingertip is on. This is the #1
  risk. Phase 0 exists solely to find out if it works at all.
- **Occlusion is the dominant failure mode.** MediaPipe finds the palm first,
  then the 21 keypoints inside it. If the palm is occluded (fingers curling over
  each other, hand wrapping the neck) it can return *nothing* for that frame.
  Expect dropout; design around it (temporal smoothing, ignore no-hand frames).
- **Fingering is not the chord.** The hand shape is a strong *hypothesis*, not
  the sounding chord — vision can't see which strings are strummed or muted, and
  the same shape up the neck is a different chord. So the real task is
  "classify the fretted *shape*," and for a fixed open-chord vocabulary that
  mapping is 1:1. Keep the naming honest.
- **Achievable, at narrow scope.** Prior work classifying ~7 chord types from
  MediaPipe hand-landmark vectors with a small 1D CNN reaches ~97%; visual
  methods over ~14 keys land around ~83%. High accuracy on a *small fixed*
  vocabulary is proven; robust general recognition is not. We live in the
  proven part.

---

## Phase 1 vocabulary (frozen)

Open "cowboy" chords, chosen to be visually distinct shapes:

`C  A  G  E  D  Em  Am  Dm`

Start with 5 (`C G D Em Am`), add the rest once the pipeline works end to end.
Expected confusers to watch in the eval: **C vs. Am** and **E vs. Em** (shapes
are close). The eval, not intuition, decides where effort goes.

---

## Architecture — fixed seams

Phase 1 deliberately skips fretboard localization. We classify the *whole-hand
landmark shape* directly, which needs no string/fret grid. Fretboard geometry is
a phase-2 concern (it's what the AR overlay actually requires).

```
frame ─► detect_hand(frame) ─► landmarks (21 pts, fretting hand only)
                                   │
                                   ▼
                          normalize(landmarks) ─► pose vector (position-invariant)
                                   │
                                   ▼
                        classify_chord(vector) ─► chord label + confidence
                                   │
                                   ▼
                          smooth(labels over N frames) ─► displayed chord

evaluate(preds, truths) ─► per-chord accuracy + confusion matrix
```

Seam contracts (keep these pure and testable; keep MediaPipe/DOM at the edges):

- `detect_hand(frame) -> Landmarks | None` — MediaPipe Tasks HandLandmarker.
  Returns the **fretting hand** only (left hand for a right-handed player; use
  MediaPipe handedness, and remember the webcam feed is mirrored).
- `normalize(landmarks) -> number[]` — **load-bearing.** Raw landmark coords
  depend on where the hand sits in frame and how far away it is. Translate to a
  wrist origin, scale by hand size, (optionally) rotate to a canonical axis, so
  the classifier sees *pose*, not screen position. Garbage here caps everything
  downstream.
- `classify_chord(vector) -> {label, confidence}` — start dumb (KNN or a small
  MLP). Upgrade only if the eval says to.
- `smooth(recent_labels) -> label` — majority vote / debounce over a short window
  so the on-screen label doesn't flicker and no-hand frames don't blank it.
- `evaluate(preds, truths) -> metrics` — per-chord accuracy + confusion matrix.

---

## Build order (non-negotiable)

**Spike → dataset + eval harness → baseline classifier → live wiring → measure.**
The dataset and the metric exist *before* any model is tuned. (Metric-first, same
as omr-transposer.) Do not skip the spike; do not build the classifier before the
capture tool.

---

## Roadmap

- **Phase 0 — Spike (gate).** Webcam feed + MediaPipe hand landmarks overlaid,
  nothing else. Hold the guitar in playing position, camera facing you. Question
  answered: *do the landmarks track the fretting hand usably at this angle?*
  Pass → continue. Fail → adjust camera height/tilt and retry before building
  anything. This is the whole point of phase 0; treat it as a real gate.
- **Phase 1 — Fixed-vocab recognizer (the deliverable).**
  1. Capture tool: hold a chord, tap a key, record a burst of normalized landmark
     vectors labeled with that chord. ~10 min of playing = usable dataset.
  2. Baseline classifier over the vectors (KNN/MLP).
  3. Wire into the live feed: show predicted chord + confidence in real time.
  4. Eval on held-out clips; read the confusion matrix; iterate.
  Done = app names the frozen vocabulary live at a measured, honest accuracy.
- **Phase 2 — Fretboard localization + AR overlay.** Detect strings/frets, track
  them stably, highlight the correct fingering for a preset chord over the live
  video. This needs the geometry that phase 1 skipped.
- **Phase 3 — Stretch.** Tab/sheet input drives the overlay; barre chords; maybe
  audio fusion for shape-vs-sounding disambiguation; iOS port (MediaPipe runs
  there too).

---

## Stack

- **Web-first.** TypeScript, Vite + React.
- **Vision:** MediaPipe Tasks for Web — `HandLandmarker` — over `getUserMedia`.
- **Classifier:** client-side. Start with a hand-rolled KNN or a tiny MLP
  (TensorFlow.js only if/when needed). No server.
- **Data:** self-recorded. Store normalized landmark vectors + labels as JSON.
  21 landmarks × 3 coords = 63-dim raw; normalize before storing.
- **Tests:** vitest on the pure seams (`normalize`, `classify_chord`, `smooth`,
  `evaluate`). The camera and MediaPipe glue stay untested at the edges.
- **Decisions:** a short `DECISIONS.md` log for real forks (angle, normalization
  scheme, classifier choice). Keep it light — this is a toy, not a thesis.

---

## Definition of done — Phase 1

Point the self-facing camera at yourself, fret any chord in the frozen
vocabulary, and the app shows the correct label in real time, with a per-chord
accuracy number you measured on held-out clips (not a vibe). That's it. Ship it,
then decide whether phase 2 is worth it.

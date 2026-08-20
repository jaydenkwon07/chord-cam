import { useCallback, useEffect, useRef, useState } from "react";
import { useHandLandmarker, type Handedness } from "./useHandLandmarker.ts";
import { normalize } from "./lib/normalize.ts";
import {
  mostRecentTakeId,
  takeCountsByChord,
  type ChordCount,
  type Sample,
} from "./lib/dataset.ts";
import { addSamples, clearAll, deleteTake, getAllSamples } from "./lib/db.ts";
import { deserializeDataset, serializeDataset } from "./lib/serialize.ts";
import { createKnnClassifier, type Classifier } from "./lib/knn.ts";
import { useRecognizer } from "./useRecognizer.ts";
import { fingering } from "./lib/chords.ts";
import { computeHomography, fretGrid, project, type Point } from "./lib/fretboard.ts";
import { drawOverlay, type OverlayScene } from "./overlayDraw.ts";
import vocab from "./data/vocabulary.json";

// Phase 1 · Stage A capture tool. Reuses the live feed + landmark detection,
// lets me tag the current fretting-hand shape with a chord label and record a
// burst (one take) of normalized pose vectors into IndexedDB. No classifier yet.

const CHORDS: string[] = vocab.chords;
const CAPTURE_MS = 1500;
const KNN_K = 5;

type Mode = "capture" | "recognize" | "overlay";

const CALIBRATION_KEY = "chord-cam-calibration";
const FLIP_STRINGS_KEY = "chord-cam-flip-strings";
type Corners = [Point, Point, Point, Point]; // nutTop, nutBottom, fret3Top, fret3Bottom (normalized)

const DEFAULT_CORNERS: Corners = [
  { x: 0.3, y: 0.35 },
  { x: 0.3, y: 0.65 },
  { x: 0.7, y: 0.35 },
  { x: 0.7, y: 0.65 },
];

export function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const frettingHandRef = useRef<Handedness>("Left");

  const { status, error, hud, latestRef } = useHandLandmarker(
    videoRef,
    canvasRef,
    frettingHandRef,
  );

  const [mode, setMode] = useState<Mode>("capture");

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

  // Which side of the frame is high E. Default false = high E at the bottom
  // (self-facing playing view); toggle if the overlay strings read upside down.
  const [flipStrings, setFlipStrings] = useState<boolean>(
    () => localStorage.getItem(FLIP_STRINGS_KEY) === "1",
  );
  const flipStringsRef = useRef(flipStrings);
  flipStringsRef.current = flipStrings;
  const toggleFlipStrings = () => {
    setFlipStrings((f) => {
      const next = !f;
      localStorage.setItem(FLIP_STRINGS_KEY, next ? "1" : "0");
      return next;
    });
  };

  const [classifier, setClassifier] = useState<Classifier | null>(null);
  const [trainCount, setTrainCount] = useState(0);
  const recognition = useRecognizer(
    latestRef,
    mode === "recognize" || mode === "overlay" ? classifier : null,
  );

  const [targetChord, setTargetChord] = useState<string>(CHORDS[0]);
  const targetChordRef = useRef(targetChord);
  targetChordRef.current = targetChord;

  const matchedRef = useRef(false);
  matchedRef.current =
    recognition.handVisible && recognition.label === targetChord;

  const [frettingHand, setFrettingHand] = useState<Handedness>("Left");
  const [selectedChord, setSelectedChord] = useState<string>(CHORDS[0]);
  const [recording, setRecording] = useState(false);
  const [counts, setCounts] = useState<Record<string, ChordCount>>({});
  const [totalTakes, setTotalTakes] = useState(0);
  const [lastTake, setLastTake] = useState<{ chord: string; count: number } | null>(
    null,
  );
  const [notice, setNotice] = useState<string | null>(null);

  // Refs the async record loop / key handler read, to dodge stale closures.
  const selectedChordRef = useRef(selectedChord);
  selectedChordRef.current = selectedChord;
  const recordingRef = useRef(false);

  const refreshCounts = useCallback(async () => {
    const all = await getAllSamples();
    const c = takeCountsByChord(all);
    setCounts(c);
    setTotalTakes(
      Object.values(c).reduce((n, v) => n + v.takes, 0),
    );
  }, []);

  useEffect(() => {
    void refreshCounts();
  }, [refreshCounts]);

  // (Re)build the classifier from the recorded dataset when entering Recognize
  // or Practice (Practice reuses the classifier for its live match indicator).
  useEffect(() => {
    if (mode !== "recognize" && mode !== "overlay") return;
    let active = true;
    void getAllSamples().then((all) => {
      if (!active) return;
      setTrainCount(all.length);
      setClassifier(all.length > 0 ? createKnnClassifier(all, KNN_K) : null);
    });
    return () => {
      active = false;
    };
  }, [mode]);

  const recordTake = useCallback(async () => {
    if (recordingRef.current) return;
    recordingRef.current = true;
    setRecording(true);

    const chord = selectedChordRef.current;
    const takeId = `${chord}-${Date.now()}`;
    const collected: Sample[] = [];
    let lastFrame = -1;
    const start = performance.now();

    await new Promise<void>((resolve) => {
      const tick = () => {
        const { landmarks, frameId } = latestRef.current;
        // Dedup: only take each processed frame once, and skip no-hand frames.
        if (landmarks && frameId !== lastFrame) {
          lastFrame = frameId;
          collected.push({
            chord,
            takeId,
            vector: normalize(landmarks),
            timestamp: Date.now(),
          });
        }
        if (performance.now() - start < CAPTURE_MS) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });

    await addSamples(collected);
    await refreshCounts();
    setLastTake({ chord, count: collected.length });
    recordingRef.current = false;
    setRecording(false);
  }, [latestRef, refreshCounts]);

  // Spacebar records a take (natural when your hands are on the guitar).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault();
        void recordTake();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [recordTake]);

  const setHand = (h: Handedness) => {
    setFrettingHand(h);
    frettingHandRef.current = h;
  };

  const startCalibration = () => {
    setCorners((c) => c ?? DEFAULT_CORNERS);
    setCalibrating(true);
  };

  const finishCalibration = () => {
    if (corners) localStorage.setItem(CALIBRATION_KEY, JSON.stringify(corners));
    setCalibrating(false);
  };

  // Entering Practice for the first time (no persisted calibration) auto-seeds
  // the default quad and drops straight into calibrating so handles are on
  // screen immediately, instead of showing drag instructions with nothing to drag.
  useEffect(() => {
    if (mode === "overlay" && cornersRef.current === null) startCalibration();
  }, [mode]);

  // Live overlay draw for Practice mode: projects the calibrated fretboard
  // grid plus the target chord's fretted/open/muted positions, and colors the
  // target rings by whether the live classifier currently agrees.
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
      // Size to the overlay canvas's own displayed box (display pixels), not
      // the video's intrinsic resolution — calibration handles are read back
      // in display-box space, and normalized drawing must share that space or
      // CSS object-fit:cover skews the projected grid off the real fretboard.
      const rect = canvas.getBoundingClientRect();
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);
      if (w > 0 && h > 0 && (canvas.width !== w || canvas.height !== h)) {
        canvas.width = w;
        canvas.height = h;
      }

      const c = cornersRef.current;
      const H = c ? computeHomography(c, flipStringsRef.current) : null;
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
    };
    rafId = requestAnimationFrame(loop);
    return () => {
      active = false;
      cancelAnimationFrame(rafId);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [mode]);

  const onExport = async () => {
    const all = await getAllSamples();
    const blob = new Blob([serializeDataset(all)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `chord-cam-dataset-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setNotice(`Exported ${all.length} samples.`);
  };

  const onImport = async (file: File) => {
    try {
      const restored = deserializeDataset(await file.text());
      await addSamples(restored);
      await refreshCounts();
      setNotice(`Imported ${restored.length} samples.`);
    } catch (err) {
      setNotice(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const onUndoLastTake = async () => {
    const all = await getAllSamples();
    const takeId = mostRecentTakeId(all);
    if (!takeId) {
      setNotice("No takes to undo.");
      return;
    }
    const chord = all.find((s) => s.takeId === takeId)?.chord ?? "?";
    const removed = await deleteTake(takeId);
    await refreshCounts();
    setLastTake(null);
    setNotice(`Undid last take: removed ${removed} samples of ${chord}.`);
  };

  const onClear = async () => {
    if (!confirm("Delete the entire captured dataset? This cannot be undone.")) return;
    await clearAll();
    await refreshCounts();
    setLastTake(null);
    setNotice("Dataset cleared.");
  };

  const fill: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "cover",
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#000",
        overflow: "hidden",
        fontFamily: "system-ui, sans-serif",
        color: "#fff",
      }}
    >
      <video
        ref={videoRef}
        style={{ ...fill, transform: "scaleX(-1)" }}
        muted
        playsInline
      />
      <canvas ref={canvasRef} style={fill} />
      <canvas ref={overlayCanvasRef} style={fill} />

      {/* HUD, top-left */}
      <div style={panel({ top: 12, left: 12 })}>
        <strong>
          chord-cam ·{" "}
          {mode === "capture" ? "Phase 1 · capture" : mode === "recognize" ? "Phase 1 · recognize" : "Phase 2 · practice"}
        </strong>
        <span>FPS: {hud.fps.toFixed(0)}</span>
        <span
          style={{
            ...pill,
            background: hud.frettingHandVisible ? "#0a7d2c" : "#b00020",
          }}
        >
          {hud.frettingHandVisible ? "FRETTING HAND OK" : "NO FRETTING HAND"}
        </span>
        {status === "loading" && <span>Loading model &amp; camera…</span>}
        {status === "error" && (
          <span style={{ color: "#ff8a80" }}>
            Error: {error}
            <br />
            Grant camera access, or switch delegate to &quot;CPU&quot; in
            useHandLandmarker.ts if this mentions GPU/WebGL.
          </span>
        )}
      </div>

      {/* Mode toggle, top center */}
      <div
        style={{
          ...panel({ top: 12, left: "50%" }),
          transform: "translateX(-50%)",
          flexDirection: "row",
          gap: 6,
          padding: 6,
        }}
      >
        {(["capture", "recognize", "overlay"] as Mode[]).map((m) => (
          <button key={m} onClick={() => setMode(m)} style={toggle(mode === m)}>
            {m === "capture" ? "Capture" : m === "recognize" ? "Recognize" : "Practice"}
          </button>
        ))}
      </div>

      {/* Recognize display, centered */}
      {mode === "recognize" && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
            textShadow: "0 2px 12px rgba(0,0,0,0.9)",
          }}
        >
          {classifier === null ? (
            <span style={{ fontSize: 22, background: "rgba(0,0,0,0.6)", padding: "12px 18px", borderRadius: 10 }}>
              {trainCount === 0
                ? "No dataset — record chords in Capture mode first."
                : "Loading classifier…"}
            </span>
          ) : (
            <>
              <span style={{ fontSize: "22vmin", fontWeight: 800, lineHeight: 1 }}>
                {recognition.handVisible ? recognition.label ?? "?" : "—"}
              </span>
              <span style={{ fontSize: 20, marginTop: 8 }}>
                {recognition.handVisible
                  ? `confidence ${(recognition.confidence * 100).toFixed(0)}%`
                  : "no fretting hand"}
              </span>
              <span style={{ ...dim, marginTop: 4 }}>
                KNN k={KNN_K} · {trainCount} samples
              </span>
            </>
          )}
        </div>
      )}

      {/* Capture controls, right side */}
      {mode === "capture" && (
      <div style={{ ...panel({ top: 12, right: 12 }), width: 280, gap: 10 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={dim}>Fretting hand (MediaPipe label)</span>
          <div style={{ display: "flex", gap: 6 }}>
            {(["Left", "Right"] as Handedness[]).map((h) => (
              <button
                key={h}
                onClick={() => setHand(h)}
                style={toggle(frettingHand === h)}
              >
                {h}
              </button>
            ))}
          </div>
        </label>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={dim}>Chord to record</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {CHORDS.map((c) => (
              <button
                key={c}
                onClick={() => setSelectedChord(c)}
                style={toggle(selectedChord === c)}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={() => void recordTake()}
          disabled={recording}
          style={{
            ...bigButton,
            background: recording ? "#8a6d00" : "#1565c0",
            cursor: recording ? "default" : "pointer",
          }}
        >
          {recording
            ? `Recording ${selectedChord}…`
            : `Record ${selectedChord} take  (Space)`}
        </button>
        {lastTake && (
          <span style={dim}>
            Last take: {lastTake.count} samples of {lastTake.chord}
          </span>
        )}
        <button
          onClick={() => void onUndoLastTake()}
          disabled={recording}
          style={{ ...smallButton, alignSelf: "flex-start" }}
        >
          Undo last take
        </button>

        <hr style={{ width: "100%", borderColor: "#333" }} />

        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span style={dim}>Dataset — {totalTakes} takes total</span>
          {CHORDS.map((c) => {
            const cc = counts[c];
            return (
              <span key={c} style={{ fontVariantNumeric: "tabular-nums" }}>
                {c}: {cc?.takes ?? 0} takes · {cc?.samples ?? 0} samples
              </span>
            );
          })}
        </div>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button onClick={() => void onExport()} style={smallButton}>
            Export
          </button>
          <label style={{ ...smallButton, cursor: "pointer" }}>
            Import
            <input
              type="file"
              accept="application/json"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onImport(f);
                e.target.value = "";
              }}
            />
          </label>
          <button
            onClick={() => void onClear()}
            style={{ ...smallButton, background: "#5a1a1a" }}
          >
            Clear
          </button>
        </div>
        {notice && <span style={dim}>{notice}</span>}
      </div>
      )}

      {/* Practice controls, right side */}
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
          <button onClick={toggleFlipStrings} style={smallButton}>
            {flipStrings ? "High E: top ⤒" : "High E: bottom ⤓"} — flip
          </button>
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
                "Match" means your hand shape classifies as {targetChord} — it
                doesn't verify each finger's string. Inherits Phase 1 confusers
                (e.g. Dm/Am).
              </span>
            </>
          )}
        </div>
      )}

      {/* Calibration handles, drawn over the video while calibrating */}
      {mode === "overlay" && calibrating && corners && (
        <>
          {corners.map((c, i) => {
            // 0,1 = nut top/bottom; 2,3 = fret-3 top/bottom (see Corners type).
            const isNut = i < 2;
            return (
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
                  background: isNut ? "rgba(21,101,192,0.8)" : "rgba(230,126,34,0.8)",
                  cursor: "grab",
                  touchAction: "none",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 9,
                  fontWeight: 700,
                  userSelect: "none",
                }}
              >
                {isNut ? "nut" : "3"}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

// --- inline styles (minimal, just enough to be usable) ---

function panel(pos: React.CSSProperties): React.CSSProperties {
  return {
    position: "absolute",
    ...pos,
    display: "flex",
    flexDirection: "column",
    gap: 6,
    padding: "10px 12px",
    borderRadius: 8,
    background: "rgba(0,0,0,0.6)",
    fontSize: 14,
    lineHeight: 1.35,
    maxWidth: "80vw",
  };
}

const dim: React.CSSProperties = { fontSize: 12, color: "#aaa" };

const pill: React.CSSProperties = {
  alignSelf: "flex-start",
  padding: "2px 8px",
  borderRadius: 999,
  fontWeight: 700,
};

function toggle(active: boolean): React.CSSProperties {
  return {
    padding: "6px 12px",
    borderRadius: 6,
    border: "1px solid #444",
    background: active ? "#1565c0" : "#222",
    color: "#fff",
    cursor: "pointer",
    fontWeight: active ? 700 : 400,
  };
}

const bigButton: React.CSSProperties = {
  padding: "12px",
  borderRadius: 8,
  border: "none",
  color: "#fff",
  fontSize: 15,
  fontWeight: 700,
};

const smallButton: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: 6,
  border: "1px solid #444",
  background: "#222",
  color: "#fff",
  cursor: "pointer",
  fontSize: 13,
};

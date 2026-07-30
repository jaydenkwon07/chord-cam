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
import vocab from "./data/vocabulary.json";

// Phase 1 · Stage A capture tool. Reuses the live feed + landmark detection,
// lets me tag the current fretting-hand shape with a chord label and record a
// burst (one take) of normalized pose vectors into IndexedDB. No classifier yet.

const CHORDS: string[] = vocab.chords;
const CAPTURE_MS = 1500;
const KNN_K = 5;

type Mode = "capture" | "recognize";

export function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frettingHandRef = useRef<Handedness>("Left");

  const { status, error, hud, latestRef } = useHandLandmarker(
    videoRef,
    canvasRef,
    frettingHandRef,
  );

  const [mode, setMode] = useState<Mode>("capture");
  const [classifier, setClassifier] = useState<Classifier | null>(null);
  const [trainCount, setTrainCount] = useState(0);
  const recognition = useRecognizer(latestRef, mode === "recognize" ? classifier : null);

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

  // (Re)build the classifier from the recorded dataset when entering Recognize.
  useEffect(() => {
    if (mode !== "recognize") return;
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

      {/* HUD, top-left */}
      <div style={panel({ top: 12, left: 12 })}>
        <strong>chord-cam · Phase 1 · capture</strong>
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
        {(["capture", "recognize"] as Mode[]).map((m) => (
          <button key={m} onClick={() => setMode(m)} style={toggle(mode === m)}>
            {m === "capture" ? "Capture" : "Recognize"}
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

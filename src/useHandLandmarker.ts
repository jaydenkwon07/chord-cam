import { useEffect, useRef, useState } from "react";
import {
  DrawingUtils,
  FilesetResolver,
  HandLandmarker,
} from "@mediapipe/tasks-vision";
import { drawResult, sizeCanvasToVideo, type HandLabel } from "./draw.ts";
import type { Landmark } from "./lib/normalize.ts";

// MediaPipe/camera glue — the "edge" the CLAUDE.md wants kept at arm's length.
// Everything impure (getUserMedia, WASM load, the rAF detect loop, canvas
// drawing) lives here. It draws the overlay, reports a little HUD, and exposes
// the chosen fretting hand's raw landmarks per frame so the capture tool can
// sample them.

// WASM + model pulled from CDN/Google storage: simplest, still no backend.
// Vendor these into /public if offline use is ever wanted (see DECISIONS.md).
const WASM_BASE =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.0/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

export type Status = "loading" | "running" | "error";
export type Handedness = "Left" | "Right";

export interface Hud {
  fps: number;
  hands: HandLabel[];
  handDetected: boolean;
  frettingHandVisible: boolean;
}

// Latest fretting-hand landmarks, tagged with a frame id so consumers can
// dedup: the id only changes when a genuinely new frame was processed.
export interface Latest {
  landmarks: Landmark[] | null;
  frameId: number;
}

// Pick the fretting hand: prefer the hand whose handedness matches, else fall
// back to the single detected hand. Returns the hand index or -1.
function pickFrettingHand(labels: string[], preferred: Handedness): number {
  const match = labels.indexOf(preferred);
  if (match >= 0) return match;
  return labels.length === 1 ? 0 : -1;
}

export function useHandLandmarker(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  frettingHandRef: React.RefObject<Handedness>,
) {
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [hud, setHud] = useState<Hud>({
    fps: 0,
    hands: [],
    handDetected: false,
    frettingHandVisible: false,
  });

  // Written every frame by the loop; HUD is copied into React state on a
  // throttle so 60fps doesn't mean 60 re-renders. latestRef is read directly by
  // the capture tool at frame cadence.
  const hudRef = useRef<Hud>({
    fps: 0,
    hands: [],
    handDetected: false,
    frettingHandVisible: false,
  });
  const latestRef = useRef<Latest>({ landmarks: null, frameId: 0 });

  useEffect(() => {
    let active = true;
    let landmarker: HandLandmarker | null = null;
    let stream: MediaStream | null = null;
    let rafId = 0;
    let hudTimer = 0;

    let lastVideoTime = -1;
    let lastFrameStamp = 0;
    let smoothedFps = 0;
    let lastDetectStamp = 0;
    let frameId = 0;

    async function setup() {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas) return;

      try {
        const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
        if (!active) return;
        landmarker = await HandLandmarker.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath: MODEL_URL,
            // GPU is the fast path; swap to "CPU" if a machine has no WebGL.
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          numHands: 2,
        });
        if (!active) return;

        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user" },
          audio: false,
        });
        if (!active) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        video.srcObject = stream;
        await video.play();

        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Could not get 2D canvas context.");
        const utils = new DrawingUtils(ctx);

        setStatus("running");

        const loop = () => {
          if (!active || !landmarker) return;
          rafId = requestAnimationFrame(loop);

          if (video.readyState < 2) return;
          sizeCanvasToVideo(canvas, video);

          // Only detect on a genuinely new frame, and never with a timestamp
          // <= the last (detectForVideo requires monotonic ms).
          if (video.currentTime === lastVideoTime) return;
          lastVideoTime = video.currentTime;

          let stamp = performance.now();
          if (stamp <= lastDetectStamp) stamp = lastDetectStamp + 1;
          lastDetectStamp = stamp;

          const result = landmarker.detectForVideo(video, stamp);
          drawResult(ctx, utils, result);

          if (lastFrameStamp > 0) {
            const dt = stamp - lastFrameStamp;
            if (dt > 0) {
              const inst = 1000 / dt;
              smoothedFps = smoothedFps === 0 ? inst : smoothedFps * 0.9 + inst * 0.1;
            }
          }
          lastFrameStamp = stamp;

          const labels = result.handedness.map((h) => h[0]?.categoryName ?? "?");
          const chosen = pickFrettingHand(labels, frettingHandRef.current);
          frameId++;
          latestRef.current = {
            frameId,
            landmarks:
              chosen >= 0
                ? result.landmarks[chosen].map((p) => ({ x: p.x, y: p.y, z: p.z }))
                : null,
          };

          hudRef.current = {
            fps: smoothedFps,
            handDetected: result.landmarks.length > 0,
            frettingHandVisible: chosen >= 0,
            hands: result.handedness.map((h) => ({
              handedness: h[0]?.categoryName ?? "?",
              score: h[0]?.score ?? 0,
            })),
          };
        };
        rafId = requestAnimationFrame(loop);

        hudTimer = window.setInterval(() => {
          if (active) setHud(hudRef.current);
        }, 100);
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : String(err));
        setStatus("error");
      }
    }

    setup();

    return () => {
      active = false;
      cancelAnimationFrame(rafId);
      clearInterval(hudTimer);
      stream?.getTracks().forEach((t) => t.stop());
      landmarker?.close();
    };
  }, [videoRef, canvasRef, frettingHandRef]);

  return { status, error, hud, latestRef };
}

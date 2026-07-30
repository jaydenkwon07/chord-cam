import { useEffect, useRef, useState } from "react";
import { normalize } from "./lib/normalize.ts";
import { smooth } from "./lib/smooth.ts";
import type { Classifier } from "./lib/knn.ts";
import type { Latest } from "./useHandLandmarker.ts";

// Live recognition loop: reads the fretting hand landmarks the camera hook
// publishes, classifies each fresh frame, and majority-smooths over a short
// window. Low-confidence and no-hand frames become "no vote" (null) so the
// display shows "?" instead of guessing.

const WINDOW = 8;
const CONFIDENCE_THRESHOLD = 0.6; // for k=5: require >=3/5 neighbours to agree

export interface Recognition {
  label: string | null; // smoothed; null -> show "?"
  confidence: number; // latest raw vote fraction
  handVisible: boolean;
}

export function useRecognizer(
  latestRef: React.RefObject<Latest>,
  classifier: Classifier | null,
): Recognition {
  const [display, setDisplay] = useState<Recognition>({
    label: null,
    confidence: 0,
    handVisible: false,
  });
  const stateRef = useRef<Recognition>(display);

  useEffect(() => {
    if (!classifier) return;
    let active = true;
    let rafId = 0;
    let lastFrame = -1;
    const buffer: (string | null)[] = [];

    const loop = () => {
      if (!active) return;
      rafId = requestAnimationFrame(loop);

      const { landmarks, frameId } = latestRef.current;
      if (frameId === lastFrame) return; // dedup: only score fresh frames
      lastFrame = frameId;

      let confidence = 0;
      let vote: string | null = null;
      if (landmarks) {
        const p = classifier.classify(normalize(landmarks));
        confidence = p.confidence;
        vote = p.confidence >= CONFIDENCE_THRESHOLD ? p.label : null;
      }
      buffer.push(vote);
      if (buffer.length > WINDOW) buffer.shift();

      stateRef.current = {
        label: smooth(buffer),
        confidence,
        handVisible: landmarks !== null,
      };
    };
    rafId = requestAnimationFrame(loop);

    const timer = window.setInterval(() => {
      if (active) setDisplay(stateRef.current);
    }, 100);

    return () => {
      active = false;
      cancelAnimationFrame(rafId);
      clearInterval(timer);
    };
  }, [classifier, latestRef]);

  return display;
}

import {
  DrawingUtils,
  HandLandmarker,
  type HandLandmarkerResult,
} from "@mediapipe/tasks-vision";

// Phase 0 draw helper: overlay the 21 landmarks + standard connections on a
// canvas that sits on top of the CSS-mirrored video. The video is flipped for
// display only, so we mirror the drawing here (translate + scale(-1)) to line
// the overlay up with what the player sees. Per-hand text labels are drawn
// AFTER restoring the transform so they stay readable, anchored at the
// mirrored wrist position.

export interface HandLabel {
  handedness: string;
  score: number;
}

export function sizeCanvasToVideo(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
): void {
  if (
    canvas.width !== video.videoWidth ||
    canvas.height !== video.videoHeight
  ) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
  }
}

export function drawResult(
  ctx: CanvasRenderingContext2D,
  utils: DrawingUtils,
  result: HandLandmarkerResult,
): void {
  const { width, height } = ctx.canvas;
  ctx.clearRect(0, 0, width, height);

  // Mirror the landmark/connection drawing to match the flipped video.
  ctx.save();
  ctx.translate(width, 0);
  ctx.scale(-1, 1);
  for (const landmarks of result.landmarks) {
    utils.drawConnectors(landmarks, HandLandmarker.HAND_CONNECTIONS, {
      color: "#00e5ff",
      lineWidth: 4,
    });
    utils.drawLandmarks(landmarks, {
      color: "#ff2d55",
      lineWidth: 1,
      radius: 4,
    });
  }
  ctx.restore();

  // Text labels: un-mirrored so they read normally, but positioned at the
  // mirrored wrist (landmark 0) so each label tracks its hand.
  ctx.font = `${Math.round(height * 0.035)}px system-ui, sans-serif`;
  ctx.textBaseline = "bottom";
  for (let i = 0; i < result.landmarks.length; i++) {
    const wrist = result.landmarks[i][0];
    const handedness = result.handedness[i]?.[0];
    if (!wrist || !handedness) continue;
    const x = (1 - wrist.x) * width;
    const y = wrist.y * height;
    const label = `${handedness.categoryName} ${(handedness.score * 100).toFixed(0)}%`;
    const pad = 6;
    const metrics = ctx.measureText(label);
    ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
    ctx.fillRect(x, y - height * 0.045, metrics.width + pad * 2, height * 0.045);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(label, x + pad, y);
  }
}

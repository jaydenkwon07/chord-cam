import type { Point, Segment } from "./lib/fretboard.ts";

// Overlay renderer for Practice mode. Draws in normalized display coords scaled
// to the canvas; the overlay canvas sits above the (CSS-mirrored) video and the
// landmark canvas, and is NOT itself mirrored — calibration corners are captured
// in display space, so everything derived from them is already display-aligned.

export interface OverlayScene {
  grid: { strings: Segment[]; frets: Segment[] } | null;
  targets: Point[]; // fretted-position ring centres, normalized
  openMarkers: Point[]; // nut-edge circle markers, normalized
  mutedMarkers: Point[]; // nut-edge cross markers, normalized
  matched: boolean; // classifier agrees the current shape == target
}

const RING_RADIUS_PX = 16;

export function drawOverlay(ctx: CanvasRenderingContext2D, scene: OverlayScene): void {
  const { width, height } = ctx.canvas;
  ctx.clearRect(0, 0, width, height);
  const px = (p: Point) => ({ x: p.x * width, y: p.y * height });

  // Faint fret/string grid.
  if (scene.grid) {
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    for (const seg of [...scene.grid.strings, ...scene.grid.frets]) {
      const a = px(seg.a);
      const b = px(seg.b);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }

  // Target rings: dashed hollow while unmatched, solid green fill when matched.
  ctx.strokeStyle = scene.matched ? "#22c55e" : "#e5e5e5";
  ctx.lineWidth = 3;
  ctx.setLineDash(scene.matched ? [] : [6, 4]);
  for (const t of scene.targets) {
    const c = px(t);
    ctx.beginPath();
    ctx.arc(c.x, c.y, RING_RADIUS_PX, 0, Math.PI * 2);
    if (scene.matched) {
      ctx.fillStyle = "rgba(34,197,94,0.35)";
      ctx.fill();
    }
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // Open (circle) and muted (cross) markers at the nut.
  ctx.font = `${Math.round(height * 0.03)}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#cfcfcf";
  for (const o of scene.openMarkers) {
    const c = px(o);
    ctx.fillText("○", c.x, c.y); // ○
  }
  ctx.fillStyle = "#ff6b6b";
  for (const m of scene.mutedMarkers) {
    const c = px(m);
    ctx.fillText("✕", c.x, c.y); // ✕
  }
}

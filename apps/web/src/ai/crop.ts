import type { Stroke } from "@sketch/core";
export function cropStrokes(strokes: Stroke[]) {
  const points = strokes.flatMap((s) => s.points);
  if (!points.length) throw Error("请先画几笔");
  const left = Math.max(0, Math.min(...points.map((p) => p[0])) - 0.15),
    right = Math.min(12, Math.max(...points.map((p) => p[0])) + 0.15),
    bottom = Math.max(0, Math.min(...points.map((p) => p[1])) - 0.15),
    top = Math.min(8, Math.max(...points.map((p) => p[1])) + 0.15);
  const width = right - left,
    height = top - bottom,
    scale = 1024 / Math.max(width, height),
    canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "#263d32";
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  strokes.forEach((stroke, i) => {
    ctx.beginPath();
    stroke.points.forEach((p, j) => {
      const x = (p[0] - left) * scale,
        y = (top - p[1]) * scale;
      j ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.stroke();
    const start = stroke.points[0];
    ctx.fillStyle = "#9b7150";
    ctx.font = "12px sans-serif";
    ctx.fillText(
      stroke.id,
      (start[0] - left) * scale + 4,
      (top - start[1]) * scale + 14,
    );
  });
  return {
    image: canvas.toDataURL("image/png"),
    crop: { x: left, y: top, width, height },
  };
}

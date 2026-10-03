// One-time: cut the presenter out of his plain photo background (for thumbnails), with soft edges.
// Usage: node scripts/make-presenter-cutout.js   → assets/presenter/cutout.png
import fs from "node:fs";
import path from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { presenterPhoto } from "./lib/presenter.js";

const src = presenterPhoto();
if (!src) { console.error("No photo in assets/presenter/"); process.exit(1); }
const img = await loadImage(fs.readFileSync(src));
const W = img.width, H = img.height;
const c = createCanvas(W, H), ctx = c.getContext("2d");
ctx.drawImage(img, 0, 0);
const data = ctx.getImageData(0, 0, W, H);
const px = data.data;

// Background colour = average of the top corners; flood-fill from every edge pixel that looks like it.
const sample = (x, y) => { const i = (y * W + x) * 4; return [px[i], px[i + 1], px[i + 2]]; };
const corners = [sample(5, 5), sample(W - 6, 5), sample(5, Math.floor(H / 3)), sample(W - 6, Math.floor(H / 3))];
const bg = [0, 1, 2].map((k) => corners.reduce((s, c) => s + c[k], 0) / corners.length);
const dist = (i) => Math.hypot(px[i] - bg[0], px[i + 1] - bg[1], px[i + 2] - bg[2]);
const TOL = 34;
// Scan inwards from the left, right and top edges, stopping at the first pixel that isn't background.
// (A flood fill can leak through thin gaps into the clothes; edge scans can't.)
const isBg = new Uint8Array(W * H);
const bgAt = (x, y) => dist((y * W + x) * 4) <= TOL;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W && bgAt(x, y); x++) isBg[y * W + x] = 1;
  for (let x = W - 1; x >= 0 && bgAt(x, y); x--) isBg[y * W + x] = 1;
}
for (let x = 0; x < W; x++) for (let y = 0; y < H && bgAt(x, y); y++) isBg[y * W + x] = 1;
// Soft edge: alpha from the distance to the nearest background pixel (3 px feather).
const alpha = new Float32Array(W * H).fill(1);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const p = y * W + x;
  if (isBg[p]) { alpha[p] = 0; continue; }
  let near = 0;
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
    const q = (y + dy) * W + (x + dx);
    if (y + dy >= 0 && y + dy < H && x + dx >= 0 && x + dx < W && isBg[q]) near = Math.max(near, 1 - Math.hypot(dx, dy) / 4.3);
  }
  alpha[p] = 1 - near * 0.85;
}
for (let p = 0; p < W * H; p++) px[p * 4 + 3] = Math.round(alpha[p] * 255);
ctx.putImageData(data, 0, 0);
const out = path.join(path.dirname(src), "cutout.png");
fs.writeFileSync(out, c.toBuffer("image/png"));
console.log(`✔ ${path.relative(process.cwd(), out)} (${W}x${H}, background ${bg.map(Math.round).join(",")}, ${Math.round((isBg.reduce((a, b) => a + b, 0) / (W * H)) * 100)}% removed)`);

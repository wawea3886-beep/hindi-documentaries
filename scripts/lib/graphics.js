// All on-screen text is drawn here with Skia (@napi-rs/canvas), which shapes Hindi (Devanagari) correctly.
// FFmpeg's own subtitle renderer puts Hindi vowel signs in the wrong place, so we never use it for text.
import fs from "node:fs";
import path from "node:path";
import { createCanvas, GlobalFonts, loadImage } from "@napi-rs/canvas";
import config from "../../config.js";
import { FONTS_DIR } from "./util.js";

GlobalFonts.registerFromPath(path.join(FONTS_DIR, "Mukta-ExtraBold.ttf"), "MuktaXB");
GlobalFonts.registerFromPath(path.join(FONTS_DIR, "Mukta-SemiBold.ttf"), "MuktaSB");
GlobalFonts.registerFromPath(path.join(FONTS_DIR, "Anton-Regular.ttf"), "Anton");

const YELLOW = "#FFD400", RED = "#E53935";
const isHindi = (s) => /[ऀ-ॿ]/.test(s);
const headFont = (s, px) => (isHindi(s) ? `${px}px MuktaXB` : `${px}px Anton`);

function save(canvas, out) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const type = out.endsWith(".png") ? "image/png" : "image/jpeg";
  fs.writeFileSync(out, type === "image/png" ? canvas.toBuffer(type) : canvas.toBuffer(type, 90));
  return out;
}

function wrap(ctx, text, maxWidth) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = w; } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

/** Largest font size (≤ max) at which `text` fits in `maxLines` lines of `maxWidth`. */
function fit(ctx, text, fontFn, max, min, maxWidth, maxLines) {
  for (let px = max; px >= min; px -= 4) {
    ctx.font = fontFn(px);
    const lines = wrap(ctx, text, maxWidth);
    if (lines.length <= maxLines && lines.every((l) => ctx.measureText(l).width <= maxWidth)) return { px, lines };
  }
  ctx.font = fontFn(min);
  return { px: min, lines: wrap(ctx, text, maxWidth).slice(0, maxLines) };
}

function outlined(ctx, text, x, y, fill, stroke = "#000", width = 10) {
  ctx.lineJoin = "round";
  ctx.lineWidth = width;
  ctx.strokeStyle = stroke;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

function cover(ctx, img, w, h) {
  const s = Math.max(w / img.width, h / img.height);
  ctx.drawImage(img, (w - img.width * s) / 2, (h - img.height * s) / 2, img.width * s, img.height * s);
}

async function blurredBackground(ctx, w, h, bgImage) {
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, "#0b1020");
  g.addColorStop(1, "#1f2a44");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  if (bgImage && fs.existsSync(bgImage)) {
    try {
      const img = await loadImage(fs.readFileSync(bgImage));
      ctx.save();
      ctx.filter = "blur(28px) brightness(0.45)";
      cover(ctx, img, w, h);
      ctx.restore();
    } catch { /* keep the gradient */ }
  }
  const v = ctx.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, w * 0.75);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);
}

/** Full-screen fact card: big date/number/quote. */
export async function renderCard({ title, text = "" }, out, { w = 1920, h = 1080, bgImage } = {}) {
  const c = createCanvas(w, h), ctx = c.getContext("2d");
  await blurredBackground(ctx, w, h, bgImage);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const t = fit(ctx, title, (px) => headFont(title, px), Math.round(h * 0.17), 60, w * 0.84, 2);
  const lh = t.px * 1.15;
  const sub = text ? fit(ctx, text, (px) => `${px}px MuktaSB`, Math.round(h * 0.065), 32, w * 0.8, 2) : null;
  const total = t.lines.length * lh + (sub ? 40 + sub.lines.length * sub.px * 1.35 : 0);
  let y = h / 2 - total / 2 + lh / 2;
  ctx.font = headFont(title, t.px);
  for (const l of t.lines) { outlined(ctx, l, w / 2, y, YELLOW, "#000", Math.max(6, t.px / 12)); y += lh; }
  ctx.fillStyle = RED;
  ctx.fillRect(w / 2 - 90, y - lh / 2 + 14, 180, 8);
  if (sub) {
    y += 40 + (sub.px * 1.35) / 2 - lh / 2 + 16;
    ctx.font = `${sub.px}px MuktaSB`;
    for (const l of sub.lines) { outlined(ctx, l, w / 2, y, "#fff", "#000", 6); y += sub.px * 1.35; }
  }
  return save(c, out);
}

/** Lower-third chapter title (transparent PNG over the video). `title` big, `subtitle` small underneath. */
export function renderChapterOverlay({ number, title, subtitle }, out, opts) {
  return chapterOverlay({ number, titleHi: title, titleEn: subtitle }, out, opts);
}

function chapterOverlay({ number, titleHi, titleEn }, out, { w = 1920, h = 1080 } = {}) {
  const c = createCanvas(w, h), ctx = c.getContext("2d");
  const g = ctx.createLinearGradient(0, h - 380, 0, h);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(0,0,0,0.85)");
  ctx.fillStyle = g;
  ctx.fillRect(0, h - 380, w, 380);
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = RED;
  ctx.fillRect(90, h - 250, 10, 170);
  ctx.font = "44px Anton";
  ctx.fillStyle = YELLOW;
  ctx.fillText(`CHAPTER ${number}`, 130, h - 205);
  const t = fit(ctx, titleHi || titleEn, (px) => headFont(titleHi || titleEn, px), 84, 48, w - 260, 1);
  ctx.font = headFont(titleHi || titleEn, t.px);
  outlined(ctx, t.lines[0], 130, h - 125, "#fff", "rgba(0,0,0,0.6)", 6);
  if (titleHi && titleEn) {
    ctx.font = "40px MuktaSB";
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.fillText(titleEn, 132, h - 72);
  }
  return save(c, out);
}

/** Key words popping up like a highlighter (transparent PNG), lower centre of the frame. */
export function renderHighlight(text, out, { w = 1920, h = 1080 } = {}) {
  const c = createCanvas(w, h), ctx = c.getContext("2d");
  const t = text.toUpperCase();
  const f = fit(ctx, t, (px) => headFont(t, px), 92, 50, w - 400, 1);
  ctx.font = headFont(t, f.px);
  const tw = ctx.measureText(t).width;
  const by = h - 330, bh = f.px * 1.35;
  ctx.save();
  ctx.translate(w / 2, by + bh / 2);
  ctx.rotate(-0.02);
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillRect(-tw / 2 - 26, -bh / 2 + 10, tw + 68, bh);
  ctx.fillStyle = YELLOW;
  ctx.fillRect(-tw / 2 - 34, -bh / 2, tw + 68, bh);
  ctx.fillStyle = "#111";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(t, 0, 4);
  ctx.restore();
  return save(c, out);
}

/** Background for scenes with the host: dark studio, a framed "screen" on the right, chapter label above it. */
export function renderStudio({ label = "", title = "" }, out, { w = 1920, h = 1080, screen, panel } = {}) {
  const c = createCanvas(w, h), ctx = c.getContext("2d");
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, "#0a0f1c");
  g.addColorStop(1, "#1a2440");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(255,255,255,0.04)";
  for (let x = 0; x < w; x += 60) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x - 300, h); ctx.stroke(); }
  const glow = ctx.createRadialGradient(420, 620, 50, 420, 620, 620);
  glow.addColorStop(0, "rgba(229,57,53,0.22)");
  glow.addColorStop(1, "rgba(229,57,53,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);
  const { x, y, sw, sh } = screen;
  const boxes = [[x, y, sw, sh]];
  if (panel) boxes.push([panel.x, panel.y, panel.w, panel.h]); // frame for the real presenter
  for (const [bx, byy, bw, bh] of boxes) {
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(bx + 14, byy + 18, bw, bh);
    ctx.strokeStyle = YELLOW;
    ctx.lineWidth = 6;
    ctx.strokeRect(bx - 3, byy - 3, bw + 6, bh + 6);
  }
  ctx.textBaseline = "alphabetic";
  if (label) { ctx.font = "38px Anton"; ctx.fillStyle = RED; ctx.fillText(label.toUpperCase(), x, y - (title ? 88 : 22)); }
  if (title) {
    const f = fit(ctx, title, (px) => headFont(title, px), 60, 34, sw, 1);
    ctx.font = headFont(title, f.px);
    outlined(ctx, f.lines[0], x, y - 18, "#fff", "rgba(0,0,0,0.5)", 5);
  }
  ctx.font = "34px Anton";
  ctx.fillStyle = "rgba(255,212,0,0.85)";
  ctx.fillText(config.siteName.toUpperCase(), 60, 80);
  return save(c, out);
}

/** Small "Photo: … / licence" credit, bottom-right (transparent PNG). */
export function renderCredit(text, out, { w = 1920, h = 1080 } = {}) {
  const c = createCanvas(w, h), ctx = c.getContext("2d");
  ctx.font = "26px MuktaSB";
  const tw = Math.min(ctx.measureText(text).width, w - 80);
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(w - tw - 56, h - 64, tw + 36, 44);
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.textBaseline = "middle";
  ctx.fillText(text, w - tw - 38, h - 42, w - 80);
  return save(c, out);
}

/** Used when no AI picture could be made: dark cinematic frame with the chapter title. */
export async function renderFallback(label, out, { w = 1920, h = 1080 } = {}) {
  const c = createCanvas(w, h), ctx = c.getContext("2d");
  await blurredBackground(ctx, w, h);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const t = fit(ctx, label, (px) => headFont(label, px), 110, 50, w * 0.8, 2);
  ctx.font = headFont(label, t.px);
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  t.lines.forEach((l, i) => ctx.fillText(l, w / 2, h / 2 + (i - (t.lines.length - 1) / 2) * t.px * 1.2));
  return save(c, out);
}

/** YouTube thumbnail 1280x720: dramatic picture + huge 2-line text + the presenter (photo) or the animated host. */
export async function renderThumbnail({ image, text, host = true, photo = null, cutout = null }, out) {
  if (cutout && fs.existsSync(cutout)) return explainerThumbnail({ image, text, cutout }, out);
  const w = 1280, h = 720;
  const c = createCanvas(w, h), ctx = c.getContext("2d");
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, w, h);
  if (image && fs.existsSync(image)) cover(ctx, await loadImage(fs.readFileSync(image)), w, h);
  if (photo && fs.existsSync(photo)) {
    // The real presenter on the right, fading into the picture on its left edge.
    const img = await loadImage(fs.readFileSync(photo));
    const pw = 470, ph = h;
    const pc = createCanvas(pw, ph), p = pc.getContext("2d");
    const s = Math.max(pw / img.width, ph / img.height);
    p.drawImage(img, (pw - img.width * s) / 2, (ph - img.height * s) * 0.15, img.width * s, img.height * s);
    const fade = p.createLinearGradient(0, 0, 90, 0);
    fade.addColorStop(0, "rgba(0,0,0,1)");
    fade.addColorStop(1, "rgba(0,0,0,0)");
    p.globalCompositeOperation = "destination-out";
    p.fillStyle = fade;
    p.fillRect(0, 0, 90, ph);
    ctx.drawImage(pc, w - pw, 0);
  } else if (host) {
    const { drawHost } = await import("./host.js");
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.7)";
    ctx.shadowBlur = 40;
    ctx.translate(w - 420, h - 470);
    ctx.scale(0.47, 0.47);
    drawHost(ctx, { mouth: "o", eyes: "wide" });
    ctx.restore();
  }
  const g = ctx.createLinearGradient(0, 0, w * 0.75, 0);
  g.addColorStop(0, "rgba(0,0,0,0.88)");
  g.addColorStop(0.55, "rgba(0,0,0,0.45)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const words = (text || "").toUpperCase().split(/\s+/).filter(Boolean);
  const half = Math.ceil(words.length / 2);
  const lines = words.length > 2 ? [words.slice(0, half).join(" "), words.slice(half).join(" ")] : words;
  ctx.textBaseline = "alphabetic";
  let y = h / 2 - ((lines.length - 1) * 150) / 2 + 55;
  lines.forEach((l, i) => {
    const f = fit(ctx, l, (px) => headFont(l, px), 170, 70, 720, 1);
    ctx.font = headFont(l, f.px);
    if (i === lines.length - 1) {
      const tw = ctx.measureText(l).width;
      ctx.fillStyle = RED;
      ctx.fillRect(40, y - f.px * 0.92, tw + 40, f.px * 1.08);
      outlined(ctx, l, 60, y, "#fff", "#000", 8);
    } else outlined(ctx, l, 60, y, YELLOW, "#000", 12);
    y += 165;
  });
  return save(c, out);
}

/**
 * Big-explainer-channel thumbnail: vivid topic picture, the presenter cut out large on the right with a white rim,
 * and 1-3 huge words at the top — the last part in a red box.
 */
async function explainerThumbnail({ image, text, cutout }, out) {
  const w = 1280, h = 720;
  const c = createCanvas(w, h), ctx = c.getContext("2d");
  ctx.fillStyle = "#101418";
  ctx.fillRect(0, 0, w, h);
  if (image && fs.existsSync(image)) {
    const bg = await loadImage(fs.readFileSync(image));
    const s = Math.max(w / bg.width, h / bg.height);
    // Tall photos: keep the upper part (faces/subjects), not the middle.
    const y = bg.height > bg.width ? (h - bg.height * s) * 0.12 : (h - bg.height * s) / 2;
    ctx.save();
    ctx.filter = "saturate(1.45) contrast(1.18) brightness(1.02)";
    ctx.drawImage(bg, (w - bg.width * s) / 2, y, bg.width * s, bg.height * s);
    ctx.restore();
  }
  // Vignette + darker top band so the words always read.
  const v = ctx.createRadialGradient(w * 0.38, h * 0.6, h * 0.25, w * 0.45, h * 0.55, w * 0.85);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(0,0,0,0.6)");
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);
  const top = ctx.createLinearGradient(0, 0, 0, h * 0.5);
  top.addColorStop(0, "rgba(0,0,0,0.55)");
  top.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, w, h * 0.5);

  // Presenter: large on the right, white rim + shadow so he pops off the background.
  const person = await loadImage(fs.readFileSync(cutout));
  const ph = h * 1.08, pw = (person.width / person.height) * ph;
  const px = w - pw * 0.9, py = h * 0.04;
  const rim = createCanvas(Math.ceil(pw), Math.ceil(ph)), r = rim.getContext("2d");
  r.drawImage(person, 0, 0, pw, ph);
  r.globalCompositeOperation = "source-in";
  r.fillStyle = "#ffffff";
  r.fillRect(0, 0, pw, ph);
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.85)";
  ctx.shadowBlur = 45;
  for (const [dx, dy] of [[-6, 0], [6, 0], [0, -6], [0, 6], [-4, -4], [4, -4]]) ctx.drawImage(rim, px + dx, py + dy);
  ctx.restore();
  ctx.save();
  ctx.filter = "contrast(1.08) saturate(1.1)";
  ctx.drawImage(person, px, py, pw, ph);
  ctx.restore();

  // Words: line 1 white, last line white-on-red box (or yellow when it's a single short word).
  const words = (text || "").toUpperCase().split(/\s+/).filter(Boolean).slice(0, 5);
  const lines = words.length >= 3 ? [words.slice(0, Math.ceil(words.length / 2)).join(" "), words.slice(Math.ceil(words.length / 2)).join(" ")]
    : words.length === 2 ? [words[0], words[1]] : words;
  const maxW = px - 60;
  ctx.textBaseline = "alphabetic";
  let y = 30;
  lines.forEach((l, i) => {
    const last = i === lines.length - 1 && lines.length > 1;
    const f = fit(ctx, l, (px2) => headFont(l, px2), last ? 150 : 170, 70, maxW - (last ? 40 : 0), 1);
    ctx.font = headFont(l, f.px);
    y += f.px * (i === 0 ? 1.0 : 1.08);
    if (last) {
      const tw = ctx.measureText(l).width;
      ctx.save();
      ctx.translate(40, y);
      ctx.rotate(-0.02);
      ctx.fillStyle = RED;
      ctx.shadowColor = "rgba(0,0,0,0.6)";
      ctx.shadowBlur = 20;
      ctx.fillRect(-12, -f.px * 0.9, tw + 44, f.px * 1.06);
      ctx.restore();
      outlined(ctx, l, 50, y, "#fff", "rgba(0,0,0,0.65)", 6);
    } else {
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.8)";
      ctx.shadowBlur = 25;
      outlined(ctx, l, 40, y, lines.length === 1 ? YELLOW : "#fff", "#000", 14);
      ctx.restore();
    }
    y += 12;
  });
  return save(c, out);
}

/** Shorts frame overlay: hook headline on top + channel name at the bottom (transparent PNG). */
export function renderShortOverlay(hook, out, { w = 1080, h = 1920 } = {}) {
  const c = createCanvas(w, h), ctx = c.getContext("2d");
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const t = fit(ctx, hook, (px) => headFont(hook, px), 80, 48, w - 140, 2);
  ctx.font = headFont(hook, t.px);
  const lh = t.px * 1.3;
  const boxH = t.lines.length * lh + 36;
  const cy = 300;
  ctx.fillStyle = RED;
  ctx.beginPath();
  ctx.roundRect(50, cy - boxH / 2, w - 100, boxH, 28);
  ctx.fill();
  t.lines.forEach((l, i) => outlined(ctx, l, w / 2, cy - ((t.lines.length - 1) * lh) / 2 + i * lh, "#fff", "rgba(0,0,0,0.5)", 6));
  ctx.font = "40px Anton";
  outlined(ctx, config.siteName.toUpperCase(), w / 2, 100, YELLOW, "#000", 8);
  return save(c, out);
}

/** One karaoke caption frame for Shorts: `words` with word `active` highlighted (transparent PNG). */
export function renderCaption(words, active, out, { w = 1080, h = 380 } = {}) {
  const c = createCanvas(w, h), ctx = c.getContext("2d");
  const text = words.join(" ");
  const f = fit(ctx, text, (px) => `${px}px MuktaXB`, 92, 56, w - 120, 2);
  ctx.font = `${f.px}px MuktaXB`;
  ctx.textBaseline = "middle";
  const space = ctx.measureText(" ").width;
  const lh = f.px * 1.35;
  let wi = 0;
  f.lines.forEach((line, li) => {
    const lw = line.split(" ");
    let x = (w - ctx.measureText(line).width) / 2;
    const y = h / 2 - ((f.lines.length - 1) * lh) / 2 + li * lh;
    for (const word of lw) {
      outlined(ctx, word, x, y, wi === active ? YELLOW : "#fff", "#000", 14);
      x += ctx.measureText(word).width + space;
      wi++;
    }
  });
  return save(c, out);
}

export function renderBlank(out, w, h) {
  return save(createCanvas(w, h), out);
}

// The channel's animated host: an original illustrated presenter drawn in code (so he looks identical in every video).
// His mouth follows the loudness of the narration, he blinks and tilts his head slightly.
// He is a fictional character — deliberately NOT modelled on any real person.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createCanvas } from "@napi-rs/canvas";
import ffmpegPath from "ffmpeg-static";

export const HOST_W = 900, HOST_H = 1000;
const SKIN = "#b97a4f", SKIN_SHADE = "#9c6440", HAIR = "#17110d", BEARD = "#231812", JACKET = "#1d2740", JACKET_DARK = "#141b2e";

function ellipse(ctx, x, y, rx, ry, fill) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

/**
 * Draw the host. mouth: 0 closed · 1 half · 2 open · "o" shocked. eyes: "open" | "closed" | "wide". tilt in degrees.
 */
export function drawHost(ctx, { mouth = 0, eyes = "open", tilt = 0, brows = 0 } = {}) {
  ctx.save();
  // Body (doesn't tilt)
  ctx.fillStyle = JACKET;
  ctx.beginPath();
  ctx.moveTo(90, HOST_H);
  ctx.bezierCurveTo(100, 850, 170, 790, 330, 745);
  ctx.lineTo(570, 745);
  ctx.bezierCurveTo(730, 790, 800, 850, 810, HOST_H);
  ctx.closePath();
  ctx.fill();
  // Shirt V + collar
  ctx.fillStyle = "#e9e6df";
  ctx.beginPath(); ctx.moveTo(375, 735); ctx.lineTo(525, 735); ctx.lineTo(450, 880); ctx.closePath(); ctx.fill();
  ctx.fillStyle = JACKET_DARK;
  ctx.beginPath(); ctx.moveTo(330, 745); ctx.lineTo(385, 735); ctx.lineTo(450, 890); ctx.lineTo(405, 1000); ctx.lineTo(300, 1000); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(570, 745); ctx.lineTo(515, 735); ctx.lineTo(450, 890); ctx.lineTo(495, 1000); ctx.lineTo(600, 1000); ctx.closePath(); ctx.fill();
  // Neck
  ctx.fillStyle = SKIN_SHADE;
  ctx.fillRect(398, 600, 104, 150);
  ctx.beginPath(); ctx.moveTo(398, 735); ctx.lineTo(450, 790); ctx.lineTo(502, 735); ctx.closePath(); ctx.fill();

  // Head group tilts around the neck
  ctx.translate(450, 700);
  ctx.rotate((tilt * Math.PI) / 180);
  ctx.translate(-450, -700);

  ellipse(ctx, 288, 455, 28, 50, SKIN_SHADE); // ears
  ellipse(ctx, 612, 455, 28, 50, SKIN_SHADE);
  // Face
  ctx.fillStyle = SKIN;
  ctx.beginPath();
  ctx.moveTo(290, 400);
  ctx.bezierCurveTo(285, 250, 380, 215, 450, 215);
  ctx.bezierCurveTo(520, 215, 615, 250, 610, 400);
  ctx.bezierCurveTo(612, 520, 580, 640, 450, 668);
  ctx.bezierCurveTo(320, 640, 288, 520, 290, 400);
  ctx.fill();
  // Beard (short, neatly trimmed) with a skin-coloured gap around the mouth
  ctx.fillStyle = BEARD;
  ctx.beginPath();
  ctx.moveTo(296, 440);
  ctx.bezierCurveTo(300, 560, 350, 660, 450, 676);
  ctx.bezierCurveTo(550, 660, 600, 560, 604, 440);
  ctx.bezierCurveTo(590, 520, 560, 560, 520, 555);
  ctx.bezierCurveTo(490, 548, 410, 548, 380, 555);
  ctx.bezierCurveTo(340, 560, 310, 520, 296, 440);
  ctx.fill();
  ellipse(ctx, 450, 598, 70, 36, SKIN); // skin patch around the mouth
  // Moustache
  ctx.fillStyle = BEARD;
  ctx.beginPath();
  ctx.moveTo(392, 572);
  ctx.bezierCurveTo(410, 548, 440, 548, 450, 556);
  ctx.bezierCurveTo(460, 548, 490, 548, 508, 572);
  ctx.bezierCurveTo(490, 566, 470, 566, 450, 572);
  ctx.bezierCurveTo(430, 566, 410, 566, 392, 572);
  ctx.fill();
  // Hair: volume on top with a side part
  ctx.fillStyle = HAIR;
  ctx.beginPath();
  ctx.moveTo(286, 420);
  ctx.bezierCurveTo(262, 280, 330, 175, 450, 170);
  ctx.bezierCurveTo(585, 168, 648, 270, 614, 420);
  ctx.bezierCurveTo(605, 350, 590, 300, 560, 285);
  ctx.bezierCurveTo(500, 300, 420, 285, 385, 262);
  ctx.bezierCurveTo(350, 300, 310, 330, 286, 420);
  ctx.fill();
  ctx.strokeStyle = "#3a2c22"; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(385, 262); ctx.bezierCurveTo(400, 230, 430, 205, 470, 195); ctx.stroke();

  // Eyebrows (raise with emphasis)
  const by = 385 - brows * 10 - (eyes === "wide" ? 12 : 0);
  ctx.fillStyle = HAIR;
  for (const [x, dir] of [[385, -1], [515, 1]]) {
    ctx.save();
    ctx.translate(x, by);
    ctx.rotate(dir * (eyes === "wide" ? -0.12 : 0.06));
    ctx.beginPath(); ctx.roundRect(-44, -9, 88, 18, 9); ctx.fill();
    ctx.restore();
  }
  // Eyes
  for (const x of [385, 515]) {
    if (eyes === "closed") {
      ctx.strokeStyle = "#2a1c14"; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.moveTo(x - 30, 432); ctx.quadraticCurveTo(x, 444, x + 30, 432); ctx.stroke();
    } else {
      const ry = eyes === "wide" ? 26 : 20;
      ellipse(ctx, x, 432, 34, ry, "#fbfaf7");
      ellipse(ctx, x + 2, 434, 15, 15, "#3b2416");
      ellipse(ctx, x + 2, 434, 7, 7, "#0b0806");
      ellipse(ctx, x + 7, 428, 4, 4, "#ffffff");
    }
  }
  // Round glasses
  ctx.strokeStyle = "#0f0f12"; ctx.lineWidth = 8;
  for (const x of [385, 515]) { ctx.beginPath(); ctx.arc(x, 434, 52, 0, Math.PI * 2); ctx.stroke(); }
  ctx.beginPath(); ctx.moveTo(437, 428); ctx.quadraticCurveTo(450, 418, 463, 428); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(333, 428); ctx.lineTo(296, 420); ctx.moveTo(567, 428); ctx.lineTo(604, 420); ctx.stroke();
  // Nose
  ctx.strokeStyle = SKIN_SHADE; ctx.lineWidth = 6; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(452, 450); ctx.quadraticCurveTo(440, 505, 428, 522); ctx.quadraticCurveTo(450, 534, 474, 520); ctx.stroke();

  // Mouth
  ctx.lineCap = "round";
  if (mouth === 0) {
    ctx.strokeStyle = "#5a2a22"; ctx.lineWidth = 7;
    ctx.beginPath(); ctx.moveTo(418, 598); ctx.quadraticCurveTo(450, 612, 482, 598); ctx.stroke();
  } else {
    const [rx, ry] = mouth === "o" ? [22, 28] : mouth === 1 ? [30, 11] : [36, 22];
    ellipse(ctx, 450, 602, rx, ry, "#4a1b18");
    if (mouth !== "o") { // teeth + tongue
      ctx.save(); ctx.beginPath(); ctx.ellipse(450, 602, rx, ry, 0, 0, Math.PI * 2); ctx.clip();
      ctx.fillStyle = "#f4f1ea"; ctx.fillRect(450 - rx, 602 - ry, rx * 2, ry * 0.55);
      ellipse(ctx, 450, 602 + ry * 0.75, rx * 0.7, ry * 0.5, "#b8484a");
      ctx.restore();
    }
  }
  ctx.restore();
}

const MOUTHS = [0, 1, 2], EYES = ["open", "closed"], TILTS = [-1.5, 0, 1.5];
const stateName = (m, e, t) => `host_m${m}_${e}_t${String(t).replace(".", "p").replace("-", "n")}.png`;

/** Render every mouth/eye/tilt combination once (18 small PNGs). */
export function renderHostStates(dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const m of MOUTHS) for (const e of EYES) for (const t of TILTS) {
    const f = path.join(dir, stateName(m, e, t));
    if (fs.existsSync(f)) continue;
    const c = createCanvas(HOST_W, HOST_H);
    drawHost(c.getContext("2d"), { mouth: m, eyes: e, tilt: t, brows: m === 2 ? 1 : 0 });
    fs.writeFileSync(f, c.toBuffer("image/png"));
  }
  return dir;
}

/** Loudness per 40 ms window of an audio file (0..1, normalised to the clip's loud parts). */
function loudness(audio, fps) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, ["-v", "error", "-i", audio, "-ac", "1", "-ar", "8000", "-f", "s16le", "-"], { windowsHide: true });
    const chunks = [];
    p.stdout.on("data", (d) => chunks.push(d));
    p.on("error", reject);
    p.on("close", (code) => {
      if (code !== 0) return reject(new Error("ffmpeg could not read " + audio));
      const buf = Buffer.concat(chunks);
      const per = Math.round(8000 / fps);
      const rms = [];
      for (let i = 0; i + 2 <= buf.length; i += per * 2) {
        let s = 0, n = 0;
        for (let j = i; j < Math.min(i + per * 2, buf.length - 1); j += 2) { const v = buf.readInt16LE(j) / 32768; s += v * v; n++; }
        rms.push(Math.sqrt(s / Math.max(1, n)));
      }
      const sorted = [...rms].sort((a, b) => a - b);
      const ref = sorted[Math.floor(sorted.length * 0.95)] || 1;
      resolve(rms.map((v) => Math.min(1, v / ref)));
    });
  });
}

/**
 * Lip-sync track: an FFmpeg concat list of host PNGs with durations, `seconds` long.
 * `audio` may be null (host just listens: blinks and small movements).
 */
export async function hostTrack(audio, seconds, dir, seed = 1, fps = 25) {
  const states = renderHostStates(path.join(dir, "..", "..", "host"));
  const levels = audio ? await loudness(audio, fps) : [];
  const frames = Math.round(seconds * fps);
  let rnd = seed;
  const rand = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
  let nextBlink = 1.5 + rand() * 2, blinkLeft = 0, tilt = 0, nextTilt = 1 + rand() * 2, mouth = 0, hold = 0;
  const seq = [];
  for (let f = 0; f < frames; f++) {
    const t = f / fps, lv = levels[f] ?? 0;
    if (hold > 0) hold--;
    else { const m = lv < 0.18 ? 0 : lv < 0.55 ? 1 : 2; if (m !== mouth) { mouth = m; hold = 1; } }
    if (t >= nextBlink) { blinkLeft = 3; nextBlink = t + 2.5 + rand() * 3; }
    const eyes = blinkLeft-- > 0 ? "closed" : "open";
    if (t >= nextTilt) { tilt = TILTS[Math.floor(rand() * 3)]; nextTilt = t + 1.2 + rand() * 2.2; }
    const file = path.join(states, stateName(mouth, eyes, tilt));
    if (seq.length && seq.at(-1)[0] === file) seq.at(-1)[1] += 1 / fps; else seq.push([file, 1 / fps]);
  }
  const list = path.join(dir, "host.txt");
  const rel = (f) => path.relative(dir, f).replace(/\\/g, "/");
  fs.writeFileSync(list, "ffconcat version 1.0\n" + seq.map(([f, d]) => `file '${rel(f)}'\nduration ${d.toFixed(4)}`).join("\n") + `\nfile '${rel(seq.at(-1)[0])}'\n`);
  return list;
}

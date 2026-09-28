// Step 3: build the 3 vertical Shorts (1080x1920) from the day's best moments.
// They reuse the long video's pictures and clips (no extra budget) with their own narration and Roman Urdu karaoke captions.
// Usage: node scripts/make-shorts.js [--date=YYYY-MM-DD] [--only=1]
import fs from "node:fs";
import path from "node:path";
import { today, readEpisode, writeEpisode, isMain, workDir, ffmpeg, mediaDuration, argValue, ROOT } from "./lib/util.js";
import { Narrator, seeded, randomMove, musicBed, audioMix } from "./lib/media.js";
import { renderShortOverlay, renderCaption, renderBlank } from "./lib/graphics.js";
import { romanTimed } from "./make-long-video.js";

const FPS = 30, W = 1080, H = 1920;
const IMG_Y = 430, IMG_H = 1000; // picture area
const CAP_Y = 1110, CAP_H = 380; // caption strip (kept above YouTube's bottom UI)
const SECONDS_PER_PICTURE = 3.5;

/** One vertical shot: the picture or clip in the middle, a blurred copy filling the background. */
async function verticalShot({ image, clip }, out, frames, move) {
  if (fs.existsSync(out)) return out;
  const dur = (frames / FPS).toFixed(3);
  let args, fg;
  if (clip) {
    args = ["-stream_loop", "-1", "-i", clip];
    fg = `[0:v]split=2[a][b];[a]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},gblur=sigma=35,eq=brightness=-0.25,fps=${FPS}[bg];` +
      `[b]scale=${W}:${IMG_H}:force_original_aspect_ratio=increase,crop=${W}:${IMG_H},fps=${FPS}[fg]`;
  } else {
    const { z0, z1, fx0, fy0, fx1, fy1 } = move;
    args = ["-i", image, "-loop", "1", "-framerate", String(FPS), "-t", dur, "-i", image];
    fg = `[1:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},gblur=sigma=35,eq=brightness=-0.25[bg];` +
      `[0:v]scale=2160:2000:force_original_aspect_ratio=increase,crop=2160:2000,setsar=1,` +
      `zoompan=z='${z0}+(${z1 - z0})*on/${frames}':x='(${fx0}+(${fx1 - fx0})*on/${frames})*(iw-iw/zoom)':y='(${fy0}+(${fy1 - fy0})*on/${frames})*(ih-ih/zoom)':d=${frames}:s=${W}x${IMG_H}:fps=${FPS}[fg]`;
  }
  await ffmpeg([...args, "-filter_complex", `${fg};[bg][fg]overlay=0:${IMG_Y}:shortest=1,format=yuv420p[v]`,
    "-map", "[v]", "-frames:v", String(frames), "-r", String(FPS), "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-an", out]);
  return out;
}

/** Karaoke captions as a timed PNG sequence (FFmpeg concat list). */
function captionTrack(words, duration, dir) {
  const capDir = path.join(dir, "caps");
  fs.mkdirSync(capDir, { recursive: true });
  const blank = renderBlank(path.join(capDir, "blank.png"), W, CAP_H);
  const chunks = [];
  let cur = [];
  for (const w of words) {
    cur.push(w);
    if (cur.length === 3 || /[।?!.,]$/.test(w.word)) { chunks.push(cur); cur = []; }
  }
  if (cur.length) chunks.push(cur);

  const entries = []; // [file, seconds]
  let t = 0;
  const add = (file, until) => { if (until - t > 0.01) { entries.push([file, until - t]); t = until; } };
  chunks.forEach((chunk, ci) => {
    const chunkEnd = Math.min(chunks[ci + 1]?.[0].start ?? duration, chunk.at(-1).end + 0.5);
    add(blank, chunk[0].start);
    chunk.forEach((w, wi) => {
      const png = renderCaption(chunk.map((x) => x.word), wi, path.join(capDir, `c${ci}_${wi}.png`), { w: W, h: CAP_H });
      add(png, wi + 1 < chunk.length ? chunk[wi + 1].start : chunkEnd);
    });
  });
  add(blank, duration);
  const list = path.join(dir, "caps.txt");
  const rel = (f) => path.relative(dir, f).replace(/\\/g, "/");
  fs.writeFileSync(list, "ffconcat version 1.0\n" + entries.map(([f, d]) => `file '${rel(f)}'\nduration ${d.toFixed(3)}`).join("\n") + `\nfile '${rel(entries.at(-1)[0])}'\n`);
  return list;
}

async function makeShort(ep, short, visuals, narrator) {
  const dir = workDir(ep.date, "shorts", short.id);
  const out = path.join(dir, "short.mp4");
  if (fs.existsSync(out)) { console.log(`  ✔ ${short.id} exists`); return out; }
  fs.mkdirSync(path.join(dir, "shots"), { recursive: true });
  console.log(`  ▶ ${short.id}: ${short.titleEn}`);

  const n = await narrator.say(short.text, path.join(dir, "voice"));
  const words = romanTimed(short.roman, n.words, n.duration);
  const duration = n.duration + 0.6;

  // Pictures and clips from the chosen chapter first, then neighbouring chapters (no cards, maps or fallbacks).
  const order = [short.chapter, short.chapter + 1, short.chapter - 1, short.chapter + 2, ...ep.chapters.keys()];
  const seen = new Set();
  const pics = order.filter((c) => ep.chapters[c]).flatMap((c) => ep.chapters[c].beats)
    .filter((b) => ["ai", "photo", "clip"].includes(b.visual.type) && visuals[b.id])
    .map((b) => visuals[b.id])
    .filter((v) => { const k = v.clip || v.image; if (!k || seen.has(k) || /[\\/]cards[\\/]/.test(k)) return false; seen.add(k); return true; });
  if (!pics.length) throw new Error("no pictures available — make the long video first");

  const totalFrames = Math.round(duration * FPS);
  const nShots = Math.max(1, Math.round(duration / SECONDS_PER_PICTURE));
  const rand = seeded(short.id + ep.date);
  const shots = [];
  let used = 0;
  for (let i = 0; i < nShots; i++) {
    const f = i === nShots - 1 ? totalFrames - used : Math.round(totalFrames / nShots);
    shots.push(await verticalShot(pics[i % pics.length], path.join(dir, "shots", `${i}.mp4`), f, randomMove(rand, 1.2)));
    used += f;
  }
  const list = path.join(dir, "shots.txt");
  fs.writeFileSync(list, shots.map((s) => `file '${path.relative(dir, s).replace(/\\/g, "/")}'`).join("\n"));
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", "shots.txt", "-c", "copy", "visual.mp4"], { cwd: dir });

  renderShortOverlay(short.hook || short.hookHi || short.titleEn, path.join(dir, "overlay.png"));
  if (words.length) captionTrack(words, duration, dir);

  const music = await musicBed(ROOT, duration, path.join(dir, "music"), ep.date + short.id);
  const args = ["-i", "visual.mp4", "-loop", "1", "-framerate", String(FPS), "-i", "overlay.png"];
  if (words.length) args.push("-f", "concat", "-safe", "0", "-i", "caps.txt");
  const voiceIdx = words.length ? 3 : 2;
  args.push("-i", path.relative(dir, n.audio));
  if (music) args.push("-i", path.relative(dir, music));
  const captions = words.length ? `[2:v]format=rgba,setpts=PTS-STARTPTS[c];[b][c]overlay=0:${CAP_Y}:eof_action=pass,format=yuv420p[v]` : `[b]format=yuv420p[v]`;
  const audio = audioMix({ first: voiceIdx, music, voiceLoudness: -14 }).replace(`[${voiceIdx}:a]`, `[${voiceIdx}:a]apad,`);
  await ffmpeg([...args, "-filter_complex",
    `[0:v][1:v]overlay=0:0:shortest=1[b];${captions};${audio}`,
    "-map", "[v]", "-map", "[a]", "-t", duration.toFixed(3), "-r", String(FPS),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "short.mp4"], { cwd: dir });

  short.render = { duration: await mediaDuration(out) };
  console.log(`    ✔ ${short.render.duration.toFixed(1)}s`);
  return out;
}

export async function makeShorts(date = today()) {
  const ep = readEpisode(date);
  if (!ep?.shorts?.length) throw new Error(`No Shorts scripts for ${date}.`);
  const vf = workDir(date, "long", "visuals.json");
  if (!fs.existsSync(vf)) throw new Error("Make the long video first (its pictures are reused).");
  const visuals = JSON.parse(fs.readFileSync(vf, "utf8"));
  const only = argValue("only");
  console.log(`📱 Shorts for ${date}...`);
  const narrator = new Narrator();
  try {
    for (const [i, s] of ep.shorts.entries()) {
      if (only && String(i + 1) !== only) continue;
      try { await makeShort(ep, s, visuals, narrator); writeEpisode(ep); }
      catch (e) { console.error(`  ✖ ${s.id}: ${e.message}`); }
    }
  } finally {
    narrator.close();
  }
}

if (isMain(import.meta.url)) {
  makeShorts().catch((e) => { console.error(e); process.exit(1); });
}

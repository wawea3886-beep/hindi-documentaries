// Step 2: build the 25-30 minute 1920x1080 documentary + thumbnail + Roman Urdu subtitle file.
// Editing style: animated host at the intro, every chapter start and the outro · real stock clips · maps · photos ·
// AI illustrations · key words popping up · title card after the cold open · whoosh/pop/boom sound effects ·
// background music that dips under the narration.
// Every piece is cached in work/DATE/long/, so a re-run only redoes what's missing.
// Usage: node scripts/make-long-video.js [--date=YYYY-MM-DD]
import fs from "node:fs";
import path from "node:path";
import config from "../config.js";
import { today, readEpisode, writeEpisode, isMain, workDir, ffmpeg, mediaDuration, clock, ROOT, IMAGES_DIR } from "./lib/util.js";
import { aiImage, Narrator, seeded, randomMove, renderShot, framePhoto, concatCopy, padAudio, mux, musicBed, STUDIO } from "./lib/media.js";
import { renderCard, renderCredit, renderFallback, renderThumbnail, renderHighlight, renderStudio } from "./lib/graphics.js";
import { downloadPhoto } from "./lib/research.js";
import { renderMap } from "./lib/maps.js";
import { stockClip } from "./lib/stock.js";
import { hostTrack } from "./lib/host.js";
import { sfxTrack } from "./lib/sfx.js";

const FPS = 25, W = 1920, H = 1080;
const PARALLEL = 3;

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) await fn(items[i++]); }));
}

/** Time each Roman Urdu word using the Urdu word timings of the same sentence (same words, same order). */
export function romanTimed(roman, words, duration) {
  const tokens = (roman || "").split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  const M = words.length, N = tokens.length;
  return tokens.map((word, i) => {
    if (!M) return { word, start: (i / N) * duration * 0.95, end: ((i + 1) / N) * duration * 0.95 };
    const j = Math.min(M - 1, Math.floor((i * M) / N));
    const jn = Math.min(M - 1, Math.floor(((i + 1) * M) / N));
    return { word, start: words[j].start, end: i + 1 < N && jn > j ? words[jn].start : words[j].end };
  });
}

function srt(cues) {
  const t = (s) => new Date(Math.round(s * 1000)).toISOString().slice(11, 23).replace(".", ",");
  return cues.map((c, i) => `${i + 1}\n${t(c.start)} --> ${t(c.end)}\n${c.text}\n`).join("\n");
}

/** Group timed words into subtitle lines (≤ 42 characters, break at sentence ends). */
function toCues(words) {
  const cues = [];
  let cur = [];
  const flush = () => { if (cur.length) cues.push({ start: cur[0].start, end: cur.at(-1).end + 0.15, text: cur.map((w) => w.word).join(" ") }); cur = []; };
  for (const w of words) {
    if (cur.length && (cur.map((x) => x.word).join(" ") + " " + w.word).length > 42) flush();
    cur.push(w);
    if (/[.?!,؟۔]$/.test(w.word)) flush();
  }
  flush();
  cues.forEach((c, i) => { if (cues[i + 1]) c.end = Math.max(c.start + 0.3, Math.min(c.end, cues[i + 1].start - 0.02)); });
  return cues;
}

export async function makeLongVideo(date = today()) {
  const ep = readEpisode(date);
  if (ep?.stage !== "done") throw new Error(`Script for ${date} is not finished. Run write-episode first.`);
  const dir = workDir(date, "long");
  const final = path.join(dir, "long.mp4");
  for (const d of ["img", "photos", "cards", "beats", "shots", "clips", "maps"]) fs.mkdirSync(path.join(dir, d), { recursive: true });
  if (fs.existsSync(final) && ep.render?.duration) { console.log(`✔ Long video exists (${clock(ep.render.duration)})`); return final; }
  console.log(`🎬 Long video: "${ep.meta.youtubeTitle}"`);
  const started = Date.now();

  // Thumbnail picture first, so it gets made before any daily image limit is reached.
  const thumbSrc = path.join(dir, "img", "thumb-src.jpg");
  const thumbOk = await aiImage(ep.meta.thumbnailPrompt, thumbSrc, 7);

  const narrator = new Narrator();
  const stats = { ai: 0, clip: 0, photo: 0, map: 0, card: 0, host: 0, reused: 0, fallback: 0 };
  const lastImages = [], aiImages = [];
  const visuals = {}; // beatId → { image } | { clip } (the Shorts reuse these)
  const shots = [], audio = [], subtitleWords = [], chapterStarts = [], sfx = [], clipCredits = [];
  const lastCh = ep.chapters.length - 1;
  let t = 0;

  const addSilentScene = async (name, still, seconds, move) => {
    const frames = Math.round(seconds * FPS);
    shots.push({ image: still, out: path.join(dir, "shots", `${name}.mp4`), frames, fps: FPS, w: W, h: H, move });
    audio.push(await padAudio(null, frames / FPS, path.join(dir, "beats", `${name}-silence-${frames}.wav`)));
    t += frames / FPS;
  };

  try {
    for (const [ci, ch] of ep.chapters.entries()) {
      chapterStarts.push({ start: t, titleEn: ch.titleEn, titleRoman: ch.titleRoman });
      const studioPng = renderStudio({ label: ci === 0 ? "" : ci === lastCh ? "FINAL CHAPTER" : `CHAPTER ${ci + 1}`, title: ci === 0 ? "" : ch.titleEn },
        path.join(dir, "cards", `studio-c${ci + 1}.png`), { screen: STUDIO });
      if (ci > 0) sfx.push({ t, name: "boom" });

      for (const [bi, beat] of ch.beats.entries()) {
        const v = beat.visual;
        const rand = seeded(beat.id + date);
        const isHost = bi === 0 || (ci === lastCh && bi >= ch.beats.length - 2);
        let still = null, clip = null, kind = v.type;
        const overlays = [];

        if (kind === "clip") {
          const c = await stockClip(v.query, path.join(dir, "clips", `${beat.id}.mp4`));
          if (c) { clip = c.path; clipCredits.push(c.credit); } else kind = "ai";
        }
        if (kind === "photo") {
          const p = ep.photos.find((x) => x.id === v.photo);
          try {
            const raw = path.join(dir, "photos", `${p.id}.img`);
            await downloadPhoto(p, raw);
            still = await framePhoto(raw, path.join(dir, "photos", `${p.id}-framed.jpg`));
            if (!isHost) overlays.push({ png: renderCredit(`Photo: ${p.artist} · ${p.license} · Wikimedia Commons`, path.join(dir, "photos", `${p.id}-credit.png`)), start: 0, end: 999 });
          } catch (e) {
            console.warn(`    photo ${p?.id} failed (${e.message.split("\n")[0]}) — using an illustration`);
            kind = "ai";
          }
        }
        if (kind === "map") still = renderMap(v, path.join(dir, "maps", `${beat.id}.jpg`));
        if (kind === "card") still = await renderCard(v, path.join(dir, "cards", `${beat.id}.png`), { bgImage: lastImages.at(-1) });
        if (kind === "ai") {
          const out = path.join(dir, "img", `${beat.id}.jpg`);
          if (await aiImage(v.prompt || ep.meta.characters, out, Math.floor(rand() * 1e6))) { still = out; aiImages.push(out); }
          // Out of image budget: reuse an earlier illustration (never a real photo — it could show the wrong thing).
          else if (aiImages.length) { still = aiImages[Math.floor(rand() * aiImages.length)]; kind = "reused"; }
          else { still = await renderFallback(ch.titleEn, path.join(dir, "cards", `${beat.id}-fb.png`)); kind = "fallback"; }
        }
        if (still && ["ai", "photo", "map"].includes(kind)) lastImages.push(still);
        stats[kind] = (stats[kind] || 0) + 1;
        visuals[beat.id] = clip ? { clip } : { image: still };

        const bdir = path.join(dir, "beats", beat.id);
        const n = await narrator.say(beat.text, bdir);
        const pause = bi === ch.beats.length - 1 ? 0.9 : 0.35;
        const frames = Math.round((n.duration + pause) * FPS);
        const secs = frames / FPS;
        romanTimed(beat.roman, n.words, n.duration).forEach((w) => subtitleWords.push({ ...w, start: w.start + t, end: w.end + t }));
        audio.push(await padAudio(n.audio, secs, path.join(bdir, "pad.wav")));
        if (!(ci > 0 && bi === 0) && t > 0) sfx.push({ t, name: "whoosh" });

        if (beat.highlight) {
          const png = renderHighlight(beat.highlight, path.join(dir, "cards", `${beat.id}-hl.png`));
          const s = Math.min(0.6, secs / 3);
          overlays.push({ png, start: s, end: Math.min(s + 3.2, secs - 0.2) });
          sfx.push({ t: t + s, name: "pop" });
        }

        const base = { fps: FPS, w: W, h: H, image: still, clip };
        if (isHost) {
          stats.host++;
          const host = await hostTrack(n.audio, secs, bdir, [...beat.id].reduce((a, c) => a + c.charCodeAt(0), 7));
          shots.push({ ...base, out: path.join(dir, "shots", `${beat.id}-host.mp4`), frames, move: randomMove(rand, 0.5), overlays, studio: { png: studioPng, host } });
        } else if (clip || kind === "card" || kind === "map") {
          shots.push({ ...base, out: path.join(dir, "shots", `${beat.id}-0.mp4`), frames, move: randomMove(rand, kind === "map" ? 0.6 : 0.3), overlays });
        } else {
          // Long beats get several camera moves on the same picture (a "cut" every few seconds).
          const nShots = Math.max(1, Math.round(secs / config.shotSeconds));
          let used = 0;
          for (let s = 0; s < nShots; s++) {
            const f = s === nShots - 1 ? frames - used : Math.round(frames / nShots);
            const offset = used / FPS;
            const shotOverlays = overlays.map((o) => ({ ...o, start: o.start - offset, end: o.end - offset })).filter((o) => o.end > 0.3 && o.start < f / FPS);
            shots.push({ ...base, out: path.join(dir, "shots", `${beat.id}-${s}.mp4`), frames: f, move: randomMove(rand, kind === "photo" ? 0.6 : 1.1), overlays: shotOverlays });
            used += f;
          }
        }
        t += secs;
      }

      // Title card right after the cold open, like a TV documentary.
      if (ci === 0) {
        const [main, sub] = ep.meta.youtubeTitle.split("|").map((s) => s.trim());
        const card = await renderCard({ title: main, text: sub || config.siteName }, path.join(dir, "cards", "title.png"), { bgImage: thumbOk ? thumbSrc : lastImages[0] });
        sfx.push({ t, name: "boom" });
        await addSilentScene("title", card, 3.5, randomMove(seeded("title"), 0.3));
      }
      console.log(`  chapter ${ci + 1}/${ep.chapters.length} ready (${clock(t)})`);
    }
  } finally {
    narrator.close();
  }

  // End screen: 12 seconds for YouTube's end-screen elements (add them once as a template in YouTube Studio).
  const endCard = await renderCard({ title: "SUBSCRIBE", text: "A new true story every day" }, path.join(dir, "cards", "end.png"), { bgImage: thumbOk ? thumbSrc : lastImages[0] });
  sfx.push({ t, name: "whoosh" });
  await addSilentScene("zz-end", endCard, 12, randomMove(seeded("end"), 0.2));
  console.log(`  scenes: ${Object.entries(stats).filter(([, v]) => v).map(([k, v]) => `${v} ${k}`).join(", ")}`);

  let done = 0;
  await pool(shots, PARALLEL, async (s) => {
    await renderShot(s);
    if (++done % 25 === 0 || done === shots.length) console.log(`  rendered ${done}/${shots.length} shots`);
  });

  const video = await concatCopy(shots.map((s) => s.out), path.join(dir, "video.mp4"), dir);
  const narration = await concatCopy(audio, path.join(dir, "narration.wav"), dir);
  const effects = await sfxTrack(sfx, t, dir);
  const music = await musicBed(ROOT, t, path.join(dir, "music"), date);
  if (!music) console.log("  (no background music — add royalty-free tracks to assets/music/)");
  await mux({ video, narration, sfx: effects, music, out: final, cwd: dir });
  fs.writeFileSync(path.join(dir, "captions.srt"), srt(toCues(subtitleWords)));
  fs.writeFileSync(path.join(dir, "visuals.json"), JSON.stringify(visuals));

  await renderThumbnail({ image: thumbOk ? thumbSrc : lastImages[0], text: ep.meta.thumbnailText }, path.join(dir, "thumbnail.jpg"));

  // Small copies for the website.
  const webDir = path.join(IMAGES_DIR, date);
  fs.mkdirSync(webDir, { recursive: true });
  await ffmpeg(["-i", path.join(dir, "thumbnail.jpg"), "-vf", "scale=1280:720", "-q:v", "5", path.join(webDir, "thumb.jpg")]);
  const chapterImages = [];
  for (const [ci, ch] of ep.chapters.entries()) {
    const b = ch.beats.find((x) => ["ai", "photo", "map"].includes(x.visual.type) && visuals[x.id]?.image && !/[\\/]cards[\\/]/.test(visuals[x.id].image));
    if (!b) { chapterImages.push(null); continue; }
    const name = `ch${ci + 1}.jpg`;
    await ffmpeg(["-i", visuals[b.id].image, "-vf", "scale=800:450:force_original_aspect_ratio=increase,crop=800:450", "-q:v", "6", path.join(webDir, name)]);
    chapterImages.push({ file: name, photo: b.visual.type === "photo" ? b.visual.photo : null, kind: b.visual.type });
  }

  const duration = await mediaDuration(final);
  const seen = new Set();
  ep.render = {
    duration, chapters: chapterStarts, chapterImages, pictures: stats, renderedAt: new Date().toISOString(),
    clipCredits: clipCredits.filter((c) => !seen.has(c.url) && seen.add(c.url)),
  };
  writeEpisode(ep);
  console.log(`✔ Long video: ${clock(duration)} in ${Math.round((Date.now() - started) / 60000)} min → ${path.relative(ROOT, final)}`);
  return final;
}

if (isMain(import.meta.url)) {
  makeLongVideo().catch((e) => { console.error(e); process.exit(1); });
}

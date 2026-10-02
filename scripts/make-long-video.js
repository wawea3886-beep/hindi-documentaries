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
import { renderCard, renderCredit, renderFallback, renderThumbnail, renderHighlight, renderStudio, renderChapterOverlay } from "./lib/graphics.js";
import { downloadPhoto } from "./lib/research.js";
import { renderMap } from "./lib/maps.js";
import { stockClips, stockPhoto, searchWords } from "./lib/stock.js";
import { hostTrack } from "./lib/host.js";
import { presenterClips, presenterMode, presenterStill, presenterEngine } from "./lib/presenter.js";
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
  const stats = { ai: 0, stock: 0, clip: 0, photo: 0, map: 0, card: 0, reused: 0, fallback: 0 };
  const lastImages = [], aiImages = [];
  const visuals = {}; // beatId → { image } | { clip } (the Shorts reuse these)
  const scenes = [], audio = [], subtitleWords = [], chapterStarts = [], chapterPads = [], sfx = [], clipCredits = [];
  const lastCh = ep.chapters.length - 1;
  let t = 0;

  const addSilentScene = async (name, still, seconds, move) => {
    const frames = Math.round(seconds * FPS);
    scenes.push({ silent: true, name, still, frames, move });
    audio.push(await padAudio(null, frames / FPS, path.join(dir, "beats", `${name}-silence-${frames}.wav`)));
    t += frames / FPS;
  };

  // --- Phase A: pictures, narration and timing for every scene.
  try {
    for (const [ci, ch] of ep.chapters.entries()) {
      chapterStarts.push({ start: t, titleEn: ch.titleEn, titleRoman: ch.titleRoman });
      chapterPads.push([]);
      const label = ci === 0 ? "" : ci === lastCh ? "FINAL CHAPTER" : `CHAPTER ${ci + 1}`, title = ci === 0 ? "" : ch.titleEn;
      const studioPng = renderStudio({ label, title }, path.join(dir, "cards", `studio-c${ci + 1}.png`), { screen: STUDIO });
      const studioPngReal = renderStudio({ label, title }, path.join(dir, "cards", `studio-real-c${ci + 1}.png`), { screen: STUDIO, panel: STUDIO.panel });
      if (ci > 0) sfx.push({ t, name: "boom" });

      for (const [bi, beat] of ch.beats.entries()) {
        const v = beat.visual;
        const rand = seeded(beat.id + date);
        const isHost = bi === 0 || (ci === lastCh && bi >= ch.beats.length - 2);
        let still = null, clip = null, clips = [], kind = v.type, credit = null;
        const overlays = [];

        // Narration first, so we know how long the scene is (= how many clips it needs).
        const bdir = path.join(dir, "beats", beat.id);
        const n = await narrator.say(beat.text, bdir);
        const pause = bi === ch.beats.length - 1 ? 0.9 : 0.35;
        const frames = Math.round((n.duration + pause) * FPS);
        const secs = frames / FPS;

        // VIDEO FIRST: clip scenes — and illustration scenes too — try real moving footage before any still picture.
        if (kind === "clip" || (kind === "ai" && config.videoFirst)) {
          const want = Math.min(config.maxClipsPerScene, Math.max(1, Math.round(secs / config.clipSeconds)));
          clips = await stockClips(v.query || searchWords(v.prompt), want, path.join(dir, "clips", beat.id));
          if (clips.length) { clip = clips[0].path; kind = "clip"; clips.forEach((c) => clipCredits.push(c.credit)); }
          else kind = "ai";
        }
        if (kind === "photo") {
          const p = ep.photos.find((x) => x.id === v.photo);
          try {
            const raw = path.join(dir, "photos", `${p.id}.img`);
            await downloadPhoto(p, raw);
            still = await framePhoto(raw, path.join(dir, "photos", `${p.id}-framed.jpg`));
            credit = { png: renderCredit(`Photo: ${p.artist} · ${p.license} · Wikimedia Commons`, path.join(dir, "photos", `${p.id}-credit.png`)), start: 0, end: 999 };
          } catch (e) {
            console.warn(`    photo ${p?.id} failed (${e.message.split("\n")[0]}) — using an illustration`);
            kind = "ai";
          }
        }
        if (kind === "map") still = renderMap(v, path.join(dir, "maps", `${beat.id}.jpg`));
        if (kind === "card") still = await renderCard(v, path.join(dir, "cards", `${beat.id}.png`), { bgImage: lastImages.at(-1) });
        if (kind === "ai") {
          const out = path.join(dir, "img", `${beat.id}.jpg`);
          let stock;
          if (await aiImage(v.prompt || ep.meta.characters, out, Math.floor(rand() * 1e6))) { still = out; aiImages.push(out); }
          // No AI pictures today: a real stock photo matching the scene (free, Pexels).
          else if ((stock = await stockPhoto(v.query || searchWords(v.prompt), path.join(dir, "img", `${beat.id}-stock.jpg`)))) {
            still = stock.path; kind = "stock"; clipCredits.push(stock.credit); aiImages.push(still);
          }
          // Last resort: reuse an earlier picture (never a Wikipedia photo — it could show the wrong thing).
          else if (aiImages.length) { still = aiImages[Math.floor(rand() * aiImages.length)]; kind = "reused"; }
          else { still = await renderFallback(ch.titleEn, path.join(dir, "cards", `${beat.id}-fb.png`)); kind = "fallback"; }
        }
        if (still && ["ai", "stock", "photo", "map"].includes(kind)) lastImages.push(still);
        stats[kind] = (stats[kind] || 0) + 1;
        visuals[beat.id] = clip ? { clip } : { image: still };

        romanTimed(beat.roman, n.words, n.duration).forEach((w) => subtitleWords.push({ ...w, start: w.start + t, end: w.end + t }));
        const pad = await padAudio(n.audio, secs, path.join(bdir, "pad.wav"));
        audio.push(pad);
        chapterPads[ci].push(pad);
        if (!(ci > 0 && bi === 0) && t > 0) sfx.push({ t, name: "whoosh" });

        if (beat.highlight) {
          const png = renderHighlight(beat.highlight, path.join(dir, "cards", `${beat.id}-hl.png`));
          const s = Math.min(0.6, secs / 3);
          overlays.push({ png, start: s, end: Math.min(s + 3.2, secs - 0.2) });
          sfx.push({ t: t + s, name: "pop" });
        }
        scenes.push({ beat, ci, bi, isHost, kind, still, clip, clips, credit, overlays, frames, secs, t0: t, rand, bdir, voice: n.audio, studioPng, studioPngReal });
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

  // --- Phase B: the real presenter (HeyGen), lip-synced to the narration — one clip per chapter, or per key scene.
  const beatScenes = scenes.filter((s) => !s.silent);
  const mode = presenterMode(beatScenes.reduce((n, s) => n + s.secs, 0) / 60);
  let segments = [];
  if (mode === "full") {
    segments = await Promise.all(ep.chapters.map(async (_, ci) => ({ name: `ch${ci + 1}`, start: chapterStarts[ci].start,
      audio: await concatCopy(chapterPads[ci], path.join(dir, `chapter${ci + 1}.wav`), dir) })));
  } else if (mode === "scenes") {
    segments = beatScenes.filter((s) => s.isHost).map((s) => ({ name: s.beat.id, start: s.t0, audio: path.join(s.bdir, "pad.wav") }));
  }
  const engine = presenterEngine();
  const clips = segments.length ? await presenterClips(ep, segments, path.join(dir, "presenter")) : {};
  const segmentOf = (sc) => mode === "full" ? segments[sc.ci] : segments.find((g) => g.name === sc.beat.id);
  // Which layout each scene uses.
  const layoutOf = (sc) => {
    if (mode === "full") return sc.bi === 0 ? "full" : sc.isHost || sc.bi % 4 === 2 ? "studio" : "pip";
    if (mode === "scenes") return sc.isHost ? "studio" : "none";
    return sc.isHost ? "cartoon" : "none";
  };

  // --- Phase C: turn scenes into shots.
  /** Cut a scene into `n` shots; `make(index, frames, offsetSeconds, overlaysForThisShot)` creates each. */
  const split = (sc, n, overlays, make) => {
    let used = 0;
    for (let s = 0; s < n; s++) {
      const f = s === n - 1 ? sc.frames - used : Math.round(sc.frames / n);
      const offset = used / FPS;
      make(s, f, offset, overlays.map((o) => ({ ...o, start: o.start - offset, end: o.end - offset })).filter((o) => o.end > 0.3 && o.start < f / FPS));
      used += f;
    }
  };
  /** Which clip a shot uses, starting at a random point inside it so footage never looks repeated. */
  const clipFor = (sc, s, f) => {
    if (!sc.clips?.length) return {};
    const c = sc.clips[s % sc.clips.length];
    const room = Math.max(0, (c.duration || 0) - f / FPS - 0.3);
    return { clip: c.path, clipStart: Math.round(room * sc.rand() * 100) / 100 };
  };
  const shots = [];
  const layouts = {};
  for (const sc of scenes) {
    if (sc.silent) { shots.push({ image: sc.still, out: path.join(dir, "shots", `${sc.name}.mp4`), frames: sc.frames, fps: FPS, w: W, h: H, move: sc.move }); continue; }
    const seg = segmentOf(sc);
    const file = seg && clips[seg.name];
    let layout = layoutOf(sc);
    if (["full", "studio", "pip"].includes(layout) && !file) layout = sc.isHost ? "cartoon" : "none"; // HeyGen clip missing
    layouts[layout] = (layouts[layout] || 0) + 1;
    // The free narrator card also gets the narration audio, to draw the voice waveform.
    const presenterAt = (offset) => ({ file, offset: sc.t0 - seg.start + offset, layout, audio: engine === "card" ? seg.audio : undefined });
    const base = { fps: FPS, w: W, h: H, image: sc.still, clip: sc.clip };
    const id = sc.beat.id;

    if (layout === "full") {
      const ch = ep.chapters[sc.ci];
      const banner = sc.ci > 0 && sc.bi === 0
        ? [{ png: renderChapterOverlay({ number: sc.ci + 1, title: ch.titleEn, subtitle: ch.titleRoman }, path.join(dir, "cards", `chapter${sc.ci + 1}.png`)), start: 0.4, end: Math.min(5, sc.secs - 0.3) }]
        : [];
      shots.push({ ...base, out: path.join(dir, "shots", `${id}-full.mp4`), frames: sc.frames, overlays: [...banner, ...sc.overlays], presenter: presenterAt(0) });
    } else if (layout === "studio") {
      const nShots = sc.clips?.length ? Math.max(1, Math.round(sc.secs / config.clipSeconds)) : 1;
      split(sc, nShots, sc.overlays, (s, f, offset, shotOverlays) => shots.push({ ...base, ...clipFor(sc, s, f),
        out: path.join(dir, "shots", `${id}-studio-${s}.mp4`), frames: f, move: randomMove(sc.rand, 0.5), overlays: shotOverlays,
        studio: { png: sc.studioPngReal }, presenter: presenterAt(offset) }));
    } else if (layout === "cartoon") {
      const host = await hostTrack(sc.voice, sc.secs, sc.bdir, [...id].reduce((a, c) => a + c.charCodeAt(0), 7));
      shots.push({ ...base, out: path.join(dir, "shots", `${id}-host.mp4`), frames: sc.frames, move: randomMove(sc.rand, 0.5), overlays: sc.overlays, studio: { png: sc.studioPng, host } });
    } else {
      // Full-screen picture/clip (+ presenter box when layout is "pip"). Long still beats get several camera moves.
      // Full-screen footage/picture (+ presenter box when layout is "pip"):
      // clips cut every few seconds between different clips; stills get several camera moves.
      const overlays = sc.credit ? [sc.credit, ...sc.overlays] : sc.overlays;
      const nShots = sc.clips?.length ? Math.max(1, Math.round(sc.secs / config.clipSeconds))
        : sc.kind === "card" || sc.kind === "map" ? 1 : Math.max(1, Math.round(sc.secs / config.shotSeconds));
      const strength = sc.kind === "map" ? 0.6 : sc.kind === "card" ? 0.3 : sc.kind === "photo" ? 0.6 : 1.1;
      split(sc, nShots, overlays, (s, f, offset, shotOverlays) => shots.push({ ...base, ...clipFor(sc, s, f),
        out: path.join(dir, "shots", `${id}-${s}.mp4`), frames: f, move: randomMove(sc.rand, strength), overlays: shotOverlays,
        presenter: layout === "pip" ? presenterAt(offset) : undefined }));
    }
  }
  console.log(`  presenter mode: ${mode} · layouts: ${Object.entries(layouts).map(([k, v]) => `${v} ${k}`).join(", ")}`);

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

  const still = mode !== "off" ? await presenterStill(dir) : null;
  await renderThumbnail({ image: thumbOk ? thumbSrc : lastImages[0], text: ep.meta.thumbnailText, photo: still, host: mode === "off" },
    path.join(dir, "thumbnail.jpg"));

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
    presenter: { mode, engine: mode === "off" ? "cartoon" : engine },
  };
  writeEpisode(ep);
  console.log(`✔ Long video: ${clock(duration)} in ${Math.round((Date.now() - started) / 60000)} min → ${path.relative(ROOT, final)}`);
  return final;
}

if (isMain(import.meta.url)) {
  makeLongVideo().catch((e) => { console.error(e); process.exit(1); });
}

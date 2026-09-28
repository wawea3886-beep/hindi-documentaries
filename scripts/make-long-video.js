// Step 2: build the 25-30 minute 1920x1080 documentary + thumbnail + Hindi subtitle file.
// Every piece is cached in work/DATE/long/, so a re-run only redoes what's missing.
// Usage: node scripts/make-long-video.js [--date=YYYY-MM-DD]
import fs from "node:fs";
import path from "node:path";
import config from "../config.js";
import { today, readEpisode, writeEpisode, isMain, workDir, ffmpeg, mediaDuration, clock, ROOT, IMAGES_DIR } from "./lib/util.js";
import { aiImage, Narrator, attachPunctuation, seeded, randomMove, renderShot, framePhoto, concatCopy, padAudio, mux, pickMusic } from "./lib/media.js";
import { renderCard, renderChapterOverlay, renderCredit, renderFallback, renderThumbnail } from "./lib/graphics.js";
import { downloadPhoto } from "./lib/research.js";

const FPS = 25, W = 1920, H = 1080;
const SHOT_SECONDS = 6.5; // change the camera move about this often, like real documentaries
const PARALLEL = 3;

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) await fn(items[i++]); }));
}

function srt(cues) {
  const t = (s) => { const ms = Math.round(s * 1000); return new Date(ms).toISOString().slice(11, 23).replace(".", ","); };
  return cues.map((c, i) => `${i + 1}\n${t(c.start)} --> ${t(c.end)}\n${c.text}\n`).join("\n");
}

/** Group timed words into subtitle lines (≤ 45 characters, break at sentence ends). */
function toCues(words) {
  const cues = [];
  let cur = [];
  const flush = () => { if (cur.length) cues.push({ start: cur[0].start, end: cur.at(-1).end + 0.2, text: cur.map((w) => w.word).join(" ") }); cur = []; };
  for (const w of words) {
    if (cur.length && (cur.map((x) => x.word).join(" ") + " " + w.word).length > 45) flush();
    cur.push(w);
    if (/[।?!.]$/.test(w.word)) flush();
  }
  flush();
  return cues;
}

export async function makeLongVideo(date = today()) {
  const ep = readEpisode(date);
  if (ep?.stage !== "done") throw new Error(`Script for ${date} is not finished. Run write-episode first.`);
  const dir = workDir(date, "long");
  const final = path.join(dir, "long.mp4");
  for (const d of ["img", "photos", "cards", "beats", "shots"]) fs.mkdirSync(path.join(dir, d), { recursive: true });
  if (fs.existsSync(final) && ep.render?.duration) { console.log(`✔ Long video exists (${clock(ep.render.duration)})`); return final; }
  console.log(`🎬 Long video: "${ep.meta.youtubeTitle}"`);
  const started = Date.now();

  // --- Thumbnail first, so it gets a picture before any daily limit is reached.
  const thumbSrc = path.join(dir, "img", "thumb-src.jpg");
  const thumbOk = await aiImage(ep.meta.thumbnailPrompt, thumbSrc, 7);

  // --- Phase A: pictures + narration for every beat, and the shot plan.
  const narrator = new Narrator();
  const stats = { ai: 0, photo: 0, card: 0, reused: 0, fallback: 0 };
  const lastImages = []; // AI pictures + real photos (backgrounds for fact cards)
  const aiImages = [];
  const visuals = {}; // beatId → 16:9 still (used again by the Shorts)
  const shots = [], audio = [], words = [], chapterStarts = [];
  let t = 0;
  try {
    for (const [ci, ch] of ep.chapters.entries()) {
      chapterStarts.push({ start: t, titleEn: ch.titleEn, titleHi: ch.titleHi });
      const chapterOverlay = ci > 0 ? renderChapterOverlay({ number: ci + 1, titleHi: ch.titleHi, titleEn: ch.titleEn }, path.join(dir, "cards", `chapter${ci + 1}.png`)) : null;
      for (const [bi, beat] of ch.beats.entries()) {
        const v = beat.visual;
        const rand = seeded(beat.id + date);
        let still, kind = v.type, overlays = [];

        if (v.type === "photo") {
          const p = ep.photos.find((x) => x.id === v.photo);
          const raw = path.join(dir, "photos", `${p.id}.img`);
          try {
            await downloadPhoto(p, raw);
            still = await framePhoto(raw, path.join(dir, "photos", `${p.id}-framed.jpg`));
            const credit = renderCredit(`Photo: ${p.artist} · ${p.license} · Wikimedia Commons`, path.join(dir, "photos", `${p.id}-credit.png`));
            overlays.push({ png: credit, start: 0, end: 999 });
          } catch (e) {
            console.warn(`    photo ${p.id} failed (${e.message.split("\n")[0]}) — using an illustration`);
            kind = "ai";
          }
        }
        if (kind === "card") {
          still = await renderCard(v, path.join(dir, "cards", `${beat.id}.png`), { bgImage: lastImages.at(-1) });
        }
        if (kind === "ai") {
          const out = path.join(dir, "img", `${beat.id}.jpg`);
          if (await aiImage(v.prompt || ep.meta.characters, out, Math.floor(rand() * 1e6))) { still = out; aiImages.push(out); }
          // Out of image budget: reuse an earlier illustration (never a real photo — it could show the wrong thing).
          else if (aiImages.length) { still = aiImages[Math.floor(rand() * aiImages.length)]; kind = "reused"; }
          else { still = await renderFallback(ch.titleEn, path.join(dir, "cards", `${beat.id}-fb.png`)); kind = "fallback"; }
        }
        if (kind === "ai" || kind === "photo") lastImages.push(still);
        stats[kind]++;
        visuals[beat.id] = still;

        const n = await narrator.say(beat.text, path.join(dir, "beats", beat.id));
        const pause = bi === ch.beats.length - 1 ? 0.9 : 0.3;
        const frames = Math.round((n.duration + pause) * FPS);
        const secs = frames / FPS;
        attachPunctuation(n.words, beat.text).forEach((w) => words.push({ ...w, start: w.start + t, end: w.end + t }));
        audio.push(await padAudio(n.audio, secs, path.join(dir, "beats", beat.id, "pad.wav")));

        // Split long beats into several camera moves on the same picture.
        const nShots = kind === "card" ? 1 : Math.max(1, Math.round(secs / SHOT_SECONDS));
        let used = 0;
        for (let s = 0; s < nShots; s++) {
          const f = s === nShots - 1 ? frames - used : Math.round(frames / nShots);
          const shotOverlays = overlays.map((o) => ({ ...o, end: Math.min(o.end, f / FPS) }));
          if (bi === 0 && s === 0 && chapterOverlay) shotOverlays.push({ png: chapterOverlay, start: 0.3, end: Math.min(4.8, f / FPS) });
          shots.push({ image: still, out: path.join(dir, "shots", `${beat.id}-${s}.mp4`), frames: f, fps: FPS, w: W, h: H,
            move: randomMove(rand, kind === "card" ? 0.3 : kind === "photo" ? 0.5 : 1), overlays: shotOverlays });
          used += f;
        }
        t += secs;
      }
      process.stdout.write(`  chapter ${ci + 1}/${ep.chapters.length} ready (${clock(t)})\n`);
    }
  } finally {
    narrator.close();
  }

  // End screen: 12 silent seconds for YouTube's end-screen elements (add them once as a template in YouTube Studio).
  const endCard = await renderCard({ title: "SUBSCRIBE", text: "हर दिन एक नई सच्ची कहानी" }, path.join(dir, "cards", "end.png"), { bgImage: fs.existsSync(thumbSrc) ? thumbSrc : lastImages[0] });
  shots.push({ image: endCard, out: path.join(dir, "shots", "zz-end.mp4"), frames: 12 * FPS, fps: FPS, w: W, h: H, move: randomMove(seeded("end"), 0.2) });
  audio.push(await padAudio(null, 12, path.join(dir, "beats", "end-silence.wav")));
  t += 12;
  console.log(`  pictures: ${stats.ai} AI, ${stats.photo} real photos, ${stats.card} cards, ${stats.reused} reused, ${stats.fallback} fallback`);

  // --- Phase B: render all shots (a few at a time).
  let done = 0;
  await pool(shots, PARALLEL, async (s) => {
    await renderShot(s);
    if (++done % 25 === 0 || done === shots.length) console.log(`  rendered ${done}/${shots.length} shots`);
  });

  // --- Phase C: join everything.
  const video = await concatCopy(shots.map((s) => s.out), path.join(dir, "video.mp4"), dir);
  const narration = await concatCopy(audio, path.join(dir, "narration.wav"), dir);
  await mux({ video, narration, music: pickMusic(ROOT, date), out: final, cwd: dir });
  fs.writeFileSync(path.join(dir, "captions.srt"), srt(toCues(words)));
  fs.writeFileSync(path.join(dir, "visuals.json"), JSON.stringify(visuals));

  // Thumbnail (uses the AI thumbnail picture, or the first good illustration).
  await renderThumbnail({ image: thumbOk ? thumbSrc : lastImages[0], text: ep.meta.thumbnailText }, path.join(dir, "thumbnail.jpg"));

  // Small copies for the website.
  const webDir = path.join(IMAGES_DIR, date);
  fs.mkdirSync(webDir, { recursive: true });
  await ffmpeg(["-i", path.join(dir, "thumbnail.jpg"), "-vf", "scale=1280:720", "-q:v", "5", path.join(webDir, "thumb.jpg")]);
  const chapterImages = [];
  for (const [ci, ch] of ep.chapters.entries()) {
    const b = ch.beats.find((x) => x.visual.type !== "card" && visuals[x.id] && !/[\\/]cards[\\/]/.test(visuals[x.id]));
    if (!b) { chapterImages.push(null); continue; }
    const name = `ch${ci + 1}.jpg`;
    await ffmpeg(["-i", visuals[b.id], "-vf", "scale=800:450:force_original_aspect_ratio=increase,crop=800:450", "-q:v", "6", path.join(webDir, name)]);
    chapterImages.push({ file: name, photo: b.visual.type === "photo" ? b.visual.photo : null });
  }

  const duration = await mediaDuration(final);
  ep.render = { duration, chapters: chapterStarts, chapterImages, pictures: stats, renderedAt: new Date().toISOString() };
  writeEpisode(ep);
  console.log(`✔ Long video: ${clock(duration)} in ${Math.round((Date.now() - started) / 60000)} min → ${path.relative(ROOT, final)}`);
  return final;
}

if (isMain(import.meta.url)) {
  makeLongVideo().catch((e) => { console.error(e); process.exit(1); });
}

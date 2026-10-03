// Real presenter: HeyGen lip-syncs a photo of the presenter to our own narration audio ("Audio to Video", API v3).
// Put the photo in assets/presenter/ (jpg/png) and the HEYGEN_API_KEY secret in GitHub.
// Video IDs are saved in the episode as soon as they are requested, so a re-run never pays twice for the same clip.
import fs from "node:fs";
import path from "node:path";
import config from "../../config.js";
import { loadImage } from "@napi-rs/canvas";
import { ROOT, ffmpeg, mediaDuration, sleep, writeEpisode } from "./util.js";

const API = "https://api.heygen.com";
const key = () => process.env.HEYGEN_API_KEY;

export function presenterPhoto() {
  const dir = path.join(ROOT, "assets/presenter");
  if (!fs.existsSync(dir)) return null;
  const f = fs.readdirSync(dir).find((n) => /\.(jpe?g|png)$/i.test(n) && !/^cutout/i.test(n)); // the cutout is only for thumbnails
  return f ? path.join(dir, f) : null;
}

/** The presenter cut out from his background (for thumbnails) — made once with scripts/make-presenter-cutout.js. */
export function presenterCutout() {
  const f = path.join(ROOT, "assets/presenter/cutout.png");
  return fs.existsSync(f) ? f : null;
}

/** A HeyGen Photo Avatar made in the HeyGen dashboard (keeps the photo off the public GitHub project). */
const avatarId = () => (process.env.HEYGEN_AVATAR_ID || "").trim();

/**
 * "heygen" = real lip-sync (paid, needs HEYGEN_API_KEY) · "card" = free narrator card: the photo with gentle motion
 * and a voice waveform (made locally). Default: HeyGen when a key is set, otherwise the free card.
 */
export function presenterEngine() {
  const e = config.presenter.engine;
  if (e === "card" || e === "heygen") return e;
  return key() ? "heygen" : "card";
}

/** "full" | "scenes" | "off" — what the presenter does today (after the HeyGen cost cap). */
export function presenterMode(narrationMinutes) {
  if (config.presenter.mode === "off") return "off";
  const engine = presenterEngine();
  if (engine === "card" && !presenterPhoto()) return "off"; // the free card needs a photo in assets/presenter/
  if (engine === "heygen" && (!key() || (!presenterPhoto() && !avatarId()))) return "off";
  if (engine === "heygen" && config.presenter.mode === "full" && narrationMinutes > config.presenter.maxMinutesPerDay) {
    console.log(`  presenter: ${narrationMinutes.toFixed(1)} min is over the daily cap of ${config.presenter.maxMinutesPerDay} min → presenter only in key scenes today`);
    return "scenes";
  }
  return config.presenter.mode;
}

async function api(method, url, body, isForm = false) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(API + url, {
      method,
      headers: { "x-api-key": key(), ...(body && !isForm ? { "Content-Type": "application/json" } : {}) },
      body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
      signal: AbortSignal.timeout(120000),
    });
    const text = await res.text();
    if (res.ok) return JSON.parse(text).data;
    if ((res.status === 429 || res.status >= 500) && attempt < 4) { await sleep(15000 * attempt); continue; }
    throw new Error(`HeyGen ${method} ${url} → ${res.status}: ${text.slice(0, 300)}`);
  }
}

async function upload(file, type) {
  const form = new FormData();
  form.append("file", new Blob([fs.readFileSync(file)], { type }), path.basename(file));
  return (await api("POST", "/v3/assets", form, true)).asset_id;
}

async function download(url, out) {
  const r = await fetch(url, { signal: AbortSignal.timeout(600000) });
  if (!r.ok) throw new Error(`download ${r.status}`);
  fs.writeFileSync(out, Buffer.from(await r.arrayBuffer()));
}

/** Free narrator card: the photo (its own shape) "breathing" with a slow zoom and drift, as long as the audio. */
async function cardClip(photo, audio, out) {
  const d = await mediaDuration(audio);
  const img = await loadImage(fs.readFileSync(photo));
  const W = 1080, H = Math.round((W * img.height) / img.width / 2) * 2;
  const W2 = Math.round(W * 1.25 / 2) * 2, H2 = Math.round(H * 1.25 / 2) * 2;
  await ffmpeg(["-loop", "1", "-framerate", "25", "-t", d.toFixed(2), "-i", photo, "-vf",
    `scale=${W2}:${H2},setsar=1,` +
    `zoompan=z='1.05+0.02*sin(on/90)':x='iw/2-(iw/zoom/2)+14*sin(on/140)':y='ih/2-(ih/zoom/2)+8*sin(on/110)':d=1:s=${W}x${H}:fps=25,format=yuv420p`,
    "-r", "25", "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-an", out]);
}

/** A still of the presenter for the thumbnail: the local photo, or the HeyGen avatar's preview image. */
export async function presenterStill(dir) {
  const local = presenterPhoto();
  if (local) return local;
  if (!avatarId() || !key()) return null;
  try {
    const look = await api("GET", `/v3/avatars/looks/${avatarId()}`);
    const url = look.image_url || look.preview_image_url || look.thumbnail_url;
    if (!url) return null;
    const out = path.join(dir, "presenter-still.jpg");
    if (!fs.existsSync(out)) await download(url, out);
    return out;
  } catch (e) {
    console.warn(`  presenter still for thumbnail: ${e.message.split("\n")[0]}`);
    return null;
  }
}

/**
 * Make one lip-synced presenter clip per segment. segments: [{ name, audio }] (audio = WAV/MP3 of that segment).
 * Returns { name: mp4Path | null } — null when a clip failed (the caller falls back to the animated host).
 */
export async function presenterClips(ep, segments, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const photo = presenterPhoto();
  const out = Object.fromEntries(segments.map((s) => [s.name, path.join(dir, `${s.name}.mp4`)]));
  const todo = segments.filter((s) => !fs.existsSync(out[s.name]));
  if (!todo.length) return out;

  if (presenterEngine() === "card") {
    console.log(`  presenter: free narrator card, ${todo.length} clip(s)`);
    for (const s of todo) await cardClip(photo, s.audio, out[s.name]);
    return out;
  }

  ep.presenter ||= {};
  const avatar = avatarId();
  const minutes = (await Promise.all(todo.map((s) => mediaDuration(s.audio)))).reduce((a, b) => a + b, 0) / 60;
  const already = todo.filter((s) => ep.presenter[s.name]).length;
  console.log(`  presenter: ${todo.length} clip(s), ${minutes.toFixed(1)} min${already ? ` (${already} already paid for, just downloading)` : ""} ≈ $${(minutes * config.presenter.pricePerMinute).toFixed(2)}`);

  // 1. Request every clip that hasn't been requested before (saved immediately → never billed twice).
  let imageAsset = null;
  for (const s of todo) {
    if (ep.presenter[s.name]) continue;
    try {
      if (!avatar) imageAsset ||= await upload(photo, /\.png$/i.test(photo) ? "image/png" : "image/jpeg");
      const mp3 = path.join(dir, `${s.name}.mp3`);
      await ffmpeg(["-i", s.audio, "-ac", "1", "-ar", "44100", "-b:a", "96k", mp3]);
      const audioAsset = await upload(mp3, "audio/mpeg");
      const who = avatar ? { type: "avatar", avatar_id: avatar } : { type: "image", image: { type: "asset_id", asset_id: imageAsset } };
      const v = await api("POST", "/v3/videos", {
        ...who,
        audio_asset_id: audioAsset,
        title: `${ep.meta.slug} ${s.name}`,
        aspect_ratio: "auto",
        resolution: "1080p",
        motion_prompt: config.presenter.motionPrompt,
      });
      ep.presenter[s.name] = v.video_id;
      writeEpisode(ep);
    } catch (e) {
      console.warn(`    presenter ${s.name}: request failed — ${e.message.split("\n")[0]}`);
    }
  }

  // 2. Wait for all of them, then download.
  const pending = todo.filter((s) => ep.presenter[s.name]);
  const deadline = Date.now() + config.presenter.maxWaitMinutes * 60000;
  const done = new Set();
  while (done.size < pending.length && Date.now() < deadline) {
    for (const s of pending) {
      if (done.has(s.name)) continue;
      try {
        const v = await api("GET", `/v3/videos/${ep.presenter[s.name]}`);
        if (v.status === "completed" && v.video_url) { await download(v.video_url, out[s.name]); done.add(s.name); }
        else if (v.status === "failed") { console.warn(`    presenter ${s.name}: HeyGen failed — ${v.failure_message || v.failure_code}`); delete ep.presenter[s.name]; writeEpisode(ep); done.add(s.name); }
      } catch (e) { console.warn(`    presenter ${s.name}: ${e.message.split("\n")[0]}`); }
    }
    if (done.size < pending.length) await sleep(20000);
  }
  const ready = segments.filter((s) => fs.existsSync(out[s.name])).length;
  console.log(`  presenter: ${ready}/${segments.length} clips ready`);
  return Object.fromEntries(segments.map((s) => [s.name, fs.existsSync(out[s.name]) ? out[s.name] : null]));
}

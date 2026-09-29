// Pictures (free AI providers with fallbacks), narration (free Edge voices) and Ken Burns shots (FFmpeg).
import fs from "node:fs";
import path from "node:path";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import config from "../../config.js";
import { ffmpeg, mediaDuration, retry } from "./util.js";

// ---------- AI pictures ----------

const disabled = new Set(); // providers that hit their daily limit during this run

async function cloudflare(prompt, out) {
  const { CLOUDFLARE_ACCOUNT_ID: acc, CLOUDFLARE_API_TOKEN: token } = process.env;
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acc}/ai/run/@cf/black-forest-labs/flux-1-schnell`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, steps: config.cloudflareSteps }),
    signal: AbortSignal.timeout(120000),
  });
  const body = await res.text();
  if (!res.ok) {
    const quota = res.status === 429 || /"code":\s*4006|daily free allocation/i.test(body);
    throw Object.assign(new Error(`Cloudflare ${quota ? "limit " : ""}${res.status}: ${body.slice(0, 200)}`), { quota });
  }
  const b64 = JSON.parse(body).result?.image;
  if (!b64) throw new Error("Cloudflare returned no image");
  fs.writeFileSync(out, Buffer.from(b64, "base64"));
}

async function pollinations(prompt, out, seed) {
  const url = `https://gen.pollinations.ai/image/${encodeURIComponent(prompt.slice(0, 1500))}?model=flux&width=1344&height=768&seed=${seed}&nologo=true&safe=true`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${process.env.POLLINATIONS_API_KEY}` }, signal: AbortSignal.timeout(180000) });
  if (res.status === 429 || res.status === 402) throw Object.assign(new Error(`Pollinations limit (${res.status})`), { quota: true });
  if (!res.ok) throw new Error(`Pollinations ${res.status}: ${(await res.text()).slice(0, 200)}`);
  fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
}

/** Try each configured provider; returns the provider name, or null if none could make the picture. */
export async function aiImage(prompt, out, seed = 1) {
  if (fs.existsSync(out)) return "cached";
  const full = `${prompt}. ${config.imageStyle}`;
  const providers = [];
  if (process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN) providers.push(["cloudflare", () => cloudflare(full, out)]);
  if (process.env.POLLINATIONS_API_KEY) providers.push(["pollinations", () => pollinations(full, out, seed)]);
  for (const [name, fn] of providers) {
    if (disabled.has(name)) continue;
    try {
      await retry(async () => {
        try { await fn(); } catch (e) { if (e.quota) { disabled.add(name); e.message += " (disabled for today)"; } throw e; }
      }, { tries: 2, delayMs: 4000, label: `${name} image` });
      return name;
    } catch (e) {
      console.warn(`    ${name}: ${e.message.split("\n")[0]}${disabled.has(name) ? " — using other sources for the rest of today" : ""}`);
    }
  }
  return null;
}

// ---------- Narration ----------

/** Text the voice service can read: it uses XML (SSML), where & < > break the request. */
export const speakable = (text) => text.replace(/&/g, " और ").replace(/[<>{}]/g, " ").replace(/\s+/g, " ").trim();

// msedge-tts throws some errors from inside WebSocket callbacks, where no caller can catch them.
// Those requests still fail through our timeout below, so log these instead of letting them kill the whole run.
process.on("uncaughtException", (e) => {
  if (/msedge-tts|MsEdgeTTS/.test(e?.stack || "")) { console.warn(`    (voice service: ${e.message.split("\n")[0]})`); return; }
  console.error(e);
  process.exit(1);
});

const withTimeout = (promise, ms, what) =>
  Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} timed out`)), ms))]);

export class Narrator {
  constructor(voice = config.voice, rate = config.speechRate) { this.voice = voice; this.rate = rate; this.tts = null; }

  async #connect(wordBoundaries = true) {
    try { this.tts?.close(); } catch { /* already closed */ }
    this.tts = new MsEdgeTTS();
    await withTimeout(this.tts.setMetadata(this.voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3, { wordBoundaryEnabled: wordBoundaries }), 60000, "voice connection");
  }

  async #speak(text, dir) {
    // msedge-tts deletes metadata.json when no word timings arrive, and crashes if the file doesn't exist yet.
    // Creating it first turns that crash into a normal error we can retry.
    fs.writeFileSync(path.join(dir, "metadata.json"), "");
    const { audioFilePath, metadataFilePath } = await withTimeout(this.tts.toFile(dir, speakable(text), { rate: this.rate }), 120000, "narration");
    let words = [];
    if (metadataFilePath && fs.existsSync(metadataFilePath)) {
      const raw = fs.readFileSync(metadataFilePath, "utf8");
      if (raw.trim()) words = JSON.parse(raw).Metadata.filter((m) => m.Type === "WordBoundary")
        .map((m) => ({ word: m.Data.text.Text, start: m.Data.Offset / 1e7, end: (m.Data.Offset + m.Data.Duration) / 1e7 }));
    }
    const duration = await mediaDuration(audioFilePath);
    if (!(duration > 0.3)) throw new Error("empty audio");
    return { audio: audioFilePath, words, duration };
  }

  /** Speak `text` into `dir`/audio.mp3; returns word timings (seconds) and duration. Cached on disk. */
  async say(text, dir) {
    const cache = path.join(dir, "words.json");
    if (fs.existsSync(cache)) return JSON.parse(fs.readFileSync(cache, "utf8"));
    fs.mkdirSync(dir, { recursive: true });
    let result;
    try {
      result = await retry(async () => {
        if (!this.tts) await this.#connect();
        try { return await this.#speak(text, dir); } catch (e) { this.tts = null; throw e; } // reconnect next time
      }, { tries: 4, delayMs: 3000, label: "narration" });
    } catch (e) {
      // Last resort: record without word timings (only this beat loses its subtitle timing).
      console.warn(`    narration without word timings (${e.message.split("\n")[0]})`);
      await this.#connect(false);
      result = await this.#speak(text, dir);
      this.tts = null;
    }
    fs.writeFileSync(cache, JSON.stringify(result));
    return result;
  }

  close() { this.tts?.close(); }
}

/** Put punctuation back on spoken words (Edge reports bare words). */
export function attachPunctuation(words, text) {
  const tokens = text.split(/\s+/).filter(Boolean);
  const bare = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}\p{M}]/gu, "");
  let p = 0;
  return words.map((w) => {
    const bw = bare(w.word).split(/\s+/)[0] || bare(w.word);
    for (let i = p; i < Math.min(p + 4, tokens.length); i++) {
      if (bw && bare(tokens[i]).includes(bw)) {
        // Edge sometimes groups several tokens into one boundary ("24 दिसंबर 1971").
        const n = Math.max(1, w.word.split(/\s+/).length);
        const word = tokens.slice(i, i + n).join(" ");
        p = i + n;
        return { ...w, word };
      }
    }
    return w;
  });
}

// ---------- Video shots ----------

/** Deterministic pseudo-random numbers from a string (so re-renders look the same). */
export function seeded(str) {
  let a = [...str].reduce((h, c) => (Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0), 2166136261);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random but gentle camera move: zoom in/out with a slow drift. */
export function randomMove(rand, strength = 1) {
  const zin = rand() < 0.6;
  const r = (x) => Math.round(x * 1e4) / 1e4;
  const z = r(1 + (0.10 + rand() * 0.12) * strength);
  const f = () => r(0.3 + rand() * 0.4);
  return { z0: zin ? 1 : z, z1: zin ? z : 1, fx0: f(), fy0: f(), fx1: f(), fy1: f() };
}

/** Where the host and the "screen" sit in a host scene (1920x1080). panel = the real presenter's box. */
export const STUDIO = { x: 860, y: 250, sw: 1000, sh: 562, hostX: 20, hostY: 190, hostW: 800, hostH: 890, panel: { x: 60, y: 250, w: 740, h: 562 } };
/** Picture-in-picture box for the real presenter (top right, clear of credits and key-word pop-ups). */
export const PIP = { x: 1920 - 40 - 480, y: 40, w: 480, h: 270, border: 5 };

/** Crop the presenter clip into a w×h box around the face (config.presenter.faceY = face height in the photo, 0 top … 1 bottom). */
const presenterFit = (w, h, fps, N) => {
  const F = config.presenter.faceY;
  return `fps=${fps},scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}:(iw-${w})/2:'max(0,min(ih-${h},ih*${F}-${h}/2))',setsar=1,trim=end_frame=${N},setpts=PTS-STARTPTS`;
};

/** Full-screen presenter: the whole picture, centred on a blurred copy of itself (no extreme zoom on portrait photos). */
const presenterFull = (w, h, fps, N) =>
  `fps=${fps},setsar=1,trim=end_frame=${N},setpts=PTS-STARTPTS,split=2[pa][pb];` +
  `[pa]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},gblur=sigma=30,eq=brightness=-0.25[pbg];` +
  `[pb]scale=${w}:${h}:force_original_aspect_ratio=decrease[pfg];[pbg][pfg]overlay=(W-w)/2:(H-h)/2`;

/**
 * Render one shot (video only), exactly `frames` long.
 * - image: a still with a slow camera move · clip: a real video clip (looped if short)
 * - studio: { png, host } → the picture plays on a framed screen with the lip-synced host on the left
 * - presenter: { file, offset, layout } → real presenter clip: layout "full" (talking head), "studio" (left box), "pip"
 * - overlays: [{ png, start, end }] transparent PNGs faded in/out over the whole frame
 */
export async function renderShot({ image, clip, out, frames, fps, w, h, move, overlays = [], studio, presenter }) {
  if (fs.existsSync(out)) return out;
  const N = frames;
  const dur = N / fps;
  const [iw, ih] = studio ? [STUDIO.sw, STUDIO.sh] : [w, h];
  const args = [];
  const f = [];
  if (presenter?.layout === "full") {
    // The presenter fills the frame; the scene's picture isn't shown.
    args.push("-ss", presenter.offset.toFixed(3), "-i", presenter.file);
    f.push(`[0:v]${presenterFull(w, h, fps, N)}[pic]`);
  } else if (clip) {
    args.push("-stream_loop", "-1", "-i", clip);
    f.push(`[0:v]scale=${iw}:${ih}:force_original_aspect_ratio=increase,crop=${iw}:${ih},setsar=1,fps=${fps},eq=contrast=1.06:saturation=1.08,trim=end_frame=${N},setpts=PTS-STARTPTS[pic]`);
  } else {
    const { z0, z1, fx0, fy0, fx1, fy1 } = move;
    const W2 = Math.round(iw * 1.6 / 2) * 2, H2 = Math.round(ih * 1.6 / 2) * 2;
    args.push("-i", image);
    f.push(`[0:v]scale=${W2}:${H2}:force_original_aspect_ratio=increase,crop=${W2}:${H2},setsar=1,` +
      `zoompan=z='${z0}+(${z1 - z0})*on/${N}':x='(${fx0}+(${fx1 - fx0})*on/${N})*(iw-iw/zoom)':y='(${fy0}+(${fy1 - fy0})*on/${N})*(ih-ih/zoom)':d=${N}:s=${iw}x${ih}:fps=${fps}[pic]`);
  }
  let input = 1;
  if (presenter?.layout === "full") {
    f.push(`[pic]null[vb]`);
  } else if (studio) {
    args.push("-loop", "1", "-framerate", String(fps), "-t", dur.toFixed(3), "-i", studio.png);
    f.push(`[1:v][pic]overlay=${STUDIO.x}:${STUDIO.y}:shortest=1[st]`);
    if (presenter?.layout === "studio") {
      const p = STUDIO.panel;
      args.push("-ss", presenter.offset.toFixed(3), "-i", presenter.file);
      f.push(`[2:v]${presenterFit(p.w, p.h, fps, N)}[hs]`);
      f.push(`[st][hs]overlay=${p.x}:${p.y}:eof_action=repeat[vb]`);
    } else {
      args.push("-f", "concat", "-safe", "0", "-i", studio.host);
      f.push(`[2:v]format=rgba,scale=${STUDIO.hostW}:${STUDIO.hostH},setpts=PTS-STARTPTS[hs]`);
      f.push(`[st][hs]overlay=${STUDIO.hostX}:${STUDIO.hostY}:eof_action=repeat[vb]`);
    }
    input = 3;
  } else if (presenter?.layout === "pip") {
    const p = PIP;
    args.push("-ss", presenter.offset.toFixed(3), "-i", presenter.file);
    f.push(`[1:v]${presenterFit(p.w, p.h, fps, N)},pad=${p.w + 2 * p.border}:${p.h + 2 * p.border}:${p.border}:${p.border}:color=0xFFD400[pp]`);
    f.push(`[pic][pp]overlay=${p.x - p.border}:${p.y - p.border}:eof_action=repeat[vb]`);
    input = 2;
  } else f.push(`[pic]null[vb]`);

  // Narrator card: a yellow waveform of the narration under the presenter, moving with his voice.
  const wave = presenter?.audio && { full: { x: 460, y: 940, w: 1000, h: 100 }, studio: { x: STUDIO.panel.x, y: STUDIO.panel.y + STUDIO.panel.h - 90, w: STUDIO.panel.w, h: 84 }, pip: { x: PIP.x, y: PIP.y + PIP.h - 52, w: PIP.w, h: 48 } }[presenter.layout];
  if (wave) {
    args.push("-ss", presenter.offset.toFixed(3), "-i", presenter.audio);
    f.push(`[${input}:a]aformat=channel_layouts=mono,showwaves=s=${wave.w}x${wave.h}:mode=cline:rate=${fps}:colors=0xFFD400:scale=sqrt:draw=full,` +
      `format=rgba,colorkey=0x000000:0.25:0.1,trim=end_frame=${N},setpts=PTS-STARTPTS[wv]`);
    f.push(`[vb]drawbox=x=${wave.x}:y=${wave.y}:w=${wave.w}:h=${wave.h}:color=black@0.35:t=fill[vbx]`);
    f.push(`[vbx][wv]overlay=${wave.x}:${wave.y}:eof_action=pass[v0]`);
    input++;
  } else f.push(`[vb]null[v0]`);
  overlays.forEach((o, i) => {
    args.push("-loop", "1", "-framerate", String(fps), "-t", dur.toFixed(3), "-i", o.png);
    const s = Math.max(0, o.start), e = Math.min(dur, o.end);
    f.push(`[${input + i}:v]format=rgba,fade=in:st=${s.toFixed(2)}:d=0.3:alpha=1,fade=out:st=${Math.max(s, e - 0.4).toFixed(2)}:d=0.4:alpha=1[o${i}]`);
    f.push(`[v${i}][o${i}]overlay=0:0:enable='between(t,${s.toFixed(2)},${e.toFixed(2)})'[v${i + 1}]`);
  });
  f.push(`[v${overlays.length}]format=yuv420p[vout]`);
  await ffmpeg([...args, "-filter_complex", f.join(";"), "-map", "[vout]", "-frames:v", String(N), "-r", String(fps),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-g", String(fps * 2), "-an", out]);
  return out;
}

/** Make a 16:9 still from a photo of any shape: blurred fill behind the whole photo. */
export async function framePhoto(photo, out, w = 1920, h = 1080) {
  if (fs.existsSync(out)) return out;
  await ffmpeg(["-i", photo, "-filter_complex",
    `[0:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},gblur=sigma=40,eq=brightness=-0.15[bg];` +
    `[0:v]scale=${w - 120}:${h - 100}:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2`,
    "-frames:v", "1", "-q:v", "2", out]);
  return out;
}

/** Concatenate files with identical encoding settings (no re-encode). */
export async function concatCopy(files, out, cwd) {
  const list = path.join(cwd, path.basename(out) + ".txt");
  fs.writeFileSync(list, files.map((f) => `file '${path.relative(cwd, f).replace(/\\/g, "/")}'`).join("\n"));
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", path.basename(list), "-c", "copy", path.basename(out)], { cwd });
  return out;
}

/** Narration padded (or trimmed) to exactly `seconds`, as 48 kHz stereo WAV so pieces join without clicks. */
export async function padAudio(input, seconds, out) {
  if (fs.existsSync(out)) return out;
  const args = input ? ["-i", input] : ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"];
  await ffmpeg([...args, "-af", "apad,aresample=48000", "-ac", "2", "-t", seconds.toFixed(4), "-c:a", "pcm_s16le", out]);
  return out;
}

/**
 * The audio mix, documentary style: narration (loudness-normalised) + sound effects + background music that
 * automatically dips while the narrator speaks and rises in the pauses (side-chain "ducking").
 * Returns the FFmpeg filter; inputs are [narration, sfx?, music?] starting at input index `first`.
 */
export function audioMix({ first, sfx, music, voiceLoudness = -15 }) {
  let i = first;
  const parts = [`[${i++}:a]loudnorm=I=${voiceLoudness}:TP=-1.5:LRA=11,aresample=48000${music ? ",asplit=2[vo][key]" : "[vo]"}`];
  const mix = ["[vo]"];
  if (sfx) { parts.push(`[${i++}:a]volume=0.5,aresample=48000[fx]`); mix.push("[fx]"); }
  if (music) {
    parts.push(`[${i++}:a]aresample=48000,volume=0.32[mraw]`, `[mraw][key]sidechaincompress=threshold=0.02:ratio=12:attack=15:release=500[mduck]`);
    mix.push("[mduck]");
  }
  parts.push(mix.length > 1 ? `${mix.join("")}amix=inputs=${mix.length}:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.97[a]` : `[vo]anull[a]`);
  return parts.join(";");
}

/** Final mix of the long video (video stream copied as-is). */
export async function mux({ video, narration, sfx, music, out, cwd }) {
  const rel = (f) => path.relative(cwd, f);
  const args = ["-i", rel(video), "-i", rel(narration)];
  if (sfx) args.push("-i", rel(sfx));
  if (music) args.push("-i", rel(music));
  await ffmpeg([...args, "-filter_complex", audioMix({ first: 1, sfx, music }), "-map", "0:v", "-map", "[a]", "-c:v", "copy",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-shortest", "-movflags", "+faststart", path.basename(out)], { cwd });
  return out;
}

/** Royalty-free tracks in assets/music/ (add your own, e.g. from YouTube Studio → Audio Library). */
export function musicTracks(root) {
  const dir = path.join(root, "assets/music");
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.(mp3|m4a|wav)$/i.test(f)).sort().map((f) => path.join(dir, f)) : [];
}

/** A background-music bed at least `seconds` long: shuffled tracks, each faded in/out, joined end to end. */
export async function musicBed(root, seconds, dir, seed) {
  const tracks = musicTracks(root);
  if (!tracks.length) return null;
  const rand = seeded(seed);
  const order = [...tracks].sort(() => rand() - 0.5);
  fs.mkdirSync(dir, { recursive: true });
  const pieces = [];
  let total = 0;
  for (let k = 0; total < seconds + 5; k++) {
    const src = order[k % order.length];
    const out = path.join(dir, `m${k}.wav`);
    const len = await mediaDuration(src);
    if (!fs.existsSync(out)) await ffmpeg(["-i", src, "-af", `afade=t=in:d=1.5,afade=t=out:st=${Math.max(0, len - 2.5).toFixed(2)}:d=2.5,aresample=48000`, "-ac", "2", "-c:a", "pcm_s16le", out]);
    pieces.push(out);
    total += len;
  }
  return concatCopy(pieces, path.join(dir, "music.wav"), dir);
}

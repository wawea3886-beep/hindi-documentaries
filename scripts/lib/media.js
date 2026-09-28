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
  if (res.status === 429 || /4006|daily free allocation|neurons/i.test(body)) throw Object.assign(new Error("Cloudflare daily limit reached"), { quota: true });
  if (!res.ok) throw new Error(`Cloudflare ${res.status}: ${body.slice(0, 200)}`);
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
      if (!disabled.has(name)) console.warn(`    ${name}: ${e.message.split("\n")[0]}`);
      else console.warn(`    ${name}: daily limit reached — using other sources for the rest of today`);
    }
  }
  return null;
}

// ---------- Narration ----------

export class Narrator {
  constructor(voice = config.voice, rate = config.speechRate) { this.voice = voice; this.rate = rate; this.tts = null; }

  async #connect() {
    this.tts?.close();
    this.tts = new MsEdgeTTS();
    await this.tts.setMetadata(this.voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3, { wordBoundaryEnabled: true });
  }

  /** Speak `text` into `dir`/audio.mp3; returns word timings (seconds) and duration. Cached on disk. */
  async say(text, dir) {
    const cache = path.join(dir, "words.json");
    if (fs.existsSync(cache)) return JSON.parse(fs.readFileSync(cache, "utf8"));
    fs.mkdirSync(dir, { recursive: true });
    const result = await retry(async () => {
      if (!this.tts) await this.#connect();
      try {
        const { audioFilePath, metadataFilePath } = await this.tts.toFile(dir, text, { rate: this.rate });
        const meta = metadataFilePath && fs.existsSync(metadataFilePath) ? JSON.parse(fs.readFileSync(metadataFilePath, "utf8")) : { Metadata: [] };
        const words = meta.Metadata.filter((m) => m.Type === "WordBoundary")
          .map((m) => ({ word: m.Data.text.Text, start: m.Data.Offset / 1e7, end: (m.Data.Offset + m.Data.Duration) / 1e7 }));
        const duration = await mediaDuration(audioFilePath);
        if (!(duration > 0.3)) throw new Error("empty audio");
        return { audio: audioFilePath, words, duration };
      } catch (e) {
        this.tts = null; // reconnect on the next attempt
        throw e;
      }
    }, { tries: 4, delayMs: 3000, label: "narration" });
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

/**
 * Render one still image as a moving shot (video only), exactly `frames` long.
 * overlays: [{ png, start, end }] transparent PNGs faded in/out over the picture.
 */
export async function renderShot({ image, out, frames, fps, w, h, move, overlays = [] }) {
  if (fs.existsSync(out)) return out;
  const { z0, z1, fx0, fy0, fx1, fy1 } = move;
  const N = frames;
  const W2 = Math.round(w * 1.6 / 2) * 2, H2 = Math.round(h * 1.6 / 2) * 2;
  const dur = N / fps;
  const args = ["-i", image];
  overlays.forEach((o) => args.push("-loop", "1", "-framerate", String(fps), "-t", dur.toFixed(3), "-i", o.png));
  const f = [
    `[0:v]scale=${W2}:${H2}:force_original_aspect_ratio=increase,crop=${W2}:${H2},setsar=1,` +
    `zoompan=z='${z0}+(${z1 - z0})*on/${N}':x='(${fx0}+(${fx1 - fx0})*on/${N})*(iw-iw/zoom)':y='(${fy0}+(${fy1 - fy0})*on/${N})*(ih-ih/zoom)':d=${N}:s=${w}x${h}:fps=${fps}[v0]`,
  ];
  overlays.forEach((o, i) => {
    const s = Math.max(0, o.start), e = Math.min(dur, o.end);
    f.push(`[${i + 1}:v]format=rgba,fade=in:st=${s.toFixed(2)}:d=0.4:alpha=1,fade=out:st=${Math.max(s, e - 0.4).toFixed(2)}:d=0.4:alpha=1[o${i}]`);
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

/** Final mix: video + narration (+ optional quiet background music), loudness-normalised. */
export async function mux({ video, narration, music, out, cwd }) {
  const args = ["-i", path.relative(cwd, video), "-i", path.relative(cwd, narration)];
  let filter = "[1:a]loudnorm=I=-15:TP=-1.5:LRA=11[a]";
  if (music) {
    args.push("-stream_loop", "-1", "-i", path.relative(cwd, music));
    filter = "[1:a]loudnorm=I=-15:TP=-1.5:LRA=11[v];[2:a]volume=0.07,aresample=48000[m];[v][m]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]";
  }
  await ffmpeg([...args, "-filter_complex", filter, "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
    "-ar", "48000", "-shortest", "-movflags", "+faststart", path.basename(out)], { cwd });
  return out;
}

/** A random royalty-free track from assets/music/ (optional — add your own). */
export function pickMusic(root, seed) {
  const dir = path.join(root, "assets/music");
  if (!fs.existsSync(dir)) return null;
  const tracks = fs.readdirSync(dir).filter((f) => /\.(mp3|m4a|wav)$/i.test(f)).sort();
  return tracks.length ? path.join(dir, tracks[Math.floor(seeded(seed)() * tracks.length)]) : null;
}

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import ffmpegPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const EPISODES_DIR = path.join(ROOT, "content/episodes");
export const IMAGES_DIR = path.join(ROOT, "content/images"); // small web images kept in git for the website
export const WORK_DIR = path.join(ROOT, "work"); // big temp files (audio/video), git-ignored
export const FONTS_DIR = path.join(ROOT, "assets/fonts");

/** Date in UTC as YYYY-MM-DD. `--date=2026-09-28` on the command line overrides "today". */
export function today() {
  const arg = process.argv.find((a) => a.startsWith("--date="));
  return arg ? arg.slice(7) : new Date().toISOString().slice(0, 10);
}

export const hasFlag = (name) => process.argv.includes(`--${name}`);
export const argValue = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];

/** True when the calling module was run directly (`node scripts/x.js`) rather than imported. */
export const isMain = (metaUrl) => !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(metaUrl);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function slugify(s) {
  return s.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_-]+/g, "-").slice(0, 70).replace(/-$/, "");
}

export const episodeFile = (date) => path.join(EPISODES_DIR, `${date}.json`);
export const workDir = (date, ...parts) => path.join(WORK_DIR, date, ...parts);

export function readEpisode(date) {
  const f = episodeFile(date);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null;
}

export function writeEpisode(ep) {
  fs.mkdirSync(EPISODES_DIR, { recursive: true });
  fs.writeFileSync(episodeFile(ep.date), JSON.stringify(ep, null, 2) + "\n");
}

/** All saved episodes, newest first. */
export function allEpisodes() {
  if (!fs.existsSync(EPISODES_DIR)) return [];
  return fs.readdirSync(EPISODES_DIR).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().reverse()
    .map((f) => JSON.parse(fs.readFileSync(path.join(EPISODES_DIR, f), "utf8")));
}

function run(bin, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { cwd: opts.cwd, windowsHide: true });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`${path.basename(bin)} exited ${code}\n${err.slice(-2000)}`))));
  });
}

export const ffmpeg = (args, opts) => run(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-y", ...args], opts);

export async function mediaDuration(file) {
  const out = await run(ffprobeStatic.path, ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file]);
  return parseFloat(out);
}

export async function retry(fn, { tries = 3, delayMs = 3000, label = "task" } = {}) {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= tries) throw e;
      console.warn(`  ${label} failed (attempt ${i}/${tries}): ${e.message.split("\n")[0]} — retrying`);
      await sleep(delayMs * i);
    }
  }
}

/** "13:00" or "27:30" (hours ≥ 24 = next day) → ISO time on `date`, never in the past. */
export function scheduleTime(date, hhmm, notBefore = 0) {
  const [h, m] = hhmm.split(":").map(Number);
  const t = Date.parse(`${date}T00:00:00Z`) + (h * 60 + m) * 60000;
  return new Date(Math.max(t, notBefore, Date.now() + 20 * 60000)).toISOString().replace(/\.\d{3}Z$/, ".000Z");
}

/** Seconds → "MM:SS" or "H:MM:SS" (YouTube chapter format). */
export function clock(sec) {
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

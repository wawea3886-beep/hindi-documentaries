// Free stock video clips from Pexels (free licence, no attribution required — we credit anyway).
import fs from "node:fs";
import { retry } from "./util.js";

const used = new Set(); // don't show the same clip twice in one video
export const credits = new Map(); // clip id → { user, url }

const STOP = new Set("a an the of in on at to from with and or for by into onto over under above below near toward towards his her their its this that these those is are was were be being been very while during inside outside behind front between".split(" "));

/** 2-4 search words from an illustration prompt ("a 1970s airliner flying toward dark storm clouds" → "1970s airliner flying toward"). */
export const searchWords = (prompt = "") =>
  prompt.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)).slice(0, 4).join(" ");

const usedPhotos = new Set();

/** Download a landscape stock PHOTO matching `query` (fallback when AI pictures aren't available). Returns { path, credit } or null. */
export async function stockPhoto(query, out) {
  const key = process.env.PEXELS_API_KEY;
  if (!key || !query) return null;
  if (fs.existsSync(out) && fs.existsSync(out + ".json")) return { path: out, ...JSON.parse(fs.readFileSync(out + ".json", "utf8")) };
  try {
    const r = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&orientation=landscape&per_page=15`,
      { headers: { Authorization: key }, signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`Pexels photos ${r.status}`);
    const photo = ((await r.json()).photos || []).find((p) => !usedPhotos.has(p.id));
    if (!photo) return null;
    usedPhotos.add(photo.id);
    const img = await fetch(photo.src.large2x || photo.src.large, { signal: AbortSignal.timeout(60000) });
    if (!img.ok) throw new Error(`photo download ${img.status}`);
    fs.writeFileSync(out, Buffer.from(await img.arrayBuffer()));
    const meta = { id: photo.id, credit: { user: photo.photographer || "Pexels", url: photo.url } };
    fs.writeFileSync(out + ".json", JSON.stringify(meta));
    return { path: out, ...meta };
  } catch (e) {
    console.warn(`    stock photo "${query}": ${e.message.split("\n")[0]}`);
    return null;
  }
}

/** Download a landscape clip matching `query` to `out`. Returns { path, credit } or null. */
export async function stockClip(query, out) {
  const key = process.env.PEXELS_API_KEY;
  if (!key || !query) return null;
  if (fs.existsSync(out) && fs.existsSync(out + ".json")) return { path: out, ...JSON.parse(fs.readFileSync(out + ".json", "utf8")) };
  try {
    const res = await retry(async () => {
      const r = await fetch(`https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&orientation=landscape&size=medium&per_page=15`,
        { headers: { Authorization: key }, signal: AbortSignal.timeout(30000) });
      if (r.status === 429) throw Object.assign(new Error("Pexels rate limit"), { quota: true });
      if (!r.ok) throw new Error(`Pexels ${r.status}`);
      return r.json();
    }, { tries: 2, label: "Pexels search" });
    const video = (res.videos || []).find((v) => !used.has(v.id) && v.duration >= 4);
    if (!video) return null;
    const file = (video.video_files || [])
      .filter((f) => f.file_type === "video/mp4" && f.width >= 1280 && f.width <= 1920 && f.width > f.height)
      .sort((a, b) => a.width - b.width)[0];
    if (!file) return null;
    used.add(video.id);
    await retry(async () => {
      const r = await fetch(file.link, { signal: AbortSignal.timeout(120000) });
      if (!r.ok) throw new Error(`clip download ${r.status}`);
      fs.writeFileSync(out, Buffer.from(await r.arrayBuffer()));
    }, { tries: 2, label: "clip download" });
    const meta = { id: video.id, credit: { user: video.user?.name || "Pexels", url: video.url } };
    fs.writeFileSync(out + ".json", JSON.stringify(meta));
    credits.set(video.id, meta.credit);
    return { path: out, ...meta };
  } catch (e) {
    console.warn(`    clip "${query}": ${e.message.split("\n")[0]}`);
    return null;
  }
}

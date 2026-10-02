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

// ---------- Stock VIDEO (Pexels + Pixabay, both free for commercial use) ----------

const searches = new Map(); // query → normalised results (each search is made once per run)
const limited = new Set(); // sources that hit their rate limit during this run

async function pexelsVideos(query) {
  const key = process.env.PEXELS_API_KEY;
  if (!key || limited.has("pexels")) return [];
  const r = await fetch(`https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&orientation=landscape&size=medium&per_page=20`,
    { headers: { Authorization: key }, signal: AbortSignal.timeout(30000) });
  if (r.status === 429) { limited.add("pexels"); console.warn("    Pexels hourly limit reached — using other sources"); return []; }
  if (!r.ok) throw new Error(`Pexels ${r.status}`);
  return ((await r.json()).videos || []).flatMap((v) => {
    const f = (v.video_files || []).filter((x) => x.file_type === "video/mp4" && x.width >= 1280 && x.width <= 1920 && x.width > x.height).sort((a, b) => a.width - b.width)[0];
    return f && v.duration >= 4 ? [{ id: `px${v.id}`, duration: v.duration, url: f.link, credit: { user: v.user?.name || "Pexels", url: v.url, site: "Pexels" } }] : [];
  });
}

async function pixabayVideos(query) {
  const key = process.env.PIXABAY_API_KEY;
  if (!key || limited.has("pixabay")) return [];
  const r = await fetch(`https://pixabay.com/api/videos/?key=${encodeURIComponent(key)}&q=${encodeURIComponent(query.slice(0, 100))}&per_page=20&safesearch=true`,
    { signal: AbortSignal.timeout(30000) });
  if (r.status === 429) { limited.add("pixabay"); return []; }
  if (!r.ok) throw new Error(`Pixabay ${r.status}`);
  return ((await r.json()).hits || []).flatMap((h) => {
    const f = [h.videos?.large, h.videos?.medium].find((x) => x?.url && x.width >= 1280 && x.width <= 1920);
    return f && h.duration >= 4 ? [{ id: `pb${h.id}`, duration: h.duration, url: f.url, credit: { user: h.user || "Pixabay", url: h.pageURL, site: "Pixabay" } }] : [];
  });
}

async function searchVideos(query) {
  if (searches.has(query)) return searches.get(query);
  let results = [];
  for (const q of [query, query.split(" ").slice(0, 2).join(" ")]) { // full query, then a broader one
    if (!q) continue;
    for (const source of [pexelsVideos, pixabayVideos]) {
      try { results.push(...(await retry(() => source(q), { tries: 2, label: "video search" }))); }
      catch (e) { console.warn(`    video search "${q}": ${e.message.split("\n")[0]}`); }
    }
    if (results.length >= 3) break;
  }
  searches.set(query, results);
  return results;
}

/**
 * Up to `count` DIFFERENT clips matching `query` (never one already used in this video).
 * Returns [{ path, duration, credit }] — may be empty.
 */
export async function stockClips(query, count, outBase) {
  if (!query) return [];
  const cached = [];
  for (let i = 0; i < count; i++) {
    const f = `${outBase}-${i}.mp4`;
    if (fs.existsSync(f) && fs.existsSync(f + ".json")) cached.push({ path: f, ...JSON.parse(fs.readFileSync(f + ".json", "utf8")) });
  }
  if (cached.length === count) return cached;
  const picked = (await searchVideos(query)).filter((v) => !used.has(v.id)).slice(0, count);
  const out = [];
  for (const [i, v] of picked.entries()) {
    used.add(v.id);
    const f = `${outBase}-${i}.mp4`;
    try {
      if (!fs.existsSync(f)) {
        await retry(async () => {
          const r = await fetch(v.url, { signal: AbortSignal.timeout(180000) });
          if (!r.ok) throw new Error(`clip download ${r.status}`);
          fs.writeFileSync(f, Buffer.from(await r.arrayBuffer()));
        }, { tries: 2, label: "clip download" });
      }
      const meta = { id: v.id, duration: v.duration, credit: v.credit };
      fs.writeFileSync(f + ".json", JSON.stringify(meta));
      credits.set(v.id, v.credit);
      out.push({ path: f, ...meta });
    } catch (e) {
      console.warn(`    clip "${query}": ${e.message.split("\n")[0]}`);
    }
  }
  return out;
}

/** One clip (kept for older callers). */
export async function stockClip(query, out) {
  return (await stockClips(query, 1, out.replace(/\.mp4$/, "")))[0] || null;
}

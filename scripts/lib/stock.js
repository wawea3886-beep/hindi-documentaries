// Free stock video clips from Pexels (free licence, no attribution required — we credit anyway).
import fs from "node:fs";
import { retry } from "./util.js";

const used = new Set(); // don't show the same clip twice in one video
export const credits = new Map(); // clip id → { user, url }

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

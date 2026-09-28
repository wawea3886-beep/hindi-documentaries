// Free research sources: Wikipedia (trending + article text) and Wikimedia Commons (freely licensed photos).
import fs from "node:fs";
import { retry } from "./util.js";

const UA = { "User-Agent": "SachKiKahaniBot/1.0 (daily documentary research; https://github.com)" };
const API = "https://en.wikipedia.org/w/api.php?format=json&formatversion=2&origin=*&";

async function getJSON(url) {
  return retry(async () => {
    const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`${r.status} ${url.slice(0, 120)}`);
    return r.json();
  }, { tries: 3, label: "Wikipedia" });
}

/** What people are reading right now + what happened on this day in history. */
export async function trendingTopics(date) {
  const d = new Date(Date.parse(date + "T00:00:00Z") - 86400000); // yesterday's complete data
  const [y, m, dd] = [d.getUTCFullYear(), String(d.getUTCMonth() + 1).padStart(2, "0"), String(d.getUTCDate()).padStart(2, "0")];
  const [mm2, dd2] = date.slice(5).split("-");
  const out = { mostRead: [], onThisDay: [] };
  try {
    const f = await getJSON(`https://en.wikipedia.org/api/rest_v1/feed/featured/${y}/${m}/${dd}`);
    out.mostRead = (f.mostread?.articles || []).slice(0, 40).map((a) => `${a.titles.normalized} — ${a.description || ""}`);
  } catch (e) { console.warn("  trending unavailable:", e.message); }
  try {
    const o = await getJSON(`https://en.wikipedia.org/api/rest_v1/feed/onthisday/events/${mm2}/${dd2}`);
    out.onThisDay = o.events.slice(0, 40).map((e) => `${e.year}: ${e.text} [${e.pages?.[0]?.titles?.normalized || ""}]`);
  } catch (e) { console.warn("  on-this-day unavailable:", e.message); }
  return out;
}

/** Plain-text article (or null if it doesn't exist). */
export async function fetchArticle(title) {
  const j = await getJSON(`${API}action=query&prop=extracts|info&inprop=url&explaintext=1&redirects=1&titles=${encodeURIComponent(title)}`);
  const p = j.query?.pages?.[0];
  if (!p || p.missing || !p.extract) return null;
  const text = p.extract.split(/\n==+ (See also|References|Notes|Further reading|External links|Bibliography|Citations|Sources) ==+/)[0];
  return { title: p.title, url: p.fullurl, text: text.replace(/\n{3,}/g, "\n\n").trim() };
}

const FREE_LICENSE = /^(public domain|pd|cc0|cc[- ]by(-sa)?[- ]?\d|cc[- ]by(-sa)?$|attribution|no restrictions)/i;
const strip = (h = "") => h.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

/** Freely licensed photos used in these articles, with the attribution details we must show. */
export async function fetchPhotos(titles, max = 24) {
  const photos = [];
  const seen = new Set();
  for (const t of titles) {
    const j = await getJSON(`${API}action=query&generator=images&gimlimit=60&prop=imageinfo&iiprop=url|size|mime|extmetadata&iiurlwidth=1920&redirects=1&titles=${encodeURIComponent(t)}`);
    for (const pg of j.query?.pages || []) {
      const ii = pg.imageinfo?.[0];
      if (!ii || seen.has(pg.title)) continue;
      seen.add(pg.title);
      const m = ii.extmetadata || {};
      const license = strip(m.LicenseShortName?.value);
      const isPhoto = /image\/(jpeg|png)/.test(ii.mime) || (ii.mime === "image/svg+xml" && /map|locator|location|route/i.test(pg.title));
      if (!isPhoto || ii.width < 500 || ii.height < 300) continue;
      if (!FREE_LICENSE.test(license) || /non-?free|fair use/i.test(license + (m.UsageTerms?.value || ""))) continue;
      if (/logo|icon|flag of|coat of arms|signature|commons-logo|wiki/i.test(pg.title)) continue;
      photos.push({
        id: `p${photos.length + 1}`,
        title: pg.title.replace(/^File:/, "").replace(/\.\w+$/, ""),
        description: strip(m.ImageDescription?.value).slice(0, 200),
        url: ii.thumburl || ii.url,
        page: ii.descriptionurl,
        width: ii.thumbwidth || ii.width, height: ii.thumbheight || ii.height,
        artist: strip(m.Artist?.value).slice(0, 80) || "Unknown",
        license, licenseUrl: m.LicenseUrl?.value || "",
      });
      if (photos.length >= max) return photos;
    }
  }
  return photos;
}

export async function downloadPhoto(photo, out) {
  if (fs.existsSync(out)) return;
  await retry(async () => {
    const r = await fetch(photo.url, { headers: UA, signal: AbortSignal.timeout(60000) });
    if (!r.ok) throw new Error(`${r.status} ${photo.url}`);
    fs.writeFileSync(out, Buffer.from(await r.arrayBuffer()));
  }, { tries: 3, label: "photo download" });
}

// Step 5: build the static, SEO-optimized English website into dist/ from content/.
// Usage: node scripts/build-site.js     (preview locally: npm run preview)
import fs from "node:fs";
import path from "node:path";
import config from "../config.js";
import { allEpisodes, isMain, clock, ROOT, IMAGES_DIR, FONTS_DIR } from "./lib/util.js";

const DIST = path.join(ROOT, "dist");
const BASE = new URL(config.siteUrl).pathname.replace(/\/$/, ""); // "" or "/repo-name" on GitHub Pages
const abs = (p) => config.siteUrl + p;
const url = (p) => BASE + p;
const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const niceDate = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const now = Date.now();
const live = (v) => v?.videoId && Date.parse(v.publishAt) <= now;
const CATS = {
  mystery: "Mysteries", disaster: "Disasters", survival: "Survival Stories", history: "History",
  science: "Science & Nature", crime: "True Crime", scam: "Scams & Frauds",
};
const catName = (c) => CATS[c] || CATS.history;
const thumb = (ep) => (fs.existsSync(path.join(IMAGES_DIR, ep.date, "thumb.jpg")) ? `/images/${ep.date}/thumb.jpg` : "/og.svg");
const minutes = (ep) => Math.round((ep.render?.duration || (ep.wordCount || 3900) / 2.4) / 60);

function layout({ title, description, canonical, image, jsonld = [], body, type = "website" }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(abs(canonical))}">
<meta property="og:type" content="${type}">
<meta property="og:site_name" content="${esc(config.siteName)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(abs(canonical))}">
<meta property="og:image" content="${esc(abs(image || url("/og.svg")))}">
<meta name="twitter:card" content="summary_large_image">
<link rel="alternate" type="application/rss+xml" title="${esc(config.siteName)}" href="${url("/feed.xml")}">
<link rel="icon" href="${url("/favicon.svg")}" type="image/svg+xml">
<link rel="stylesheet" href="${url("/styles.css")}">
${jsonld.map((j) => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, "\\u003c")}</script>`).join("\n")}
</head>
<body>
<header class="top"><div class="wrap">
  <a class="logo" href="${url("/")}">${esc(config.siteName)}</a>
  <nav>${["mystery", "disaster", "survival", "history"].map((k) => `<a href="${url(`/category/${k}/`)}">${CATS[k]}</a>`).join("")}<a href="${url("/archive/")}">All videos</a>${config.youtubeChannelUrl ? `<a class="yt" href="${esc(config.youtubeChannelUrl)}" rel="noopener">▶ YouTube</a>` : ""}</nav>
</div></header>
<main>
${body}
</main>
<footer class="foot"><div class="wrap">
  <p><strong>${esc(config.siteName)}</strong> — ${esc(config.siteTagline)}</p>
  <p class="small">Every documentary is researched from the sources listed on its page. Narration voice, the animated host and illustrations are AI-generated; real photos and stock footage are credited. <a href="${url("/privacy/")}">Privacy policy</a></p>
</div></footer>
<script>
document.querySelectorAll("[data-publish]").forEach(function (el) {
  var t = Date.parse(el.dataset.publish);
  if (Date.now() >= t) {
    el.innerHTML = '<iframe src="https://www.youtube-nocookie.com/embed/' + el.dataset.video + '" title="' + (el.dataset.title || "Video") + '" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen loading="lazy"></iframe>';
    el.classList.add("live");
  } else {
    var w = el.querySelector(".when");
    if (w) w.textContent = new Date(t).toLocaleString([], { weekday: "long", hour: "numeric", minute: "2-digit" });
  }
});
</script>
</body>
</html>`;
}

function card(ep) {
  return `<a class="card" href="${url(`/videos/${ep.meta.slug}/`)}">
  <div class="thumb"><img src="${url(thumb(ep))}" alt="${esc(ep.meta.youtubeTitle)}" width="1280" height="720" loading="lazy"><span class="dur">${minutes(ep)} min</span></div>
  <span class="cat">${esc(catName(ep.topic.category))}</span>
  <h3>${esc(ep.meta.youtubeTitle)}</h3>
  <p>${esc((ep.meta.metaDescription || "").slice(0, 120))}</p>
</a>`;
}
const grid = (eps) => `<div class="grid">${eps.map(card).join("\n")}</div>`;

/** English paragraphs for a chapter (older episodes without an English article fall back to the narration). */
function paragraphs(ch) {
  if (ch.articleEn?.length) return ch.articleEn.map((p) => `<p>${esc(p)}</p>`).join("\n");
  const out = [];
  for (let i = 0; i < ch.beats.length; i += 3) out.push(`<p>${esc(ch.beats.slice(i, i + 3).map((b) => b.roman || b.text).join(" "))}</p>`);
  return out.join("\n");
}

function videoPage(ep) {
  const canonical = `/videos/${ep.meta.slug}/`;
  const L = ep.youtube?.long;
  const chapters = ep.render?.chapters || [];
  const usedPhotos = new Set(ep.chapters.flatMap((c) => c.beats).filter((b) => b.visual.type === "photo").map((b) => b.visual.photo));
  const photos = ep.photos.filter((p) => usedPhotos.has(p.id));
  const clips = ep.render?.clipCredits || [];
  const player = L?.videoId
    ? `<div class="player" data-publish="${esc(L.publishAt)}" data-video="${esc(L.videoId)}" data-title="${esc(ep.meta.youtubeTitle)}"><img src="${url(thumb(ep))}" alt="" width="1280" height="720"><p>🎬 The video premieres <strong class="when">soon</strong></p></div>`
    : `<div class="player"><img src="${url(thumb(ep))}" alt="${esc(ep.meta.youtubeTitle)}" width="1280" height="720"></div>`;
  const shorts = ep.shorts.map((s) => ({ s, y: ep.youtube?.shorts?.[s.id] })).filter((x) => x.y?.videoId);

  const jsonld = [{
    "@context": "https://schema.org", "@type": "Article",
    headline: ep.meta.youtubeTitle, description: ep.meta.metaDescription,
    image: abs(url(thumb(ep))), datePublished: ep.date, inLanguage: "en", keywords: ep.meta.tags.join(", "),
    author: { "@type": "Organization", name: config.siteName }, publisher: { "@type": "Organization", name: config.siteName },
    mainEntityOfPage: abs(url(canonical)), citation: ep.sources.map((s) => s.url),
  }, {
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: abs(url("/")) },
      { "@type": "ListItem", position: 2, name: catName(ep.topic.category), item: abs(url(`/category/${ep.topic.category}/`)) },
      { "@type": "ListItem", position: 3, name: ep.meta.youtubeTitle, item: abs(url(canonical)) },
    ],
  }];
  if (live(L)) jsonld.push({
    "@context": "https://schema.org", "@type": "VideoObject", name: ep.meta.youtubeTitle, description: ep.meta.metaDescription,
    thumbnailUrl: [abs(url(thumb(ep))), `https://i.ytimg.com/vi/${L.videoId}/maxresdefault.jpg`], uploadDate: L.publishAt,
    inLanguage: ep.language || "hi",
    duration: `PT${Math.floor(ep.render.duration / 60)}M${Math.round(ep.render.duration % 60)}S`,
    embedUrl: `https://www.youtube-nocookie.com/embed/${L.videoId}`, contentUrl: L.url,
    hasPart: chapters.map((c, i) => ({ "@type": "Clip", name: c.titleEn, startOffset: Math.floor(c.start), endOffset: Math.floor(chapters[i + 1]?.start ?? ep.render.duration), url: `${L.url}&t=${Math.floor(c.start)}s` })),
  });

  const body = `<article class="doc wrap">
<nav class="crumbs"><a href="${url("/")}">Home</a> › <a href="${url(`/category/${ep.topic.category}/`)}">${esc(catName(ep.topic.category))}</a></nav>
<h1>${esc(ep.meta.youtubeTitle)}</h1>
<p class="meta">${esc(niceDate(ep.date))} · ${minutes(ep)}-minute documentary · ${esc(catName(ep.topic.category))}</p>
${player}
<p class="lead">${esc(ep.meta.descriptionEn)}</p>
${chapters.length ? `<nav class="toc"><h2>Chapters</h2><ol>${ep.chapters.map((c, i) => `<li><a href="#ch${i + 1}">${esc(c.titleEn)}</a> <span>${clock(chapters[i]?.start || 0)}</span></li>`).join("")}</ol></nav>` : ""}
${ep.chapters.map((c, i) => {
    const im = ep.render?.chapterImages?.[i];
    const p = im?.photo && ep.photos.find((x) => x.id === im.photo);
    const caption = p ? `Photo: ${esc(p.artist)} · <a href="${esc(p.page)}" rel="noopener">${esc(p.license)}</a> · Wikimedia Commons` : im?.kind === "map" ? "Map data: Natural Earth" : "AI illustration";
    return `<section id="ch${i + 1}">
<h2><small>Chapter ${i + 1}</small>${esc(c.titleEn)}</h2>
${im ? `<figure><img src="${url(`/images/${ep.date}/${im.file}`)}" alt="${esc(c.titleEn)}" width="800" height="450" loading="lazy"><figcaption>${caption}</figcaption></figure>` : ""}
${paragraphs(c)}
</section>`;
  }).join("\n")}
${shorts.length ? `<section><h2>Shorts</h2><div class="shorts">${shorts.map(({ s, y }) => `<div class="short" data-publish="${esc(y.publishAt)}" data-video="${esc(y.videoId)}" data-title="${esc(s.titleEn)}"><p>${esc(s.titleEn)}<br><small>Premieres: <span class="when"></span></small></p></div>`).join("")}</div></section>` : ""}
<section class="sources"><h2>Sources</h2><ol>${ep.sources.map((s) => `<li><a href="${esc(s.url)}" rel="noopener">${esc(s.title)}</a> — Wikipedia (CC BY-SA 4.0)</li>`).join("")}</ol>
${photos.length ? `<h3>Photo credits</h3><ul>${photos.map((p) => `<li><a href="${esc(p.page)}" rel="noopener">${esc(p.title)}</a> — ${esc(p.artist)}, ${p.licenseUrl ? `<a href="${esc(p.licenseUrl)}" rel="noopener">${esc(p.license)}</a>` : esc(p.license)}</li>`).join("")}</ul>` : ""}
${clips.length ? `<h3>Stock footage &amp; photos</h3><ul>${clips.map((c) => `<li><a href="${esc(c.url)}" rel="noopener">By ${esc(c.user)}</a> on Pexels</li>`).join("")}</ul>` : ""}
<p class="small">This documentary is based on the sources above and was fact-checked before publishing. The narration voice, animated host and illustrations are AI-generated. Spotted a mistake? Tell us in the YouTube comments.</p></section>
</article>`;
  return layout({ title: `${ep.meta.youtubeTitle} | ${config.siteName}`, description: ep.meta.metaDescription, canonical: url(canonical), image: url(thumb(ep)), jsonld, type: "article", body });
}

function write(rel, content) {
  const f = path.join(DIST, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, content);
}

/** Demo episodes (made with --mock) are only included when `withDemo` is set, so they never reach the live site. */
export function buildSite({ withDemo = process.argv.includes("--with-demo") || process.argv.includes("--mock") } = {}) {
  const eps = allEpisodes().filter((e) => e.stage === "done" && e.meta && (withDemo || !e.mock));
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.cpSync(path.join(ROOT, "site"), DIST, { recursive: true });
  if (fs.existsSync(IMAGES_DIR)) fs.cpSync(IMAGES_DIR, path.join(DIST, "images"), { recursive: true });
  for (const f of ["Anton-Regular.ttf", "Mukta-Regular.ttf", "Mukta-ExtraBold.ttf"]) fs.copyFileSync(path.join(FONTS_DIR, f), path.join(DIST, f));

  const [latest, ...older] = eps;
  write("index.html", layout({
    title: `${config.siteName} — Documentaries: Mysteries, Disasters & True Stories`,
    description: `${config.siteTaglineEn}. Watch and read researched documentaries with sources.`,
    canonical: url("/"),
    jsonld: [{ "@context": "https://schema.org", "@type": "WebSite", name: config.siteName, url: abs(url("/")), inLanguage: "en", description: config.siteTaglineEn }],
    body: latest ? `<section class="hero"><div class="wrap hero-in">
  <a href="${url(`/videos/${latest.meta.slug}/`)}" class="hero-img"><img src="${url(thumb(latest))}" alt="${esc(latest.meta.youtubeTitle)}" width="1280" height="720"></a>
  <div><span class="cat">Today's documentary · ${esc(niceDate(latest.date))}</span>
  <h1>${esc(latest.meta.youtubeTitle)}</h1>
  <p>${esc(latest.meta.descriptionEn)}</p>
  <a class="btn" href="${url(`/videos/${latest.meta.slug}/`)}">▶ Watch &amp; read</a></div>
</div></section>
<div class="wrap">${older.length ? `<h2>Previous documentaries</h2>${grid(older.slice(0, 12))}<p class="center"><a class="btn ghost" href="${url("/archive/")}">All ${eps.length} videos →</a></p>` : ""}</div>`
      : `<div class="wrap"><section class="hero-empty"><h1>${esc(config.siteName)}</h1><p>${esc(config.siteTagline)}</p><p>The first documentary is coming soon.</p></section></div>`,
  }));

  for (const ep of eps) write(`videos/${ep.meta.slug}/index.html`, videoPage(ep));

  for (const [k, name] of Object.entries(CATS)) {
    const list = eps.filter((e) => e.topic.category === k);
    write(`category/${k}/index.html`, layout({
      title: `${name} — True Story Documentaries | ${config.siteName}`,
      description: `${name}: researched documentaries with sources, in Urdu with English, plus the full story in English.`, canonical: url(`/category/${k}/`),
      body: `<div class="wrap"><h1>${name}</h1>${list.length ? grid(list) : "<p>Coming soon.</p>"}</div>`,
    }));
  }
  write("archive/index.html", layout({
    title: `All Documentaries | ${config.siteName}`, description: `Every documentary on ${config.siteName}, newest first.`, canonical: url("/archive/"),
    body: `<div class="wrap"><h1>All videos</h1>${grid(eps)}</div>`,
  }));
  write("privacy/index.html", layout({
    title: `Privacy Policy | ${config.siteName}`, description: `Privacy policy of ${config.siteName} and its YouTube uploader.`, canonical: url("/privacy/"),
    body: `<article class="doc wrap">
<h1>Privacy Policy</h1>
<p class="meta">Last updated: ${esc(niceDate(new Date().toISOString().slice(0, 10)))}</p>
<h2>This website</h2>
<p>${esc(config.siteName)} is a static website. It does not use accounts, forms, cookies, analytics or advertising trackers, and it does not collect personal information from visitors.
Videos are embedded from YouTube in privacy-enhanced mode (youtube-nocookie.com); when you play one, YouTube's own privacy policy applies.</p>
<h2>${esc(config.siteName)} Uploader (YouTube API Services)</h2>
<p>The ${esc(config.siteName)} Uploader is a private tool used only by the owner of the ${esc(config.siteName)} YouTube channel to upload the channel's own original videos, thumbnails, subtitles and playlist entries.
It uses YouTube API Services. It is not offered to the public and it does not access, collect, store or share data of any other YouTube user.
The only authorization it holds is the channel owner's own, stored as an encrypted secret, and the owner can revoke it at any time at <a href="https://myaccount.google.com/permissions" rel="noopener">myaccount.google.com/permissions</a>.</p>
<p>By watching our videos you are also subject to the <a href="https://www.youtube.com/t/terms" rel="noopener">YouTube Terms of Service</a> and the <a href="https://policies.google.com/privacy" rel="noopener">Google Privacy Policy</a>.</p>
<h2>Contact</h2>
<p>Questions: leave a comment on our ${config.youtubeChannelUrl ? `<a href="${esc(config.youtubeChannelUrl)}" rel="noopener">YouTube channel</a>` : "YouTube channel"}.</p>
</article>`,
  }));
  write("404.html", layout({ title: `Page not found | ${config.siteName}`, description: "Page not found", canonical: url("/404.html"),
    body: `<div class="wrap"><section class="hero-empty"><h1>This page is a mystery we couldn't solve.</h1><p><a class="btn" href="${url("/")}">Go to the homepage</a></p></section></div>` }));

  const urls = [["/", eps[0]?.date], ["/archive/", eps[0]?.date], ...Object.keys(CATS).map((k) => [`/category/${k}/`]), ...eps.map((e) => [`/videos/${e.meta.slug}/`, e.date])];
  write("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(([p, d]) => `<url><loc>${esc(abs(url(p)))}</loc>${d ? `<lastmod>${d}</lastmod>` : ""}</url>`).join("\n")}
</urlset>
`);
  write("robots.txt", `User-agent: *\nAllow: /\nSitemap: ${abs(url("/sitemap.xml"))}\n`);
  write("feed.xml", `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>${esc(config.siteName)}</title><link>${esc(abs(url("/")))}</link><description>${esc(config.siteTaglineEn)}</description><language>en</language>
${eps.slice(0, 30).map((e) => `<item><title>${esc(e.meta.youtubeTitle)}</title><link>${esc(abs(url(`/videos/${e.meta.slug}/`)))}</link><guid>${esc(abs(url(`/videos/${e.meta.slug}/`)))}</guid><pubDate>${new Date(e.date + "T06:00:00Z").toUTCString()}</pubDate><description>${esc(e.meta.metaDescription)}</description></item>`).join("\n")}
</channel></rss>
`);
  console.log(`🌐 Built site: ${eps.length} documentaries → dist/`);
}

if (isMain(import.meta.url)) buildSite();

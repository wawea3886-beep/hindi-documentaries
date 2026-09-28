// Step 5: build the static, SEO-optimized website into dist/ from content/.
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
const niceDate = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const now = Date.now();
const live = (v) => v?.videoId && Date.parse(v.publishAt) <= now;
const CATS = {
  mystery: ["रहस्य", "Mysteries"], disaster: ["हादसे", "Disasters"], survival: ["सर्वाइवल", "Survival Stories"],
  history: ["इतिहास", "History"], science: ["विज्ञान", "Science"], crime: ["क्राइम", "True Crime"], scam: ["स्कैम", "Scams & Frauds"],
};
const catName = (c) => (CATS[c] || CATS.history).join(" · ");
const thumb = (ep) => (fs.existsSync(path.join(IMAGES_DIR, ep.date, "thumb.jpg")) ? `/images/${ep.date}/thumb.jpg` : "/og.svg");
const minutes = (ep) => Math.round((ep.render?.duration || (ep.wordCount || 3500) / 2.1) / 60);

function layout({ title, description, canonical, image, jsonld = [], body, type = "website" }) {
  return `<!doctype html>
<html lang="hi">
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
  <nav>${Object.entries(CATS).slice(0, 4).map(([k, [hi]]) => `<a href="${url(`/category/${k}/`)}">${hi}</a>`).join("")}<a href="${url("/archive/")}">सभी वीडियो</a>${config.youtubeChannelUrl ? `<a class="yt" href="${esc(config.youtubeChannelUrl)}" rel="noopener">▶ YouTube</a>` : ""}</nav>
</div></header>
<main>
${body}
</main>
<footer class="foot"><div class="wrap">
  <p><strong>${esc(config.siteName)}</strong> — ${esc(config.siteTagline)}</p>
  <p class="small">Every documentary is researched from the sources listed on its page. Narration voice and illustrations are AI-generated; real photos are credited with their licences.</p>
</div></footer>
<script>
document.querySelectorAll("[data-publish]").forEach(function (el) {
  var t = Date.parse(el.dataset.publish);
  if (Date.now() >= t) {
    el.innerHTML = '<iframe src="https://www.youtube-nocookie.com/embed/' + el.dataset.video + '" title="' + (el.dataset.title || "Video") + '" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen loading="lazy"></iframe>';
    el.classList.add("live");
  } else {
    var w = el.querySelector(".when");
    if (w) w.textContent = new Date(t).toLocaleString("hi-IN", { weekday: "long", hour: "numeric", minute: "2-digit" });
  }
});
</script>
</body>
</html>`;
}

function card(ep) {
  return `<a class="card" href="${url(`/videos/${ep.meta.slug}/`)}">
  <div class="thumb"><img src="${url(thumb(ep))}" alt="${esc(ep.meta.youtubeTitle)}" width="1280" height="720" loading="lazy"><span class="dur">${minutes(ep)} min</span></div>
  <span class="cat">${esc((CATS[ep.topic.category] || CATS.history)[0])}</span>
  <h3>${esc(ep.meta.titleHi || ep.meta.youtubeTitle)}</h3>
  <p>${esc(ep.meta.youtubeTitle)}</p>
</a>`;
}
const grid = (eps) => `<div class="grid">${eps.map(card).join("\n")}</div>`;

function paragraphs(beats) {
  const out = [];
  for (let i = 0; i < beats.length; i += 3) out.push(`<p>${esc(beats.slice(i, i + 3).map((b) => b.text).join(" "))}</p>`);
  return out.join("\n");
}

function videoPage(ep) {
  const canonical = `/videos/${ep.meta.slug}/`;
  const L = ep.youtube?.long;
  const chapters = ep.render?.chapters || [];
  const usedPhotos = new Set(ep.chapters.flatMap((c) => c.beats).filter((b) => b.visual.type === "photo").map((b) => b.visual.photo));
  const photos = ep.photos.filter((p) => usedPhotos.has(p.id));
  const player = L?.videoId
    ? `<div class="player" data-publish="${esc(L.publishAt)}" data-video="${esc(L.videoId)}" data-title="${esc(ep.meta.youtubeTitle)}"><img src="${url(thumb(ep))}" alt="" width="1280" height="720"><p>🎬 वीडियो का प्रीमियर <strong class="when">जल्द</strong> होगा</p></div>`
    : `<div class="player"><img src="${url(thumb(ep))}" alt="${esc(ep.meta.youtubeTitle)}" width="1280" height="720"></div>`;
  const shorts = ep.shorts.map((s) => ({ s, y: ep.youtube?.shorts?.[s.id] })).filter((x) => x.y?.videoId);

  const jsonld = [{
    "@context": "https://schema.org", "@type": "Article",
    headline: ep.meta.youtubeTitle, alternativeHeadline: ep.meta.titleHi, description: ep.meta.metaDescription,
    image: abs(url(thumb(ep))), datePublished: ep.date, inLanguage: "hi", keywords: ep.meta.tags.join(", "),
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
    thumbnailUrl: [abs(url(thumb(ep))), `https://i.ytimg.com/vi/${L.videoId}/maxresdefault.jpg`], uploadDate: L.publishAt, inLanguage: "hi",
    duration: `PT${Math.floor(ep.render.duration / 60)}M${Math.round(ep.render.duration % 60)}S`,
    embedUrl: `https://www.youtube-nocookie.com/embed/${L.videoId}`, contentUrl: L.url,
    hasPart: chapters.map((c, i) => ({ "@type": "Clip", name: c.titleEn, startOffset: Math.floor(c.start), endOffset: Math.floor(chapters[i + 1]?.start ?? ep.render.duration), url: `${L.url}&t=${Math.floor(c.start)}s` })),
  });

  const body = `<article class="doc wrap">
<nav class="crumbs"><a href="${url("/")}">Home</a> › <a href="${url(`/category/${ep.topic.category}/`)}">${esc(catName(ep.topic.category))}</a></nav>
<h1>${esc(ep.meta.youtubeTitle)}</h1>
<p class="hi-title">${esc(ep.meta.titleHi)}</p>
<p class="meta">${esc(niceDate(ep.date))} · ${minutes(ep)} मिनट की डॉक्यूमेंट्री · ${esc(catName(ep.topic.category))}</p>
${player}
<p class="lead">${esc(ep.meta.descriptionHi)}</p>
${chapters.length ? `<nav class="toc"><h2>अध्याय</h2><ol>${ep.chapters.map((c, i) => `<li><a href="#ch${i + 1}">${esc(c.titleHi)}</a> <span>${clock(chapters[i]?.start || 0)}</span></li>`).join("")}</ol></nav>` : ""}
${ep.chapters.map((c, i) => {
    const im = ep.render?.chapterImages?.[i];
    const p = im?.photo && ep.photos.find((x) => x.id === im.photo);
    return `<section id="ch${i + 1}">
<h2><small>अध्याय ${i + 1}</small>${esc(c.titleHi)}<span class="en">${esc(c.titleEn)}</span></h2>
${im ? `<figure><img src="${url(`/images/${ep.date}/${im.file}`)}" alt="${esc(c.titleEn)}" width="800" height="450" loading="lazy">${p ? `<figcaption>Photo: ${esc(p.artist)} · <a href="${esc(p.page)}" rel="noopener">${esc(p.license)}</a> · Wikimedia Commons</figcaption>` : `<figcaption>AI illustration</figcaption>`}</figure>` : ""}
${paragraphs(c.beats)}
</section>`;
  }).join("\n")}
${shorts.length ? `<section><h2>Shorts</h2><div class="shorts">${shorts.map(({ s, y }) => `<div class="short" data-publish="${esc(y.publishAt)}" data-video="${esc(y.videoId)}" data-title="${esc(s.titleEn)}"><p>${esc(s.hookHi)}<br><small>प्रीमियर: <span class="when"></span></small></p></div>`).join("")}</div></section>` : ""}
<section class="sources"><h2>स्रोत · Sources</h2><ol>${ep.sources.map((s) => `<li><a href="${esc(s.url)}" rel="noopener">${esc(s.title)}</a> — Wikipedia (CC BY-SA 4.0)</li>`).join("")}</ol>
${photos.length ? `<h3>Photo credits</h3><ul>${photos.map((p) => `<li><a href="${esc(p.page)}" rel="noopener">${esc(p.title)}</a> — ${esc(p.artist)}, ${p.licenseUrl ? `<a href="${esc(p.licenseUrl)}" rel="noopener">${esc(p.license)}</a>` : esc(p.license)}</li>`).join("")}</ul>` : ""}
<p class="small">यह डॉक्यूमेंट्री ऊपर दिए गए स्रोतों पर आधारित है और प्रकाशन से पहले तथ्यों की जाँच की गई है। आवाज़ और चित्र AI द्वारा बनाए गए हैं। कोई गलती दिखे तो YouTube पर कमेंट करके बताइए।</p></section>
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
    title: `${config.siteName} — Hindi Documentaries: Mysteries, Disasters & True Stories`,
    description: `${config.siteTaglineEn}. Watch and read researched Hindi documentaries with sources.`,
    canonical: url("/"),
    jsonld: [{ "@context": "https://schema.org", "@type": "WebSite", name: config.siteName, url: abs(url("/")), inLanguage: "hi", description: config.siteTaglineEn }],
    body: latest ? `<section class="hero"><div class="wrap hero-in">
  <a href="${url(`/videos/${latest.meta.slug}/`)}" class="hero-img"><img src="${url(thumb(latest))}" alt="${esc(latest.meta.youtubeTitle)}" width="1280" height="720"></a>
  <div><span class="cat">आज की डॉक्यूमेंट्री · ${esc(niceDate(latest.date))}</span>
  <h1>${esc(latest.meta.titleHi || latest.meta.youtubeTitle)}</h1><p class="en">${esc(latest.meta.youtubeTitle)}</p>
  <p>${esc(latest.meta.descriptionHi)}</p>
  <a class="btn" href="${url(`/videos/${latest.meta.slug}/`)}">▶ देखिए और पढ़िए</a></div>
</div></section>
<div class="wrap">${older.length ? `<h2>पिछली डॉक्यूमेंट्रीज़</h2>${grid(older.slice(0, 12))}<p class="center"><a class="btn ghost" href="${url("/archive/")}">सभी ${eps.length} वीडियो →</a></p>` : ""}</div>`
      : `<div class="wrap"><section class="hero-empty"><h1>${esc(config.siteName)}</h1><p>${esc(config.siteTagline)}</p><p>पहली डॉक्यूमेंट्री जल्द आ रही है।</p></section></div>`,
  }));

  for (const ep of eps) write(`videos/${ep.meta.slug}/index.html`, videoPage(ep));

  for (const [k, [hi, en]] of Object.entries(CATS)) {
    const list = eps.filter((e) => e.topic.category === k);
    write(`category/${k}/index.html`, layout({
      title: `${en} in Hindi — ${hi} की सच्ची कहानियाँ | ${config.siteName}`,
      description: `${en} explained in Hindi: researched documentaries with sources.`, canonical: url(`/category/${k}/`),
      body: `<div class="wrap"><h1>${hi} <span class="en">${en}</span></h1>${list.length ? grid(list) : "<p>जल्द आ रहा है।</p>"}</div>`,
    }));
  }
  write("archive/index.html", layout({
    title: `All Documentaries | ${config.siteName}`, description: `Every Hindi documentary on ${config.siteName}, newest first.`, canonical: url("/archive/"),
    body: `<div class="wrap"><h1>सभी वीडियो</h1>${grid(eps)}</div>`,
  }));
  write("404.html", layout({ title: `Page not found | ${config.siteName}`, description: "Page not found", canonical: url("/404.html"),
    body: `<div class="wrap"><section class="hero-empty"><h1>यह पेज एक रहस्य है… जो मिला ही नहीं।</h1><p><a class="btn" href="${url("/")}">होम पर जाइए</a></p></section></div>` }));

  const urls = [["/", eps[0]?.date], ["/archive/", eps[0]?.date], ...Object.keys(CATS).map((k) => [`/category/${k}/`]), ...eps.map((e) => [`/videos/${e.meta.slug}/`, e.date])];
  write("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(([p, d]) => `<url><loc>${esc(abs(url(p)))}</loc>${d ? `<lastmod>${d}</lastmod>` : ""}</url>`).join("\n")}
</urlset>
`);
  write("robots.txt", `User-agent: *\nAllow: /\nSitemap: ${abs(url("/sitemap.xml"))}\n`);
  write("feed.xml", `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>${esc(config.siteName)}</title><link>${esc(abs(url("/")))}</link><description>${esc(config.siteTaglineEn)}</description><language>hi</language>
${eps.slice(0, 30).map((e) => `<item><title>${esc(e.meta.youtubeTitle)}</title><link>${esc(abs(url(`/videos/${e.meta.slug}/`)))}</link><guid>${esc(abs(url(`/videos/${e.meta.slug}/`)))}</guid><pubDate>${new Date(e.date + "T06:00:00Z").toUTCString()}</pubDate><description>${esc(e.meta.metaDescription)}</description></item>`).join("\n")}
</channel></rss>
`);
  console.log(`🌐 Built site: ${eps.length} documentaries → dist/`);
}

if (isMain(import.meta.url)) buildSite();

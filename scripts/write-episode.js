// Step 1: pick today's topic → research it on Wikipedia → write a ~28 min Urdu + English documentary script
// in chapters (Urdu script for the voice + word-for-word Roman Urdu for subtitles) → fact-check every chapter →
// write 3 Shorts scripts → English article for the website → fact-check titles and descriptions.
// Progress is saved after every stage, so a re-run continues where it stopped.
// Usage: node scripts/write-episode.js [--date=YYYY-MM-DD] [--force] [--mock]
import config from "../config.js";
import { llmJSON, provider, listFrom } from "./lib/llm.js";
import { trendingTopics, fetchArticle, fetchPhotos } from "./lib/research.js";
import { today, readEpisode, writeEpisode, allEpisodes, slugify, hasFlag, isMain } from "./lib/util.js";

const MAX_SOURCE_CHARS = 90000;
const CATEGORIES = ["mystery", "disaster", "survival", "history", "science", "crime", "scam"];
const ZOOMS = ["world", "continent", "region", "country", "city"];
const wordCount = (s) => s.split(/\s+/).filter(Boolean).length;
const minutes = (words) => Math.round(words / config.wordsPerMinute);

const STYLE = `NARRATION STYLE — Urdu mixed with English, the way popular South Asian explainer YouTubers speak:
- "text": everyday spoken Urdu in URDU SCRIPT. Common English words, names, places and technical terms stay in ENGLISH
  LETTERS inside the Urdu sentence, e.g. "اس ship کا نام MS Estonia تھا، اور اس پر 989 passengers سوار تھے۔" Numbers as digits.
- "roman": EXACTLY the same sentence, word for word and in the same order, written in Roman Urdu (English letters),
  English words unchanged, e.g. "Is ship ka naam MS Estonia tha, aur is par 989 passengers sawar thay."
- Warm, curious and suspenseful. Short sentences that sound natural for a text-to-speech voice. Rhetorical questions and
  mini-cliffhangers between sections. Say "دوستو" at most once per chapter.
- 100% factual: every name, date, number and event must come from the SOURCES. If sources disagree, say so.
  Theories must be labelled as theories ("کچھ experts کا ماننا ہے…"). Never invent quotes, dialogue or details.
- Respectful to victims. No graphic or gory descriptions. No political, religious, sectarian or India–Pakistan opinions.
- Do NOT copy phrases, catchphrases or intros of any existing YouTuber.`;

const VISUALS = `Every beat gets exactly one "visual" — mix them so the video feels fast and alive:
- {"type":"clip","query":"2-4 English words to find GENERIC stock footage, e.g. 'stormy sea night', 'rescue helicopter', 'old newspaper printing'","prompt":"AI illustration to use if no clip is found"}
  about 1 beat in 3. Never search for specific real people or logos.
- {"type":"ai","prompt":"English description of ONE illustration: who/what/where, era details, camera angle, mood"}
  (describe people generically — never a real person's exact likeness; no text in the image; no gore)
- {"type":"photo","photo":"p3"} — only when that real photo matches what is being said. Each photo at most twice.
- {"type":"map","place":"Baltic Sea","lat":58.9,"lon":21.2,"zoom":"world|continent|region|country|city","label":"short English label"}
  when a location first matters (accurate coordinates), at most 1-2 per chapter.
- {"type":"card","title":"28 SEPTEMBER 1994","text":"short English line"} ONLY for the most important date, number or quote —
  at most 2 per chapter. Title max 28 characters. (Use "highlight" instead for smaller facts.)
Optional "highlight" on about 1 beat in 4: 1-4 KEY WORDS in English CAPITALS shown on screen while they are spoken
(e.g. "989 PEOPLE ON BOARD"), max 28 characters, must state a fact from that beat.`;

async function pickTopic(date) {
  const recent = allEpisodes().filter((e) => e.date !== date).slice(0, 90).map((e) => e.topic?.name).filter(Boolean);
  const trends = await trendingTopics(date);
  console.log(`  ${trends.mostRead.length} trending articles, ${trends.onThisDay.length} on-this-day events`);
  const prompt = `You are head of research for an Urdu + English YouTube documentary channel (25-30 minute videos, like top South Asian explainer channels).
Audience: Urdu/Hindi speakers in Pakistan, India and abroad. Channel themes: ${config.themes.join("; ")}.
Today is ${date}. Propose 5 candidate topics for today's documentary, best first.

Prefer topics that are TRENDING right now (most-read Wikipedia list) or have an ANNIVERSARY today (on-this-day list);
famous evergreen stories are also fine. Stories connected to Pakistan/South Asia are a bonus but global stories are welcome.

MOST READ ON WIKIPEDIA YESTERDAY:
${trends.mostRead.join("\n") || "(unavailable)"}

ON THIS DAY IN HISTORY:
${trends.onThisDay.join("\n") || "(unavailable)"}

RULES
- Must have rich English Wikipedia coverage (a long main article plus related articles).
- Event must be at least 2 years old (no ongoing tragedies or breaking news). Nothing about current politics, elections,
  religion, sects, India–Pakistan conflicts or communal issues. No living private individuals. Crime only if very famous and historical.
- Must NOT repeat these recent topics: ${recent.join("; ") || "(none)"}

Return JSON: {"candidates":[{"name":"short English topic name","category":"one of ${CATEGORIES.join("|")}",
"wikiTitles":["exact English Wikipedia article title of the main topic","2-4 exact titles of closely related articles that add detail"],
"angle":"one-line documentary hook","why":"why today"}]}`;
  const candidates = listFrom(await llmJSON(prompt, { label: "topic" }), "candidates");
  console.log(`  AI suggested ${candidates.length} topics: ${candidates.map((c) => c.name).join(" | ")}`);

  for (const c of candidates) {
    const articles = [];
    for (const t of (c.wikiTitles || []).slice(0, 5)) {
      const a = await fetchArticle(t).catch(() => null);
      if (a && !articles.some((x) => x.title === a.title)) articles.push(a);
    }
    const chars = articles.reduce((n, a) => n + a.text.length, 0);
    console.log(`  candidate "${c.name}": ${articles.length} articles, ${chars} chars`);
    if (articles.length && articles[0].text.length > 5000 && chars > 12000) return { topic: c, articles };
  }
  throw new Error("No candidate topic had enough source material.");
}

function sourcesBlock(articles) {
  let left = MAX_SOURCE_CHARS;
  return articles.map((a, i) => {
    const text = a.text.slice(0, Math.max(0, left));
    left -= text.length;
    return `=== SOURCE S${i + 1}: ${a.title} ===\n${text}`;
  }).filter((s) => s.length > 40).join("\n\n");
}

const photoList = (photos) => photos.map((p) => `${p.id}: ${p.title}${p.description ? " — " + p.description : ""}`).join("\n") || "(no photos available)";

async function writeOutline(ep, sources) {
  const prompt = `${sources}

You are the lead writer of an Urdu + English YouTube documentary about: "${ep.topic.name}" (${ep.topic.angle}).
Using ONLY the sources above, plan a ${minutes(config.targetWords)}-minute documentary (~${config.targetWords} words of narration).

Structure like a gripping documentary:
- Chapter 1 = cold open (about 220 words): start at the most dramatic moment, raise 2-3 big questions, promise what the viewer will learn.
- Middle chapters: tell the story chronologically with rising tension; include background/context, the key moments,
  the investigation/rescue/aftermath, and analysis of causes or theories.
- Last chapter: conclusion — what changed afterwards, lessons, open questions, and a short request to like and subscribe.
- 7 to 9 chapters in total.

Return JSON:
{"youtubeTitle":"English, max 80 characters, curiosity-driven but truthful, e.g. '<Hook> | <Topic> True Story'",
"thumbnailText":"2-4 English words in CAPITALS for the thumbnail, e.g. 'SHE SURVIVED?'",
"thumbnailPrompt":"one dramatic image for the thumbnail: single clear subject, strong emotion, high contrast, room on the left for text",
"characters":"short consistent visual descriptions (age, clothes, era, place) of the main people/places, used for every illustration",
"descriptionEn":"90-120 word English synopsis that makes people want to watch (no spoilers of the ending)",
"descriptionUr":"60-90 word synopsis in Roman Urdu (English letters)",
"tags":["20 search tags mixing English and Roman Urdu, e.g. 'ms estonia documentary', 'ms estonia in urdu'"],
"hashtags":["3 hashtags without spaces, starting with #"],
"metaDescription":"150-160 character English summary for Google",
"chapters":[{"titleEn":"English chapter title","titleRoman":"the same title in Roman Urdu","covers":"which facts/events from the sources this chapter covers","words":300}]}`;
  const o = await llmJSON(prompt, { label: "outline", temperature: 0.8 });
  if (!o.youtubeTitle || !Array.isArray(o.chapters) || o.chapters.length < 4) throw new Error("outline incomplete");
  return o;
}

const str = (v, max = 5000) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : "");

function normalizeVisual(v, photoIds, characters) {
  v = v && typeof v === "object" ? v : {};
  const ai = (prompt) => ({ type: "ai", prompt: str(prompt) || characters });
  switch (v.type) {
    case "photo": return photoIds.has(v.photo) ? { type: "photo", photo: v.photo } : ai(v.prompt);
    case "card": return str(v.title) ? { type: "card", title: str(v.title, 40), text: str(v.text, 80) } : ai(v.prompt);
    case "clip": return str(v.query) ? { type: "clip", query: str(v.query, 60), prompt: str(v.prompt) || characters } : ai(v.prompt);
    case "map": {
      const lat = Number(v.lat), lon = Number(v.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180) return ai(v.prompt);
      return { type: "map", place: str(v.place, 60), lat, lon, zoom: ZOOMS.includes(v.zoom) ? v.zoom : "region", label: str(v.label, 36) || str(v.place, 36) };
    }
    default: return ai(v.prompt);
  }
}

function normalizeBeats(chapterIdx, beats, photos, characters) {
  const ids = new Set(photos.map((p) => p.id));
  return (beats || []).filter((b) => str(b?.text)).map((b, i) => {
    const beat = { id: `c${chapterIdx + 1}b${i + 1}`, text: str(b.text), roman: str(b.roman), visual: normalizeVisual(b.visual, ids, characters) };
    const hl = str(b.highlight, 32);
    if (hl) beat.highlight = hl.toUpperCase();
    return beat;
  });
}

const BEAT_FORMAT = `Split each chapter into BEATS of 18-30 Urdu words (1-3 sentences).
Beat format: {"text":"Urdu script (English words in English letters)","roman":"same words in Roman Urdu","visual":{...},"highlight":"OPTIONAL"}`;

async function writeChapters(ep, sources, indices) {
  const outline = ep.chapters.map((c, i) => `${i + 1}. ${c.titleEn} / ${c.titleRoman} (~${c.words} words): ${c.covers}`).join("\n");
  const prev = ep.chapters.slice(0, indices[0]).flatMap((c) => c.beats || []).slice(-4).map((b) => b.text).join(" ");
  const prompt = `${sources}

AVAILABLE REAL PHOTOS (freely licensed, from the articles above):
${photoList(ep.photos)}

You are writing the narration of an Urdu + English documentary: "${ep.meta.youtubeTitle}".
FULL OUTLINE:
${outline}

VISUAL CHARACTERS (use in every illustration prompt): ${ep.meta.characters}

${prev ? `The previous chapter ended with: "${prev}"\nContinue naturally from there.\n` : ""}
Write chapters ${indices.map((i) => i + 1).join(", ")} now. LENGTH IS CRITICAL — this is a long-form documentary, so each chapter
must land within its word range (words of "text", separated by spaces) — not shorter, and not much longer. Add depth instead of padding: background,
context, timeline details, numbers, what investigators found, different viewpoints — all from the sources.
${indices.map((i) => `- Chapter ${i + 1}: ${ep.chapters[i].words}–${Math.round(ep.chapters[i].words * 1.12)} words`).join("\n")}

${STYLE}

${BEAT_FORMAT}

${VISUALS}

Return JSON: {"chapters":[{"index":<chapter number>,"beats":[{"text":"","roman":"","visual":{},"highlight":""}]}]}`;
  const out = await llmJSON(prompt, { label: `chapters ${indices.map((i) => i + 1).join(",")}` });
  listFrom(out, "chapters").forEach((c, pos) => {
    const i = indices.includes(Number(c.index) - 1) ? Number(c.index) - 1 : indices[pos]; // index missing → use order
    if (i === undefined) return;
    ep.chapters[i].beats = normalizeBeats(i, listFrom(c, "beats"), ep.photos, ep.meta.characters);
  });
  const missing = indices.filter((i) => !ep.chapters[i].beats?.length);
  if (missing.length) throw new Error(`chapters ${missing.map((i) => i + 1)} were not written`);
}

const chapterWords = (c) => wordCount(c.beats.map((b) => b.text).join(" "));

/** Rewrite chapters that came out much shorter than planned (AI models tend to under-write long non-English text). */
async function expandShortChapters(ep, sources, indices) {
  const short = indices.filter((i) => chapterWords(ep.chapters[i]) < ep.chapters[i].words * 0.85);
  if (!short.length) return;
  const prompt = `${sources}

AVAILABLE REAL PHOTOS:
${photoList(ep.photos)}

These chapters of the Urdu + English documentary "${ep.meta.youtubeTitle}" are TOO SHORT. Rewrite each one completely,
keeping everything that is already there and its style, but adding more depth from the SOURCES (context, timeline,
numbers, eyewitness accounts from the sources, investigation findings) until it reaches the required length.

${short.map((i) => `CHAPTER ${i + 1}: ${ep.chapters[i].titleEn} — now ${chapterWords(ep.chapters[i])} words, needs AT LEAST ${ep.chapters[i].words} words.
Covers: ${ep.chapters[i].covers}
Current beats:
${ep.chapters[i].beats.map((b) => `- ${b.text} [visual: ${JSON.stringify(b.visual)}]`).join("\n")}`).join("\n\n")}

${STYLE}

${BEAT_FORMAT}

${VISUALS}

Return JSON: {"chapters":[{"index":<chapter number>,"beats":[{"text":"","roman":"","visual":{},"highlight":""}]}]}`;
  const out = await llmJSON(prompt, { label: `expand chapters ${short.map((i) => i + 1).join(",")}` });
  listFrom(out, "chapters").forEach((c, pos) => {
    const i = short.includes(Number(c.index) - 1) ? Number(c.index) - 1 : short[pos];
    const beats = i === undefined ? [] : normalizeBeats(i, listFrom(c, "beats"), ep.photos, ep.meta.characters);
    if (beats.length && wordCount(beats.map((b) => b.text).join(" ")) > chapterWords(ep.chapters[i])) ep.chapters[i].beats = beats;
  });
}

async function factCheck(ep, sources, indices) {
  const beats = indices.flatMap((i) => ep.chapters[i].beats);
  const prompt = `${sources}

You are a strict fact-checker for an Urdu + English documentary. Compare every beat below with the SOURCES.
Report ONLY real problems: facts not supported by the sources, wrong names/dates/numbers, invented quotes or details,
exaggeration, theories stated as facts, graphic/gory descriptions, or political/religious opinions. Also check each
on-screen "highlight" and that "roman" says the same as "text".
For each problem give corrected versions that say only what the sources support (same style and similar length).

BEATS:
${beats.map((b) => `[${b.id}] ${b.text}\n   roman: ${b.roman}${b.highlight ? `\n   highlight: ${b.highlight}` : ""}`).join("\n")}

Return JSON: {"issues":[{"id":"c2b5","problem":"short English explanation","fixedText":"corrected Urdu text","fixedRoman":"corrected Roman Urdu","fixedHighlight":"corrected or empty"}]}
— an empty list if everything is correct.`;
  const issues = listFrom(await llmJSON(prompt, { label: "fact-check", temperature: 0.2 }), "issues");
  let fixed = 0;
  for (const is of issues) {
    const b = beats.find((x) => x.id === is.id);
    if (!b) continue;
    if (str(is.fixedText)) b.text = str(is.fixedText);
    if (str(is.fixedRoman)) b.roman = str(is.fixedRoman);
    if (b.highlight) { if (str(is.fixedHighlight)) b.highlight = str(is.fixedHighlight, 32).toUpperCase(); else if (is.fixedHighlight === "") delete b.highlight; }
    b.factFix = is.problem;
    fixed++;
  }
  console.log(`  ✔ fact-checked chapters ${indices.map((i) => i + 1).join(",")}: ${fixed} fix(es)`);
}

async function writeShorts(ep, sources) {
  const chapters = ep.chapters.map((c, i) => `${i + 1}. ${c.titleEn}: ${c.beats.map((b) => b.roman || b.text).join(" ").slice(0, 700)}`).join("\n");
  const prompt = `${sources}

The full documentary "${ep.meta.youtubeTitle}" has these chapters:
${chapters}

Write ${config.shortsPerDay} YouTube Shorts scripts (each about 50 seconds), each about a DIFFERENT gripping moment,
taken from a different chapter. Facts only from the sources.
- text: 100-125 words. The first sentence must hook instantly (a shocking fact or question). Tell one self-contained moment.
  End with a cliffhanger and then exactly: "پوری کہانی ہمارے channel پر دیکھیں۔" (roman: "Poori kahani hamare channel par dekhein.")
${STYLE}

Return JSON: {"shorts":[{"chapter":<chapter number whose pictures to use>,"titleEn":"English, max 70 characters, curiosity-driven",
"hook":"on-screen headline in Roman Urdu, max 30 characters","text":"Urdu script","roman":"same in Roman Urdu",
"descriptionEn":"2 short English lines","tags":["10 tags"]}]}`;
  const shorts = listFrom(await llmJSON(prompt, { label: "shorts" }), "shorts");
  if (shorts.length < config.shortsPerDay) throw new Error(`expected ${config.shortsPerDay} shorts, got ${shorts.length}`);
  return shorts.slice(0, config.shortsPerDay).map((s, i) => ({
    id: `s${i + 1}`,
    chapter: Math.min(Math.max(1, Number(s.chapter) || i + 2), ep.chapters.length) - 1,
    titleEn: str(s.titleEn).replace(/#shorts/gi, "").trim().slice(0, 88),
    hook: str(s.hook, 40),
    text: str(s.text),
    roman: str(s.roman),
    descriptionEn: str(s.descriptionEn),
    tags: (s.tags || []).map(String),
  }));
}

/** English version of the documentary for the website (faithful to the checked narration). */
async function writeArticle(ep) {
  const script = ep.chapters.map((c, i) => `CHAPTER ${i + 1}: ${c.titleEn}\n${c.beats.map((b) => b.roman || b.text).join(" ")}`).join("\n\n");
  const prompt = `Below is the fact-checked narration of the documentary "${ep.meta.youtubeTitle}" (in Roman Urdu).
Turn it into a well-written ENGLISH article for our website: for each chapter write 2-5 clear paragraphs that say the
same facts in the same order. Do not add any new facts, numbers or claims. Plain, engaging English.

${script}

Return JSON: {"chapters":[{"index":1,"paragraphs":["...","..."]}]}`;
  listFrom(await llmJSON(prompt, { label: "English article", temperature: 0.4 }), "chapters").forEach((c, pos) => {
    const i = Number(c.index) - 1 >= 0 && ep.chapters[Number(c.index) - 1] ? Number(c.index) - 1 : pos;
    const paras = listFrom(c, "paragraphs").map((p) => str(p)).filter(Boolean);
    if (ep.chapters[i] && paras.length) ep.chapters[i].articleEn = paras;
  });
  console.log(`  ✔ English article: ${ep.chapters.filter((c) => c.articleEn).length}/${ep.chapters.length} chapters`);
}

/** Fact-check what viewers see first — titles, thumbnail text, descriptions, chapter names, Shorts headlines. */
async function checkMetadata(ep, sources) {
  const fields = {
    youtubeTitle: ep.meta.youtubeTitle, thumbnailText: ep.meta.thumbnailText,
    descriptionEn: ep.meta.descriptionEn, descriptionUr: ep.meta.descriptionUr, metaDescription: ep.meta.metaDescription,
    chapters: ep.chapters.map((c) => ({ titleEn: c.titleEn, titleRoman: c.titleRoman })),
    shorts: ep.shorts.map((s) => ({ titleEn: s.titleEn, hook: s.hook, descriptionEn: s.descriptionEn })),
  };
  const prompt = `${sources}

You are a strict fact-checker. Below are the title, thumbnail text, descriptions, chapter names and Shorts headlines of a
documentary. Check every number, date, duration, name and claim against the SOURCES. Correct anything that is not
supported (for example a wrong duration or death toll), keeping the same catchy style and language.
Limits: youtubeTitle max 80 characters; thumbnailText 2-4 English words in CAPITALS; hook max 30 characters.
If something is correct, return it unchanged.

${JSON.stringify(fields, null, 1)}

Return JSON: {"fixed": <the same object with corrections>, "changes": ["short English note per change"]}`;
  const out = await llmJSON(prompt, { label: "title fact-check", temperature: 0.2 });
  const f = out.fixed || out;
  for (const k of ["youtubeTitle", "thumbnailText", "descriptionEn", "descriptionUr", "metaDescription"]) {
    const v = str(f[k], k === "youtubeTitle" ? 95 : 5000);
    if (v) ep.meta[k] = v;
  }
  (f.chapters || []).forEach((c, i) => { if (ep.chapters[i]) { ep.chapters[i].titleEn = str(c.titleEn) || ep.chapters[i].titleEn; ep.chapters[i].titleRoman = str(c.titleRoman) || ep.chapters[i].titleRoman; } });
  (f.shorts || []).forEach((s, i) => {
    const t = ep.shorts[i];
    if (!t) return;
    t.titleEn = (str(s.titleEn) || t.titleEn).replace(/#shorts/gi, "").trim().slice(0, 88);
    t.hook = str(s.hook, 40) || t.hook;
    t.descriptionEn = str(s.descriptionEn) || t.descriptionEn;
  });
  const changes = listFrom(out, "changes").filter((c) => typeof c === "string");
  console.log(`  ✔ Title/description fact-check: ${changes.length} change(s)${changes.length ? "\n    - " + changes.join("\n    - ") : ""}`);
}

function cleanTags(tags) {
  const t = [...new Set((tags || []).map((x) => String(x).toLowerCase().replace(/[<>#,]/g, "").trim()).filter(Boolean))];
  while (t.join(",").length > 480) t.pop(); // YouTube: 500 characters max
  return t;
}

async function mockEpisode(date) {
  const photos = await fetchPhotos(["Juliane Koepcke"], 2).catch(() => []);
  const photoBeat = photos[0] ? { type: "photo", photo: photos[0].id } : { type: "ai", prompt: "a teenage girl walking alone through a dense rainforest" };
  const ch = (titleEn, titleRoman, beats, articleEn) => ({ titleEn, titleRoman, covers: "", words: 0, beats, articleEn });
  return {
    date, stage: "done", mock: true, metaChecked: true, language: "ur",
    topic: { name: "LANSA Flight 508 (demo)", category: "survival", angle: "Demo episode", wikiTitles: ["LANSA Flight 508", "Juliane Koepcke"] },
    sources: [{ title: "LANSA Flight 508", url: "https://en.wikipedia.org/wiki/LANSA_Flight_508" }, { title: "Juliane Koepcke", url: "https://en.wikipedia.org/wiki/Juliane_Koepcke" }],
    photos,
    meta: {
      youtubeTitle: "The Girl Who Survived the Fall | LANSA Flight 508 True Story (Demo)", slug: `${date}-lansa-flight-508-demo`,
      thumbnailText: "SHE SURVIVED?", thumbnailPrompt: "a lone teenage girl standing in a vast misty rainforest, looking up at a stormy sky",
      characters: "a 17-year-old girl with short hair in a light summer dress, 1971 Peru, dense Amazon rainforest",
      descriptionEn: "Christmas Eve, 1971. A plane disappears over the Amazon rainforest. Days later, a teenage girl walks out of the jungle alone. This is a short demo of the automatic documentary pipeline.",
      descriptionUr: "24 December 1971 ko Amazon ke jungle ke upar ek plane gayab ho gaya. Yeh automatic documentary system ka ek chhota demo hai.",
      tags: ["lansa flight 508", "juliane koepcke", "survival story in urdu", "true story urdu"],
      hashtags: ["#TrueStory", "#Survival", "#Urdu"],
      metaDescription: "The true story of LANSA Flight 508 and Juliane Koepcke, the teenager who survived a fall into the Amazon rainforest in 1971.",
    },
    chapters: [
      ch("Cold Open", "Shuruaat", [
        { id: "c1b1", text: "24 December 1971۔ Peru کے شہر Lima سے ایک plane اڑان بھرتا ہے۔ یہ LANSA Flight 508 تھی، جو Pucallpa جا رہی تھی۔",
          roman: "24 December 1971. Peru ke shehar Lima se ek plane udaan bharta hai. Yeh LANSA Flight 508 thi, jo Pucallpa ja rahi thi.",
          visual: { type: "map", place: "Lima, Peru", lat: -12.05, lon: -77.04, zoom: "continent", label: "Lima, Peru" }, highlight: "24 DECEMBER 1971" },
        { id: "c1b2", text: "Plane میں سوار لوگ Christmas منانے اپنے گھر جا رہے تھے۔ لیکن آسمان میں ایک خوفناک طوفان ان کا انتظار کر رہا تھا۔",
          roman: "Plane mein sawar log Christmas manane apne ghar ja rahe thay. Lekin aasman mein ek khofnaak toofan un ka intezar kar raha tha.",
          visual: { type: "clip", query: "thunderstorm clouds lightning", prompt: "a 1970s propeller airliner flying toward huge dark thunderstorm clouds above the Amazon rainforest" } },
        { id: "c1b3", text: "کچھ دن بعد، گھنے جنگل سے ایک سترہ سال کی لڑکی اکیلی باہر نکلی۔ آخر اس کے ساتھ کیا ہوا تھا؟",
          roman: "Kuch din baad, ghane jungle se ek satrah saal ki larki akeli bahar nikli. Aakhir us ke saath kya hua tha?", visual: photoBeat },
      ], ["On 24 December 1971, LANSA Flight 508 took off from Lima, Peru, bound for Pucallpa.", "Days later, a seventeen-year-old girl walked out of the jungle alone."]),
      ch("Into the Storm", "Toofan ke andar", [
        { id: "c2b1", text: "طوفان کے بیچ plane پر بجلی گری، اور plane ہوا میں ہی ٹوٹ گیا۔",
          roman: "Toofan ke beech plane par bijli giri, aur plane hawa mein hi toot gaya.",
          visual: { type: "ai", prompt: "lightning striking an old airliner inside a violent storm at night, dramatic" }, highlight: "LIGHTNING STRIKE" },
        { id: "c2b2", text: "Juliane Koepcke اپنی seat کے ساتھ نیچے جنگل کی طرف گرنے لگیں۔",
          roman: "Juliane Koepcke apni seat ke saath neeche jungle ki taraf girne lagin.",
          visual: { type: "clip", query: "rainforest canopy aerial", prompt: "view from above of an endless dense rainforest canopy under grey storm clouds" } },
        { id: "c2b3", text: "پوری کہانی ہمارے channel پر دیکھیں، اور ایسی ہی سچی کہانیوں کے لیے subscribe ضرور کریں۔",
          roman: "Poori kahani hamare channel par dekhein, aur aisi hi sachi kahaniyon ke liye subscribe zaroor karein.",
          visual: { type: "card", title: "SUBSCRIBE", text: "A new true story every day" } },
      ], ["A lightning strike broke the plane apart in mid-air.", "Juliane Koepcke fell towards the jungle, still strapped to her seat."]),
    ],
    shorts: [{ id: "s1", chapter: 1, titleEn: "She Fell From the Sky Into the Amazon", hook: "Aasman se jungle mein giri!",
      text: "سوچیں، آپ ایک plane میں بیٹھے ہیں، اور اچانک plane ہوا میں ٹوٹ جاتا ہے۔ 1971 میں سترہ سال کی Juliane Koepcke کے ساتھ یہی ہوا۔ پوری کہانی ہمارے channel پر دیکھیں۔",
      roman: "Sochein, aap ek plane mein baithe hain, aur achanak plane hawa mein toot jata hai. 1971 mein satrah saal ki Juliane Koepcke ke saath yahi hua. Poori kahani hamare channel par dekhein.",
      descriptionEn: "A true survival story from 1971.", tags: ["survival story", "true story urdu"] }],
    youtube: {},
  };
}

export async function writeScript(date = today(), { force = hasFlag("force"), mock = hasFlag("mock") } = {}) {
  let ep = readEpisode(date);
  if (ep?.stage === "done" && !force && (ep.metaChecked || ep.mock)) { console.log(`✔ Script for ${date} already written — "${ep.meta.youtubeTitle}"`); return ep; }
  if (force) ep = null;
  if (mock) { ep = await mockEpisode(date); writeEpisode(ep); console.log(`✎ Demo script written: ${ep.meta.youtubeTitle}`); return ep; }

  console.log(`✎ Writing documentary for ${date} (writer: ${provider()})...`);
  let articles;
  if (!ep) {
    const picked = await pickTopic(date);
    articles = picked.articles;
    const t = picked.topic;
    ep = {
      date, stage: "researched", generatedAt: new Date().toISOString(), language: "ur",
      topic: { name: t.name, category: CATEGORIES.includes(t.category) ? t.category : "history", angle: t.angle, why: t.why, wikiTitles: articles.map((a) => a.title) },
      sources: articles.map((a) => ({ title: a.title, url: a.url })),
      photos: await fetchPhotos(articles.map((a) => a.title)),
      youtube: {},
    };
    console.log(`  ✔ Topic: ${t.name} (${ep.photos.length} free photos)`);
    writeEpisode(ep);
  } else {
    articles = (await Promise.all(ep.topic.wikiTitles.map((t) => fetchArticle(t)))).filter(Boolean);
  }
  const sources = sourcesBlock(articles);

  if (ep.stage === "researched") {
    const o = await writeOutline(ep, sources);
    ep.meta = {
      youtubeTitle: str(o.youtubeTitle, 95), slug: `${date}-${slugify(ep.topic.name)}`,
      thumbnailText: o.thumbnailText, thumbnailPrompt: o.thumbnailPrompt, characters: o.characters,
      descriptionEn: o.descriptionEn, descriptionUr: o.descriptionUr, tags: cleanTags(o.tags),
      hashtags: (o.hashtags || []).map((h) => "#" + String(h).replace(/[#\s]/g, "")).slice(0, 3), metaDescription: o.metaDescription,
    };
    ep.chapters = o.chapters.slice(0, 10).map((c) => ({ titleEn: str(c.titleEn), titleRoman: str(c.titleRoman), covers: c.covers, words: Number(c.words) || 350 }));
    // Scale the per-chapter targets so they add up to the configured length.
    const planned = ep.chapters.reduce((n, c) => n + c.words, 0);
    ep.chapters.forEach((c) => (c.words = Math.round((c.words * config.targetWords) / planned / 10) * 10));
    ep.stage = "outlined";
    writeEpisode(ep);
    console.log(`  ✔ Outline: "${ep.meta.youtubeTitle}" — ${ep.chapters.length} chapters`);
  }

  for (let i = 0; i < ep.chapters.length; i += config.chaptersPerCall) {
    const idx = [...Array(Math.min(config.chaptersPerCall, ep.chapters.length - i)).keys()].map((k) => i + k);
    if (idx.every((k) => ep.chapters[k].beats?.length && ep.chapters[k].checked)) continue;
    if (!idx.every((k) => ep.chapters[k].beats?.length)) {
      await writeChapters(ep, sources, idx);
      const counts = () => idx.map((k) => `${chapterWords(ep.chapters[k])}/${ep.chapters[k].words}`).join(" · ");
      console.log(`  ✔ Wrote chapters ${idx.map((k) => k + 1).join(",")}: ${counts()} words`);
      await expandShortChapters(ep, sources, idx).catch((e) => console.warn(`  expand failed (keeping shorter text): ${e.message}`));
      writeEpisode(ep);
      console.log(`    after expanding: ${counts()} words`);
    }
    await factCheck(ep, sources, idx);
    idx.forEach((k) => (ep.chapters[k].checked = true));
    writeEpisode(ep);
  }

  if (!ep.shorts?.length) {
    ep.shorts = await writeShorts(ep, sources);
    console.log(`  ✔ ${ep.shorts.length} Shorts scripts`);
    writeEpisode(ep);
  }
  if (!ep.chapters.every((c) => c.articleEn?.length)) {
    await writeArticle(ep).catch((e) => console.warn(`  English article failed (website will show a summary): ${e.message}`));
    writeEpisode(ep);
  }
  if (!ep.metaChecked) {
    await checkMetadata(ep, sources);
    ep.metaChecked = true;
    writeEpisode(ep);
  }
  const beats = ep.chapters.flatMap((c) => c.beats);
  const noRoman = beats.filter((b) => !b.roman).length;
  if (noRoman) console.warn(`  ⚠ ${noRoman} beats have no Roman Urdu (no subtitles for those lines)`);
  ep.wordCount = wordCount(beats.map((b) => b.text).join(" "));
  ep.stage = "done";
  writeEpisode(ep);
  const kinds = beats.reduce((m, b) => ((m[b.visual.type] = (m[b.visual.type] || 0) + 1), m), {});
  console.log(`✔ Script done: ${ep.wordCount} words ≈ ${minutes(ep.wordCount)} min, ${beats.length} beats (${Object.entries(kinds).map(([k, v]) => `${v} ${k}`).join(", ")})`);
  return ep;
}

if (isMain(import.meta.url)) {
  writeScript().catch((e) => { console.error(e); process.exit(1); });
}

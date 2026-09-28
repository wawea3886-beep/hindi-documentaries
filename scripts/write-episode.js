// Step 1: pick today's topic → research it on Wikipedia → write a ~28 min Hindi documentary script
// in chapters → fact-check every chapter against the sources → write 3 Shorts scripts.
// Progress is saved after every stage, so a re-run continues where it stopped.
// Usage: node scripts/write-episode.js [--date=YYYY-MM-DD] [--force] [--mock]
import config from "../config.js";
import { llmJSON, provider, listFrom } from "./lib/llm.js";
import { trendingTopics, fetchArticle, fetchPhotos } from "./lib/research.js";
import { today, readEpisode, writeEpisode, allEpisodes, slugify, hasFlag, isMain } from "./lib/util.js";

const MAX_SOURCE_CHARS = 90000;
const CATEGORIES = ["mystery", "disaster", "survival", "history", "science", "crime", "scam"];
const wordCount = (s) => s.split(/\s+/).filter(Boolean).length;

const STYLE = `NARRATION STYLE (Hindi, Devanagari script):
- Spoken, simple Hindustani like India's best YouTube explainers: warm, curious, suspenseful, clear. Use common English words
  the way Indians speak (प्लेन, रेस्क्यू, एक्सपर्ट्स, रिपोर्ट) but no full English sentences.
- Short sentences that sound natural when read aloud by a text-to-speech voice. Write numbers as digits (1971, 92).
- Rhetorical questions and mini-cliffhangers between sections. Say "दोस्तों" at most once per chapter.
- 100% factual: every name, date, number and event must come from the SOURCES. If sources disagree, say so.
  Theories must be labelled as theories ("कुछ एक्सपर्ट्स का मानना है…"). Never invent quotes, dialogue or details.
- Respectful to victims. No graphic or gory descriptions. No political, religious or communal opinions. Neutral and fair.
- Do NOT copy phrases or catchphrases of any existing YouTuber.`;

async function pickTopic(date) {
  const recent = allEpisodes().filter((e) => e.date !== date).slice(0, 90).map((e) => e.topic?.name).filter(Boolean);
  const trends = await trendingTopics(date);
  console.log(`  ${trends.mostRead.length} trending articles, ${trends.onThisDay.length} on-this-day events`);
  const prompt = `You are head of research for a Hindi YouTube documentary channel (25-30 minute videos, like top Indian explainer channels).
Channel themes: ${config.themes.join("; ")}.
Today is ${date}. Propose 5 candidate topics for today's documentary, best first.

Prefer topics that are TRENDING right now (most-read Wikipedia list) or have an ANNIVERSARY today (on-this-day list);
famous evergreen stories are also fine. Stories connected to India/South Asia are a bonus but global stories are welcome.

MOST READ ON WIKIPEDIA YESTERDAY:
${trends.mostRead.join("\n") || "(unavailable)"}

ON THIS DAY IN HISTORY:
${trends.onThisDay.join("\n") || "(unavailable)"}

RULES
- Must have rich English Wikipedia coverage (a long main article plus related articles).
- Event must be at least 2 years old (no ongoing tragedies or breaking news). Nothing about current politics, elections,
  religion, caste or communal conflict. No living private individuals. Crime only if very famous and historical.
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

You are the lead writer of a Hindi YouTube documentary about: "${ep.topic.name}" (${ep.topic.angle}).
Using ONLY the sources above, plan a ${Math.round(config.targetWords / 125)}-minute documentary (~${config.targetWords} Hindi words of narration).

Structure like a gripping documentary:
- Chapter 1 = cold open (about 220 words): start at the most dramatic moment, raise 2-3 big questions, promise what the viewer will learn.
- Middle chapters: tell the story chronologically with rising tension; include background/context, the key moments,
  the investigation/rescue/aftermath, and analysis of causes or theories.
- Last chapter: conclusion — what changed afterwards, lessons, open questions, and a short request to like and subscribe.
- 7 to 9 chapters in total.

Return JSON:
{"youtubeTitle":"English, max 80 characters, curiosity-driven but truthful, e.g. '<Hook> | <Topic> True Story'",
"titleHi":"Hindi headline for the website",
"thumbnailText":"2-4 English words in CAPITALS for the thumbnail, e.g. 'SHE SURVIVED?'",
"thumbnailPrompt":"one dramatic image for the thumbnail: single clear subject, strong emotion, high contrast",
"characters":"short consistent visual descriptions (age, clothes, era, place) of the main people/places, used for every illustration",
"descriptionEn":"90-120 word English synopsis that makes people want to watch (no spoilers of the ending)",
"descriptionHi":"60-90 word Hindi synopsis",
"tags":["20 search tags mixing English and Hinglish, e.g. 'kedarnath disaster in hindi'"],
"hashtags":["3 hashtags without spaces, starting with #"],
"metaDescription":"150-160 character English summary for Google",
"chapters":[{"titleEn":"","titleHi":"","covers":"which facts/events from the sources this chapter covers","words":300}]}`;
  const o = await llmJSON(prompt, { label: "outline", temperature: 0.8 });
  if (!o.youtubeTitle || !Array.isArray(o.chapters) || o.chapters.length < 4) throw new Error("outline incomplete");
  return o;
}

function normalizeBeats(chapterIdx, beats, photos, characters) {
  const ids = new Set(photos.map((p) => p.id));
  return (beats || []).filter((b) => b?.text?.trim()).map((b, i) => {
    let v = b.visual || {};
    if (v.type === "photo" && !ids.has(v.photo)) v = { type: "ai", prompt: characters };
    if (v.type === "card" && !v.title) v = { type: "ai", prompt: characters };
    if (v.type !== "photo" && v.type !== "card") v = { type: "ai", prompt: (v.prompt || characters).trim() };
    return { id: `c${chapterIdx + 1}b${i + 1}`, text: b.text.trim(), visual: v };
  });
}

async function writeChapters(ep, sources, indices) {
  const outline = ep.chapters.map((c, i) => `${i + 1}. ${c.titleEn} / ${c.titleHi} (~${c.words} words): ${c.covers}`).join("\n");
  const prev = ep.chapters.slice(0, indices[0]).flatMap((c) => c.beats || []).slice(-4).map((b) => b.text).join(" ");
  const prompt = `${sources}

AVAILABLE REAL PHOTOS (freely licensed, from the articles above):
${photoList(ep.photos)}

You are writing the narration of a Hindi documentary: "${ep.meta.youtubeTitle}".
FULL OUTLINE:
${outline}

VISUAL CHARACTERS (use in every illustration prompt): ${ep.meta.characters}

${prev ? `The previous chapter ended with: "${prev}"\nContinue naturally from there.\n` : ""}
Write chapters ${indices.map((i) => i + 1).join(", ")} now. LENGTH IS CRITICAL — this is a long-form documentary, so each chapter
must reach AT LEAST its word count (Hindi words separated by spaces). Add depth instead of padding: background, context,
timeline details, numbers, what investigators found, different viewpoints — all from the sources.
${indices.map((i) => `- Chapter ${i + 1}: at least ${ep.chapters[i].words} words`).join("\n")}

${STYLE}

Split each chapter into BEATS of 20-35 Hindi words (1-3 sentences). Every beat gets exactly one visual:
- {"type":"ai","prompt":"English description of ONE illustration: who/what/where, era details, camera angle, mood"}
  (describe people generically — never claim a real person's exact likeness; no text in the image; no gore)
- {"type":"photo","photo":"p3"} — only when that real photo matches what is being said. Use each photo at most twice.
- {"type":"card","title":"24 DECEMBER 1971","text":"optional short Hindi line"} for a key date, number or quote,
  about 1 beat in 7. Title max 28 characters.

Return JSON: {"chapters":[{"index":<chapter number>,"beats":[{"text":"Hindi narration","visual":{...}}]}]}`;
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

/** Rewrite chapters that came out much shorter than planned (AI models tend to under-write long Hindi text). */
async function expandShortChapters(ep, sources, indices) {
  const short = indices.filter((i) => chapterWords(ep.chapters[i]) < ep.chapters[i].words * 0.85);
  if (!short.length) return;
  const prompt = `${sources}

AVAILABLE REAL PHOTOS:
${photoList(ep.photos)}

These chapters of the Hindi documentary "${ep.meta.youtubeTitle}" are TOO SHORT. Rewrite each one completely, keeping
everything that is already there and its style, but adding more depth from the SOURCES (context, timeline, numbers,
eyewitness accounts from the sources, investigation findings) until it reaches the required length.

${short.map((i) => `CHAPTER ${i + 1}: ${ep.chapters[i].titleEn} — now ${chapterWords(ep.chapters[i])} words, needs AT LEAST ${ep.chapters[i].words} words.
Covers: ${ep.chapters[i].covers}
Current beats:
${ep.chapters[i].beats.map((b) => `- ${b.text} [visual: ${JSON.stringify(b.visual)}]`).join("\n")}`).join("\n\n")}

${STYLE}

Keep the same beat format (20-35 Hindi words each, one visual per beat: ai / photo / card as before).
Return JSON: {"chapters":[{"index":<chapter number>,"beats":[{"text":"Hindi narration","visual":{...}}]}]}`;
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

You are a strict fact-checker for a Hindi documentary. Compare every beat below with the SOURCES.
Report ONLY real problems: facts not supported by the sources, wrong names/dates/numbers, invented quotes or details,
exaggeration, theories stated as facts, graphic/gory descriptions, or political/religious opinions.
For each problem give a corrected Hindi beat that says only what the sources support (same style and similar length).

BEATS:
${beats.map((b) => `[${b.id}] ${b.text}`).join("\n")}

Return JSON: {"issues":[{"id":"c2b5","problem":"short English explanation","fixedText":"corrected Hindi text"}]} — empty list if everything is correct.`;
  const issues = listFrom(await llmJSON(prompt, { label: "fact-check", temperature: 0.2 }), "issues");
  let fixed = 0;
  for (const is of issues) {
    const b = beats.find((x) => x.id === is.id);
    if (b && is.fixedText?.trim()) { b.text = is.fixedText.trim(); b.factFix = is.problem; fixed++; }
  }
  console.log(`  ✔ fact-checked chapters ${indices.map((i) => i + 1).join(",")}: ${fixed} fix(es)`);
}

async function writeShorts(ep, sources) {
  const chapters = ep.chapters.map((c, i) => `${i + 1}. ${c.titleEn}: ${c.beats.map((b) => b.text).join(" ").slice(0, 700)}`).join("\n");
  const prompt = `${sources}

The full documentary "${ep.meta.youtubeTitle}" has these chapters:
${chapters}

Write ${config.shortsPerDay} YouTube Shorts scripts in Hindi (each about 50 seconds), each about a DIFFERENT gripping moment,
taken from a different chapter. Facts only from the sources.
- text: 100-125 Hindi words. The first sentence must hook instantly (a shocking fact or question). Tell one self-contained moment.
  End with a cliffhanger and then exactly: "पूरी कहानी हमारे चैनल पर देखिए।"
${STYLE}

Return JSON: {"shorts":[{"chapter":<chapter number whose pictures to use>,"titleEn":"English, max 70 characters, curiosity-driven",
"hookHi":"Hindi on-screen headline, max 30 characters","text":"Hindi narration","descriptionEn":"2 short English lines",
"tags":["10 tags"]}]}`;
  const shorts = listFrom(await llmJSON(prompt, { label: "shorts" }), "shorts");
  if (shorts.length < config.shortsPerDay) throw new Error(`expected ${config.shortsPerDay} shorts, got ${shorts.length}`);
  return shorts.slice(0, config.shortsPerDay).map((s, i) => ({
    id: `s${i + 1}`,
    chapter: Math.min(Math.max(1, Number(s.chapter) || i + 2), ep.chapters.length) - 1,
    titleEn: String(s.titleEn).replace(/#shorts/gi, "").trim().slice(0, 88),
    hookHi: String(s.hookHi || "").trim(),
    text: String(s.text).trim(),
    descriptionEn: String(s.descriptionEn || "").trim(),
    tags: (s.tags || []).map(String),
  }));
}

/** Fact-check what viewers see first — titles, thumbnail text, descriptions, chapter names, Shorts headlines. */
async function checkMetadata(ep, sources) {
  const fields = {
    youtubeTitle: ep.meta.youtubeTitle, titleHi: ep.meta.titleHi, thumbnailText: ep.meta.thumbnailText,
    descriptionEn: ep.meta.descriptionEn, descriptionHi: ep.meta.descriptionHi, metaDescription: ep.meta.metaDescription,
    chapters: ep.chapters.map((c) => ({ titleEn: c.titleEn, titleHi: c.titleHi })),
    shorts: ep.shorts.map((s) => ({ titleEn: s.titleEn, hookHi: s.hookHi, descriptionEn: s.descriptionEn })),
  };
  const prompt = `${sources}

You are a strict fact-checker. Below are the title, thumbnail text, descriptions, chapter names and Shorts headlines of a
documentary. Check every number, date, duration, name and claim against the SOURCES. Correct anything that is not
supported (for example a wrong duration or death toll), keeping the same catchy style and language.
Limits: youtubeTitle max 80 characters; thumbnailText 2-4 English words in CAPITALS; hookHi max 30 characters.
If something is correct, return it unchanged.

${JSON.stringify(fields, null, 1)}

Return JSON: {"fixed": <the same object with corrections>, "changes": ["short English note per change"]}`;
  const out = await llmJSON(prompt, { label: "title fact-check", temperature: 0.2 });
  const f = out.fixed || out;
  const str = (v, max = 5000) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
  for (const k of ["youtubeTitle", "titleHi", "thumbnailText", "descriptionEn", "descriptionHi", "metaDescription"]) {
    const v = str(f[k], k === "youtubeTitle" ? 95 : 5000);
    if (v) ep.meta[k] = v;
  }
  (f.chapters || []).forEach((c, i) => { if (ep.chapters[i]) { ep.chapters[i].titleEn = str(c.titleEn) || ep.chapters[i].titleEn; ep.chapters[i].titleHi = str(c.titleHi) || ep.chapters[i].titleHi; } });
  (f.shorts || []).forEach((s, i) => {
    const t = ep.shorts[i];
    if (!t) return;
    t.titleEn = (str(s.titleEn) || t.titleEn).replace(/#shorts/gi, "").trim().slice(0, 88);
    t.hookHi = str(s.hookHi) || t.hookHi;
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
  const ch = (titleEn, titleHi, beats) => ({ titleEn, titleHi, covers: "", words: 0, beats });
  return {
    date, stage: "done", mock: true,
    topic: { name: "LANSA Flight 508 (demo)", category: "survival", angle: "Demo episode", wikiTitles: ["LANSA Flight 508", "Juliane Koepcke"] },
    sources: [{ title: "LANSA Flight 508", url: "https://en.wikipedia.org/wiki/LANSA_Flight_508" }, { title: "Juliane Koepcke", url: "https://en.wikipedia.org/wiki/Juliane_Koepcke" }],
    photos,
    meta: {
      youtubeTitle: "The Girl Who Survived the Fall | LANSA Flight 508 True Story (Demo)",
      titleHi: "आसमान से गिरी लड़की: LANSA फ्लाइट 508 की सच्ची कहानी", slug: `${date}-lansa-flight-508-demo`,
      thumbnailText: "SHE SURVIVED?", thumbnailPrompt: "a lone teenage girl standing in a vast misty rainforest, looking up at a stormy sky",
      characters: "a 17-year-old girl with short hair in a light summer dress, 1971 Peru, dense Amazon rainforest",
      descriptionEn: "Christmas Eve, 1971. A plane disappears over the Amazon rainforest. Days later, a teenage girl walks out of the jungle alone. This is a short demo of the automatic documentary pipeline.",
      descriptionHi: "24 दिसंबर 1971 को अमेज़न के जंगल के ऊपर एक प्लेन गायब हो गया। यह ऑटोमैटिक डॉक्यूमेंट्री सिस्टम का एक छोटा डेमो है।",
      tags: ["lansa flight 508", "juliane koepcke", "survival story in hindi", "true story hindi"],
      hashtags: ["#TrueStory", "#Survival", "#Hindi"],
      metaDescription: "The true story of LANSA Flight 508 and Juliane Koepcke, the teenager who survived a fall into the Amazon rainforest in 1971 — told in Hindi.",
    },
    chapters: [
      ch("Cold Open", "शुरुआत", [
        { id: "c1b1", text: "24 दिसंबर 1971. पेरू की राजधानी लीमा से एक प्लेन उड़ान भरता है। यह LANSA फ्लाइट 508 थी, जो पुकाल्पा शहर जा रही थी।", visual: { type: "card", title: "24 DECEMBER 1971", text: "लीमा से पुकाल्पा" } },
        { id: "c1b2", text: "प्लेन में सवार यात्री क्रिसमस मनाने अपने घर जा रहे थे। लेकिन आसमान में एक भयानक तूफान उनका इंतज़ार कर रहा था।", visual: { type: "ai", prompt: "a 1970s propeller airliner flying toward huge dark thunderstorm clouds above the Amazon rainforest" } },
        { id: "c1b3", text: "कुछ दिनों बाद, घने जंगल से एक सत्रह साल की लड़की अकेले बाहर निकली। आखिर उसके साथ क्या हुआ था?", visual: photoBeat },
      ]),
      ch("Into the Storm", "तूफान के अंदर", [
        { id: "c2b1", text: "तूफान के बीच प्लेन पर बिजली गिरी, और प्लेन हवा में ही टूट गया।", visual: { type: "ai", prompt: "lightning striking an old airliner inside a violent storm at night, dramatic" } },
        { id: "c2b2", text: "जूलियन कोपके अपनी सीट के साथ नीचे जंगल की ओर गिरने लगीं। पेड़ों ने शायद उनकी जान बचाई।", visual: { type: "ai", prompt: "view from above of an endless dense rainforest canopy under grey storm clouds" } },
        { id: "c2b3", text: "पूरी कहानी हमारे चैनल पर देखिए, और ऐसी ही सच्ची कहानियों के लिए सब्सक्राइब ज़रूर करें।", visual: { type: "card", title: "SUBSCRIBE", text: "हर दिन एक नई सच्ची कहानी" } },
      ]),
    ],
    shorts: [{ id: "s1", chapter: 1, titleEn: "She Fell From the Sky Into the Amazon", hookHi: "आसमान से जंगल में गिरी!", text: "सोचिए, आप एक प्लेन में बैठे हैं, और अचानक प्लेन हवा में टूट जाता है। 1971 में सत्रह साल की जूलियन कोपके के साथ यही हुआ। वह अपनी सीट के साथ अमेज़न के जंगल में जा गिरीं। और फिर शुरू हुई ज़िंदा रहने की एक अविश्वसनीय लड़ाई। पूरी कहानी हमारे चैनल पर देखिए।", descriptionEn: "A true survival story from 1971.", tags: ["survival story", "true story hindi"] }],
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
      date, stage: "researched", generatedAt: new Date().toISOString(),
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
      youtubeTitle: o.youtubeTitle.trim().slice(0, 95), titleHi: o.titleHi, slug: `${date}-${slugify(ep.topic.name)}`,
      thumbnailText: o.thumbnailText, thumbnailPrompt: o.thumbnailPrompt, characters: o.characters,
      descriptionEn: o.descriptionEn, descriptionHi: o.descriptionHi, tags: cleanTags(o.tags),
      hashtags: (o.hashtags || []).map((h) => "#" + String(h).replace(/[#\s]/g, "")).slice(0, 3), metaDescription: o.metaDescription,
    };
    ep.chapters = o.chapters.slice(0, 10).map((c) => ({ titleEn: c.titleEn, titleHi: c.titleHi, covers: c.covers, words: Number(c.words) || 350 }));
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
  }
  if (!ep.metaChecked) {
    await checkMetadata(ep, sources);
    ep.metaChecked = true;
    writeEpisode(ep);
  }
  const words = wordCount(ep.chapters.flatMap((c) => c.beats.map((b) => b.text)).join(" "));
  ep.wordCount = words;
  ep.stage = "done";
  writeEpisode(ep);
  console.log(`✔ Script done: ${words} words ≈ ${Math.round(words / 125)} min, ${ep.chapters.reduce((n, c) => n + c.beats.length, 0)} beats`);
  return ep;
}

if (isMain(import.meta.url)) {
  writeScript().catch((e) => { console.error(e); process.exit(1); });
}

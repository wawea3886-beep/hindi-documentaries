// Trending search phrases from YouTube's own search suggestions (what people are typing right now).
const JUNK = /\b(model|toy|lego|ringtone|song|lyrics|status|meme|game|roblox|minecraft|drawing|tutorial|wallpaper|background music|music|no copyright|reaction|prank|trailer|edit|whatsapp|movie|film|dubbed|netflix|series|season|episode|cartoon|anime)\b/i; // also misleading ones (it's not a movie)

// Other creators' / channels' names: using them as tags is "misleading metadata" under YouTube's spam policy.
const OTHER_CHANNELS = /\b(dhruv|rathee|katare|nitish|rajput|khan sir|ranveer|beerbiceps|abhi and niyu|mr ?beast|carryminati|triggered insaan|think school|fact ?tech|aaj tak|zee news|bbc|lallantop|study ?iq|drishti|vision ias|unacademy|physics wallah|al jazeera|cnn|vox|nat ?geo|national geographic|discovery|history channel|extra|podcast|shorts?)\b/i;

async function suggest(q) {
  try {
    const r = await fetch(`https://suggestqueries.google.com/complete/search?client=youtube&ds=yt&hl=en&gl=PK&q=${encodeURIComponent(q)}`,
      { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(15000) });
    const t = await r.text();
    const m = t.match(/\((\[.*\])\)\s*$/s);
    return (JSON.parse(m ? m[1] : t)[1] || []).map((x) => (Array.isArray(x) ? x[0] : x)).filter((x) => typeof x === "string");
  } catch {
    return [];
  }
}

/**
 * Popular searches about this topic, most relevant first. `seeds` = short names of the topic (e.g. "el faro", "ss el faro").
 * Only keeps suggestions that really contain the topic name.
 */
export async function trendingTags(seeds) {
  const core = [...new Set(seeds.map((s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim()).filter((s) => s.length > 2))];
  const variants = core.flatMap((s) => [s, `${s} documentary`, `${s} in urdu`, `${s} in hindi`, `${s} explained`, `${s} story`]);
  const seen = new Set(), out = [];
  for (const q of variants.slice(0, 14)) {
    for (const s of await suggest(q)) {
      const k = s.toLowerCase().trim();
      if (seen.has(k) || JUNK.test(k) || OTHER_CHANNELS.test(k) || k.length > 60) continue;
      if (!core.some((c) => new RegExp(`(^|\\s)${c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`).test(k))) continue; // must really be about this topic (whole words)
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}

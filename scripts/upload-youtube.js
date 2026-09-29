// Step 4: upload the long video (+ thumbnail, Hindi subtitles, chapters) and the 3 Shorts as scheduled videos.
// Quota: 4 uploads × 1600 + captions 400 + thumbnail 50 + playlists ≈ 7,050 of the free 10,000 units/day.
// Usage: node scripts/upload-youtube.js [--date=YYYY-MM-DD] [--dry-run]
import fs from "node:fs";
import path from "node:path";
import { google } from "googleapis";
import config from "../config.js";
import { today, readEpisode, writeEpisode, hasFlag, isMain, workDir, scheduleTime, clock } from "./lib/util.js";

export function youtubeClient() {
  const { YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN } = process.env;
  if (!YOUTUBE_CLIENT_ID || !YOUTUBE_CLIENT_SECRET || !YOUTUBE_REFRESH_TOKEN)
    throw new Error("YouTube credentials missing. Run `npm run youtube:auth` once (see README).");
  const auth = new google.auth.OAuth2(YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: YOUTUBE_REFRESH_TOKEN });
  return google.youtube({ version: "v3", auth });
}

const pageUrl = (ep) => `${config.siteUrl}/videos/${ep.meta.slug}/`;
const clean = (s, max) => String(s || "").replace(/[<>]/g, "").slice(0, max);

function longDescription(ep) {
  const chapters = (ep.render?.chapters || []).map((c, i) => `${clock(i === 0 ? 0 : c.start)} ${c.titleEn}`).join("\n");
  const clips = ep.render?.clipCredits || [];
  const parts = [
    ep.meta.descriptionEn, "", ep.meta.descriptionUr || ep.meta.descriptionHi || "", "",
    chapters ? `⏱️ Chapters\n${chapters}\n` : "",
    `📝 Full story in English, sources & photo credits: ${pageUrl(ep)}`,
    `📚 Research: ${ep.sources.slice(0, 4).map((s) => s.url).join(" , ")}`,
    clips.length ? `🎥 Stock footage & photos: Pexels (${[...new Set(clips.map((c) => c.user))].slice(0, 8).join(", ")})` : "",
    "",
    ep.presenter && Object.keys(ep.presenter).length
      ? "ℹ️ The narration voice, the presenter's lip-synced video and the illustrations are AI-generated. The presenter's likeness is used with their permission. All facts are based on the sources listed above; real photos are credited on screen and on the page above."
      : "ℹ️ The narration voice, the animated host and the illustrations are AI-generated / computer-made; the host is a fictional character. All facts are based on the sources listed above; real photos are credited on screen and on the page above.",
    "",
    ep.meta.hashtags.join(" "),
  ].filter((l, i, a) => l !== "" || a[i - 1] !== "");
  return clean(parts.join("\n"), 4900);
}

function shortDescription(ep, short, longId) {
  return clean([short.descriptionEn, "", longId ? `▶ Full documentary: https://youtu.be/${longId}` : "", `📝 ${pageUrl(ep)}`, "",
    `#Shorts ${ep.meta.hashtags.slice(0, 2).join(" ")}`].join("\n"), 4900);
}

function body({ title, description, tags, publishAt }) {
  return {
    snippet: {
      title: clean(title, 100), description, tags,
      categoryId: config.youtube.categoryId, defaultLanguage: config.youtube.metadataLanguage, defaultAudioLanguage: config.youtube.audioLanguage,
    },
    status: {
      privacyStatus: "private", // required for scheduling; YouTube makes it public at publishAt
      publishAt,
      selfDeclaredMadeForKids: false,
      containsSyntheticMedia: config.youtube.containsSyntheticMedia,
      embeddable: true,
      license: "youtube",
    },
  };
}

async function addToPlaylist(yt, playlistId, videoId) {
  if (!playlistId) return;
  await yt.playlistItems.insert({ part: ["snippet"], requestBody: { snippet: { playlistId, resourceId: { kind: "youtube#video", videoId } } } })
    .catch((e) => console.warn(`    playlist: ${e.message}`));
}

const reason = (e) => e.errors?.[0]?.reason || e.response?.data?.error?.errors?.[0]?.reason || "";

export async function uploadAll(date = today(), { dryRun = hasFlag("dry-run") } = {}) {
  const ep = readEpisode(date);
  if (!ep?.render) throw new Error(`Long video for ${date} has not been rendered.`);
  const yt = dryRun ? null : youtubeClient();
  ep.youtube ||= {};
  ep.youtube.shorts ||= {};
  console.log(`⬆ YouTube uploads for ${date}${dryRun ? " (dry run)" : ""}`);

  // ---- Long video ----
  const longFile = workDir(date, "long", "long.mp4");
  const longAt = ep.youtube.long?.publishAt || scheduleTime(date, config.longPublishUTC);
  const tags = ep.meta.tags;
  if (dryRun) {
    console.log(`  • LONG "${ep.meta.youtubeTitle}" → public ${longAt}\n${longDescription(ep).split("\n").map((l) => "      " + l).join("\n")}`);
  } else if (!ep.youtube.long?.videoId) {
    try {
      const res = await yt.videos.insert({ part: ["snippet", "status"], requestBody: body({ title: ep.meta.youtubeTitle, description: longDescription(ep), tags, publishAt: longAt }), media: { body: fs.createReadStream(longFile) } });
      ep.youtube.long = { videoId: res.data.id, url: `https://www.youtube.com/watch?v=${res.data.id}`, publishAt: longAt, uploadedAt: new Date().toISOString() };
      writeEpisode(ep);
      console.log(`  ✔ Long video → ${ep.youtube.long.url} (public ${longAt})`);
      await addToPlaylist(yt, config.youtube.playlistId, res.data.id);
    } catch (e) {
      console.error(`  ✖ Long video upload failed: ${e.message}`);
      if (/quotaExceeded|uploadLimitExceeded/.test(reason(e))) return ep;
    }
  } else console.log(`  ✔ Long video already uploaded (${ep.youtube.long.videoId})`);

  const L = ep.youtube.long;
  if (!dryRun && L?.videoId) {
    if (!L.thumbnail) {
      try {
        await yt.thumbnails.set({ videoId: L.videoId, media: { mimeType: "image/jpeg", body: fs.createReadStream(workDir(date, "long", "thumbnail.jpg")) } });
        L.thumbnail = true;
        console.log("  ✔ Thumbnail set");
      } catch (e) {
        console.warn(`  ⚠ Thumbnail not set: ${e.message}${/forbidden|verif/i.test(e.message) ? " — verify your channel with a phone number at youtube.com/verify" : ""}`);
      }
    }
    if (!L.captions) {
      try {
        const [language, name] = ep.language === "ur" ? ["ur", "Roman Urdu"] : ["hi", "हिन्दी"];
        await yt.captions.insert({ part: ["snippet"], requestBody: { snippet: { videoId: L.videoId, language, name, isDraft: false } },
          media: { mimeType: "application/octet-stream", body: fs.createReadStream(workDir(date, "long", "captions.srt")) } });
        L.captions = true;
        console.log(`  ✔ ${name} subtitles added`);
      } catch (e) { console.warn(`  ⚠ Subtitles not added: ${e.message}`); }
    }
    writeEpisode(ep);
  }

  // ---- Shorts (published after the long video so their link to it works) ----
  let prev = Date.parse(longAt);
  for (const [i, s] of ep.shorts.entries()) {
    const file = workDir(date, "shorts", s.id, "short.mp4");
    const done = ep.youtube.shorts[s.id];
    const at = done?.publishAt || scheduleTime(date, config.shortsPublishUTC[i % config.shortsPublishUTC.length], prev + 30 * 60000);
    prev = Date.parse(at);
    if (done?.videoId) { console.log(`  ✔ Short ${s.id} already uploaded`); continue; }
    if (!fs.existsSync(file)) { console.warn(`  ⚠ Short ${s.id}: no video file`); continue; }
    const title = `${s.titleEn} #Shorts`;
    if (dryRun) { console.log(`  • SHORT "${title}" → public ${at}`); continue; }
    try {
      const res = await yt.videos.insert({ part: ["snippet", "status"],
        requestBody: body({ title, description: shortDescription(ep, s, L?.videoId), tags: [...new Set([...s.tags.map((t) => t.toLowerCase()), ...tags.slice(0, 8)])].slice(0, 25), publishAt: at }),
        media: { body: fs.createReadStream(file) } });
      ep.youtube.shorts[s.id] = { videoId: res.data.id, url: `https://www.youtube.com/shorts/${res.data.id}`, publishAt: at, uploadedAt: new Date().toISOString() };
      writeEpisode(ep);
      console.log(`  ✔ Short ${s.id} → ${ep.youtube.shorts[s.id].url} (public ${at})`);
      await addToPlaylist(yt, config.youtube.shortsPlaylistId, res.data.id);
    } catch (e) {
      console.error(`  ✖ Short ${s.id}: ${e.message}`);
      if (/quotaExceeded|uploadLimitExceeded/.test(reason(e))) break;
    }
  }
  return ep;
}

if (isMain(import.meta.url)) {
  uploadAll().catch((e) => { console.error(e); process.exit(1); });
}

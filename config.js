// Central settings. Secrets live in .env (locally) or GitHub Secrets (cloud) — never here.
import dotenv from "dotenv";
dotenv.config({ quiet: true });

// Keys pasted into GitHub Secrets often carry a stray space or newline — remove it.
for (const k of Object.keys(process.env)) {
  if (/KEY|TOKEN|SECRET|ACCOUNT_ID|CLIENT_ID/.test(k) && process.env[k]) process.env[k] = process.env[k].trim();
}

const list = (v, d) => (v || d).split(",").map((s) => s.trim()).filter(Boolean);

export default {
  siteName: process.env.SITE_NAME || "Sach Ki Kahani",
  siteTagline: "Mysteries, disasters & true stories — a new documentary every day",
  siteTaglineEn: "Mysteries, disasters & true stories — a new documentary every day",
  // Full public URL of the website, no trailing slash (e.g. https://yourname.github.io/sach-ki-kahani)
  siteUrl: (process.env.SITE_URL || "http://localhost:8080").replace(/\/$/, ""),
  youtubeChannelUrl: process.env.YOUTUBE_CHANNEL_URL || "",

  // ---- Script ----
  targetWords: Number(process.env.TARGET_WORDS || 3900), // Urdu narration ≈147 words/min → ~27 min + host/title scenes
  wordsPerMinute: 147,
  chaptersPerCall: 3, // chapters written per AI request
  shortsPerDay: 3,
  // What the channel covers. The AI picks from trending Wikipedia topics that fit these.
  themes: [
    "unsolved mysteries", "famous disasters and what went wrong", "incredible survival stories",
    "strange historical events", "science and nature mysteries", "famous heists, scams and frauds",
    "lost civilizations and archaeology", "space and ocean mysteries", "famous historical crimes (no gore)",
  ],

  // ---- Voice (free Microsoft Edge voices) ----
  voice: process.env.VOICE || "ur-PK-AsadNeural", // Pakistani Urdu, male (female: ur-PK-UzmaNeural)
  speechRate: process.env.SPEECH_RATE || "+0%",

  // ---- Editing style ----
  shotSeconds: 4.5, // change the camera move / picture about this often (fast, modern documentary pacing)

  // ---- Presenter: photo in assets/presenter/ → free "narrator card" (photo + voice waveform),
  //      or real lip-sync with HeyGen when HEYGEN_API_KEY is set ----
  presenter: {
    engine: process.env.PRESENTER_ENGINE || "auto", // auto | card | heygen
    // full = on screen the whole video · scenes = intro, chapter starts and outro only · off = animated host
    mode: process.env.PRESENTER_MODE || "full",
    maxMinutesPerDay: Number(process.env.PRESENTER_MAX_MINUTES || 32), // cost cap; above it → "scenes" for that day
    pricePerMinute: 2.31, // HeyGen Avatar IV photo avatar, USD (for the cost estimate in the log)
    maxWaitMinutes: 150, // give up waiting for HeyGen after this and use the animated host instead
    faceY: Number(process.env.PRESENTER_FACE_Y || 0.40), // where the face is in the photo (0 = top, 1 = bottom), for the small boxes
    motionPrompt: "calm, confident documentary presenter talking to the camera, natural small head movements and occasional hand gestures",
  },

  // ---- Pictures ----
  cloudflareSteps: 4, // Flux-schnell steps: 4 keeps ~140 images/day inside Cloudflare's free allowance
  imageStyle: "cinematic documentary illustration, realistic digital painting, dramatic moody lighting, film still, wide 16:9 composition, highly detailed, no text, no words, no logos, no watermark, no gore",

  // ---- Publishing (UTC, "HH:MM"; hours ≥ 24 mean the next day) ----
  // Defaults: long video 6:30 PM IST, Shorts 8:00 PM IST, 9:00 AM IST and 1:00 PM IST next day.
  longPublishUTC: process.env.LONG_PUBLISH_UTC || "13:00",
  shortsPublishUTC: list(process.env.SHORTS_PUBLISH_UTC, "14:30,27:30,31:30"),

  // Script writer: Claude is used when CLAUDE_CODE_OAUTH_TOKEN (Claude Pro/Max) or ANTHROPIC_API_KEY is set,
  // otherwise Gemini. If Claude fails and a Gemini key exists, Gemini takes over.
  claude: { model: process.env.CLAUDE_MODEL || "sonnet" },
  gemini: { model: process.env.GEMINI_MODEL || "gemini-flash-latest" },

  youtube: {
    categoryId: "27", // Education (same as the reference documentaries)
    playlistId: process.env.YOUTUBE_PLAYLIST_ID || "",
    shortsPlaylistId: process.env.YOUTUBE_SHORTS_PLAYLIST_ID || "",
    audioLanguage: "ur", // narration: Urdu + English
    metadataLanguage: "en", // titles and descriptions are in English
    // Realistic AI pictures of real events must be disclosed to YouTube ("altered or synthetic content").
    containsSyntheticMedia: true,
  },
};

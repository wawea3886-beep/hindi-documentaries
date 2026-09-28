// Central settings. Secrets live in .env (locally) or GitHub Secrets (cloud) — never here.
import dotenv from "dotenv";
dotenv.config({ quiet: true });

const list = (v, d) => (v || d).split(",").map((s) => s.trim()).filter(Boolean);

export default {
  siteName: process.env.SITE_NAME || "Sach Ki Kahani",
  siteTagline: "रहस्य, हादसे और सच्ची कहानियाँ — हर दिन एक नई डॉक्यूमेंट्री",
  siteTaglineEn: "Mysteries, disasters & true stories — a new Hindi documentary every day",
  // Full public URL of the website, no trailing slash (e.g. https://yourname.github.io/sach-ki-kahani)
  siteUrl: (process.env.SITE_URL || "http://localhost:8080").replace(/\/$/, ""),
  youtubeChannelUrl: process.env.YOUTUBE_CHANNEL_URL || "",

  // ---- Script ----
  targetWords: Number(process.env.TARGET_WORDS || 3500), // Hindi narration ≈125 words/min → ~28 min
  chaptersPerCall: 3, // chapters written per Gemini request (fewer requests = safer on the free tier)
  shortsPerDay: 3,
  // What the channel covers. The AI picks from trending Wikipedia topics that fit these.
  themes: [
    "unsolved mysteries", "famous disasters and what went wrong", "incredible survival stories",
    "strange historical events", "science and nature mysteries", "famous heists, scams and frauds",
    "lost civilizations and archaeology", "space and ocean mysteries", "famous historical crimes (no gore)",
  ],

  // ---- Voice (free Microsoft Edge voices) ----
  voice: process.env.VOICE || "hi-IN-MadhurNeural", // female: hi-IN-SwaraNeural
  speechRate: process.env.SPEECH_RATE || "+4%",

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
    language: "hi",
    // Realistic AI pictures of real events must be disclosed to YouTube ("altered or synthetic content").
    containsSyntheticMedia: true,
  },
};

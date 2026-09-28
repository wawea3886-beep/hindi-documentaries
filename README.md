# 🔍 Sach Ki Kahani — a Hindi documentary every day, automatically

Every day, for free, with no one at the computer:

1. **Finds a topic**: a mystery, disaster, survival story, piece of history or scam that is trending on Wikipedia
   or has an anniversary today.
2. **Researches it** from Wikipedia articles and freely licensed Wikimedia Commons photos.
3. **Writes a 25–30 minute Hindi script** in 7–9 chapters (cold open → story → analysis → conclusion),
   then **fact-checks every chapter** against the sources.
4. **Makes the long video** (1920×1080): Hindi narration, AI illustrations, real photos with credits, fact cards,
   chapter titles, gentle camera moves, a thumbnail and a Hindi subtitle file.
5. **Makes 3 Shorts** (1080×1920) from the most gripping moments, with Hindi karaoke subtitles, each linking to the full video.
6. **Uploads everything to YouTube** as scheduled videos with SEO title, description, chapters, tags, hashtags,
   thumbnail, subtitles and playlists.
7. **Publishes a website page** for each video with the full script, sources and photo credits.

```
00:30 UTC (6:00 AM India)  GitHub Actions starts          ~45–60 min
  write-episode.js    topic → research → outline → chapters → fact-check → Shorts scripts
  make-long-video.js  pictures + narration → shots → long.mp4, thumbnail.jpg, captions.srt
  make-shorts.js      3 × short.mp4 (reuses the long video's pictures)
  upload-youtube.js   scheduled: long 6:30 PM · Shorts 8:00 PM, 9:00 AM, 1:00 PM (India time)
  build-site.js       dist/ → GitHub Pages
```
Everything is scheduled hours ahead, so **you have until the evening to check the video in YouTube Studio**.
To stop a video, just change it from *Scheduled* to *Private*.

---

## Setup (about 40 minutes, once)

### 1. Put the project on GitHub
1. Create a free account at https://github.com and a **new public repository** (e.g. `sach-ki-kahani`).
   Public repos get unlimited free Actions minutes.
2. Upload this folder (`F:\Youtube`) with **GitHub Desktop** (https://desktop.github.com):
   *File → Add local repository → F:\Youtube → Publish repository* (untick "Keep this code private").
3. In the repo: **Settings → Pages → Source: GitHub Actions**.

### 2. Free AI keys
| Secret name | Where to get it |
|---|---|
| `GEMINI_API_KEY` | https://aistudio.google.com/apikey → *Create API key* (free). About 9 requests a day. |
| `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` | https://dash.cloudflare.com → **AI → Workers AI → Use REST API** → create a token with *Workers AI* permission. The free daily allowance covers about 140 pictures. |
| `POLLINATIONS_API_KEY` | *Optional backup for pictures* — https://enter.pollinations.ai |

Without picture keys the video uses real Wikipedia photos + fact cards + plain title frames — it works, but looks much better with illustrations.

### 3. YouTube
1. **Verify your channel** with your phone at https://www.youtube.com/verify.
   ⚠ Required to upload videos **longer than 15 minutes** and to set **custom thumbnails**.
2. https://console.cloud.google.com → create a project → **APIs & Services → Library → YouTube Data API v3 → Enable**.
3. **OAuth consent screen**: External, add app name + your email, add yourself as a test user, then **Publish app**
   (status *In production*). ⚠ In *Testing* mode the login expires every 7 days.
4. **Credentials → Create credentials → OAuth client ID → Desktop app** → copy the Client ID and Client secret.
5. On your PC: copy `.env.example` to `.env`, fill in `YOUTUBE_CLIENT_ID` and `YOUTUBE_CLIENT_SECRET`, then:
   ```
   npm install
   npm run youtube:auth
   ```
   Sign in with the channel's Google account (*Advanced → Go to app* on the warning — it's your own app) and copy the printed `YOUTUBE_REFRESH_TOKEN`.
6. **Request the free API audit** so uploads can go public automatically: https://support.google.com/youtube/contact/yt_api_form
   ⚠ **Until approved, YouTube keeps every API upload private.** You can publish them yourself in YouTube Studio meanwhile.
7. Once, in YouTube Studio → *Settings → Upload defaults / End screens*: add an **end-screen template**
   (the last 12 seconds of every long video are left free for it).

### 4. Add everything to GitHub
Repo → **Settings → Secrets and variables → Actions**
- **Secrets**: `GEMINI_API_KEY`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `POLLINATIONS_API_KEY`,
  `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN`, `YOUTUBE_PLAYLIST_ID`, `YOUTUBE_SHORTS_PLAYLIST_ID`
- **Variables**: `SITE_URL` (= `https://YOUR-NAME.github.io/sach-ki-kahani`), `SITE_NAME`, `YOUTUBE_CHANNEL_URL`
  and optionally `VOICE`, `SPEECH_RATE`, `TARGET_WORDS`, `LONG_PUBLISH_UTC`, `SHORTS_PUBLISH_UTC`.

### 5. Start
**Actions → Daily documentary → Run workflow.** After that it runs every morning by itself.
If a run fails, press *Run workflow* again — finished steps are skipped and nothing is uploaded twice.
The finished videos are also downloadable from the run page for 3 days.

---

## Try it on your PC
```
npm install
npm run demo        # 1-minute demo documentary + Short (no keys needed) → work/ and dist/
npm run preview     # website at http://localhost:8080
npm run daily       # the real thing, using the keys in .env
```
Single steps: `npm run script`, `npm run long`, `npm run shorts`, `npm run upload -- --dry-run`, `npm run build`.
Flags: `--date=2026-10-01`, `--force` (rewrite the script), `--only=2` (one Short).

## Make it yours
- **config.js** — channel name, topics/themes, voice (`hi-IN-MadhurNeural` male / `hi-IN-SwaraNeural` female), length, publish times, picture style.
- **assets/music/** — drop in royalty-free tracks (e.g. from YouTube Studio → *Audio Library*). One is mixed in quietly under each video.
- **site/styles.css** — website look.

## Please read: YouTube rules
- **Accuracy**: scripts only use the Wikipedia sources and every chapter is fact-checked by a second AI pass —
  but AI can still make mistakes. Watching each video before it goes public (you have ~12 hours) is strongly recommended.
- **AI disclosure**: videos are marked as containing *altered or synthetic content* (realistic AI pictures of real events)
  and the description says the voice and illustrations are AI-generated. Keep this on.
- **Monetization**: YouTube's *inauthentic content* policy can refuse ads for mass-produced AI videos. Adding your own
  voice-over, intro, face-cam or commentary makes approval much more likely.
- **Photos**: only freely licensed Commons photos are used, with the author and licence shown on screen and on the website.
- **Quota**: 4 uploads + subtitles + thumbnail ≈ 7,050 of the free 10,000 daily API units.

## Costs
Gemini, Cloudflare Workers AI, Microsoft Edge voices, Wikipedia, GitHub Actions and GitHub Pages are all free at this volume: **$0/month**.

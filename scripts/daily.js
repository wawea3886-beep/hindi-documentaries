// The whole daily job: research + script → long video → 3 Shorts → scheduled YouTube uploads → website.
// Every step skips work that's already done, so re-running after a failure is always safe.
// Usage: node scripts/daily.js [--date=YYYY-MM-DD] [--mock] [--no-upload]
import { writeScript } from "./write-episode.js";
import { makeLongVideo } from "./make-long-video.js";
import { makeShorts } from "./make-shorts.js";
import { uploadAll } from "./upload-youtube.js";
import { buildSite } from "./build-site.js";
import { today, hasFlag, readEpisode, clock } from "./lib/util.js";

const date = today();
console.log(`\n===== Daily documentary: ${date} =====\n`);

await writeScript(date);
await makeLongVideo(date);
await makeShorts(date);

const mock = hasFlag("mock");
if (hasFlag("no-upload") || mock) console.log("⏭ Upload skipped");
else if (!process.env.YOUTUBE_REFRESH_TOKEN) console.warn("⚠ YOUTUBE_REFRESH_TOKEN not set — skipping YouTube upload.");
else await uploadAll(date);

buildSite({ withDemo: mock });

const ep = readEpisode(date);
const y = ep.youtube || {};
const shortsUp = Object.values(y.shorts || {}).filter((s) => s.videoId).length;
console.log(`\n✅ Done: "${ep.meta.youtubeTitle}" (${clock(ep.render?.duration || 0)}), long video ${y.long?.videoId ? "scheduled" : "not uploaded"}, ${shortsUp}/${ep.shorts.length} Shorts scheduled.`);
if (!mock && !hasFlag("no-upload") && process.env.YOUTUBE_REFRESH_TOKEN && (!y.long?.videoId || shortsUp < ep.shorts.length)) {
  console.error("Some uploads are missing — check the log above. Re-run the workflow to retry only what's missing.");
  process.exitCode = 1;
}

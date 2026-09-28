// Make a day's videos again (e.g. after changing music or style) while keeping the finished script.
// Clears the render and upload records so the next run re-renders and re-uploads.
// Delete the old uploads in YouTube Studio yourself first, or you'll have duplicates.
// Usage: node scripts/redo-video.js --date=YYYY-MM-DD
import { readEpisode, writeEpisode, argValue } from "./lib/util.js";

const date = argValue("date");
if (!date) { console.error("Usage: npm run redo -- --date=YYYY-MM-DD"); process.exit(1); }
const ep = readEpisode(date);
if (!ep) { console.error(`No episode for ${date}`); process.exit(1); }
const old = ep.youtube || {};
delete ep.render;
ep.shorts?.forEach((s) => delete s.render);
ep.youtube = {};
writeEpisode(ep);
console.log(`✔ ${date} "${ep.meta.youtubeTitle}" will be rendered and uploaded again by the next run.`);
const ids = [old.long?.url, ...Object.values(old.shorts || {}).map((s) => s.url)].filter(Boolean);
if (ids.length) console.log("Delete these old uploads in YouTube Studio:\n" + ids.map((u) => "  " + u).join("\n"));

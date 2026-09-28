// Sound effects made with FFmpeg's generators (no downloads, no licences): whoosh, pop, boom.
import fs from "node:fs";
import path from "node:path";
import { ffmpeg, mediaDuration } from "./util.js";
import { padAudio, concatCopy } from "./media.js";

const RECIPES = {
  // Filtered pink noise that swells and fades — a transition swish.
  whoosh: ["-f", "lavfi", "-i", "anoisesrc=d=0.7:c=pink:a=0.8", "-af", "bandpass=f=1400:width_type=h:w=2200,afade=t=in:d=0.3,afade=t=out:st=0.3:d=0.4,volume=0.9"],
  // Short bright blip for text popping on screen.
  pop: ["-f", "lavfi", "-i", "aevalsrc='0.6*sin(2*PI*(700+900*t)*t)*exp(-40*t)':d=0.18"],
  // Pitch-dropping sub hit for chapter titles.
  boom: ["-f", "lavfi", "-i", "aevalsrc='0.95*sin(2*PI*(70-35*t)*t)*exp(-2.2*t)+0.15*(random(0)-0.5)*exp(-8*t)':d=1.6", "-af", "lowpass=f=400"],
};

export function makeSfx(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return Promise.all(Object.entries(RECIPES).map(async ([name, args]) => {
    const out = path.join(dir, `${name}.wav`);
    if (!fs.existsSync(out)) await ffmpeg([...args, "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", out]);
    return [name, out];
  })).then(Object.fromEntries);
}

/** One sound-effects track: `events` = [{ t, name }], placed on a silent track `duration` seconds long. */
export async function sfxTrack(events, duration, dir) {
  const sounds = await makeSfx(path.join(dir, "sfx"));
  const lengths = Object.fromEntries(await Promise.all(Object.entries(sounds).map(async ([k, f]) => [k, await mediaDuration(f)])));
  const pieces = [];
  let t = 0, i = 0;
  for (const e of [...events].sort((a, b) => a.t - b.t)) {
    if (e.t < t || !sounds[e.name]) continue; // overlapping — skip
    if (e.t - t > 0.001) pieces.push(await padAudio(null, e.t - t, path.join(dir, "sfx", `gap${i++}-${Math.round((e.t - t) * 1000)}.wav`)));
    pieces.push(sounds[e.name]);
    t = e.t + lengths[e.name];
  }
  if (duration - t > 0.001) pieces.push(await padAudio(null, duration - t, path.join(dir, "sfx", `gap${i++}-${Math.round((duration - t) * 1000)}.wav`)));
  return concatCopy(pieces, path.join(dir, "sfx.wav"), dir);
}

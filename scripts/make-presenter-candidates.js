// Generate candidate portraits of a FICTIONAL presenter (a person who does not exist) to choose from.
// Runs on GitHub (where the image keys are). Output: work/presenter-candidates/*.jpg + sheet.jpg
// Usage: node scripts/make-presenter-candidates.js
import fs from "node:fs";
import path from "node:path";
import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas";
import { WORK_DIR, FONTS_DIR, retry } from "./lib/util.js";

const OUT = path.join(WORK_DIR, "presenter-candidates");
const COMMON = "photorealistic head-and-shoulders portrait photograph of a fictional person, looking straight into the camera, " +
  "gentle confident closed-mouth smile, face fully visible and centred, soft natural daylight, plain light grey background, " +
  "sharp focus, 85mm lens, professional presenter headshot, natural skin texture, no text, no watermark";
const LOOKS = [
  "young East Asian man in his late 20s, messy wavy dark hair, light stubble moustache, beige trench coat over a white t-shirt, thin silver chain",
  "young man in his late 20s, wavy black hair falling on the forehead, clean-shaven, beige trench coat over a white t-shirt",
  "Pakistani man in his early 30s, short neat black hair, well-groomed short beard, navy blazer over a white shirt, no tie",
  "South Asian man in his early 30s, wavy dark hair, light stubble, olive green bomber jacket over a black t-shirt",
  "Pakistani man in his mid 30s, short side-parted hair, trimmed full beard, charcoal grey suit, white shirt, open collar",
  "South Asian man in his late 20s, curly dark hair, clean-shaven, round thin-frame glasses, dark denim jacket over a grey t-shirt",
  "Punjabi man in his early 30s, short fade haircut, thick well-kept beard, black turtleneck sweater",
  "young South Asian man in his mid 20s, textured quiff hairstyle, light moustache and stubble, brown suede jacket over a white t-shirt",
];

async function cloudflare(prompt, out) {
  const { CLOUDFLARE_ACCOUNT_ID: acc, CLOUDFLARE_API_TOKEN: token } = process.env;
  if (!acc || !token) throw new Error("no Cloudflare key");
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acc}/ai/run/@cf/black-forest-labs/flux-1-schnell`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, steps: 8 }),
    signal: AbortSignal.timeout(120000),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Cloudflare ${res.status}: ${body.slice(0, 200)}`);
  fs.writeFileSync(out, Buffer.from(JSON.parse(body).result.image, "base64"));
}

async function pollinations(prompt, seed, out) {
  if (!process.env.POLLINATIONS_API_KEY) throw new Error("no Pollinations key");
  const url = `https://gen.pollinations.ai/image/${encodeURIComponent(prompt)}?model=flux&width=1024&height=1024&seed=${seed}&nologo=true`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${process.env.POLLINATIONS_API_KEY}` }, signal: AbortSignal.timeout(180000) });
  if (!res.ok) throw new Error(`Pollinations ${res.status}`);
  fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
}

fs.mkdirSync(OUT, { recursive: true });
const made = [];
for (const [i, look] of LOOKS.entries()) {
  const out = path.join(OUT, `presenter-${i + 1}.jpg`);
  const prompt = `${look}, ${COMMON}`;
  const seed = 1000 + i * 77;
  try {
    await retry(() => cloudflare(prompt, out).catch((e) => {
      console.warn(`  Cloudflare: ${e.message.split("\n")[0]} — trying Pollinations`);
      return pollinations(prompt, seed, out);
    }), { tries: 2, label: `portrait ${i + 1}` });
    made.push(out);
    console.log(`✔ presenter-${i + 1}: ${look}`);
  } catch (e) {
    console.warn(`✖ presenter-${i + 1}: ${e.message}`);
  }
}

// Contact sheet with numbers, so the choice is easy.
GlobalFonts.registerFromPath(path.join(FONTS_DIR, "Anton-Regular.ttf"), "Anton");
const cols = 4, cell = 400;
const sheet = createCanvas(cols * cell, Math.ceil(LOOKS.length / cols) * cell);
const ctx = sheet.getContext("2d");
ctx.fillStyle = "#111";
ctx.fillRect(0, 0, sheet.width, sheet.height);
for (const [i] of LOOKS.entries()) {
  const f = path.join(OUT, `presenter-${i + 1}.jpg`);
  const x = (i % cols) * cell, y = Math.floor(i / cols) * cell;
  if (fs.existsSync(f)) ctx.drawImage(await loadImage(fs.readFileSync(f)), x, y, cell, cell);
  ctx.fillStyle = "#FFD400";
  ctx.fillRect(x + 10, y + 10, 64, 64);
  ctx.fillStyle = "#111";
  ctx.font = "52px Anton";
  ctx.textAlign = "center";
  ctx.fillText(String(i + 1), x + 42, y + 62);
}
fs.writeFileSync(path.join(OUT, "sheet.jpg"), sheet.toBuffer("image/jpeg", 88));
console.log(`\n${made.length}/${LOOKS.length} portraits → ${OUT}`);
if (!made.length) process.exit(1);

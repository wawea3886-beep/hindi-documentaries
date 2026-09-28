// One-time setup: connect your YouTube channel.
// 1. Put the OAuth "client_secret_....json" file you downloaded from Google Cloud into this folder
//    (or put YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET in .env).
// 2. Run: npm run youtube:auth  → sign in → the keys are saved to GitHub Secrets and .env automatically.
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { exec, spawnSync } from "node:child_process";
import { google } from "googleapis";
import dotenv from "dotenv";
import { ROOT } from "./lib/util.js";
dotenv.config({ quiet: true, path: path.join(ROOT, ".env") });

const PORT = 53682;

function clientCredentials() {
  const file = fs.readdirSync(ROOT).find((f) => /^client_secret.*\.json$/i.test(f));
  if (file) {
    const j = JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));
    const c = j.installed || j.web || {};
    if (c.client_id && c.client_secret) { console.log(`Using ${file}`); return { id: c.client_id, secret: c.client_secret }; }
  }
  const id = process.env.YOUTUBE_CLIENT_ID?.trim(), secret = process.env.YOUTUBE_CLIENT_SECRET?.trim();
  if (id && secret) return { id, secret };
  console.error("No OAuth client found. Download the client JSON from Google Cloud (Clients → your Desktop client → Download JSON)\n" +
    `and put it in ${ROOT} — or fill YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET in .env.`);
  process.exit(1);
}

/** GitHub repo "owner/name" from the git remote, and the gh CLI path. */
function github() {
  const remote = spawnSync("git", ["remote", "get-url", "origin"], { cwd: ROOT, encoding: "utf8" }).stdout?.trim() || "";
  const repo = remote.match(/github\.com[/:]([^/]+\/[^/.]+)/)?.[1];
  const gh = ["gh", "C:\\Program Files\\GitHub CLI\\gh.exe"].find((g) => spawnSync(g, ["--version"]).status === 0);
  return { repo, gh };
}

function saveSecret(gh, repo, name, value) {
  // Value goes through stdin, so it never appears on screen or in the process list.
  const r = spawnSync(gh, ["secret", "set", name, "--repo", repo], { input: value, encoding: "utf8" });
  return r.status === 0;
}

function saveToEnv(values) {
  const f = path.join(ROOT, ".env");
  let text = fs.existsSync(f) ? fs.readFileSync(f, "utf8") : fs.readFileSync(path.join(ROOT, ".env.example"), "utf8");
  for (const [k, v] of Object.entries(values)) {
    const line = `${k}=${v}`;
    text = new RegExp(`^${k}=.*$`, "m").test(text) ? text.replace(new RegExp(`^${k}=.*$`, "m"), line) : text + `\n${line}`;
  }
  fs.writeFileSync(f, text);
}

const { id, secret } = clientCredentials();
const auth = new google.auth.OAuth2(id, secret, `http://127.0.0.1:${PORT}`);
const url = auth.generateAuthUrl({
  access_type: "offline",
  prompt: "consent", // forces Google to return a refresh token
  // upload + thumbnails/playlists + subtitles (captions need the force-ssl scope)
  scope: ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube", "https://www.googleapis.com/auth/youtube.force-ssl"],
});

const server = http.createServer(async (req, res) => {
  const code = new URL(req.url, `http://127.0.0.1:${PORT}`).searchParams.get("code");
  if (!code) { res.end("Waiting for Google sign-in..."); return; }
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  try {
    const { tokens } = await auth.getToken(code);
    if (!tokens.refresh_token) throw new Error("Google returned no refresh token — remove the app at https://myaccount.google.com/permissions and run this again.");
    auth.setCredentials(tokens);
    const ch = (await google.youtube({ version: "v3", auth }).channels.list({ part: ["snippet", "statistics"], mine: true })).data.items?.[0];
    if (!ch) throw new Error("This Google account has no YouTube channel. Run again and pick the account/channel you upload to.");
    console.log(`\n✔ Connected to YouTube channel: "${ch.snippet.title}" (${ch.statistics.subscriberCount ?? "?"} subscribers)`);

    const values = { YOUTUBE_CLIENT_ID: id, YOUTUBE_CLIENT_SECRET: secret, YOUTUBE_REFRESH_TOKEN: tokens.refresh_token };
    saveToEnv(values);
    console.log("✔ Saved to .env (stays on this PC)");
    const { repo, gh } = github();
    if (repo && gh && Object.entries(values).every(([k, v]) => saveSecret(gh, repo, k, v))) {
      console.log(`✔ Saved YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN to GitHub Secrets of ${repo}`);
    } else {
      console.log("⚠ Could not save to GitHub automatically. Add these three secrets by hand (values are in the .env file).");
    }
    res.end(`Connected to "${ch.snippet.title}". You can close this tab and go back to the terminal.`);
  } catch (e) {
    res.end("Error: " + e.message);
    console.error("✖ " + e.message);
  }
  server.close();
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("Opening Google sign-in. Choose the account and channel you upload to.\nIf the browser doesn't open, copy this link into it:\n\n" + url + "\n");
  const opener = process.platform === "win32" ? `start "" "${url}"` : process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
  exec(opener);
});

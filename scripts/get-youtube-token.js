// One-time setup: sign in to your YouTube channel and print a refresh token for .env / GitHub Secrets.
// Usage: npm run youtube:auth   (needs YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET in .env)
import http from "node:http";
import { exec } from "node:child_process";
import { google } from "googleapis";
import dotenv from "dotenv";
dotenv.config({ quiet: true });

const PORT = 53682;
const { YOUTUBE_CLIENT_ID: id, YOUTUBE_CLIENT_SECRET: secret } = process.env;
if (!id || !secret) {
  console.error("Put YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET in .env first (see README, step 3).");
  process.exit(1);
}

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
  try {
    const { tokens } = await auth.getToken(code);
    res.end("Done! You can close this tab and go back to the terminal.");
    console.log("\n✔ Success! Add this line to .env and as a GitHub Secret:\n");
    console.log(`YOUTUBE_REFRESH_TOKEN=${tokens.refresh_token}\n`);
    if (!tokens.refresh_token) console.log("⚠ No refresh token returned — remove the app at https://myaccount.google.com/permissions and try again.");
  } catch (e) {
    res.end("Error: " + e.message);
    console.error(e.message);
  }
  server.close();
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("Opening Google sign-in. Choose the account that owns your YouTube channel.\nIf the browser doesn't open, visit:\n\n" + url + "\n");
  const opener = process.platform === "win32" ? `start "" "${url}"` : process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
  exec(opener);
});

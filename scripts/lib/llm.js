// One entry point for the script writer: Claude (via your Claude Pro/Max subscription or an API key) when
// configured, otherwise Google Gemini. Every call returns parsed JSON.
import { spawn } from "node:child_process";
import config from "../../config.js";
import { geminiJSON } from "./gemini.js";
import { sleep } from "./util.js";

export const provider = () =>
  process.env.CLAUDE_CODE_OAUTH_TOKEN || process.env.ANTHROPIC_API_KEY ? "claude" : process.env.GEMINI_API_KEY ? "gemini" : null;

function runClaude(prompt) {
  return new Promise((resolve, reject) => {
    const win = process.platform === "win32";
    // No tools, one turn: Claude only reads the prompt and answers.
    const args = ["-p", "--output-format", "json", "--model", config.claude.model, "--max-turns", "1",
      "--disallowedTools", "*", "--strict-mcp-config", "--no-session-persistence"];
    // GitHub passes missing secrets as empty strings; drop them so they don't override the real login.
    const env = Object.fromEntries(Object.entries(process.env).filter(([k, v]) => v !== "" || !/^(ANTHROPIC|CLAUDE)_/.test(k)));
    const p = spawn(win ? "claude.cmd" : "claude", args, { shell: win, windowsHide: true, env });
    let out = "", err = "";
    const timer = setTimeout(() => p.kill(), 15 * 60 * 1000);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) => reject(new Error(e.code === "ENOENT" ? "Claude Code CLI not installed (npm install -g @anthropic-ai/claude-code)" : e.message)));
    p.on("close", () => {
      clearTimeout(timer);
      let res;
      try { res = JSON.parse(out); } catch { return reject(Object.assign(new Error(`no JSON from claude: ${(err || out).slice(0, 300)}`), { retryable: true })); }
      if (res.is_error || res.subtype !== "success") {
        const msg = String(res.result || res.subtype || err).slice(0, 300);
        return reject(Object.assign(new Error(msg), { retryable: !/auth|credential|invalid api key|login|oauth/i.test(msg), limit: /limit|429|overloaded|rate/i.test(msg) }));
      }
      resolve(res.result);
    });
    p.stdin.end(prompt + "\n\nReply with ONLY the JSON object — no markdown fences, no explanation.");
  });
}

function parseJSON(text) {
  const t = text.replace(/^\s*```(?:json)?|```\s*$/g, "").trim();
  try { return JSON.parse(t); } catch { /* fall through */ }
  const start = t.indexOf("{"), end = t.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(t.slice(start, end + 1));
  throw new Error("reply is not JSON");
}

async function claudeJSON(prompt, { label }) {
  for (let attempt = 1; ; attempt++) {
    try {
      return parseJSON(await runClaude(prompt));
    } catch (e) {
      const retryable = e.retryable !== false;
      if (!retryable || attempt >= 5) throw new Error(`${label} (Claude): ${e.message}`);
      // Subscription limits reset every few hours; wait longer when we hit one.
      const wait = e.limit ? 10 * 60000 * attempt : 20000 * attempt;
      console.warn(`  ${label} attempt ${attempt} failed: ${e.message.split("\n")[0]} — waiting ${Math.round(wait / 1000)}s`);
      await sleep(wait);
    }
  }
}

export async function llmJSON(prompt, opts = {}) {
  const label = opts.label || "AI";
  const p = provider();
  if (!p) throw new Error("No script-writing AI configured: add CLAUDE_CODE_OAUTH_TOKEN (Claude Pro) or GEMINI_API_KEY.");
  if (p === "claude") {
    try {
      return await claudeJSON(prompt, { label });
    } catch (e) {
      if (!process.env.GEMINI_API_KEY) throw e;
      console.warn(`  ${e.message.split("\n")[0]} — trying Gemini instead`);
    }
  }
  return geminiJSON(prompt, opts);
}

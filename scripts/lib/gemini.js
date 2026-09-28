// Google Gemini (free tier) → parsed JSON.
import config from "../../config.js";
import { sleep } from "./util.js";

let lastCall = 0;

export async function geminiJSON(prompt, { temperature = 0.9, label = "Gemini" } = {}) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is missing. Get a free key at https://aistudio.google.com/apikey");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.gemini.model}:generateContent`;

  for (let attempt = 1; ; attempt++) {
    // Space requests out so we stay under the free tier's per-minute limits.
    const wait = lastCall + 8000 - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json", temperature, maxOutputTokens: 60000 },
        }),
        signal: AbortSignal.timeout(300000),
      });
      if (res.status === 429 || res.status >= 500) throw Object.assign(new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`), { retryable: true });
      if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 500)}`);
      const data = await res.json();
      const cand = data.candidates?.[0];
      const text = cand?.content?.parts?.filter((p) => !p.thought).map((p) => p.text || "").join("");
      if (!text) throw Object.assign(new Error(`empty reply (${cand?.finishReason || data.promptFeedback?.blockReason || "unknown"})`), { retryable: true });
      try {
        return JSON.parse(text.replace(/^\s*```(?:json)?|```\s*$/g, "").trim());
      } catch {
        throw Object.assign(new Error(`invalid JSON (${cand.finishReason}): ${text.slice(0, 120)}…`), { retryable: true });
      }
    } catch (e) {
      const retryable = e.retryable || e.name === "TimeoutError" || e.name === "AbortError" || /fetch failed/.test(e.message);
      if (!retryable || attempt >= 5) throw new Error(`${label}: ${e.message}`);
      const backoff = /HTTP 429/.test(e.message) ? 45000 * attempt : 10000 * attempt;
      console.warn(`  ${label} attempt ${attempt} failed: ${e.message.split("\n")[0]} — waiting ${backoff / 1000}s`);
      await sleep(backoff);
    }
  }
}

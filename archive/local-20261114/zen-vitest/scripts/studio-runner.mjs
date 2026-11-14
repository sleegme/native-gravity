import { composeBoundedPrompt } from "./runner.mjs";

/**
 * Direct Google AI Studio execution lane (issue #2).
 *
 * A/B the same Gemini family through two execution profiles:
 *   model ── agy (Antigravity harness, invokeTransport)
 *         └─ google-ai-studio (direct generateContent REST call)
 *
 * This lane exists to separate model behavior from AGY harness/context/policy.
 * It is an additional execution lane, never a replacement runtime: it has no
 * tools, no subagents, no ledger authority — just one prompt in, one response
 * out, with provider metadata attached so comparisons can be attributed.
 *
 * Credentials: GOOGLE_AI_STUDIO_API_KEY or GOOGLE_API_KEY env var. The key is
 * sent only as the ?key= query parameter to Google; it is never written into
 * results, errors, logs, or ledger state.
 */

export const STUDIO_PROVIDER = "google-ai-studio";
export const STUDIO_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

export class StudioApiKeyMissingError extends Error {
  constructor() {
    super("GOOGLE_AI_STUDIO_API_KEY or GOOGLE_API_KEY is required for the google-ai-studio lane");
    this.name = "StudioApiKeyMissingError";
    this.code = "STUDIO_API_KEY_MISSING";
  }
}

export class StudioHttpError extends Error {
  constructor(status, statusText) {
    super(`Google AI Studio request failed: ${status} ${statusText}`);
    this.name = "StudioHttpError";
    this.code = "STUDIO_HTTP_ERROR";
    this.status = status;
  }
}

/** Never let a key-bearing URL or header into a serialized result/error. */
function redactKey(text, apiKey) {
  if (!apiKey || typeof text !== "string") return text;
  return text.split(apiKey).join("[redacted]");
}

function extractText(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .filter(part => part && typeof part.text === "string")
    .map(part => part.text)
    .join("");
}

/**
 * Invoke a Gemini model through the direct AI Studio API.
 *
 * @param {string} role      NTG role whose bounded prompt contract applies
 * @param {object} packet    handoff packet (same shape as invoke())
 * @param {object} [opts]
 * @param {string} [opts.model]        Gemini model id, e.g. "gemini-3.1-flash"
 * @param {number} [opts.timeout]      AbortSignal timeout ms (default 90000)
 * @param {object} [opts.generationConfig]  e.g. {temperature, maxOutputTokens}
 * @param {object} [opts.thinkingConfig]    e.g. {thinkingBudget} where exposed
 * @param {Function} [opts.fetchImpl]  injectable fetch for tests
 * @param {string} [opts.apiKey]       override; env vars are the normal source
 * @returns result with provider metadata: {ok, response, error?, role, model,
 *          provider, attempts, usage?} — same envelope conventions as invoke().
 */
export async function invokeStudio(role, packet, opts = {}) {
  const apiKey = opts.apiKey
    ?? process.env.GOOGLE_AI_STUDIO_API_KEY
    ?? process.env.GOOGLE_API_KEY;
  const model = opts.model;
  if (!apiKey) {
    return { ok: false, error: "STUDIO_API_KEY_MISSING", role, model, provider: STUDIO_PROVIDER,
             message: new StudioApiKeyMissingError().message };
  }
  if (typeof model !== "string" || !model.trim()) {
    return { ok: false, error: "STUDIO_MODEL_REQUIRED", role, model, provider: STUDIO_PROVIDER,
             message: "invokeStudio requires an explicit opts.model — this lane does not resolve AGY slugs" };
  }

  let prompt;
  try {
    prompt = composeBoundedPrompt(role, packet, opts);
  } catch (err) {
    return { ok: false, error: err.error || "INVALID_HANDOFF_PACKET", role, model,
             provider: STUDIO_PROVIDER, message: redactKey(err.message, apiKey) };
  }

  const body = { contents: [{ role: "user", parts: [{ text: prompt }] }] };
  if (opts.generationConfig && typeof opts.generationConfig === "object") {
    body.generationConfig = opts.generationConfig;
  }
  if (opts.thinkingConfig && typeof opts.thinkingConfig === "object") {
    body.generationConfig = { ...(body.generationConfig || {}), thinkingConfig: opts.thinkingConfig };
  }

  const timeout = typeof opts.timeout === "number" ? opts.timeout : 90000;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = `${STUDIO_API_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  let res;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });
  } catch (err) {
    const timeoutHit = err?.name === "TimeoutError" || err?.name === "AbortError";
    return { ok: false, error: timeoutHit ? "TIMEOUT" : "STUDIO_REQUEST_ERROR", role, model,
             provider: STUDIO_PROVIDER, timeout, attempts: 1,
             message: redactKey(String(err?.message ?? err), apiKey) };
  }

  const meta = { role, model, provider: STUDIO_PROVIDER, attempts: 1 };
  if (!res.ok) {
    let detail = "";
    try { detail = String((await res.text())).slice(0, 1024); } catch { /* unreadable body */ }
    return { ok: false, error: "STUDIO_HTTP_ERROR", ...meta,
             status: res.status,
             message: redactKey(`${res.status} ${res.statusText}${detail ? `: ${detail}` : ""}`, apiKey) };
  }

  let payload;
  try {
    payload = await res.json();
  } catch {
    return { ok: false, error: "INVALID_RESPONSE_FORMAT", ...meta,
             message: "AI Studio response was not JSON" };
  }

  const usage = payload?.usageMetadata && typeof payload.usageMetadata === "object"
    ? {
        promptTokenCount: payload.usageMetadata.promptTokenCount,
        candidatesTokenCount: payload.usageMetadata.candidatesTokenCount,
        totalTokenCount: payload.usageMetadata.totalTokenCount,
      }
    : undefined;

  const text = extractText(payload);
  if (!text.trim()) {
    const reason = payload?.candidates?.[0]?.finishReason;
    return { ok: false, error: "EMPTY_RESPONSE", ...meta,
             ...(usage ? { usage } : {}),
             ...(reason ? { finishReason: reason } : {}) };
  }
  return { ok: true, response: text, ...meta, ...(usage ? { usage } : {}) };
}

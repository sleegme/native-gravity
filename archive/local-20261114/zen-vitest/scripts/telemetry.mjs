/**
 * Tier-B telemetry helpers for NTG #114 (PO decision 2026-10-10, option B).
 *
 * Visibility tiers for orchestrator/planner telemetry:
 *   A — artifact/lane id + failure class only
 *   B — tier A + tool args / command line of the failed step (SELECTED)
 *   C — tier B + prompt text / contract fragments (NOT selected; never emitted)
 *
 * Piledriver (and any planning consumer) receives tier B. Tool arguments can
 * carry paths and secrets, so every telemetry string is passed through the
 * redaction list below at the boundary where it is recorded or projected:
 *
 *   - environment-variable assignments whose name looks secret-bearing
 *     (TOKEN, SECRET, PASSWORD, PASSWD, CREDENTIAL, KEY, AUTH) -> `NAME=<redacted>`
 *   - common secret token shapes (GitHub PAT/OAuth, OpenAI-style sk-,
 *     AWS access key ids, Slack xox*, Bearer/JWT, private-key blocks) -> `<redacted>`
 *   - absolute user paths (/home/<user>/..., /Users/<user>/...) -> `(local path)`
 *
 * Anything not matching the list passes through unchanged; the list is a
 * floor, not a guarantee — prompt text is excluded structurally by the
 * packet projection (scripts/spine.mjs buildReplanContext), not by matching.
 */

const SECRET_ENV_NAME =
  /(TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|KEY|AUTH)/i;

// NAME=value pairs. The value is redacted only when the name looks
// secret-bearing (checked in the replacer via isSecretEnvName), so DEBUG=1
// survives while SECRET=..., MY_API_KEY=..., TOKEN=... are removed.
const ENV_ASSIGNMENT_RE =
  /\b([A-Za-z_][A-Za-z0-9_]*)=(?:("[^"]*")|('[^']*')|(\S+))/g;

const SECRET_PATTERNS = [
  // PEM private-key blocks before the key body can be matched line-wise.
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  // GitHub tokens: ghp_/gho_/ghu_/ghs_/ghr_ and fine-grained github_pat_.
  /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  // OpenAI / Stripe-style sk- secrets (16+ tail chars).
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  // AWS access key ids.
  /\bAKIA[0-9A-Z]{16}\b/g,
  // Slack tokens xoxa-/xoxb-/xoxp-/xoxr-/xoxs-.
  /\bxox[abprs]-[A-Za-z0-9-]{8,}\b/g,
  // JWTs (three base64url segments starting eyJ).
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  // Explicit bearer / authorization headers.
  /\b(?:bearer|authorization):?\s+[A-Za-z0-9._~+/=-]{16,}\b/gi,
];

// Absolute user paths: /home/<name>/... and /Users/<name>/... . The home
// directory name itself is identifying, so the replacement drops it.
const USER_PATH_RE = /(?:\/home|\/Users)\/[^/\\\s:'"`,;)}\]]+(?:\/[^\s:'"`,;)}\]]*)?/g;

const REDACTED = "<redacted>";
const LOCAL_PATH = "(local path)";

/**
 * Redacts a single telemetry string. Idempotent.
 *
 * @param {string} text
 * @returns {string}
 */
export function redactTelemetryText(text) {
  if (typeof text !== "string" || text.length === 0) return text;
  let out = text;
  out = out.replace(ENV_ASSIGNMENT_RE, (match, name) =>
    isSecretEnvName(name) ? `${name}=${REDACTED}` : match);
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, REDACTED);
  }
  out = out.replace(USER_PATH_RE, LOCAL_PATH);
  return out;
}

/**
 * Deep-redacts every string inside a telemetry value (objects, arrays,
 * primitives). Returns a new structure; does not mutate the input.
 *
 * @param {*} value
 * @returns {*}
 */
export function redactTelemetryValue(value) {
  if (typeof value === "string") return redactTelemetryText(value);
  if (Array.isArray(value)) return value.map(redactTelemetryValue);
  if (value !== null && typeof value === "object") {
    const clone = {};
    for (const [key, item] of Object.entries(value)) {
      clone[key] = redactTelemetryValue(item);
    }
    return clone;
  }
  return value;
}

/**
 * Returns true when an env-var style name should be treated as secret-bearing.
 * Exported for the documented redaction list; used by ENV_ASSIGNMENT_RE.
 *
 * @param {string} name
 * @returns {boolean}
 */
export function isSecretEnvName(name) {
  return SECRET_ENV_NAME.test(String(name ?? ""));
}

const MAX_RELEVANT_FAILURES = 5;

/**
 * Projects one ledger failure_evidence record to its tier-B telemetry shape.
 * Tier B = artifact/lane identity + failure class + the failed step's tool
 * and args/command line. Raw worker packets, prompt text and error blobs are
 * never included; `transcript_ref` is a path, not transcript content.
 *
 * @param {object} entry - one ledger failure_evidence record
 * @param {string} milestoneId
 * @returns {object}
 */
export function projectFailureRecord(entry, milestoneId) {
  const record = {
    milestone_id: milestoneId,
    status: entry?.status ?? null,
    timestamp: entry?.timestamp ?? null,
  };
  const failedStep = entry?.evidence?.failed_step;
  if (failedStep && typeof failedStep === "object") {
    record.failed_step = failedStep;
  }
  const transcriptRef = entry?.evidence?.transcript_ref;
  if (typeof transcriptRef === "string" && transcriptRef) {
    record.transcript_ref = transcriptRef;
  }
  if (entry?.escalation_needs !== undefined && entry?.escalation_needs !== null) {
    record.escalation_needs = entry.escalation_needs;
  }
  return record;
}

/**
 * Projects a ledger `evidence` map to tier-B failure telemetry keyed by
 * milestone id. Candidate records (active_candidate, candidates, result_ref
 * keyed entries) carry worker-authored packets and are dropped — they are
 * tier-C material for a planning view.
 *
 * @param {object} evidence - ledger state `evidence` map
 * @returns {Object<string, Array<object>>}
 */
export function projectFailureTelemetry(evidence) {
  const telemetry = {};
  if (!evidence || typeof evidence !== "object") return telemetry;
  for (const [key, value] of Object.entries(evidence)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    if (!Array.isArray(value.failure_evidence) || value.failure_evidence.length === 0) {
      continue;
    }
    telemetry[key] = value.failure_evidence
      .slice(-MAX_RELEVANT_FAILURES)
      .map((entry) => projectFailureRecord(entry, key));
  }
  return telemetry;
}

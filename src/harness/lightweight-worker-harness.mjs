import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

export const LIGHTWEIGHT_MAX_READ_LINES = 150;
export const LIGHTWEIGHT_MAX_FILES = 6;

const DEEP_REASONING_RE =
  /\b(architect(?:ure|ural)?|cross[- ]cutting|state[- ]machine|migration|concurrency|race condition|security audit|multi[- ]file refactor|root[- ]cause recovery|kernel rewrite)\b/i;

/**
 * Evaluates whether a bounded task fits Jaguar / Puma (Gemini 3.8 Flash Low)
 * or should reroute cleanly to Bobcat (Hydrogen Medium) / Bulldozer (Hydrogen XHigh).
 */
export function evaluateLightweightSuitability({
  role,
  task = "",
  targetFiles = [],
  requiresShell = false,
  requiresSubstantiveCode = false,
} = {}) {
  const normalized = String(role ?? "").trim().toLowerCase();
  if (!["jaguar", "puma"].includes(normalized)) {
    return { suitable: true, rerouteTo: null, reason: null };
  }
  if (requiresShell) {
    return {
      suitable: false,
      signal: "REROUTE_REQUIRED",
      rerouteTo: "bobcat",
      reason: `${normalized} has no shell execution authority; reroute to bobcat`,
    };
  }
  if (normalized === "jaguar" && requiresSubstantiveCode) {
    return {
      suitable: false,
      signal: "REROUTE_REQUIRED",
      rerouteTo: "bobcat",
      reason: "jaguar is READ_ONLY; code changes reroute to bobcat",
    };
  }
  if (normalized === "puma" && requiresSubstantiveCode) {
    return {
      suitable: false,
      signal: "REROUTE_REQUIRED",
      rerouteTo: "bobcat",
      reason: "substantive code/state/test implementation exceeds puma mechanical scope; reroute to bobcat",
    };
  }
  if (Array.isArray(targetFiles) && targetFiles.length > LIGHTWEIGHT_MAX_FILES) {
    return {
      suitable: false,
      signal: "REROUTE_REQUIRED",
      rerouteTo: "bulldozer",
      reason: `target file count (${targetFiles.length}) exceeds lightweight cap (${LIGHTWEIGHT_MAX_FILES}); reroute to bulldozer`,
    };
  }
  if (DEEP_REASONING_RE.test(String(task))) {
    return {
      suitable: false,
      signal: "REROUTE_REQUIRED",
      rerouteTo: normalized === "jaguar" ? "bobcat" : "bulldozer",
      reason: "task requires deep cross-cutting reasoning unsuitable for Gemini 3.8 Flash Low",
    };
  }
  return { suitable: true, rerouteTo: null, reason: null };
}

/**
 * Context-capped file reader helper for Lightweight Worker Harness consumers.
 */
export function readBoundedRange(filePath, { startLine = 1, endLine = LIGHTWEIGHT_MAX_READ_LINES, cwd = process.cwd() } = {}) {
  const resolved = resolve(cwd, filePath);
  const st = statSync(resolved);
  if (!st.isFile()) {
    throw new Error(`Not a regular file: ${filePath}`);
  }
  const lines = readFileSync(resolved, "utf8").split(/\r?\n/);
  const clampedStart = Math.max(1, startLine);
  const maxEnd = clampedStart + LIGHTWEIGHT_MAX_READ_LINES - 1;
  const clampedEnd = Math.min(lines.length, Math.max(clampedStart, Math.min(endLine, maxEnd)));
  return {
    path: filePath,
    startLine: clampedStart,
    endLine: clampedEnd,
    totalLines: lines.length,
    truncated: clampedEnd < lines.length && endLine > maxEnd,
    content: lines.slice(clampedStart - 1, clampedEnd).join("\n"),
  };
}

/**
 * Validates Jaguar / Puma structured lightweight worker outputs.
 */
export function validateLightweightResult(role, result) {
  const normalized = String(role ?? "").trim().toLowerCase();
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return { valid: false, reason: "Lightweight worker result must be an object" };
  }
  if (result.status === "REROUTE_REQUIRED") {
    if (!["bobcat", "bulldozer"].includes(String(result.reroute_to || "").toLowerCase())) {
      return { valid: false, reason: "REROUTE_REQUIRED must name reroute_to: bobcat | bulldozer" };
    }
    return { valid: true };
  }
  if (!["READY", "BLOCKED"].includes(result.status)) {
    return { valid: false, reason: `Lightweight status must be READY, BLOCKED, or REROUTE_REQUIRED` };
  }
  if (normalized === "jaguar" && !Array.isArray(result.facts)) {
    return { valid: false, reason: "Jaguar READY/BLOCKED result requires a facts array" };
  }
  if (normalized === "puma" && !Array.isArray(result.changes_made)) {
    return { valid: false, reason: "Puma READY/BLOCKED result requires a changes_made array" };
  }
  return { valid: true };
}

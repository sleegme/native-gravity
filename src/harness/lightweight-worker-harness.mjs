import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

export const LIGHTWEIGHT_MAX_READ_LINES = 150;
export const LIGHTWEIGHT_MAX_FILES = 6;

const PATH_TOKEN_RE =
  /(?:^|(?<=[\s(\["'`]))(?:[A-Za-z0-9_.-]*\/+[A-Za-z0-9_./-]+|[A-Za-z0-9_.-]+\.(?:md|mdx|txt|rst|adoc|json|ya?ml|toml|ini|cfg|conf|mjs|cjs|js|jsx|ts|tsx|py|sh|bash|css|scss|html|xml|svg))(?=$|[\s)\]"'`,.:;!?])/gi;

const CODE_EXT_RE = /\.(?:m?js|cjs|jsx?|tsx?|py|sh|bash|go|rs|java|kt|c|cc|cpp|h|hpp|rb|php|sql)$/i;
const DOC_OR_CONFIG_FILE_RE =
  /(?:^|\/)(?:README(?:\.[^/]*)?|CHANGELOG(?:\.[^/]*)?|LICENSE(?:\.[^/]*)?)$|\.(?:md|mdx|txt|rst|adoc|json|ya?ml|toml|ini|cfg|conf|env\.example)$/i;

const READ_ONLY_INTENT_RE =
  /\b(?:find|locate|search|grep|inspect|list|where\s+is|identify|discover|survey|read[- ]only|check\s+which|count|summarize|audit)\b/i;
const MUTATION_INTENT_RE =
  /\b(?:fix|edit|update|add|remove|delete|rename|format|change|write|implement|refactor|migrate|rewrite|create|patch|replace|bump|modify|build|wire|enforce|clean\s+up)\b/i;

const MECHANICAL_EDIT_RE =
  /\b(?:typo|typos|format|formatting|indent|indentation|whitespace|comment|comments|doc|docs|documentation|readme|badge|changelog|mechanical|trivial|rename|wording|spelling|header|banner|link|links|bump\s+version|config\s+(?:value|entry|key|port))\b/i;

const SUBSTANTIVE_LOGIC_RE =
  /\b(?:implement|state[- ]machine|concurrency|race\s+condition|deadlock|mutex|authentication|authorization|auth\s+schema|schema\s+persistence|validation\s+(?:logic|handler)|api\s+(?:endpoint|contract|handler|route|change)|database\s+migration|schema\s+migration|security\s+(?:audit|fix)|kernel\s+rewrite|multi[- ]file\s+refactor|architectural\s+(?:refactor|redesign|migration|overhaul|concurrency)|concurrency\s+refactor|root[- ]cause\s+recovery)\b/i;

const COORDINATOR_RE =
  /\b(?:multi[- ]milestone|cross[- ]cutting|kernel\s+rewrite|system[- ]wide|architectural\s+(?:refactor|redesign|migration|overhaul|concurrency)|concurrency\s+refactor|multi[- ]worker)\b/i;

const TRACK_S_SEMANTIC_RE =
  /\b(?:schema|auth|authentication|state[- ]machine|api|database|refactor|hook|ledger|concurrency|persist(?:ence)?|migration)\b/i;

export function isDocOrConfigFile(filePath) {
  const clean = String(filePath || "").trim();
  if (!clean || CODE_EXT_RE.test(clean)) return false;
  return DOC_OR_CONFIG_FILE_RE.test(clean);
}

/**
 * Classifies work by capability/effect semantics (mutation, shell, mechanical vs
 * substantive logic, cross-file coordination, and risk) rather than filename or
 * isolated lexical triggers (#235).
 */
export function analyzeWorkSemantics({
  task = "",
  targetFiles = [],
  milestoneCount = 1,
  requiresMutation = undefined,
  requiresShell = false,
  requiresSubstantiveCode = false,
  isMechanicalEdit = undefined,
  crossFileDependency = false,
  requiresCoordinator = false,
  recoveryMode = false,
  highRisk = false,
  riskClass = null,
} = {}) {
  const rawTask = String(task || "");
  const explicitFiles = Array.isArray(targetFiles)
    ? targetFiles.filter((f) => typeof f === "string" && f.trim())
    : [];
  const inlineFiles =
    explicitFiles.length > 0 ? [] : (rawTask.match(PATH_TOKEN_RE) ?? []).map((s) => s.trim());
  const effectiveFiles = explicitFiles.length > 0 ? explicitFiles : inlineFiles;

  // Strip filenames/paths before evaluating task semantics so e.g. "architecture.md"
  // does not act as a lexical trigger for Track M or Bulldozer (#235).
  const cleanTask = rawTask.replace(PATH_TOKEN_RE, " ").replace(/\s+/g, " ").trim();

  const allFilesDocOrConfig = effectiveFiles.length > 0 && effectiveFiles.every(isDocOrConfigFile);
  const hasCodeFiles = effectiveFiles.some((f) => CODE_EXT_RE.test(String(f || "").trim()));
  const highRiskFlag = Boolean(highRisk || String(riskClass || "").trim().toLowerCase() === "high");

  const hasReadIntent = READ_ONLY_INTENT_RE.test(cleanTask);
  const hasMutateIntent = MUTATION_INTENT_RE.test(cleanTask);

  const isReadOnlyDiscovery =
    requiresMutation === false ||
    (requiresMutation !== true &&
      !requiresShell &&
      !requiresSubstantiveCode &&
      isMechanicalEdit !== true &&
      !recoveryMode &&
      !requiresCoordinator &&
      hasReadIntent &&
      !hasMutateIntent);

  const explicitMechanical = isMechanicalEdit === true;
  const lexicalMechanical = MECHANICAL_EDIT_RE.test(cleanTask);
  const substantivePhrase = SUBSTANTIVE_LOGIC_RE.test(cleanTask);
  const coordinatorPhrase = COORDINATOR_RE.test(cleanTask);

  const hasSubstantiveSignal = Boolean(
    requiresSubstantiveCode ||
      requiresShell ||
      highRiskFlag ||
      (!explicitMechanical && !allFilesDocOrConfig && substantivePhrase) ||
      (!explicitMechanical &&
        allFilesDocOrConfig &&
        coordinatorPhrase) ||
      (!isReadOnlyDiscovery &&
        !explicitMechanical &&
        !lexicalMechanical &&
        !allFilesDocOrConfig &&
        (hasCodeFiles || hasMutateIntent))
  );

  const isMechanical =
    explicitMechanical ||
    (!isReadOnlyDiscovery &&
      !requiresSubstantiveCode &&
      !requiresShell &&
      !highRiskFlag &&
      !crossFileDependency &&
      !requiresCoordinator &&
      !recoveryMode &&
      !hasSubstantiveSignal &&
      (allFilesDocOrConfig || lexicalMechanical));

  const exceedsLightweightCap = effectiveFiles.length > LIGHTWEIGHT_MAX_FILES;
  const needsCoordinator = Boolean(
    recoveryMode ||
      requiresCoordinator ||
      milestoneCount > 1 ||
      crossFileDependency ||
      exceedsLightweightCap ||
      (!isReadOnlyDiscovery && !explicitMechanical && coordinatorPhrase)
  );

  const isSubstantive = !isReadOnlyDiscovery && !isMechanical && !needsCoordinator;

  let recommendedRole;
  if (needsCoordinator) {
    recommendedRole = "bulldozer";
  } else if (isReadOnlyDiscovery) {
    recommendedRole = "jaguar";
  } else if (isMechanical) {
    recommendedRole = "puma";
  } else {
    recommendedRole = "bobcat";
  }

  let recommendedTrack;
  if (milestoneCount > 1 || needsCoordinator) {
    recommendedTrack = "M";
  } else if (
    highRiskFlag ||
    requiresShell ||
    requiresSubstantiveCode ||
    (!isReadOnlyDiscovery &&
      !isMechanical &&
      (effectiveFiles.length > 2 || TRACK_S_SEMANTIC_RE.test(cleanTask) || hasSubstantiveSignal))
  ) {
    recommendedTrack = "S";
  } else {
    recommendedTrack = "L";
  }

  return {
    effectiveFiles,
    allFilesDocOrConfig,
    hasCodeFiles,
    isReadOnlyDiscovery,
    isMechanical,
    isSubstantive,
    needsCoordinator,
    requiresShell: Boolean(requiresShell),
    highRisk: highRiskFlag,
    recommendedRole,
    recommendedTrack,
  };
}

/**
 * Evaluates whether a bounded task fits Jaguar / Puma (Gemini 3.8 Flash Low)
 * or should reroute cleanly to Bobcat (Hydrogen Medium) / Bulldozer (Hydrogen XHigh).
 */
export function evaluateLightweightSuitability({
  role,
  task = "",
  targetFiles = [],
  requiresMutation = undefined,
  requiresShell = false,
  requiresSubstantiveCode = false,
  isMechanicalEdit = undefined,
  crossFileDependency = false,
  requiresCoordinator = false,
  highRisk = false,
  riskClass = null,
} = {}) {
  const normalized = String(role ?? "").trim().toLowerCase();
  if (!["jaguar", "puma"].includes(normalized)) {
    return { suitable: true, rerouteTo: null, reason: null };
  }
  const semantics = analyzeWorkSemantics({
    task,
    targetFiles,
    requiresMutation,
    requiresShell,
    requiresSubstantiveCode,
    isMechanicalEdit,
    crossFileDependency,
    requiresCoordinator,
    highRisk,
    riskClass,
  });
  if (requiresShell) {
    return {
      suitable: false,
      signal: "REROUTE_REQUIRED",
      rerouteTo: "bobcat",
      reason: `${normalized} has no shell execution authority; reroute to bobcat`,
    };
  }
  if (normalized === "jaguar" && (requiresMutation === true || requiresSubstantiveCode || semantics.isSubstantive || semantics.isMechanical)) {
    if (semantics.needsCoordinator) {
      return {
        suitable: false,
        signal: "REROUTE_REQUIRED",
        rerouteTo: "bulldozer",
        reason: "cross-cutting or coordinator-grade task exceeds jaguar read-only scope; reroute to bulldozer",
      };
    }
    return {
      suitable: false,
      signal: "REROUTE_REQUIRED",
      rerouteTo: semantics.isMechanical ? "puma" : "bobcat",
      reason: "jaguar is READ_ONLY; mutation tasks reroute away from jaguar",
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
  if (semantics.needsCoordinator) {
    return {
      suitable: false,
      signal: "REROUTE_REQUIRED",
      rerouteTo: normalized === "jaguar" ? "bobcat" : "bulldozer",
      reason: "task requires cross-cutting or coordinator-grade execution unsuitable for Gemini 3.8 Flash Low",
    };
  }
  if (normalized === "puma" && (requiresSubstantiveCode || semantics.isSubstantive)) {
    return {
      suitable: false,
      signal: "REROUTE_REQUIRED",
      rerouteTo: "bobcat",
      reason: "substantive code/state/test implementation exceeds puma mechanical scope; reroute to bobcat",
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

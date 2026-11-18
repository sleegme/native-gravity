import { spawnSync } from "node:child_process";
import { buildScopeMap } from "../../scripts/coverage.mjs";
import { computeAcceptanceDigest, computeDiffDigest } from "../core/lightweight-log.mjs";

/**
 * Layer 3: Context & Tool Interface Optimization (`ContextDigest`).
 * Auto-injects compact scope_map, git_diff_stat, changed_symbol_ranges,
 * failure_summary, and digest bindings into delegation and review packets.
 */
export function buildContextDigest({
  boundedScope = [],
  cwd = process.cwd(),
  failureHistory = [],
  acceptanceCriteria = [],
  maxFailureEntries = 5,
} = {}) {
  const scope = Array.isArray(boundedScope) ? boundedScope : [];
  const scopeMap = buildScopeMap(scope, { cwd });
  const scopeFiles = Array.isArray(scopeMap?.files)
    ? scopeMap.files
    : Array.isArray(scopeMap)
      ? scopeMap
      : [];

  let gitDiffStat = "";
  try {
    const res = spawnSync("git", ["diff", "--stat", "--", ...scope], {
      cwd,
      encoding: "utf8",
      timeout: 5000,
    });
    if (res.status === 0 && typeof res.stdout === "string") {
      gitDiffStat = res.stdout.trim();
    }
  } catch {
    gitDiffStat = "";
  }

  const changedSymbolRanges = scopeFiles
    .filter((entry) => entry && entry.lines > 0 && Array.isArray(entry.symbols))
    .map((entry) => ({
      path: entry.path,
      lines: entry.lines,
      symbols: entry.symbols.slice(0, 20),
    }));

  const failureSummary = Array.isArray(failureHistory)
    ? failureHistory.slice(-maxFailureEntries).map((item) => {
        if (typeof item === "string") return item;
        return {
          status: item?.status ?? "UNKNOWN",
          error: item?.evidence?.error ?? item?.error ?? item?.repair_needs ?? null,
          tool: item?.evidence?.failed_step?.tool ?? null,
        };
      })
    : [];

  return {
    scope_map: scopeMap,
    git_diff_stat: gitDiffStat,
    changed_symbol_ranges: changedSymbolRanges,
    failure_summary: failureSummary,
    delivered_diff_digest: computeDiffDigest(scope, { cwd }),
    acceptance_criteria_digest: computeAcceptanceDigest(acceptanceCriteria),
  };
}

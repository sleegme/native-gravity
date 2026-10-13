#!/usr/bin/env node
// Audit each file independently: matching positions, not unique candidate runs.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const baselineRef = "427544cc39141df35918c0a6d79e6e1b4c208607";
const revision = process.argv[2] ?? "workspace";
const git = (...args) => execFileSync("git", args, { encoding: "utf8" });
const runs = (text) => {
  const tokens = text.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
  return Array.from({ length: Math.max(0, tokens.length - 7) },
    (_, offset) => tokens.slice(offset, offset + 8).join(" "));
};
const baselinePaths = git("ls-tree", "-r", "--name-only", baselineRef, "--",
  "agents", "rules", "hooks", "AGENTS.md").trim().split("\n");
const baseline = new Set(baselinePaths.flatMap(
  (path) => runs(git("show", `${baselineRef}:${path}`))));
const packOutput = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json"],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
const pack = Object.values(packOutput)[0];
const paths = [...pack.files.map(({ path }) => path), "AGENTS.md"].sort();
console.log(`Baseline: ${baselineRef}; files: ${baselinePaths.length}; unique runs: ${baseline.size}`);
console.log(`Candidate: ${revision}; packed files: ${pack.files.length}; workspace guide: AGENTS.md`);
console.log("| File | Shared | Total | Percent |");
console.log("|---|---:|---:|---:|");
for (const path of paths) {
  const text = revision === "workspace" ? readFileSync(path, "utf8")
    : git("show", `${revision}:${path}`);
  const candidate = runs(text);
  const shared = candidate.filter((run) => baseline.has(run)).length;
  const percent = candidate.length === 0 ? 0 : 100 * shared / candidate.length;
  console.log(`| ${path} | ${shared} | ${candidate.length} | ${percent.toFixed(3)} |`);
}

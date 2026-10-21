import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

const ROLE_FILES = [
  "agents/bulldozer.md",
  "agents/jaguar.md",
  "agents/puma.md",
  "agents/bobcat.md",
  "agents/strix-halo.md",
  "agents/zen.md",
];

const ALL_GUIDANCE_FILES = [...ROLE_FILES, "rules/orchestration.md"];

const BASE_COMMIT = "2ff0083";

function parseAgent(relPath) {
  const fullPath = join(ROOT, relPath);
  const text = readFileSync(fullPath, "utf8");
  const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  assert.ok(match, `${relPath} must have frontmatter`);
  const [, frontmatter, body] = match;
  const toolsMatch = frontmatter.match(/^tools:\n((?:  - .+\n)+)/m);
  const tools = toolsMatch
    ? toolsMatch[1].trim().split("\n").map(l => l.trim().slice(2))
    : [];
  return { frontmatter, body, tools, text };
}

function extractAppendedGuidance(text) {
  const heading = "## Targeted reading and compact handoffs";
  const idx = text.indexOf(heading);
  assert.ok(idx !== -1, `file must contain ${heading}`);
  return text.slice(idx);
}

test("Byte-prefix equality against base 2ff0083 holds for all 7 guidance files", () => {
  for (const relPath of ALL_GUIDANCE_FILES) {
    const fullPath = join(ROOT, relPath);
    const currentBuf = readFileSync(fullPath);
    const baseBuf = execFileSync("git", ["show", `${BASE_COMMIT}:${relPath}`], { cwd: ROOT });

    assert.ok(
      currentBuf.subarray(0, baseBuf.length).equals(baseBuf),
      `Prefix mismatch against ${BASE_COMMIT} for ${relPath}`
    );
    assert.ok(
      currentBuf.length > baseBuf.length,
      `File ${relPath} must have appended guidance beyond base`
    );

    const appended = currentBuf.subarray(baseBuf.length).toString("utf8");
    assert.match(
      appended,
      /^\n## Targeted reading and compact handoffs\n/,
      `Appended section in ${relPath} must begin with standard heading`
    );
  }
});

test("No appended role guidance instructs tools absent from frontmatter or contradicts contracts", () => {
  for (const relPath of ROLE_FILES) {
    const { tools, text } = parseAgent(relPath);
    const appended = extractAppendedGuidance(text);

    if (relPath.includes("bulldozer")) {
      assert.ok(!tools.includes("run_command"), "Bulldozer must not have run_command");
      assert.doesNotMatch(appended, /Locate with `?wf\.search/);
      assert.doesNotMatch(appended, /read only needed ranges through (?:capped )?`?ctx/);
      assert.match(appended, /Delegate discovery of unknown targets to Jaguar/);
      assert.match(appended, /native non-shell inspection tools/);
    } else if (["agents/jaguar.md", "agents/puma.md", "agents/strix-halo.md"].includes(relPath)) {
      assert.ok(!tools.includes("run_command"), `${relPath} must not have run_command`);
      assert.doesNotMatch(appended, /Locate with `?wf\.search/);
      assert.doesNotMatch(appended, /read only needed ranges through (?:capped )?`?ctx/);
      assert.match(appended, /Locate with native `grep_search`/);
      assert.match(appended, /`view_file` with explicit line ranges/);
    } else if (["agents/bobcat.md", "agents/zen.md"].includes(relPath)) {
      assert.ok(tools.includes("run_command"), `${relPath} must have run_command`);
      assert.match(appended, /Locate with `wf\.search`/);
      assert.match(appended, /capped `ctx` \(`tools\/ctx` or `wf\.ctx`\)/);
    }
  }
});

test("New-source reading budgets are preserved as guidance across roles and orchestration", () => {
  const expectedBudgets = {
    "agents/bulldozer.md": "2k",
    "agents/jaguar.md": "2k",
    "agents/puma.md": "8k",
    "agents/bobcat.md": "8k",
    "agents/strix-halo.md": "4k",
    "agents/zen.md": "8k",
  };

  for (const [relPath, budget] of Object.entries(expectedBudgets)) {
    const text = readFileSync(join(ROOT, relPath), "utf8");
    const appended = extractAppendedGuidance(text);
    const regex = new RegExp(`New-source reading budget: about ${budget} tokens as guidance \\(not a hard limit\\)`);
    assert.match(appended, regex, `${relPath} must preserve ${budget} reading budget`);
    assert.match(
      appended,
      /Exceeding budget means requesting\/inspecting a specific additional range with a reason, never skipping a required check\./
    );
  }

  const orchText = readFileSync(join(ROOT, "rules/orchestration.md"), "utf8");
  const orchAppended = extractAppendedGuidance(orchText);
  for (const [role, budget] of [
    ["Bulldozer", "2k"],
    ["Jaguar", "2k"],
    ["Puma", "8k"],
    ["Bobcat", "8k"],
    ["Strix Halo", "4k"],
    ["Zen", "8k"],
  ]) {
    const regex = new RegExp(`\\* ${role}: about ${budget} tokens`);
    assert.match(orchAppended, regex, `orchestration.md must list ${role} budget as ${budget}`);
  }
});

test("No-unchanged-re-read rule, compact handoff shape, and Zen unrestricted inspection remain", () => {
  for (const relPath of ALL_GUIDANCE_FILES) {
    const text = readFileSync(join(ROOT, relPath), "utf8");
    const appended = extractAppendedGuidance(text);

    assert.match(
      appended,
      /Do not re-read an unchanged \(path, range\) within the same role invocation unless citing a concrete evidence gap\./,
      `${relPath} must have no-unchanged-re-read rule`
    );
    assert.match(
      appended,
      /Hand off compact reports \(criterion-linked results, changed ranges, diff or artifact refs, check commands with exit codes and short summaries\) instead of pasting whole files, full logs or transcripts\./,
      `${relPath} must have compact handoff shape rule`
    );
  }

  // Zen unrestricted inspection in zen.md and orchestration.md
  for (const relPath of ["agents/zen.md", "rules/orchestration.md"]) {
    const text = readFileSync(join(ROOT, relPath), "utf8");
    const appended = extractAppendedGuidance(text);
    assert.match(
      appended,
      /Zen explicitly keeps unrestricted inspection and the requirement to check beyond the supplied diff; no role loses a required check or review\./,
      `${relPath} must preserve Zen unrestricted inspection rule`
    );
  }
});

test("rules/orchestration.md explicitly describes both tool paths and Bulldozer delegation", () => {
  const orchText = readFileSync(join(ROOT, "rules/orchestration.md"), "utf8");
  const appended = extractAppendedGuidance(orchText);

  assert.match(
    appended,
    /Roles with `run_command` \(Bobcat, Zen\) may locate with `wf\.search` and read only needed ranges through capped `ctx` \(`tools\/ctx` or `wf\.ctx`\)\./
  );
  assert.match(
    appended,
    /Roles without `run_command` \(Jaguar, Puma, Strix Halo\) use native `grep_search` and `view_file` with explicit line ranges \(no `wf\.search` or `tools\/ctx` or `wf\.ctx`\)\./
  );
  assert.match(
    appended,
    /Bulldozer has no shell authority and delegates discovery of unknown targets to Jaguar, inspecting only known execution context, named files, or produced artifacts using native non-shell tools/
  );
});

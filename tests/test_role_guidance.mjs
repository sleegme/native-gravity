import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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

// Base byte lengths and SHA-256 hashes computed from commit 2ff0083,
// except agents/zen.md and rules/orchestration.md recomputed after PR #169
// legitimately changed their base (Zen -> Claude Opus 5.5 High), and
// agents/zen.md recomputed again so Zen must run the guard-allowed named test
// files instead of avoiding "tests that may write".
// Bulldozer and orchestration baselines reflect the temporary Excavator
// disablement (#173) and its follow-up TEMPORARY headless path
// (scripts/excavator-agy.mjs, exact Argon High via run_command).
// #167 legitimately changed the Bulldozer base: the self-referential
// scripts/spine.mjs mention was removed to stop runner-inspection loops.
// Stage 1 of the subagent redesign (2026-11-08, §2.3/§2.6) legitimately
// changed the Bulldozer, Jaguar, Bobcat and orchestration bases: the
// thin-crew contract replaces Bulldozer's direct-inspection clause, Jaguar
// and Bobcat gain budget/coverage-table sections, and the packet/result
// field lists gained the code-built coverage fields.
const BASE_PREFIXES = {
  "agents/bulldozer.md": {
    length: 11367,
    sha256: "3cba2cf2f019f5870411f92b00f5f0f93083c854b5414bf6dd254b1861eaf056",
  },
  "agents/jaguar.md": {
    length: 4019,
    sha256: "3dd81b4c437a00071ee24c138ce46f0bb800f8d3c1cc7bd3fef99a5b779579fc",
  },
  "agents/puma.md": {
    length: 4097,
    sha256: "c909a903c8dcacf7851b7e1f626de80e957f9f4c00ffab90f5a74257f1b17345",
  },
  "agents/bobcat.md": {
    length: 5131,
    sha256: "2b965081fd40fac86df6e00775a8021bb66240a63d9aef1cd85bfbe425e06b9f",
  },
  "agents/strix-halo.md": {
    length: 4984,
    sha256: "42cd5172d1a201484814fa67ecf58399efc4f878ec55f92b34a3cdbc01b180e5",
  },
  "agents/zen.md": {
    length: 4790,
    sha256: "364c9002bd1e116e22392eb25627c5703b8cbb06d8302b769c19cae49765e772",
  },
  "rules/orchestration.md": {
    length: 19803,
    sha256: "3d8e5c509dd2c8872d6f3c19717379334cbe5b5ea09b743bf57983fcdb416667",
  },
};

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

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

test("Byte-prefix equality and appended heading hold for all 7 guidance files", () => {
  for (const [relPath, base] of Object.entries(BASE_PREFIXES)) {
    const fullPath = join(ROOT, relPath);
    const currentBuf = readFileSync(fullPath);

    assert.ok(
      currentBuf.length > base.length,
      `File ${relPath} must have appended guidance beyond base`
    );

    const prefixHash = sha256(currentBuf.subarray(0, base.length));
    assert.equal(
      prefixHash,
      base.sha256,
      `Prefix SHA-256 mismatch for ${relPath}`
    );

    const appended = currentBuf.subarray(base.length).toString("utf8");
    assert.match(
      appended,
      /^\n## Targeted reading and compact handoffs\n/,
      `Appended section in ${relPath} must begin with standard heading`
    );
  }
});

test("Tool authority: non-run_command roles omit wf and ctx tools from guidance", () => {
  for (const relPath of ROLE_FILES) {
    const { tools } = parseAgent(relPath);
    const fullPath = join(ROOT, relPath);
    const currentBuf = readFileSync(fullPath);
    const base = BASE_PREFIXES[relPath];
    const appended = currentBuf.subarray(base.length).toString("utf8");

    if (["agents/jaguar.md", "agents/puma.md", "agents/strix-halo.md"].includes(relPath)) {
      assert.ok(!tools.includes("run_command"), `${relPath} must not have run_command`);
      // Non-run_command roles must not mention wf.search, tools/ctx, or wf.ctx outside permitted negative notice
      const PROHIBITION = "(no `wf.search` or `tools/ctx` or `wf.ctx`)";
      const outsideNegativeNotice = appended.replace(PROHIBITION, "");
      assert.doesNotMatch(outsideNegativeNotice, /wf\.search/, `${relPath} must not mention wf.search`);
      assert.doesNotMatch(outsideNegativeNotice, /tools\/ctx/, `${relPath} must not mention tools/ctx`);
      assert.doesNotMatch(outsideNegativeNotice, /wf\.ctx/, `${relPath} must not mention wf.ctx`);
    } else if (relPath === "agents/bulldozer.md") {
      // TEMPORARY (#173 follow-up): Bulldozer carries run_command solely to
      // dispatch the headless Excavator script; remove together with that path.
      assert.ok(tools.includes("run_command"), `${relPath} must have run_command for the TEMPORARY headless excavator dispatch`);
      assert.match(readFileSync(fullPath, "utf8"), /scripts\/excavator-agy\.mjs/, `${relPath} must scope run_command to scripts/excavator-agy.mjs`);
      const PROHIBITION = "(no `wf.search` or `tools/ctx` or `wf.ctx`)";
      const outsideNegativeNotice = appended.replace(PROHIBITION, "");
      assert.doesNotMatch(outsideNegativeNotice, /wf\.search/, `${relPath} must not mention wf.search`);
      assert.doesNotMatch(outsideNegativeNotice, /tools\/ctx/, `${relPath} must not mention tools/ctx`);
      assert.doesNotMatch(outsideNegativeNotice, /wf\.ctx/, `${relPath} must not mention wf.ctx`);
    } else if (["agents/bobcat.md", "agents/zen.md"].includes(relPath)) {
      assert.ok(tools.includes("run_command"), `${relPath} must have run_command`);
    }
  }
});


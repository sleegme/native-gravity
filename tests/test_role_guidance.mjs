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

// NTG 2.0 re-baselined prefix lengths and SHA-256 hashes (m2 role update):
// Bulldozer receives general run_command access (Excavator retired); Strix Halo
// accepts Steamroller, Bulldozer, and Bobcat callers; Jaguar & Puma retain
// 3.8 Flash Low Lightweight Worker Harness boundaries; Bobcat targets Hydrogen
// Medium; Zen enforces NTG_ACTIVE_ROLE=zen across shell and file boundaries.
const BASE_PREFIXES = {
  "agents/bulldozer.md": {
    length: 4143,
    sha256: "092eecf22c21525f0976d3c191a4e68af6cba3ea105c9d7f8e710bf1dd94f55e",
  },
  "agents/jaguar.md": {
    length: 1404,
    sha256: "8b7a5178278915b40c50783ee3ab343c96f64127d9a46e35e6c526de804e976c",
  },
  "agents/puma.md": {
    length: 1486,
    sha256: "0ad177834a60f580c297d4d5d0848b9e3838dcfba3069693bd443172e81f92f9",
  },
  "agents/bobcat.md": {
    length: 2898,
    sha256: "4625cbd42a851137f4c646d5016ac2e4aef9b3239bdb815b9711d0098404c079",
  },
  "agents/strix-halo.md": {
    length: 2444,
    sha256: "9e60678abe862e187cd22ded49bd897d08892bd7ecf8e32ee4ca93a9ee8a1949",
  },
  "agents/zen.md": {
    length: 2384,
    sha256: "c5001f0081f2777bd5e5c0876bd523c321dfac1f6450eab065476115df983443",
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

test("Byte-prefix equality and appended heading hold for all 6 role guidance files", () => {
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

test("Tool authority: non-run_command roles omit wf and ctx tools; Bulldozer has general run_command without Excavator", () => {
  for (const relPath of ROLE_FILES) {
    const { tools, text } = parseAgent(relPath);
    const fullPath = join(ROOT, relPath);
    const currentBuf = readFileSync(fullPath);
    const base = BASE_PREFIXES[relPath];
    const appended = currentBuf.subarray(base.length).toString("utf8");

    if (["agents/jaguar.md", "agents/puma.md", "agents/strix-halo.md"].includes(relPath)) {
      assert.ok(!tools.includes("run_command"), `${relPath} must not have run_command`);
      const PROHIBITION = "(no `wf.search` or `tools/ctx` or `wf.ctx`)";
      const outsideNegativeNotice = appended.replace(PROHIBITION, "");
      assert.doesNotMatch(outsideNegativeNotice, /wf\.search/, `${relPath} must not mention wf.search`);
      assert.doesNotMatch(outsideNegativeNotice, /tools\/ctx/, `${relPath} must not mention tools/ctx`);
      assert.doesNotMatch(outsideNegativeNotice, /wf\.ctx/, `${relPath} must not mention wf.ctx`);
    } else if (["agents/bulldozer.md", "agents/bobcat.md", "agents/zen.md"].includes(relPath)) {
      assert.ok(tools.includes("run_command"), `${relPath} must have run_command`);
      if (relPath === "agents/bulldozer.md") {
        assert.doesNotMatch(text, /scripts\/excavator-agy\.mjs/, "Bulldozer must not reference retired excavator-agy.mjs");
        assert.match(text, /hooks\/shell-safety-guard\.py/, "Bulldozer must document universal shell-safety-guard.py");
      }
    }
  }
});

test("NTG 2.0 role contracts: Puma retained separately, Strix Halo multi-caller", () => {
  const puma = parseAgent("agents/puma.md");
  const strix = parseAgent("agents/strix-halo.md");
  assert.match(puma.body, /REROUTE_REQUIRED/);
  assert.match(puma.body, /3\.8 Flash Low/);
  assert.match(strix.body, /Steamroller.*Bulldozer.*Bobcat/i);
  assert.match(strix.body, /reviewed_diff_digest/);
  assert.match(strix.body, /acceptance_criteria_digest/);
});

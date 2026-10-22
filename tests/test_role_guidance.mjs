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
// legitimately changed their base (Zen -> Claude Opus 5.5 High).
const BASE_PREFIXES = {
  "agents/bulldozer.md": {
    length: 7336,
    sha256: "ee771398c62d21bbe934e1a9d7fda3b8fad105c40c4e3c43ca4efc1f36896830",
  },
  "agents/jaguar.md": {
    length: 3489,
    sha256: "0658e356b3f79af2c7bb20e5bfba0dc1570b710d83926374cefc2f66cc342823",
  },
  "agents/puma.md": {
    length: 4097,
    sha256: "c909a903c8dcacf7851b7e1f626de80e957f9f4c00ffab90f5a74257f1b17345",
  },
  "agents/bobcat.md": {
    length: 4178,
    sha256: "ad11fd48c8cb662c13a85b87bd40a13b2134d1df65247614d6bd96c06d7bccee",
  },
  "agents/strix-halo.md": {
    length: 4984,
    sha256: "42cd5172d1a201484814fa67ecf58399efc4f878ec55f92b34a3cdbc01b180e5",
  },
  "agents/zen.md": {
    length: 3309,
    sha256: "438298773502d3e03a8fcc76e54f3c8955d23637998f648b68eae541ec60ae33",
  },
  "rules/orchestration.md": {
    length: 17448,
    sha256: "aa9466114f34357a77e741f5f78c9dc7b22fb7e24c88f28a653d2f58befe0c81",
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

    if (["agents/bulldozer.md", "agents/jaguar.md", "agents/puma.md", "agents/strix-halo.md"].includes(relPath)) {
      assert.ok(!tools.includes("run_command"), `${relPath} must not have run_command`);
      // Non-run_command roles must not mention wf.search, tools/ctx, or wf.ctx outside permitted negative notice
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

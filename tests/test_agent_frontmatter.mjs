// Regression guard for agent frontmatter that AGY silently drops.
// An unquoted plain scalar containing ": " is invalid YAML; AGY then fails to
// register the agent and invoke_subagent reports "not found or not allowed".
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";

const AGENTS_DIR = new URL("../agents/", import.meta.url);
const agentFiles = readdirSync(AGENTS_DIR).filter(name => name.endsWith(".md"));

function frontmatterLines(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, "file must start with a --- delimited frontmatter block");
  return match[1].split("\n");
}

test("every active NTG 2.0 agent file is found and Excavator is completely retired", () => {
  assert.equal(existsSync(new URL("excavator.md", AGENTS_DIR)), false, "agents/excavator.md must be deleted in NTG 2.0");
  assert.deepEqual(
    agentFiles.slice().sort(),
    [
      "bobcat.md",
      "bulldozer.md",
      "instinct.md",
      "jaguar.md",
      "navi.md",
      "piledriver.md",
      "puma.md",
      "steamroller.md",
      "strix-halo.md",
      "zen.md",
    ]
  );
});

for (const file of agentFiles) {
  test(`${file}: top-level scalar values are valid plain YAML`, () => {
    const lines = frontmatterLines(readFileSync(new URL(file, AGENTS_DIR), "utf8"));
    for (const line of lines) {
      const top = line.match(/^([A-Za-z][\w-]*):\s+(.+)$/);
      if (!top) continue;
      const value = top[2];
      if (/^["'[{|>]/.test(value)) continue;
      assert.ok(!/:\s/.test(value),
        `${file} key "${top[1]}" has an unquoted value containing ": "; quote it or reword`);
      assert.ok(!/\s#/.test(value),
        `${file} key "${top[1]}" has an unquoted value containing " #" (read as a comment)`);
    }
  });

  test(`${file}: name matches the file name`, () => {
    const lines = frontmatterLines(readFileSync(new URL(file, AGENTS_DIR), "utf8"));
    const name = lines.map(l => l.match(/^name:\s+(.+)$/)).find(Boolean);
    assert.ok(name, `${file} has no name`);
    assert.equal(name[1].trim(), file.replace(/\.md$/, ""));
  });
}

test("piledriver and strix-halo frontmatter tool boundaries match NTG 2.0 spec", () => {
  const parseTools = (file) => {
    const text = readFileSync(new URL(file, AGENTS_DIR), "utf8");
    const fm = frontmatterLines(text).join("\n");
    const m = fm.match(/^tools:\n((?:  - .+\n)+)/m);
    assert.ok(m, `${file} must declare tools`);
    return m[1].trim().split("\n").map(l => l.trim().slice(2));
  };

  const piledriverTools = parseTools("piledriver.md");
  assert.ok(!piledriverTools.includes("invoke_subagent"), "piledriver must not have invoke_subagent");
  assert.ok(!piledriverTools.includes("run_command"), "piledriver must not have run_command");

  const strixTools = parseTools("strix-halo.md");
  for (const required of ["view_file", "grep_search", "list_dir", "find_by_name"]) {
    assert.ok(strixTools.includes(required), `strix-halo must include ${required}`);
  }
});

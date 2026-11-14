import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function agent(name) {
  const text = readFileSync(new URL(`../agents/${name}.md`, import.meta.url), "utf8");
  const [, frontmatter, body] = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  const tools = frontmatter.match(/^tools:\n((?:  - .+\n)+)/m)[1]
    .trim().split("\n").map(line => line.trim().slice(2));
  return { tools, body };
}

// Explicit task acceptance requires checking the hint's presence in shipped prompts.
for (const role of ["bobcat", "excavator"]) {
  test(`${role} ships the one-script hint and installed helper instructions`, () => {
    const { tools, body } = agent(role);
    assert.ok(tools.includes("run_command"));
    assert.match(body, /ONE python3 or shell script/);
    assert.match(body, /agy plugin list --json/);
    assert.match(body, /import wf/);
    assert.match(body, /wf\.ctx\(/);
    assert.match(body, /wf\.git_snap\(\)/);
  });
}

for (const [role, tools] of [
  ["jaguar", ["view_file", "list_dir", "find_by_name", "grep_search"]],
  ["puma", ["view_file", "list_dir", "find_by_name", "grep_search",
    "write_to_file", "replace_file_content"]],
]) {
  test(`${role} retains its exact non-shell tool boundary`, () => {
    const current = agent(role);
    assert.deepEqual(current.tools, tools);
    assert.doesNotMatch(current.body, /import wf|ONE python3 or shell script/);
  });
}

test("npm distribution includes exactly the three helper sources", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)));
  assert.deepEqual(pkg.files.filter(path => path.startsWith("tools/")),
    ["tools/ctx", "tools/git-snap", "tools/wf.py"]);
});

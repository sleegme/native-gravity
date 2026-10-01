import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

const NTG_RUN = new URL("../scripts/ntg-run.mjs", import.meta.url).pathname;

function fakeAgy() {
  const dir = mkdtempSync(join(tmpdir(), "ntg-run-"));
  const path = join(dir, "agy");
  // Print each arg NUL-separated so embedded newlines survive
  writeFileSync(path, '#!/bin/sh\nfor a in "$@"; do printf "%s\\0" "$a"; done\n');
  chmodSync(path, 0o755);
  return { path, dir };
}

function run(args) {
  const { path, dir } = fakeAgy();
  try {
    const buf = execFileSync("node", [NTG_RUN, ...args], {
      env: { ...process.env, AGY_PATH: path },
    });
    return buf.toString().split("\0").filter((s) => s.length > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("gated role bulldozer gets NTG_ROLE marker injected", () => {
  const argv = run(["--agent", "bulldozer", "-p", "do the thing"]);
  const prompt = argv[argv.indexOf("-p") + 1];
  assert.equal(prompt, "NTG_ROLE: bulldozer\ndo the thing");
});

test("gated role piledriver gets NTG_ROLE marker injected", () => {
  const argv = run(["--agent", "piledriver", "-p", "plan it"]);
  const prompt = argv[argv.indexOf("-p") + 1];
  assert.equal(prompt, "NTG_ROLE: piledriver\nplan it");
});

test("non-gated role passes through without marker", () => {
  const argv = run(["--agent", "zen", "-p", "review it"]);
  assert.deepEqual(argv, ["--agent", "zen", "-p", "review it"]);
});

test("pre-marked prompt is not double-injected", () => {
  const argv = run(["--agent", "bulldozer", "-p", "NTG_ROLE: bulldozer\nexisting"]);
  const prompt = argv[argv.indexOf("-p") + 1];
  assert.equal(prompt.match(/^NTG_ROLE:/gm)?.length, 1);
});

test("no agent flag means no marker", () => {
  const argv = run(["-p", "just a prompt"]);
  assert.deepEqual(argv, ["-p", "just a prompt"]);
});

test("args after -- pass through to agy verbatim", () => {
  const argv = run(["--agent", "bulldozer", "-p", "go", "--", "--extra", "value"]);
  assert.deepEqual(argv.slice(-2), ["--extra", "value"]);
});

test("--print= inline form gets marker after the flag", () => {
  const argv = run(["--agent", "bulldozer", "--print=inline prompt here"]);
  const inline = argv.find((a) => a.startsWith("--print="));
  assert.ok(inline);
  assert.equal(inline, "--print=NTG_ROLE: bulldozer\ninline prompt here");
});

test("-p= bundled short-flag form is left alone (collision guard)", () => {
  const argv = run(["--agent", "bulldozer", "-p=odd form"]);
  assert.deepEqual(argv, ["--agent", "bulldozer", "-p=odd form"]);
});

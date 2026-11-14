import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { once } from "node:events";
import { createInterface } from "node:readline";
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

for (const termination of ["normal", "SIGINT", "SIGTERM"]) {
  test(`shared ledger refuses a second ntg-run and releases on ${termination}`, { timeout: 5000 }, async t => {
    const dir = mkdtempSync(join(tmpdir(), "ntg-run-lock-"));
    const agy = join(dir, "agy");
    const ledger = join(dir, "ledger.json");
    writeFileSync(ledger, '{"untouched":true}\n');
    writeFileSync(agy, `#!${process.execPath}
process.stdin.resume();
process.stdin.on("end", () => process.exit(0));
console.log(JSON.stringify(process.argv.slice(2)));
`);
    chmodSync(agy, 0o755);
    const env = { ...process.env, AGY_PATH: agy };
    const args = [NTG_RUN, "--ledger", ledger, "--agent", "bulldozer", "-p", "go"];
    const first = spawn(process.execPath, args, { env });
    const exited = once(first, "close");
    const lines = createInterface({ input: first.stdout });
    const ready = once(lines, "line");
    t.after(async () => {
      if (first.exitCode === null && first.signalCode === null) first.kill("SIGKILL");
      await exited;
      lines.close();
      rmSync(dir, { recursive: true, force: true });
    });
    const [line] = await ready;
    assert.deepEqual(JSON.parse(line), ["--agent", "bulldozer", "-p", "NTG_ROLE: bulldozer\ngo"]);
    assert.equal(readFileSync(`${ledger}.lock`, "utf8"), `${first.pid}\n`);
    const second = spawnSync(process.execPath, args, { env, encoding: "utf8" });
    assert.equal(second.status, 1);
    assert.match(second.stderr, /LEDGER_LOCKED/);
    assert.equal(second.stdout, "");
    assert.equal(readFileSync(ledger, "utf8"), '{"untouched":true}\n');
    assert.equal(readFileSync(`${ledger}.lock`, "utf8"), `${first.pid}\n`);
    if (termination === "normal") first.stdin.end();
    else first.kill(termination);
    const [code] = await exited;
    assert.equal(code, termination === "normal" ? 0 : termination === "SIGINT" ? 130 : 143);
    assert.equal(existsSync(`${ledger}.lock`), false);
    // A fresh, ordinary invocation can immediately acquire the released ledger.
    const { path, dir: fakeDir } = fakeAgy();
    try {
      const next = spawnSync(process.execPath, args, {
        env: { ...env, AGY_PATH: path }, encoding: "utf8",
      });
      assert.equal(next.status, 0, next.stderr);
      assert.equal(existsSync(`${ledger}.lock`), false);
    } finally {
      rmSync(fakeDir, { recursive: true, force: true });
    }
  });
}

test("an existing stale or empty lock fails closed without removal", () => {
  const { path, dir } = fakeAgy();
  const ledger = join(dir, "ledger.json");
  try {
    for (const content of ["999999999\n", ""]) {
      writeFileSync(`${ledger}.lock`, content);
      const result = spawnSync(process.execPath, [NTG_RUN, `--ledger=${ledger}`, "-p", "go"], {
        env: { ...process.env, AGY_PATH: path }, encoding: "utf8",
      });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /LEDGER_LOCKED/);
      assert.equal(result.stdout, "");
      assert.equal(readFileSync(`${ledger}.lock`, "utf8"), content);
      assert.equal(existsSync(ledger), false);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

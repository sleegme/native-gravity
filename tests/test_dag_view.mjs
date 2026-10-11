import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "..", "scripts", "dag-view.mjs");
const FIXTURE = join(HERE, "fixtures", "dag-view", "all-states.ledger.json");

function run(args, opts = {}) {
  return spawnSync("node", [SCRIPT, ...args], { encoding: "utf8", ...opts });
}

test("A1: renders all-states fixture at width 80", () => {
  const r = run(["--ledger", FIXTURE, "--width", "80", "--no-color"]);
  assert.equal(r.status, 0, r.stderr);
  const out = r.stdout;
  assert.match(out, /NTG ledger · plan 2 · 2\/9 done · active: api · 1 blocker/);
  assert.match(out, /┌ schema.*DONE/);
  assert.match(out, /┌ cli.*STALE/);
  assert.match(out, /┌ api.*ACTIVE/);
  assert.match(out, /┌ auth.*BLOCKED/);
  assert.match(out, /┌ metrics.*READY/);
  assert.match(out, /blocker auth: OAuth sandbox credentials missing/);
});

test("A1: narrow width falls back to list layout", () => {
  const r = run(["--ledger", FIXTURE, "--width", "20", "--no-color"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /L0 DONE/);
  assert.match(r.stdout, /L1 STALE/);
  assert.match(r.stdout, /L2 ACTIVE/);
  assert.match(r.stdout, /L2 BLOCKED/);
  assert.match(r.stdout, /L3 PENDING/);
});

test("A2: bad graph — cycle exits 1", () => {
  const dir = mkdtempSync(join(tmpdir(), "ntg-dag-"));
  const bad = join(dir, "bad.ledger.json");
  writeFileSync(bad, JSON.stringify({
    plan_version: 1,
    milestones: [
      { id: "a", dependencies: ["b"] },
      { id: "b", dependencies: ["a"] }
    ],
    completed_milestones: [], current_milestone: null,
    verification: {}, blockers: [], next_action: null, goal: null
  }));
  const r = run(["--ledger", bad, "--no-color"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /cycle/);
  rmSync(dir, { recursive: true });
});

test("A2: bad graph — dangling dep exits 1", () => {
  const dir = mkdtempSync(join(tmpdir(), "ntg-dag-"));
  const bad = join(dir, "bad.ledger.json");
  writeFileSync(bad, JSON.stringify({
    plan_version: 1,
    milestones: [{ id: "a", dependencies: ["missing"] }],
    completed_milestones: [], current_milestone: null,
    verification: {}, blockers: [], next_action: null, goal: null
  }));
  const r = run(["--ledger", bad, "--no-color"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /dangling/);
  rmSync(dir, { recursive: true });
});

test("A2: missing file exits 1", () => {
  const r = run(["--ledger", "/nonexistent/ledger.json", "--no-color"]);
  assert.equal(r.status, 1);
});

test("A2: usage error exits 2", () => {
  const r = run(["--no-color"]);
  assert.equal(r.status, 2);
});

test("A2: read-only — fixture file unchanged after run", () => {
  const before = readFileSync(FIXTURE, "utf8");
  run(["--ledger", FIXTURE, "--width", "80", "--no-color"]);
  run(["--ledger", FIXTURE, "--width", "56", "--no-color"]);
  assert.equal(readFileSync(FIXTURE, "utf8"), before);
});

test("A2: NTG_LEDGER env var is honoured", () => {
  const r = run(["--width", "80", "--no-color"], { env: { ...process.env, NTG_LEDGER: FIXTURE } });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /NTG ledger/);
});

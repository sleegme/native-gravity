import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AuthoritativeLedger,
} from "../scripts/ledger.mjs";
import {
  ExcavatorHeadlessError,
  buildAgyArgs,
  classifyAgyFailure,
  composeExcavatorPrompt,
  extractWorkerResult,
  loadAssignment,
  main,
  parseCliArgs,
  parseStreamJson,
  runExcavatorHeadless,
  validatePacket,
} from "../scripts/excavator-agy.mjs";

// agy is stubbed everywhere in this file: spawn injection plus a frozen
// installed-models surface. No test reaches a real agy or spends Argon quota.

const ARGON_SURFACE = ["gemini-4-argon-high", "gemini-4-argon-medium"];
const PACKET = {
  milestone_id: "m-fix",
  objective: "repair the broken counter fixture",
  bounded_scope: ["counter.mjs"],
  non_goals: [],
  acceptance_criteria: ["node check.mjs exits 0"],
  constraints: [],
  decision_invariants: [],
};

function resultEvent(response, extra = {}) {
  return JSON.stringify({
    event: "result",
    result: { status: "SUCCESS", response, duration_seconds: 1.5, num_turns: 1, ...extra },
  });
}

const READY_TEXT = JSON.stringify({
  ROOT_CAUSE: "CONFIRMED off-by-one in counter increment",
  CHANGES: ["counter.mjs: increment before return"],
  VERIFICATION_EVIDENCE: ["node check.mjs exited 0"],
  ROLLBACK: "revert counter.mjs",
  RESIDUAL_RISK: "none observed",
  STATUS: "READY",
});

function okSpawn(stdout = resultEvent(READY_TEXT)) {
  return () => ({ status: 0, stdout, stderr: "" });
}

function workspace(t) {
  const dir = mkdtempSync(join(tmpdir(), "excavator-agy-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function readCalls(dir) {
  return readFileSync(join(dir, ".ntg", "excavator-agy-calls.jsonl"), "utf8")
    .trim().split("\n").map((line) => JSON.parse(line));
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

test("parseCliArgs accepts packet, blocker, timeout and path overrides", () => {
  const opts = parseCliArgs(["--packet", "p.json", "--blocker", "check exits 1", "--timeout", "90", "--agy", "/usr/bin/agy", "--cwd", "/tmp/w", "--ledger", "l.json"]);
  assert.equal(opts.packet, "p.json");
  assert.equal(opts.blocker, "check exits 1");
  assert.equal(opts.timeoutSeconds, 90);
  assert.equal(opts.agyPath, "/usr/bin/agy");
  assert.equal(opts.cwd, "/tmp/w");
  assert.equal(opts.ledger, "l.json");
});

test("parseCliArgs rejects missing blocker, missing packet source, both sources and bad timeouts", () => {
  assert.throws(() => parseCliArgs(["--packet", "p.json"]), /--blocker is required/);
  assert.throws(() => parseCliArgs(["--blocker", "b"]), /One of --packet or --milestone/);
  assert.throws(() => parseCliArgs(["--packet", "p.json", "--milestone", "m", "--blocker", "b"]), /mutually exclusive/);
  assert.throws(() => parseCliArgs(["--packet", "p.json", "--blocker", "b", "--timeout", "no"]), /positive number/);
  assert.throws(() => parseCliArgs(["--packet"]), /Unknown or incomplete/);
});

test("parseCliArgs timeout defaults honor NTG_EXCAVATOR_TIMEOUT_S", () => {
  const previous = process.env.NTG_EXCAVATOR_TIMEOUT_S;
  process.env.NTG_EXCAVATOR_TIMEOUT_S = "77";
  try {
    const opts = parseCliArgs(["--packet", "p.json", "--blocker", "b"]);
    assert.equal(opts.timeoutSeconds, 77);
    assert.throws(() => parseCliArgs(["--packet", "p.json", "--blocker", "b", "--timeout", "0"]), /positive number/);
  } finally {
    if (previous === undefined) delete process.env.NTG_EXCAVATOR_TIMEOUT_S;
    else process.env.NTG_EXCAVATOR_TIMEOUT_S = previous;
  }
});

// ---------------------------------------------------------------------------
// Packet validation and assignment loading
// ---------------------------------------------------------------------------

test("validatePacket requires milestone id, objective and acceptance criteria", () => {
  assert.equal(validatePacket(PACKET), null);
  assert.match(validatePacket({}), /milestone_id/);
  assert.match(validatePacket({ milestone_id: "m", objective: "o" }), /acceptance_criteria/);
  assert.match(validatePacket(null), /non-null JSON object/);
});

test("loadAssignment accepts a pre-parsed packet object and rejects invalid ones", () => {
  assert.deepEqual(loadAssignment({ packetObject: PACKET }), PACKET);
  assert.throws(() => loadAssignment({ packetObject: { milestone_id: "m" } }), ExcavatorHeadlessError);
});

test("loadAssignment reads a packet file and rejects missing or malformed files", (t) => {
  const dir = workspace(t);
  const path = join(dir, "packet.json");
  writeFileSync(path, JSON.stringify(PACKET));
  assert.deepEqual(loadAssignment({ packetPath: path }), PACKET);
  assert.throws(() => loadAssignment({ packetPath: join(dir, "nope.json") }), /cannot read packet file/);
  const bad = join(dir, "bad.json");
  writeFileSync(bad, "{not json");
  assert.throws(() => loadAssignment({ packetPath: bad }), /not valid JSON/);
});

test("loadAssignment reads the packet read-only from the authoritative ledger", (t) => {
  const dir = workspace(t);
  const ledgerPath = join(dir, "ledger.json");
  const plan = {
    goal: "g", constraints: ["stay in scope"],
    decision_invariants: [{ id: "INV-1", statement: "Do not weaken acceptance" }],
    plan_version: "v3",
    milestones: [{
      id: "m-fix", title: "fix", objective: "repair the fixture", bounded_scope: ["counter.mjs"],
      non_goals: ["rewrite"], acceptance_criteria: ["node check.mjs exits 0"], dependencies: [],
    }],
  };
  new AuthoritativeLedger(plan).save(ledgerPath);
  const packet = loadAssignment({ ledgerPath, milestoneId: "m-fix" });
  assert.equal(packet.milestone_id, "m-fix");
  assert.equal(packet.plan_version, "v3");
  assert.deepEqual(packet.constraints, ["stay in scope"]);
  assert.deepEqual(packet.decision_invariants, [{ id: "INV-1", statement: "Do not weaken acceptance" }]);
  assert.deepEqual(packet.relevant_evidence, []);
  assert.deepEqual(packet.acceptance_criteria, ["node check.mjs exits 0"]);
  assert.throws(() => loadAssignment({ ledgerPath, milestoneId: "nope" }), /MILESTONE_NOT_FOUND|not found/);
  assert.throws(() => loadAssignment({ ledgerPath: join(dir, "missing.json"), milestoneId: "m-fix" }), /LEDGER_UNREADABLE|cannot read ledger/);
});

// ---------------------------------------------------------------------------
// Prompt and argument construction
// ---------------------------------------------------------------------------

test("composeExcavatorPrompt carries the contract, blocker, packet, slug and output format", () => {
  const roleBody = "# Excavator body marker";
  const prompt = composeExcavatorPrompt({ roleBody, packet: PACKET, blocker: "check.mjs exits 1: got 4", slug: "gemini-4-argon-high", workspace: "/ws" });
  assert.match(prompt, /^# Excavator body marker/);
  assert.match(prompt, /TEMPORARY headless Excavator path/);
  assert.match(prompt, /gemini-4-argon-high/);
  assert.match(prompt, /check\.mjs exits 1: got 4/);
  assert.match(prompt, /"milestone_id": "m-fix"/);
  assert.match(prompt, /first byte of\s+your response must be/);
  assert.match(prompt, /ROOT_CAUSE/);
});

test("buildAgyArgs pins stream-json, print-timeout, skip-permissions and -p last", () => {
  const args = buildAgyArgs({ slug: "gemini-4-argon-high", prompt: "PROMPT", printTimeoutSeconds: 570 });
  assert.deepEqual(args, [
    "--model", "gemini-4-argon-high",
    "--output-format", "stream-json",
    "--print-timeout", "570s",
    "--dangerously-skip-permissions",
    "-p", "PROMPT",
  ]);
});

// ---------------------------------------------------------------------------
// stream-json parsing and worker-result extraction
// ---------------------------------------------------------------------------

test("parseStreamJson prefers the final result event and tolerates junk lines", () => {
  const stdout = [
    "not json at all",
    JSON.stringify({ event: "init" }),
    JSON.stringify({ event: "step_update", step_update: { step_index: 1, step_type: "agent_response", text_delta: "{\"STATUS\":" } }),
    JSON.stringify({ event: "step_update", step_update: { step_index: 1, step_type: "agent_response", text_delta: "\"READY\"}" } }),
    resultEvent(READY_TEXT, { usage: { input_tokens: 9, output_tokens: 4, total_tokens: 13 } }),
  ].join("\n");
  const parsed = parseStreamJson(stdout);
  assert.equal(parsed.malformed, 1);
  assert.equal(parsed.resultEvent.status, "SUCCESS");
  assert.equal(parsed.resultEvent.response, READY_TEXT);
  assert.deepEqual(parsed.resultEvent.usage, { input_tokens: 9, output_tokens: 4, total_tokens: 13 });
  assert.equal(parsed.lastAgentText, "{\"STATUS\":\"READY\"}");
});

test("parseStreamJson returns no result event for an empty or event-free stream", () => {
  assert.equal(parseStreamJson("").resultEvent, null);
  assert.equal(parseStreamJson("garbage\n\ngarbage").resultEvent, null);
  assert.equal(parseStreamJson("garbage\n\ngarbage").malformed, 2);
});

test("extractWorkerResult accepts bare, fenced and prose-wrapped worker JSON", () => {
  const result = JSON.parse(READY_TEXT);
  assert.deepEqual(extractWorkerResult(READY_TEXT).result, result);
  assert.deepEqual(extractWorkerResult(`\`\`\`json\n${READY_TEXT}\n\`\`\``).result, result);
  assert.deepEqual(extractWorkerResult(`Here is the result.\n${READY_TEXT}\ndone.`).result, result);
  assert.equal(extractWorkerResult(READY_TEXT.replace('"READY"', '"BLOCKED"')).ok, true);
});

test("extractWorkerResult fails typed on garbage, empty and contract-invalid results", () => {
  assert.equal(extractWorkerResult("").error, "UNPARSEABLE_OUTPUT");
  assert.equal(extractWorkerResult("the repair is done, trust me").error, "UNPARSEABLE_OUTPUT");
  assert.equal(extractWorkerResult('{"STATUS":"MAYBE"}').error, "INVALID_WORKER_RESULT");
  assert.equal(extractWorkerResult('{"STATUS":"READY","ROOT_CAUSE":"unlabeled"}').error, "INVALID_WORKER_RESULT");
  assert.equal(extractWorkerResult('{"STATUS":"BLOCKED","ROOT_CAUSE":"CONFIRMED cannot proceed"}').ok, true);
});

// ---------------------------------------------------------------------------
// Failure classification (agy missing / 429 / timeout / non-zero exit)
// ---------------------------------------------------------------------------

test("classifyAgyFailure maps ENOENT, ETIMEDOUT, rate limits and plain non-zero exits", () => {
  assert.equal(classifyAgyFailure({ spawnError: { code: "ENOENT", message: "x" }, status: null }).error, "AGY_MISSING");
  assert.equal(classifyAgyFailure({ spawnError: { code: "ETIMEDOUT" }, status: null }).error, "TIMEOUT");
  for (const stderr of ["HTTP 429 too many requests", "quota exceeded for model", "RESOURCE_EXHAUSTED", "rate limit reached"]) {
    assert.equal(classifyAgyFailure({ spawnError: null, status: 1, stderr, stdout: "" }).error, "RATE_LIMITED", stderr);
  }
  const plain = classifyAgyFailure({ spawnError: null, status: 3, stderr: "boom", stdout: "" });
  assert.equal(plain.error, "AGY_EXIT_NONZERO");
  assert.match(plain.message, /exited 3: boom/);
  assert.equal(classifyAgyFailure({ spawnError: null, status: 0, stderr: "", stdout: "" }), null);
  assert.equal(classifyAgyFailure({ spawnError: { code: "EACCES", message: "nope" }, status: null }).error, "SPAWN_ERROR");
});

// ---------------------------------------------------------------------------
// runExcavatorHeadless with agy stubbed
// ---------------------------------------------------------------------------

test("runExcavatorHeadless resolves the Argon slug and returns the worker result", (t) => {
  const dir = workspace(t);
  const calls = [];
  let clock = 1_000;
  const out = runExcavatorHeadless(
    { assignment: { packetObject: PACKET }, blocker: "check exits 1", cwd: dir, installedModels: ARGON_SURFACE, timeoutSeconds: 120 },
    {
      spawn: (cmd, args, opts) => {
        calls.push({ cmd, args, opts });
        return { status: 0, stdout: resultEvent(READY_TEXT, { usage: { input_tokens: 9, output_tokens: 4, total_tokens: 13 } }), stderr: "" };
      },
      now: () => clock,
      env: {},
    },
  );
  clock += 5_000;
  assert.equal(out.ok, true);
  assert.equal(out.slug, "gemini-4-argon-high");
  assert.equal(out.worker_status, "READY");
  assert.equal(out.result.STATUS, "READY");
  assert.deepEqual(out.usage, { input_tokens: 9, output_tokens: 4, total_tokens: 13 });

  const invocation = calls[0];
  assert.equal(invocation.cmd, "agy");
  assert.deepEqual(invocation.args, [
    "--model", "gemini-4-argon-high",
    "--output-format", "stream-json",
    "--print-timeout", "90s",
    "--dangerously-skip-permissions",
    "-p", invocation.args.at(-1),
  ]);
  assert.ok(invocation.args.at(-1).includes("# Excavator"));
  assert.ok(invocation.args.at(-1).includes("check exits 1"));
  assert.equal(invocation.opts.timeout, 120000);
  assert.equal(invocation.opts.cwd, dir);
  assert.equal(invocation.opts.env.NTG_RUNNER_CHAIN, "excavator");

  const records = readCalls(dir);
  assert.equal(records.length, 1);
  assert.equal(records[0].ok, true);
  assert.equal(records[0].model, "gemini-4-argon-high");
  assert.equal(records[0].exit_status, 0);
  assert.equal(records[0].worker_status, "READY");
  assert.equal(records[0].milestone_id, "m-fix");
  assert.ok(records[0].started_at < records[0].ended_at || records[0].started_at === records[0].ended_at);
});

test("runExcavatorHeadless treats a BLOCKED worker result as a successful call", (t) => {
  const dir = workspace(t);
  const blocked = JSON.stringify({ ROOT_CAUSE: "CONFIRMED needs unavailable capability", CHANGES: [], VERIFICATION_EVIDENCE: [], ROLLBACK: "none", RESIDUAL_RISK: "none", STATUS: "BLOCKED" });
  const out = runExcavatorHeadless(
    { assignment: { packetObject: PACKET }, blocker: "b", cwd: dir, installedModels: ARGON_SURFACE },
    { spawn: () => ({ status: 0, stdout: resultEvent(blocked), stderr: "" }), env: {} },
  );
  assert.equal(out.ok, true);
  assert.equal(out.worker_status, "BLOCKED");
  assert.equal(readCalls(dir)[0].worker_status, "BLOCKED");
});

for (const [name, spawnStub, expectedError] of [
  ["agy missing (ENOENT)", () => ({ error: { code: "ENOENT", message: "spawn agy ENOENT" }, status: null, stdout: "", stderr: "" }), "AGY_MISSING"],
  ["Argon quota exhausted (429)", () => ({ status: 1, stdout: "", stderr: "HTTP 429 quota exceeded" }), "RATE_LIMITED"],
  ["outer timeout (ETIMEDOUT)", () => ({ error: { code: "ETIMEDOUT" }, status: null, stdout: "", stderr: "" }), "TIMEOUT"],
  ["unparseable output", () => ({ status: 0, stdout: " celebration, no events", stderr: "" }), "UNPARSEABLE_OUTPUT"],
  ["agy result status not SUCCESS", () => ({ status: 0, stdout: JSON.stringify({ event: "result", result: { status: "ERROR", response: READY_TEXT } }), stderr: "" }), "AGY_NON_SUCCESS"],
  ["invalid worker result shape", () => ({ status: 0, stdout: resultEvent('{"STATUS":"READY"}'), stderr: "" }), "INVALID_WORKER_RESULT"],
  ["plain non-zero exit", () => ({ status: 7, stdout: "", stderr: "agy exploded" }), "AGY_EXIT_NONZERO"],
]) {
  test(`runExcavatorHeadless fails typed on ${name} and records the error`, (t) => {
    const dir = workspace(t);
    const out = runExcavatorHeadless(
      { assignment: { packetObject: PACKET }, blocker: "b", cwd: dir, installedModels: ARGON_SURFACE },
      { spawn: spawnStub, env: {} },
    );
    assert.equal(out.ok, false);
    assert.equal(out.error, expectedError);
    assert.ok(out.message);
    const records = readCalls(dir);
    assert.equal(records.length, 1);
    assert.equal(records[0].ok, false);
    assert.equal(records[0].error, expectedError);
    assert.equal(records[0].model, "gemini-4-argon-high");
  });
}

test("runExcavatorHeadless never spawns when the slug cannot resolve", (t) => {
  const dir = workspace(t);
  const out = runExcavatorHeadless(
    { assignment: { packetObject: PACKET }, blocker: "b", cwd: dir, installedModels: ["gemini-3.8-flash-high"] },
    { spawn: () => { throw new Error("must not spawn"); }, env: {} },
  );
  assert.equal(out.ok, false);
  assert.equal(out.error, "UNRESOLVED_MODEL_SLUG");
  assert.equal(out.reason, "NOT_FOUND");
  assert.equal(readCalls(dir)[0].error, "UNRESOLVED_MODEL_SLUG");
});

test("runExcavatorHeadless refuses recursion when excavator is already on the chain", (t) => {
  const dir = workspace(t);
  const out = runExcavatorHeadless(
    { assignment: { packetObject: PACKET }, blocker: "b", cwd: dir, installedModels: ARGON_SURFACE },
    { spawn: () => { throw new Error("must not spawn"); }, env: { NTG_RUNNER_CHAIN: "bulldozer:excavator" } },
  );
  assert.equal(out.ok, false);
  assert.equal(out.error, "RECURSION_DETECTED");
});

test("runExcavatorHeadless extends an existing runner chain for the child", (t) => {
  const dir = workspace(t);
  let seenChain;
  runExcavatorHeadless(
    { assignment: { packetObject: PACKET }, blocker: "b", cwd: dir, installedModels: ARGON_SURFACE },
    {
      spawn: (cmd, args, opts) => { seenChain = opts.env.NTG_RUNNER_CHAIN; return { status: 0, stdout: resultEvent(READY_TEXT), stderr: "" }; },
      env: { NTG_RUNNER_CHAIN: "bulldozer" },
    },
  );
  assert.equal(seenChain, "bulldozer:excavator");
});

test("runExcavatorHeadless reads the packet from a ledger end to end", (t) => {
  const dir = workspace(t);
  const ledgerPath = join(dir, "ledger.json");
  new AuthoritativeLedger({
    goal: "g", constraints: [], decision_invariants: [], plan_version: "v1",
    milestones: [{ id: "m-fix", title: "t", objective: "repair fixture", bounded_scope: ["counter.mjs"], non_goals: [], acceptance_criteria: ["check passes"], dependencies: [] }],
  }).save(ledgerPath);
  let seenPrompt;
  const out = runExcavatorHeadless(
    { assignment: { ledgerPath, milestoneId: "m-fix" }, blocker: "check fails", cwd: dir, installedModels: ARGON_SURFACE },
    {
      spawn: (cmd, args) => { seenPrompt = args.at(-1); return { status: 0, stdout: resultEvent(READY_TEXT), stderr: "" }; },
      env: {},
    },
  );
  assert.equal(out.ok, true);
  assert.equal(out.milestone_id, "m-fix");
  assert.match(seenPrompt, /"milestone_id": "m-fix"/);
  assert.match(seenPrompt, /repair fixture/);
});

// ---------------------------------------------------------------------------
// CLI main
// ---------------------------------------------------------------------------

test("main exits 0 with the worker result for a successful headless call", async (t) => {
  const dir = workspace(t);
  const out = main(["--packet", "-", "--blocker", "check exits 1", "--cwd", dir, "--timeout", "60"], {
    spawn: () => ({ status: 0, stdout: resultEvent(READY_TEXT), stderr: "" }),
    installedModels: ARGON_SURFACE,
    readStdin: () => JSON.stringify(PACKET),
    env: {},
  });
  assert.equal(out.exitCode, 0);
  assert.equal(out.ok, true);
  assert.equal(out.result.STATUS, "READY");
  assert.equal(readCalls(dir).length, 1);
});

test("main exits 1 with a typed error when agy is rate limited", async (t) => {
  const dir = workspace(t);
  const out = main(["--packet", "-", "--blocker", "b", "--cwd", dir], {
    spawn: () => ({ status: 1, stdout: "", stderr: "429 rate limit exceeded" }),
    installedModels: ARGON_SURFACE,
    readStdin: () => JSON.stringify(PACKET),
    env: {},
  });
  assert.equal(out.exitCode, 1);
  assert.equal(out.error, "RATE_LIMITED");
  assert.equal(readCalls(dir)[0].error, "RATE_LIMITED");
});

test("main requires a ledger for --milestone (argument or supervisor env)", async (t) => {
  const dir = workspace(t);
  const out = main(["--milestone", "m-fix", "--blocker", "b", "--cwd", dir], {
    spawn: () => { throw new Error("must not spawn"); },
    env: {},
  });
  assert.equal(out.exitCode, 1);
  assert.equal(out.error, "INVALID_ARGS");
  assert.match(out.message, /NTG_SUPERVISOR_LEDGER/);
});

test("main resolves the ledger from NTG_SUPERVISOR_LEDGER for --milestone", async (t) => {
  const dir = workspace(t);
  const ledgerPath = join(dir, "ledger.json");
  new AuthoritativeLedger({
    goal: "g", constraints: [], decision_invariants: [], plan_version: "v1",
    milestones: [{ id: "m-fix", title: "t", objective: "repair fixture", bounded_scope: [], non_goals: [], acceptance_criteria: ["check passes"], dependencies: [] }],
  }).save(ledgerPath);
  const out = main(["--milestone", "m-fix", "--blocker", "b", "--cwd", dir], {
    spawn: () => ({ status: 0, stdout: resultEvent(READY_TEXT), stderr: "" }),
    installedModels: ARGON_SURFACE,
    env: { NTG_SUPERVISOR_LEDGER: ledgerPath },
  });
  assert.equal(out.exitCode, 0);
  assert.equal(out.milestone_id, "m-fix");
});

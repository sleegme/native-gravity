import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync, readFileSync, chmodSync, unlinkSync, mkdtempSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import {
  ROLE_POLICY_TABLE,
  ROLE_MODEL_TABLE,
  UnresolvedModelSlugError,
  InvalidHandoffPacketError,
  parseInstalledModels,
  listInstalledModels,
  matchesPolicy,
  resolveSlug,
  composeBoundedPrompt,
  parseResponseEnvelope,
  invokeTransport,
  invoke,
} from "../scripts/runner.mjs";

console.log("=== Native Gravity 44B Exact-Model Runner Spike Tests ===");

let passed = 0;
let failed = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`[PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`[FAIL] ${name}`);
    console.error(`       ${err.message}`);
    failed++;
  }
}

// =============================================================================
// Section 1: Exact Slug Resolution & Runtime Discovery (Blocker 1)
// =============================================================================

runTest("1.1: Unknown role throws UnresolvedModelSlugError (no silent fallback)", () => {
  let caughtSlugErr = null;
  try {
    resolveSlug("nonexistent-role");
  } catch (err) {
    caughtSlugErr = err;
  }
  assert.ok(caughtSlugErr instanceof UnresolvedModelSlugError, "Expected UnresolvedModelSlugError");
  assert.strictEqual(caughtSlugErr.ok, false);
  assert.strictEqual(caughtSlugErr.error, "UNRESOLVED_MODEL_SLUG");
  assert.strictEqual(caughtSlugErr.role, "nonexistent-role");

  // invoke() returns structured error packet
  const res = invoke("nonexistent-role", { task: "Test prompt" });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.error, "UNRESOLVED_MODEL_SLUG");
  assert.strictEqual(res.role, "nonexistent-role");
});

runTest("1.2: Absent surface error (0 matches) throws UnresolvedModelSlugError without silent fallback", () => {
  let caughtErr = null;
  try {
    resolveSlug("piledriver", {
      installedModels: [
        { slug: "gemini-3.8-flash-high", description: "Gemini 3.8 Flash (High)" },
        { slug: "gemini-3.1-pro-low", description: "Gemini 3.1 Pro (Low)" },
      ],
    });
  } catch (err) {
    caughtErr = err;
  }
  assert.ok(caughtErr instanceof UnresolvedModelSlugError);
  assert.strictEqual(caughtErr.ok, false);
  assert.strictEqual(caughtErr.error, "UNRESOLVED_MODEL_SLUG");
  assert.strictEqual(caughtErr.role, "piledriver");
  assert.strictEqual(caughtErr.reason, "NOT_FOUND");
  assert.ok(caughtErr.message.includes("No installed model found matching policy"));

  // invoke() returns structured error
  const invokeRes = invoke("piledriver", { task: "Do work" }, { installedModels: [] });
  assert.strictEqual(invokeRes.ok, false);
  assert.strictEqual(invokeRes.error, "UNRESOLVED_MODEL_SLUG");
});

runTest("1.3: Ambiguous surface error (multiple matches) throws UnresolvedModelSlugError with candidate details", () => {
  let caughtErr = null;
  const ambiguousSurface = [
    { slug: "gemini-3.1-pro-high-v1", description: "Gemini 3.1 Pro (High) v1" },
    { slug: "gemini-3.1-pro-high-v2", description: "Gemini 3.1 Pro (High) v2" },
  ];
  try {
    resolveSlug("piledriver", { installedModels: ambiguousSurface });
  } catch (err) {
    caughtErr = err;
  }
  assert.ok(caughtErr instanceof UnresolvedModelSlugError);
  assert.strictEqual(caughtErr.ok, false);
  assert.strictEqual(caughtErr.error, "UNRESOLVED_MODEL_SLUG");
  assert.strictEqual(caughtErr.reason, "AMBIGUOUS");
  assert.deepStrictEqual(caughtErr.matches, ["gemini-3.1-pro-high-v1", "gemini-3.1-pro-high-v2"]);
  assert.ok(caughtErr.message.includes("Ambiguous model slug resolution"));
});

runTest("1.4: Deterministic resolution against cached installed models for all roles", () => {
  const mockSurface = [
    { slug: "gemini-3.1-pro-high", description: "Gemini 3.1 Pro (High)" },
    { slug: "gemini-3.8-flash-high", description: "Gemini 3.8 Flash (High)" },
    { slug: "claude-sonnet-4-6", description: "Claude Sonnet 4.6 (Thinking)" },
  ];

  const piledriverSlug = resolveSlug("piledriver", { installedModels: mockSurface });
  assert.strictEqual(piledriverSlug, "gemini-3.1-pro-high");

  // Case-insensitive
  const piledriverUpper = resolveSlug("PileDriver", { installedModels: mockSurface });
  assert.strictEqual(piledriverUpper, "gemini-3.1-pro-high");

  const bulldozerSlug = resolveSlug("bulldozer", { installedModels: mockSurface });
  assert.strictEqual(bulldozerSlug, "gemini-3.8-flash-high");

  const steamrollerSlug = resolveSlug("steamroller", { installedModels: mockSurface });
  assert.strictEqual(steamrollerSlug, "gemini-3.8-flash-high");

  // Verify ROLE_POLICY_TABLE definitions
  assert.strictEqual(ROLE_POLICY_TABLE.piledriver.family, "Gemini 3.1 Pro");
  assert.strictEqual(ROLE_POLICY_TABLE.piledriver.effort, "High");
  assert.strictEqual(ROLE_POLICY_TABLE.bulldozer.family, "Gemini 3.8 Flash");
  assert.strictEqual(ROLE_POLICY_TABLE.bulldozer.effort, "High");
  assert.strictEqual(ROLE_POLICY_TABLE.steamroller.family, "Gemini 3.8 Flash");
  assert.strictEqual(ROLE_POLICY_TABLE.steamroller.effort, "High");

  // Hard-coded mapping removed from ROLE_MODEL_TABLE
  assert.deepStrictEqual(Object.keys(ROLE_MODEL_TABLE), []);
});

runTest("1.5: parseInstalledModels correctly parses agy models stdout table", () => {
  const sampleStdout = `
Fetching available models...
gemini-3.8-flash-high\tGemini 3.8 Flash (High)
gemini-3.8-flash-low\tGemini 3.8 Flash (Low)
gemini-3.1-pro-high\tGemini 3.1 Pro (High)
claude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)
`;
  const parsed = parseInstalledModels(sampleStdout);
  assert.strictEqual(parsed.length, 4);
  assert.strictEqual(parsed[0].slug, "gemini-3.8-flash-high");
  assert.strictEqual(parsed[0].description, "Gemini 3.8 Flash (High)");
  assert.strictEqual(parsed[2].slug, "gemini-3.1-pro-high");
  assert.strictEqual(parsed[2].description, "Gemini 3.1 Pro (High)");
});

runTest("1.6: Live installed surface resolution against system agy models", () => {
  const models = listInstalledModels();
  assert.ok(Array.isArray(models), "Expected models to be an array");
  assert.ok(models.length > 0, "Expected at least one installed model");

  // Verify piledriver resolves live to gemini-3.1-pro-high
  const pSlug = resolveSlug("piledriver");
  assert.strictEqual(pSlug, "gemini-3.1-pro-high");

  // Verify bulldozer resolves live to gemini-3.8-flash-high
  const bSlug = resolveSlug("bulldozer");
  assert.strictEqual(bSlug, "gemini-3.8-flash-high");
});

// =============================================================================
// Section 2: Response Envelope Validation (Blocker 2)
// =============================================================================

runTest("2.1: Unparseable JSON response returns INVALID_OUTPUT failure", () => {
  const res = parseResponseEnvelope("Not valid json {{{", { role: "bulldozer", slug: "gemini-3.8-flash-high" });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.error, "INVALID_OUTPUT");
  assert.strictEqual(res.role, "bulldozer");
  assert.strictEqual(res.slug, "gemini-3.8-flash-high");
  assert.ok(res.message.includes("Failed to parse JSON response"));
});

runTest("2.2: Non-object JSON response returns INVALID_OUTPUT failure", () => {
  for (const raw of ["null", "12345", "true", "[\"array\"]", "\"string\""]) {
    const res = parseResponseEnvelope(raw, { role: "piledriver", slug: "gemini-3.1-pro-high" });
    assert.strictEqual(res.ok, false, `Expected ${raw} to fail`);
    assert.strictEqual(res.error, "INVALID_OUTPUT");
    assert.strictEqual(res.message, "JSON response is not a valid object envelope");
  }
});

runTest("2.3: status === 'ERROR' returns MODEL_ERROR failure", () => {
  const errorJson = JSON.stringify({
    status: "ERROR",
    message: "Rate limit exceeded or quota exhausted",
    error_code: 429,
  });
  const res = parseResponseEnvelope(errorJson, { role: "piledriver", slug: "gemini-3.1-pro-high" });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.error, "MODEL_ERROR");
  assert.strictEqual(res.role, "piledriver");
  assert.strictEqual(res.slug, "gemini-3.1-pro-high");
  assert.strictEqual(res.details.status, "ERROR");
  assert.strictEqual(res.details.error_code, 429);
});

runTest("2.4: status === 'SUCCESS' with missing or invalid response returns INVALID_OUTPUT", () => {
  // Missing response field
  const missingRes = parseResponseEnvelope(JSON.stringify({ status: "SUCCESS" }), { role: "bulldozer" });
  assert.strictEqual(missingRes.ok, false);
  assert.strictEqual(missingRes.error, "INVALID_OUTPUT");
  assert.ok(missingRes.message.includes("Missing or invalid 'response' field"));

  // Non-string response field
  const nonStringRes = parseResponseEnvelope(JSON.stringify({ status: "SUCCESS", response: { nested: true } }), { role: "bulldozer" });
  assert.strictEqual(nonStringRes.ok, false);
  assert.strictEqual(nonStringRes.error, "INVALID_OUTPUT");
});

runTest("2.5: Unexpected or unknown status returns INVALID_OUTPUT (never success)", () => {
  const unexpectedStatuses = ["PENDING", "UNKNOWN", "QUEUED", "FAILED", undefined, ""];
  for (const st of unexpectedStatuses) {
    const packet = { status: st, response: "should not succeed" };
    const res = parseResponseEnvelope(JSON.stringify(packet), { role: "piledriver", slug: "gemini-3.1-pro-high" });
    assert.strictEqual(res.ok, false, `Expected status '${st}' to fail with INVALID_OUTPUT`);
    assert.strictEqual(res.error, "INVALID_OUTPUT");
    assert.ok(res.message.includes("Unexpected response status"));
  }
});

runTest("2.6: status === 'SUCCESS' with valid string response succeeds", () => {
  const successPacket = {
    status: "SUCCESS",
    response: "Task completed successfully",
    duration_seconds: 2.14,
    usage: {
      input_tokens: 100,
      output_tokens: 20,
      total_tokens: 120,
    },
  };
  const res = parseResponseEnvelope(JSON.stringify(successPacket), { role: "piledriver", slug: "gemini-3.1-pro-high" });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.response, "Task completed successfully");
  assert.strictEqual(res.duration, 2.14);
  assert.strictEqual(res.usage.total_tokens, 120);
  assert.strictEqual(res.role, "piledriver");
  assert.strictEqual(res.slug, "gemini-3.1-pro-high");
});

runTest("2.7: invokeTransport enforces response envelope validation on process execution", () => {
  // Test using a mock executable that writes to stdout
  const mockScript = join(tmpdir(), `mock-agy-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`);
  writeFileSync(
    mockScript,
    `#!/usr/bin/env node
console.log(process.env.MOCK_STDOUT || "{}");
process.exit(Number(process.env.MOCK_EXIT_CODE || 0));
`
  );
  chmodSync(mockScript, 0o755);

  try {
    // 1. Invalid JSON from process
    const invalidJsonRes = invokeTransport({
      slug: "gemini-3.1-pro-high",
      prompt: "test",
      agyPath: mockScript,
      env: { MOCK_STDOUT: "corrupted json {{{" },
    });
    assert.strictEqual(invalidJsonRes.ok, false);
    assert.strictEqual(invalidJsonRes.error, "INVALID_OUTPUT");

    // 2. Unknown status from process
    const pendingRes = invokeTransport({
      slug: "gemini-3.1-pro-high",
      prompt: "test",
      agyPath: mockScript,
      env: { MOCK_STDOUT: JSON.stringify({ status: "PENDING", response: "wait" }) },
    });
    assert.strictEqual(pendingRes.ok, false);
    assert.strictEqual(pendingRes.error, "INVALID_OUTPUT");

    // 3. Process execution failure (non-zero exit)
    const failRes = invokeTransport({
      slug: "gemini-3.1-pro-high",
      prompt: "test",
      agyPath: mockScript,
      env: { MOCK_EXIT_CODE: "2" },
    });
    assert.strictEqual(failRes.ok, false);
    assert.strictEqual(failRes.error, "EXECUTION_FAILED");
    assert.strictEqual(failRes.exitCode, 2);

    // 4. Valid SUCCESS envelope from process
    const okRes = invokeTransport({
      slug: "gemini-3.1-pro-high",
      prompt: "test",
      agyPath: mockScript,
      env: {
        MOCK_STDOUT: JSON.stringify({
          status: "SUCCESS",
          response: "TRANSPORT_OK",
          duration_seconds: 0.5,
          usage: { total_tokens: 10 },
        }),
      },
    });
    assert.strictEqual(okRes.ok, true);
    assert.strictEqual(okRes.response, "TRANSPORT_OK");
  } finally {
    try {
      unlinkSync(mockScript);
    } catch {}
  }
});

runTest("2.8: Output format discipline: invoke() rejects non-JSON / cannot bypass envelope validation, while invokeTransport retains text support", () => {
  // 1. invoke() explicitly rejects outputFormat: "text" with INVALID_OUTPUT_FORMAT
  const textRes = invoke("piledriver", { task: "Test" }, { outputFormat: "text" });
  assert.strictEqual(textRes.ok, false);
  assert.strictEqual(textRes.error, "INVALID_OUTPUT_FORMAT");
  assert.strictEqual(textRes.role, "piledriver");
  assert.ok(textRes.message.includes("invoke() requires JSON output format; envelope validation cannot be bypassed"));

  // 2. invoke() also rejects other non-JSON formats
  const rawRes = invoke("bulldozer", { task: "Test" }, { outputFormat: "raw" });
  assert.strictEqual(rawRes.ok, false);
  assert.strictEqual(rawRes.error, "INVALID_OUTPUT_FORMAT");

  // 3. invoke() cannot bypass envelope validation via mock execution returning plain text
  const mockScript = join(tmpdir(), `mock-agy-format-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`);
  writeFileSync(
    mockScript,
    `#!/usr/bin/env node
console.log(process.env.MOCK_STDOUT || "raw unparsed plain text");
process.exit(0);
`
  );
  chmodSync(mockScript, 0o755);

  try {
    // When invoke() is used, envelope validation is enforced (outputFormat forced to "json")
    // If output is plain text, it fails with INVALID_OUTPUT
    const invokeEnvelopeCheck = invoke(
      "piledriver",
      { task: "Test" },
      {
        agyPath: mockScript,
        installedModels: [{ slug: "gemini-3.1-pro-high", description: "Gemini 3.1 Pro (High)" }],
        env: { MOCK_STDOUT: "plain text output instead of JSON envelope" },
      }
    );
    assert.strictEqual(invokeEnvelopeCheck.ok, false);
    assert.strictEqual(invokeEnvelopeCheck.error, "INVALID_OUTPUT");
    assert.ok(invokeEnvelopeCheck.message.includes("Failed to parse JSON response"));

    // 4. In contrast, invokeTransport directly supports outputFormat: "text" when needed
    const transportTextRes = invokeTransport({
      slug: "gemini-3.1-pro-high",
      prompt: "test",
      outputFormat: "text",
      agyPath: mockScript,
      env: { MOCK_STDOUT: "plain text output" },
    });
    assert.strictEqual(transportTextRes.ok, true);
    assert.strictEqual(transportTextRes.slug, "gemini-3.1-pro-high");
    assert.strictEqual(transportTextRes.response.trim(), "plain text output");
  } finally {
    try {
      unlinkSync(mockScript);
    } catch {}
  }
});

// =============================================================================
// Section 3: Bounded Prompt Construction & Packet Boundary (Blocker 3)
// =============================================================================

runTest("3.1: Deterministic prompt construction with minimal packet", () => {
  const prompt = composeBoundedPrompt("piledriver", { task: "Implement feature X" });
  const body = readFileSync(new URL("../agents/piledriver.md", import.meta.url), "utf8").trim();
  assert.strictEqual(prompt, `## Role\npiledriver\n\n## Role Body\n${body}\n\n## Task\nImplement feature X`);
});

runTest("3.2: Deterministic prompt construction with complete structured packet", () => {
  const packet = {
    task: "Refactor database migrations",
    contextFiles: ["db/schema.sql", "db/migrate.js"],
    evidence: ["Migration 004 failed on test DB", "Disk usage at 80%"],
    constraints: ["Zero downtime required", "No breaking schema changes"],
    expectedOutput: "A unified rollback script and updated migration file",
  };
  const prompt = composeBoundedPrompt("bulldozer", packet);

  const expectedPrompt = [
    "## Role\nbulldozer",
    `## Role Body\n${readFileSync(new URL("../agents/bulldozer.md", import.meta.url), "utf8").trim()}`,
    "## Task\nRefactor database migrations",
    "## Context Files\n- db/schema.sql\n- db/migrate.js",
    "## Evidence\n- Migration 004 failed on test DB\n- Disk usage at 80%",
    "## Constraints\n- Zero downtime required\n- No breaking schema changes",
    "## Expected Output\nA unified rollback script and updated migration file",
  ].join("\n\n");

  assert.strictEqual(prompt, expectedPrompt);
});

runTest("3.3: Task alias 'objective' is accepted when 'task' is omitted", () => {
  const prompt = composeBoundedPrompt("steamroller", { objective: "Analyze trade-offs" });
  const body = readFileSync(new URL("../agents/steamroller.md", import.meta.url), "utf8").trim();
  assert.strictEqual(prompt, `## Role\nsteamroller\n\n## Role Body\n${body}\n\n## Task\nAnalyze trade-offs`);
});

runTest("3.4: Rejection of invalid handoff packets (throws InvalidHandoffPacketError)", () => {
  for (const badPacket of [null, undefined, "raw string", 42, [], {}, { task: "" }, { task: "   " }]) {
    let caught = null;
    try {
      composeBoundedPrompt("piledriver", badPacket);
    } catch (err) {
      caught = err;
    }
    assert.ok(
      caught instanceof InvalidHandoffPacketError,
      `Expected InvalidHandoffPacketError for ${JSON.stringify(badPacket)}`
    );
    assert.strictEqual(caught.error, "INVALID_HANDOFF_PACKET");
  }
});

runTest("3.5: Strict prohibition of raw conversational state in handoff packet", () => {
  const forbiddenFields = ["messages", "conversation", "history", "transcript"];
  for (const field of forbiddenFields) {
    let caught = null;
    try {
      composeBoundedPrompt("piledriver", {
        task: "Valid task",
        [field]: [{ role: "user", content: "forbidden" }],
      });
    } catch (err) {
      caught = err;
    }
    assert.ok(
      caught instanceof InvalidHandoffPacketError,
      `Expected InvalidHandoffPacketError for field '${field}'`
    );
    assert.ok(caught.message.includes(`Forbidden conversational state field in handoff packet: "${field}"`));
  }
});

runTest("3.6: Contract-level invoke returns structured error for invalid packet", () => {
  const res1 = invoke("piledriver", null);
  assert.strictEqual(res1.ok, false);
  assert.strictEqual(res1.error, "INVALID_HANDOFF_PACKET");
  assert.strictEqual(res1.role, "piledriver");

  const res2 = invoke("piledriver", { task: "Do work", messages: ["raw history"] });
  assert.strictEqual(res2.ok, false);
  assert.strictEqual(res2.error, "INVALID_HANDOFF_PACKET");
  assert.strictEqual(res2.role, "piledriver");

  const res3 = invoke("piledriver", "raw string instead of packet");
  assert.strictEqual(res3.ok, false);
  assert.strictEqual(res3.error, "INVALID_HANDOFF_PACKET");
});

// =============================================================================
// Section 4: Recursion Protection (NTG_RUNNER_CHAIN)
// =============================================================================

runTest("4.1: Single-role chain detection blocks invocation (RECURSION_DETECTED)", () => {
  const origChain = process.env.NTG_RUNNER_CHAIN;
  try {
    process.env.NTG_RUNNER_CHAIN = "piledriver";
    const res = invoke("piledriver", { task: "Reply with test" });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.error, "RECURSION_DETECTED");
    assert.strictEqual(res.role, "piledriver");
    assert.strictEqual(res.chain, "piledriver");
  } finally {
    if (origChain === undefined) {
      delete process.env.NTG_RUNNER_CHAIN;
    } else {
      process.env.NTG_RUNNER_CHAIN = origChain;
    }
  }
});

runTest("4.2: Multi-role chain detection blocks re-entrant role (RECURSION_DETECTED)", () => {
  const origChain = process.env.NTG_RUNNER_CHAIN;
  try {
    process.env.NTG_RUNNER_CHAIN = "steamroller:bulldozer";
    const res = invoke("bulldozer", { task: "Reply with test" });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.error, "RECURSION_DETECTED");
    assert.strictEqual(res.role, "bulldozer");
    assert.strictEqual(res.chain, "steamroller:bulldozer");
  } finally {
    if (origChain === undefined) {
      delete process.env.NTG_RUNNER_CHAIN;
    } else {
      process.env.NTG_RUNNER_CHAIN = origChain;
    }
  }
});

// =============================================================================
// Section 5: Live Piledriver & Bulldozer Invocations (Handoff Packets)
// =============================================================================

const skipLive = process.env.SKIP_LIVE_TESTS === "1" || process.env.SKIP_LIVE_TESTS === "true";

if (skipLive) {
  console.log("[SKIP] Section 5 live LLM tests skipped via SKIP_LIVE_TESTS=1");
} else {
  runTest("5.1: Live Piledriver bounded invocation (gemini-3.1-pro-high)", () => {
    const res = invoke("piledriver", { task: "Reply with exactly: PILEDRIVER_SPIKE_PASS" });
    assert.strictEqual(
      res.ok,
      true,
      `Expected res.ok === true, got error: ${res.error} (${res.stderr || res.message})`
    );
    assert.strictEqual(res.role, "piledriver");
    assert.strictEqual(res.slug, "gemini-3.1-pro-high");
    assert.ok(typeof res.response === "string", "Expected response to be string");
    assert.ok(
      res.response.includes("PILEDRIVER_SPIKE_PASS"),
      `Expected response to contain 'PILEDRIVER_SPIKE_PASS', got: ${res.response}`
    );
    assert.ok(typeof res.duration === "number", "Expected numeric duration");
    assert.ok(res.usage && typeof res.usage.total_tokens === "number", "Expected usage statistics");
  });

  runTest("5.2: Live Bulldozer bounded invocation (gemini-3.8-flash-high)", () => {
    const res = invoke("bulldozer", { task: "Reply with exactly: BULLDOZER_SPIKE_PASS" });
    assert.strictEqual(
      res.ok,
      true,
      `Expected res.ok === true, got error: ${res.error} (${res.stderr || res.message})`
    );
    assert.strictEqual(res.role, "bulldozer");
    assert.strictEqual(res.slug, "gemini-3.8-flash-high");
    assert.ok(typeof res.response === "string", "Expected response to be string");
    assert.ok(
      res.response.includes("BULLDOZER_SPIKE_PASS"),
      `Expected response to contain 'BULLDOZER_SPIKE_PASS', got: ${res.response}`
    );
    assert.ok(typeof res.duration === "number", "Expected numeric duration");
    assert.ok(res.usage && typeof res.usage.total_tokens === "number", "Expected usage statistics");
  });
}

// =============================================================================
// Section 6: Explicit Role Body Loading (CROSS_SLICE_BLOCKER_44B)
// =============================================================================

function withRoleBodies(fn) {
  const root = mkdtempSync(join(tmpdir(), "ntg-role-bodies-"));
  const roleBodyDir = join(root, "roles");
  const cwd = join(root, "neutral");
  const capture = join(root, "transport-called");
  const agyPath = join(root, "agy.mjs");
  const installedModels = ["gemini-3.1-pro-high", "gemini-3.8-flash-high"];
  try {
    mkdirSync(roleBodyDir);
    mkdirSync(cwd);
    for (const role of ["steamroller", "piledriver", "bulldozer"]) {
      writeFileSync(join(roleBodyDir, `${role}.md`), `BODY_MARKER_${role}\n`);
    }
    // Exercise the real process boundary: echo the actual --print argument.
    writeFileSync(agyPath, `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
if (process.argv[2] === "models") {
  console.log(${JSON.stringify(installedModels.join("\n"))});
} else {
  writeFileSync(process.env.NTG_TEST_CAPTURE, "called");
  const value = flag => process.argv[process.argv.indexOf(flag) + 1];
  console.log(JSON.stringify({ status: "SUCCESS", response: JSON.stringify({
    prompt: value("--print"), slug: value("--model"), format: value("--output-format"),
    chain: process.env.NTG_RUNNER_CHAIN, cwd: process.cwd()
  }) }));
}
`);
    chmodSync(agyPath, 0o755);
    fn({ roleBodyDir, cwd, capture, agyPath, installedModels, env: { NTG_TEST_CAPTURE: capture } });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

runTest("6.1: All three role bodies reach transport deterministically with handoff sections", () => {
  withRoleBodies(opts => {
    const packet = {
      task: "TASK_MARKER",
      contextFiles: ["CONTEXT_MARKER"],
      evidence: ["EVIDENCE_MARKER"],
      constraints: ["CONSTRAINT_MARKER"],
      expectedOutput: "OUTPUT_MARKER",
    };
    for (const role of ["steamroller", "piledriver", "bulldozer"]) {
      const prompt = composeBoundedPrompt(role, packet, opts);
      assert.strictEqual(composeBoundedPrompt(role, packet, opts), prompt);
      const sections = prompt.split("\n\n");
      assert.deepStrictEqual(sections, [
        `## Role\n${role}`, `## Role Body\nBODY_MARKER_${role}`,
        "## Task\nTASK_MARKER", "## Context Files\n- CONTEXT_MARKER",
        "## Evidence\n- EVIDENCE_MARKER", "## Constraints\n- CONSTRAINT_MARKER",
        "## Expected Output\nOUTPUT_MARKER",
      ]);
      const res = invoke(role, packet, opts);
      assert.strictEqual(res.ok, true, JSON.stringify(res));
      const received = JSON.parse(res.response);
      assert.strictEqual(received.prompt, prompt);
      assert.strictEqual(received.slug, resolveSlug(role, opts));
      assert.strictEqual(received.format, "json");
      assert.strictEqual(received.chain, role);
      assert.strictEqual(received.cwd, opts.cwd);
    }
    const mixedCase = invoke(" PileDriver ", packet, opts);
    assert.strictEqual(mixedCase.ok, true, JSON.stringify(mixedCase));
    assert.ok(JSON.parse(mixedCase.response).prompt.includes("BODY_MARKER_piledriver"));
  });
});

runTest("6.2: Missing role body fails closed before transport without default fallback", () => {
  withRoleBodies(opts => {
    unlinkSync(join(opts.roleBodyDir, "piledriver.md"));
    const res = invoke("piledriver", { task: "TASK_MARKER" }, opts);
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.error, "ROLE_BODY_MISSING");
    assert.strictEqual(res.role, "piledriver");
    assert.strictEqual(existsSync(opts.capture), false);
  });
});

runTest("6.3: Empty, whitespace, malformed UTF-8 and binary bodies fail closed", () => {
  withRoleBodies(opts => {
    for (const body of ["", " \t\r\n", Buffer.from([0xc3, 0x28]), "BODY_MARKER\u0000"]) {
      writeFileSync(join(opts.roleBodyDir, "piledriver.md"), body);
      const res = invoke("piledriver", { task: "TASK_MARKER" }, opts);
      assert.strictEqual(res.ok, false);
      assert.strictEqual(res.error, "ROLE_BODY_INVALID");
      assert.strictEqual(res.role, "piledriver");
      assert.strictEqual(existsSync(opts.capture), false);
    }
  });
});

runTest("6.4: Unreadable role path and invalid directory options fail closed", () => {
  withRoleBodies(opts => {
    const path = join(opts.roleBodyDir, "piledriver.md");
    unlinkSync(path);
    mkdirSync(path); // A directory cannot be read as a body, even when run as root.
    for (const roleBodyDir of [opts.roleBodyDir, "", 42]) {
      const res = invoke("piledriver", { task: "TASK_MARKER" }, { ...opts, roleBodyDir });
      assert.strictEqual(res.ok, false);
      assert.strictEqual(res.error, "ROLE_BODY_INVALID");
      assert.strictEqual(existsSync(opts.capture), false);
    }
  });
});

runTest("6.5: Native specialists, inherited object keys and path traversal are not runner roles", () => {
  withRoleBodies(opts => {
    for (const role of ["jaguar", "puma", "bobcat", "strix-halo", "zen", "excavator", "instinct", "constructor", "__proto__", "../piledriver"]) {
      writeFileSync(join(opts.roleBodyDir, `${role.replaceAll("/", "_")}.md`), "DISALLOWED_MARKER");
      assert.throws(() => composeBoundedPrompt(role, { task: "TASK_MARKER" }, opts), UnresolvedModelSlugError);
      const res = invoke(role, { task: "TASK_MARKER" }, opts);
      assert.strictEqual(res.ok, false);
      assert.strictEqual(res.error, "UNRESOLVED_MODEL_SLUG");
      assert.strictEqual(existsSync(opts.capture), false);
    }
  });
});

runTest("6.6: Neutral process cwd needs no customization for explicit or module-relative bodies", () => {
  withRoleBodies(opts => {
    const originalCwd = process.cwd();
    const originalDir = process.env.NTG_ROLE_BODY_DIR;
    try {
      delete process.env.NTG_ROLE_BODY_DIR;
      process.chdir(opts.cwd);
      assert.strictEqual(existsSync("AGENTS.md"), false);
      assert.strictEqual(existsSync("agents"), false);
      for (const role of ["steamroller", "piledriver", "bulldozer"]) {
        const packet = { task: "TASK_MARKER" };
        const explicit = invoke(role, packet, opts);
        assert.strictEqual(explicit.ok, true, JSON.stringify(explicit));
        assert.ok(JSON.parse(explicit.response).prompt.includes(`BODY_MARKER_${role}`));
        const shipped = readFileSync(new URL(`../agents/${role}.md`, import.meta.url), "utf8").trim();
        const defaultPrompt = composeBoundedPrompt(role, packet);
        assert.ok(defaultPrompt.includes(`## Role Body\n${shipped}\n\n## Task\nTASK_MARKER`));
        const runnerDir = dirname(fileURLToPath(new URL("../scripts/runner.mjs", import.meta.url)));
        const relativePrompt = composeBoundedPrompt(role, packet, {
          roleBodyDir: relative(runnerDir, opts.roleBodyDir),
        });
        assert.strictEqual(relativePrompt, JSON.parse(explicit.response).prompt);
      }
    } finally {
      process.chdir(originalCwd);
      if (originalDir === undefined) delete process.env.NTG_ROLE_BODY_DIR;
      else process.env.NTG_ROLE_BODY_DIR = originalDir;
    }
  });
});

runTest("6.7: Directory precedence is explicit option, invocation env, process env, default", () => {
  withRoleBodies(opts => {
    const originalDir = process.env.NTG_ROLE_BODY_DIR;
    const packet = { task: "TASK_MARKER" };
    try {
      process.env.NTG_ROLE_BODY_DIR = join(opts.cwd, "missing");
      const explicit = invoke("piledriver", packet, opts);
      assert.strictEqual(explicit.ok, true, JSON.stringify(explicit));
      const { roleBodyDir, ...envOpts } = opts;
      const invocationEnv = invoke("piledriver", packet, {
        ...envOpts, env: { ...opts.env, NTG_ROLE_BODY_DIR: roleBodyDir },
      });
      assert.strictEqual(invocationEnv.ok, true, JSON.stringify(invocationEnv));
      assert.strictEqual(invocationEnv.response, explicit.response);
      process.env.NTG_ROLE_BODY_DIR = roleBodyDir;
      const processEnv = invoke("piledriver", packet, envOpts);
      assert.strictEqual(processEnv.ok, true, JSON.stringify(processEnv));
      assert.strictEqual(processEnv.response, explicit.response);
      const invalidEnv = invoke("piledriver", packet, {
        ...envOpts, env: { ...opts.env, NTG_ROLE_BODY_DIR: "" },
      });
      assert.strictEqual(invalidEnv.error, "ROLE_BODY_INVALID");
    } finally {
      if (originalDir === undefined) delete process.env.NTG_ROLE_BODY_DIR;
      else process.env.NTG_ROLE_BODY_DIR = originalDir;
    }
  });
});

runTest("6.8: Role bodies do not bypass any forbidden conversation field", () => {
  withRoleBodies(opts => {
    for (const field of ["messages", "conversation", "history", "transcript"]) {
      const res = invoke("piledriver", { task: "TASK_MARKER", [field]: ["RAW_HISTORY_MARKER"] }, opts);
      assert.strictEqual(res.ok, false);
      assert.strictEqual(res.error, "INVALID_HANDOFF_PACKET");
      assert.strictEqual(existsSync(opts.capture), false);
    }
  });
});

runTest("6.9: CLI injects env-selected role body from neutral cwd and reports missing body", () => {
  withRoleBodies(opts => {
    const runnerPath = fileURLToPath(new URL("../scripts/runner.mjs", import.meta.url));
    const cliOpts = {
      cwd: opts.cwd, encoding: "utf8", timeout: 10000,
      env: { ...process.env, ...opts.env, AGY_PATH: opts.agyPath, NTG_ROLE_BODY_DIR: opts.roleBodyDir },
    };
    const success = spawnSync(process.execPath, [runnerPath, "piledriver", "CLI_TASK_MARKER"], cliOpts);
    assert.ifError(success.error);
    assert.strictEqual(success.status, 0, success.stderr);
    const received = JSON.parse(success.stdout);
    assert.ok(received.prompt.includes("BODY_MARKER_piledriver"));
    assert.ok(received.prompt.includes("## Task\nCLI_TASK_MARKER"));
    assert.strictEqual(received.slug, "gemini-3.1-pro-high");
    unlinkSync(opts.capture);
    unlinkSync(join(opts.roleBodyDir, "piledriver.md"));
    const failure = spawnSync(process.execPath, [runnerPath, "piledriver", "CLI_TASK_MARKER"], cliOpts);
    assert.ifError(failure.error);
    assert.strictEqual(failure.status, 1);
    assert.strictEqual(JSON.parse(failure.stderr).error, "ROLE_BODY_MISSING");
    assert.strictEqual(existsSync(opts.capture), false);
  });
});

console.log("=========================================================");
console.log(`Summary: ${passed} passed, ${failed} failed (Total: ${passed + failed})`);

if (failed > 0) {
  process.exitCode = 1;
} else {
  process.exitCode = 0;
}


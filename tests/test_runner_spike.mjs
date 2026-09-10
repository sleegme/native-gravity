import assert from "node:assert/strict";
import process from "node:process";
import { ROLE_MODEL_TABLE, resolveSlug, invoke } from "../scripts/runner.mjs";

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

// 1. Slug resolution failure test: unknown role throws structured error, no silent fallback
runTest("Test 1: Slug resolution failure test (no silent fallback)", () => {
  // Test resolveSlug throws structured error
  let caughtSlugErr = null;
  try {
    resolveSlug("nonexistent-role");
  } catch (err) {
    caughtSlugErr = err;
  }
  assert.ok(caughtSlugErr instanceof Error, "Expected resolveSlug to throw an Error instance");
  assert.strictEqual(caughtSlugErr.ok, false, "Expected err.ok === false");
  assert.strictEqual(caughtSlugErr.error, "UNRESOLVED_MODEL_SLUG", "Expected err.error === 'UNRESOLVED_MODEL_SLUG'");
  assert.strictEqual(caughtSlugErr.role, "nonexistent-role", "Expected err.role === 'nonexistent-role'");

  // Test invoke returns structured error packet without silent fallback
  const invokeResult = invoke("nonexistent-role", "Test prompt");
  assert.strictEqual(invokeResult.ok, false, "Expected invokeResult.ok === false");
  assert.strictEqual(invokeResult.error, "UNRESOLVED_MODEL_SLUG", "Expected invokeResult.error === 'UNRESOLVED_MODEL_SLUG'");
  assert.strictEqual(invokeResult.role, "nonexistent-role", "Expected invokeResult.role === 'nonexistent-role'");
});

// 2. Recursion protection test: setting NTG_RUNNER_CHAIN to role returns RECURSION_DETECTED
runTest("Test 2: Recursion protection test (NTG_RUNNER_CHAIN detection)", () => {
  const origChain = process.env.NTG_RUNNER_CHAIN;
  try {
    // Single-role chain test
    process.env.NTG_RUNNER_CHAIN = "piledriver";
    const res1 = invoke("piledriver", "Reply with test");
    assert.strictEqual(res1.ok, false, "Expected res1.ok === false");
    assert.strictEqual(res1.error, "RECURSION_DETECTED", "Expected res1.error === 'RECURSION_DETECTED'");
    assert.strictEqual(res1.role, "piledriver", "Expected res1.role === 'piledriver'");
    assert.strictEqual(res1.chain, "piledriver", "Expected res1.chain === 'piledriver'");

    // Multi-role chain test
    process.env.NTG_RUNNER_CHAIN = "steamroller:bulldozer";
    const res2 = invoke("bulldozer", "Reply with test");
    assert.strictEqual(res2.ok, false, "Expected res2.ok === false");
    assert.strictEqual(res2.error, "RECURSION_DETECTED", "Expected res2.error === 'RECURSION_DETECTED'");
    assert.strictEqual(res2.role, "bulldozer", "Expected res2.role === 'bulldozer'");
    assert.strictEqual(res2.chain, "steamroller:bulldozer", "Expected res2.chain === 'steamroller:bulldozer'");
  } finally {
    if (origChain === undefined) {
      delete process.env.NTG_RUNNER_CHAIN;
    } else {
      process.env.NTG_RUNNER_CHAIN = origChain;
    }
  }
});

// 3. Live Piledriver test: invoke("piledriver", "Reply with exactly: PILEDRIVER_SPIKE_PASS")
runTest("Test 3: Live Piledriver test (gemini-3.1-pro-high -> PILEDRIVER_SPIKE_PASS)", () => {
  const res = invoke("piledriver", "Reply with exactly: PILEDRIVER_SPIKE_PASS");
  assert.strictEqual(res.ok, true, `Expected res.ok === true, got error: ${res.error} (${res.stderr || res.message})`);
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

// 4. Live Bulldozer test: invoke("bulldozer", "Reply with exactly: BULLDOZER_SPIKE_PASS")
runTest("Test 4: Live Bulldozer test (gemini-3.8-flash-high -> BULLDOZER_SPIKE_PASS)", () => {
  const res = invoke("bulldozer", "Reply with exactly: BULLDOZER_SPIKE_PASS");
  assert.strictEqual(res.ok, true, `Expected res.ok === true, got error: ${res.error} (${res.stderr || res.message})`);
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

console.log("=========================================================");
console.log(`Summary: ${passed} passed, ${failed} failed (Total: ${passed + failed})`);

if (failed > 0) {
  process.exitCode = 1;
} else {
  process.exitCode = 0;
}

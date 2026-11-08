import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { test } from "node:test";
import { invokeTransport, parseResponseEnvelope } from "../scripts/runner.mjs";

// Clean ambient runner chain from caller environment so tests run hermetically
delete process.env.NTG_RUNNER_CHAIN;

function mockSpawn(t, envelope = { status: "SUCCESS", response: "ok" }) {
  const calls = [];
  t.mock.method(childProcess, "spawnSync", (command, args, options) => {
    calls.push({ command, args, options });
    if (args && args[0] === "mcp") return { status: 0, stdout: "" };
    return { status: 0, stdout: JSON.stringify(envelope) };
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  return calls;
}

function fixtureNaviOwner(t) {
  const home = mkdtempSync(join(tmpdir(), "ntg-navi-owner-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const data = join(home, ".gemini", "antigravity-cli");
  mkdirSync(data, { recursive: true });
  const credential = join(data, "antigravity-oauth-token");
  writeFileSync(credential, "fixture-token-not-a-real-credential\n");
  const bin = join(home, ".local", "bin");
  mkdirSync(bin, { recursive: true });
  const serverName = ["computer", "use", "linux"].join("-");
  const server = join(bin, serverName);
  writeFileSync(server, "#!/bin/sh\nexit 0\n");
  chmodSync(server, 0o755);
  return {
    home,
    env: {
      HOME: home,
      WAYLAND_DISPLAY: "wayland-fixture",
      XDG_RUNTIME_DIR: "/run/user/fixture",
      DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/fixture/bus",
    },
  };
}

test("runner: bulldozer invocation env carries NTG_BULLDOZER_NO_SHELL=1", (t) => {
  const calls = mockSpawn(t);
  const res = invokeTransport({
    role: "bulldozer",
    slug: "gemini-3.8-flash-high",
    prompt: "inspect task",
    agyPath: "agy",
  });
  assert.equal(res.ok, true);
  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.equal(call.options.env.NTG_BULLDOZER_NO_SHELL, "1");
  assert.ok(call.options.env.NTG_BULLDOZER_CONVERSATION_FILE);
  assert.equal(existsSync(dirname(call.options.env.NTG_BULLDOZER_CONVERSATION_FILE)), false);
});

test("runner: each Bulldozer invocation owns fresh context and cleans up after spawn failure", (t) => {
  const paths = [];
  t.mock.method(childProcess, "spawnSync", (command, args, options) => {
    const path = options.env.NTG_BULLDOZER_CONVERSATION_FILE;
    assert.ok(existsSync(dirname(path)));
    assert.equal(existsSync(path), false);
    assert.notEqual(path, "ambient-parent-binding");
    paths.push(path);
    writeFileSync(path, "28cef410-65b7-4009-858a-3dc9fe05c53a");
    throw new Error("fixture spawn failure");
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });

  for (let i = 0; i < 2; i++) {
    const result = invokeTransport({
      role: "bulldozer", slug: "test-slug", prompt: "task", agyPath: "agy",
      env: { NTG_BULLDOZER_CONVERSATION_FILE: "ambient-parent-binding" },
    });
    assert.equal(result.error, "SPAWN_ERROR");
    assert.equal(existsSync(dirname(paths[i])), false);
  }
  assert.notEqual(paths[0], paths[1]);
});

test("runner: non-bulldozer roles (piledriver, instinct, steamroller, zen) do NOT carry NTG_BULLDOZER_NO_SHELL", (t) => {
  const calls = mockSpawn(t);
  const nonBulldozerRoles = ["piledriver", "instinct", "steamroller", "zen"];
  for (const role of nonBulldozerRoles) {
    const res = invokeTransport({
      role,
      slug: "test-slug",
      prompt: "execute task",
      agyPath: "agy",
    });
    assert.equal(res.ok, true);
  }
  assert.equal(calls.length, nonBulldozerRoles.length);
  for (let i = 0; i < nonBulldozerRoles.length; i++) {
    const role = nonBulldozerRoles[i];
    const call = calls[i];
    assert.equal("NTG_BULLDOZER_NO_SHELL" in call.options.env, false, `Role ${role} should not carry NTG_BULLDOZER_NO_SHELL`);
    assert.equal(call.options.env.NTG_BULLDOZER_NO_SHELL, undefined);
  }
});

test("runner: navi invocation does NOT carry NTG_BULLDOZER_NO_SHELL", (t) => {
  const { env } = fixtureNaviOwner(t);
  const calls = mockSpawn(t);
  const res = invokeTransport({
    role: "navi",
    slug: "gemini-4-argon-medium",
    prompt: "observe desktop",
    env,
    agyPath: "agy",
  });
  assert.equal(res.ok, true);
  // Navi executes mcp registration + runner agent invocation
  const agentCall = calls.find((c) => c.args && c.args.includes("--model"));
  assert.ok(agentCall, "Navi runner agent invocation should be made");
  assert.equal("NTG_BULLDOZER_NO_SHELL" in agentCall.options.env, false);
  assert.equal(agentCall.options.env.NTG_BULLDOZER_NO_SHELL, undefined);
});

test("runner: ambient NTG_BULLDOZER_NO_SHELL in process.env is stripped for non-bulldozer roles", (t) => {
  const savedAmbient = process.env.NTG_BULLDOZER_NO_SHELL;
  process.env.NTG_BULLDOZER_NO_SHELL = "1";
  t.after(() => {
    if (savedAmbient !== undefined) {
      process.env.NTG_BULLDOZER_NO_SHELL = savedAmbient;
    } else {
      delete process.env.NTG_BULLDOZER_NO_SHELL;
    }
  });

  const calls = mockSpawn(t);
  const roles = ["piledriver", "instinct", "steamroller", "zen"];
  for (const role of roles) {
    const res = invokeTransport({
      role,
      slug: "test-slug",
      prompt: "task",
      agyPath: "agy",
    });
    assert.equal(res.ok, true);
  }
  assert.equal(calls.length, roles.length);
  for (let i = 0; i < roles.length; i++) {
    const role = roles[i];
    assert.equal(
      "NTG_BULLDOZER_NO_SHELL" in calls[i].options.env,
      false,
      `Ambient NTG_BULLDOZER_NO_SHELL should be stripped for role ${role}`
    );
  }

  // Also check navi runner invocation with ambient marker
  const { env } = fixtureNaviOwner(t);
  const naviRes = invokeTransport({
    role: "navi",
    slug: "gemini-4-argon-medium",
    prompt: "task",
    env,
    agyPath: "agy",
  });
  assert.equal(naviRes.ok, true);
  const agentCall = calls.find((c) => c.args && c.args.includes("--model"));
  assert.ok(agentCall, "Navi runner agent invocation should be made");
  assert.equal("NTG_BULLDOZER_NO_SHELL" in agentCall.options.env, false);
  assert.equal(agentCall.options.env.NTG_BULLDOZER_NO_SHELL, undefined);
});

test("runner: ambient NTG_BULLDOZER_NO_SHELL in opts.env is also stripped for non-bulldozer roles", (t) => {
  const calls = mockSpawn(t);
  const res = invokeTransport({
    role: "piledriver",
    slug: "gemini-4-argon-high",
    prompt: "plan",
    env: { NTG_BULLDOZER_NO_SHELL: "1", NTG_BULLDOZER_CONVERSATION_FILE: "ambient-parent-binding" },
    agyPath: "agy",
  });
  assert.equal(res.ok, true);
  assert.equal("NTG_BULLDOZER_NO_SHELL" in calls[0].options.env, false);
  assert.equal("NTG_BULLDOZER_CONVERSATION_FILE" in calls[0].options.env, false);
});

test("runner: real process execution validates environment marker presence and absence", (t) => {
  const mockScript = join(tmpdir(), `mock-agy-env-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`);
  writeFileSync(
    mockScript,
    `#!/usr/bin/env node
console.log(JSON.stringify({
  status: "SUCCESS",
  response: JSON.stringify({
    hasMarker: "NTG_BULLDOZER_NO_SHELL" in process.env,
    markerValue: process.env.NTG_BULLDOZER_NO_SHELL,
  })
}));
`
  );
  chmodSync(mockScript, 0o755);
  t.after(() => rmSync(mockScript, { force: true }));

  // Bulldozer receives the marker
  const bulldozerRes = invokeTransport({
    role: "bulldozer",
    slug: "gemini-3.8-flash-high",
    prompt: "test",
    agyPath: mockScript,
  });
  assert.equal(bulldozerRes.ok, true);
  const bulldozerData = JSON.parse(bulldozerRes.response);
  assert.equal(bulldozerData.hasMarker, true);
  assert.equal(bulldozerData.markerValue, "1");

  // Piledriver does not receive the marker
  const piledriverRes = invokeTransport({
    role: "piledriver",
    slug: "gemini-4-argon-high",
    prompt: "test",
    agyPath: mockScript,
  });
  assert.equal(piledriverRes.ok, true);
  const piledriverData = JSON.parse(piledriverRes.response);
  assert.equal(piledriverData.hasMarker, false);
  assert.equal(piledriverData.markerValue, undefined);
});

test("runner: parseResponseEnvelope preserves denied_actions and returns TOOL_PERMISSION_DENIED without crashing", () => {
  const deniedPayload = {
    status: "SUCCESS",
    response: null,
    denied_actions: [
      {
        tool: "run_command",
        reason: "Bulldozer has no shell authority; discovery routes to Jaguar.",
      },
    ],
    duration_seconds: 1.5,
    usage: { prompt_tokens: 100, completion_tokens: 10 },
  };

  const parsed = parseResponseEnvelope(JSON.stringify(deniedPayload), {
    role: "bulldozer",
    slug: "gemini-3.8-flash-high",
  });

  assert.equal(parsed.ok, false);
  assert.equal(parsed.error, "TOOL_PERMISSION_DENIED");
  assert.equal(parsed.role, "bulldozer");
  assert.equal(parsed.slug, "gemini-3.8-flash-high");
  assert.deepEqual(parsed.denied_actions, deniedPayload.denied_actions);
  assert.deepEqual(parsed.usage, deniedPayload.usage);
  assert.deepEqual(parsed.details, deniedPayload);
});

test("runner: invokeTransport returns TOOL_PERMISSION_DENIED when AGY envelope has denied_actions", (t) => {
  const deniedPayload = {
    status: "SUCCESS",
    response: null,
    denied_actions: [
      {
        tool: "run_command",
        reason: "Bulldozer has no shell authority; discovery routes to Jaguar.",
      },
    ],
  };

  mockSpawn(t, deniedPayload);
  const res = invokeTransport({
    role: "bulldozer",
    slug: "gemini-3.8-flash-high",
    prompt: "run command",
    agyPath: "agy",
  });

  assert.equal(res.ok, false);
  assert.equal(res.error, "TOOL_PERMISSION_DENIED");
  assert.equal(res.role, "bulldozer");
  assert.equal(res.slug, "gemini-3.8-flash-high");
  assert.equal(res.denied_actions.length, 1);
  assert.equal(res.denied_actions[0].tool, "run_command");
  assert.equal(
    res.denied_actions[0].reason,
    "Bulldozer has no shell authority; discovery routes to Jaguar."
  );
});

// ---------------------------------------------------------------------------
// Stage 1 (subagent redesign 2026-11-08 §2.6.2): Bulldozer runner invocations
// carry the per-conversation budget-hook env; other roles never do.
// ---------------------------------------------------------------------------

test("runner: bulldozer invocation env carries the budget defaults and a fresh state dir", (t) => {
  const calls = mockSpawn(t);
  const first = invokeTransport({
    role: "bulldozer", slug: "gemini-3.8-flash-high", prompt: "task", agyPath: "agy",
  });
  const second = invokeTransport({
    role: "bulldozer", slug: "gemini-3.8-flash-high", prompt: "task", agyPath: "agy",
  });
  assert.equal(first.ok && second.ok, true);
  assert.equal(calls.length, 2);
  const [one, two] = calls.map(call => call.options.env);
  for (const env of [one, two]) {
    assert.equal(env.NTG_BUDGET_MAX_CALLS, "140");
    assert.equal(env.NTG_BUDGET_MAX_SPAWN_CALLS, "2");
    assert.equal(env.NTG_BUDGET_ROOT_MAX_CALLS, "90");
    assert.equal(env.NTG_BUDGET_ROOT_MAX_READ_CALLS, "12");
    assert.equal(env.NTG_BUDGET_ROOT_MAX_SPAWN_CALLS, "4");
    assert.ok(env.NTG_BUDGET_STATE_DIR.endsWith("budget"));
    assert.ok(env.NTG_BUDGET_ROOT_FILE.endsWith("budget-root"));
  }
  assert.notEqual(one.NTG_BUDGET_STATE_DIR, two.NTG_BUDGET_STATE_DIR);
});

test("runner: caller opts.env overrides budget caps (spine salvage session)", (t) => {
  const calls = mockSpawn(t);
  const res = invokeTransport({
    role: "bulldozer", slug: "gemini-3.8-flash-high", prompt: "salvage", agyPath: "agy",
    env: { NTG_SALVAGE: "1", NTG_BUDGET_ROOT_MAX_CALLS: "25" },
  });
  assert.equal(res.ok, true);
  const env = calls[0].options.env;
  assert.equal(env.NTG_SALVAGE, "1");
  assert.equal(env.NTG_BUDGET_ROOT_MAX_CALLS, "25");
  assert.equal(env.NTG_BUDGET_MAX_CALLS, "140");
});

test("runner: non-bulldozer roles carry no budget or salvage markers, ambient stripped", (t) => {
  const calls = mockSpawn(t);
  const res = invokeTransport({
    role: "piledriver", slug: "gemini-4-argon-high", prompt: "plan", agyPath: "agy",
    env: { NTG_BUDGET_ROOT_MAX_CALLS: "90", NTG_SALVAGE: "1" },
  });
  assert.equal(res.ok, true);
  const env = calls[0].options.env;
  for (const key of Object.keys(env)) {
    assert.equal(key.startsWith("NTG_BUDGET_"), false, key);
    assert.notEqual(key, "NTG_SALVAGE");
  }
});

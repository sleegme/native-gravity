import assert from "node:assert/strict";
import childProcess, { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { withNaviHome } from "../scripts/navi.mjs";
import { invokeTransport, resolveSlug } from "../scripts/runner.mjs";

const windows = process.platform === "win32";
const fixture = fileURLToPath(new URL("./fixtures/navi-windows-agy.cs", import.meta.url));
const runner = new URL("../scripts/runner.mjs", import.meta.url).href;

function setup(t) {
  const directory = fs.mkdtempSync(join(tmpdir(), "ntg-win-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const agyPath = join(directory, "fake agy.exe");
  const script = `$ErrorActionPreference='Stop'; Add-Type -TypeDefinition (Get-Content -LiteralPath '${fixture}' -Raw) -ReferencedAssemblies System.Web.Extensions -OutputAssembly '${agyPath}' -OutputType ConsoleApplication`;
  const built = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand",
    Buffer.from(script, "utf16le").toString("base64")], { encoding: "utf8", timeout: 30000 });
  assert.equal(built.status, 0, built.stderr);
  const owner = join(directory, "owner");
  fs.mkdirSync(owner);
  const trace = join(directory, "trace.json");
  return { directory, owner, trace, agyPath, windowsBackend: process.execPath,
    env: { USERPROFILE: owner, HOME: owner, NTG_FAKE_TRACE: trace },
    timeout: 10000, role: "navi", slug: "gemini-3.8-flash", effort: "low", prompt: "fixture" };
}

function dead(pid) {
  try { process.kill(pid, 0); return false; } catch (error) {
    if (error.code === "ESRCH") return true;
    throw error;
  }
}

test("Windows Navi confines env and cu config, pins agy, and reaps descendants without owner access", { skip: !windows }, t => {
  const opts = setup(t);
  const installed = join(opts.owner, "AppData", "Local", "agy", "bin", "agy.exe");
  fs.mkdirSync(join(opts.owner, "AppData", "Local", "agy", "bin"), { recursive: true });
  fs.copyFileSync(opts.agyPath, installed);
  delete opts.agyPath;
  opts.env.AGY_PATH = "";
  const parent = { ...process.env };
  const forbidden = join(opts.owner, ".gemini").toLowerCase();
  const forbiddenAccesses = [];
  // Observe the launcher's filesystem boundary, not just the final state.
  for (const name of ["accessSync", "statSync", "readFileSync", "writeFileSync", "mkdirSync", "rmSync", "symlinkSync"]) {
    const original = fs.default[name];
    t.mock.method(fs.default, name, (...args) => {
      if (String(args[0]).toLowerCase().startsWith(forbidden)) forbiddenAccesses.push(name);
      assert.ok(!String(args[0]).toLowerCase().startsWith(forbidden), "owner config must not be accessed");
      return original(...args);
    });
  }
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const result = invokeTransport(opts);
  assert.equal(result.ok, true, JSON.stringify(result));
  const captured = JSON.parse(result.response);
  assert.notEqual(captured.home, opts.owner);
  assert.equal(captured.profile, captured.home);
  assert.equal(captured.update, "1");
  const config = JSON.parse(captured.config);
  assert.deepEqual(Object.keys(config.mcpServers), ["cu"]);
  assert.equal(config.mcpServers.cu.args[1], "--windows");
  assert.ok(config.mcpServers.cu.args[0].endsWith("navi-bridge.mjs"));
  assert.equal(config.mcpServers.cu.args[2], process.execPath);
  assert.equal(captured.arguments[captured.arguments.indexOf("--effort") + 1], "low");
  assert.equal(fs.existsSync(captured.home), false);
  assert.equal(dead(captured.descendant), true);
  assert.deepEqual({ ...process.env }, parent);
  assert.equal(fs.existsSync(join(opts.owner, ".gemini")), false);
  const missing = invokeTransport({ ...opts, agyPath: "not-found-fixture",
    env: { ...opts.env, Path: join(opts.owner, ".gemini", "bin") } });
  assert.equal(missing.code, "NAVI_AGY_MISSING");
  assert.deepEqual(forbiddenAccesses, []);
});

test("Windows Navi resolves model discovery inside the same private Job boundary", { skip: !windows }, t => {
  const opts = setup(t);
  assert.equal(resolveSlug("navi", opts), "gemini-4-argon-medium");
  assert.equal(fs.existsSync(join(opts.owner, ".gemini")), false);
});

for (const mode of ["error", "block", "overflow"]) {
  test(`Windows Navi cleans profile and descendants on ${mode}`, { skip: !windows }, t => {
    const opts = setup(t);
    opts.env.NTG_FAKE_MODE = mode;
    opts.timeout = mode === "block" ? 1500 : 10000;
    const result = invokeTransport(opts);
    assert.equal(result.ok, false);
    if (mode === "overflow") assert.equal(result.error, "SPAWN_ERROR");
    else assert.equal(result.code, mode === "block" ? "NAVI_TIMEOUT" : "NAVI_EXECUTION_FAILED");
    const captured = JSON.parse(fs.readFileSync(opts.trace, "utf8"));
    assert.equal(fs.existsSync(captured.home), false);
    assert.equal(dead(captured.descendant), true);
    assert.ok(!JSON.stringify(result).includes("SYNTHETIC_PRIVATE_ERROR"));
    assert.ok(!JSON.stringify(result).includes(captured.home));
  });
}

test("Windows Navi removes private profile when setup callback throws", { skip: !windows }, t => {
  const opts = setup(t);
  let root;
  assert.throws(() => withNaviHome(opts, env => {
    root = env.HOME;
    throw new Error("callback failed");
  }), /callback failed/);
  assert.equal(fs.existsSync(root), false);
});

test("Windows Navi rejects missing executable without running or accessing owner config", { skip: !windows }, t => {
  const opts = setup(t);
  const saved = childProcess.spawnSync;
  t.mock.method(childProcess, "spawnSync", () => assert.fail("no process should start"));
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  assert.equal(invokeTransport({ ...opts, agyPath: join(opts.owner, "absent.exe") }).code, "NAVI_AGY_MISSING");
  assert.equal(fs.existsSync(join(opts.owner, ".gemini")), false);
  assert.equal(typeof saved, "function");
});

test("Windows Navi parent cancellation kills the Job and removes its profile", { skip: !windows, timeout: 45000 }, async t => {
  const opts = setup(t);
  opts.env.NTG_FAKE_MODE = "block";
  const pipeName = `ntg-navi-${process.pid}-${randomUUID()}`;
  opts.env.NTG_FAKE_PIPE = pipeName;
  const server = createServer();
  t.after(() => server.close());
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("fake readiness timed out")), 15000);
    server.once("connection", socket => {
      let buffer = "";
      socket.on("data", chunk => {
        buffer += chunk;
        if (buffer.includes("\n")) {
          clearTimeout(timer);
          resolve(JSON.parse(buffer.trim()));
          socket.end();
        }
      });
    });
  });
  await new Promise(resolve => server.listen(`\\\\.\\pipe\\${pipeName}`, resolve));
  const parent = spawn(process.execPath, ["--input-type=module", "-e",
    `import {invokeTransport} from ${JSON.stringify(runner)}; invokeTransport(${JSON.stringify(opts)});`],
  { stdio: "ignore" });
  t.after(() => parent.kill());
  const captured = await ready;
  const removed = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { watcher.close(); reject(new Error("profile cleanup timed out")); }, 15000);
    const watcher = fs.watch(tmpdir(), () => {
      if (!fs.existsSync(captured.home)) { clearTimeout(timer); watcher.close(); resolve(); }
    });
  });
  parent.kill();
  await removed;
  assert.equal(dead(captured.descendant), true);
});

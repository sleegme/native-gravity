import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync,
} from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { withNaviHome } from '../scripts/navi.mjs';
import { invoke, invokeTransport, resolveSlug } from '../scripts/runner.mjs';
import { MinimalSpine } from '../scripts/spine.mjs';
import { main } from '../scripts/ntg-vnext.mjs';

const root = new URL('../', import.meta.url);
const DESKTOP_ENV_KEYS = ['WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS'];
const bridgePath = fileURLToPath(new URL('../scripts/navi-bridge.mjs', import.meta.url));

function fixtureOwner(t) {
  const home = mkdtempSync(join(tmpdir(), 'ntg-navi-owner-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const data = join(home, '.gemini', 'antigravity-cli');
  mkdirSync(data, { recursive: true });
  const credential = join(data, 'antigravity-oauth-token');
  writeFileSync(credential, 'fixture-token-not-a-real-credential\n');
  const bin = join(home, '.local', 'bin');
  mkdirSync(bin, { recursive: true });
  const server = join(bin, ['computer', 'use', 'linux'].join('-'));
  writeFileSync(server, '#!/bin/sh\nexit 0\n');
  chmodSync(server, 0o755);
  return {
    home, credential, server,
    env: {
      HOME: home,
      WAYLAND_DISPLAY: 'wayland-fixture',
      XDG_RUNTIME_DIR: '/run/user/fixture',
      DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/fixture/bus',
    },
  };
}

function mockSpawn(t, envelope = { status: 'SUCCESS', response: 'ok' }) {
  const calls = [];
  t.mock.method(childProcess, 'spawnSync', (command, args, options) => {
    calls.push({ command, args, options });
    if (args[0] === 'mcp') return { status: 0, stdout: '' };
    return { status: 0, stdout: JSON.stringify(envelope) };
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  return calls;
}

test('Navi resolves Argon Medium and fails closed without that model', () => {
  const installedModels = ['gemini-4-argon-high', 'gemini-4-argon-medium'];
  assert.equal(resolveSlug('navi', { installedModels }), 'gemini-4-argon-medium');
  assert.throws(() => resolveSlug('navi', { installedModels: installedModels.slice(0, 1) }),
    { error: 'UNRESOLVED_MODEL_SLUG' });
});

test('withNaviHome refuses when a desktop environment variable is missing', t => {
  const { env } = fixtureOwner(t);
  const calls = mockSpawn(t);
  for (const key of DESKTOP_ENV_KEYS) {
    const saved = process.env[key];
    delete process.env[key];
    try {
      const partial = { ...env };
      delete partial[key];
      assert.throws(
        () => withNaviHome({ env: partial, agyPath: 'agy' }, () => assert.fail('run must not execute')),
        error => error.code === 'NAVI_ENV_MISSING' && error.variable === key,
        key,
      );
    } finally {
      if (saved !== undefined) process.env[key] = saved;
    }
  }
  assert.equal(calls.length, 0);
});

test('withNaviHome fails closed on missing credential or server without leaking paths', t => {
  const { home, credential, server, env } = fixtureOwner(t);
  const calls = mockSpawn(t);
  for (const [missing, code] of [[credential, 'NAVI_CREDENTIAL_MISSING'], [server, 'NAVI_SERVER_MISSING']]) {
    const saved = readFileSync(missing);
    rmSync(missing);
    try {
      assert.throws(
        () => withNaviHome({ env, agyPath: 'agy' }, () => assert.fail('run must not execute')),
        error => error.code === code
          && !error.message.includes(home) && !error.message.includes(missing),
        missing,
      );
    } finally {
      writeFileSync(missing, saved);
      if (missing === server) chmodSync(server, 0o755);
    }
  }
  assert.equal(calls.length, 0);
});

test('withNaviHome builds a private root with only server cu and removes it', t => {
  const { home, credential, server, env } = fixtureOwner(t);
  const calls = mockSpawn(t);
  let root;
  const result = withNaviHome({ env, agyPath: 'agy' }, (childEnv, prefix) => {
    root = childEnv.HOME;
    assert.ok(root.startsWith(tmpdir()), 'private root lives under the system temp directory');
    assert.equal(childEnv.AGY_CLI_DISABLE_AUTO_UPDATE, '1');
    const data = join(root, '.gemini', 'antigravity-cli');
    assert.equal(realpathSync(join(data, 'antigravity-oauth-token')), realpathSync(credential));
    assert.equal(realpathSync(join(data, 'conversations')), realpathSync(join(home, '.gemini', 'antigravity-cli', 'conversations')));
    assert.equal(realpathSync(join(data, 'brain')), realpathSync(join(home, '.gemini', 'antigravity-cli', 'brain')));
    assert.deepEqual(prefix, [
      '--bind', '/', '/', '--dev-bind', '/dev', '/dev',
      '--ro-bind', credential, credential, '--die-with-parent', '--',
    ]);
    return 'ran';
  });
  assert.equal(result, 'ran');
  assert.equal(existsSync(root), false, 'private root is removed after the run');
  assert.equal(calls.length, 1, 'exactly one registration process');
  assert.equal(calls[0].command, 'agy');
  assert.deepEqual(calls[0].args, [
    'mcp', 'add',
    '--env', 'WAYLAND_DISPLAY=wayland-fixture',
    '--env', 'XDG_RUNTIME_DIR=/run/user/fixture',
    '--env', 'DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/fixture/bus',
    'cu', process.execPath, bridgePath, server, 'mcp',
  ]);
  assert.equal(calls[0].args.filter(arg => arg === 'cu').length, 1, 'only server cu is registered');
  assert.equal(calls[0].options.env.HOME, root, 'registration runs inside the private root');
  assert.ok(!calls[0].args.includes(server) || calls[0].args.indexOf(bridgePath) < calls[0].args.indexOf(server),
    'the raw server binary is behind the discovery bridge');
});

test('withNaviHome removes the private root when the run throws', t => {
  const { env } = fixtureOwner(t);
  mockSpawn(t);
  let root;
  assert.throws(() => withNaviHome({ env, agyPath: 'agy' }, childEnv => {
    root = childEnv.HOME;
    throw new Error('run failure');
  }), /run failure/);
  assert.equal(existsSync(root), false, 'private root is removed on failure');
});

test('navi bridge answers the AGY discovery probe and forwards the MCP handshake', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'ntg-navi-bridge-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const stub = join(directory, 'stub-server.mjs');
  writeFileSync(stub, [
    "import { createInterface } from 'node:readline';",
    "createInterface({ input: process.stdin, crlfDelay: Infinity }).on('line', line => {",
    '  const message = JSON.parse(line);',
    "  if (message.method === 'initialize') {",
    "    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'stub', version: '0' } } }) + '\\n');",
    '  }',
    '});',
  ].join('\n'));
  const probe = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'server/discover', params: {} });
  const initialize = JSON.stringify({
    jsonrpc: '2.0', id: 2, method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } },
  });
  const child = childProcess.spawn(process.execPath, [bridgePath, process.execPath, stub], {
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  t.after(() => child.kill());
  const lines = [];
  let buffer = '';
  child.stdout.on('data', chunk => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\n')) !== -1) {
      lines.push(JSON.parse(buffer.slice(0, index)));
      buffer = buffer.slice(index + 1);
    }
  });
  const waitFor = count => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${count} bridge replies`)), 15000);
    const poll = () => {
      if (lines.length >= count) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout.on('data', poll);
    poll();
  });
  child.stdin.write(`${probe}\n`);
  await waitFor(1);
  assert.deepEqual(lines[0], {
    jsonrpc: '2.0', id: 1,
    error: { code: -32601, message: 'Method not found: server/discover' },
  }, 'the discovery probe is answered as a standard method-not-found');
  child.stdin.write(`${initialize}\n`);
  await waitFor(2);
  assert.equal(lines[1].id, 2);
  assert.equal(lines[1].result.serverInfo.name, 'stub', 'the MCP handshake is forwarded to the real server');
  child.stdin.end();
});

test('runner gives the private HOME only to role navi and leaves other roles untouched', t => {
  const { home, env } = fixtureOwner(t);
  const calls = mockSpawn(t);
  const savedChain = process.env.NTG_RUNNER_CHAIN;
  delete process.env.NTG_RUNNER_CHAIN;
  t.after(() => {
    if (savedChain !== undefined) process.env.NTG_RUNNER_CHAIN = savedChain;
  });

  const navi = invokeTransport({
    role: 'navi', slug: 'gemini-4-argon-medium', prompt: 'observe the desktop',
    env, agyPath: 'agy', timeout: 60000,
  });
  assert.equal(navi.ok, true);
  assert.equal(calls.length, 2, 'one registration plus one sandboxed transport');
  const registration = calls[0];
  const sandboxed = calls[1];
  assert.equal(sandboxed.command, 'bwrap', 'Navi transport runs inside bubblewrap');
  assert.ok(sandboxed.args.includes('agy'));
  assert.equal(sandboxed.args[sandboxed.args.indexOf('--model') + 1], 'gemini-4-argon-medium');
  assert.ok(!sandboxed.args.includes('--agent'), 'Navi no longer selects a native agent');
  const privateHome = sandboxed.options.env.HOME;
  assert.equal(privateHome, registration.options.env.HOME);
  assert.notEqual(privateHome, home);
  assert.notEqual(privateHome, process.env.HOME);
  assert.equal(existsSync(privateHome), false, 'private root is removed after the transport returns');

  const piledriver = invokeTransport({
    role: 'piledriver', slug: 'gemini-4-argon-high', prompt: 'return a plan', agyPath: 'agy', timeout: 60000,
  });
  assert.equal(piledriver.ok, true);
  const direct = calls.at(-1);
  assert.equal(direct.command, 'agy', 'non-Navi roles spawn agy directly');
  assert.equal(direct.options.env.HOME, process.env.HOME, 'non-Navi env keeps the real HOME');
  assert.ok(!direct.args.includes('--dangerously-skip-permissions'));
  assert.equal(calls.filter(call => call.command === 'bwrap').length, 1, 'no other role is sandboxed');
});

test('Navi contract invocation resolves Argon Medium and runs sandboxed without replay', t => {
  const { env } = fixtureOwner(t);
  const calls = mockSpawn(t);
  const result = invoke('navi', { task: 'Observe desktop' }, {
    installedModels: ['gemini-4-argon-medium'],
    env,
    agyPath: 'agy',
    timeout: 60000,
  });
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 1, 'Navi is never retried');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].command, 'bwrap');
  assert.equal(calls[1].args[calls[1].args.indexOf('--model') + 1], 'gemini-4-argon-medium');
  assert.ok(!calls[1].args.includes('--agent'));
});

test('desktop server reference exists only in scripts/navi.mjs', () => {
  const needle = ['computer', 'use', 'linux'].join('-');
  const base = fileURLToPath(root);
  const offenders = [];
  const walk = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (['.git', 'node_modules', '__pycache__'].includes(entry.name)) continue;
      const full = join(directory, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      const rel = relative(base, full).split(sep).join('/');
      const runtime = rel.startsWith('scripts/') || rel.startsWith('hooks/') || rel.startsWith('agents/')
        || rel.startsWith('tests/') || ['plugin.json', 'hooks.json', 'package.json'].includes(entry.name)
        || /^mcp.*\.json$/i.test(entry.name);
      if (!runtime || rel === 'scripts/navi.mjs') continue;
      if (readFileSync(full, 'utf8').includes(needle)) offenders.push(rel);
    }
  };
  walk(base);
  assert.deepEqual(offenders, [], 'only the Navi runner may reference the desktop server at runtime');
});

test('Navi frontmatter carries no MCP servers or native primacy', () => {
  const navi = readFileSync(new URL('agents/navi.md', root), 'utf8');
  const frontmatter = navi.match(/^---\n([\s\S]*?)\n---/)[1];
  assert.doesNotMatch(frontmatter, /mcpServers/);
  assert.match(frontmatter, /mainAgent: false\n/);
  assert.match(frontmatter, /commandExecutionPolicy: off$/m);
});

test('Navi result contract includes confirmation sentinel and intended action', () => {
  const prompt = readFileSync(new URL('agents/navi.md', root), 'utf8');
  assert.match(prompt, /`NEEDS_CONFIRMATION`/);
  assert.match(prompt, /`intended_action`/);
});

test('Steamroller desktop results do not change the ledger or authorize workers', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'ntg-navi-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const ledgerPath = join(directory, 'ledger.json');
  const plan = {
    goal: 'Observe desktop', constraints: ['No external actions'],
    decision_invariants: [], plan_version: 'v1',
    milestones: [{
      id: 'one', title: 'one', objective: 'Observe desktop', bounded_scope: ['desktop'],
      acceptance_criteria: ['Screenshot observed'], non_goals: [], dependencies: [],
    }],
  };
  let response = { status: 'NEEDS_CONFIRMATION', intended_action: 'Submit the displayed form' };
  const calls = [];
  const deps = {
    handleSignals: false,
    invokeRole: (role, packet) => {
      calls.push({ role, packet });
      return { ok: true, response: JSON.stringify(response) };
    },
    invokeZen: () => { throw new Error('Desktop tasks must not request Zen'); },
  };
  const spine = new MinimalSpine({ ledgerPath, plan, ...deps });
  const before = readFileSync(ledgerPath);
  const result = await spine.requestDesktop('Submit a form');
  assert.equal(result.status, 'NEEDS_CONFIRMATION');
  assert.deepEqual(readFileSync(ledgerPath), before);
  assert.deepEqual(calls.map(c => c.role), ['navi']);
  await assert.rejects(spine.invokeSpecialist('navi', {}, { caller: 'bulldozer' }));
  response = { status: 'NEEDS_CONFIRMATION' };
  await assert.rejects(spine.requestDesktop('Submit a form'), { error: 'INVALID_RESPONSE_FORMAT' });
  spine.close();
  response = { status: 'NEEDS_CONFIRMATION', intended_action: 'Submit the displayed form' };
  const cli = await main(['navi', '--ledger', ledgerPath, '--task', 'Submit a form'], deps);
  assert.equal(cli.code, 2);
  assert.equal(cli.out.desktop.intended_action, response.intended_action);
  assert.deepEqual(readFileSync(ledgerPath), before);
});

// ---- Gate-review regressions (#156): sanitized navi failures and bridge lifecycle ----

function clearRunnerChain(t) {
  const saved = process.env.NTG_RUNNER_CHAIN;
  delete process.env.NTG_RUNNER_CHAIN;
  t.after(() => {
    if (saved !== undefined) process.env.NTG_RUNNER_CHAIN = saved;
  });
}

function mockSpawnQueue(t, results) {
  const calls = [];
  t.mock.method(childProcess, 'spawnSync', (command, args, options) => {
    calls.push({ command, args, options });
    const next = results.shift();
    if (!next) throw new Error('unexpected spawnSync call');
    return next;
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  return calls;
}

const FAILURE_SENTINELS = [
  'sk-synthetic-4Q9zK2mV7xR1tP5nW8yL3cJ6hD0bF2g',
  'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.synthetic-payload.synthetic-signature',
  '.gemini/antigravity-cli/antigravity-oauth-token',
  join(tmpdir(), 'ntg-navi-private-root', '.gemini', 'antigravity-cli'),
  '"mcpServers":{"cu":{"command"',
];

test('navi timeout results carry no raw stderr, stdout or synthetic secrets', t => {
  const { env } = fixtureOwner(t);
  clearRunnerChain(t);
  const leaked = FAILURE_SENTINELS.join('\n');
  mockSpawnQueue(t, [
    { status: 0, stdout: '' },
    { error: { code: 'ETIMEDOUT', message: 'agy timed out' }, stderr: leaked, stdout: leaked },
  ]);
  const result = invokeTransport({
    role: 'navi', slug: 'gemini-4-argon-medium', prompt: 'observe the desktop',
    env, agyPath: 'agy', timeout: 5000,
  });
  const { duration_ms, usage, ...sanitized } = result;
  assert.deepEqual(sanitized, { ok: false, error: 'TIMEOUT', code: 'NAVI_TIMEOUT', exitStatus: null });
  assert.equal(typeof duration_ms, 'number');
  assert.ok(duration_ms >= 0);
  assert.equal(usage, undefined);
  const serialized = JSON.stringify(result);
  for (const sentinel of FAILURE_SENTINELS) {
    assert.ok(!serialized.includes(sentinel), `timeout result leaked ${sentinel}`);
  }
});

test('navi nonzero-exit results are sanitized while other roles keep raw stderr', t => {
  const { env } = fixtureOwner(t);
  clearRunnerChain(t);
  const leaked = FAILURE_SENTINELS.join('\n');
  mockSpawnQueue(t, [
    { status: 0, stdout: '' },
    { status: 7, stderr: leaked, stdout: leaked },
    { status: 0, stdout: '' },
    { status: 7, stderr: leaked, stdout: JSON.stringify({ status: 'ERROR', message: leaked, usage: { total_tokens: 9 } }) },
    { status: 2, stderr: 'raw-diagnostic-line' },
  ]);
  const result = invokeTransport({
    role: 'navi', slug: 'gemini-4-argon-medium', prompt: 'observe the desktop',
    env, agyPath: 'agy', timeout: 5000,
  });
  const { duration_ms, usage, ...sanitized } = result;
  assert.deepEqual(sanitized, {
    ok: false, error: 'EXECUTION_FAILED', code: 'NAVI_EXECUTION_FAILED', exitStatus: 7,
  });
  assert.equal(typeof duration_ms, 'number');
  assert.ok(duration_ms >= 0);
  assert.equal(usage, undefined);
  const serialized = JSON.stringify(result);
  for (const sentinel of FAILURE_SENTINELS) {
    assert.ok(!serialized.includes(sentinel), `nonzero-exit result leaked ${sentinel}`);
  }
  const withUsage = invokeTransport({
    role: 'navi', slug: 'gemini-4-argon-medium', prompt: 'observe the desktop',
    env, agyPath: 'agy', timeout: 5000,
  });
  const { duration_ms: usageDuration, usage: usageData, ...usageSanitized } = withUsage;
  assert.deepEqual(usageSanitized, {
    ok: false, error: 'EXECUTION_FAILED', code: 'NAVI_EXECUTION_FAILED', exitStatus: 7,
  });
  assert.equal(typeof usageDuration, 'number');
  assert.ok(usageDuration >= 0);
  assert.deepEqual(usageData, { total_tokens: 9 });
  const usageSerialized = JSON.stringify(withUsage);
  for (const sentinel of FAILURE_SENTINELS) {
    assert.ok(!usageSerialized.includes(sentinel), `nonzero-exit usage result leaked ${sentinel}`);
  }
  const control = invokeTransport({
    role: 'bulldozer', slug: 'gemini-3.8-flash-high', prompt: 'implement',
    agyPath: 'agy', timeout: 5000,
  });
  assert.equal(control.exitCode, 2);
  assert.equal(control.stderr, 'raw-diagnostic-line', 'other roles keep raw stderr (unchanged scope)');
});

test('navi failure usage is projected to numeric token counts, never arbitrary fields', t => {
  const { env } = fixtureOwner(t);
  clearRunnerChain(t);
  const secret = 'sk-synthetic-navi-usage-secret';
  const credential = '/virtual-navi-private/.gemini/antigravity-cli/antigravity-oauth-token';
  mockSpawnQueue(t, [
    { status: 0, stdout: '' },
    {
      status: 7,
      stderr: secret,
      stdout: JSON.stringify({
        status: 'ERROR',
        usage: {
          total_tokens: 9,
          input_tokens: '10',
          output_tokens: -4,
          diagnostic: secret,
          credential_path: credential,
          nested: { token: secret },
          list: [secret],
        },
      }),
    },
    { status: 0, stdout: '' },
    { status: 7, stderr: secret, stdout: JSON.stringify({ status: 'ERROR', usage: [secret] }) },
    { status: 0, stdout: '' },
    { status: 7, stderr: secret, stdout: JSON.stringify({ status: 'ERROR', usage: { total_tokens: secret } }) },
  ]);
  const invoke = () => invokeTransport({
    role: 'navi', slug: 'gemini-4-argon-medium', prompt: 'observe the desktop',
    env, agyPath: 'agy', timeout: 5000,
  });

  const projected = invoke();
  assert.deepEqual(projected.usage, { total_tokens: 9 }, 'only valid finite nonnegative numeric fields survive');
  const serialized = JSON.stringify(projected);
  assert.ok(!serialized.includes(secret), 'synthetic secret inside usage must not leak');
  assert.ok(!serialized.includes(credential), 'credential path inside usage must not leak');
  assert.ok(!serialized.includes('diagnostic'));
  assert.ok(!serialized.includes('nested'));

  assert.equal(invoke().usage, undefined, 'array usage is rejected, not returned raw');
  assert.equal(invoke().usage, undefined, 'nonnumeric token values are rejected');
});

test('navi timeout retains sanitized available usage and rejects invalid usage', t => {
  const { env } = fixtureOwner(t);
  clearRunnerChain(t);
  const secret = 'sk-synthetic-navi-timeout-usage';
  mockSpawnQueue(t, [
    { status: 0, stdout: '' },
    {
      error: { code: 'ETIMEDOUT' },
      status: null,
      stderr: secret,
      stdout: JSON.stringify({ status: 'ERROR', usage: { total_tokens: 9, diagnostic: secret } }),
    },
    { status: 0, stdout: '' },
    {
      error: { code: 'ETIMEDOUT' },
      status: null,
      stderr: secret,
      stdout: JSON.stringify({ status: 'ERROR', usage: { total_tokens: secret } }),
    },
  ]);
  const invoke = () => invokeTransport({
    role: 'navi', slug: 'gemini-4-argon-medium', prompt: 'observe the desktop',
    env, agyPath: 'agy', timeout: 5000,
  });

  const timedOut = invoke();
  const { duration_ms, usage, ...sanitized } = timedOut;
  assert.deepEqual(sanitized, { ok: false, error: 'TIMEOUT', code: 'NAVI_TIMEOUT', exitStatus: null });
  assert.equal(typeof duration_ms, 'number');
  assert.ok(duration_ms >= 0);
  assert.deepEqual(usage, { total_tokens: 9 }, 'parseable timeout usage is retained after projection');
  assert.ok(!JSON.stringify(timedOut).includes(secret));

  const invalid = invoke();
  assert.equal(invalid.error, 'TIMEOUT');
  assert.equal(invalid.usage, undefined, 'invalid timeout usage stays unknown');
  assert.ok(!JSON.stringify(invalid).includes(secret));
});

function spawnSigtermIgnoringServer(base, t) {
  const directory = mkdtempSync(join(base, 'run-'));
  const stub = join(directory, 'stub-ignore-sigterm.mjs');
  const pidFile = join(directory, 'server.pid');
  writeFileSync(stub, [
    "import { writeFileSync } from 'node:fs';",
    "process.on('SIGTERM', () => {});",
    'writeFileSync(process.argv[2], String(process.pid));',
    'setInterval(() => {}, 1000);',
  ].join('\n'));
  const bridge = childProcess.spawn(process.execPath, [bridgePath, process.execPath, stub, pidFile], {
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  t.after(() => { try { bridge.kill('SIGKILL'); } catch {} });
  return { bridge, pidFile };
}

function waitForPidFile(file, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const poll = () => {
      if (existsSync(file)) return resolve(Number(readFileSync(file, 'utf8')));
      if (Date.now() - startedAt > timeoutMs) return reject(new Error(`server pid file never appeared: ${file}`));
      setTimeout(poll, 10);
    };
    poll();
  });
}

function waitForExit(child, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      return resolve({ code: child.exitCode, signal: child.signalCode });
    }
    const timer = setTimeout(
      () => reject(new Error(`process ${child.pid} did not exit within ${timeoutMs}ms`)), timeoutMs);
    child.once('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
  });
}

async function waitForGone(pid, timeoutMs = 5000) {
  const startedAt = Date.now();
  for (;;) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === 'ESRCH') return;
      throw error;
    }
    if (Date.now() - startedAt > timeoutMs) throw new Error(`process ${pid} is still present after ${timeoutMs}ms`);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

test('navi bridge escalates to SIGKILL and reaps the server when stdin closes', async t => {
  const base = mkdtempSync(join(tmpdir(), 'ntg-navi-lifecycle-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const { bridge, pidFile } = spawnSigtermIgnoringServer(base, t);
  const serverPid = await waitForPidFile(pidFile);
  t.after(() => { try { process.kill(serverPid, 'SIGKILL'); } catch {} });
  const exitPromise = waitForExit(bridge);
  const startedAt = Date.now();
  bridge.stdin.end();
  const exit = await exitPromise;
  const elapsed = Date.now() - startedAt;
  assert.equal(exit.signal, null, 'the bridge itself exits normally after reaping');
  assert.equal(exit.code, 1, 'a SIGKILLed server maps to bridge exit 1');
  assert.ok(elapsed >= 2500, `the grace period was observed before escalation (${elapsed}ms)`);
  assert.ok(elapsed < 9000, `both processes are gone within the bound (${elapsed}ms)`);
  await waitForGone(serverPid);
});

test('navi bridge handles SIGTERM and SIGINT to itself with the same bounded escalation', async t => {
  const base = mkdtempSync(join(tmpdir(), 'ntg-navi-lifecycle-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  for (const signal of ['SIGTERM', 'SIGINT']) {
    const { bridge, pidFile } = spawnSigtermIgnoringServer(base, t);
    const serverPid = await waitForPidFile(pidFile);
    t.after(() => { try { process.kill(serverPid, 'SIGKILL'); } catch {} });
    const exitPromise = waitForExit(bridge);
    const startedAt = Date.now();
    bridge.kill(signal);
    const exit = await exitPromise;
    const elapsed = Date.now() - startedAt;
    assert.equal(exit.code, 1, `${signal}: bridge exits with the signal-killed server status`);
    assert.ok(elapsed >= 2500, `${signal}: the grace period was observed before escalation (${elapsed}ms)`);
    assert.ok(elapsed < 9000, `${signal}: both processes are gone within the bound (${elapsed}ms)`);
    await waitForGone(serverPid);
  }
});

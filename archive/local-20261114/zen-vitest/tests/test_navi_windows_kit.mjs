import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { createInterface } from 'node:readline';
import { spawn } from 'node:child_process';
import { probe } from '../scripts/navi-validation/probe.mjs';

const fixture = fileURLToPath(new URL('./fixtures/navi-windows-mcp.mjs', import.meta.url));
const kit = fileURLToPath(new URL('../scripts/navi-validation/windows-kit.ps1', import.meta.url));

test('Windows MCP probe filters discovery and blocks direct shell calls before they reach the backend', async () => {
  const report = await probe({ backend: process.execPath, backendArgs: [fixture],
    steps: [{ name: 'Snapshot', arguments: {} }] });
  assert.equal(report.status, 'PASS');
  assert.deepEqual(report.tools.map(tool => tool.name), ['Snapshot', 'Screenshot']);
  assert.equal(report.checks.find(check => check.name === 'blocked_direct_call').status, 'PASS');
  assert.equal(report.checks.find(check => check.name === 'bridge_exit').status, 'PASS');
  if (process.platform === 'win32') {
    assert.equal(report.checks.find(check => check.name === 'job_cleanup').status, 'PASS');
    assert.equal(report.job_exit_code, 0);
    assert.ok(report.job_events.some(event => event.returned && event.message === 4 && event.win32_error === 0));
  }
  assert.deepEqual(report.steps, [{ name: 'Snapshot', status: 'RETURNED', images: 1, outcome_verified: false }]);
  assert.equal(report.production_windows_support, 'PENDING');
  assert.ok(report.native_pending.length > 0);
  assert.ok(!JSON.stringify(report).includes('PRIVATE_DESKTOP_SENTINEL'));
  assert.ok(!JSON.stringify(report).includes('PRIVATE_IMAGE_SENTINEL'));
  assert.ok(!JSON.stringify(report).includes('PRIVATE_OWNER'));
  assert.ok(!JSON.stringify(report).includes('SYNTHETIC_SCHEMA_SECRET'));
  assert.ok(!JSON.stringify(report).includes('SYNTHETIC_BACKEND_SECRET'));
});

test('raw backend schemas remain locally inspectable but never enter the shareable report', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'ntg-local-schema-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const schemaOutput = join(directory, 'schemas.local.json');
  const report = await probe({ backend: process.execPath, backendArgs: [fixture], schemaOutput });
  assert.equal(report.status, 'PASS');
  assert.ok(readFileSync(schemaOutput, 'utf8').includes('SYNTHETIC_SCHEMA_SECRET'));
  assert.ok(!JSON.stringify(report).includes('SYNTHETIC_SCHEMA_SECRET'));
});

test('Windows bridge rejects batch and malformed envelopes without delivering them to the backend', async t => {
  const bridge = fileURLToPath(new URL('../scripts/navi-bridge.mjs', import.meta.url));
  const child = spawn(process.execPath, [bridge, '--windows', process.execPath, fixture],
    { stdio: ['pipe', 'pipe', 'ignore'] });
  t.after(() => child.kill());
  const lines = createInterface({ input: child.stdout });
  t.after(() => lines.close());
  const replies = [];
  const received = new Promise((resolveReplies, reject) => {
    const timer = setTimeout(() => reject(new Error('bridge replies timed out')), 5000);
    lines.on('line', line => {
      replies.push(JSON.parse(line));
      if (replies.length === 4) { clearTimeout(timer); resolveReplies(); }
    });
  });
  child.stdin.write(`${JSON.stringify([{ jsonrpc: '2.0', id: 1, method: 'tools/call',
    params: { name: 'PowerShell', arguments: {} } }])}\n`);
  child.stdin.write(`${JSON.stringify([{ jsonrpc: '2.0', id: 2, method: 'tools/list' }])}\n`);
  child.stdin.write('{not-json\n');
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'initialize' })}\n`);
  await received;
  assert.deepEqual(replies.slice(0, 3).map(reply => reply.error.code), [-32600, -32600, -32600]);
  assert.equal(replies[3].id, 3);
  assert.ok(replies[3].result.serverInfo);
  child.stdin.end();
});
test('Windows MCP probe reports initialization failure and still closes the bridge', async () => {
  const report = await probe({ backend: process.execPath, backendArgs: [fixture, '--reject-init'] });
  assert.equal(report.status, 'FAIL');
  assert.equal(report.error, 'MCP_REQUEST_REJECTED');
  assert.equal(report.checks.find(check => check.name === 'bridge_exit').status, 'PASS');
});

test('Windows MCP probe refuses an unreviewed step before starting a backend', async () => {
  await assert.rejects(probe({ backend: 'must-not-start',
    steps: [{ name: 'PowerShell', arguments: { command: 'anything' } }] }), /INVALID_DESKTOP_STEPS/);
});

test('first backend error survives cleanup without disclosing raw errors in the shared report', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'ntg-local-diagnostics-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const diagnosticsOutput = join(directory, 'errors.diagnostics.local.json');
  const report = await probe({ backend: process.execPath, backendArgs: [fixture, '--reject-snapshot'],
    steps: [{ name: 'Snapshot', arguments: {} }], diagnosticsOutput });
  const local = JSON.parse(readFileSync(diagnosticsOutput, 'utf8'));
  assert.equal(report.status, 'FAIL');
  assert.deepEqual(report.first_backend_error, { type: 'Error', message: 'MCP_REQUEST_REJECTED', rpc_code: -32603 });
  assert.equal(local.first_backend_error.backend_error.message,
    'snapshot failed at C:\\Users\\PRIVATE_OWNER; credential=SYNTHETIC_BACKEND_SECRET');
  assert.equal(local.local_only, true);
  assert.ok(!JSON.stringify(report).includes('PRIVATE_OWNER'));
  assert.ok(!JSON.stringify(report).includes('SYNTHETIC_BACKEND_SECRET'));
});

test('Windows kit returns UNSUPPORTED rather than PASS on a non-Windows PowerShell host', {
  skip: process.platform === 'win32' || !process.env.NTG_TEST_PWSH,
}, t => {
  const directory = mkdtempSync(join(tmpdir(), 'ntg-kit-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const output = join(directory, 'result.json');
  const result = spawnSync(process.env.NTG_TEST_PWSH, ['-NoLogo', '-NoProfile', '-NonInteractive',
    '-File', kit, '-Output', output], { encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 2, result.stderr);
  const report = JSON.parse(readFileSync(output, 'utf8'));
  assert.equal(report.status, 'UNSUPPORTED');
  assert.equal(report.production_windows_support, 'PENDING');
  assert.equal(report.baseline_sha, null);
  assert.equal(report.checks[0].status, 'UNSUPPORTED');
});

test('native fixture guards exercise all operations and release the shared original and alias', {
  skip: process.platform !== 'win32',
}, t => {
  const directory = mkdtempSync(join(tmpdir(), 'ntg-native-guard-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const output = join(directory, 'result.json');
  const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive',
    '-File', kit, '-Output', output], { encoding: 'utf8', timeout: 30000 });
  const report = JSON.parse(readFileSync(output, 'utf8'));
  assert.equal(result.status, 2, JSON.stringify(report));
  const guards = report.checks.filter(check => check.name.startsWith('fixture_guard_'));
  assert.equal(guards.length, 10);
  assert.ok(guards.every(check => check.status === 'PASS'));
  assert.equal(report.checks.find(check => check.name === 'fixture_alias_identity_and_release').status, 'PASS');
  assert.equal(report.production_windows_support, 'PENDING');
});

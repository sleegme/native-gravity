import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
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
  assert.deepEqual(report.steps, [{ name: 'Snapshot', status: 'RETURNED', images: 1, outcome_verified: false }]);
  assert.equal(report.production_windows_support, 'PENDING');
  assert.ok(report.native_pending.length > 0);
  assert.ok(!JSON.stringify(report).includes('PRIVATE_DESKTOP_SENTINEL'));
  assert.ok(!JSON.stringify(report).includes('PRIVATE_IMAGE_SENTINEL'));
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

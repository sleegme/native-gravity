import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const wrapper = fileURLToPath(new URL('../scripts/navi-validation/windows-job.ps1', import.meta.url));
const windows = { skip: process.platform !== 'win32', timeout: 30000 };
const powershellArgs = ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', wrapper];
const grandchild = `
  require('node:net').createServer().listen(0, '127.0.0.1', () => process.send(process.pid));
`;
const descendant = `
  const child = require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}],
    { detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  child.once('message', pid => process.send({ child: process.pid, grandchild: pid }));
`;
const root = `
  const child = require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}],
    { detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  child.once('message', descendants => console.log(JSON.stringify({
    ready: true, root: process.pid, wrapper: process.ppid, ...descendants,
    home: process.env.HOME, userprofile: process.env.USERPROFILE, cwd: process.cwd(),
    args: process.argv.slice(1)
  })));
  process.stdin.once('data', () => process.exit(23));
`;

function profile(t) {
  const directory = mkdtempSync(join(tmpdir(), 'ntg-navi-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function request(t, overrides = {}) {
  const directory = profile(t);
  const env = { ...process.env, HOME: directory, USERPROFILE: directory };
  const data = {
    executable: process.execPath, arguments: ['-e', root], timeout: 15000,
    parentPid: process.pid, cleanupDirectory: directory, propagateExitCode: true,
    cwd: directory, ...overrides,
  };
  const path = join(directory, '.job-request.json');
  writeFileSync(path, JSON.stringify(data));
  return { directory, env, data, path };
}

function observe(child) {
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const lines = createInterface({ input: child.stdout });
  const ready = new Promise((resolve, reject) => {
    lines.on('line', line => {
      if (line.startsWith('{')) {
        try { resolve(JSON.parse(line)); } catch (error) { reject(error); }
      }
    });
    child.once('error', reject);
    child.once('close', (code, signal) => reject(new Error(`Job exited before readiness (${code}, ${signal}): ${stderr}`)));
  });
  // Error-only fixtures need not await readiness.
  ready.catch(() => {});
  const closed = once(child, 'close', { signal: AbortSignal.timeout(25000) });
  return { ready, closed, stderr: () => stderr };
}

function start(t, fixture) {
  const child = spawn('powershell.exe', [...powershellArgs, '-RequestFile', fixture.path],
    { env: fixture.env, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  return { child, ...observe(child) };
}

function assertTreeGone(ready) {
  for (const key of ['root', 'child', 'grandchild']) {
    assert.throws(() => process.kill(ready[key], 0), { code: 'ESRCH' }, `${key} still exists`);
  }
}

test('native Windows job compiles', windows, () => {
  const result = spawnSync('powershell.exe', [...powershellArgs, '-CompileOnly'],
    { encoding: 'utf8', timeout: 25000 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /NAVI_JOB_COMPILE_PASS/);
});

test('production preserves root status, arguments, environment and cwd; removes descendants before profile', windows, async t => {
  const args = ['space argument', 'quoted"argument', 'trailing\\', ''];
  const fixture = request(t, { arguments: ['-e', root, '--', ...args] });
  const outside = mkdtempSync(join(tmpdir(), 'ntg-job-target-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  writeFileSync(join(outside, 'sentinel'), 'outside');
  symlinkSync(outside, join(fixture.directory, 'retained-owner-data'), 'junction');
  const job = start(t, fixture);
  const ready = await job.ready;
  assert.deepEqual(ready.args, args);
  assert.equal(ready.home, fixture.directory);
  assert.equal(ready.userprofile, fixture.directory);
  assert.equal(ready.cwd, fixture.directory);
  job.child.stdin.end('exit');
  assert.equal((await job.closed)[0], 23, job.stderr());
  assertTreeGone(ready);
  assert.equal(existsSync(fixture.directory), false);
  assert.equal(readFileSync(join(outside, 'sentinel'), 'utf8'), 'outside');
  assert.match(job.stderr(), /^NAVI_JOB_CLEANUP_PASS\r?$/m);
});

test('timeout terminates the entire job and removes the private profile', windows, async t => {
  const fixture = request(t, { timeout: 3000 });
  const job = start(t, fixture);
  const ready = await job.ready;
  assert.equal((await job.closed)[0], 124, job.stderr());
  assertTreeGone(ready);
  assert.equal(existsSync(fixture.directory), false);
  assert.match(job.stderr(), /^NAVI_JOB_CLEANUP_PASS\r?$/m);
});

test('owner process termination signals cancellation and cleanup without polling', windows, async t => {
  const owner = spawn(process.execPath, ['-e', 'process.stdin.resume()'], { stdio: ['pipe', 'ignore', 'ignore'] });
  t.after(() => owner.kill());
  const ownerExited = once(owner, 'close', { signal: AbortSignal.timeout(25000) });
  const fixture = request(t, { parentPid: owner.pid });
  const job = start(t, fixture);
  const ready = await job.ready;
  owner.kill();
  await ownerExited;
  assert.equal((await job.closed)[0], 130, job.stderr());
  assertTreeGone(ready);
  assert.equal(existsSync(fixture.directory), false);
  assert.match(job.stderr(), /^NAVI_JOB_CLEANUP_PASS\r?$/m);
});

test('killing a Node owner blocked in spawnSync still lets the wrapper finish cleanup', windows, async t => {
  const fixture = request(t);
  const relay = `
    const result = require('node:child_process').spawnSync('powershell.exe', process.argv.slice(1),
      { stdio: 'inherit', windowsHide: true });
    process.exit(result.status === null ? 1 : result.status);
  `;
  const ownerSource = `
    const fs = require('node:fs');
    const data = JSON.parse(fs.readFileSync(${JSON.stringify(fixture.path)}, 'utf8'));
    data.parentPid = process.pid;
    fs.writeFileSync(${JSON.stringify(fixture.path)}, JSON.stringify(data));
    const result = require('node:child_process').spawnSync(process.execPath,
      ['-e', ${JSON.stringify(relay)}, '--', ...${JSON.stringify([...powershellArgs, '-RequestFile', fixture.path])}],
      { stdio: 'inherit', detached: true, windowsHide: true });
    if (result.error) console.error(JSON.stringify({ spawnError: result.error.code, errno: result.error.errno }));
    process.exit(result.status);
  `;
  const owner = spawn(process.execPath, ['-e', ownerSource],
    { env: fixture.env, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => owner.kill());
  const observed = observe(owner);
  const ready = await observed.ready;
  owner.kill();
  // close waits for the inherited streams too, so the wrapper has finished.
  await observed.closed;
  assertTreeGone(ready);
  assert.equal(existsSync(fixture.directory), false);
  assert.match(observed.stderr(), /^NAVI_JOB_CLEANUP_PASS\r?$/m);
});

test('creation failure cleans the owned profile and emits only typed non-sensitive errors', windows, async t => {
  const fixture = request(t, { executable: join(tmpdir(), 'PRIVATE_EXECUTABLE_MISSING.exe') });
  const job = start(t, fixture);
  assert.equal((await job.closed)[0], 1);
  assert.equal(existsSync(fixture.directory), false);
  assert.match(job.stderr(), /^NAVI_JOB_CLEANUP_PASS\r?$/m);
  const line = job.stderr().split(/\r?\n/).find(value => value.startsWith('NAVI_JOB_EXCEPTION '));
  const error = JSON.parse(line.slice('NAVI_JOB_EXCEPTION '.length));
  assert.equal(error.exception_type, 'System.ComponentModel.Win32Exception');
  assert.equal(error.win32_error, 2);
  assert.ok(!job.stderr().includes('PRIVATE_EXECUTABLE_MISSING'));
  assert.ok(!job.stderr().includes(fixture.directory));
});

test('invalid request JSON is sanitized and cleaned before any child starts', windows, async t => {
  const fixture = request(t);
  writeFileSync(fixture.path, '{PRIVATE_JSON_SENTINEL');
  const job = start(t, fixture);
  assert.equal((await job.closed)[0], 1);
  assert.equal(existsSync(fixture.directory), false);
  assert.match(job.stderr(), /^NAVI_JOB_CLEANUP_PASS\r?$/m);
  assert.match(job.stderr(), /NAVI_JOB_EXCEPTION /);
  assert.ok(!job.stderr().includes('PRIVATE_JSON_SENTINEL'));
});

test('cleanup rejects arbitrary directories and profile-root junctions', windows, async t => {
  const fixture = request(t);
  const target = mkdtempSync(join(tmpdir(), 'ntg-unowned-'));
  t.after(() => rmSync(target, { recursive: true, force: true }));
  writeFileSync(join(target, 'sentinel'), 'keep');
  const badRequest = { ...fixture.data, cleanupDirectory: target };
  const result = spawnSync('powershell.exe', [...powershellArgs, '-Request',
    Buffer.from(JSON.stringify(badRequest)).toString('base64')],
  { env: fixture.env, encoding: 'utf8', timeout: 25000 });
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stderr, /NAVI_JOB_CLEANUP_PASS/);
  assert.equal(readFileSync(join(target, 'sentinel'), 'utf8'), 'keep');
  rmSync(fixture.directory, { recursive: true });
  symlinkSync(target, fixture.directory, 'junction');
  const junctionResult = spawnSync('powershell.exe', [...powershellArgs, '-Request',
    Buffer.from(JSON.stringify(fixture.data)).toString('base64')],
  { env: fixture.env, encoding: 'utf8', timeout: 25000 });
  assert.equal(junctionResult.status, 1);
  assert.doesNotMatch(junctionResult.stderr, /NAVI_JOB_CLEANUP_PASS/);
  assert.equal(readFileSync(join(target, 'sentinel'), 'utf8'), 'keep');
});

test('legacy kit keeps independent cleanup status and native completion diagnostics', windows, () => {
  const data = { executable: process.execPath, arguments: ['-e', 'process.exit(23)'] };
  const result = spawnSync('powershell.exe', [...powershellArgs, '-Request',
    Buffer.from(JSON.stringify(data)).toString('base64')], { encoding: 'utf8', timeout: 25000 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /^NAVI_JOB_CHILD_EXIT_CODE 23\r?$/m);
  const events = result.stderr.split(/\r?\n/).filter(line => line.startsWith('NAVI_JOB_DIAGNOSTIC '))
    .map(line => JSON.parse(line.slice('NAVI_JOB_DIAGNOSTIC '.length)));
  assert.ok(events.some(event => event.returned && event.message === 4 && event.win32_error === 0));
  assert.doesNotMatch(result.stderr, /NAVI_JOB_CLEANUP_PASS/);
});

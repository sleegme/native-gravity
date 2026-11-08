import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { test } from 'node:test';
import {
  argonBreakerBlocksSlug,
  argonQuotaBreakerState,
  argonQuotaNotice,
  formatDurationKo,
  invoke,
  listInstalledModels,
  parseQuotaResetSeconds,
  realAgyRefusalUnderNodeTest,
  resetArgonQuotaBreaker,
  tripArgonQuotaBreaker,
} from '../scripts/runner.mjs';
import { ZenReviewPendingError, nativeZen } from '../scripts/ntg-vnext.mjs';

// Stage 0 (NTG subagent redesign §3/§4): live model tests are opt-in, the
// runner refuses the ambient agy under `node --test`, role children run with
// SKIP_LIVE_TESTS=1, and an exhausted Argon pool trips a run-scoped breaker.

const INSTALLED = [
  { slug: 'gemini-4-argon-high', description: 'Gemini 4 Argon (High)' },
  { slug: 'gemini-4-argon-medium', description: 'Gemini 4 Argon (Medium)' },
  { slug: 'gemini-3.8-flash-high', description: 'Gemini 3.8 Flash (High)' },
  { slug: 'claude-opus-5-5-high', description: 'Claude Opus 5.5 (High)' },
];

/** Real tab/newline `agy models` surface for the two zen policy models. */
const ZEN_SURFACE = 'claude-opus-5-5-high\tClaude Opus 5.5 (High)\ngemini-4-argon-high\tGemini 4 Argon (High)\n';

function withEnv(t, patch) {
  const saved = {};
  for (const [key, value] of Object.entries(patch)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

/**
 * Mock agy: `models` lists INSTALLED; model calls append the slug to a calls
 * file, capture SKIP_LIVE_TESTS from their env, fail with a quota error for
 * the configured slugs, and otherwise print a SUCCESS envelope.
 */
function mockAgy(t, { quotaSlugs = [], quotaStderr = '' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ntg-live-guard-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const agy = join(dir, 'agy');
  const callsFile = join(dir, 'calls.txt');
  const envFile = join(dir, 'env.json');
  writeFileSync(agy, `#!/usr/bin/env node
const { appendFileSync, writeFileSync } = require('node:fs');
const argv = process.argv.slice(2);
if (argv[0] === 'models') {
  appendFileSync(${JSON.stringify(callsFile)}, 'models\\n');
  process.stdout.write(${JSON.stringify(`${INSTALLED.map(m => `${m.slug}\t${m.description}`).join('\n')}\n`)});
  process.exit(0);
}
const slug = argv[argv.indexOf('--model') + 1];
appendFileSync(${JSON.stringify(callsFile)}, slug + '\\n');
writeFileSync(${JSON.stringify(envFile)}, JSON.stringify({ skip_live_tests: process.env.SKIP_LIVE_TESTS ?? null }));
if (${JSON.stringify(quotaSlugs)}.includes(slug)) {
  process.stderr.write(${JSON.stringify(quotaStderr)});
  process.exit(3);
}
process.stdout.write(JSON.stringify({ status: 'SUCCESS', response: '{"status":"READY"}' }));
`, { mode: 0o755 });
  return {
    agy,
    calls: () => (exists0(callsFile) ? readFileSync(callsFile, 'utf8').split('\n').filter(Boolean) : []),
    env: () => JSON.parse(readFileSync(envFile, 'utf8')),
  };
}

function exists0(path) {
  try { readFileSync(path); return true; } catch { return false; }
}

test('realAgyRefusalUnderNodeTest allows everything outside node --test and every deliberate path', () => {
  const saved = ['NODE_TEST_CONTEXT', 'NTG_LIVE_TESTS', 'AGY_PATH'].map(key => process.env[key]);
  try {
    delete process.env.NODE_TEST_CONTEXT;
    delete process.env.NTG_LIVE_TESTS;
    delete process.env.AGY_PATH;
    assert.equal(realAgyRefusalUnderNodeTest(), null);

    process.env.NODE_TEST_CONTEXT = 'child-v8';
    const refusal = realAgyRefusalUnderNodeTest();
    assert.equal(refusal.error, 'AGY_REFUSED_UNDER_NODE_TEST');
    assert.match(refusal.message, /NODE_TEST_CONTEXT/);
    assert.match(refusal.message, /NTG_LIVE_TESTS=1/);

    process.env.NTG_LIVE_TESTS = '1';
    assert.equal(realAgyRefusalUnderNodeTest(), null);
    delete process.env.NTG_LIVE_TESTS;

    assert.equal(realAgyRefusalUnderNodeTest('/mock/agy'), null);
    process.env.AGY_PATH = '/mock/agy';
    assert.equal(realAgyRefusalUnderNodeTest(), null);
  } finally {
    ['NODE_TEST_CONTEXT', 'NTG_LIVE_TESTS', 'AGY_PATH'].forEach((key, index) => {
      if (saved[index] === undefined) delete process.env[key];
      else process.env[key] = saved[index];
    });
  }
});

test('invoke refuses the ambient agy binary under node --test without a spawn', async t => {
  const mock = mockAgy(t);
  withEnv(t, { NODE_TEST_CONTEXT: 'child-v8', NTG_LIVE_TESTS: undefined, AGY_PATH: undefined });
  const res = await invoke('piledriver', { task: 'TASK_MARKER' }, { installedModels: INSTALLED });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'AGY_REFUSED_UNDER_NODE_TEST');
  assert.equal(res.role, 'piledriver');
  assert.match(res.message, /refusing to spawn/);
  assert.deepEqual(mock.calls(), []);
});

test('listInstalledModels refuses the ambient agy under node --test; an explicit mock works', t => {
  const mock = mockAgy(t);
  withEnv(t, { NODE_TEST_CONTEXT: 'child-v8', NTG_LIVE_TESTS: undefined, AGY_PATH: undefined });
  assert.throws(() => listInstalledModels(), /refusing to spawn the ambient agy binary/);

  const models = listInstalledModels({ agyPath: mock.agy });
  assert.equal(models.length, INSTALLED.length);
  assert.equal(models[0].slug, 'gemini-4-argon-high');
  assert.deepEqual(mock.calls(), ['models']);
});

test('NTG_LIVE_TESTS=1 or an explicit AGY_PATH marks the spawn deliberate under node --test', async t => {
  const mock = mockAgy(t);
  withEnv(t, { NODE_TEST_CONTEXT: 'child-v8', NTG_LIVE_TESTS: '1', AGY_PATH: undefined });
  const optedIn = await invoke('piledriver', { task: 'TASK_MARKER' }, { agyPath: mock.agy, installedModels: INSTALLED });
  assert.equal(optedIn.ok, true, JSON.stringify(optedIn));
  assert.deepEqual(mock.calls(), ['gemini-4-argon-high']);

  withEnv(t, { NODE_TEST_CONTEXT: 'child-v8', NTG_LIVE_TESTS: undefined, AGY_PATH: mock.agy });
  const viaEnv = await invoke('piledriver', { task: 'TASK_MARKER' }, { installedModels: INSTALLED });
  assert.equal(viaEnv.ok, true, JSON.stringify(viaEnv));
  assert.deepEqual(mock.calls(), ['gemini-4-argon-high', 'gemini-4-argon-high']);
});

test('role child env carries SKIP_LIVE_TESTS=1 unless the run opts into live tests', async t => {
  const mock = mockAgy(t);
  const opts = { agyPath: mock.agy, installedModels: INSTALLED };

  withEnv(t, { NODE_TEST_CONTEXT: undefined, NTG_LIVE_TESTS: undefined, SKIP_LIVE_TESTS: undefined });
  const enforced = await invoke('piledriver', { task: 'TASK_MARKER' }, opts);
  assert.equal(enforced.ok, true, JSON.stringify(enforced));
  assert.equal(mock.env().skip_live_tests, '1');

  // An explicit caller value is overridden: enforcement is the Stage 0 contract.
  const overridden = await invoke('piledriver', { task: 'TASK_MARKER' }, { ...opts, env: { SKIP_LIVE_TESTS: '0' } });
  assert.equal(overridden.ok, true, JSON.stringify(overridden));
  assert.equal(mock.env().skip_live_tests, '1');

  withEnv(t, { NTG_LIVE_TESTS: '1', SKIP_LIVE_TESTS: undefined });
  const optedIn = await invoke('piledriver', { task: 'TASK_MARKER' }, opts);
  assert.equal(optedIn.ok, true, JSON.stringify(optedIn));
  assert.equal(mock.env().skip_live_tests, null);
});

test('parseQuotaResetSeconds and formatDurationKo parse agy reset suffixes', () => {
  assert.equal(parseQuotaResetSeconds('Individual quota reached for gemini-4-argon-high. Resets in 152h49m19s'), 550159);
  assert.equal(parseQuotaResetSeconds('Resets in 2h30m'), 9000);
  assert.equal(parseQuotaResetSeconds('Resets in 45s'), 45);
  assert.equal(parseQuotaResetSeconds('no reset information'), null);
  assert.equal(parseQuotaResetSeconds('Resets in '), null);

  assert.equal(formatDurationKo(9000), '2시간 30분');
  assert.equal(formatDurationKo(550159), '6일 8시간 49분');
  assert.equal(formatDurationKo(3600), '1시간');
  assert.equal(formatDurationKo(45), '45초');
  assert.equal(formatDurationKo(null), '알 수 없는 시간');
});

test('an Argon quota failure trips the breaker; later Argon seats fail fast, Flash continues', async t => {
  t.after(() => resetArgonQuotaBreaker());
  resetArgonQuotaBreaker();
  const mock = mockAgy(t, {
    quotaSlugs: ['gemini-4-argon-high'],
    quotaStderr: 'AGY_ERROR: Individual quota reached for gemini-4-argon-high. Resets in 2h30m\n',
  });
  const opts = { agyPath: mock.agy, installedModels: INSTALLED };

  const failed = await invoke('piledriver', { task: 'TASK_MARKER' }, opts);
  assert.equal(failed.ok, false);
  assert.equal(failed.error, 'ARGON_QUOTA_EXHAUSTED');
  assert.equal(failed.role, 'piledriver');
  assert.equal(failed.exitCode, 3);
  assert.equal(failed.resets_in_seconds, 9000);

  const state = argonQuotaBreakerState();
  assert.equal(state.tripped, true);
  assert.equal(state.seat, 'piledriver');
  assert.equal(state.reset_seconds, 9000);
  assert.ok(state.tripped_at);
  assert.equal(argonBreakerBlocksSlug('gemini-4-argon-medium'), true);
  assert.equal(argonBreakerBlocksSlug('gemini-3.8-flash-high'), false);
  assert.equal(
    argonQuotaNotice(state),
    'ntg: 고급 모델(Argon) 한도 소진 — piledriver 호출이 막혔습니다(복구까지 약 2시간 30분 남음). 이 실행에서는 Argon 모델을 더 시도하지 않습니다.'
  );

  // Second Argon seat: refused without another provider call.
  const skipped = await invoke('piledriver', { task: 'TASK_MARKER' }, opts);
  assert.equal(skipped.ok, false);
  assert.equal(skipped.error, 'ARGON_QUOTA_EXHAUSTED');
  assert.equal(skipped.skipped, true);
  assert.deepEqual(mock.calls(), ['gemini-4-argon-high']);

  // A tripped breaker is sticky: tripping again never resets or re-announces.
  tripArgonQuotaBreaker({ seat: 'navi', slug: 'gemini-4-argon-medium', text: 'Resets in 1h0m0s' });
  assert.equal(argonQuotaBreakerState().seat, 'piledriver');
  assert.equal(argonQuotaBreakerState().reset_seconds, 9000);

  // Flash seats are unaffected by the Argon breaker.
  const flash = await invoke('bulldozer', { task: 'TASK_MARKER' }, opts);
  assert.equal(flash.ok, true, JSON.stringify(flash));
  assert.deepEqual(mock.calls(), ['gemini-4-argon-high', 'gemini-3.8-flash-high']);
});

test('zen stops review-pending when the Argon fallback pool is also exhausted', t => {
  t.after(() => resetArgonQuotaBreaker());
  resetArgonQuotaBreaker();
  const dir = mkdtempSync(join(tmpdir(), 'ntg-zen-pending-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const agy = join(dir, 'agy');
  const callsFile = join(dir, 'calls.txt');
  writeFileSync(agy, `#!/usr/bin/env node
const { appendFileSync } = require('node:fs');
const argv = process.argv.slice(2);
if (argv[0] === 'models') {
  process.stdout.write(${JSON.stringify(ZEN_SURFACE)});
  process.exit(0);
}
const slug = argv[argv.indexOf('--model') + 1];
appendFileSync(${JSON.stringify(callsFile)}, slug + '\\n');
if (slug === 'claude-opus-5-5-high') {
  process.stderr.write('AGY_ERROR: {"status":"RESOURCE_EXHAUSTED","error_code":429}\\n');
  process.exit(3);
}
process.stderr.write('AGY_ERROR: Individual quota reached for gemini-4-argon-high. Resets in 5h0m0s\\n');
process.exit(3);
`, { mode: 0o755 });
  withEnv(t, { NTG_ZEN_MODEL: undefined, AGY_PATH: undefined, NTG_LIVE_TESTS: undefined });

  assert.throws(() => nativeZen({}, { agyPath: agy }), err =>
    err instanceof ZenReviewPendingError
    && err.code === 'ZEN_REVIEW_PENDING'
    && err.reset_seconds === 18000
    && /review/.test(err.message));
  assert.deepEqual(readFileSync(callsFile, 'utf8').split('\n').filter(Boolean),
    ['claude-opus-5-5-high', 'gemini-4-argon-high']);
  assert.equal(argonQuotaBreakerState().seat, 'zen');
});

test('a tripped Argon breaker skips the zen fallback call entirely', t => {
  t.after(() => resetArgonQuotaBreaker());
  tripArgonQuotaBreaker({ seat: 'piledriver', slug: 'gemini-4-argon-high', text: 'Resets in 1h0m0s' });
  const dir = mkdtempSync(join(tmpdir(), 'ntg-zen-skip-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const agy = join(dir, 'agy');
  const callsFile = join(dir, 'calls.txt');
  writeFileSync(agy, `#!/usr/bin/env node
const { appendFileSync } = require('node:fs');
const argv = process.argv.slice(2);
if (argv[0] === 'models') {
  process.stdout.write(${JSON.stringify(ZEN_SURFACE)});
  process.exit(0);
}
const slug = argv[argv.indexOf('--model') + 1];
appendFileSync(${JSON.stringify(callsFile)}, slug + '\\n');
if (slug === 'claude-opus-5-5-high') {
  process.stderr.write('AGY_ERROR: {"status":"RESOURCE_EXHAUSTED","error_code":429}\\n');
  process.exit(3);
}
process.exit(0);
`, { mode: 0o755 });
  withEnv(t, { NTG_ZEN_MODEL: undefined, AGY_PATH: undefined, NTG_LIVE_TESTS: undefined });

  assert.throws(() => nativeZen({}, { agyPath: agy }), ZenReviewPendingError);
  // The Argon fallback was never spawned: only the exhausted Opus attempt.
  assert.deepEqual(readFileSync(callsFile, 'utf8').split('\n').filter(Boolean), ['claude-opus-5-5-high']);
});

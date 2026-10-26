import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createEventLog, makeEvent, serializeEvent } from '../scripts/events.mjs';

test('makeEvent drops unknown fields, end events carry status and duration_ms, start events do not', () => {
  // Start event: start events do not carry status or duration_ms
  const startEv = makeEvent({
    role: 'bobcat',
    milestone: 'm1',
    event: 'start',
    status: 'SHOULD_BE_DROPPED',
    durationMs: 999,
    unknownField: 'dropped',
    extraNumber: 42,
  });

  assert.equal(startEv.role, 'bobcat');
  assert.equal(startEv.milestone, 'm1');
  assert.equal(startEv.event, 'start');
  assert.ok(typeof startEv.ts === 'string');
  assert.equal('status' in startEv, false);
  assert.equal('duration_ms' in startEv, false);
  assert.equal('unknownField' in startEv, false);
  assert.equal('extraNumber' in startEv, false);
  assert.deepEqual(Object.keys(startEv).sort(), ['event', 'milestone', 'role', 'ts']);

  // End event: carry status and duration_ms, drop unknown fields
  const endEv = makeEvent({
    role: 'bobcat',
    milestone: 'm1',
    event: 'end',
    status: 'READY',
    durationMs: 150,
    unknownField: 'dropped',
    ts: '2026-10-26T00:00:00.000Z',
  });

  assert.equal(endEv.role, 'bobcat');
  assert.equal(endEv.milestone, 'm1');
  assert.equal(endEv.event, 'end');
  assert.equal(endEv.status, 'READY');
  assert.equal(endEv.duration_ms, 150);
  assert.equal(endEv.ts, '2026-10-26T00:00:00.000Z');
  assert.equal('unknownField' in endEv, false);
  assert.deepEqual(Object.keys(endEv).sort(), ['duration_ms', 'event', 'milestone', 'role', 'status', 'ts']);

  // Delimited end variants (e.g. milestone:end, step_end)
  const milestoneEndEv = makeEvent({
    event: 'milestone:end',
    status: 'DONE',
    duration_ms: 250,
  });
  assert.equal(milestoneEndEv.status, 'DONE');
  assert.equal(milestoneEndEv.duration_ms, 250);

  // Non-end events with 'end' as part of an ordinary word
  const sendEv = makeEvent({
    event: 'send',
    status: 'DONE',
    durationMs: 100,
  });
  assert.equal('status' in sendEv, false);
  assert.equal('duration_ms' in sendEv, false);
});

test('serializeEvent output is a single line ending in exactly one newline', () => {
  const ev = makeEvent({
    role: 'bobcat',
    milestone: 'm1',
    event: 'test',
  });
  const serialized = serializeEvent(ev);

  assert.ok(typeof serialized === 'string');
  assert.ok(serialized.endsWith('\n'));
  assert.ok(!serialized.endsWith('\n\n'));
  const newlineCount = (serialized.match(/\n/g) || []).length;
  assert.equal(newlineCount, 1);
  assert.deepEqual(JSON.parse(serialized.trim()), ev);
});

test('append writes redacted strings: a fixture string containing sk-TESTKEY and /home/someone/path is masked in the file', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'ntg-events-redact-'));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const log = createEventLog({ dir });
  // Fixture string contains sk-TESTKEY (with sufficient tail to match the sk- token pattern) and /home/someone/path
  const fixtureString = 'key: sk-TESTKEY0123456789 and path: /home/someone/path/sub/file.txt';
  assert.ok(fixtureString.includes('sk-TESTKEY'));
  assert.ok(fixtureString.includes('/home/someone/path'));

  const ev = {
    ts: '2026-10-26T00:00:00.000Z',
    role: 'bobcat',
    milestone: 'm1',
    event: 'step',
    detail: fixtureString,
  };

  await log.append(ev);

  const content = readFileSync(join(dir, 'events.jsonl'), 'utf8');
  assert.equal(content.includes('sk-TESTKEY'), false);
  assert.equal(content.includes('/home/someone/path'), false);
  assert.ok(content.includes('<redacted>'));
  assert.ok(content.includes('(local path)'));
});

test('append on a simulated write failure (readonly dir) does not throw and prints a warning containing \'events.jsonl append failed\'', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'ntg-events-ro-'));
  // Create read-only file and make directory read-only to ensure write failure
  const filePath = join(dir, 'events.jsonl');
  writeFileSync(filePath, '', { mode: 0o444 });
  chmodSync(dir, 0o555);

  t.after(() => {
    try { chmodSync(filePath, 0o666); } catch {}
    try { chmodSync(dir, 0o755); } catch {}
    rmSync(dir, { recursive: true, force: true });
  });

  const loggedErrors = [];
  const originalConsoleError = console.error;
  console.error = (...args) => {
    loggedErrors.push(args.join(' '));
  };

  try {
    const log = createEventLog({ dir });
    const ev = makeEvent({ role: 'bobcat', event: 'start' });

    await assert.doesNotReject(async () => {
      await log.append(ev);
    });

    const warningFound = loggedErrors.some((msg) => msg.includes('events.jsonl append failed'));
    assert.ok(warningFound, `Expected warning containing 'events.jsonl append failed', got: ${JSON.stringify(loggedErrors)}`);
  } finally {
    console.error = originalConsoleError;
  }
});

test('sequential appends never interleave: 50 rapid appends produce 50 intact lines', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'ntg-events-interleave-'));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const log = createEventLog({ dir });
  const count = 50;
  const promises = [];

  for (let i = 0; i < count; i++) {
    const ev = makeEvent({
      role: 'bobcat',
      milestone: 'm1',
      event: `step_${i}`,
      ts: `2026-10-26T00:00:${String(i).padStart(2, '0')}.000Z`,
    });
    promises.push(log.append(ev));
  }

  await Promise.all(promises);

  const content = readFileSync(join(dir, 'events.jsonl'), 'utf8');
  const lines = content.trim().split('\n');
  assert.equal(lines.length, count);

  for (let i = 0; i < count; i++) {
    const parsed = JSON.parse(lines[i]);
    assert.equal(parsed.event, `step_${i}`);
  }
});

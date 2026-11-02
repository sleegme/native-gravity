import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_LEDGER,
  DEFAULT_VNEXT_SCRIPT,
  resolveVnextScript,
  runNtgCommand,
} from '../scripts/ntg-command.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const COMMAND_SCRIPT = resolve(HERE, '..', 'scripts', 'ntg-command.mjs');

function createTestHarness() {
  const tempDir = mkdtempSync(join(tmpdir(), 'ntg-cmd-test-'));
  const logFile = join(tempDir, 'stub-invocations.jsonl');
  const stubScript = join(tempDir, 'stub-runner.mjs');

  const stubCode = `import { appendFileSync } from 'node:fs';
import process from 'node:process';

const logFile = process.env.STUB_LOG_FILE;
if (logFile) {
  const entry = JSON.stringify({
    argv: process.argv.slice(2),
    cmd: process.argv[2],
  }) + '\\n';
  appendFileSync(logFile, entry);
}

const cmd = process.argv[2];
if (cmd === 'status' && process.env.STUB_STATUS_EXIT) {
  process.exit(Number(process.env.STUB_STATUS_EXIT));
}
if (cmd === 'run' && process.env.STUB_RUN_EXIT) {
  process.exit(Number(process.env.STUB_RUN_EXIT));
}
if (process.env.STUB_EXIT_CODE) {
  process.exit(Number(process.env.STUB_EXIT_CODE));
}
process.exit(0);
`;
  writeFileSync(stubScript, stubCode, 'utf8');

  function readInvocations() {
    if (!existsSync(logFile)) return [];
    const content = readFileSync(logFile, 'utf8').trim();
    if (!content) return [];
    return content.split('\n').filter(Boolean).map((line) => JSON.parse(line));
  }

  function cleanup() {
    rmSync(tempDir, { recursive: true, force: true });
  }

  return { tempDir, logFile, stubScript, readInvocations, cleanup };
}

test('resolveVnextScript returns default script or respects NTG_VNEXT_SCRIPT', () => {
  const original = process.env.NTG_VNEXT_SCRIPT;
  try {
    delete process.env.NTG_VNEXT_SCRIPT;
    assert.equal(resolveVnextScript(), DEFAULT_VNEXT_SCRIPT);

    process.env.NTG_VNEXT_SCRIPT = '/custom/path/to/vnext.mjs';
    assert.equal(resolveVnextScript(), '/custom/path/to/vnext.mjs');
  } finally {
    if (original !== undefined) {
      process.env.NTG_VNEXT_SCRIPT = original;
    } else {
      delete process.env.NTG_VNEXT_SCRIPT;
    }
  }
});

test('fresh initialization (init): calls init with --plan and --ledger', () => {
  const harness = createTestHarness();
  try {
    const exitCode = runNtgCommand(
      ['init', '--plan', 'custom-plan.json', '--ledger', 'custom-ledger.json'],
      {
        vnextScript: harness.stubScript,
        env: { STUB_LOG_FILE: harness.logFile },
        stdio: 'pipe',
      }
    );
    assert.equal(exitCode, 0);

    const invocations = harness.readInvocations();
    assert.equal(invocations.length, 1);
    assert.deepEqual(invocations[0].argv, [
      'init',
      '--ledger',
      'custom-ledger.json',
      '--plan',
      'custom-plan.json',
    ]);
  } finally {
    harness.cleanup();
  }
});

test('fresh initialization (init): uses default ledger when --ledger is omitted', () => {
  const harness = createTestHarness();
  try {
    const exitCode = runNtgCommand(['init', '--plan', 'plan.json'], {
      vnextScript: harness.stubScript,
      env: { STUB_LOG_FILE: harness.logFile },
      stdio: 'pipe',
    });
    assert.equal(exitCode, 0);

    const invocations = harness.readInvocations();
    assert.equal(invocations.length, 1);
    assert.deepEqual(invocations[0].argv, [
      'init',
      '--ledger',
      DEFAULT_LEDGER,
      '--plan',
      'plan.json',
    ]);
  } finally {
    harness.cleanup();
  }
});

test('init requires --plan argument and exits 1 if omitted', () => {
  const harness = createTestHarness();
  try {
    const exitCode = runNtgCommand(['init', '--ledger', 'my-ledger.json'], {
      vnextScript: harness.stubScript,
      env: { STUB_LOG_FILE: harness.logFile },
      stdio: 'pipe',
    });
    assert.equal(exitCode, 1);

    const invocations = harness.readInvocations();
    assert.equal(invocations.length, 0, 'stub runner should not be invoked');
  } finally {
    harness.cleanup();
  }
});

test('status: invokes status with default or specified ledger', () => {
  const harness = createTestHarness();
  try {
    // Default ledger
    let exitCode = runNtgCommand(['status'], {
      vnextScript: harness.stubScript,
      env: { STUB_LOG_FILE: harness.logFile },
      stdio: 'pipe',
    });
    assert.equal(exitCode, 0);

    // Specified ledger
    exitCode = runNtgCommand(['status', '--ledger', 'custom-ledger.json'], {
      vnextScript: harness.stubScript,
      env: { STUB_LOG_FILE: harness.logFile },
      stdio: 'pipe',
    });
    assert.equal(exitCode, 0);

    const invocations = harness.readInvocations();
    assert.equal(invocations.length, 2);
    assert.deepEqual(invocations[0].argv, ['status', '--ledger', DEFAULT_LEDGER]);
    assert.deepEqual(invocations[1].argv, ['status', '--ledger', 'custom-ledger.json']);
  } finally {
    harness.cleanup();
  }
});

test('run: forwards options and ledger to runner', () => {
  const harness = createTestHarness();
  try {
    const exitCode = runNtgCommand(
      ['run', '--ledger', 'run-ledger.json', '--milestone', 'm1', '--timeout', '120'],
      {
        vnextScript: harness.stubScript,
        env: { STUB_LOG_FILE: harness.logFile },
        stdio: 'pipe',
      }
    );
    assert.equal(exitCode, 0);

    const invocations = harness.readInvocations();
    assert.equal(invocations.length, 1);
    assert.deepEqual(invocations[0].argv, [
      'run',
      '--ledger',
      'run-ledger.json',
      '--milestone',
      'm1',
      '--timeout',
      '120',
    ]);
  } finally {
    harness.cleanup();
  }
});

test('resume: runs status then run --all when status succeeds', () => {
  const harness = createTestHarness();
  try {
    const exitCode = runNtgCommand(['resume', '--ledger', 'resume-ledger.json'], {
      vnextScript: harness.stubScript,
      env: { STUB_LOG_FILE: harness.logFile },
      stdio: 'pipe',
    });
    assert.equal(exitCode, 0);

    const invocations = harness.readInvocations();
    assert.equal(invocations.length, 2);
    assert.deepEqual(invocations[0].argv, ['status', '--ledger', 'resume-ledger.json']);
    assert.deepEqual(invocations[1].argv, ['run', '--ledger', 'resume-ledger.json', '--all']);
  } finally {
    harness.cleanup();
  }
});

test('resume: propagates nonzero status exit (1 and 2) and halts without calling run', () => {
  const harness1 = createTestHarness();
  try {
    const exitCode1 = runNtgCommand(['resume'], {
      vnextScript: harness1.stubScript,
      env: { STUB_LOG_FILE: harness1.logFile, STUB_STATUS_EXIT: '1' },
      stdio: 'pipe',
    });
    assert.equal(exitCode1, 1);

    const invocations1 = harness1.readInvocations();
    assert.equal(invocations1.length, 1);
    assert.equal(invocations1[0].cmd, 'status');
  } finally {
    harness1.cleanup();
  }

  const harness2 = createTestHarness();
  try {
    const exitCode2 = runNtgCommand(['resume'], {
      vnextScript: harness2.stubScript,
      env: { STUB_LOG_FILE: harness2.logFile, STUB_STATUS_EXIT: '2' },
      stdio: 'pipe',
    });
    assert.equal(exitCode2, 2);

    const invocations2 = harness2.readInvocations();
    assert.equal(invocations2.length, 1);
    assert.equal(invocations2[0].cmd, 'status');
  } finally {
    harness2.cleanup();
  }
});

test('argv / path behavior with spaces preserves exact path elements', () => {
  const harness = createTestHarness();
  try {
    const ledgerWithSpaces = 'dir with spaces/my ledger.json';
    const planWithSpaces = 'another dir with spaces/my plan.json';

    const exitCode = runNtgCommand(
      ['init', '--ledger', ledgerWithSpaces, '--plan', planWithSpaces],
      {
        vnextScript: harness.stubScript,
        env: { STUB_LOG_FILE: harness.logFile },
        stdio: 'pipe',
      }
    );
    assert.equal(exitCode, 0);

    const invocations = harness.readInvocations();
    assert.equal(invocations.length, 1);
    assert.deepEqual(invocations[0].argv, [
      'init',
      '--ledger',
      ledgerWithSpaces,
      '--plan',
      planWithSpaces,
    ]);
    assert.equal(invocations[0].argv[2], ledgerWithSpaces);
    assert.equal(invocations[0].argv[4], planWithSpaces);
  } finally {
    harness.cleanup();
  }
});

test('exit code propagation: runner codes 1 and 2 propagate directly', () => {
  const harness = createTestHarness();
  try {
    let exitCode = runNtgCommand(['status'], {
      vnextScript: harness.stubScript,
      env: { STUB_LOG_FILE: harness.logFile, STUB_EXIT_CODE: '1' },
      stdio: 'pipe',
    });
    assert.equal(exitCode, 1);

    exitCode = runNtgCommand(['status'], {
      vnextScript: harness.stubScript,
      env: { STUB_LOG_FILE: harness.logFile, STUB_EXIT_CODE: '2' },
      stdio: 'pipe',
    });
    assert.equal(exitCode, 2);
  } finally {
    harness.cleanup();
  }
});

test('no ledger writing: ntg-command does not create or write ledger files directly', () => {
  const harness = createTestHarness();
  try {
    const nonExistentLedger = join(harness.tempDir, 'nested', 'non-existent.json');
    assert.equal(existsSync(nonExistentLedger), false);

    const exitCode = runNtgCommand(
      ['init', '--plan', 'plan.json', '--ledger', nonExistentLedger],
      {
        vnextScript: harness.stubScript,
        env: { STUB_LOG_FILE: harness.logFile },
        stdio: 'pipe',
      }
    );
    assert.equal(exitCode, 0);
    assert.equal(
      existsSync(nonExistentLedger),
      false,
      'ntg-command must never create or write ledger files directly'
    );
  } finally {
    harness.cleanup();
  }
});

test('direct CLI invocation: runs spawnSync on ntg-command.mjs with NTG_VNEXT_SCRIPT', () => {
  const harness = createTestHarness();
  try {
    const res = spawnSync(
      process.execPath,
      [COMMAND_SCRIPT, 'status', '--ledger', 'cli-ledger.json'],
      {
        env: {
          ...process.env,
          NTG_VNEXT_SCRIPT: harness.stubScript,
          STUB_LOG_FILE: harness.logFile,
        },
        encoding: 'utf8',
      }
    );
    assert.equal(res.status, 0, res.stderr);

    const invocations = harness.readInvocations();
    assert.equal(invocations.length, 1);
    assert.deepEqual(invocations[0].argv, ['status', '--ledger', 'cli-ledger.json']);

    // Direct invocation with unknown command exits 1
    const badRes = spawnSync(process.execPath, [COMMAND_SCRIPT, 'invalid-cmd'], {
      encoding: 'utf8',
    });
    assert.equal(badRes.status, 1);
    assert.match(badRes.stderr, /Unknown command: invalid-cmd/);
  } finally {
    harness.cleanup();
  }
});

test('help and invalid option handling', () => {
  // Help flag returns 0
  const helpCode = runNtgCommand(['--help'], { stdio: 'pipe' });
  assert.equal(helpCode, 0);

  // Missing arguments returns 1
  const emptyCode = runNtgCommand([], { stdio: 'pipe' });
  assert.equal(emptyCode, 1);

  // Incomplete options return 1
  const badLedgerCode = runNtgCommand(['status', '--ledger'], { stdio: 'pipe' });
  assert.equal(badLedgerCode, 1);

  const badPlanCode = runNtgCommand(['init', '--plan'], { stdio: 'pipe' });
  assert.equal(badPlanCode, 1);
});

import { resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import {
  buildLaunchSpec,
  defaultCommandExists,
  defaultLauncher,
  detectGraphTarget,
  isWsl,
  launchGraphPane,
  LINUX_TERMINALS,
} from '../scripts/graph-pane.mjs';
import { runNtgCommand } from '../scripts/ntg-command.mjs';

function createHarness() {
  const tempDir = mkdtempSync(join(tmpdir(), 'graph-pane-test-'));
  const stubDag = join(tempDir, 'stub-dag.mjs');
  const logFile = join(tempDir, 'stub-dag.log');

  const stubCode = `import { appendFileSync } from 'node:fs';
import process from 'node:process';
const entry = JSON.stringify({ argv: process.argv.slice(2) }) + '\\n';
appendFileSync(${JSON.stringify(logFile)}, entry);
console.log('STUB_DAG_OUTPUT');
process.exit(0);
`;
  writeFileSync(stubDag, stubCode, 'utf8');

  function cleanup() {
    rmSync(tempDir, { recursive: true, force: true });
  }

  return { tempDir, stubDag, logFile, cleanup };
}

test('detectGraphTarget: herdr via env.HERDR, env.HERDR_PANE_ID, or active session', () => {
  // via HERDR env
  assert.equal(
    detectGraphTarget({
      env: { HERDR: '1' },
      platform: 'linux',
      commandExists: () => false,
    }),
    'herdr'
  );

  // via HERDR_PANE_ID
  assert.equal(
    detectGraphTarget({
      env: { HERDR_PANE_ID: 'w1:p1' },
      platform: 'linux',
      commandExists: () => false,
    }),
    'herdr'
  );

  // via herdr on PATH with active session
  assert.equal(
    detectGraphTarget({
      env: {},
      platform: 'linux',
      commandExists: (cmd) => cmd === 'herdr',
      hasHerdrSession: () => true,
    }),
    'herdr'
  );

  // herdr on PATH but NO active session -> falls through
  assert.notEqual(
    detectGraphTarget({
      env: {},
      platform: 'linux',
      commandExists: (cmd) => cmd === 'herdr',
      hasHerdrSession: () => false,
    }),
    'herdr'
  );
});

test('launchGraphPane: herdr split branch with injectable launcher', () => {
  const launched = [];
  let unrefCalled = false;

  const fakeChild = {
    unref() {
      unrefCalled = true;
    },
    on() {},
  };

  const res = launchGraphPane({
    env: { HERDR: '1' },
    platform: 'linux',
    ledger: '.ntg/test-ledger.json',
    cwd: '/workspace',
    launcher(command, args, opts) {
      launched.push({ command, args, opts });
      return fakeChild;
    },
  });

  assert.equal(res.ok, true);
  assert.equal(res.target, 'herdr');
  assert.equal(unrefCalled, true);
  assert.equal(launched.length, 1);
  assert.equal(launched[0].command, 'herdr');
  assert.deepEqual(launched[0].args, [
    'pane',
    'split',
    '--current',
    '--direction',
    'right',
    '--no-focus',
  ]);
  assert.equal(launched[0].opts.detached, true);
  assert.equal(launched[0].opts.stdio, 'ignore');
});

test('launchGraphPane: herdr split with active session runs live command in new pane', () => {
  const launched = [];
  const fakeChild = { unref() {}, on() {} };

  const res = launchGraphPane({
    env: {},
    platform: 'linux',
    ledger: '.ntg/test-ledger.json',
    commandExists: (cmd) => cmd === 'herdr',
    hasHerdrSession: () => true,
    spawnSync: () => ({
      status: 0,
      stdout: JSON.stringify({ result: { pane: { pane_id: 'w1:p99' } } }),
    }),
    launcher(command, args, opts) {
      launched.push({ command, args, opts });
      return fakeChild;
    },
  });

  assert.equal(res.ok, true);
  assert.equal(res.target, 'herdr');
  assert.equal(launched.length, 1);
  assert.equal(launched[0].command, 'herdr');
  assert.deepEqual(launched[0].args, [
    'pane',
    'run',
    'w1:p99',
    'ntg-dag',
    '--watch',
    '--ledger',
    '.ntg/test-ledger.json',
  ]);
});

test('launchGraphPane: tmux split branch ($TMUX -> tmux split-window -h)', () => {
  const launched = [];
  let unrefCalled = false;
  const fakeChild = {
    unref() {
      unrefCalled = true;
    },
    on() {},
  };

  const res = launchGraphPane({
    env: { TMUX: '/tmp/tmux-1000/default,1234,0' },
    platform: 'linux',
    ledger: '.ntg/tmux-ledger.json',
    launcher(command, args, opts) {
      launched.push({ command, args, opts });
      return fakeChild;
    },
  });

  assert.equal(res.ok, true);
  assert.equal(res.target, 'tmux');
  assert.equal(unrefCalled, true);
  assert.equal(launched.length, 1);
  assert.equal(launched[0].command, 'tmux');
  assert.deepEqual(launched[0].args, [
    'split-window',
    '-h',
    'ntg-dag',
    '--watch',
    '--ledger',
    '.ntg/tmux-ledger.json',
  ]);
  assert.equal(launched[0].opts.detached, true);
  assert.equal(launched[0].opts.stdio, 'ignore');
});

test('launchGraphPane: WSL wt.exe branch (detected via WSL_DISTRO_NAME)', () => {
  const launched = [];
  let unrefCalled = false;
  const fakeChild = {
    unref() {
      unrefCalled = true;
    },
    on() {},
  };

  const res = launchGraphPane({
    env: { WSL_DISTRO_NAME: 'Ubuntu-24.04' },
    platform: 'linux',
    cwd: '/mnt/c/Users/repo',
    ledger: '.ntg/ledger.json',
    commandExists: (cmd) => cmd === 'wt.exe',
    launcher(command, args, opts) {
      launched.push({ command, args, opts });
      return fakeChild;
    },
  });

  assert.equal(res.ok, true);
  assert.equal(res.target, 'wsl-wt');
  assert.equal(unrefCalled, true);
  assert.equal(launched.length, 1);
  assert.equal(launched[0].command, 'wt.exe');
  assert.deepEqual(launched[0].args, [
    '-w',
    '0',
    'nt',
    'wsl.exe',
    '-d',
    'Ubuntu-24.04',
    '--cd',
    '/mnt/c/Users/repo',
    '--',
    'ntg-dag',
    '--watch',
    '--ledger',
    '.ntg/ledger.json',
  ]);
  assert.equal(launched[0].opts.detached, true);
  assert.equal(launched[0].opts.stdio, 'ignore');
});

test('launchGraphPane: WSL wt.exe branch (detected via /proc/version contains microsoft)', () => {
  const launched = [];
  const fakeChild = { unref() {}, on() {} };

  const res = launchGraphPane({
    env: {},
    platform: 'linux',
    cwd: '/home/user/repo',
    ledger: '.ntg/ledger.json',
    readProcVersion: () => 'Linux version 5.15.153.1-microsoft-standard-WSL2 (gcc version 11.2.0)',
    commandExists: (cmd) => cmd === 'wt.exe',
    launcher(command, args, opts) {
      launched.push({ command, args, opts });
      return fakeChild;
    },
  });

  assert.equal(res.ok, true);
  assert.equal(res.target, 'wsl-wt');
  assert.equal(launched.length, 1);
  assert.equal(launched[0].command, 'wt.exe');
  assert.deepEqual(launched[0].args, [
    '-w',
    '0',
    'nt',
    'wsl.exe',
    '--cd',
    '/home/user/repo',
    '--',
    'ntg-dag',
    '--watch',
    '--ledger',
    '.ntg/ledger.json',
  ]);
});

test('launchGraphPane: WSL cmd.exe fallback branch (wt.exe absent, cmd.exe present)', () => {
  const launched = [];
  const fakeChild = { unref() {}, on() {} };

  const res = launchGraphPane({
    env: { WSL_DISTRO_NAME: 'Debian' },
    platform: 'linux',
    cwd: '/mnt/d/work',
    ledger: '.ntg/ledger.json',
    commandExists: (cmd) => cmd === 'cmd.exe',
    launcher(command, args, opts) {
      launched.push({ command, args, opts });
      return fakeChild;
    },
  });

  assert.equal(res.ok, true);
  assert.equal(res.target, 'wsl-cmd');
  assert.equal(launched.length, 1);
  assert.equal(launched[0].command, 'cmd.exe');
  assert.deepEqual(launched[0].args, [
    '/c',
    'start',
    'wsl.exe',
    '-d',
    'Debian',
    '--cd',
    '/mnt/d/work',
    '--',
    'ntg-dag',
    '--watch',
    '--ledger',
    '.ntg/ledger.json',
  ]);
});

test('launchGraphPane: Windows wt branch', () => {
  const launched = [];
  const fakeChild = { unref() {}, on() {} };

  const res = launchGraphPane({
    env: {},
    platform: 'win32',
    ledger: '.ntg/win-ledger.json',
    commandExists: (cmd) => cmd === 'wt',
    launcher(command, args, opts) {
      launched.push({ command, args, opts });
      return fakeChild;
    },
  });

  assert.equal(res.ok, true);
  assert.equal(res.target, 'windows-wt');
  assert.equal(launched.length, 1);
  assert.equal(launched[0].command, 'wt');
  assert.deepEqual(launched[0].args, [
    'ntg-dag',
    '--watch',
    '--ledger',
    '.ntg/win-ledger.json',
  ]);
});

test('launchGraphPane: Windows cmd.exe fallback branch (wt absent)', () => {
  const launched = [];
  const fakeChild = { unref() {}, on() {} };

  const res = launchGraphPane({
    env: {},
    platform: 'win32',
    ledger: '.ntg/win-ledger.json',
    commandExists: (cmd) => cmd === 'cmd.exe',
    launcher(command, args, opts) {
      launched.push({ command, args, opts });
      return fakeChild;
    },
  });

  assert.equal(res.ok, true);
  assert.equal(res.target, 'windows-cmd');
  assert.equal(launched.length, 1);
  assert.equal(launched[0].command, 'cmd.exe');
  assert.deepEqual(launched[0].args, [
    '/c',
    'start',
    'ntg-dag',
    '--watch',
    '--ledger',
    '.ntg/win-ledger.json',
  ]);
});

test('launchGraphPane: macOS osascript branch', () => {
  const launched = [];
  const fakeChild = { unref() {}, on() {} };

  const res = launchGraphPane({
    env: {},
    platform: 'darwin',
    ledger: '.ntg/mac-ledger.json',
    commandExists: (cmd) => cmd === 'osascript',
    launcher(command, args, opts) {
      launched.push({ command, args, opts });
      return fakeChild;
    },
  });

  assert.equal(res.ok, true);
  assert.equal(res.target, 'macos-osascript');
  assert.equal(launched.length, 1);
  assert.equal(launched[0].command, 'osascript');
  assert.deepEqual(launched[0].args, [
    '-e',
    'tell application "Terminal" to do script "ntg-dag --watch --ledger .ntg/mac-ledger.json"',
  ]);
});

test('launchGraphPane: macOS open -a Terminal fallback branch (osascript absent)', () => {
  const launched = [];
  const fakeChild = { unref() {}, on() {} };

  const res = launchGraphPane({
    env: {},
    platform: 'darwin',
    ledger: '.ntg/mac-ledger.json',
    commandExists: (cmd) => cmd === 'open',
    launcher(command, args, opts) {
      launched.push({ command, args, opts });
      return fakeChild;
    },
  });

  assert.equal(res.ok, true);
  assert.equal(res.target, 'macos-terminal');
  assert.equal(launched.length, 1);
  assert.equal(launched[0].command, 'open');
  assert.deepEqual(launched[0].args, [
    '-a',
    'Terminal',
    'ntg-dag',
    '--watch',
    '--ledger',
    '.ntg/mac-ledger.json',
  ]);
});

test('launchGraphPane: Linux terminal detection order', () => {
  const terminals = ['x-terminal-emulator', 'gnome-terminal', 'konsole', 'xterm'];

  for (let i = 0; i < terminals.length; i++) {
    const term = terminals[i];
    const available = new Set([term]);
    const launched = [];
    const fakeChild = { unref() {}, on() {} };

    const res = launchGraphPane({
      env: {},
      platform: 'linux',
      ledger: '.ntg/linux-ledger.json',
      commandExists: (cmd) => available.has(cmd),
      launcher(command, args, opts) {
        launched.push({ command, args, opts });
        return fakeChild;
      },
    });

    assert.equal(res.ok, true);
    assert.equal(res.target, `linux:${term}`);
    assert.equal(launched.length, 1);
    assert.equal(launched[0].command, term);
    const expectedArgs =
      term === 'gnome-terminal'
        ? ['--', 'ntg-dag', '--watch', '--ledger', '.ntg/linux-ledger.json']
        : ['-e', 'ntg-dag', '--watch', '--ledger', '.ntg/linux-ledger.json'];
    assert.deepEqual(launched[0].args, expectedArgs);
  }
});

test('launchGraphPane: fallback when none works returns ok: false, fallback: true', () => {
  const res = launchGraphPane({
    env: {},
    platform: 'linux',
    commandExists: () => false,
  });

  assert.equal(res.ok, false);
  assert.equal(res.fallback, true);
});

test('order of precedence: herdr > tmux > WSL > Linux', () => {
  // herdr beats tmux
  assert.equal(
    detectGraphTarget({
      env: { HERDR: '1', TMUX: '1' },
      platform: 'linux',
      commandExists: () => true,
    }),
    'herdr'
  );

  // tmux beats WSL
  assert.equal(
    detectGraphTarget({
      env: { TMUX: '1', WSL_DISTRO_NAME: 'Ubuntu' },
      platform: 'linux',
      commandExists: () => true,
    }),
    'tmux'
  );

  // WSL beats Linux
  assert.equal(
    detectGraphTarget({
      env: { WSL_DISTRO_NAME: 'Ubuntu' },
      platform: 'linux',
      commandExists: (cmd) => cmd === 'wt.exe' || cmd === 'x-terminal-emulator',
    }),
    'wsl-wt'
  );
});

test('runNtgCommand: fallback prints graph once and writes hint with path', () => {
  const harness = createHarness();
  try {
    let stdoutText = '';
    const exitCode = runNtgCommand(['graph', '--ledger', 'my-ledger.json'], {
      dagScript: harness.stubDag,
      isTTY: true,
      env: {},
      platform: 'linux',
      commandExists: () => false,
      stdout: {
        write(chunk) {
          stdoutText += chunk;
        },
      },
    });

    assert.equal(exitCode, 0);
    assert.match(stdoutText, /live view: ntg-dag --watch --ledger my-ledger\.json/);
  } finally {
    harness.cleanup();
  }
});

test('runNtgCommand: non-TTY environment prints once without opening pane or hint', () => {
  const harness = createHarness();
  let launcherCalled = false;
  try {
    let stdoutText = '';
    const exitCode = runNtgCommand(['graph', '--ledger', 'my-ledger.json'], {
      dagScript: harness.stubDag,
      isTTY: false,
      launcher() {
        launcherCalled = true;
        return { unref() {} };
      },
      stdout: {
        write(chunk) {
          stdoutText += chunk;
        },
      },
    });

    assert.equal(exitCode, 0);
    assert.equal(launcherCalled, false);
    assert.doesNotMatch(stdoutText, /live view: ntg-dag/);
  } finally {
    harness.cleanup();
  }
});

test('runNtgCommand: --once flag in TTY prints once without opening pane or hint', () => {
  const harness = createHarness();
  let launcherCalled = false;
  try {
    let stdoutText = '';
    const exitCode = runNtgCommand(
      ['graph', '--ledger', 'my-ledger.json', '--once'],
      {
        dagScript: harness.stubDag,
        isTTY: true,
        env: { HERDR: '1' },
        launcher() {
          launcherCalled = true;
          return { unref() {} };
        },
        stdout: {
          write(chunk) {
            stdoutText += chunk;
          },
        },
      }
    );

    assert.equal(exitCode, 0);
    assert.equal(launcherCalled, false);
    assert.doesNotMatch(stdoutText, /live view: ntg-dag/);
  } finally {
    harness.cleanup();
  }
});

test('runNtgCommand: successful launch returns 0 without blocking', () => {
  const harness = createHarness();
  let launcherCalled = false;
  let unrefCalled = false;
  try {
    const exitCode = runNtgCommand(['graph', '--ledger', 'my-ledger.json'], {
      dagScript: harness.stubDag,
      isTTY: true,
      env: { TMUX: '1' },
      launcher(command, args, opts) {
        launcherCalled = true;
        assert.equal(command, 'tmux');
        assert.deepEqual(args, [
          'split-window',
          '-h',
          process.execPath,
          harness.stubDag,
          '--watch',
          '--ledger',
          resolve(process.cwd(), 'my-ledger.json'),
        ]);
        assert.equal(opts.detached, true);
        assert.equal(opts.stdio, 'ignore');
        return {
          unref() {
            unrefCalled = true;
          },
        };
      },
    });

    assert.equal(exitCode, 0);
    assert.equal(launcherCalled, true);
    assert.equal(unrefCalled, true);
  } finally {
    harness.cleanup();
  }
});

test('defaultLauncher: spawns detached process with unref', () => {
  // Use node executable to run a quick no-op detached child
  const child = defaultLauncher(process.execPath, ['-e', 'process.exit(0)']);
  assert.ok(child);
  assert.equal(typeof child.pid, 'number');
});

test('runNtgCommand: --pane opens the side pane even without a TTY (AGY run_command)', () => {
  const harness = createHarness();
  let launched = null;
  try {
    const exitCode = runNtgCommand(['graph', '--pane'], {
      dagScript: harness.stubDag,
      isTTY: false,
      env: { TMUX: '1' },
      launcher(command, args) {
        launched = { command, args };
        return { unref() {} };
      },
    });
    assert.equal(exitCode, 0);
    assert.equal(launched?.command, 'tmux');
    assert.equal(launched.args.includes('--pane'), false);
  } finally {
    harness.cleanup();
  }
});

#!/usr/bin/env node
/**
 * graph-pane.mjs — Live DAG side-pane / terminal window launcher.
 *
 * Detects the user's terminal environment and launches `ntg-dag --watch --ledger <path>`
 * beside the user in order of precedence:
 *   1. herdr split (HERDR env / herdr on PATH with active session)
 *   2. tmux split ($TMUX -> tmux split-window -h)
 *   3. WSL (WSL_DISTRO_NAME set or /proc/version contains "microsoft")
 *      -> wt.exe, fallback cmd.exe
 *   4. Windows (win32) -> wt, fallback cmd /c start
 *   5. macOS (darwin) -> osascript / open -a Terminal
 *   6. Linux -> x-terminal-emulator / gnome-terminal / konsole / xterm
 *   7. Fallback -> print-once with hint
 *
 * All live launches spawn detached processes with ignored stdio and call child.unref(),
 * never blocking the caller.
 */

import { spawn, spawnSync } from 'node:child_process';
import { accessSync, constants as fsConstants, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

export const LINUX_TERMINALS = [
  'x-terminal-emulator',
  'gnome-terminal',
  'konsole',
  'xterm',
];

export function defaultReadProcVersion() {
  try {
    return readFileSync('/proc/version', 'utf8');
  } catch {
    return '';
  }
}

export function defaultCommandExists(command, env = process.env, platform = process.platform) {
  if (!command) return false;
  if (command.includes('/') || command.includes('\\')) {
    try {
      accessSync(command, fsConstants.X_OK);
      return true;
    } catch {
      return false;
    }
  }
  const pathVal = env.PATH || '';
  const pathExtVal = env.PATHEXT || '.EXE;.CMD;.BAT;.COM';
  const isWin = platform === 'win32';
  const exts = isWin ? pathExtVal.split(';').map((e) => e.toLowerCase()) : [''];
  const dirs = pathVal.split(isWin ? ';' : ':');

  for (const dir of dirs) {
    if (!dir) continue;
    const base = resolve(dir, command);
    try {
      accessSync(base, fsConstants.X_OK);
      return true;
    } catch {}
    if (isWin || command.toLowerCase().endsWith('.exe')) {
      for (const ext of exts) {
        if (!ext) continue;
        try {
          accessSync(base + ext, fsConstants.X_OK);
          return true;
        } catch {}
      }
    }
  }
  return false;
}

export function isWsl(env = process.env, readProcVersion = defaultReadProcVersion) {
  if (env.WSL_DISTRO_NAME) return true;
  const procVersion = typeof readProcVersion === 'function' ? readProcVersion() : '';
  return /microsoft/i.test(procVersion || '');
}

export function defaultHasHerdrSession(spawnSyncFn = spawnSync, env = process.env) {
  try {
    const res = spawnSyncFn('herdr', ['pane', 'current'], {
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (res.status === 0 && res.stdout) {
      const data = JSON.parse(res.stdout);
      return Boolean(data?.result?.pane);
    }
    return false;
  } catch {
    return false;
  }
}

export function detectGraphTarget(options = {}) {
  const env = options.env || process.env;
  const platform = options.platform || process.platform;
  const commandExists = options.commandExists || ((cmd) => defaultCommandExists(cmd, env, platform));
  const readProcVersion = options.readProcVersion || defaultReadProcVersion;
  const spawnSyncFn = options.spawnSync || spawnSync;
  const hasHerdrSession = options.hasHerdrSession || (() => defaultHasHerdrSession(spawnSyncFn, env));

  // 1. herdr split (HERDR env / herdr on PATH with active session)
  const isHerdrEnv = Boolean(env.HERDR || env.HERDR_PANE_ID || env.HERDR_SESSION);
  if (isHerdrEnv || (commandExists('herdr') && hasHerdrSession())) {
    return 'herdr';
  }

  // 2. tmux split ($TMUX)
  if (env.TMUX) {
    return 'tmux';
  }

  // 3. WSL: detected via WSL_DISTRO_NAME or /proc/version contains "microsoft", before Linux
  if (isWsl(env, readProcVersion)) {
    if (commandExists('wt.exe')) {
      return 'wsl-wt';
    }
    if (commandExists('cmd.exe')) {
      return 'wsl-cmd';
    }
    return null;
  }

  // 4. Windows (win32) -> wt, fallback cmd /c start
  if (platform === 'win32') {
    if (commandExists('wt') || commandExists('wt.exe')) {
      return 'windows-wt';
    }
    if (commandExists('cmd.exe') || commandExists('cmd')) {
      return 'windows-cmd';
    }
    return null;
  }

  // 5. macOS (darwin) -> osascript / open -a Terminal
  if (platform === 'darwin') {
    if (commandExists('osascript')) {
      return 'macos-osascript';
    }
    if (commandExists('open')) {
      return 'macos-terminal';
    }
    return null;
  }

  // 6. Linux -> x-terminal-emulator / gnome-terminal / konsole / xterm
  if (platform === 'linux') {
    for (const term of LINUX_TERMINALS) {
      if (commandExists(term)) {
        return `linux:${term}`;
      }
    }
    return null;
  }

  return null;
}

export function buildLaunchSpec(target, options = {}) {
  const ledger = options.ledger || '.ntg/ledger.json';
  const cwd = options.cwd || process.cwd();
  const env = options.env || process.env;
  const dagCommand = options.dagCommand || 'ntg-dag';
  const dagArgs = options.dagArgs || [];
  const distro = env.WSL_DISTRO_NAME;

  if (!target) return null;

  if (target === 'herdr') {
    return {
      target: 'herdr',
      command: 'herdr',
      args: ['pane', 'split', '--current', '--direction', 'right', '--no-focus'],
      runArgs: (paneId) => ['pane', 'run', paneId, dagCommand, ...dagArgs, '--watch', '--ledger', ledger],
    };
  }

  if (target === 'tmux') {
    return {
      target: 'tmux',
      command: 'tmux',
      args: ['split-window', '-h', dagCommand, ...dagArgs, '--watch', '--ledger', ledger],
    };
  }

  if (target === 'wsl-wt') {
    const args = ['-w', '0', 'nt', 'wsl.exe'];
    if (distro) {
      args.push('-d', distro);
    }
    args.push('--cd', cwd, '--', dagCommand, ...dagArgs, '--watch', '--ledger', ledger);
    return {
      target: 'wsl-wt',
      command: 'wt.exe',
      args,
    };
  }

  if (target === 'wsl-cmd') {
    const args = ['/c', 'start', 'wsl.exe'];
    if (distro) {
      args.push('-d', distro);
    }
    args.push('--cd', cwd, '--', dagCommand, ...dagArgs, '--watch', '--ledger', ledger);
    return {
      target: 'wsl-cmd',
      command: 'cmd.exe',
      args,
    };
  }

  if (target === 'windows-wt') {
    return {
      target: 'windows-wt',
      command: options.wtCommand || 'wt',
      args: [dagCommand, ...dagArgs, '--watch', '--ledger', ledger],
    };
  }

  if (target === 'windows-cmd') {
    return {
      target: 'windows-cmd',
      command: 'cmd.exe',
      args: ['/c', 'start', dagCommand, ...dagArgs, '--watch', '--ledger', ledger],
    };
  }

  if (target === 'macos-osascript') {
    return {
      target: 'macos-osascript',
      command: 'osascript',
      args: ['-e', `tell application "Terminal" to do script "${appleScriptString([dagCommand, ...dagArgs, '--watch', '--ledger', ledger].map(shellQuote).join(' '))}"`],
    };
  }

  if (target === 'macos-terminal') {
    return {
      target: 'macos-terminal',
      command: 'open',
      args: ['-a', 'Terminal', dagCommand, ...dagArgs, '--watch', '--ledger', ledger],
    };
  }

  if (target.startsWith('linux:')) {
    const term = target.slice('linux:'.length);
    const args =
      term === 'gnome-terminal'
        ? ['--', dagCommand, ...dagArgs, '--watch', '--ledger', ledger]
        : ['-e', dagCommand, ...dagArgs, '--watch', '--ledger', ledger];
    return {
      target,
      command: term,
      args,
    };
  }

  return null;
}

export function defaultLauncher(command, args, options = {}) {
  const spawnOptions = {
    detached: true,
    stdio: 'ignore',
    cwd: options.cwd || process.cwd(),
    env: options.env || process.env,
    ...options,
  };
  const child = spawn(command, args, spawnOptions);
  if (child) {
    if (typeof child.unref === 'function') {
      child.unref();
    }
    if (typeof child.on === 'function') {
      child.on('error', () => {});
    }
  }
  return child;
}

export function launchGraphPane(options = {}) {
  const target = detectGraphTarget(options);
  if (!target) {
    return { ok: false, fallback: true, target: null };
  }

  const spec = buildLaunchSpec(target, options);
  if (!spec) {
    return { ok: false, fallback: true, target: null };
  }

  const launcher = options.launcher || defaultLauncher;
  const spawnSyncFn = options.spawnSync || spawnSync;
  const spawnOptions = {
    detached: true,
    stdio: 'ignore',
    cwd: options.cwd || process.cwd(),
    env: options.env || process.env,
  };

  try {
    if (target === 'herdr') {
      let paneId = options.herdrPaneId || null;
      if (!paneId) {
        try {
          const splitRes = spawnSyncFn(spec.command, spec.args, {
            encoding: 'utf8',
            env: options.env || process.env,
          });
          if (splitRes.status === 0 && splitRes.stdout) {
            const data = JSON.parse(splitRes.stdout);
            paneId = data?.result?.pane?.pane_id;
          }
        } catch {}
      }
      if (paneId && spec.runArgs) {
        const runArgs = spec.runArgs(paneId);
        const child = launcher('herdr', runArgs, spawnOptions);
        if (child && typeof child.unref === 'function') child.unref();
        return { ok: true, target: 'herdr', command: 'herdr', args: runArgs, child };
      }
      const child = launcher(spec.command, spec.args, spawnOptions);
      if (child && typeof child.unref === 'function') child.unref();
      return { ok: true, target: 'herdr', command: spec.command, args: spec.args, child };
    }

    const child = launcher(spec.command, spec.args, spawnOptions);
    if (child && typeof child.unref === 'function') {
      child.unref();
    }
    return { ok: true, target: spec.target, command: spec.command, args: spec.args, child };
  } catch (err) {
    return { ok: false, fallback: true, target: spec.target, error: err };
  }
}

// POSIX single-quote each word, then escape for an AppleScript string literal.
function shellQuote(word) {
  return `'${String(word).replaceAll("'", "'\\''")}'`;
}
function appleScriptString(text) {
  return text.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

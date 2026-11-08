#!/usr/bin/env node
/**
 * ntg-command.mjs — Packaged helper / CLI entry point for native-gravity runner.
 *
 * Resolves ntg-vnext.mjs and dag-view.mjs relative to its own installation
 * directory and invokes ntg-vnext commands (init, status, run, resume),
 * dag-view (graph), or prints the installed version (version) with argv
 * arrays using child_process spawnSync (no shell concatenation). Default
 * ledger is .ntg/ledger.json if --ledger is omitted. Never writes ledger
 * contents directly.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { launchGraphPane } from './graph-pane.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_VNEXT_SCRIPT = resolve(__dirname, 'ntg-vnext.mjs');
export const DEFAULT_DAG_SCRIPT = resolve(__dirname, 'dag-view.mjs');
export const DEFAULT_LEDGER = '.ntg/ledger.json';
export const DEFAULT_PACKAGE_JSON = resolve(__dirname, '..', 'package.json');

export function resolveVnextScript() {
  return process.env.NTG_VNEXT_SCRIPT || DEFAULT_VNEXT_SCRIPT;
}

export function resolveDagScript() {
  return process.env.NTG_DAG_SCRIPT || DEFAULT_DAG_SCRIPT;
}

const USAGE = `Usage: ntg-command <init|status|run|resume|review|graph|version> [options]

Commands:
  init    --plan <path> [--ledger <path>]   Initialize ledger and plan
  status  [--ledger <path>]                 Display ledger status
  run     [--ledger <path>] [options]       Run runner milestones
  resume  [--ledger <path>] [options]       Check status and resume execution
  review  [--ledger <path>] [--milestone <id>]  Gate-only Zen retry of the last candidate
  graph   [--ledger <path>] [--watch] [--once] [--pane] Display milestone dependency DAG
  version                                   Show native-gravity version

Options:
  --ledger <path>   Ledger path (default: .ntg/ledger.json)
  --plan <path>     Plan file path (required for init)
  --watch           Watch mode for graph (redraws on ledger change)
  --once            Print graph once without opening a side pane or terminal
  --pane            Open the side pane even when stdout is not a terminal
  --help, -h        Show this help message
`;

function executeVnext(vnextScript, args, spawn, options, spawnEnv, errStream) {
  const stdio = options.stdio || 'inherit';
  const res = spawn(process.execPath, [vnextScript, ...args], {
    stdio,
    env: spawnEnv,
  });
  if (res.error) {
    if (errStream && typeof errStream.write === 'function') {
      errStream.write(`Error: ${res.error.message}\n`);
    }
    return 1;
  }
  return res.status ?? (res.error || res.signal ? 1 : 0);
}

/**
 * Executes an ntg runner command with argument forwarding.
 *
 * @param {string[]} argv CLI arguments after script name
 * @param {object} [options]
 * @param {string} [options.vnextScript] Override vnext script path
 * @param {string} [options.dagScript] Override dag script path
 * @param {Function} [options.spawnSync] Custom spawn function
 * @param {object} [options.env] Environment variables override
 * @param {string|Array} [options.stdio] Stdio mode ('inherit', 'pipe', 'ignore')
 * @param {object} [options.stderr] Stream for error output
 * @param {object} [options.stdout] Stream for standard output
 * @param {string} [options.packageJsonPath] Override package.json path
 * @returns {number} Exit code (0 on success, nonzero on failure)
 */
export function runNtgCommand(argv = [], options = {}) {
  const errStream =
    options.stderr ||
    (options.stdio === 'ignore' || options.stdio === 'pipe'
      ? { write() {} }
      : process.stderr);
  const outStream =
    options.stdout ||
    (options.stdio === 'ignore' || options.stdio === 'pipe'
      ? { write() {} }
      : process.stdout);

  if (argv.length === 0) {
    errStream.write(USAGE);
    return 1;
  }

  const [command, ...rest] = argv;

  if (command === '--help' || command === '-h' || command === 'help') {
    outStream.write(USAGE);
    return 0;
  }

  if (!['init', 'status', 'run', 'resume', 'review', 'graph', 'version'].includes(command)) {
    errStream.write(`Unknown command: ${command}\n\n${USAGE}`);
    return 1;
  }

  if (command === 'version') {
    const pkgPath = options.packageJsonPath || DEFAULT_PACKAGE_JSON;
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      outStream.write(`${pkg.version}\n`);
      return 0;
    } catch (err) {
      errStream.write(`Error reading package version: ${err.message}\n`);
      return 1;
    }
  }

  let ledger = DEFAULT_LEDGER;
  let plan = null;
  const passthrough = [];

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === '--ledger') {
      if (i + 1 >= rest.length) {
        errStream.write('Error: --ledger requires a path argument\n');
        return 1;
      }
      ledger = rest[i + 1];
      i += 1;
    } else if (arg === '--plan') {
      if (i + 1 >= rest.length) {
        errStream.write('Error: --plan requires a path argument\n');
        return 1;
      }
      plan = rest[i + 1];
      i += 1;
    } else {
      passthrough.push(arg);
    }
  }

  const vnextScript = options.vnextScript || resolveVnextScript();
  const dagScript = options.dagScript || resolveDagScript();
  const spawn = options.spawnSync || spawnSync;
  const spawnEnv = options.env ? { ...process.env, ...options.env } : process.env;

  if (command === 'init') {
    if (!plan) {
      errStream.write('Error: init requires --plan <path>\n');
      return 1;
    }
    return executeVnext(
      vnextScript,
      ['init', '--ledger', ledger, '--plan', plan, ...passthrough],
      spawn,
      options,
      spawnEnv,
      errStream
    );
  }

  if (command === 'status') {
    return executeVnext(
      vnextScript,
      ['status', '--ledger', ledger, ...passthrough],
      spawn,
      options,
      spawnEnv,
      errStream
    );
  }

  if (command === 'review') {
    return executeVnext(
      vnextScript,
      ['review', '--ledger', ledger, ...passthrough],
      spawn,
      options,
      spawnEnv,
      errStream
    );
  }

  if (command === 'run') {
    return executeVnext(
      vnextScript,
      ['run', '--ledger', ledger, ...passthrough],
      spawn,
      options,
      spawnEnv,
      errStream
    );
  }

  if (command === 'resume') {
    const statusCode = executeVnext(
      vnextScript,
      ['status', '--ledger', ledger],
      spawn,
      options,
      spawnEnv,
      errStream
    );
    if (statusCode !== 0) {
      return statusCode;
    }
    const runRest = passthrough.filter((arg) => arg !== '--all');
    return executeVnext(
      vnextScript,
      ['run', '--ledger', ledger, '--all', ...runRest],
      spawn,
      options,
      spawnEnv,
      errStream
    );
  }

  if (command === 'graph') {
    const isTTY =
      options.isTTY !== undefined
        ? Boolean(options.isTTY)
        : Boolean(options.stdout?.isTTY ?? process.stdout.isTTY);
    const isOnce = passthrough.includes('--once');
    // --pane forces the side pane when stdout is not a TTY (AGY run_command).
    const forcePane = passthrough.includes('--pane');
    const filteredPassthrough = passthrough.filter((arg) => arg !== '--once' && arg !== '--pane');

    // Non-TTY (unless --pane) or --once prints once as today without opening a pane
    if ((!isTTY && !forcePane) || isOnce) {
      return executeVnext(
        dagScript,
        ['--ledger', ledger, ...filteredPassthrough],
        spawn,
        options,
        spawnEnv,
        errStream
      );
    }

    const cwd = options.cwd || process.cwd();
    const launchResult = launchGraphPane({
      ledger: resolve(cwd, ledger),
      dagCommand: options.dagCommand || process.execPath,
      dagArgs: options.dagCommand ? [] : [dagScript],
      cwd,
      env: options.env !== undefined ? options.env : spawnEnv,
      platform: options.platform || process.platform,
      launcher: options.launcher,
      commandExists: options.commandExists,
      readProcVersion: options.readProcVersion,
      hasHerdrSession: options.hasHerdrSession,
      spawnSync: options.spawnSync || spawn,
      isTTY,
    });

    if (launchResult.ok) {
      return 0;
    }

    // Fallback when none works: print graph once as today + print hint
    const code = executeVnext(
      dagScript,
      ['--ledger', ledger, ...filteredPassthrough],
      spawn,
      options,
      spawnEnv,
      errStream
    );
    outStream.write(`\nHint: live view: ntg-dag --watch --ledger ${ledger}\n`);
    return code;
  }

  return 1;
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    const scriptPath = fileURLToPath(import.meta.url);
    return (
      resolve(process.argv[1]) === resolve(scriptPath) ||
      (existsSync(process.argv[1]) &&
        existsSync(scriptPath) &&
        realpathSync(process.argv[1]) === realpathSync(scriptPath))
    );
  } catch {
    return false;
  }
}

if (isMainModule()) {
  const code = runNtgCommand(process.argv.slice(2));
  process.exit(code);
}

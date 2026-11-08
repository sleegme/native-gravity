#!/usr/bin/env node
// hook-snap — strictly read-only snapshot of NTG hook registration state (#183).
//
// One call compares: hooks.json registrations, hooks/ guard files, the
// installed plugin copy (~/.gemini/config/plugins/native-gravity) against
// the repo, and `agy plugin list` state. A missing or failing agy is
// reported as UNKNOWN, never an error. The tool itself writes nothing:
// reads and prints only (`agy plugin list` is a read-only query).
// Output is capped (--max-lines, default 200 lines, 200 chars per line)
// with an explicit truncation marker.
//
// Usage: hook-snap [--repo DIR] [--installed DIR] [--max-lines N]
//   --repo       repo root holding hooks.json and hooks/ (default: this checkout)
//   --installed  installed plugin copy (default: ~/.gemini/config/plugins/native-gravity)
//   env: AGY_PATH (agy binary), NTG_SNAP_MAX_LINES (default cap)

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { capLines, clipLine, resolveMaxLines } from './snap-common.mjs';

const USAGE = 'usage: hook-snap [--repo DIR] [--installed DIR] [--max-lines N] (env: AGY_PATH, NTG_SNAP_MAX_LINES)';

const AGY_LIST_TIMEOUT_MS = 15000;

/**
 * Flattens hooks.json into one record per hook command registration.
 *
 * @param {object} hooksJson parsed hooks.json
 * @returns {Array<{ boundary: string, event: string, matcher: string, command: string }>}
 */
export function parseRegistrations(hooksJson) {
  const out = [];
  if (!hooksJson || typeof hooksJson !== 'object') return out;
  for (const [boundary, events] of Object.entries(hooksJson)) {
    if (!events || typeof events !== 'object') continue;
    for (const [event, entries] of Object.entries(events)) {
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        // PreToolUse entries: { matcher, hooks: [{ type, command }] }.
        // SessionStart entries carry the command directly on the entry.
        const hooks = Array.isArray(entry?.hooks) ? entry.hooks : null;
        if (hooks) {
          for (const hook of hooks) {
            if (typeof hook?.command !== 'string') continue;
            out.push({ boundary, event, matcher: typeof entry?.matcher === 'string' ? entry.matcher : '*', command: hook.command });
          }
        } else if (typeof entry?.command === 'string') {
          out.push({ boundary, event, matcher: typeof entry?.matcher === 'string' ? entry.matcher : '*', command: entry.command });
        }
      }
    }
  }
  return out;
}

/** Guard-file paths (hooks/…) referenced by registered commands, sorted and unique. */
export function registeredGuardPaths(registrations) {
  const paths = new Set();
  for (const { command } of registrations) {
    const match = command.match(/hooks\/[A-Za-z0-9._-]+/);
    if (match) paths.add(match[0]);
  }
  return [...paths].sort();
}

/** Regular files directly under <root>/hooks (no recursion; __pycache__ excluded), sorted. */
export function listGuardFiles(root) {
  const dir = join(root, 'hooks');
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter(e => e.isFile() && e.name !== '.DS_Store' && !e.name.endsWith('.pyc'))
    .map(e => e.name)
    .sort();
}

function sha256Text(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function readFileHash(path) {
  try {
    return sha256Text(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Queries `agy plugin list --json` for the native-gravity plugin state.
 * Returns UNKNOWN (not an error) when agy is missing, fails, or is unparsable.
 *
 * @param {{ agyPath?: string }} opts
 * @returns {{ status: 'OK'|'NOT_FOUND'|'UNKNOWN', enabled?: boolean, version?: string|null, detail?: string }}
 */
export function queryAgyPluginList({ agyPath = process.env.AGY_PATH || 'agy' } = {}) {
  const result = spawnSync(agyPath, ['plugin', 'list', '--json'], {
    encoding: 'utf8', timeout: AGY_LIST_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error) {
    const why = result.error.code === 'ENOENT' ? 'agy not found' : result.error.code;
    return { status: 'UNKNOWN', detail: `${why}` };
  }
  if (result.status !== 0) {
    return { status: 'UNKNOWN', detail: `agy plugin list exited ${result.status}` };
  }
  let plugins;
  try {
    plugins = JSON.parse(result.stdout ?? '');
  } catch (error) {
    return { status: 'UNKNOWN', detail: `unparsable output (${error.message})` };
  }
  if (!Array.isArray(plugins)) {
    return { status: 'UNKNOWN', detail: 'output is not a JSON array' };
  }
  const ours = plugins.find(p => p && typeof p === 'object' && p.name === 'native-gravity');
  if (!ours) return { status: 'NOT_FOUND', detail: 'native-gravity absent from plugin list' };
  return { status: 'OK', enabled: ours.enabled === true, version: typeof ours.version === 'string' ? ours.version : null };
}

function agyLine(state) {
  switch (state.status) {
    case 'OK':
      return `agy plugin list: native-gravity · enabled=${state.enabled ? 'true' : 'false'}${state.version ? ` · version=${state.version}` : ''}`;
    case 'NOT_FOUND':
      return `agy plugin list: native-gravity NOT_FOUND (${state.detail})`;
    default:
      return `agy plugin list: UNKNOWN (${state.detail})`;
  }
}

/**
 * Renders the snapshot as lines. Deterministic given the same inputs: no
 * clock, randomness, or unsorted iteration.
 *
 * @param {{ repoRoot: string, installedRoot: string, hooksJson: object, agyState: object }} input
 * @returns {string[]}
 */
export function renderHookSnap({ repoRoot, installedRoot, hooksJson, agyState }) {
  const lines = [];
  const registrations = parseRegistrations(hooksJson);
  const registered = registeredGuardPaths(registrations);
  const repoGuards = listGuardFiles(repoRoot);

  const installedPresent = existsSync(installedRoot);
  lines.push(clipLine(`hook snap · repo: ${repoRoot} · installed: ${installedRoot}${installedPresent ? '' : ' · MISSING'}`));

  lines.push(`hooks.json registrations: ${registrations.length}`);
  for (const r of registrations) {
    lines.push(clipLine(`  ${r.boundary} · ${r.event} · matcher ${r.matcher} · ${r.command}`));
  }

  lines.push(`guards in hooks/: ${repoGuards.length}`);
  for (const name of repoGuards) {
    let size = '-';
    try { size = `${statSync(join(repoRoot, 'hooks', name)).size}B`; } catch { /* unreadable size stays '-' */ }
    const hash = readFileHash(join(repoRoot, 'hooks', name));
    lines.push(clipLine(`  ${name} · ${size} · sha256:${hash ? hash.slice(0, 12) : '?'}`));
  }

  const registeredNames = new Set(registered.map(p => p.slice('hooks/'.length)));
  const missingFiles = registered.filter(p => !repoGuards.includes(p.slice('hooks/'.length)));
  const unregistered = repoGuards.filter(name => !registeredNames.has(name));
  lines.push('registration vs files:');
  if (missingFiles.length === 0 && unregistered.length === 0) {
    lines.push('  consistent');
  } else {
    for (const p of missingFiles) lines.push(clipLine(`  registered-but-missing: ${p}`));
    for (const name of unregistered) lines.push(clipLine(`  unregistered: ${name}`));
  }

  if (!installedPresent) {
    lines.push('repo vs installed: skipped (installed copy missing)');
  } else {
    const installedGuards = listGuardFiles(installedRoot);
    const compareSet = ['hooks.json', ...new Set([...repoGuards, ...installedGuards])].sort();
    lines.push('repo vs installed:');
    for (const name of compareSet) {
      const rel = name === 'hooks.json' ? 'hooks.json' : `hooks/${name}`;
      const repoHash = readFileHash(join(repoRoot, rel));
      const installedHash = readFileHash(join(installedRoot, rel));
      if (repoHash === null && installedHash === null) continue;
      if (repoHash === null) lines.push(clipLine(`  ${rel}: EXTRA in installed`));
      else if (installedHash === null) lines.push(clipLine(`  ${rel}: MISSING in installed`));
      else if (repoHash === installedHash) lines.push(clipLine(`  ${rel}: MATCH`));
      else lines.push(clipLine(`  ${rel}: DIFFERS (repo sha256:${repoHash.slice(0, 12)} / installed sha256:${installedHash.slice(0, 12)})`));
    }
  }

  lines.push(clipLine(agyLine(agyState)));
  return lines;
}

/**
 * CLI entry. Returns the exit code; performs no writes beyond stdout/stderr.
 * Exit 0 covers every reported state (drift, missing installed copy, UNKNOWN
 * agy); only unreadable repo inputs (exit 1) and usage errors (exit 2) fail.
 *
 * @param {string[]} argv
 * @param {{ env?: object, stdout?: NodeJS.WriteStream, stderr?: NodeJS.WriteStream }} io
 * @returns {number}
 */
export function main(argv = process.argv.slice(2), { env = process.env, stdout = process.stdout, stderr = process.stderr } = {}) {
  const repoDefault = resolve(join(fileURLToPath(import.meta.url), '..', '..'));
  const installedDefault = join(homedir(), '.gemini', 'config', 'plugins', 'native-gravity');
  let repoRoot = repoDefault;
  let installedRoot = installedDefault;
  let maxLinesArg = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repo') repoRoot = argv[++i];
    else if (a.startsWith('--repo=')) repoRoot = a.slice(7);
    else if (a === '--installed') installedRoot = argv[++i];
    else if (a.startsWith('--installed=')) installedRoot = a.slice(12);
    else if (a === '--max-lines') maxLinesArg = argv[++i];
    else if (a.startsWith('--max-lines=')) maxLinesArg = a.slice(12);
    else if (a === '-h' || a === '--help') { stdout.write(USAGE + '\n'); return 0; }
    else { stderr.write(USAGE + '\n'); return 2; }
  }
  let maxLines;
  try {
    maxLines = resolveMaxLines({ arg: maxLinesArg, env });
  } catch (error) {
    stderr.write(`hook-snap: ${error.message}\n${USAGE}\n`);
    return 2;
  }

  const hooksJsonPath = resolve(repoRoot, 'hooks.json');
  let hooksJson;
  try {
    hooksJson = JSON.parse(readFileSync(hooksJsonPath, 'utf8'));
  } catch (error) {
    stderr.write(`hook-snap: cannot read ${hooksJsonPath}: ${error.message}\n`);
    return 1;
  }

  const agyState = queryAgyPluginList({ agyPath: env.AGY_PATH || 'agy' });
  const { lines } = capLines(renderHookSnap({ repoRoot, installedRoot, hooksJson, agyState }), maxLines);
  stdout.write(lines.join('\n') + '\n');
  return 0;
}

/** npm bin shims invoke this file through a symlink; compare real paths (#135 B1). */
function invokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  process.exit(main());
}

/**
 * Stage 1 coverage machinery (NTG subagent redesign 2026-11-08, §2.4–§2.5).
 *
 * The recurring spine-class defect entered at decomposition: a coordinator
 * turned a quantified requirement ("verify after each save") into a wrong list
 * of sites, and everything downstream inherited the error until Zen caught it.
 * This module takes site enumeration away from every model: plans declare
 * regex probes per quantified criterion, code enumerates the sites, code
 * re-runs the probes on the candidate tree, and code rejects a candidate whose
 * coverage table lacks rows. Plans without `coverage` keep the pre-Stage-1
 * behavior exactly (probes are optional when the fallback planner writes the
 * plan, §3).
 *
 * It also builds the code-side inputs the thin Bulldozer crew works from
 * (§2.6.1): a scope map (per in-scope file: line count plus top-level symbols
 * with line numbers) and the delegation-time snapshot used by the salvage
 * branch to detect that a dead coordinator session left in-scope changes.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

/** Directories never entered while expanding a bounded_scope entry. */
export const SCOPE_IGNORE = new Set(['.git', 'node_modules', '__pycache__', '.ntg']);

/** Probe hit ceiling enforced at init (§2.4: "its hit count is ≤60"). */
export const MAX_PROBE_HITS = 60;

const JS_EXTENSIONS = new Set(['.js', '.mjs', '.ts', '.mts', '.cjs', '.cts']);

/** Top-level (column 0) declaration patterns for JS-family and Python files. */
const JS_SYMBOL_PATTERNS = [
  /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/,
  /^(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/,
  /^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)/,
];
const PY_SYMBOL_PATTERNS = [/^(?:def|class)\s+([A-Za-z_]\w*)/];

function toPosix(path) {
  return String(path ?? '').replace(/\\/g, '/');
}

/** Normalizes one scope/probe path: posix separators, no leading './'. */
function normalizeEntry(entry) {
  const posix = toPosix(entry).replace(/^\.\//, '');
  return { posix, trimmed: posix.replace(/\/+$/, '') };
}

/**
 * True when `path` lies inside `boundedScope`: it equals an entry, or an entry
 * is a directory prefix on a whole segment boundary. Pure string logic — no
 * filesystem access, so init can validate probes before any file exists.
 */
export function isPathInScope(path, boundedScope) {
  const target = normalizeEntry(path).trimmed;
  if (!target) return false;
  for (const entry of Array.isArray(boundedScope) ? boundedScope : [boundedScope]) {
    if (typeof entry !== 'string' || !entry.trim()) continue;
    const { trimmed } = normalizeEntry(entry);
    if (!trimmed) continue;
    if (target === trimmed || target.startsWith(`${trimmed}/`)) return true;
  }
  return false;
}

function walkDirectory(dirRelative, { cwd }, out) {
  let entries;
  const absolute = join(cwd, dirRelative);
  try {
    entries = readdirSync(absolute, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (SCOPE_IGNORE.has(entry.name)) continue;
    const child = `${dirRelative}/${entry.name}`;
    if (entry.isDirectory()) {
      walkDirectory(child, { cwd }, out);
    } else if (entry.isFile()) {
      out.push(child);
    }
  }
}

/**
 * Expands bounded_scope entries to repo-relative file paths. Missing entries
 * are skipped (a scoped file may not exist yet — Bobcat creates it) and
 * reported separately so packets can say so instead of implying emptiness.
 *
 * @param {string[]|string} boundedScope
 * @param {{ cwd?: string }} [opts]
 * @returns {{ files: string[], missing: string[] }}
 */
export function expandScopeFiles(boundedScope, opts = {}) {
  const cwd = opts.cwd ?? process.cwd();
  const entries = (Array.isArray(boundedScope) ? boundedScope : [boundedScope])
    .filter(entry => typeof entry === 'string' && entry.trim());
  const files = [];
  const missing = [];
  for (const entry of entries) {
    const { posix } = normalizeEntry(entry);
    let stats;
    try {
      stats = statSync(join(cwd, posix));
    } catch {
      missing.push(posix);
      continue;
    }
    if (stats.isFile()) {
      files.push(posix);
    } else if (stats.isDirectory()) {
      walkDirectory(normalizeEntry(entry).trimmed, { cwd }, files);
    }
  }
  files.sort();
  return { files: [...new Set(files)], missing: [...new Set(missing)] };
}

/**
 * Reads a file as UTF-8 text, or null when it cannot be decoded (binary) or
 * does not exist. Missing scoped files are expected, not exceptional.
 */
function readTextFile(path, { cwd }) {
  try {
    return readFileSync(join(cwd, path), 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Builds the code-authored scope map for a milestone packet (§2.4): per
 * in-scope file its line count and its top-level symbols with line numbers.
 *
 * @param {string[]|string} boundedScope
 * @param {{ cwd?: string }} [opts]
 * @returns {{ files: Array<{ path: string, lines: number, symbols: Array<{ name: string, line: number }> }>, missing: string[] }}
 */
export function buildScopeMap(boundedScope, opts = {}) {
  const { files, missing } = expandScopeFiles(boundedScope, opts);
  return {
    files: files.map(path => {
      const text = readTextFile(path, opts);
      if (text === null) return { path, lines: 0, symbols: [] };
      const lines = text.split('\n');
      const isJs = JS_EXTENSIONS.has(toPosix(path).slice(toPosix(path).lastIndexOf('.')));
      const isPy = toPosix(path).endsWith('.py');
      const patterns = isJs ? JS_SYMBOL_PATTERNS : isPy ? PY_SYMBOL_PATTERNS : [];
      const symbols = [];
      if (patterns.length) {
        lines.forEach((line, index) => {
          if (line.startsWith(' ') || line.startsWith('\t')) return;
          for (const pattern of patterns) {
            const match = pattern.exec(line);
            if (match) {
              symbols.push({ name: match[1], line: index + 1 });
              break;
            }
          }
        });
      }
      // A trailing newline does not add a line.
      const lineCount = lines.length > 0 && lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
      return { path, lines: lineCount, symbols };
    }),
    missing,
  };
}

/**
 * Pure plan validation for the `coverage` and `verify` fields (§2.4): probe
 * patterns must compile, probe paths must lie inside the milestone's
 * bounded_scope, ids must be unique. Called from validatePlan; the hit-count
 * ceiling needs the filesystem and lives in countProbeHits (init-time).
 *
 * @param {object} plan - the whole plan (goal + milestones)
 * @param {new (message: string) => Error} [errorClass] - validation error class
 * @returns {void} throws on the first violation
 */
export function validateCoverage(plan, errorClass = Error) {
  for (const milestone of plan.milestones) {
    if (milestone.verify !== undefined) {
      if (!Array.isArray(milestone.verify)
        || milestone.verify.some(cmd => typeof cmd !== 'string' || !cmd.trim())) {
        throw new errorClass(
          `Milestone '${milestone.id}' verify must be an array of non-empty command strings`
        );
      }
    }
    if (milestone.coverage === undefined) continue;
    if (!Array.isArray(milestone.coverage)) {
      throw new errorClass(`Milestone '${milestone.id}' coverage must be an array when present`);
    }
    const seen = new Set();
    for (const entry of milestone.coverage) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new errorClass(`Milestone '${milestone.id}' coverage entries must be objects`);
      }
      if (typeof entry.id !== 'string' || !entry.id.trim()) {
        throw new errorClass(
          `Milestone '${milestone.id}' coverage entries need a non-empty string 'id'`
        );
      }
      if (seen.has(entry.id)) {
        throw new errorClass(`Milestone '${milestone.id}' declares duplicate coverage id '${entry.id}'`);
      }
      seen.add(entry.id);
      const probe = entry.probe;
      if (!probe || typeof probe !== 'object' || Array.isArray(probe)) {
        throw new errorClass(`Coverage '${milestone.id}/${entry.id}' needs a probe object`);
      }
      try {
        new RegExp(probe.pattern);
      } catch (error) {
        throw new errorClass(
          `Coverage '${milestone.id}/${entry.id}' probe pattern does not compile: ${error.message}`
        );
      }
      if (!Array.isArray(probe.paths) || probe.paths.length === 0
        || probe.paths.some(p => typeof p !== 'string' || !p.trim())) {
        throw new errorClass(
          `Coverage '${milestone.id}/${entry.id}' probe needs a non-empty 'paths' array of strings`
        );
      }
      for (const path of probe.paths) {
        if (!isPathInScope(path, milestone.bounded_scope)) {
          throw new errorClass(
            `Coverage '${milestone.id}/${entry.id}' probe path '${path}' lies outside the milestone's bounded_scope`
          );
        }
      }
    }
  }
}

/**
 * Runs one milestone's coverage probes line-by-line over their paths.
 * Missing files are skipped; probe paths are already scope-validated at init.
 *
 * @param {Array<{ id: string, probe: { pattern: string, paths: string[] } }>} coverage
 * @param {{ cwd?: string }} [opts]
 * @returns {Array<{ coverage_id: string, site: string, text: string }>}
 */
export function runCoverageProbes(coverage, opts = {}) {
  const hits = [];
  if (!Array.isArray(coverage)) return hits;
  for (const entry of coverage) {
    if (!entry || typeof entry !== 'object' || !entry.probe) continue;
    let pattern;
    try {
      pattern = new RegExp(entry.probe.pattern);
    } catch {
      continue;
    }
    for (const path of Array.isArray(entry.probe.paths) ? entry.probe.paths : []) {
      const text = readTextFile(path, opts);
      if (text === null) continue;
      const lines = text.split('\n');
      for (let index = 0; index < lines.length; index += 1) {
        if (pattern.test(lines[index])) {
          hits.push({
            coverage_id: entry.id,
            site: `${toPosix(path)}:${index + 1}`,
            text: lines[index].trim(),
          });
        }
      }
    }
  }
  return hits;
}

/**
 * Per-probe hit counts for the init-time ≤60 ceiling (§2.4). Keyed by
 * coverage id so the error can name the noisy probe, not just the milestone.
 *
 * @param {Array<{ id: string, probe: object }>} coverage
 * @param {{ cwd?: string }} [opts]
 * @returns {Record<string, number>}
 */
export function countProbeHits(coverage, opts = {}) {
  const counts = {};
  for (const entry of Array.isArray(coverage) ? coverage : []) {
    if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string') continue;
    counts[entry.id] = runCoverageProbes([entry], opts).length;
  }
  return counts;
}

/**
 * The pre-Zen code check (§2.4 CHECK item 2, Stage 1 slice): every probe hit
 * on the candidate tree — including sites the work itself introduced — must
 * have a coverage-table row with the same coverage_id and site. Rows with an
 * unknown disposition are invalid and reported like missing sites so the
 * packet-correction round can name them.
 *
 * @param {Array<{ coverage_id: string, site: string }>} hits
 * @param {Array<{ coverage_id: string, site: string, disposition: string }>} coverageTable
 * @returns {{ ok: boolean, missing: Array<{ coverage_id: string, site: string, text: string }>, invalid: Array<object> }}
 */
export function checkCoverageTable(hits, coverageTable) {
  const rows = Array.isArray(coverageTable) ? coverageTable : [];
  const keyed = new Set();
  const invalid = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') {
      invalid.push(row);
      continue;
    }
    if (row.disposition !== 'COVERED' && row.disposition !== 'NOT_APPLICABLE') {
      invalid.push(row);
      continue;
    }
    keyed.add(`${row.coverage_id}\u0000${row.site}`);
  }
  const missing = (Array.isArray(hits) ? hits : []).filter(hit =>
    !keyed.has(`${hit.coverage_id}\u0000${hit.site}`));
  return { ok: missing.length === 0 && invalid.length === 0, missing, invalid };
}

/**
 * Digest snapshot of the in-scope files, taken before Bulldozer is invoked.
 * The salvage trigger (§2.6.5) compares two snapshots to decide whether a
 * transport death left salvageable work behind.
 *
 * @param {string[]|string} boundedScope
 * @param {{ cwd?: string }} [opts]
 * @returns {{ files: Record<string, string> }}
 */
export function snapshotScope(boundedScope, opts = {}) {
  const { files } = expandScopeFiles(boundedScope, opts);
  const digests = {};
  for (const path of files) {
    const text = readTextFile(path, opts);
    if (text === null) continue;
    digests[path] = `sha256:${createHash('sha256').update(text).digest('hex')}`;
  }
  return { files: digests };
}

/**
 * Diff of two scope snapshots: content changes plus newly created files.
 * Removed files count as changed — a rewrite is not "no work happened".
 *
 * @param {{ files: Record<string, string> }} before
 * @param {{ files: Record<string, string> }} after
 * @returns {{ changed: string[], added: string[] }}
 */
export function scopeChanges(before, after) {
  const beforeFiles = before?.files ?? {};
  const afterFiles = after?.files ?? {};
  const changed = [];
  const added = [];
  for (const [path, digest] of Object.entries(afterFiles)) {
    if (!(path in beforeFiles)) added.push(path);
    else if (beforeFiles[path] !== digest) changed.push(path);
  }
  for (const path of Object.keys(beforeFiles)) {
    if (!(path in afterFiles)) changed.push(path);
  }
  return { changed, added };
}

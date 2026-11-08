#!/usr/bin/env node
// ntg-state-snap — strictly read-only, bounded summary of a vNext ledger (#183).
//
// Prints milestone contracts, candidates (result_ref) and the linked Zen
// verification evidence in one call. Unlike `ntg-vnext status`, which builds
// a spine and acquires the ledger lock (a write), this tool reads the ledger
// JSON directly: no lock, no temp files, no directory creation, no writes of
// any kind. Output is capped (--max-lines, default 200 lines, 200 chars per
// line) with an explicit truncation marker.
//
// Usage: ntg-state-snap --ledger <path> [--max-lines N]
//   env: NTG_LEDGER (default ledger path), NTG_SNAP_MAX_LINES (default cap)

import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { capLines, clipLine, resolveMaxLines } from './snap-common.mjs';

const USAGE = 'usage: ntg-state-snap --ledger PATH [--max-lines N] (env: NTG_LEDGER, NTG_SNAP_MAX_LINES)';

/** Milestone state, same semantics as ntg-dag's stateOf (dag-view.mjs). */
function stateOf(id, ledger) {
  const completed = new Set(Array.isArray(ledger?.completed_milestones) ? ledger.completed_milestones : []);
  if (id === ledger?.current_milestone) return 'ACTIVE';
  if (completed.has(id)) return 'DONE';
  const blockers = Array.isArray(ledger?.blockers) ? ledger.blockers : [];
  if (blockers.some(b => b?.affects_milestone === id)) return 'BLOCKED';
  const ver = (ledger?.verification ?? {})[id];
  if (ver && ver.verdict === 'NO-GO' && !ver.is_stale) return 'NO-GO';
  if (ver && ver.is_stale) return 'STALE';
  const ms = (Array.isArray(ledger?.milestones) ? ledger.milestones : []).find(m => m?.id === id);
  if (ms && Array.isArray(ms.dependencies) && ms.dependencies.every(d => completed.has(d))) return 'READY';
  return 'PENDING';
}

/** Latest candidate of an evidence entry: active_candidate, else the last recorded. */
function lastCandidateOf(entry) {
  if (!entry || typeof entry !== 'object') return null;
  if (entry.active_candidate && typeof entry.active_candidate === 'object') return entry.active_candidate;
  if (Array.isArray(entry.candidates) && entry.candidates.length > 0) {
    return entry.candidates[entry.candidates.length - 1];
  }
  return null;
}

function artifactRefOf(candidate, entry) {
  const ref = candidate?.candidate_artifact_ref
    ?? candidate?.artifact_ref
    ?? entry?.candidate_artifact_ref
    ?? entry?.artifact_ref;
  return ref ?? '-';
}

/** One bounded human-readable form of a verification-evidence item. */
function formatEvidenceItem(item) {
  if (item === null || item === undefined) return '-';
  if (typeof item === 'string') return item;
  if (typeof item === 'object') {
    const parts = [item.classification, item.criterion, item.result]
      .filter(v => typeof v === 'string' && v.trim() !== '');
    if (parts.length > 0) return parts.join(': ');
    return JSON.stringify(item);
  }
  return String(item);
}

/** Bounded evidence items: the chosen candidate's evidence, else the last
 * recorded candidate's (the active candidate may be compacted), else the entry's. */
function evidenceItemsOf(entry, candidate) {
  const candidates = Array.isArray(entry?.candidates) ? entry.candidates : [];
  const lastRecorded = candidates.length > 0 ? candidates[candidates.length - 1] : null;
  const sources = [
    candidate?.verification_evidence ?? candidate?.payload?.verification_evidence,
    lastRecorded?.verification_evidence ?? lastRecorded?.payload?.verification_evidence,
    entry?.verification_evidence,
  ];
  for (const source of sources) {
    if (Array.isArray(source)) return source;
    if (source !== undefined && source !== null) return [source];
  }
  return [];
}

/** Links the Zen verification record to the candidate it judged, by result_ref. */
function refLink(verification, candidate) {
  const vRef = verification?.result_ref;
  const cRef = candidate?.result_ref;
  if (!vRef && !cRef) return 'none';
  if (vRef && cRef) return vRef === cRef ? 'match' : `MISMATCH (verification=${vRef} candidate=${cRef})`;
  if (vRef) return `no candidate for verification result_ref ${vRef}`;
  return `no verification for candidate result_ref ${cRef}`;
}

/**
 * Renders the bounded summary as lines. Deterministic: every byte comes from
 * the ledger content; no clock, randomness, or environment-dependent values.
 *
 * @param {object} ledger parsed ledger JSON
 * @param {{ ledgerLabel?: string }} opts
 * @returns {string[]}
 */
export function renderStateSnap(ledger, { ledgerLabel = '<ledger>' } = {}) {
  const lines = [];
  const milestones = Array.isArray(ledger?.milestones) ? ledger.milestones : [];
  const completed = Array.isArray(ledger?.completed_milestones) ? ledger.completed_milestones : [];
  const blockers = Array.isArray(ledger?.blockers) ? ledger.blockers : [];

  lines.push(clipLine(`ledger: ${ledgerLabel}`));
  lines.push(clipLine(`plan_version: ${ledger?.plan_version ?? '-'} · goal: ${ledger?.goal ?? '-'}`));
  lines.push(clipLine(`progress: ${completed.length}/${milestones.length} done · current: ${ledger?.current_milestone ?? '-'} · blockers: ${blockers.length}`));
  if (ledger?.next_action) lines.push(clipLine(`next_action: ${ledger.next_action}`));

  for (const m of milestones) {
    const id = m?.id ?? '?';
    const entry = (ledger?.evidence ?? {})[id];
    const verification = (ledger?.verification ?? {})[id];
    const candidate = lastCandidateOf(entry);
    const candidates = Array.isArray(entry?.candidates) ? entry.candidates : [];

    lines.push('');
    lines.push(clipLine(`milestone ${id} · ${stateOf(id, ledger)}`));
    lines.push(clipLine(`  deps: ${(Array.isArray(m?.dependencies) ? m.dependencies : []).join(', ') || 'none'}`));
    if (m?.objective) lines.push(clipLine(`  objective: ${m.objective}`));
    const scope = Array.isArray(m?.bounded_scope) ? m.bounded_scope : [];
    lines.push(clipLine(`  scope(${scope.length}): ${scope.join(', ') || '-'}`));
    const criteria = Array.isArray(m?.acceptance_criteria) ? m.acceptance_criteria : [];
    const extraCriteria = criteria.length > 2 ? ` …(+${criteria.length - 2} more)` : '';
    lines.push(clipLine(`  acceptance(${criteria.length}): ${criteria.slice(0, 2).join(' | ') || '-'}${extraCriteria}`));
    const nonGoals = Array.isArray(m?.non_goals) ? m.non_goals : [];
    if (nonGoals.length > 0) lines.push(clipLine(`  non_goals(${nonGoals.length}): ${nonGoals.join(', ')}`));

    if (candidate) {
      lines.push(clipLine(`  candidate: result_ref=${candidate.result_ref ?? '-'} · status=${candidate.status ?? '-'} · plan=${candidate.plan_version ?? '-'} · artifact=${artifactRefOf(candidate, entry)}`));
      if (candidates.length > 1) lines.push(clipLine(`  candidates: ${candidates.length} recorded`));
    } else {
      lines.push(clipLine('  candidate: none'));
    }

    const evidence = evidenceItemsOf(entry, candidate);
    const evidencePreview = evidence.length > 0 ? ` · latest: ${formatEvidenceItem(evidence[evidence.length - 1])}` : '';
    lines.push(clipLine(`  evidence(${evidence.length})${evidencePreview}`));

    if (verification) {
      lines.push(clipLine(`  verification: ${verification.verdict ?? '-'} · plan=${verification.plan_version ?? '-'} · stale=${verification.is_stale ? 'yes' : 'no'} · result_ref=${verification.result_ref ?? '-'}`));
      lines.push(clipLine(`  ref_link: ${refLink(verification, candidate)}`));
    } else {
      lines.push(clipLine('  verification: none'));
    }
  }

  if (blockers.length > 0) {
    lines.push('');
    for (const b of blockers.slice(0, 5)) {
      lines.push(clipLine(`blocker ${b?.affects_milestone ?? '?'}: ${b?.description ?? ''}`));
    }
    if (blockers.length > 5) lines.push(clipLine(`… ${blockers.length - 5} more blockers`));
  }
  return lines;
}

/**
 * CLI entry. Returns the exit code; performs no writes beyond stdout/stderr.
 *
 * @param {string[]} argv
 * @param {{ env?: object, stdout?: NodeJS.WriteStream, stderr?: NodeJS.WriteStream }} io
 * @returns {number}
 */
export function main(argv = process.argv.slice(2), { env = process.env, stdout = process.stdout, stderr = process.stderr } = {}) {
  let ledgerPath = env.NTG_LEDGER ?? null;
  let maxLinesArg = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--ledger') ledgerPath = argv[++i];
    else if (a.startsWith('--ledger=')) ledgerPath = a.slice(9);
    else if (a === '--max-lines') maxLinesArg = argv[++i];
    else if (a.startsWith('--max-lines=')) maxLinesArg = a.slice(12);
    else if (a === '-h' || a === '--help') { stdout.write(USAGE + '\n'); return 0; }
    else { stderr.write(USAGE + '\n'); return 2; }
  }
  let maxLines;
  try {
    maxLines = resolveMaxLines({ arg: maxLinesArg, env });
  } catch (error) {
    stderr.write(`ntg-state-snap: ${error.message}\n${USAGE}\n`);
    return 2;
  }
  if (!ledgerPath) { stderr.write(USAGE + '\n'); return 2; }

  const absolute = resolve(ledgerPath);
  let ledger;
  try {
    ledger = JSON.parse(readFileSync(absolute, 'utf8'));
  } catch (error) {
    stderr.write(`ntg-state-snap: cannot read ledger ${absolute}: ${error.message}\n`);
    return 1;
  }
  const { lines } = capLines(renderStateSnap(ledger, { ledgerLabel: absolute }), maxLines);
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

import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { snapshotScope } from '../../scripts/coverage.mjs';

export class LightweightLogError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'LightweightLogError';
    this.code = 'LIGHTWEIGHT_LOG_ERROR';
    Object.assign(this, details);
  }
}

function canonicalString(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalString).join(',') + ']';
  }
  const keys = Object.keys(value).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalString(value[k])).join(',') + '}';
}

/**
 * Computes a deterministic SHA-256 digest for a bounded file scope or diff payload.
 */
export function computeDiffDigest(scopeOrPayload, { cwd } = {}) {
  if (Array.isArray(scopeOrPayload)) {
    const snap = snapshotScope(scopeOrPayload, { cwd });
    return `sha256:${createHash('sha256').update(canonicalString(snap.files), 'utf8').digest('hex')}`;
  }
  return `sha256:${createHash('sha256').update(canonicalString(scopeOrPayload ?? null), 'utf8').digest('hex')}`;
}

/**
 * Computes a deterministic SHA-256 digest over normalized acceptance criteria.
 */
export function computeAcceptanceDigest(acceptanceCriteria) {
  const list = Array.isArray(acceptanceCriteria)
    ? acceptanceCriteria.map(c => (typeof c === 'string' ? c.trim() : c))
    : acceptanceCriteria ? [String(acceptanceCriteria).trim()] : [];
  return `sha256:${createHash('sha256').update(canonicalString(list), 'utf8').digest('hex')}`;
}

/**
 * Validates that a Halo review is fresh and bound to the exact deliverable,
 * acceptance criteria, plan_version, and evidence basis.
 */
export function validateHaloReviewBinding(review, expected = {}) {
  if (!review || typeof review !== 'object' || Array.isArray(review)) {
    return { valid: false, reason: 'Halo review record must be an object' };
  }
  if (!['ACCEPT', 'REVISE', 'ESCALATE'].includes(review.verdict)) {
    return { valid: false, reason: `Invalid Halo verdict '${review.verdict}'` };
  }
  if (review.is_stale === true) {
    return { valid: false, reason: 'Halo review is marked STALE' };
  }
  for (const field of [
    'candidate_id_or_run_id',
    'reviewed_diff_digest',
    'acceptance_criteria_digest',
    'plan_version',
  ]) {
    if (review[field] === undefined || review[field] === null || String(review[field]).trim() === '') {
      return { valid: false, reason: `Halo review missing required binding field '${field}'` };
    }
    if (expected[field] !== undefined && expected[field] !== null && review[field] !== expected[field]) {
      return {
        valid: false,
        reason: `Halo review '${field}' (${review[field]}) does not match current '${expected[field]}' (STALE)`,
      };
    }
  }
  const hasEvidence =
    (typeof review.evidence_basis === 'string' && review.evidence_basis.trim() !== '') ||
    (Array.isArray(review.evidence_basis) && review.evidence_basis.length > 0) ||
    (review.evidence_basis && typeof review.evidence_basis === 'object' && Object.keys(review.evidence_basis).length > 0);
  if (!hasEvidence) {
    return { valid: false, reason: 'Halo review missing non-empty evidence_basis' };
  }
  if (expected.evidence_basis !== undefined && expected.evidence_basis !== null) {
    if (canonicalString(review.evidence_basis) !== canonicalString(expected.evidence_basis)) {
      return { valid: false, reason: 'Halo review evidence_basis changed after review (STALE)' };
    }
  }
  return { valid: true };
}

/**
 * Sole authoritative internal writer for Track L lightweight execution & Halo
 * receipt log (`.ntg/lightweight-runs.jsonl`), cleanly separated from Track S/M
 * durable ledger (`.ntg/ledger.json`).
 */
export class LightweightLog {
  constructor(logPath = '.ntg/lightweight-runs.jsonl') {
    if (typeof logPath !== 'string' || !logPath.trim()) {
      throw new LightweightLogError('LightweightLog requires a non-empty logPath');
    }
    this.logPath = resolve(logPath);
  }

  /**
   * Validates and appends a Track L run record to `.ntg/lightweight-runs.jsonl`.
   */
  recordRun(entry) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new LightweightLogError('Lightweight run entry must be an object');
    }
    const runId = entry.run_id ?? entry.candidate_id_or_run_id;
    if (typeof runId !== 'string' || !runId.trim()) {
      throw new LightweightLogError('Lightweight run entry requires a non-empty run_id');
    }
    if (entry.track !== undefined && entry.track !== 'L') {
      throw new LightweightLogError(`LightweightLog accepts only Track L records, got '${entry.track}'`);
    }
    const isEscalatedZenGo = Boolean(
      entry.escalated_to_ledger &&
      typeof entry.escalated_to_ledger === 'object' &&
      entry.escalated_to_ledger.escalated === true &&
      entry.escalated_to_ledger.zen_verdict === 'GO' &&
      entry.escalated_to_ledger.verified === true
    );
    const expectedBadge = isEscalatedZenGo ? 'ZEN_DURABLE' : 'HALO_LIGHTWEIGHT';
    if (entry.assurance_badge !== undefined && entry.assurance_badge !== expectedBadge) {
      throw new LightweightLogError(
        `LightweightLog requires assurance_badge '${expectedBadge}', got '${entry.assurance_badge}'`
      );
    }

    const status = entry.status || 'COMPLETED';
    const planVersion = entry.plan_version ?? 'v1';

    if (status === 'COMPLETED') {
      const expected = {
        candidate_id_or_run_id: entry.halo_review?.candidate_id_or_run_id ?? runId,
        reviewed_diff_digest: entry.reviewed_diff_digest,
        acceptance_criteria_digest: entry.acceptance_criteria_digest,
        plan_version: planVersion,
        ...(entry.evidence_basis !== undefined ? { evidence_basis: entry.evidence_basis } : {}),
      };
      const binding = validateHaloReviewBinding(entry.halo_review, expected);
      if (!binding.valid) {
        throw new LightweightLogError(`Track L completion requires fresh bound Halo ACCEPT: ${binding.reason}`);
      }
      if (entry.halo_review.verdict !== 'ACCEPT') {
        throw new LightweightLogError(
          `Track L completion requires Halo verdict 'ACCEPT', got '${entry.halo_review.verdict}'`
        );
      }
    }

    const record = Object.freeze({
      run_id: runId,
      track: 'L',
      assurance_badge: expectedBadge,
      status,
      plan_version: planVersion,
      goal: typeof entry.goal === 'string' ? entry.goal : '',
      caller: entry.caller || 'steamroller',
      worker_role: entry.worker_role || null,
      reviewed_diff_digest: entry.reviewed_diff_digest ?? null,
      acceptance_criteria_digest: entry.acceptance_criteria_digest ?? null,
      halo_review: entry.halo_review ? structuredClone(entry.halo_review) : null,
      escalated_to_ledger: entry.escalated_to_ledger ?? null,
      timestamp: entry.timestamp || new Date().toISOString(),
    });

    const dir = dirname(this.logPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    appendFileSync(this.logPath, JSON.stringify(record) + '\n', 'utf8');
    return record;
  }

  /**
   * Reads all recorded Track L entries from disk.
   */
  readAll() {
    if (!existsSync(this.logPath)) return [];
    const text = readFileSync(this.logPath, 'utf8');
    const records = [];
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      records.push(JSON.parse(trimmed));
    }
    return records;
  }

  getByRunId(runId) {
    const all = this.readAll();
    for (let i = all.length - 1; i >= 0; i -= 1) {
      if (all[i]?.run_id === runId) return all[i];
    }
    return null;
  }
}

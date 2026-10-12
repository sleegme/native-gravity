import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AuthoritativeLedger, deepClone, deepFreeze } from './ledger.mjs';
import { acquireLedgerLock } from './ledger-lock.mjs';
import { InvalidHandoffPacketError, InvalidResponseFormatError, invoke, parseResponsePacket } from './runner.mjs';
import { projectFailureRecord, projectFailureTelemetry, redactTelemetryValue } from './telemetry.mjs';

const NEEDS_ALT_MIN_ATTEMPTS = 3;

/**
 * A failure class is the materially-similar failure identity (contract §2.9);
 * the failure signature is the digest of the exact recorded evidence, used to
 * tell whether an attempt contributed anything new.
 */
function failureClassOf(milestoneId, entry) {
  return `${milestoneId}:${entry?.status ?? 'unknown'}:${entry?.evidence?.failed_step?.tool ?? 'unknown'}`;
}

function failureSignatureOf(entry) {
  return `sha256:${createHash('sha256').update(JSON.stringify(entry?.evidence ?? null)).digest('hex')}`;
}

/**
 * Contract §2.9 escalation policy, derived from the durable failure history:
 * NEEDS_ALT is recommended when the same failure class has at least
 * NEEDS_ALT_MIN_ATTEMPTS attempts and the latest attempt recorded no new
 * evidence (its failure signature repeats an earlier attempt in the class).
 * Recommendation only — a paid Instinct call is never auto-run.
 *
 * @param {object} evidence - ledger state `evidence` map
 * @returns {Array<object>} one bounded summary per failure class
 */
export function recommendNeedsAlt(evidence) {
  const byClass = new Map();
  for (const [milestoneId, value] of Object.entries(evidence ?? {})) {
    if (!value || typeof value !== 'object' || !Array.isArray(value.failure_evidence)) continue;
    for (const entry of value.failure_evidence) {
      const failure_class = failureClassOf(milestoneId, entry);
      if (!byClass.has(failure_class)) byClass.set(failure_class, []);
      byClass.get(failure_class).push({ milestoneId, entry });
    }
  }
  const summaries = [];
  for (const [failure_class, attempts] of byClass) {
    const signatures = attempts.map(({ entry }) => failureSignatureOf(entry));
    const latest = signatures[signatures.length - 1];
    const latest_attempt_new_evidence = !signatures.slice(0, -1).includes(latest);
    const last = attempts[attempts.length - 1];
    summaries.push({
      failure_class,
      failure_signature: latest,
      milestone_id: last.milestoneId,
      status: last.entry?.status ?? null,
      tool: last.entry?.evidence?.failed_step?.tool ?? null,
      attempt_count: attempts.length,
      latest_attempt_new_evidence,
      needs_alt_recommended: attempts.length >= NEEDS_ALT_MIN_ATTEMPTS && !latest_attempt_new_evidence,
      attempts: attempts.map(({ milestoneId, entry }) => projectFailureRecord(entry, milestoneId)),
    });
  }
  return summaries;
}

/** Most recent recommended class, else the most recent failing class. */
function selectAltTarget(summaries, milestoneId) {
  const scoped = (milestoneId ? summaries.filter(s => s.milestone_id === milestoneId) : summaries)
    .slice()
    .sort((a, b) => String(a.attempts.at(-1)?.timestamp ?? '')
      .localeCompare(String(b.attempts.at(-1)?.timestamp ?? '')));
  const recommended = scoped.filter(s => s.needs_alt_recommended);
  return recommended[recommended.length - 1] ?? scoped[scoped.length - 1] ?? null;
}

/**
 * Steamroller's coordinator and the default vNext runtime (44G, #134), driven
 * by `scripts/ntg-vnext.mjs`. The exact-role adapter uses invoke(role, packet, options) and
 * returns {ok, response}. Bulldozer milestone packets may invoke specialists:
 * Jaguar (retrieval), Puma (mechanical), Bobcat (implementation), Excavator
 * (diagnosis/repair). Strix Halo
 * advises Bobcat locally. invokeZen is a required independent host-native call
 * returning Zen's packet, never a worker's relay. Specialists receive only
 * relevant milestone slices, never the ledger API, path, or global authority.
 */
export class MinimalSpine {
  #ledger;
  #path;
  #invokeRole;
  #invokeZen;
  #invokeSpecialist;
  #runnerOptions;
  #busy = false;
  #releaseLock;

  constructor({ ledgerPath, plan, invokeRole = invoke, invokeZen, invokeSpecialist, runnerOptions = {}, handleSignals = true }) {
    if (typeof ledgerPath !== 'string' || !ledgerPath.trim()) {
      throw new TypeError('A supervisor-owned ledgerPath is required');
    }
    if (typeof invokeZen !== 'function') {
      throw new TypeError('An independent native Zen invocation is required');
    }
    this.#path = ledgerPath;
    this.#invokeRole = invokeRole;
    this.#invokeZen = invokeZen;
    this.#invokeSpecialist = invokeSpecialist;
    this.#runnerOptions = runnerOptions;
    // Callers embedding a spine (daemon, test harness) can opt out of
    // SIGINT/SIGTERM/SIGHUP ownership via handleSignals:false; the lock's
    // exit-cleanup still runs either way.
    this.#releaseLock = acquireLedgerLock(ledgerPath, { handleSignals });
    try {
      if (plan !== undefined) {
        if (existsSync(ledgerPath)) throw new Error('Refusing to replace an existing ledger');
        this.#ledger = new AuthoritativeLedger(plan);
        this.#ledger.save(this.#path);
      } else {
        this.#ledger = AuthoritativeLedger.load(ledgerPath);
      }
    } catch (error) {
      this.close();
      throw error;
    }
  }

  /** Explicitly end ownership before another supervisor resumes this ledger. */
  close() {
    if (this.#busy) throw new Error('Cannot close during an active invocation');
    this.#releaseLock?.();
    this.#releaseLock = undefined;
  }

  #open() {
    if (!this.#releaseLock) throw new Error('Spine is closed');
  }

  get state() {
    return deepFreeze(deepClone(this.#ledger.getState()));
  }

  #idle() {
    this.#open();
    if (this.#busy || this.state.current_milestone !== null) {
      throw new Error('Execution or review is already active');
    }
  }

  /**
   * Attaches tier-B failed-step telemetry to an error thrown by a step.
   * The telemetry object records the tool name and args/command line of the
   * failed step (never prompt text); the spine catch persists it with the
   * ledger failure record for later Piledriver replan visibility (#114).
   */
  async #step(failedStep, thunk) {
    try {
      return await thunk();
    } catch (error) {
      if (error && typeof error === 'object' && error.failedStep === undefined) {
        error.failedStep = failedStep;
      }
      throw error;
    }
  }

  /**
   * Builds the agy command line for a failed transport invocation with the
   * --print prompt value withheld — the prompt is tier-C material and must
   * never enter failure telemetry (#114).
   */
  #transportCommand(role, slug) {
    const parts = ['agy', '--model', slug ?? '<unresolved>', '--output-format', 'json'];
    if (role === 'bulldozer') parts.push('--dangerously-skip-permissions');
    parts.push('--print', '(prompt withheld)');
    return parts.join(' ');
  }

  async #exact(role, instruction, contract, invokeOptions = {}) {
    // The runner retains task text, not arbitrary packet fields. Serialize the
    // whole contract into task so bounded prompt construction keeps its fields.
    const output = await this.#step(
      { tool: 'runner.invoke', args: { role } },
      () => this.#invokeRole(role, {
        task: instruction + '\n' + JSON.stringify(contract),
      }, {
        ...this.#runnerOptions,
        ...invokeOptions,
        invokeSpecialist: (r, s, o) => this.invokeSpecialist(r, s, o),
      })
    );
    if (!output?.ok) {
      const error = new Error(`${role} invocation failed: ${JSON.stringify(output)}`);
      error.failedStep = {
        tool: 'runner.invoke',
        args: { role, slug: output?.slug ?? null, error: output?.error ?? null },
        command: this.#transportCommand(role, output?.slug),
      };
      throw error;
    }
    const parsed = parseResponsePacket(output);
    if (!parsed.ok) {
      const error = new Error(`${role} invocation failed: ${JSON.stringify(parsed)}`);
      error.failedStep = {
        tool: 'runner.invoke',
        args: { role, slug: parsed?.slug ?? null, error: parsed?.error ?? null },
      };
      throw error;
    }
    return parsed.packet;
  }

  /**
   * 44F specialist routing under an active milestone.
   * Bulldozer milestone packets may invoke:
   *   - jaguar (retrieval)
   *   - puma (mechanical worker)
   *   - bobcat (bounded implementation)
   *   - excavator (difficult diagnosis/repair worker)
   * Bobcat may invoke:
   *   - strix-halo (Bobcat-local implementation advisor)
   * Excavator has no nested delegation and never invokes Zen.
   * Specialists receive the milestone packet's relevant slice, never the ledger
   * or global authority. Outputs flow back without touching ledger state directly.
   */
  async invokeSpecialist(roleOrOpts, maybeSlice, maybeOptions = {}) {
    this.#open();
    let role, slice, options;
    if (typeof roleOrOpts === 'object' && roleOrOpts !== null && !Array.isArray(roleOrOpts) && maybeSlice === undefined) {
      role = roleOrOpts.role;
      slice = roleOrOpts.slice ?? roleOrOpts.packet ?? roleOrOpts.task ?? {};
      options = roleOrOpts;
    } else {
      role = roleOrOpts;
      slice = maybeSlice ?? {};
      options = maybeOptions ?? {};
    }
    const caller = typeof options === 'string' ? options : (options?.caller ?? 'bulldozer');

    const activeMilestoneId = this.state.current_milestone;
    if (activeMilestoneId === null) {
      throw new Error('Specialist invocation requires an active milestone');
    }

    const normalizedRole = typeof role === 'string' ? role.trim().toLowerCase() : '';
    const normalizedCaller = typeof caller === 'string' ? caller.trim().toLowerCase() : '';
    const targetRole = normalizedRole === 'strix_halo' ? 'strix-halo' : normalizedRole;
    const callerRole = normalizedCaller === 'strix_halo' ? 'strix-halo' : normalizedCaller;

    const SPECIALIST_ROLES = ['jaguar', 'puma', 'bobcat', 'excavator', 'strix-halo'];
    if (!SPECIALIST_ROLES.includes(targetRole)) {
      throw new TypeError(`Unknown or disallowed specialist role: "${role}"`);
    }

    // Role boundary routing for injected adapters only. Runtime delegation is
    // native to agy: runner.invoke()/invokeTransport() do not consume the
    // invokeSpecialist callback. These routing, authority and slicing checks are
    // advisory for native runs; runMilestone checks declared delegations post-hoc,
    // not as interception or proof that undeclared native calls did not occur.
    if (callerRole === 'bulldozer') {
      if (targetRole === 'strix-halo') {
        throw new Error('Strix Halo is a Bobcat-local advisor gate; Bulldozer cannot invoke Strix Halo directly');
      }
      if (!['jaguar', 'puma', 'bobcat', 'excavator'].includes(targetRole)) {
        throw new Error(`Bulldozer cannot invoke "${targetRole}"`);
      }
    } else if (callerRole === 'bobcat') {
      if (targetRole !== 'strix-halo') {
        throw new Error(`Bobcat may invoke only Strix Halo; cannot invoke "${targetRole}"`);
      }
    } else if (['jaguar', 'puma', 'excavator', 'strix-halo'].includes(callerRole)) {
      throw new Error(`Specialist "${callerRole}" has no delegation authority and cannot invoke subagents`);
    } else {
      throw new Error(`Caller "${caller}" is not authorized to invoke specialists under a milestone`);
    }

    if (typeof slice === 'string') {
      slice = { task: slice };
    } else if (typeof slice !== 'object' || slice === null || Array.isArray(slice)) {
      throw new TypeError('Specialist slice must be an object or task string');
    }

    // Prohibit passing ledger or global authority to specialists
    const FORBIDDEN_KEYS = [
      'ledger', 'ledgerPath', 'save', 'declareGlobalCompletion',
      'completed_milestones', 'verdict', 'zen_verdict', 'result_ref',
    ];
    for (const key of FORBIDDEN_KEYS) {
      if (key in slice && slice[key] !== undefined) {
        throw new Error(`Specialists cannot receive ledger or global authority: "${key}" is prohibited`);
      }
    }

    // Bounded milestone slice: relevant fields only, never ledger internals
    const activeMilestone = this.state.milestones.find(m => m.id === activeMilestoneId);
    const milestoneSlice = activeMilestone ? {
      milestone_id: activeMilestone.id,
      plan_version: this.state.plan_version,
      objective: activeMilestone.objective,
      bounded_scope: activeMilestone.bounded_scope,
      non_goals: activeMilestone.non_goals,
      acceptance_criteria: activeMilestone.acceptance_criteria,
      constraints: this.state.constraints,
    } : {
      milestone_id: activeMilestoneId,
      plan_version: this.state.plan_version,
    };

    const packet = deepFreeze(deepClone({
      ...milestoneSlice,
      ...slice,
      milestone_id: activeMilestoneId,
      plan_version: this.state.plan_version,
    }));

    const failedStep = {
      tool: 'invoke_subagent',
      args: { role: targetRole, caller: callerRole, slice_keys: Object.keys(packet).sort() },
    };

    return this.#step(failedStep, async () => {
      let result;
      if (this.#invokeSpecialist) {
        result = await this.#invokeSpecialist(targetRole, packet, options);
      } else if (this.#invokeRole) {
        result = await this.#invokeRole(targetRole, packet, this.#runnerOptions);
      } else {
        throw new Error(`No invocation adapter available for specialist "${targetRole}"`);
      }

      if (typeof result === 'string') {
        result = { ok: true, response: result };
      }
      if (result && typeof result === 'object') {
        if (result.ok === false) {
          throw new Error(`${targetRole} invocation failed: ${JSON.stringify(result)}`);
        }
        if (typeof result.response === 'string') {
          // Same fail-closed packet boundary as #exact; raw prose is never passed through.
          const parsed = parseResponsePacket(result);
          if (!parsed.ok) {
            throw new InvalidResponseFormatError(targetRole, parsed.error);
          }
          return deepFreeze(deepClone(parsed.packet));
        }
        return deepFreeze(deepClone(result));
      }
      return result;
    });
  }

  async invokeJaguar(slice, options = {}) {
    return this.invokeSpecialist('jaguar', slice, options);
  }

  async invokePuma(slice, options = {}) {
    return this.invokeSpecialist('puma', slice, options);
  }

  async invokeBobcat(slice, options = {}) {
    return this.invokeSpecialist('bobcat', slice, options);
  }

  async invokeStrixHalo(slice, options = {}) {
    const caller = typeof options === 'string' ? options : (options?.caller ?? 'bobcat');
    return this.invokeSpecialist('strix-halo', slice, typeof options === 'object' ? { ...options, caller } : { caller });
  }

  /**
   * Builds the tier-B replanning context exposed to Piledriver (NTG #114,
   * PO-selected option B). Tier B carries which artifact/lane failed plus the
   * failed step's tool and args/command line — never prompt text, raw worker
   * candidate packets, or Zen verdict detail blobs (tier C, not selected).
   * Verification records are projected to verdict summaries; failure records
   * to telemetry. Sensitive values pass through the documented redaction list.
   */
  buildReplanContext() {
    const state = this.state;
    const verification_summary = {};
    for (const [key, record] of Object.entries(state.verification ?? {})) {
      if (!record || typeof record !== 'object') continue;
      verification_summary[key] = {
        verdict: record.verdict ?? null,
        plan_version: record.plan_version ?? null,
        result_ref: record.result_ref ?? null,
        is_stale: record.is_stale ?? null,
        repair_needs: record.repair_needs ?? null,
        timestamp: record.timestamp ?? null,
      };
    }
    return deepFreeze(deepClone(redactTelemetryValue({
      telemetry_tier: 'B',
      goal: state.goal,
      constraints: state.constraints,
      plan_version: state.plan_version,
      milestones: state.milestones,
      current_milestone: state.current_milestone,
      completed_milestones: state.completed_milestones,
      decision_invariants: state.decision_invariants,
      blockers: state.blockers,
      next_action: state.next_action,
      failure_telemetry: projectFailureTelemetry(state.evidence),
      verification_summary,
    })));
  }

  /** A planning response is advice; only explicit supervisor adoption changes state. */
  async requestPlan(task) {
    this.#idle();
    if (typeof task !== 'string' || !task.trim()) throw new TypeError('Planning task required');
    this.#busy = true;
    try {
      return await this.#exact('piledriver',
        'Return a bounded advisory plan as JSON. Do not implement, delegate workers, '
        + 'write ledger state, or claim completion. You have no shell: never run commands '
        + '(including git or grep); inspect only with read-only file tools (view_file, '
        + 'list_dir, find_by_name, grep_search) and put command-based checks in the plan.',
        { task, replan_context: this.buildReplanContext() });
    } finally {
      this.#busy = false;
    }
  }

  /**
   * NEEDS_ALT (contract §2.9, §2.10): invokes Instinct with a bounded packet
   * derived from the durable failure history and records the returned framing
   * as advisory evidence. Advisory only — it never promotes, adopts or changes
   * completion state. `escalate` is the only path to the Opus tier.
   */
  async requestAltFraming(task, options = {}) {
    this.#idle();
    if (typeof task !== 'string' || !task.trim()) throw new TypeError('Alternate-framing task required');
    const milestoneId = options.milestone ?? null;
    if (milestoneId !== null && !this.state.milestones.some(m => m.id === milestoneId)) {
      throw new TypeError(`Unknown milestone for NEEDS_ALT context: "${milestoneId}"`);
    }
    const target = selectAltTarget(recommendNeedsAlt(this.state.evidence), milestoneId);
    const contract = {
      task: task.trim(),
      needs_alt: {
        milestone_id: milestoneId,
        failure_class: target?.failure_class ?? 'unknown',
        failure_signature: target?.failure_signature ?? 'unknown',
        current_hypothesis:
          typeof options.current_hypothesis === 'string' && options.current_hypothesis.trim()
            ? options.current_hypothesis.trim()
            : 'UNKNOWN',
        attempt_count: target?.attempt_count ?? 0,
        evidence: target?.attempts ?? [],
      },
      replan_context: this.buildReplanContext(),
    };
    this.#busy = true;
    try {
      const advice = await this.#exact('instinct',
        'Return a bounded alternate-framing advisory as JSON: current framing, why it '
        + 'may be wrong, materially different hypotheses (each with evidence basis '
        + 'OBSERVED/INFERRED/UNKNOWN and a discriminating test), recommendation and '
        + 'unknowns. Advisory only: do not implement, delegate workers, write ledger '
        + 'state, adopt a plan or claim completion or a verdict. You have no shell: '
        + 'never run commands; inspect only with read-only file tools (view_file, '
        + 'list_dir, find_by_name, grep_search) and put command-based checks in the '
        + 'advice.',
        contract,
        { escalate: options.escalate === true });
      this.#ledger.recordAltAdvice({
        milestone_id: milestoneId, task: task.trim(), needs_alt: contract.needs_alt, advice,
      });
      this.#ledger.save(this.#path);
      return deepFreeze(deepClone(advice));
    } finally {
      this.#busy = false;
    }
  }

  /** DONE is explicit candidate status, never automatic verified completion. */
  async runMilestone(milestoneId) {
    this.#idle();
    const contract = this.#ledger.delegate(milestoneId);
    this.#ledger.save(this.#path);
    this.#busy = true;
    try {
      const candidate = await this.#exact('bulldozer',
        'Execute only this milestone. Delegate bounded work to specialists by kind: '
        + 'Jaguar for read-only factual retrieval, Puma for low-risk writing and '
        + 'mechanical text/config edits, Bobcat for bounded implementation, and '
        + 'Excavator for difficult broken-behavior diagnosis/repair. '
        + 'For Bobcat, set ADVISOR_GATE REQUIRED for substantive work or NONE only '
        + 'for low-risk mechanical work; Bobcat may invoke only Strix Halo when required. '
        + 'Puma and Jaguar have no subagents and Puma has no advisor ceremony. '
        + 'Excavator has no nested delegation and must not invoke Zen. '
        + 'If a required specialist is unavailable, return BLOCKED, not a gate waiver. '
        + 'Inspect specialist results and actual evidence yourself. Worker READY and '
        + 'Strix ACCEPT are not DONE. Return your own JSON result packet with '
        + 'milestone_id, plan_version, explicit status DONE|BLOCKED|NEEDS_DEEP, '
        + 'changes_made, verification_evidence, unresolved_unknowns, scope_deviations, '
        + 'blockers and escalation_needs as applicable. DONE must identify immutable '
        + 'delivered artifact versions in candidate_artifact_ref. Do not invoke Zen, '
        + 'supply Zen authority, write the ledger, or claim global completion.', contract);

      if (candidate.milestone_id !== contract.milestone_id
          || candidate.plan_version !== contract.plan_version) {
        throw new Error('Candidate does not match the active milestone and plan');
      }
      // The runner loads the bounded vNext Bulldozer contract, not a released
      // primary agent: Jaguar, Puma, Bobcat and Excavator are milestone children.
      if ('delegations' in candidate) {
        if (!Array.isArray(candidate.delegations)) {
          throw new InvalidHandoffPacketError('Bulldozer delegations must be an array');
        }
        for (const delegation of candidate.delegations) {
          if (!delegation || typeof delegation !== 'object' || Array.isArray(delegation)
              || typeof delegation.role !== 'string' || !delegation.role.trim()) {
            throw new InvalidHandoffPacketError('Each Bulldozer delegation must have a non-empty role');
          }
          const role = delegation.role.trim().toLowerCase();
          if (!['jaguar', 'puma', 'bobcat', 'excavator'].includes(role)) {
            throw new InvalidHandoffPacketError(`Bulldozer cannot delegate to "${role}" within a milestone`);
          }
        }
      }
      // Preserve ingress status. Missing status, READY, and local advisor verdicts
      // cannot be normalized to DONE or used to skip the independent review.
      if (candidate.status === 'BLOCKED' || candidate.status === 'NEEDS_DEEP') {
        this.#ledger.recordBlockedOrFailure({
          milestoneId, status: candidate.status, blockers: candidate.blockers,
          escalationNeeds: candidate.escalation_needs, evidence: candidate,
        });
        this.#ledger.save(this.#path);
        return { status: candidate.status, candidate: deepClone(candidate), verified: false };
      }
      if (candidate.status !== 'DONE') {
        throw new Error('Only explicit Bulldozer DONE may enter Zen review');
      }
      if ('verdict' in candidate || 'zen_verdict' in candidate || 'result_ref' in candidate) {
        throw new Error('Bulldozer cannot issue result references or Zen authority');
      }
      if (typeof candidate.candidate_artifact_ref !== 'string'
          || !candidate.candidate_artifact_ref.trim()) {
        throw new Error('DONE must bind immutable delivered artifact versions');
      }
      const { result_ref, candidate_record } = this.#ledger.receiveCandidate(candidate);
      // The immutable candidate binding must be durable before Zen is invoked.
      this.#ledger.save(this.#path);
      const request = deepFreeze(deepClone({
        milestone_id: contract.milestone_id,
        plan_version: contract.plan_version,
        result_ref,
        contract,
        candidate: candidate_record,
      }));
      const verdict = deepClone(await this.#step(
        { tool: 'zen_review', args: { milestone_id: contract.milestone_id, plan_version: contract.plan_version, result_ref } },
        () => this.#invokeZen(request)
      ));
      if (verdict?.verdict !== 'GO' && verdict?.verdict !== 'NO-GO') {
        throw new Error('Zen must return an observed GO or NO-GO');
      }
      if (verdict.milestone_id !== contract.milestone_id
          || verdict.plan_version !== contract.plan_version
          || verdict.result_ref !== result_ref) {
        throw new Error('Zen verdict does not match the current candidate binding');
      }
      if (!Array.isArray(verdict.verification_evidence)
          || !verdict.verification_evidence.length
          || !verdict.verification_evidence.every(item => item?.classification === 'OBSERVED')) {
        throw new Error('Zen must supply directly observed verification evidence');
      }
      if (verdict.verdict === 'NO-GO'
          && (typeof verdict.repair_needs !== 'string' || !verdict.repair_needs.trim())) {
        throw new InvalidHandoffPacketError('Zen NO-GO must supply non-empty repair_needs');
      }
      if (verdict.verdict === 'GO') this.#ledger.recordZenGo(verdict);
      else this.#ledger.recordZenNoGo(verdict);
      this.#ledger.save(this.#path);
      return { status: 'DONE', result_ref, verdict, verified: verdict.verdict === 'GO' };
    } catch (error) {
      if (this.state.current_milestone === milestoneId) {
        const errorText = String(error);
        const evidence = { classification: 'OBSERVED', error: errorText };
        const bytes = Buffer.from(errorText, 'utf8');
        const MAX_ERROR_BYTES = 8 * 1024;
        if (bytes.length > MAX_ERROR_BYTES) {
          const digest = createHash('sha256').update(bytes).digest('hex');
          const transcriptDir = `${this.#path}.transcripts`;
          mkdirSync(transcriptDir, { recursive: true });
          evidence.transcript_ref = join(transcriptDir, `${digest}.txt`);
          writeFileSync(evidence.transcript_ref, bytes);
          const marker = `\n[truncated ${bytes.length} bytes; sha256:${digest}]\n`;
          // Reserve UTF-8 decoding slack at both cut boundaries.
          const previewBytes = Math.floor((MAX_ERROR_BYTES - Buffer.byteLength(marker)) / 2) - 3;
          evidence.error = bytes.subarray(0, previewBytes).toString('utf8')
            + marker + bytes.subarray(-previewBytes).toString('utf8');
          evidence.error_digest = `sha256:${digest}`;
        }
        this.#ledger.recordBlockedOrFailure({
          milestoneId, status: 'INVOCATION_FAILURE',
          evidence: error?.failedStep
            ? { ...evidence, failed_step: error.failedStep }
            : evidence,
        });
        this.#ledger.save(this.#path);
      }
      throw error;
    } finally {
      this.#busy = false;
    }
  }

  /** Fresh-context recovery needs observed interruption, not a silent retry. */
  endInterruptedInvocation(evidence) {
    this.#open();
    if (this.#busy) throw new Error('Cannot interrupt a live invocation through resume recovery');
    if (evidence?.classification !== 'OBSERVED') throw new Error('Observed interruption evidence required');
    const milestoneId = this.state.current_milestone;
    if (milestoneId === null) throw new Error('No interrupted invocation');
    this.#ledger.recordBlockedOrFailure({ milestoneId, status: 'INVOCATION_FAILURE', evidence });
    this.#ledger.save(this.#path);
  }

  adoptReplan(plan) {
    this.#idle();
    this.#ledger.materialReplan(plan);
    this.#ledger.save(this.#path);
    return this.state;
  }

  resolveBlocker(id, evidence) {
    this.#idle();
    if (evidence?.classification !== 'OBSERVED') throw new Error('Observed resolution evidence required');
    const resolution = this.#ledger.resolveBlocker(id, evidence);
    this.#ledger.save(this.#path);
    return resolution;
  }

  declareGlobalCompletion() {
    this.#idle();
    return this.#ledger.declareGlobalCompletion();
  }
}

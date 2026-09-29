import { existsSync } from 'node:fs';
import { AuthoritativeLedger, deepClone, deepFreeze } from './ledger.mjs';
import { invoke } from './runner.mjs';

/**
 * Isolated 44E coordinator owned by Steamroller; not a default runtime entry or
 * 44G activation. The exact-role adapter uses invoke(role, packet, options) and
 * returns {ok, response}. Bobcat remains native inside Bulldozer's invocation.
 * invokeZen is a required independent host-native call returning Zen's packet,
 * never a worker's relay. Children receive neither the ledger API nor its path.
 */
export class MinimalSpine {
  #ledger;
  #path;
  #invokeRole;
  #invokeZen;
  #runnerOptions;
  #busy = false;

  constructor({ ledgerPath, plan, invokeRole = invoke, invokeZen, runnerOptions = {} }) {
    if (typeof ledgerPath !== 'string' || !ledgerPath.trim()) {
      throw new TypeError('A supervisor-owned ledgerPath is required');
    }
    if (typeof invokeZen !== 'function') {
      throw new TypeError('An independent native Zen invocation is required');
    }
    this.#path = ledgerPath;
    this.#invokeRole = invokeRole;
    this.#invokeZen = invokeZen;
    this.#runnerOptions = runnerOptions;
    if (plan !== undefined) {
      if (existsSync(ledgerPath)) throw new Error('Refusing to replace an existing ledger');
      this.#ledger = new AuthoritativeLedger(plan);
      this.#ledger.save(this.#path);
    } else {
      this.#ledger = AuthoritativeLedger.load(ledgerPath);
    }
  }

  get state() {
    return deepFreeze(deepClone(this.#ledger.getState()));
  }

  #idle() {
    if (this.#busy || this.state.current_milestone !== null) {
      throw new Error('Execution or review is already active');
    }
  }

  async #exact(role, instruction, contract) {
    // The runner retains task text, not arbitrary packet fields. Serialize the
    // whole contract into task so bounded prompt construction keeps its fields.
    const output = await this.#invokeRole(role, {
      task: instruction + '\n' + JSON.stringify(contract),
    }, this.#runnerOptions);
    if (!output?.ok) {
      throw new Error(`${role} invocation failed: ${JSON.stringify(output)}`);
    }
    const packet = JSON.parse(output.response);
    if (!packet || typeof packet !== 'object' || Array.isArray(packet)) {
      throw new TypeError(`${role} must return a JSON object`);
    }
    return packet;
  }

  /** A planning response is advice; only explicit supervisor adoption changes state. */
  async requestPlan(task) {
    this.#idle();
    if (typeof task !== 'string' || !task.trim()) throw new TypeError('Planning task required');
    this.#busy = true;
    try {
      return await this.#exact('piledriver',
        'Return a bounded advisory plan as JSON. Do not implement, delegate workers, '
        + 'write ledger state, or claim completion.', { task, ledger: this.state });
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
        'Execute only this milestone. Delegate bounded implementation to native '
        + 'Bobcat; set ADVISOR_GATE REQUIRED for substantive work or NONE only for '
        + 'low-risk mechanical work. Bobcat may invoke only Strix Halo when required. '
        + 'If a required specialist is unavailable, return BLOCKED, not a gate waiver. '
        + 'Inspect Bobcat results and actual evidence yourself. Worker READY and '
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
      const verdict = deepClone(await this.#invokeZen(request));
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
      if (verdict.verdict === 'GO') this.#ledger.recordZenGo(verdict);
      else this.#ledger.recordZenNoGo(verdict);
      this.#ledger.save(this.#path);
      return { status: 'DONE', result_ref, verdict, verified: verdict.verdict === 'GO' };
    } catch (error) {
      if (this.state.current_milestone === milestoneId) {
        this.#ledger.recordBlockedOrFailure({
          milestoneId, status: 'INVOCATION_FAILURE',
          evidence: { classification: 'OBSERVED', error: String(error) },
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

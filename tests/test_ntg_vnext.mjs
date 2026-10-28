import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { main, nativeZen, parseZenEnvelope } from '../scripts/ntg-vnext.mjs';
import { AuthoritativeLedger, computeUsageRollup } from '../scripts/ledger.mjs';
import { execFileSync, spawnSync } from 'node:child_process';
import { symlinkSync } from 'node:fs';

const CLI = new URL('../scripts/ntg-vnext.mjs', import.meta.url).pathname;
import { parseResponseEnvelope, parseResponsePacket } from '../scripts/runner.mjs';

const observed = [{ classification: 'OBSERVED', criterion: 'content', result: 'inspected' }];
const plan = (version = 'v1', ids = ['one', 'two']) => ({
  goal: 'Deliver bounded artifacts', constraints: [], decision_invariants: [], plan_version: version,
  milestones: ids.map((id, index) => ({
    id, title: id, objective: `Deliver ${id}`, bounded_scope: [`${id}.txt`],
    acceptance_criteria: ['content matches'], non_goals: [], dependencies: index ? [ids[index - 1]] : [],
  })),
});
const envelope = value => parseResponseEnvelope(JSON.stringify({ status: 'SUCCESS', response: JSON.stringify(value) }));

function harness(t, { zen = () => 'GO' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ntg-vnext-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ledger = join(dir, 'ledger.json');
  const calls = [];
  const timeouts = [];
  const escalations = [];
  const contracts = [];
  const deps = {
    handleSignals: false,
    invokeRole: async (role, packet, runnerOptions = {}) => {
      calls.push(role);
      timeouts.push(runnerOptions.timeout);
      escalations.push(runnerOptions.escalate === true);
      if (role === 'piledriver') return envelope({ recommendation: 'advisory only' });
      const contract = JSON.parse(packet.task.slice(packet.task.indexOf('\n') + 1));
      contracts.push(contract);
      if (role === 'instinct') {
        return envelope({
          current_framing: 'stalled framing',
          why_current_framing_may_be_wrong: 'untested assumption',
          alternate_hypotheses: [{ hypothesis: 'alt', evidence_basis: 'OBSERVED', discriminating_test: 'run X' }],
          recommendation: 'run X',
          unknowns: [],
        });
      }
      return envelope({
        milestone_id: contract.milestone_id, plan_version: contract.plan_version, status: 'DONE',
        changes_made: contract.bounded_scope, verification_evidence: observed, unresolved_unknowns: [],
        scope_deviations: [], candidate_artifact_ref: `sha256:${contract.milestone_id}`,
      });
    },
    invokeZen: async request => {
      calls.push(`zen:${request.milestone_id}`);
      const verdict = zen(request);
      return {
        milestone_id: request.milestone_id, plan_version: request.plan_version, result_ref: request.result_ref,
        verdict, verification_evidence: observed, ...(verdict === 'NO-GO' ? { repair_needs: 'fix content' } : {}),
      };
    },
  };
  const write = (name, value) => { const p = join(dir, name); writeFileSync(p, JSON.stringify(value)); return p; };
  // Each call is a fresh process-equivalent context: state comes only from the ledger file.
  const cli = (...argv) => main([argv[0], '--ledger', ledger, ...argv.slice(1)], deps);
  return { cli, calls, timeouts, escalations, contracts, write, ledger };
}

test('run --all promotes milestones in dependency order and declares completion only after each Zen GO', async t => {
  const h = harness(t);
  await h.cli('init', '--plan', h.write('plan.json', plan()));
  const { code, out } = await h.cli('run', '--all');
  assert.equal(code, 0);
  assert.deepEqual(h.calls, ['bulldozer', 'zen:one', 'bulldozer', 'zen:two']);
  assert.deepEqual(out.state.completed_milestones, ['one', 'two']);
  assert.ok(out.global_completion);
});

for (const status of ['BLOCKED', 'NEEDS_DEEP']) {
  test(`disabled repair capability returns ${status} through the existing durable ledger path`, async t => {
    const h = harness(t);
    await h.cli('init', '--plan', h.write('plan.json', plan('v1', ['one'])));
    const calls = [];
    const deps = {
      handleSignals: false,
      runnerOptions: { installedModels: ['gemini-3.8-flash-high'] },
      invokeRole: async (role, packet) => {
        calls.push(role);
        const contract = JSON.parse(packet.task.slice(packet.task.indexOf('\n') + 1));
        return envelope({
          milestone_id: contract.milestone_id, plan_version: contract.plan_version,
          status, changes_made: [], verification_evidence: observed,
          unresolved_unknowns: ['root cause requires unavailable repair capability'],
          scope_deviations: [],
          blockers: ['Reproduction persists after bounded Bobcat remediation; Excavator is unavailable'],
          escalation_needs: ['Diagnose the failed invariant without weakening acceptance'],
        });
      },
      invokeSpecialist: () => assert.fail('must not dispatch a disabled repair worker'),
      invokeZen: () => assert.fail('blocked or escalated work must not reach Zen'),
    };
    const result = await main(['run', '--ledger', h.ledger], deps);
    assert.equal(result.code, 2);
    assert.deepEqual(calls, ['bulldozer']);
    const state = AuthoritativeLedger.load(h.ledger).getState();
    assert.equal(state.current_milestone, null);
    assert.deepEqual(state.completed_milestones, []);
    assert.deepEqual(state.verification, {});
    assert.equal(state.blockers.length, 1);
    assert.match(state.blockers[0].description, /Excavator is unavailable/);
    assert.equal(state.evidence.one.failure_evidence[0].status, status);
    assert.deepEqual(state.evidence.one.failure_evidence[0].evidence.verification_evidence, observed);
    assert.deepEqual(state.evidence.one.failure_evidence[0].escalation_needs,
      ['Diagnose the failed invariant without weakening acceptance']);
    assert.deepEqual(state.usage.one.map(entry => entry.role), ['bulldozer']);
    assert.deepEqual((await h.cli('status')).out.state, state);
  });
}

test('Zen NO-GO stops the run with exit 2, leaves the milestone incomplete, and a rerun needs a fresh GO', async t => {
  let verdicts = ['NO-GO', 'GO'];
  const h = harness(t, { zen: () => verdicts.shift() });
  await h.cli('init', '--plan', h.write('plan.json', plan('v1', ['one'])));
  const first = await h.cli('run');
  assert.equal(first.code, 2);
  assert.deepEqual(first.out.state.completed_milestones, []);
  assert.equal(first.out.global_completion, undefined);
  const second = await h.cli('run');
  assert.equal(second.code, 0);
  assert.deepEqual(second.out.state.completed_milestones, ['one']);
  assert.deepEqual(h.calls, ['bulldozer', 'zen:one', 'bulldozer', 'zen:one']);
});

test('fresh-context resume continues from the ledger at the next eligible milestone', async t => {
  const h = harness(t);
  await h.cli('init', '--plan', h.write('plan.json', plan()));
  await h.cli('run');
  const status = await h.cli('status');
  assert.equal(status.out.next_milestone, 'two');
  const resumed = await h.cli('run');
  assert.deepEqual(resumed.out.results.map(r => r.milestone_id), ['two']);
  assert.ok(resumed.out.global_completion);
});

test('material replan increments plan_version, clears completion, and requires fresh review', async t => {
  const h = harness(t);
  await h.cli('init', '--plan', h.write('plan.json', plan()));
  await h.cli('run', '--all');
  const { out } = await h.cli('replan', '--plan', h.write('plan2.json', plan('v2', ['one'])));
  assert.equal(out.state.plan_version, 'v2');
  assert.deepEqual(out.state.completed_milestones, []);
  const rerun = await h.cli('run');
  assert.equal(rerun.out.results[0].verdict.plan_version, 'v2');
  assert.ok(rerun.out.global_completion);
});

// A real supervisor (ntg-vnext main) takes the ledger lock, marks a milestone
// active and spawns a detached executor the way the runner does (own process
// group, inherited env). The supervisor is then SIGKILLed; the executor survives.
async function killedSupervisor(h, t) {
  const dir = mkdtempSync(join(tmpdir(), 'ntg-vnext-holder-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const holder = join(dir, 'holder.mjs');
  writeFileSync(holder, `import { spawn } from 'node:child_process';
import { main } from ${JSON.stringify(CLI)};
const invokeRole = () => {
  const executor = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1 << 30)'], { detached: true, stdio: 'ignore' });
  process.send({ executor: executor.pid });
  return new Promise(() => {});
};
main(['run', '--ledger', process.argv[2]], { invokeRole, invokeZen: () => {}, handleSignals: false });
setInterval(() => {}, 1 << 30); // a pending promise alone does not keep the loop alive
`);
  const child = fork(holder, [h.ledger], { stdio: 'ignore' });
  const [message] = await once(child, 'message', { signal: AbortSignal.timeout(10000) });
  t.after(() => { try { process.kill(message.executor, 'SIGKILL'); } catch {} });
  return { child, executor: message.executor };
}

const terminated = pid => {
  try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') return true; throw error; }
  try { return readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].startsWith('Z'); } catch { return true; }
};

test('recover removes a lock whose owner was killed, then resume completes from the ledger', async t => {
  const h = harness(t);
  await h.cli('init', '--plan', h.write('plan.json', plan('v1', ['one'])));
  const { child, executor } = await killedSupervisor(h, t);
  child.kill('SIGKILL');
  await once(child, 'exit', { signal: AbortSignal.timeout(10000) });
  assert.ok(existsSync(`${h.ledger}.lock`));
  assert.equal(terminated(executor), false, 'executor outlives its killed supervisor');
  await assert.rejects(h.cli('status'), /already exists/);
  const recovered = await h.cli('recover', '--evidence', 'supervisor SIGKILLed mid-invocation');
  assert.equal(recovered.out.stale_lock_removed.dead_owner_pid, child.pid);
  assert.deepEqual(recovered.out.stale_lock_removed.terminated_executors, [executor]);
  assert.ok(terminated(executor), 'recover must end the old executor before releasing the milestone');
  assert.equal(recovered.out.state.current_milestone, null);
  const resumed = await h.cli('run');
  assert.equal(resumed.code, 0);
  assert.ok(resumed.out.global_completion);
});

test('recover refuses to remove a lock held by a live supervisor', async t => {
  const h = harness(t);
  await h.cli('init', '--plan', h.write('plan.json', plan('v1', ['one'])));
  const { child } = await killedSupervisor(h, t);
  t.after(() => child.kill('SIGKILL'));
  await assert.rejects(h.cli('recover', '--evidence', 'x'), /held by live process/);
  assert.ok(existsSync(`${h.ledger}.lock`));
});

test('runner invocations get a 600s default timeout, overridable with --timeout', async t => {
  const origTimeout = process.env.NTG_RUNNER_TIMEOUT_S;
  delete process.env.NTG_RUNNER_TIMEOUT_S;
  t.after(() => {
    if (origTimeout !== undefined) process.env.NTG_RUNNER_TIMEOUT_S = origTimeout;
  });
  const h = harness(t);
  await h.cli('init', '--plan', h.write('plan.json', plan('v1', ['one'])));
  await h.cli('plan', '--task', 'advise');
  await h.cli('plan', '--task', 'advise', '--timeout', '30');
  assert.deepEqual(h.timeouts, [600000, 30000]);
  await assert.rejects(h.cli('status', '--timeout', '0'), /positive number/);
});

test('plan returns Piledriver advice without adopting it', async t => {
  const h = harness(t);
  await h.cli('init', '--plan', h.write('plan.json', plan()));
  const before = readFileSync(h.ledger, 'utf8');
  const { out } = await h.cli('plan', '--task', 'reconsider milestones');
  assert.equal(out.adopted, false);
  assert.deepEqual(h.calls, ['piledriver']);
  assert.equal(JSON.parse(readFileSync(h.ledger, 'utf8')).plan_version, JSON.parse(before).plan_version);
});

test('alt returns Instinct advisory JSON without adoption and escalates only explicitly', async t => {
  const h = harness(t);
  await h.cli('init', '--plan', h.write('plan.json', plan('v1', ['one'])));
  await assert.rejects(h.cli('alt'), /--task is required/);
  await assert.rejects(h.cli('alt', '--task', 'x', '--bogus', 'y'), /Unknown or incomplete option/);
  const { code, out } = await h.cli('alt', '--task', 'why is this stuck?');
  assert.equal(code, 0);
  assert.equal(out.adopted, false);
  assert.equal(out.advisory_alt.recommendation, 'run X');
  assert.deepEqual(h.calls, ['instinct']);
  assert.deepEqual(h.escalations, [false]);
  assert.equal(h.contracts[0].task, 'why is this stuck?');
  assert.equal(h.contracts[0].needs_alt.attempt_count, 0);
  assert.equal(h.contracts[0].replan_context.telemetry_tier, 'B');

  const escalated = await h.cli('alt', '--task', 'why is this stuck?', '--milestone', 'one', '--escalate');
  assert.equal(escalated.code, 0);
  assert.deepEqual(h.calls, ['instinct', 'instinct']);
  assert.deepEqual(h.escalations, [false, true]);
  assert.equal(h.contracts[1].needs_alt.milestone_id, 'one');
  // Advisory only: the ledger records the advice but adopts nothing.
  const disk = JSON.parse(readFileSync(h.ledger, 'utf8'));
  assert.deepEqual(disk.completed_milestones, []);
  assert.equal(disk.plan_version, 'v1');
  assert.equal(disk.evidence.alt_framing.length, 2);
  assert.deepEqual(disk.evidence.alt_framing.map(a => a.adopted), [false, false]);
});

test('status surfaces NEEDS_ALT recommendations derived from durable failure history', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'ntg-vnext-alt-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ledger = join(dir, 'ledger.json');
  const deps = {
    handleSignals: false,
    invokeZen: async () => { throw new Error('zen must not run'); },
    invokeRole: async () => ({ ok: false, error: 'TIMEOUT', role: 'bulldozer', slug: 'gemini-3.8-flash-high' }),
  };
  writeFileSync(join(dir, 'plan.json'), JSON.stringify(plan('v1', ['one'])));
  await main(['init', '--ledger', ledger, '--plan', join(dir, 'plan.json')], deps);
  for (let attempt = 0; attempt < 3; attempt++) {
    await assert.rejects(main(['run', '--ledger', ledger], deps), /TIMEOUT/);
  }
  const { code, out } = await main(['status', '--ledger', ledger], deps);
  assert.equal(code, 0);
  assert.equal(out.needs_alt.length, 1);
  assert.equal(out.needs_alt[0].failure_class, 'one:INVOCATION_FAILURE:runner.invoke');
  assert.equal(out.needs_alt[0].attempt_count, 3);
  assert.equal(out.needs_alt[0].needs_alt_recommended, true);
  assert.deepEqual(out.state.completed_milestones, []);
});

test('the npm-style bin symlink executes the CLI (#135 B1)', t => {
  const dir = mkdtempSync(join(tmpdir(), 'ntg-vnext-bin-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = join(dir, 'ntg-vnext');
  symlinkSync(CLI, bin);
  const missing = spawnSync(bin, ['status', '--ledger', join(dir, 'missing.json')], { encoding: 'utf8' });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /ENOENT/);
  writeFileSync(join(dir, 'plan.json'), JSON.stringify(plan('v1', ['one'])));
  const init = JSON.parse(execFileSync(bin, ['init', '--ledger', join(dir, 'l.json'), '--plan', join(dir, 'plan.json')], { encoding: 'utf8' }));
  assert.equal(init.next_milestone, 'one');
});

const ZEN_MODELS = [
  'gemini-4-argon-high\tGemini 4 Argon (High)',
  'gemini-3.8-flash-high\tGemini 3.8 Flash (High)',
  'claude-sonnet-5-5-medium\tClaude Sonnet 5.5 (Medium)',
  'claude-sonnet-5-5-high\tClaude Sonnet 5.5 (High)',
  'claude-opus-5-5-high\tClaude Opus 5.5 (High)',
].join('\n');

function fakeZen(t, envelope, { models = ZEN_MODELS } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ntg-vnext-zen-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const agy = join(dir, 'agy');
  writeFileSync(join(dir, 'out.json'), JSON.stringify(envelope));
  writeFileSync(join(dir, 'models.txt'), `${models}\n`);
  writeFileSync(agy, `#!/usr/bin/env node
const { readFileSync, writeFileSync } = require('node:fs');
const argv = process.argv.slice(2);
if (argv[0] === 'models') {
  process.stdout.write(readFileSync(${JSON.stringify(join(dir, 'models.txt'))}, 'utf8'));
} else {
  writeFileSync(${JSON.stringify(join(dir, 'zen-args.json'))}, JSON.stringify(argv));
  process.stdout.write(readFileSync(${JSON.stringify(join(dir, 'out.json'))}, 'utf8'));
}
`);
  spawnSync('chmod', ['+x', agy]);
  return agy;
}

/** argv the fake agy received for the Zen invocation (never the `models` probe). */
const zenArgs = agy => JSON.parse(readFileSync(join(dirname(agy), 'zen-args.json'), 'utf8'));
const zenGo = JSON.stringify({ milestone_id: 'one', plan_version: 'v1', result_ref: 'r', verdict: 'GO', verification_evidence: observed });

test('Zen extracts one verdict from narration and fences (#180)', () => {
  // The issue's two stderr captures retain only the exact prefix "Hashes mat".
  // Reconstruct the rest rather than claiming an unavailable full transcript.
  for (const verdict of ['GO', 'NO-GO']) {
    const packet = { ...JSON.parse(zenGo), verdict,
      ...(verdict === 'NO-GO' ? { repair_needs: 'fix content' } : {}) };
    const json = JSON.stringify(packet);
    for (const response of [
      `Hashes match.\n${json}`,
      `Hashes match for \`bin/change-snap\`.\n${json}`,
      `I've verified \`reviewer's-check\`. The candidate's hashes match.\n${json}`,
      `Hashes match.\n\`\`\`json\n${json}\n\`\`\``,
      `\`\`\`json\n${json}\n\`\`\``,
    ]) {
      assert.deepEqual(parseZenEnvelope(JSON.stringify({ status: 'SUCCESS', response })), packet, response);
    }
    for (const response of [
      `I've verified \`reviewer's-check\`.\n${json}\nThe candidate's hashes match.`,
      `${json}\nVerified \`tests/test.sh\`.`,
      `Hashes match.\n\`\`\`json\n${json}\n\`\`\`\nReview complete.`,
    ]) {
      assert.throws(
        () => parseZenEnvelope(JSON.stringify({ status: 'SUCCESS', response })),
        /zen response is not a JSON packet/,
        response,
      );
    }
  }
});

test('Zen accepts only its terminal verdict envelope allowlist (#180)', () => {
  const packet = JSON.parse(zenGo);
  for (const response of [
    zenGo,
    ` \t${zenGo}\r\n `,
    `Hashes match.\n${zenGo}\n \t`,
    `Hashes match.\r\n${zenGo}\r\n`,
    `Hashes match.\n\`\`\`json\n${zenGo}\n\`\`\`\n \t`,
    `Hashes match.\n\`\`\`\n${zenGo}\n\`\`\``,
    `Hashes match.\r\n\`\`\`json\r\n  ${zenGo}\r\n\`\`\`\r\n`,
    `Hashes match.\n\`\`\`json\n${zenGo}\n\`\`\`\``,
    `Hashes match.\n\`\`\`\n${zenGo}\n  \`\`\`\` \t\n`,
    `~~~text\nAn earlier example without a verdict.\n~~~~\n\n${zenGo}`,
    `> An earlier note, not an envelope.\n\n${zenGo}`,
    `- An earlier note, not an envelope.\n\n${zenGo}`,
  ]) {
    assert.deepEqual(parseZenEnvelope(JSON.stringify({ status: 'SUCCESS', response })), packet, response);
  }
});

test('Zen rejects nested quotes and forbidden verdict envelope placements (#180)', () => {
  const noGo = JSON.stringify({ ...JSON.parse(zenGo), verdict: 'NO-GO', repair_needs: 'fix' });
  const relay = 'Subagent `0c63109b-326b-44a1-a1d6-f72a8440e586` has sent the following message:';
  for (const response of [
    ...['- > ', '1. > ', '- > Example packet:\n  '].map(
      prefix => `Example only, not my verdict:\n${prefix}${zenGo}\n\nNo verdict issued.`),
    ...['- > ', '1. > ', '- > Example packet:\n  ', '- > Example packet:\n',
      '> Example packet:\n', '1. > Example packet:\n'].map(prefix => `${prefix}${zenGo}`),
    ...[' ', '  ', '    ', '\t', '- ', '1. '].map(prefix => `Hashes match.\n${prefix}${zenGo}`),
    `Hashes match. ${zenGo}`,
    `${zenGo}\nMore prose.`,
    `Hashes match.\n\`\`\`json\n${zenGo}\n\`\`\`\nMore prose.`,
    `Hashes match.\n  \`\`\`json\n${zenGo}\n  \`\`\``,
    `Hashes match.\n\`\`\`javascript\n${zenGo}\n\`\`\``,
    `\`\`\`\n\`\`\`\n\`\`\`json\n${zenGo}\n\`\`\``,
    `\`\`\`json\n${zenGo}\n\`\`\`\n\`\`\`json\n${noGo}\n\`\`\``,
    `Example: '${zenGo}'`,
    `Example: "${zenGo}"`,
    `Example: \`${zenGo}\``,
    `Example: '${zenGo}'\n${noGo}`,
    `${relay}\n${noGo}\n${zenGo}`,
  ]) {
    assert.throws(
      () => parseZenEnvelope(JSON.stringify({ status: 'SUCCESS', response })),
      /zen response is not a JSON packet/,
      response,
    );
  }
});

test('Zen rejects verdicts inside open or unclosed fenced examples (#180 C2)', () => {
  for (const response of [
    ...['~~~text', '```text', '~~~~text', '````text', '  ~~~text', '  ```text'].flatMap(opener => [
      `${opener}\nExample only, no verdict issued.\n\n${zenGo}`,
      `${opener}\nExample only, no verdict issued.\n\`\`\`json\n${zenGo}\n\`\`\``,
    ]),
    `~~~~text\nExample only.\n~~~\n\`\`\`json\n${zenGo}\n\`\`\``,
    `~~~text\nExample only.\n\`\`\`\n\`\`\`json\n${zenGo}\n\`\`\``,
    `\`\`\`\`text\nExample only.\n\`\`\`\n\`\`\`json\n${zenGo}\n\`\`\``,
    `~~~~text\nExample only.\n~~~~not-a-closer\n\`\`\`json\n${zenGo}\n\`\`\``,
    `~~~text\nExample only.\n\n${zenGo}\n~~~`,
    `\`\`\`text\nExample only.\n\n${zenGo}\n\`\`\``,
    `\`\`\`json\n${zenGo}`,
  ]) {
    assert.throws(
      () => parseZenEnvelope(JSON.stringify({ status: 'SUCCESS', response })),
      /zen response is not a JSON packet/,
      response,
    );
  }
});

test('runner retains historical narration and relay packets independently of Zen (#180 C3/C4)', () => {
  const packet = { milestone_id: 'm-1', plan_version: 3, status: 'DONE' };
  const json = JSON.stringify(packet);
  const inlinePacket = { status: 'DONE' };
  const inlineJson = JSON.stringify(inlinePacket);
  const relay = 'Subagent `0c63109b-326b-44a1-a1d6-f72a8440e586` has sent the following message:';
  for (const [response, expected, relayed] of [
    [`Result follows:\n${json}\nEnd.`, packet, false],
    [`Result follows:\n\`\`\`json\n${json}\n\`\`\`\nEnd.`, packet, false],
    [`${inlineJson}\nVerified \`tests/test.sh\`.`, inlinePacket, false],
    [`Updated \`change-snap\`.\n\`\`\`json\n${inlineJson}\n\`\`\`\nVerified \`tests/test.sh\`.`, inlinePacket, false],
    [`${relay}\nFindings: parseResponsePacket() slices \`{\` to \`}\` in \`scripts/runner.mjs\`; see {"path":"scripts/runner.mjs"}.\n${json}`, packet, true],
    [`${relay}\nReport: \`{"budget": [], "nested": {"depth": 1}}\`\n\`\`\`json\n${json}\n\`\`\``, packet, true],
    [`${relay}\n{\n  "fragment": "preamble block that never parses through to the end"\n}\nFindings continued.\n${json}`, packet, true],
    [`${relay}\nFindings: see {"path":"scripts/runner.mjs"}.\nx${' '.repeat(80000)}y.\n${json}`, packet, true],
  ]) {
    const envelope = parseResponseEnvelope(JSON.stringify({ status: 'SUCCESS', response }));
    const result = parseResponsePacket(envelope);
    assert.equal(result.ok, true);
    assert.deepEqual(result.packet, expected);
    assert.equal(result.relayPreambleStripped, relayed ? true : undefined);
    assert.equal(result.response, response);
    assert.equal(result.raw, envelope.raw);
    assert.equal(result.raw.response, response);
  }
});

test('Zen rejects missing or ambiguous narrated verdict packets (#180)', () => {
  const noGo = JSON.stringify({ ...JSON.parse(zenGo), verdict: 'NO-GO', repair_needs: 'fix' });
  for (const response of [
    'Hashes match. GO.',
    'Hashes match.\n{"verdict":',
    `Hashes match.\n${zenGo}\n${zenGo}`,
    `${zenGo}\n${noGo}`,
    `\`\`\`json\n${zenGo}\n\`\`\`\n\`\`\`json\n${noGo}\n\`\`\``,
    `Inspected \`{"verdict":"NO-GO"}\`.\n${zenGo}`,
    `Inspected \`bin/change-snap.\n${zenGo}`,
    ...['null', 'true', '42', '[', '"GO"'].map(value => `${value}\n${zenGo}`),
    `[\n${zenGo}\n]`,
    `{"review":${zenGo}}`,
    // Zen must not use the runner's relay-tail exception to choose a verdict.
    `Subagent \`12345678-abcd\` has sent the following message:\n${noGo}\n${zenGo}`,
  ]) {
    assert.throws(
      () => parseZenEnvelope(JSON.stringify({ status: 'SUCCESS', response })),
      /zen response is not a JSON packet|explicit GO or NO-GO/,
      response,
    );
  }
});

test('Zen rejects sole quoted examples rather than issuing their verdict (#180 C2)', () => {
  for (const response of [
    `Example only: '${zenGo}'. No verdict issued.`,
    `Example only:\n'\n${zenGo}\n'\nNo verdict issued.`,
    `Example only: '\n\`\`\`json\n${zenGo}\n\`\`\`\n'. No verdict issued.`,
    `Example only: "${zenGo}". No verdict issued.`,
    `Example only: \`${zenGo}\`. No verdict issued.`,
    `Example only: \u2018${zenGo}\u2019. No verdict issued.`,
    `Example only: \u201c${zenGo}\u201d. No verdict issued.`,
    `Example only: '${zenGo}'.\nActual verdict:\n${zenGo}`,
  ]) {
    assert.throws(
      () => parseZenEnvelope(JSON.stringify({ status: 'SUCCESS', response })),
      /zen response is not a JSON packet/,
      response,
    );
  }
});

test('Zen rejects Markdown blockquoted example verdicts (#180 C2)', () => {
  for (const response of [
    `Example only, not my verdict:\n> ${zenGo}\nNo verdict issued.`,
    `Example only, not my verdict:\n   >${zenGo}\nNo verdict issued.`,
    `Example only, not my verdict:\n>> ${zenGo}\nNo verdict issued.`,
    `> Example only, not my verdict:\n${zenGo}\nNo verdict issued.`,
    `> \`\`\`json\n> ${zenGo}\n> \`\`\`\nNo verdict issued.`,
  ]) {
    assert.throws(
      () => parseZenEnvelope(JSON.stringify({ status: 'SUCCESS', response })),
      /zen response is not a JSON packet/,
      response,
    );
  }
});

test('narrated native Zen preserves envelope authority and provider usage (#180)', t => {
  const packet = { ...JSON.parse(zenGo), usage: { total_tokens: 999 } };
  const response = `Hashes match.\n${JSON.stringify(packet)}`;
  const usage = { input_tokens: 10, output_tokens: 2, total_tokens: 12 };
  const result = nativeZen({}, { agyPath: fakeZen(t, { status: 'SUCCESS', response, usage }) });
  assert.deepEqual(result.verification_evidence, observed);
  assert.equal(result.result_ref, packet.result_ref);
  assert.deepEqual(result.usage, usage);
  assert.equal(parseZenEnvelope(JSON.stringify({ status: 'SUCCESS', response })).usage, undefined);
  assert.throws(() => parseZenEnvelope(JSON.stringify({
    status: 'SUCCESS', response: `${response}\nReview complete.`,
  })), /zen response is not a JSON packet/);
  assert.throws(() => parseZenEnvelope(JSON.stringify({ status: 'ERROR', response })), /MODEL_ERROR/);
  assert.throws(() => parseZenEnvelope(JSON.stringify({
    status: 'SUCCESS', response, denied_actions: [{ action: 'command' }],
  })), /TOOL_PERMISSION_DENIED/);
});

test('native Zen GO is accepted only from a SUCCESS envelope with an explicit verdict (#135 B3)', t => {
  const ok = nativeZen({}, { agyPath: fakeZen(t, { status: 'SUCCESS', response: zenGo }) });
  assert.equal(ok.verdict, 'GO');
  assert.throws(() => nativeZen({}, { agyPath: fakeZen(t, { status: 'ERROR', response: zenGo }) }), /MODEL_ERROR/);
  assert.throws(() => nativeZen({}, { agyPath: fakeZen(t, {
    status: 'SUCCESS', response: zenGo, denied_actions: [{ action: 'command', display_name: 'RunCommand' }],
  }) }), /TOOL_PERMISSION_DENIED/);
  assert.throws(() => nativeZen({}, { agyPath: fakeZen(t, { status: 'SUCCESS', response: JSON.stringify({ milestone_id: 'one' }) }) }), /explicit GO or NO-GO/);
  assert.throws(() => nativeZen({}, { agyPath: fakeZen(t, { message: zenGo }) }), /INVALID_OUTPUT/);
});

test('native Zen usage comes only from the AGY envelope, never the response packet', t => {
  const responseWithUsage = JSON.stringify({ ...JSON.parse(zenGo), usage: { total_tokens: 999 } });

  const withoutEnvelopeUsage = nativeZen({}, { agyPath: fakeZen(t, { status: 'SUCCESS', response: responseWithUsage }) });
  assert.equal(withoutEnvelopeUsage.usage, undefined);

  const envelopeUsage = { input_tokens: 10, output_tokens: 2, total_tokens: 12 };
  const withEnvelopeUsage = nativeZen({}, {
    agyPath: fakeZen(t, { status: 'SUCCESS', response: responseWithUsage, usage: envelopeUsage }),
  });
  assert.deepEqual(withEnvelopeUsage.usage, envelopeUsage);
});

test('native Zen is model-pinned by policy and never by --agent', t => {
  const agy = fakeZen(t, { status: 'SUCCESS', response: zenGo });
  const request = { milestone_id: 'one', plan_version: 'v1', result_ref: 'r' };
  assert.equal(nativeZen(request, { agyPath: agy }).verdict, 'GO');

  const args = zenArgs(agy);
  assert.equal(args.includes('--agent'), false);
  assert.equal(args[args.indexOf('--model') + 1], 'claude-opus-5-5-high');
  assert.equal(args[args.indexOf('--output-format') + 1], 'json');
  assert.ok(args.includes('--dangerously-skip-permissions'));
  assert.ok(args.includes('-p'));
  // The shipped role body reaches the prompt without its AGY frontmatter, which
  // the runner roles pass through but native invocation must not.
  const prompt = args[args.indexOf('-p') + 1];
  assert.equal(prompt.startsWith('---'), false);
  assert.match(prompt, /You are the independent, non-mutating verification gate\./);
  assert.match(prompt, /Independently verify the candidate against its milestone contract\./);
  assert.match(prompt, /"milestone_id":"one"/);
});

test('NTG_ZEN_MODEL overrides the resolved Zen slug and fails closed without a matching model', t => {
  process.env.NTG_ZEN_MODEL = 'gemini-4-argon-high';
  try {
    const agy = fakeZen(t, { status: 'SUCCESS', response: zenGo });
    assert.equal(nativeZen({}, { agyPath: agy }).verdict, 'GO');
    const args = zenArgs(agy);
    assert.equal(args[args.indexOf('--model') + 1], 'gemini-4-argon-high');
    assert.equal(args.includes('--agent'), false);
  } finally {
    delete process.env.NTG_ZEN_MODEL;
  }

  const flashOnly = fakeZen(t, { status: 'SUCCESS', response: zenGo }, {
    models: 'gemini-3.8-flash-high\tGemini 3.8 Flash (High)',
  });
  assert.throws(() => nativeZen({}, { agyPath: flashOnly }), /No installed model found matching policy for role "zen"/);
});

test('usage telemetry: records per-role entries in ledger and surfaces rollup in status', async t => {
  const h = harness(t);
  await h.cli('init', '--plan', h.write('plan.json', plan('v1', ['one'])));

  const customDeps = {
    handleSignals: false,
    invokeRole: async (role, packet, runnerOptions = {}) => {
      if (role === 'bulldozer') {
        if (runnerOptions.invokeSpecialist) {
          await runnerOptions.invokeSpecialist('bobcat', { task: 'implement' });
          await runnerOptions.invokeSpecialist('strix-halo', { task: 'review' }, { caller: 'bobcat' });
        }
        return {
          ok: true,
          slug: 'gemini-3.8-flash-high',
          duration_ms: 250,
          usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
          response: JSON.stringify({
            milestone_id: 'one',
            plan_version: 'v1',
            status: 'DONE',
            changes_made: ['one.txt'],
            verification_evidence: observed,
            unresolved_unknowns: [],
            scope_deviations: [],
            candidate_artifact_ref: 'sha256:one',
          }),
        };
      }
      return { ok: true, response: '{}' };
    },
    invokeSpecialist: async (role, slice, options = {}) => {
      if (role === 'bobcat') {
        return {
          ok: true,
          status: 'READY',
          slug: 'gemini-3.8-flash-high',
          duration_ms: 150,
          usage: { input_tokens: 50, output_tokens: 10, total_tokens: 60 },
          response: JSON.stringify({ status: 'READY' }),
        };
      }
      if (role === 'strix-halo') {
        return {
          ok: true,
          verdict: 'ACCEPT',
          slug: 'gemini-3.8-flash-high',
          duration_ms: 80,
          usage: { input_tokens: 30, output_tokens: 5, total_tokens: 35 },
          response: JSON.stringify({ verdict: 'ACCEPT' }),
        };
      }
      return { ok: true, response: '{}' };
    },
    invokeZen: async request => {
      return {
        milestone_id: request.milestone_id,
        plan_version: request.plan_version,
        result_ref: request.result_ref,
        verdict: 'GO',
        verification_evidence: observed,
        slug: 'gemini-4-argon-high',
        duration_ms: 300,
        usage: { input_tokens: 200, output_tokens: 40, total_tokens: 240 },
      };
    },
  };

  const runRes = await main(['run', '--ledger', h.ledger], customDeps);
  assert.equal(runRes.code, 0);

  const disk = JSON.parse(readFileSync(h.ledger, 'utf8'));
  assert.ok(disk.usage, 'usage property exists on ledger');
  assert.ok(Array.isArray(disk.usage.one), 'usage.one is an array');

  const entries = disk.usage.one;
  assert.equal(entries.length, 4);

  const roles = entries.map(e => e.role);
  assert.deepEqual(roles, ['bobcat', 'strix-halo', 'bulldozer', 'zen']);

  for (const entry of entries) {
    assert.equal(typeof entry.role, 'string');
    assert.equal(typeof entry.slug, 'string');
    assert.equal(typeof entry.duration_ms, 'number');
    assert.ok(entry.duration_ms > 0);
    assert.equal(typeof entry.status, 'string');
    assert.ok(entry.usage && typeof entry.usage.total_tokens === 'number');
  }

  const statusRes = await main(['status', '--ledger', h.ledger], customDeps);
  assert.equal(statusRes.code, 0);
  assert.ok(statusRes.out.usage, 'status output contains usage rollup');
  assert.ok(statusRes.out.usage.one, 'usage rollup contains milestone one');

  const m1Rollup = statusRes.out.usage.one;
  assert.equal(m1Rollup.total_tokens, 455);
  assert.equal(m1Rollup.total_duration_ms, 780);
  assert.equal(m1Rollup.total.total_tokens, 455);
  assert.equal(m1Rollup.total.total_duration_ms, 780);

  assert.equal(m1Rollup.roles.bobcat.total_tokens, 60);
  assert.equal(m1Rollup.roles.bobcat.total_duration_ms, 150);
  assert.equal(m1Rollup.roles['strix-halo'].total_tokens, 35);
  assert.equal(m1Rollup.roles['strix-halo'].total_duration_ms, 80);
  assert.equal(m1Rollup.roles.bulldozer.total_tokens, 120);
  assert.equal(m1Rollup.roles.bulldozer.total_duration_ms, 250);
  assert.equal(m1Rollup.roles.zen.total_tokens, 240);
  assert.equal(m1Rollup.roles.zen.total_duration_ms, 300);

  assert.deepEqual(m1Rollup.by_role, m1Rollup.roles);
});

test('usage telemetry: native specialist delegations are recorded through the real runner invocation', async t => {
  const h = harness(t);
  await h.cli('init', '--plan', h.write('plan.json', plan('v1', ['one'])));
  const dir = mkdtempSync(join(tmpdir(), 'ntg-native-agy-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const agy = join(dir, 'agy.mjs');
  writeFileSync(agy, `#!/usr/bin/env node
console.log(JSON.stringify({
  status: 'SUCCESS',
  response: JSON.stringify({
    milestone_id: 'one',
    plan_version: 'v1',
    status: 'DONE',
    changes_made: ['one.txt'],
    verification_evidence: ${JSON.stringify(observed)},
    unresolved_unknowns: [],
    scope_deviations: [],
    candidate_artifact_ref: 'sha256:one',
    delegations: [{ role: 'bobcat', status: 'READY' }, { role: 'Jaguar' }],
  }),
  duration_seconds: 0.5,
  usage: { input_tokens: 80, output_tokens: 20, total_tokens: 100 },
}));
`);
  chmodSync(agy, 0o755);
  let specialistCallbacks = 0;

  const deps = {
    handleSignals: false,
    runnerOptions: {
      agyPath: agy,
      installedModels: [{ slug: 'gemini-3.8-flash-high', description: 'Gemini 3.8 Flash (High)' }],
    },
    invokeSpecialist: async () => {
      specialistCallbacks += 1;
      return { ok: true, response: '{}' };
    },
    invokeZen: async request => ({
      milestone_id: request.milestone_id,
      plan_version: request.plan_version,
      result_ref: request.result_ref,
      verdict: 'GO',
      verification_evidence: observed,
      slug: 'gemini-4-argon-high',
      duration_ms: 10,
      usage: { input_tokens: 15, output_tokens: 5, total_tokens: 20 },
    }),
  };

  const runRes = await main(['run', '--ledger', h.ledger], deps);
  assert.equal(runRes.code, 0);
  assert.equal(specialistCallbacks, 0, 'native delegation must not invoke the injected callback');

  const disk = JSON.parse(readFileSync(h.ledger, 'utf8'));
  const entries = disk.usage.one;
  assert.deepEqual(entries.map(e => e.role), ['bulldozer', 'bobcat', 'jaguar', 'zen']);

  const bulldozer = entries.find(e => e.role === 'bulldozer');
  assert.ok(typeof bulldozer.duration_ms === 'number' && Number.isFinite(bulldozer.duration_ms));
  assert.ok(bulldozer.duration_ms >= 0);
  assert.deepEqual(bulldozer.usage, { input_tokens: 80, output_tokens: 20, total_tokens: 100 });

  const bobcat = entries.find(e => e.role === 'bobcat');
  assert.equal(bobcat.status, 'READY');
  assert.equal(bobcat.source, 'declared');
  assert.equal(bobcat.verified, false);
  assert.equal(bobcat.duration_ms, undefined);
  assert.equal(bobcat.usage, undefined);
  assert.equal(bobcat.slug, null);

  const jaguar = entries.find(e => e.role === 'jaguar');
  assert.equal(jaguar.status, 'DELEGATED');
  assert.equal(jaguar.source, 'declared');
  assert.equal(jaguar.verified, false);
  assert.equal(jaguar.duration_ms, undefined);
  assert.equal(jaguar.usage, undefined);

  const statusRes = await main(['status', '--ledger', h.ledger], deps);
  assert.equal(statusRes.code, 0);
  assert.equal(statusRes.out.usage.one.roles.bobcat, undefined, 'a declared claim is not measured role accounting');
  assert.equal(statusRes.out.usage.one.roles.jaguar, undefined);
  assert.deepEqual(statusRes.out.usage.one.declared_unverified.roles.bobcat, { entries: 1 });
  assert.deepEqual(statusRes.out.usage.one.declared_unverified.roles.jaguar, { entries: 1 });
  assert.equal(statusRes.out.usage.one.total_duration_ms, bulldozer.duration_ms + 10);
  assert.equal(statusRes.out.usage.one.total_tokens, 120);
});

test('usage telemetry: fabricated delegation duration and usage never become measured accounting', async t => {
  const h = harness(t);
  await h.cli('init', '--plan', h.write('plan.json', plan('v1', ['one'])));
  const dir = mkdtempSync(join(tmpdir(), 'ntg-native-agy-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const agy = join(dir, 'agy.mjs');
  writeFileSync(agy, `#!/usr/bin/env node
console.log(JSON.stringify({
  status: 'SUCCESS',
  response: JSON.stringify({
    milestone_id: 'one',
    plan_version: 'v1',
    status: 'DONE',
    changes_made: ['one.txt'],
    verification_evidence: ${JSON.stringify(observed)},
    unresolved_unknowns: [],
    scope_deviations: [],
    candidate_artifact_ref: 'sha256:one',
    delegations: [{
      role: 'bobcat',
      slug: 'invented-slug',
      status: 'READY',
      duration_ms: 999,
      usage: { total_tokens: 999, diagnostic: 'sk-synthetic-declaration-token' },
    }],
  }),
  duration_seconds: 0.5,
  usage: { input_tokens: 80, output_tokens: 20, total_tokens: 100 },
}));
`);
  chmodSync(agy, 0o755);

  const deps = {
    handleSignals: false,
    runnerOptions: {
      agyPath: agy,
      installedModels: [{ slug: 'gemini-3.8-flash-high', description: 'Gemini 3.8 Flash (High)' }],
    },
    invokeSpecialist: async () => {
      assert.fail('a model declaration must not trigger a specialist callback');
    },
    invokeZen: async request => ({
      milestone_id: request.milestone_id,
      plan_version: request.plan_version,
      result_ref: request.result_ref,
      verdict: 'GO',
      verification_evidence: observed,
      slug: 'gemini-4-argon-high',
      duration_ms: 10,
      usage: { input_tokens: 15, output_tokens: 5, total_tokens: 20 },
    }),
  };

  const runRes = await main(['run', '--ledger', h.ledger], deps);
  assert.equal(runRes.code, 0);

  const disk = JSON.parse(readFileSync(h.ledger, 'utf8'));
  const declared = disk.usage.one.find(entry => entry.role === 'bobcat');
  assert.equal(declared.source, 'declared');
  assert.equal(declared.verified, false);
  assert.equal(declared.status, 'READY');
  assert.equal(declared.slug, 'invented-slug');
  assert.equal(declared.duration_ms, undefined, 'unknown duration must stay unknown, never 0');
  assert.notEqual(declared.duration_ms, 0);
  assert.equal(declared.usage, undefined, 'model-supplied usage must never be recorded');
  assert.ok(!JSON.stringify(declared).includes('999'));
  assert.ok(!JSON.stringify(disk.usage.one).includes('sk-synthetic-declaration-token'));

  const statusRes = await main(['status', '--ledger', h.ledger], deps);
  assert.equal(statusRes.code, 0);
  const rollup = statusRes.out.usage.one;
  assert.equal(rollup.roles.bobcat, undefined, 'declared claims must not appear as measured roles');
  assert.equal(rollup.total_tokens, 120, 'only observed Bulldozer and Zen usage counts');
  assert.equal(rollup.total_duration_ms, disk.usage.one.find(e => e.role === 'bulldozer').duration_ms + 10);
  assert.deepEqual(rollup.declared_unverified, { entries: 1, roles: { bobcat: { entries: 1 } } });
  assert.ok(!JSON.stringify(rollup).includes('999'));
});

test('usage telemetry: response-body usage never replaces absent transport usage', async t => {
  const h = harness(t);
  await h.cli('init', '--plan', h.write('plan.json', plan('v1', ['one'])));

  const deps = {
    handleSignals: false,
    invokeRole: async (role, packet, runnerOptions = {}) => {
      if (role !== 'bulldozer') return { ok: true, response: '{}' };
      if (runnerOptions.invokeSpecialist) {
        await runnerOptions.invokeSpecialist('bobcat', { task: 'implement' });
      }
      return {
        ok: true,
        slug: 'gemini-3.8-flash-high',
        duration_ms: 20,
        response: JSON.stringify({
          milestone_id: 'one',
          plan_version: 'v1',
          status: 'DONE',
          changes_made: ['one.txt'],
          verification_evidence: observed,
          unresolved_unknowns: [],
          scope_deviations: [],
          candidate_artifact_ref: 'sha256:one',
          usage: { total_tokens: 999 },
        }),
      };
    },
    invokeSpecialist: async () => ({
      ok: true,
      slug: 'gemini-3.8-flash-high',
      duration_ms: 7,
      response: JSON.stringify({ status: 'READY', usage: { total_tokens: 777 } }),
    }),
    invokeZen: async request => ({
      milestone_id: request.milestone_id,
      plan_version: request.plan_version,
      result_ref: request.result_ref,
      verdict: 'GO',
      verification_evidence: observed,
      duration_ms: 5,
    }),
  };

  const runRes = await main(['run', '--ledger', h.ledger], deps);
  assert.equal(runRes.code, 0);

  const disk = JSON.parse(readFileSync(h.ledger, 'utf8'));
  const entries = disk.usage.one;
  assert.deepEqual(entries.map(e => e.role), ['bobcat', 'bulldozer', 'zen']);
  for (const entry of entries) {
    assert.equal(entry.usage, undefined, `${entry.role} must not borrow response-body usage`);
  }
});

test('usage telemetry: initial plan cannot manufacture measured usage (G3-1)', async t => {
  const h = harness(t);
  const fabricated = plan('v1', ['one']);
  fabricated.usage = {
    one: [{ role: 'bobcat', slug: 'invented-slug', duration_ms: 999, usage: { total_tokens: 999 }, status: 'READY' }],
  };
  const initRes = await h.cli('init', '--plan', h.write('plan.json', fabricated));
  assert.equal(initRes.code, 0);
  assert.equal(initRes.out.usage, undefined, 'init must not roll up plan-authored accounting');

  const disk = JSON.parse(readFileSync(h.ledger, 'utf8'));
  assert.equal(disk.usage, undefined, 'plan usage must not be stored as execution accounting');
  assert.ok(!JSON.stringify(disk).includes('999'));

  const statusRes = await h.cli('status');
  assert.equal(statusRes.code, 0);
  assert.equal(statusRes.out.usage, undefined, 'status must not report fabricated measured totals');
  assert.equal(statusRes.out.state.usage, undefined);
  assert.deepEqual(h.calls, [], 'plan accounting must not require any model invocation');
});

test('usage telemetry: malformed persisted usage cannot make status throw (G3-2)', async t => {
  const h = harness(t);
  await h.cli('init', '--plan', h.write('plan.json', plan('v1', ['one'])));

  const deps = {
    handleSignals: false,
    invokeRole: async role => role === 'bulldozer'
      ? {
          ok: true,
          slug: 'gemini-3.8-flash-high',
          duration_ms: 10,
          usage: { input_tokens: { toString: null }, output_tokens: 2 },
          response: JSON.stringify({
            milestone_id: 'one',
            plan_version: 'v1',
            status: 'DONE',
            changes_made: ['one.txt'],
            verification_evidence: observed,
            unresolved_unknowns: [],
            scope_deviations: [],
            candidate_artifact_ref: 'sha256:one',
          }),
        }
      : { ok: true, response: '{}' },
    invokeZen: async request => ({
      milestone_id: request.milestone_id,
      plan_version: request.plan_version,
      result_ref: request.result_ref,
      verdict: 'GO',
      verification_evidence: observed,
    }),
  };

  const runRes = await main(['run', '--ledger', h.ledger], deps);
  assert.equal(runRes.code, 0);

  const disk = JSON.parse(readFileSync(h.ledger, 'utf8'));
  const persisted = disk.usage.one.find(entry => entry.role === 'bulldozer');
  assert.deepEqual(persisted.usage, { input_tokens: { toString: null }, output_tokens: 2 });

  const statusRes = await main(['status', '--ledger', h.ledger], deps);
  assert.equal(statusRes.code, 0);
  assert.equal(statusRes.out.usage.one.roles.bulldozer.total_tokens, 2, 'only validated scalars are aggregated');

  const boundary = computeUsageRollup({
    usage: {
      one: [
        { role: 'zero', usage: { input_tokens: 0, prompt_tokens: 50, output_tokens: 0, completion_tokens: 7 } },
        { role: 'negative', usage: { input_tokens: -5, output_tokens: 2 } },
        { role: 'nonfinite', usage: { input_tokens: Infinity, output_tokens: 2 } },
      ],
    },
  });
  assert.equal(boundary.one.roles.zero.total_tokens, 0, 'valid zero must not fall through to alias truthiness');
  assert.equal(boundary.one.roles.negative.total_tokens, 2, 'negative counts are rejected');
  assert.equal(boundary.one.roles.nonfinite.total_tokens, 2, 'nonfinite counts are rejected');
});

test('pre-change-format ledger fixture (tests/fixtures/pre-usage.ledger.json) loads, status does not crash, and shows no usage sections', async t => {
  const fixturePath = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'pre-usage.ledger.json');
  assert.ok(existsSync(fixturePath));

  const ledger = AuthoritativeLedger.load(fixturePath);
  assert.ok(ledger);
  assert.deepEqual(ledger.usage, {});
  assert.equal(ledger.toJSON().usage, undefined);

  const res = await main(['status', '--ledger', fixturePath], { handleSignals: false });
  assert.equal(res.code, 0);
  assert.equal(res.out.usage, undefined);
  assert.equal(res.out.state.usage, undefined);
});

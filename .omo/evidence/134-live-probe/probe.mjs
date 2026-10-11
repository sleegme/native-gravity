// NTG #134 live 44G validation against the ACTIVATED default (installed plugin from this branch).
// Every scenario goes through the real `ntg-vnext` CLI (scripts/ntg-vnext.mjs) and real agy;
// only P3 wraps the native Zen adapter to tamper the artifact once (fault injection).
// Usage: node probe.mjs <p1|p2|p3|all>
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO = join(import.meta.dirname, '../../..');
const ART = join(REPO, '.omo/evidence/134-live-probe');
const WORK = process.env.NTG134_WORK_DIR || join(process.env.HOME, '.cache/ntg134-live');
const BRAIN = `${process.env.HOME}/.gemini/antigravity-cli/brain`;
const CLI = join(REPO, 'scripts/ntg-vnext.mjs');
const RESULTS = join(ART, 'results.jsonl');
mkdirSync(ART, { recursive: true });
mkdirSync(WORK, { recursive: true });

function sessionsSince(t0) {
  let names = [];
  try { names = readdirSync(BRAIN); } catch { return []; }
  return names.filter(n => { try { return statSync(join(BRAIN, n)).mtimeMs >= t0 - 2000; } catch { return false; } });
}

function record(rec) {
  appendFileSync(RESULTS, JSON.stringify(rec) + '\n');
  console.log(JSON.stringify({ label: rec.label, exit: rec.exit, signal: rec.signal ?? null, ms: rec.ms, sessions: rec.sessions?.length }));
  return rec;
}

function cli(label, args, { timeoutMs = 1500000 } = {}) {
  const t0 = Date.now();
  const r = spawnSync('node', [CLI, ...args], { cwd: REPO, encoding: 'utf8', timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 40 * 1024 * 1024 });
  let out = null; try { out = JSON.parse(r.stdout); } catch { }
  return { out, rec: record({ label, argv: ['ntg-vnext', ...args], ms: Date.now() - t0, exit: r.status, signal: r.signal, stdout: out ?? (r.stdout || '').slice(-3000), stderr: (r.stderr || '').slice(-2000), sessions: sessionsSince(t0) }) };
}

const readOnly = (id, objective, acceptance, deps = []) => ({
  id, title: id, objective, bounded_scope: ['package.json', 'VERSION'], acceptance_criteria: acceptance,
  non_goals: ['Any file modification'], dependencies: deps,
});
const planV1 = {
  goal: 'Observe two read-only repository facts in dependency order', constraints: ['Read-only inspection; no writes'],
  decision_invariants: [], plan_version: 'v1',
  milestones: [
    readOnly('m1', 'Delegate to Jaguar: report the "version" field of package.json', ['package.json version independently observed with a tool', 'candidate_artifact_ref names package.json and the observed version']),
    readOnly('m2', 'Delegate to Jaguar: report the content of the VERSION file and whether it equals the package.json version', ['VERSION content observed with a tool', 'equality with package.json version stated with evidence', 'candidate_artifact_ref names VERSION and the observed content'], ['m1']),
  ],
};
const write = (name, v) => { const p = join(WORK, name); writeFileSync(p, JSON.stringify(v, null, 2)); return p; };

const phases = {
  // P1: multi-milestone GO path + fresh-context resume after an observed killed invocation.
  async p1() {
    const ledger = join(WORK, 'p1-ledger.json'); rmSync(ledger, { force: true });
    cli('P1a-init', ['init', '--ledger', ledger, '--plan', write('p1-plan.json', planV1)]);
    cli('P1b-run-m1', ['run', '--ledger', ledger]);
    // Fresh process B: start m2, kill it mid-invocation (observed interruption).
    const t0 = Date.now();
    const child = spawn('node', [CLI, 'run', '--ledger', ledger], { cwd: REPO, stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 25000)); // time is the behavior: kill while Bulldozer is in flight
    child.kill('SIGKILL');
    await new Promise(r => child.once('exit', r));
    record({ label: 'P1c-run-m2-killed', argv: ['ntg-vnext', 'run', '--ledger', '<ledger>'], ms: Date.now() - t0, exit: child.exitCode, signal: child.signalCode, sessions: sessionsSince(t0) });
    cli('P1d-status-after-kill', ['status', '--ledger', ledger]);
    cli('P1e-recover', ['recover', '--ledger', ledger, '--evidence', 'P1c process SIGKILLed during m2 Bulldozer invocation']);
    cli('P1f-resume-run', ['run', '--ledger', ledger, '--all']);
  },
  // P2: Piledriver plan revision + material replan + fresh current-version review.
  async p2() {
    const ledger = join(WORK, 'p1-ledger.json');
    cli('P2a-piledriver-plan', ['plan', '--ledger', ledger, '--task', 'Propose a revised one-milestone plan that only re-verifies the package.json version; do not adopt it.']);
    const v2 = { ...planV1, plan_version: 'v2', goal: 'Re-verify the package.json version under a revised plan', milestones: [planV1.milestones[0]] };
    cli('P2b-replan-v2', ['replan', '--ledger', ledger, '--plan', write('p2-plan.json', v2)]);
    cli('P2c-run-v2', ['run', '--ledger', ledger, '--all']);
  },
  // P2a rerun after the ntg-vnext runner-timeout fix (first P2a hit the runner's 90s default).
  async p2a() {
    cli('P2a-rerun-piledriver-plan', ['plan', '--ledger', join(WORK, 'p1-ledger.json'), '--task', 'Propose a revised one-milestone plan that only re-verifies the package.json version; do not adopt it.']);
  },
  // P3: live Zen NO-GO (artifact tampered after the DONE candidate), then repair run with a fresh GO.
  async p3() {
    const ledger = join(WORK, 'p3-ledger.json'); rmSync(ledger, { force: true });
    const target = join(WORK, 'ntg134-nogo.txt'); rmSync(target, { force: true });
    const plan = {
      goal: 'Write one bounded artifact', constraints: [`Only ${target} may be written`], decision_invariants: [], plan_version: 'v1',
      milestones: [{ id: 'w1', title: 'w1', objective: `Delegate to Puma: create ${target} containing exactly the single line "alpha"`,
        bounded_scope: [target], acceptance_criteria: [`${target} contains exactly the line "alpha"`, 'candidate_artifact_ref names the file and its content'],
        non_goals: ['Any other file'], dependencies: [] }],
    };
    cli('P3a-init', ['init', '--ledger', ledger, '--plan', write('p3-plan.json', plan)]);
    const driver = join(WORK, 'p3-driver.mjs');
    writeFileSync(driver, `import { main, nativeZen } from ${JSON.stringify(CLI)};
import { writeFileSync } from 'node:fs';
let tampered = false;
const invokeZen = req => { if (!tampered) { tampered = true; writeFileSync(${JSON.stringify(target)}, 'tampered\\n'); } return nativeZen(req, { cwd: ${JSON.stringify(REPO)} }); };
const r = await main(process.argv.slice(2), { invokeZen });
process.stdout.write(JSON.stringify(r.out)); process.exitCode = r.code;
`);
    const t0 = Date.now();
    const r = spawnSync('node', [driver, 'run', '--ledger', ledger], { cwd: REPO, encoding: 'utf8', timeout: 1500000, killSignal: 'SIGKILL', maxBuffer: 40 * 1024 * 1024 });
    let out = null; try { out = JSON.parse(r.stdout); } catch { }
    record({ label: 'P3b-run-tampered-expect-nogo', argv: ['p3-driver', 'run'], ms: Date.now() - t0, exit: r.status, signal: r.signal, stdout: out ?? (r.stdout || '').slice(-3000), stderr: (r.stderr || '').slice(-2000), sessions: sessionsSince(t0), fileAfter: existsSync(target) ? readFileSync(target, 'utf8') : null });
    cli('P3c-repair-run', ['run', '--ledger', ledger]);
    record({ label: 'P3d-artifact', fileAfter: existsSync(target) ? readFileSync(target, 'utf8') : null });
  },
};

const which = process.argv[2];
for (const name of which === 'all' ? ['p1', 'p2', 'p3'] : [which]) {
  if (!phases[name]) throw new Error(`unknown phase ${name}`);
  await phases[name]();
}

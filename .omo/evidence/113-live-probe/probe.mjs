// NTG #113 live-probe harness — PO decision B. Measures the live agy binary;
// does NOT modify vNext behavior. Every case appends one record to results.jsonl
// and copies its session transcripts into this directory as dispatch evidence.
// Usage: bun probe.mjs <sanity|diag|sweep|jaguar|puma|bobcat|steamroller|runner>
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, existsSync, appendFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = '/home/sleeg/work/native-gravity';
const ART = join(REPO, '.omo/evidence/113-live-probe');
const BRAIN = `${process.env.HOME}/.gemini/antigravity-cli/brain`;
const AGY_NEW = `${process.env.HOME}/.local/bin/agy`; // 1.3.3
const AGY_OLD = '/usr/bin/agy';                       // 1.2.12 (pacman, unmodified)
const NTG_RUN = join(REPO, 'scripts/ntg-run.mjs');
const INSTALLED = `${process.env.HOME}/.gemini/config/plugins/native-gravity`;
mkdirSync(ART, { recursive: true });
const RESULTS = join(ART, 'results.jsonl');

function brainDirs() {
  try {
    return readdirSync(BRAIN)
      .map(n => join(BRAIN, n))
      .filter(p => { try { return statSync(p).isDirectory(); } catch { return false; } });
  } catch { return []; }
}

function grabTranscripts(t0, label, conversationIds = []) {
  const found = [];
  const wanted = new Set(conversationIds);
  for (const dir of brainDirs()) {
    const uuid = dir.split('/').pop();
    let st; try { st = statSync(dir); } catch { continue; }
    const fresh = st.mtimeMs >= t0 - 2000;
    if (!fresh && !wanted.has(uuid)) continue;
    // 1.3.x writes under .system_generated/logs/; 1.2.12 at the session root.
    const roots = [join(dir, '.system_generated/logs'), dir];
    for (const root of roots) {
      for (const name of ['transcript.jsonl', 'transcript_full.jsonl']) {
        const src = join(root, name);
        if (!existsSync(src)) continue;
        const dst = `${label}-${uuid.slice(0, 8)}-${name}`;
        try { copyFileSafe(src, join(ART, dst)); found.push({ uuid, file: dst, src }); } catch { }
      }
    }
  }
  return found;
}
function copyFileSafe(a, b) { writeFileSync(b, readFileSync(a)); }

function extractEvidence(files) {
  const typeNames = new Set(), runCommands = [], tools = new Set();
  const patterns = { strixMarker: false, zenVerdict: null, interrupted: false };
  for (const f of files) {
    let text; try { text = readFileSync(join(ART, f.file), 'utf8'); } catch { continue; }
    if (/invoke_subagent/i.test(text)) tools.add('invoke_subagent');
    for (const m of text.matchAll(/"typeName"\s*:\s*"([A-Za-z0-9_-]+)"/g)) typeNames.add(m[1]);
    for (const m of text.matchAll(/"TypeName"\s*:\s*"([A-Za-z0-9_-]+)"/g)) typeNames.add(m[1]);
    for (const m of text.matchAll(/NTG_(EXCAVATOR|ZEN_VERIFY)=1\s+([^\n"\\]{1,120})/g)) runCommands.push(m[0].trim());
    if (/NTG_ROLE:\s*strix/i.test(text)) patterns.strixMarker = true;
    const zv = text.match(/VERDICT:\s*(GO|NO-GO)/g); if (zv) patterns.zenVerdict = zv[zv.length - 1];
    if (/error:\s*interrupted/i.test(text)) patterns.interrupted = true;
    for (const m of text.matchAll(/"(?:name|toolName)"\s*:\s*"(view_file|list_dir|find_by_name|grep_search|run_command|write_to_file|replace_file_content|multi_replace_file_content|invoke_subagent|send_message|manage_subagents|read_file)"/g)) tools.add(m[1]);
  }
  return { typeNames: [...typeNames], toolsSeen: [...tools], runCommandMarkers: runCommands, ...patterns };
}

function record(rec) {
  appendFileSync(RESULTS, JSON.stringify(rec) + '\n');
  console.log(JSON.stringify({ label: rec.label, exit: rec.exit, ms: rec.ms, dispatched: rec.evidence?.typeNames, verdict: rec.evidence?.zenVerdict, interrupted: rec.interrupted }));
  return rec;
}

function run(label, { argv, cwd = REPO, timeoutMs = 300000, env = {} }) {
  const t0 = Date.now();
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd, env: { ...process.env, ...env }, encoding: 'utf8',
    timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 40 * 1024 * 1024,
  });
  const ms = Date.now() - t0;
  const transcripts = grabTranscripts(t0, label);
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  let parsed = null;
  try { parsed = JSON.parse(stdout); } catch { }
  if (parsed?.conversation_id) {
    const more = grabTranscripts(t0, label, [parsed.conversation_id]);
    for (const m of more) if (!transcripts.some(t => t.file === m.file)) transcripts.push(m);
  }
  const evidence = extractEvidence(transcripts);
  const interrupted = /error:\s*interrupted/i.test(stdout + stderr) || result.error?.code === 'ETIMEDOUT' || evidence.interrupted;
  return record({
    label, argv, cwd, ms, exit: result.status, signal: result.signal,
    spawnError: result.error ? String(result.error.code || result.error) : null,
    interrupted, stdoutTail: stdout.slice(-3000), stderrTail: stderr.slice(-3000),
    parsedStatus: parsed?.status ?? parsed?.error?.code ?? null,
    transcriptFiles: transcripts, evidence,
  });
}

const agyArgs = (prompt, { skip = false, model = 'gemini-3.8-flash-low', agent = null, extra = [] } = {}) => {
  const a = [];
  if (agent) a.push('--agent', agent);
  a.push('--model', model, '--output-format', 'json');
  if (skip) a.push('--dangerously-skip-permissions');
  a.push('-p', prompt, ...extra);
  return a;
};

const PHASE = process.argv[2];
const multiStep = (prompt) => `Do BOTH of these steps using your tools, in order.\nSTEP 1: ${prompt}\nSTEP 2: reply with exactly: TWO_STEPS_DONE`;

const phases = {
  sanity: () => [
    run('A0-simple-print', { argv: [AGY_NEW, ...agyArgs('Reply with exactly: PONG')] }),
  ],
  diag: () => [
    run('A1a-1.3.3-noskip-multistep', {
      argv: [AGY_NEW, ...agyArgs(multiStep('Use the view_file tool to read package.json and tell me the value of its "name" field.'))],
    }),
    run('A1b-1.3.3-skip-multistep', {
      argv: [AGY_NEW, ...agyArgs(multiStep('Use the view_file tool to read package.json and tell me the value of its "name" field.'), { skip: true })],
    }),
    run('A1c-1.2.12-noskip-multistep', {
      argv: [AGY_OLD, ...agyArgs(multiStep('Use the view_file tool to read package.json and tell me the value of its "name" field.'))],
      timeoutMs: 180000,
    }),
    run('A1d-1.2.12-skip-multistep', {
      argv: [AGY_OLD, ...agyArgs(multiStep('Use the view_file tool to read package.json and tell me the value of its "name" field.'), { skip: true })],
      timeoutMs: 180000,
    }),
    run('A2-1.3.3-noskip-runcommand', {
      argv: [AGY_NEW, ...agyArgs('Run the shell command `pwd` using your command execution tool, then reply with exactly: PWD_OK')],
    }),
    run('A3-1.2.12-noskip-runcommand', {
      argv: [AGY_OLD, ...agyArgs('Run the shell command `pwd` using your command execution tool, then reply with exactly: PWD_OK')],
      timeoutMs: 180000,
    }),
  ],
  sweep: () => {
    const cmd = (label, argv) => {
      const r = spawnSync(argv[0], argv.slice(1), { cwd: REPO, encoding: 'utf8', timeout: 120000, maxBuffer: 10 * 1024 * 1024 });
      return { label, exit: r.status, stdout: (r.stdout || '').slice(0, 6000), stderr: (r.stderr || '').slice(0, 2000) };
    };
    const declared = {};
    const agentDir = join(INSTALLED, 'agents');
    for (const f of readdirSync(agentDir)) {
      if (!f.endsWith('.md')) continue;
      const text = readFileSync(join(agentDir, f), 'utf8');
      const fm = (text.match(/^---\n([\s\S]*?)\n---/) || [])[1] || '';
      const tools = [...fm.matchAll(/^\s*-\s*([a-z_]+)\s*$/gm)].map(m => m[1]);
      declared[f] = {
        tools,
        mainAgent: /mainAgent:\s*true/.test(fm), subagent: /subagent:\s*true/.test(fm),
        model: (fm.match(/model:\s*(\S+)/) || [])[1] ?? null,
        execPolicy: (fm.match(/commandExecutionPolicy:\s*(\S+)/) || [])[1] ?? null,
      };
    }
    const liveToolsAsk = run('S1-live-tool-inventory', {
      argv: [AGY_NEW, '--agent', 'bulldozer', '--model', 'gemini-3.8-flash-medium', '--output-format', 'json', '--dangerously-skip-permissions',
        '-p', 'List the exact names of every tool available to you right now, one per line, nothing else.'],
    });
    const inventory = {
      agyVersion: cmd('version', [AGY_NEW, '--version']),
      agyOldVersion: cmd('old-version', [AGY_OLD, '--version']),
      agents: cmd('agents', [AGY_NEW, 'agent']),
      models: cmd('models', [AGY_NEW, 'models']),
      pluginList: cmd('plugin-list', [AGY_NEW, 'plugin', 'list']),
      pluginValidate: cmd('plugin-validate', [AGY_NEW, 'plugin', 'validate', '.']),
      help: cmd('help', [AGY_NEW, '--help']),
      declaredInstalledAgents: declared,
      installedHooksJson: readFileSync(join(INSTALLED, 'hooks.json'), 'utf8'),
      liveToolAskTranscript: liveToolsAsk.transcriptFiles.map(t => t.file),
      liveToolAskOutput: liveToolsAsk.stdoutTail,
    };
    writeFileSync(join(ART, 'sweep.json'), JSON.stringify(inventory, null, 2));
    console.log('sweep.json written');
  },
  jaguar: () => [
    run('B1a-bulldozer-jaguar', {
      argv: ['node', NTG_RUN, '--agent', 'bulldozer', '--model', 'gemini-3.8-flash-medium', '--dangerously-skip-permissions',
        '-p', 'NTG_ROLE: bulldozer\nDelegate this bounded unit to the factual-discovery specialist (Jaguar) rather than inspecting yourself: locate the largest file by line count under scripts/ and report its name and line count. When the specialist reports back, relay its answer and stop.'],
    }),
  ],
  puma: () => [
    run('B1b-bulldozer-puma', {
      argv: ['node', NTG_RUN, '--agent', 'bulldozer', '--model', 'gemini-3.8-flash-medium', '--dangerously-skip-permissions',
        '-p', 'NTG_ROLE: bulldozer\nDelegate this bounded unit to the quick/writing specialist (Puma): create /tmp/ntg113-puma-note.txt containing exactly the three lines "alpha", "beta", "gamma". When the specialist reports back, reply with exactly: PUMA_LEG_DONE'],
    }),
  ],
  bobcat: () => [
    run('B1c-bulldozer-bobcat-strix', {
      argv: ['node', NTG_RUN, '--agent', 'bulldozer', '--model', 'gemini-3.8-flash-medium', '--dangerously-skip-permissions',
        '-p', 'NTG_ROLE: bulldozer\nDelegate this bounded implementation unit to Bobcat with ADVISOR_GATE: REQUIRED (Strix Halo must review): create /tmp/ntg113-bobcat-marker.txt containing exactly the line "marker" and verify it exists. When the specialist reports back, reply with exactly: BOBCAT_LEG_DONE'],
      timeoutMs: 420000,
    }),
  ],
  steamroller: async () => {
    const { MinimalSpine } = await import(join(REPO, 'scripts/spine.mjs'));
    const ledgerDir = mkdtempSync(join(tmpdir(), 'ntg113-spine-'));
    const ledgerPath = join(ledgerDir, 'ledger.json');
    const calls = [];
    const invokeZen = async (request) => {
      const prompt = 'Independently verify using read-only tools. Return only a bare JSON object (no code fences) with fields: milestone_id, plan_version, result_ref, verdict (GO or NO-GO), verification_evidence. verification_evidence MUST be an array of objects, each {"classification": "OBSERVED", "detail": "<what you directly observed>"}. Request:\n' + JSON.stringify(request);
      const r = spawnSync(AGY_NEW, ['--agent', 'zen', '--model', 'gemini-3.1-pro-low', '--output-format', 'json', '--dangerously-skip-permissions', '-p', prompt],
        { cwd: REPO, encoding: 'utf8', timeout: 240000, killSignal: 'SIGKILL', maxBuffer: 20 * 1024 * 1024 });
      calls.push({ role: 'zen', exit: r.status, stdoutTail: (r.stdout || '').slice(-2000) });
      let parsed; try { parsed = JSON.parse(r.stdout); } catch { }
      let inner = parsed?.message ?? parsed?.result ?? parsed?.response ?? r.stdout;
      if (typeof inner === 'string') {
        inner = inner.trim().replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/, '');
      }
      let json; try { json = JSON.parse(typeof inner === 'string' ? inner : JSON.stringify(inner)); } catch (e) { throw new Error('zen-unparseable: ' + String(inner).slice(0, 300)); }
      return json;
    };
    const plan = {
      goal: 'Observe one read-only repository fact',
      constraints: ['Read-only inspection; no writes'], decision_invariants: [], plan_version: 'v1',
      milestones: [{ id: 'one', title: 'version', objective: 'Use a read-only tool to inspect package.json and report the value of its "version" field', bounded_scope: ['package.json'], acceptance_criteria: ['Version value independently observed using a tool', 'Result packet binds the delivered artifact via a non-empty candidate_artifact_ref string'], non_goals: ['Any file modification'], dependencies: [] }],
    };
    const spine = new MinimalSpine({ ledgerPath, plan, invokeZen, runnerOptions: { timeout: 300000 } });
    const t0 = Date.now();
    let out;
    try { out = await spine.runMilestone('one'); } catch (e) { out = { threw: String(e).slice(0, 500) }; }
    const convIds = calls.map(c => { try { return JSON.parse(c.stdoutTail?.length < 1000 ? c.stdoutTail : ''); } catch { return null; } }).filter(Boolean).map(p => p.conversation_id).filter(Boolean);
    const transcripts = grabTranscripts(t0, 'B2-steamroller-zen', convIds);
    const evidence = extractEvidence(transcripts);
    let ledger = null; try { ledger = JSON.parse(readFileSync(ledgerPath, 'utf8')); } catch { }
    record({
      label: 'B2-steamroller-zen', argv: ['MinimalSpine.runMilestone(one)'], cwd: REPO,
      ms: Date.now() - t0, exit: out?.verdict ? 0 : 1, interrupted: false,
      milestoneResult: out, zenCalls: calls, ledgerTail: ledger ? JSON.stringify(ledger).slice(0, 1500) : null,
      transcriptFiles: transcripts, evidence,
    });
  },
  runner: async () => {
    const { resolveSlug, invokeTransport } = await import(join(REPO, 'scripts/runner.mjs'));
    const slugs = {};
    for (const role of ['piledriver', 'bulldozer', 'steamroller']) {
      try { slugs[role] = resolveSlug(role); } catch (e) { slugs[role] = 'ERR: ' + e.message; }
    }
    record({ label: 'B3-slug-resolution-v2', argv: ['resolveSlug x3'], ms: 0, exit: 0, slugs });
    for (const role of ['piledriver', 'bulldozer']) {
      const slug = slugs[role];
      if (typeof slug !== 'string' || slug.startsWith('ERR')) continue;
      const t0 = Date.now();
      const r = invokeTransport(slug, 'Reply with exactly: SLUG_OK', { role, timeout: 240000 });
      const transcripts = grabTranscripts(t0, `B3-${role}`);
      record({ label: `B3-live-${role}`, argv: ['invokeTransport', slug], ms: Date.now() - t0, exit: r.ok ? 0 : 1, result: { ok: r.ok, error: r.error ?? null, tail: JSON.stringify(r).slice(-1200) }, transcriptFiles: transcripts, evidence: extractEvidence(transcripts) });
    }
  },
};

const t = phases[PHASE];
if (!t) { console.error('unknown phase: ' + PHASE); process.exit(2); }
await t();
console.log('PHASE_DONE ' + PHASE);

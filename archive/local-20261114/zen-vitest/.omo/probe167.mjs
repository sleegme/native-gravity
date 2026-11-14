import { invoke } from '/home/sleeg/.cache/ntg-167-20261028/wt/scripts/runner.mjs';
const r = await invoke({ role: 'bulldozer', handoff: { task: 'Reply with exactly: BULLDOZER_NO_SHELL_PASS', milestone_id: 'probe-167' }, timeoutMs: 300000 });
console.log(JSON.stringify({ ok: r.ok, response: (r.response||'').slice(0,120), denied: r.denied_actions, error: r.error }, null, 1));
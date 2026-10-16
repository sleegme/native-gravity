import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { invoke, resolveSlug } from '../scripts/runner.mjs';
import { MinimalSpine } from '../scripts/spine.mjs';
import { main } from '../scripts/ntg-vnext.mjs';

const root = new URL('../', import.meta.url);

test('Navi resolves Argon Medium and fails closed without that model', () => {
  const installedModels = ['gemini-4-argon-high', 'gemini-4-argon-medium'];
  assert.equal(resolveSlug('navi', { installedModels }), 'gemini-4-argon-medium');
  assert.throws(() => resolveSlug('navi', { installedModels: installedModels.slice(0, 1) }),
    { error: 'UNRESOLVED_MODEL_SLUG' });
});

test('desktop MCP configuration belongs only to Navi', () => {
  const navi = readFileSync(new URL('agents/navi.md', root), 'utf8');
  const frontmatter = navi.match(/^---\n([\s\S]*?)\n---/)[1];
  assert.match(frontmatter, /mcpServers:\n/);
  assert.match(frontmatter, /name: computer-use-linux\n/);
  assert.match(frontmatter, /command: computer-use-linux\n/);
  assert.match(frontmatter, /args:\n\s+- mcp(?:\n|$)/);
  for (const entry of readdirSync(new URL('agents/', root))) {
    if (entry !== 'navi.md') {
      assert.doesNotMatch(readFileSync(new URL(`agents/${entry}`, root), 'utf8'),
        /computer-use-linux/, entry);
    }
  }
  function checkConfigs(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const path = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
      if (entry.isDirectory()) checkConfigs(path);
      else if (entry.name === 'plugin.json' || /mcp.*\.json$/i.test(entry.name)) {
        assert.doesNotMatch(readFileSync(path, 'utf8'), /computer-use-linux/, path.pathname);
      }
    }
  }
  checkConfigs(root);
});

test('Navi result contract includes confirmation sentinel and intended action', () => {
  const prompt = readFileSync(new URL('agents/navi.md', root), 'utf8');
  assert.match(prompt, /`NEEDS_CONFIRMATION`/);
  assert.match(prompt, /`intended_action`/);
});

test('Navi transport selects the agent and exact model without replaying empty output', t => {
  const calls = [];
  t.mock.method(childProcess, 'spawnSync', (command, args) => {
    calls.push({ command, args });
    return { status: 0, stdout: JSON.stringify({ status: 'SUCCESS', response: '' }) };
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  invoke('navi', { task: 'Observe desktop' }, {
    installedModels: ['gemini-4-argon-medium'],
  });
  assert.equal(calls.length, 1);
  const { args } = calls[0];
  assert.equal(args[args.indexOf('--agent') + 1], 'navi');
  assert.equal(args[args.indexOf('--model') + 1], 'gemini-4-argon-medium');
  assert.ok(args.includes('--dangerously-skip-permissions'));
});

test('Steamroller desktop results do not change the ledger or authorize workers', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'ntg-navi-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const ledgerPath = join(directory, 'ledger.json');
  const plan = {
    goal: 'Observe desktop', constraints: ['No external actions'],
    decision_invariants: [], plan_version: 'v1',
    milestones: [{
      id: 'one', title: 'one', objective: 'Observe desktop', bounded_scope: ['desktop'],
      acceptance_criteria: ['Screenshot observed'], non_goals: [], dependencies: [],
    }],
  };
  let response = { status: 'NEEDS_CONFIRMATION', intended_action: 'Submit the displayed form' };
  const calls = [];
  const deps = {
    handleSignals: false,
    invokeRole: (role, packet) => {
      calls.push({ role, packet });
      return { ok: true, response: JSON.stringify(response) };
    },
    invokeZen: () => { throw new Error('Desktop tasks must not request Zen'); },
  };
  const spine = new MinimalSpine({ ledgerPath, plan, ...deps });
  const before = readFileSync(ledgerPath);
  const result = await spine.requestDesktop('Submit a form');
  assert.equal(result.status, 'NEEDS_CONFIRMATION');
  assert.deepEqual(readFileSync(ledgerPath), before);
  assert.deepEqual(calls.map(c => c.role), ['navi']);
  await assert.rejects(spine.invokeSpecialist('navi', {}, { caller: 'bulldozer' }));
  response = { status: 'NEEDS_CONFIRMATION' };
  await assert.rejects(spine.requestDesktop('Submit a form'), { error: 'INVALID_RESPONSE_FORMAT' });
  spine.close();
  response = { status: 'NEEDS_CONFIRMATION', intended_action: 'Submit the displayed form' };
  const cli = await main(['navi', '--ledger', ledgerPath, '--task', 'Submit a form'], deps);
  assert.equal(cli.code, 2);
  assert.equal(cli.out.desktop.intended_action, response.intended_action);
  assert.deepEqual(readFileSync(ledgerPath), before);
});

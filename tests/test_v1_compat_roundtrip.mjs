import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { LedgerKernel } from "../src/core/ledger-kernel.mjs";
import {
  fromV1LedgerJSON,
  loadV1Ledger,
  loadV1Plan,
  loadV1PluginConfig,
  migrateProtectedConfigViaAdapter,
  saveV1CompatibleLedger,
  saveV1CompatiblePlan,
  saveV1CompatiblePluginConfig,
  toV1CompatibleLedgerJSON,
} from "../src/core/v1-compat.mjs";

const FIXTURE_LEDGER = fileURLToPath(new URL("./fixtures/pre-usage.ledger.json", import.meta.url));
const ROOT_PLUGIN = fileURLToPath(new URL("../plugin.json", import.meta.url));

test("1.x ledger.json round-trip: load -> operate -> save -> reload preserves semantics", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "ntg-v1-ledger-rt-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const ledgerPath = join(dir, ".ntg", "ledger.json");
  const original = JSON.parse(readFileSync(FIXTURE_LEDGER, "utf8"));
  const kernel = fromV1LedgerJSON(original);

  assert.ok(kernel instanceof LedgerKernel);
  assert.equal(kernel.goal, original.goal);
  assert.equal(kernel.plan_version, "v1");
  assert.deepEqual(kernel.completed_milestones, ["one"]);

  // Operate on milestone "two" using NTG 2.0 LedgerKernel
  const handoff = kernel.delegate("two");
  assert.equal(handoff.milestone_id, "two");
  assert.equal(handoff.plan_version, "v1");

  const cand = kernel.receiveCandidate({
    milestone_id: "two",
    plan_version: "v1",
    status: "DONE",
    changes_made: ["two.txt"],
    verification_evidence: [{ classification: "OBSERVED", criterion: "content matches", result: "verified two.txt" }],
    unresolved_unknowns: [],
    scope_deviations: [],
    candidate_artifact_ref: "sha256:two",
  });

  kernel.recordZenGo({
    milestone_id: "two",
    plan_version: "v1",
    result_ref: cand.result_ref,
    verdict: "GO",
    verification_evidence: [{ classification: "OBSERVED", criterion: "content matches", result: "zen verified two.txt" }],
  });

  // Save and reload
  saveV1CompatibleLedger(kernel, ledgerPath);
  const reloaded = loadV1Ledger(ledgerPath);

  assert.deepEqual(reloaded.completed_milestones, ["one", "two"]);
  assert.equal(reloaded.verification.one.verdict, "GO");
  assert.equal(reloaded.verification.two.verdict, "GO");
  assert.deepEqual(toV1CompatibleLedgerJSON(reloaded), kernel.toJSON());
  assert.equal(reloaded.declareGlobalCompletion().completed, true);
});

test("1.x plan.json round-trip: load -> operate -> save -> reload preserves 1.x milestone semantics", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "ntg-v1-plan-rt-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const planPath = join(dir, "plan.json");
  const v1Plan = {
    goal: "Ship 1.x compatible service",
    plan_version: "v1",
    constraints: ["Keep backward compat"],
    decision_invariants: [{ id: "DI-1", decision: "Use REST JSON", source_ref: "spec#1" }],
    milestones: [
      {
        id: "m1",
        title: "API",
        objective: "Expose /health",
        bounded_scope: ["src/server.mjs"],
        non_goals: ["UI"],
        dependencies: [],
        acceptance_criteria: ["/health returns 200"],
      },
      {
        id: "m2",
        title: "Tests",
        objective: "Add unit tests",
        bounded_scope: ["tests/server.test.mjs"],
        non_goals: [],
        dependencies: ["m1"],
        acceptance_criteria: ["All tests pass"],
      },
    ],
  };
  writeFileSync(planPath, JSON.stringify(v1Plan, null, 2));

  const loadedPlan = loadV1Plan(planPath);
  // Operate: initialize LedgerKernel from 1.x plan and add a milestone field before saving back
  const kernel = new LedgerKernel(loadedPlan);
  assert.equal(kernel.milestones.length, 2);

  loadedPlan.milestones[1].verify = ["node --test tests/server.test.mjs"];
  saveV1CompatiblePlan(loadedPlan, planPath);

  const reloadedPlan = loadV1Plan(planPath);
  assert.equal(reloadedPlan.goal, v1Plan.goal);
  assert.equal(reloadedPlan.plan_version, "v1");
  assert.deepEqual(reloadedPlan.decision_invariants, v1Plan.decision_invariants);
  assert.deepEqual(reloadedPlan.milestones[1].dependencies, ["m1"]);
  assert.deepEqual(reloadedPlan.milestones[1].verify, ["node --test tests/server.test.mjs"]);
});

test("1.x plugin.json round-trip and explicit Compatibility Adapter migration path", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "ntg-v1-plugin-rt-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const pluginPath = join(dir, "plugin.json");
  const ledgerPath = join(dir, ".ntg", "ledger.json");
  const planPath = join(dir, "plan.json");

  const origPlugin = JSON.parse(readFileSync(ROOT_PLUGIN, "utf8"));
  assert.doesNotMatch(origPlugin.description, /Excavator/);
  const v1PluginFixture = {
    ...origPlugin,
    description:
      "A thin Antigravity-native orchestration layer. Steamroller supervises Piledriver planning and Bulldozer milestones with independent Zen review; Jaguar, Puma, Bobcat, Strix Halo, and Excavator roles.",
  };
  writeFileSync(pluginPath, JSON.stringify(v1PluginFixture, null, 2));

  // Write 1.x ledger + plan into protected paths via adapter setup
  const v1Ledger = JSON.parse(readFileSync(FIXTURE_LEDGER, "utf8"));
  saveV1CompatibleLedger(fromV1LedgerJSON(v1Ledger), ledgerPath);
  saveV1CompatiblePlan(
    {
      goal: v1Ledger.goal,
      plan_version: v1Ledger.plan_version,
      milestones: v1Ledger.milestones,
    },
    planPath
  );

  const loadedPlugin = loadV1PluginConfig(pluginPath);
  assert.equal(loadedPlugin.name, "native-gravity");
  assert.equal(loadedPlugin.$schema, v1PluginFixture.$schema);

  // Save without altering description -> preserves exact fields
  saveV1CompatiblePluginConfig(loadedPlugin, pluginPath);
  assert.deepEqual(loadV1PluginConfig(pluginPath), v1PluginFixture);

  // Explicit migration through Compatibility Adapter internal path
  const migrated = migrateProtectedConfigViaAdapter({
    ledgerPath,
    planPath,
    pluginPath,
    updatePluginDescription: true,
  });
  assert.equal(migrated.ledger, ledgerPath);
  assert.equal(migrated.plan, planPath);
  assert.equal(migrated.plugin, pluginPath);

  const reloadedPlugin = loadV1PluginConfig(pluginPath);
  assert.equal(reloadedPlugin.name, "native-gravity");
  assert.match(reloadedPlugin.description, /Native Gravity 2\.0/);
  assert.doesNotMatch(reloadedPlugin.description, /Excavator/);
  assert.equal(loadV1Ledger(ledgerPath).completed_milestones[0], "one");
  assert.equal(loadV1Plan(planPath).goal, v1Ledger.goal);
});

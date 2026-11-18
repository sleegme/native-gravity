import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

function readDoc(relPath) {
  const full = join(ROOT, relPath);
  assert.ok(existsSync(full), `${relPath} must exist`);
  return readFileSync(full, "utf8");
}

test("branch-local NTG 2.0 governing contracts exist and supersede 1.x MinimalSpine", () => {
  const canonical = readDoc("docs/specs/ntg-2.0-architecture-contract.md");
  const superseded = readDoc("docs/specs/vnext-architecture-contract.md");
  const agentsMd = readDoc("AGENTS.md");
  const orchestration = readDoc("rules/orchestration.md");

  assert.match(superseded, /Superseded/i);
  assert.match(superseded, /ntg-2\.0-architecture-contract\.md/);

  for (const [label, doc] of [
    ["docs/specs/ntg-2.0-architecture-contract.md", canonical],
    ["AGENTS.md", agentsMd],
    ["rules/orchestration.md", orchestration],
  ]) {
    assert.match(doc, /LedgerKernel/, `${label}: mentions LedgerKernel`);
    assert.match(doc, /LightweightLog/, `${label}: mentions LightweightLog`);
    assert.match(doc, /gemini-pro-orchestrator-g1-pro/, `${label}: explicitly excludes AGY Orchestrator`);
    assert.match(doc, /Gemini 4 Hydrogen.*XHigh|gemini-4-hydrogen-xhigh/i, `${label}: Bulldozer Hydrogen XHigh`);
    assert.match(doc, /Gemini 4 Hydrogen.*Medium|gemini-4-hydrogen-medium/i, `${label}: Bobcat Hydrogen Medium`);
    assert.match(doc, /Gemini 4 Hydrogen.*High|gemini-4-hydrogen-high/i, `${label}: Strix Halo Hydrogen High`);
    assert.match(doc, /3\.8 Flash.*Low|gemini-3\.8-flash-low/i, `${label}: Jaguar/Puma 3.8 Flash Low`);
    assert.match(doc, /Excavator.*retired/is, `${label}: Excavator retired`);
    assert.match(doc, /shell-safety-guard\.py/, `${label}: universal shell-safety-guard`);
    assert.match(doc, /telemetry-guard\.py/, `${label}: observation-first telemetry-guard`);
    assert.match(doc, /Tactical Replan/i, `${label}: Tactical Replan rule`);
    assert.match(doc, /Material Replan/i, `${label}: Material Replan rule`);
    assert.match(doc, /HALO_LIGHTWEIGHT/, `${label}: Track L HALO_LIGHTWEIGHT badge`);
    assert.match(doc, /ZEN_DURABLE/, `${label}: Track S/M ZEN_DURABLE badge`);
  }
});

test("governing contracts enforce capability vs authority decoupling and cross-caller Strix Halo", () => {
  const canonical = readDoc("docs/specs/ntg-2.0-architecture-contract.md");
  const orchestration = readDoc("rules/orchestration.md");

  for (const doc of [canonical, orchestration]) {
    assert.match(doc, /capability.*authority|decoupl/i);
    assert.match(doc, /steamroller.*bulldozer.*bobcat/i);
    assert.match(doc, /reviewed_diff_digest/);
    assert.match(doc, /acceptance_criteria_digest/);
    assert.match(doc, /plan_version/);
    assert.match(doc, /write_to_file|replace_file_content|write_file|edit_file/);
    assert.match(doc, /NTG_ACTIVE_ROLE=zen/);
  }
});

test("test_role_guidance.mjs is decoupled from rules/orchestration.md in m0", () => {
  const roleGuidanceTest = readDoc("tests/test_role_guidance.mjs");
  assert.doesNotMatch(roleGuidanceTest, /"rules\/orchestration\.md"\s*:\s*\{/);
});

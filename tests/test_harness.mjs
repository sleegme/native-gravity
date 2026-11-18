import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HALO_CALLERS,
  LIGHTWEIGHT_MAX_FILES,
  LIGHTWEIGHT_MAX_READ_LINES,
  analyzeWorkSemantics,
  buildContextDigest,
  buildHaloReviewRequest,
  buildLayer1Calibration,
  composeModelAwareHarness,
  evaluateLightweightSuitability,
  readBoundedRange,
  resolveCalibrationProfile,
  validateLightweightResult,
} from "../src/harness/index.mjs";

test("Layer 1 calibration preserves native traits across model families", () => {
  const hydro = buildLayer1Calibration("gemini-4-hydrogen-xhigh");
  assert.equal(hydro.layer, "model-common-calibration");
  assert.equal(hydro.family, "Gemini 4 Hydrogen");
  assert.equal(hydro.preserveNativeTraits, true);
  assert.ok(hydro.directives.some((line) => line.includes("OBSERVED")));

  const carbon = resolveCalibrationProfile("Carbon Medium");
  assert.equal(carbon.family, "Gemini 4 Argon");

  const flash = resolveCalibrationProfile("gemini-3.8-flash-low");
  assert.equal(flash.family, "Gemini 3.8 Flash");

  const sonnet = resolveCalibrationProfile("claude-sonnet-5-5-high");
  assert.equal(sonnet.family, "Claude Sonnet 5.5");

  const opus = resolveCalibrationProfile("claude-opus-5-5-high");
  assert.equal(opus.family, "Claude Opus 5.5");

  const generic = resolveCalibrationProfile("custom-unknown-model");
  assert.equal(generic.preserveNativeTraits, true);
});

test("Halo ReviewRequest enforces authorized callers and required digest bindings", () => {
  assert.deepEqual(HALO_CALLERS, ["steamroller", "bulldozer", "bobcat"]);
  for (const caller of HALO_CALLERS) {
    const req = buildHaloReviewRequest({
      caller,
      candidate_id_or_run_id: "cand-1",
      reviewed_diff_digest: "sha256:abc",
      acceptance_criteria_digest: "sha256:def",
      plan_version: 2,
      evidence_basis: ["unit test passed"],
      track: "L",
    });
    assert.equal(req.caller, caller);
    assert.equal(req.plan_version, 2);
  }

  for (const denied of ["jaguar", "puma", "zen", "piledriver", "instinct"]) {
    assert.throws(
      () =>
        buildHaloReviewRequest({
          caller: denied,
          candidate_id_or_run_id: "cand-1",
          reviewed_diff_digest: "sha256:abc",
          acceptance_criteria_digest: "sha256:def",
          plan_version: 1,
        }),
      /Invalid Strix Halo caller/
    );
  }

  assert.throws(
    () =>
      buildHaloReviewRequest({
        caller: "bobcat",
        candidate_id_or_run_id: "cand-1",
        reviewed_diff_digest: "",
        acceptance_criteria_digest: "sha256:def",
        plan_version: 1,
      }),
    /requires candidate_id_or_run_id/
  );
});

test("composeModelAwareHarness binds Layer 1 + Layer 2 + Layer 3 without expanding role authority", () => {
  const envelope = composeModelAwareHarness({
    role: "puma",
    modelSlug: "gemini-4-hydrogen-medium",
    track: "L",
    contextDigest: { delivered_diff_digest: "sha256:123" },
  });
  assert.equal(envelope.layer1.family, "Gemini 4 Hydrogen");
  assert.equal(envelope.layer2.role, "puma");
  assert.equal(envelope.layer2.authority.canRunCommand, false);
  assert.deepEqual(envelope.layer2.authority.allowedDelegations, []);
  assert.equal(envelope.layer2.track, "L");
  assert.deepEqual(envelope.layer3, { delivered_diff_digest: "sha256:123" });

  const jaguarDefault = composeModelAwareHarness({ role: "jaguar", track: "L" });
  assert.equal(jaguarDefault.layer1.family, "Gemini 3.8 Flash");

  const bobcatDefault = composeModelAwareHarness({ role: "bobcat", track: "S" });
  assert.equal(bobcatDefault.layer1.family, "Gemini 4 Hydrogen");
});

test("buildContextDigest builds compact scope, symbol, failure, and digest metadata", () => {
  const dir = mkdtempSync(join(tmpdir(), "ntg-digest-"));
  try {
    writeFileSync(join(dir, "sample.mjs"), "export function alpha() { return 1; }\nexport const beta = 2;\n");
    const digest = buildContextDigest({
      boundedScope: ["sample.mjs"],
      cwd: dir,
      failureHistory: [{ status: "NO-GO", error: "test assertion failed" }],
      acceptanceCriteria: ["alpha returns 1"],
    });
    assert.equal(digest.scope_map.files.length, 1);
    assert.equal(digest.scope_map.missing.length, 0);
    assert.equal(digest.changed_symbol_ranges.length, 1);
    assert.equal(digest.failure_summary.length, 1);
    assert.equal(digest.failure_summary[0].error, "test assertion failed");
    assert.match(digest.delivered_diff_digest, /^sha256:/);
    assert.match(digest.acceptance_criteria_digest, /^sha256:/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Lightweight Worker Harness suitability routing, bounded reads, and output validation", () => {
  assert.equal(
    evaluateLightweightSuitability({
      role: "jaguar",
      task: "Find symbol definition in two files",
      targetFiles: ["a.mjs", "b.mjs"],
    }).suitable,
    true
  );

  const jagWrite = evaluateLightweightSuitability({
    role: "jaguar",
    task: "Implement feature X",
    requiresSubstantiveCode: true,
  });
  assert.equal(jagWrite.suitable, false);
  assert.equal(jagWrite.signal, "REROUTE_REQUIRED");
  assert.equal(jagWrite.rerouteTo, "bobcat");

  const pumaCode = evaluateLightweightSuitability({
    role: "puma",
    task: "Add API state machine handler",
    requiresSubstantiveCode: true,
  });
  assert.equal(pumaCode.suitable, false);
  assert.equal(pumaCode.rerouteTo, "bobcat");

  const tooManyFiles = evaluateLightweightSuitability({
    role: "puma",
    task: "Format config headers",
    targetFiles: Array.from({ length: LIGHTWEIGHT_MAX_FILES + 1 }, (_, i) => `f${i}.json`),
  });
  assert.equal(tooManyFiles.suitable, false);
  assert.equal(tooManyFiles.rerouteTo, "bulldozer");

  const deepArch = evaluateLightweightSuitability({
    role: "puma",
    task: "Architectural concurrency refactor",
  });
  assert.equal(deepArch.suitable, false);
  assert.equal(deepArch.rerouteTo, "bulldozer");

  const dir = mkdtempSync(join(tmpdir(), "ntg-lwh-"));
  try {
    const lines = Array.from({ length: 200 }, (_, i) => `line ${i + 1}`).join("\n");
    writeFileSync(join(dir, "long.txt"), lines);
    const slice = readBoundedRange("long.txt", { startLine: 1, endLine: 200, cwd: dir });
    assert.equal(slice.startLine, 1);
    assert.equal(slice.endLine, LIGHTWEIGHT_MAX_READ_LINES);
    assert.equal(slice.truncated, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  assert.equal(validateLightweightResult("jaguar", { status: "READY", facts: ["f1"] }).valid, true);
  assert.equal(validateLightweightResult("jaguar", { status: "READY" }).valid, false);
  assert.equal(validateLightweightResult("puma", { status: "READY", changes_made: ["a.json"] }).valid, true);
  assert.equal(validateLightweightResult("puma", { status: "READY" }).valid, false);
  assert.equal(
    validateLightweightResult("puma", { status: "REROUTE_REQUIRED", reroute_to: "bobcat" }).valid,
    true
  );
  assert.equal(
    validateLightweightResult("puma", { status: "REROUTE_REQUIRED", reroute_to: "excavator" }).valid,
    false
  );
});

test("analyzeWorkSemantics routes by capability and effect without lexical filename false-promotions (#235)", () => {
  // 1-file docs typo / config edit -> puma, Track L
  const docsEdit = analyzeWorkSemantics({ task: "Fix typo in README.md", targetFiles: ["README.md"] });
  assert.equal(docsEdit.recommendedRole, "puma");
  assert.equal(docsEdit.recommendedTrack, "L");

  const configEdit = analyzeWorkSemantics({ task: "Update timeout in config.json", targetFiles: ["config.json"] });
  assert.equal(configEdit.recommendedRole, "puma");
  assert.equal(configEdit.recommendedTrack, "L");

  // 1-file substantive state/API change -> bobcat, Track S
  const apiChange = analyzeWorkSemantics({
    task: "Add session state transition handler",
    targetFiles: ["src/session.mjs"],
  });
  assert.equal(apiChange.recommendedRole, "bobcat");
  assert.equal(apiChange.recommendedTrack, "S");

  // Read-only locate/inspect -> jaguar, Track L even with non-empty targetFiles
  const inspect = analyzeWorkSemantics({
    task: "Locate all callers of saveLedger",
    targetFiles: ["src/core/ledger-kernel.mjs", "scripts/ntg-vnext.mjs"],
  });
  assert.equal(inspect.recommendedRole, "jaguar");
  assert.equal(inspect.recommendedTrack, "L");

  // 5-file trivial mechanical rename -> puma, never promoted to Bulldozer by keyword alone
  const rename5 = analyzeWorkSemantics({
    task: "Rename security_flag constant across 5 files mechanically",
    targetFiles: ["a.mjs", "b.mjs", "c.mjs", "d.mjs", "e.mjs"],
    isMechanicalEdit: true,
  });
  assert.equal(rename5.recommendedRole, "puma");
  assert.equal(rename5.recommendedTrack, "L");

  // architecture.md doc edit -> stays lightweight (puma / Track L)
  const archDocEdit = analyzeWorkSemantics({
    task: "Fix formatting and wording in docs/architecture.md",
    targetFiles: ["docs/architecture.md"],
  });
  assert.equal(archDocEdit.recommendedRole, "puma");
  assert.equal(archDocEdit.recommendedTrack, "L");

  // Genuine cross-cutting migration -> bulldozer / Track M
  const migration = analyzeWorkSemantics({
    task: "Cross-cutting database migration across runtime and ledger storage",
    targetFiles: ["src/db.mjs", "src/runtime.mjs", "src/storage.mjs"],
    crossFileDependency: true,
  });
  assert.equal(migration.recommendedRole, "bulldozer");
  assert.equal(migration.recommendedTrack, "M");
});

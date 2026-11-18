import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  AuthorityExpansionError,
  EXCLUDED_DEFAULT_MODELS,
  ModelRouter,
  ROLE_AUTHORITY_TABLE,
  ROLE_POLICY_TABLE,
  UnresolvedModelSlugError,
  clearModelCatalogCache,
  getRoleAuthority,
  listInstalledModels,
  resolveSlug,
} from "../src/core/model-router.mjs";

const NTG2_CATALOG = [
  { slug: "gemini-4-argon-medium", description: "Gemini 4 Argon (Medium)" },
  { slug: "gemini-4-argon-high", description: "Gemini 4 Argon (High)" },
  { slug: "gemini-4-hydrogen-xhigh", description: "Gemini 4 Hydrogen (XHigh)" },
  { slug: "gemini-4-hydrogen-high", description: "Gemini 4 Hydrogen (High)" },
  { slug: "gemini-4-hydrogen-medium", description: "Gemini 4 Hydrogen (Medium)" },
  { slug: "gemini-3.8-flash-low", description: "Gemini 3.8 Flash (Low)" },
  { slug: "gemini-3.8-flash-high", description: "Gemini 3.8 Flash (High)" },
  { slug: "claude-opus-5-5-high", description: "Claude Opus 5.5 (High)" },
  { slug: "claude-sonnet-5-5-high", description: "Claude Sonnet 5.5 (High)" },
  { slug: "gemini-pro-orchestrator-g1-pro", description: "Orchestrator (Argon)" },
];

test("ModelRouter resolves all NTG 2.0 role slots accurately and retires Excavator", () => {
  assert.equal(ROLE_POLICY_TABLE.excavator, undefined);

  assert.equal(resolveSlug("steamroller", { installedModels: NTG2_CATALOG }), "gemini-4-argon-medium");
  assert.equal(resolveSlug("piledriver", { installedModels: NTG2_CATALOG }), "gemini-4-argon-high");
  assert.equal(resolveSlug("bulldozer", { installedModels: NTG2_CATALOG }), "gemini-4-hydrogen-xhigh");
  assert.equal(resolveSlug("strix-halo", { installedModels: NTG2_CATALOG }), "gemini-4-hydrogen-high");
  assert.equal(resolveSlug("strix_halo", { installedModels: NTG2_CATALOG }), "gemini-4-hydrogen-high");
  assert.equal(resolveSlug("bobcat", { installedModels: NTG2_CATALOG }), "gemini-4-hydrogen-medium");
  assert.equal(resolveSlug("jaguar", { installedModels: NTG2_CATALOG }), "gemini-3.8-flash-low");
  assert.equal(resolveSlug("puma", { installedModels: NTG2_CATALOG }), "gemini-3.8-flash-low");
  assert.equal(resolveSlug("zen", { installedModels: NTG2_CATALOG }), "claude-opus-5-5-high");
  assert.equal(resolveSlug("zen", { installedModels: NTG2_CATALOG, quotaFallback: true }), "gemini-4-argon-high");
  assert.equal(resolveSlug("instinct", { installedModels: NTG2_CATALOG }), "claude-sonnet-5-5-high");
  assert.equal(resolveSlug("instinct", { installedModels: NTG2_CATALOG, escalate: true }), "claude-opus-5-5-high");
  assert.equal(resolveSlug("navi", { installedModels: NTG2_CATALOG }), "gemini-4-argon-medium");
});

test("Steamroller resolves Carbon Medium first when exposed and excludes gemini-pro-orchestrator-g1-pro", () => {
  const withCarbon = [
    ...NTG2_CATALOG,
    { slug: "carbon-medium-preview", description: "Carbon (Medium)" },
  ];
  assert.equal(resolveSlug("steamroller", { installedModels: withCarbon }), "carbon-medium-preview");

  // Even if only AGY Orchestrator is available, default routing must exclude it and fail closed.
  assert.ok(EXCLUDED_DEFAULT_MODELS.includes("gemini-pro-orchestrator-g1-pro"));
  assert.throws(
    () => resolveSlug("steamroller", {
      installedModels: [{ slug: "gemini-pro-orchestrator-g1-pro", description: "Orchestrator (Argon)" }],
    }),
    (err) => err instanceof UnresolvedModelSlugError && err.reason === "NOT_FOUND"
  );
  assert.throws(
    () => resolveSlug("steamroller", {
      installedModels: NTG2_CATALOG,
      modelOverride: "gemini-pro-orchestrator-g1-pro",
    }),
    (err) => err instanceof UnresolvedModelSlugError && err.reason === "EXCLUDED_MODEL"
  );
});

test("Dynamic model overrides validate fail-closed and strictly decouple capability from role authority", () => {
  const router = new ModelRouter({ installedModels: NTG2_CATALOG });

  const upgradedJaguar = router.resolve("jaguar", { modelOverride: "gemini-4-hydrogen-medium" });
  assert.equal(upgradedJaguar.slug, "gemini-4-hydrogen-medium");
  assert.equal(upgradedJaguar.overridden, true);
  assert.equal(upgradedJaguar.authority.readOnly, true);
  assert.equal(upgradedJaguar.authority.canMutateProjectFiles, false);
  assert.equal(upgradedJaguar.authority.canRunCommand, false);
  assert.deepEqual(upgradedJaguar.authority, ROLE_AUTHORITY_TABLE.jaguar);

  const upgradedPuma = router.resolve("puma", {
    modelOverride: { family: "Gemini 4 Hydrogen", effort: "Medium" },
  });
  assert.equal(upgradedPuma.slug, "gemini-4-hydrogen-medium");
  assert.equal(upgradedPuma.authority.canRunCommand, false);
  assert.equal(upgradedPuma.authority.canWriteLedger, false);

  // Unknown override slug fails closed
  assert.throws(
    () => router.resolve("bobcat", { modelOverride: "unreleased-helix-xhigh" }),
    (err) => err instanceof UnresolvedModelSlugError && err.reason === "NOT_FOUND"
  );

  // Attempting to expand role authority via model override fails closed
  assert.throws(
    () => router.resolve("jaguar", {
      modelOverride: { slug: "gemini-4-hydrogen-xhigh", permissions: ["run_command", "write_to_file"] },
    }),
    AuthorityExpansionError
  );
  assert.throws(
    () => router.resolve("bobcat", {
      modelOverride: "gemini-4-hydrogen-xhigh",
      expandDelegation: true,
    }),
    AuthorityExpansionError
  );
  assert.throws(
    () => router.resolve("strix-halo", {
      modelOverride: "claude-opus-5-5-high",
      bypassVerification: true,
    }),
    AuthorityExpansionError
  );
  assert.equal(getRoleAuthority("strix-halo").readOnly, true);
  assert.deepEqual(getRoleAuthority("strix-halo").allowedCallers, ["steamroller", "bulldozer", "bobcat"]);
});

test("listInstalledModels caches agy models at session scope (#230)", (t) => {
  clearModelCatalogCache();
  t.after(() => clearModelCatalogCache());

  const dir = mkdtempSync(join(tmpdir(), "ntg-router-cache-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const agyPath = join(dir, "agy");
  const counterFile = join(dir, "count.txt");
  writeFileSync(counterFile, "");
  writeFileSync(
    agyPath,
    `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
appendFileSync(${JSON.stringify(counterFile)}, "probe\\n");
process.stdout.write(${JSON.stringify(
      NTG2_CATALOG.map((m) => `${m.slug}\t${m.description}`).join("\n") + "\n"
    )});
`,
    { mode: 0o755 }
  );
  chmodSync(agyPath, 0o755);

  const first = listInstalledModels({ agyPath });
  const second = listInstalledModels({ agyPath });
  const slug1 = resolveSlug("bulldozer", { agyPath });
  const slug2 = resolveSlug("bobcat", { agyPath });
  const slug3 = resolveSlug("strix-halo", { agyPath });

  assert.equal(first.length, NTG2_CATALOG.length);
  assert.deepEqual(second, first);
  assert.equal(slug1, "gemini-4-hydrogen-xhigh");
  assert.equal(slug2, "gemini-4-hydrogen-medium");
  assert.equal(slug3, "gemini-4-hydrogen-high");

  const calls = readFileSync(counterFile, "utf8").trim().split("\n").filter(Boolean);
  assert.equal(calls.length, 1, `expected agy models to run once per session, ran ${calls.length} times`);

  // Explicit refreshCache re-probes once
  listInstalledModels({ agyPath, refreshCache: true });
  const callsAfterRefresh = readFileSync(counterFile, "utf8").trim().split("\n").filter(Boolean);
  assert.equal(callsAfterRefresh.length, 2);
});

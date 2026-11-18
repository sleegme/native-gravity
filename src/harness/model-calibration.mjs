/**
 * Layer 1: Model-Common Calibration (Clean-Room NTG 2.0 Harness).
 *
 * Preserves each model family's native reasoning, tool-use, and delegation
 * tendencies without homogenizing or suppressing model traits. Intervenes
 * strictly on observed cross-model friction and tool-interface clarity.
 */

export const MODEL_CALIBRATION_PROFILES = Object.freeze({
  "gemini-4-argon": Object.freeze({
    family: "Gemini 4 Argon",
    preserveNativeTraits: true,
    traits: Object.freeze([
      "Preserve concise architectural synthesis and long-horizon planning judgment.",
      "Do not inject micro-managed step scripts or redundant checklist scaffolding.",
    ]),
    frictionCalibrations: Object.freeze([
      "Classify every material claim strictly as OBSERVED, INFERRED, or UNKNOWN.",
      "Never fill missing context, credentials, or unexecuted checks with plausible assumptions.",
      "Surface exact tool interface errors verbatim before choosing a fallback or escalation.",
    ]),
  }),
  "gemini-4-hydrogen": Object.freeze({
    family: "Gemini 4 Hydrogen",
    preserveNativeTraits: true,
    traits: Object.freeze([
      "Preserve native multi-step code exploration, parallel tool calls, and test-driven iteration.",
      "Keep reasoning unconstrained by arbitrary per-turn read/call counts.",
    ]),
    frictionCalibrations: Object.freeze([
      "Label every reported outcome OBSERVED, INFERRED, or UNKNOWN from inspected outputs only.",
      "Separate formative implementation quality review (Strix Halo) from summative verification (Zen).",
      "On tool permission or protected-path denial, stop and report the exact boundary rather than retrying workarounds.",
    ]),
  }),
  "gemini-3.8-flash": Object.freeze({
    family: "Gemini 3.8 Flash",
    preserveNativeTraits: true,
    traits: Object.freeze([
      "Preserve fast, bounded execution for scoped discovery and mechanical text/config edits.",
    ]),
    frictionCalibrations: Object.freeze([
      "Emit explicit UNKNOWN or REROUTE_REQUIRED immediately when reasoning exceeds the bounded scope.",
      "Cite exact file paths, line ranges, and observed outputs rather than summarizing from memory.",
    ]),
  }),
  "claude-sonnet-5-5": Object.freeze({
    family: "Claude Sonnet 5.5",
    preserveNativeTraits: true,
    traits: Object.freeze([
      "Preserve independent causal hypothesis generation and cross-family critical framing.",
    ]),
    frictionCalibrations: Object.freeze([
      "Ground every competing hypothesis in OBSERVED vs INFERRED vs UNKNOWN evidence and specify one discriminating test.",
    ]),
  }),
  "claude-opus-5-5": Object.freeze({
    family: "Claude Opus 5.5",
    preserveNativeTraits: true,
    traits: Object.freeze([
      "Preserve thorough independent verification and adversarial edge-case scrutiny.",
    ]),
    frictionCalibrations: Object.freeze([
      "Link every criterion verdict strictly to OBSERVED inspection or verification command outputs.",
      "Maintain strict non-mutation across all shell and file boundaries.",
    ]),
  }),
});

/**
 * Resolves the Layer 1 calibration profile for a model slug or family name.
 */
export function resolveCalibrationProfile(modelSlugOrFamily) {
  const raw = String(modelSlugOrFamily ?? "").trim().toLowerCase();
  if (raw.includes("hydrogen")) return MODEL_CALIBRATION_PROFILES["gemini-4-hydrogen"];
  if (raw.includes("argon") || raw.includes("carbon")) return MODEL_CALIBRATION_PROFILES["gemini-4-argon"];
  if (raw.includes("3.8-flash") || raw.includes("3.8 flash")) return MODEL_CALIBRATION_PROFILES["gemini-3.8-flash"];
  if (raw.includes("sonnet")) return MODEL_CALIBRATION_PROFILES["claude-sonnet-5-5"];
  if (raw.includes("opus")) return MODEL_CALIBRATION_PROFILES["claude-opus-5-5"];
  return Object.freeze({
    family: modelSlugOrFamily || "generic",
    preserveNativeTraits: true,
    traits: Object.freeze(["Preserve native model reasoning style without forced homogenization."]),
    frictionCalibrations: Object.freeze([
      "Classify claims as OBSERVED, INFERRED, or UNKNOWN from directly inspected outputs.",
      "Do not bypass tool boundaries or silently fill missing authority.",
    ]),
  });
}

/**
 * Formats concise Layer 1 calibration block without micro-managing native reasoning.
 */
export function buildLayer1Calibration(modelSlugOrFamily) {
  const profile = resolveCalibrationProfile(modelSlugOrFamily);
  return {
    layer: "model-common-calibration",
    family: profile.family,
    preserveNativeTraits: profile.preserveNativeTraits,
    directives: [...profile.traits, ...profile.frictionCalibrations],
  };
}

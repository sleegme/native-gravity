# Native Gravity vNext 44B Exact-Model Runner Spike

## 1. Overview & Purpose

Implementation slice **44B** validates the minimal exact-model and reasoning-effort runner spike for Native Gravity vNext, as defined in `docs/specs/vnext-architecture-contract.md` (§6, §8, §9).

AGY native custom-subagent model selection (`inherit | flash | pro`) is too coarse for roles where exact model identity and reasoning effort materially affect behavior. The exact-model runner establishes a narrow, deterministic invocation layer that executes critical roles under their specified model and effort levels without introducing general orchestration weight.

## 2. Confirmed Model Slugs

From the installed AGY surface (`agy models`), model slugs and reasoning effort bindings were resolved and empirically validated:

| Role | Target Model Family | Effort | Exact AGY Model Slug | AGY Surface Description |
|---|---|---|---|---|
| **Piledriver** | Gemini 3.1 Pro | High | `gemini-3.1-pro-high` | Gemini 3.1 Pro (High) |
| **Bulldozer** | Gemini 3.8 Flash | High | `gemini-3.8-flash-high` | Gemini 3.8 Flash (High) |
| **Steamroller** | Gemini 3.8 Flash | High | `gemini-3.8-flash-high` | Gemini 3.8 Flash (High) |

### Non-Runner Specialist Roles (Preserved as Native Subagents)

Per contract §6.3, specialists remain native AGY subagents:
- **Jaguar**: Flash (native)
- **Puma**: Flash (native)
- **Bobcat**: Flash (native)
- **Strix Halo**: Pro (native)
- **Zen**: Pro (native)

## 3. Invocation Mechanics

The runner invokes AGY in non-interactive batch mode via synchronous child process execution:

```bash
agy --model <slug> --output-format json --print <prompt>
```

### Response Envelope Structure

AGY returns a JSON packet on `stdout`:

```json
{
  "conversation_id": "<uuid>",
  "status": "SUCCESS",
  "response": "<response text>",
  "duration_seconds": 1.359,
  "num_turns": 1,
  "usage": {
    "input_tokens": 5553,
    "output_tokens": 40,
    "thinking_tokens": 31,
    "cache_read_tokens": 8130,
    "total_tokens": 5593
  }
}
```

The runner extracts and packages this into structured results:
- **Success (`status === "SUCCESS"`)**:
  `{ ok: true, role, slug, response: parsed.response, duration: parsed.duration_seconds, usage: parsed.usage, raw: parsed }`
- **Model Error (`status === "ERROR"`)**:
  `{ ok: false, error: "MODEL_ERROR", role, slug, details: parsed }`

## 4. Open Question (OQ) Status

| ID | Specification Item | Status | Verification & Rationale |
|---|---|---|---|
| **OQ-1** | Exact AGY model slugs for Gemini 3.8 Flash and 3.1 Pro | **RESOLVED** | Verified directly against installed `agy models` surface. Slugs `gemini-3.8-flash-high` and `gemini-3.1-pro-high` confirmed live. |
| **OQ-2** | Whether Zen should use exact 3.1P/High or remain on native Pro | **UNRESOLVED / DEFERRED** | Deferred to 44F per contract §6.3 and §9. Zen remains native AGY subagent on native Pro baseline until comparative validation demonstrates material improvement. |
| **OQ-4** | Exact AGY CLI invocation path for Sonnet (Instinct backend) | **UNRESOLVED / DEFERRED** | Deferred to post-44G / issue #20 per contract §6.4 and §9. Model slug `claude-sonnet-4-6` is observed on the installed `agy models` list, but Instinct integration is an explicit non-goal in 44B. |

## 5. Runner Architecture & Safeguards

The runner is implemented in `scripts/runner.mjs` as an ESM module providing `ROLE_MODEL_TABLE`, `resolveSlug`, and `invoke`.

### 5.1 No Silent Fallback
Model slugs must be resolved explicitly from `ROLE_MODEL_TABLE`:
- `resolveSlug(role)` performs case-insensitive lookup.
- If a role is unknown or lacks a configured exact-model binding, it throws a structured `UnresolvedModelSlugError` (`{ ok: false, error: "UNRESOLVED_MODEL_SLUG", role }`).
- Falling back silently to a default model or lower-tier model is strictly prohibited.

### 5.2 Recursion Protection (`NTG_RUNNER_CHAIN`)
To prevent infinite subagent or child invocation loops:
1. `invoke` checks the environment variable `NTG_RUNNER_CHAIN` (a colon-separated list of active caller roles).
2. If `role` is already present in `NTG_RUNNER_CHAIN`, invocation is blocked immediately:
   `{ ok: false, error: "RECURSION_DETECTED", role, chain }`.
3. Otherwise, `invoke` appends the current role to `NTG_RUNNER_CHAIN` and propagates it to the spawned child process environment.

### 5.3 Timeout Protection
- Default timeout: `90000ms` (configurable via `opts.timeout`).
- If execution exceeds the allotted window, the process is terminated and returns:
  `{ ok: false, error: "TIMEOUT", role, slug, timeout }`.

### 5.4 Structured Failure Reporting
The runner captures all execution modes and returns clean, programmatic failure packets:
- `UNRESOLVED_MODEL_SLUG`: Role not in table.
- `RECURSION_DETECTED`: Role re-entered in call chain.
- `TIMEOUT`: Execution exceeded timeout.
- `SPAWN_ERROR`: Binary execution failure (e.g. ENOENT).
- `EXECUTION_FAILED`: Non-zero process exit code or unparseable JSON.
- `MODEL_ERROR`: Model returned structured error packet (`status === "ERROR"`).

### 5.5 Direct CLI Support
The runner can be invoked directly from the terminal:
```bash
node scripts/runner.mjs <role> <prompt>
```
Exits with code `0` on success and prints the response, or exits with code `1` and prints the error packet on failure.

## 6. Empirical Verification Receipts

### 6.1 Test Suite Results (`tests/test_runner_spike.mjs`)

```
=== Native Gravity 44B Exact-Model Runner Spike Tests ===
[PASS] Test 1: Slug resolution failure test (no silent fallback)
[PASS] Test 2: Recursion protection test (NTG_RUNNER_CHAIN detection)
[PASS] Test 3: Live Piledriver test (gemini-3.1-pro-high -> PILEDRIVER_SPIKE_PASS)
[PASS] Test 4: Live Bulldozer test (gemini-3.8-flash-high -> BULLDOZER_SPIKE_PASS)
=========================================================
Summary: 4 passed, 0 failed (Total: 4)
```

### 6.2 Live Invocation Receipts

#### Piledriver (`gemini-3.1-pro-high`)
- **Prompt:** `"Reply with exactly: PILEDRIVER_SPIKE_PASS"`
- **Response:** `"PILEDRIVER_SPIKE_PASS\n"`
- **Duration:** `4.19s`
- **Usage:** 5857 input tokens, 141 output tokens (134 thinking tokens), 8092 cache read tokens.

#### Bulldozer (`gemini-3.8-flash-high`)
- **Prompt:** `"Reply with exactly: BULLDOZER_SPIKE_PASS"`
- **Response:** `"BULLDOZER_SPIKE_PASS\n"`
- **Duration:** `1.36s`
- **Usage:** 5553 input tokens, 40 output tokens (31 thinking tokens), 8130 cache read tokens.

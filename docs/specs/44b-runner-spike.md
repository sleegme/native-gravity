# Native Gravity vNext 44B Exact-Model Runner Spike

## 1. Overview & Purpose

Implementation slice **44B** validates the minimal exact-model and reasoning-effort runner spike for Native Gravity vNext, as defined in `docs/specs/vnext-architecture-contract.md` (§6, §8, §9).

AGY native custom-subagent model selection (`inherit | flash | pro`) is too coarse for roles where exact model identity and reasoning effort materially affect behavior. The exact-model runner establishes a narrow, deterministic invocation layer that executes critical roles under their specified model and effort levels without introducing general orchestration weight.

## 2. Model Policies & Runtime Slug Resolution

Model slugs are dynamically resolved at runtime against the installed AGY surface (`agy models`) using declared role policies (`ROLE_POLICY_TABLE`):

| Role | Target Model Family | Effort | Exact AGY Model Slug | AGY Surface Description |
|---|---|---|---|---|
| **Piledriver** | Gemini 3.1 Pro | High | `gemini-3.1-pro-high` | Gemini 3.1 Pro (High) |
| **Bulldozer** | Gemini 3.8 Flash | High | `gemini-3.8-flash-high` | Gemini 3.8 Flash (High) |
| **Steamroller** | Gemini 3.8 Flash | High | `gemini-3.8-flash-high` | Gemini 3.8 Flash (High) |

### Runtime Resolution Mechanics
1. **Dynamic Discovery (`listInstalledModels`)**: Queries the local AGY binary (`agy models`) to discover currently available models and their descriptions.
2. **Policy Evaluation (`resolveSlug`, `matchesPolicy`)**: Evaluates role requirements against installed models using family and effort matching. Callers may pass `opts.installedModels` for cached or deterministic testing.
3. **No Silent Fallback**:
   - 0 matches: throws structured `UnresolvedModelSlugError` with reason `NOT_FOUND`.
   - Ambiguous multiple matches: throws structured `UnresolvedModelSlugError` with reason `AMBIGUOUS` and lists candidate matches.
   - Unknown role: throws structured `UnresolvedModelSlugError`.
4. **Environment-Based Executable Path**: Path defaults to `process.env.AGY_PATH || "agy"`. Hard-coded user directory paths have been removed.
5. **Role Model Table**: Hard-coded lookup in `ROLE_MODEL_TABLE` is removed in favor of runtime policy resolution.

### Non-Runner Specialist Roles (Preserved as Native Subagents)

Per contract §6.3, specialists remain native AGY subagents:
- **Jaguar**: Flash (native)
- **Puma**: Flash (native)
- **Bobcat**: Flash (native)
- **Strix Halo**: Pro (native)
- **Zen**: Pro (native)

## 3. Invocation Mechanics & Architecture Split

The runner architecture cleanly separates the low-level transport from the contract-level runner:

### 3.1 Low-Level Transport (`invokeTransport`)
Executes AGY directly in non-interactive batch mode via synchronous child process execution:

```bash
agy --model <slug> --output-format json --print <prompt>
```

`invokeTransport` accepts either `{ slug, prompt, ...opts }` or `(slug, prompt, opts)` and handles:
- Child process spawning and execution timeout (`timeout` option, default 90s).
- Recursion check and propagation (`NTG_RUNNER_CHAIN`).
- Strict JSON response envelope validation.

### 3.2 Response Envelope Validation (`parseResponseEnvelope`)

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

The runner strictly enforces response envelope integrity:
- **Success (`status === "SUCCESS"`)**:
  Validates `typeof response === "string"`. If missing or invalid, returns `{ ok: false, error: "INVALID_OUTPUT" }`. If valid, returns `{ ok: true, role, slug, response: parsed.response, duration: parsed.duration_seconds, usage: parsed.usage, raw: parsed }`.
- **Model Error (`status === "ERROR"`)**:
  Returns `{ ok: false, error: "MODEL_ERROR", role, slug, details: parsed }`.
- **Unparseable JSON or Non-Object Envelope**:
  Returns `{ ok: false, error: "INVALID_OUTPUT", role, slug, message, raw }`.
- **Unexpected Status (`PENDING`, `UNKNOWN`, etc.)**:
  Returns `{ ok: false, error: "INVALID_OUTPUT", role, slug, message, details: parsed }`. Must NEVER succeed.

### 3.3 Contract-Level Runner (`invoke`)
The contract runner `invoke(role, packet, opts)` enforces the agent boundary:
1. Validates the role and resolves the slug via `resolveSlug(role, opts)`.
2. Validates the handoff packet and constructs the bounded prompt via `composeBoundedPrompt(role, packet)`.
3. Executes invocation via `invokeTransport`.
4. Returns standardized structured result packets.

## 4. Bounded Prompt Construction & Packet Boundary

The runner (not caller) owns deterministic prompt construction from a structured handoff packet.

### 4.1 Composition Specification (`composeBoundedPrompt`)
- **Required Field**: Non-empty `task` (or `objective` alias).
- **Optional Context Sections**: `contextFiles` / `context_files`, `evidence`, `constraints`, `expectedOutput` / `expected_output`.
- **Prohibition of Raw Conversational State**:
  Passing `messages`, `conversation`, `history`, or `transcript` is strictly forbidden and immediately throws `InvalidHandoffPacketError`.
- **Deterministic Formatting**: Formats prompt sections predictably with markdown headers (`## Role`, `## Task`, `## Context Files`, `## Evidence`, `## Constraints`, `## Expected Output`).

### 4.2 CLI Invocation
Direct CLI execution wraps command-line arguments into a structured packet:
```bash
node scripts/runner.mjs <role> <prompt>
# Internally executes: invoke(role, { task: prompt })
```
Exits with code `0` on success and prints the response, or exits with code `1` and prints the structured error packet on failure.

## 5. Open Question (OQ) Status

| ID | Specification Item | Status | Verification & Rationale |
|---|---|---|---|
| **OQ-1** | Exact AGY model slugs for Gemini 3.8 Flash and 3.1 Pro | **RESOLVED** | Verified directly against installed `agy models` surface. Slugs `gemini-3.8-flash-high` and `gemini-3.1-pro-high` confirmed live. |
| **OQ-2** | Whether Zen should use exact 3.1P/High or remain on native Pro | **UNRESOLVED / DEFERRED** | Deferred to 44F per contract §6.3 and §9. Zen remains native AGY subagent on native Pro baseline until comparative validation demonstrates material improvement. |
| **OQ-4** | Exact AGY CLI invocation path for Sonnet (Instinct backend) | **UNRESOLVED / DEFERRED** | Deferred to post-44G / issue #20 per contract §6.4 and §9. Model slug `claude-sonnet-4-6` is observed on the installed `agy models` list, but Instinct integration is an explicit non-goal in 44B. |

## 6. Runner Architecture Safeguards Summary

- `UNRESOLVED_MODEL_SLUG`: Role unknown, 0 matching models on installed surface, or ambiguous multiple matches.
- `INVALID_HANDOFF_PACKET`: Malformed handoff packet or prohibited conversational state (`messages`, `conversation`, `history`, `transcript`).
- `INVALID_OUTPUT`: Unparseable JSON, non-object JSON envelope, missing response field, or unexpected status.
- `RECURSION_DETECTED`: Role re-entered in call chain via `NTG_RUNNER_CHAIN`.
- `TIMEOUT`: Execution exceeded timeout.
- `SPAWN_ERROR`: Binary execution failure (e.g. ENOENT).
- `EXECUTION_FAILED`: Non-zero process exit code.
- `MODEL_ERROR`: Model returned structured error packet (`status === "ERROR"`).

## 7. Empirical Verification Receipts

### 7.1 Test Suite Results (`tests/test_runner_spike.mjs`)

```
=== Native Gravity 44B Exact-Model Runner Spike Tests ===
[PASS] 1.1: Unknown role throws UnresolvedModelSlugError (no silent fallback)
[PASS] 1.2: Absent surface error (0 matches) throws UnresolvedModelSlugError without silent fallback
[PASS] 1.3: Ambiguous surface error (multiple matches) throws UnresolvedModelSlugError with candidate details
[PASS] 1.4: Deterministic resolution against cached installed models for all roles
[PASS] 1.5: parseInstalledModels correctly parses agy models stdout table
[PASS] 1.6: Live installed surface resolution against system agy models
[PASS] 2.1: Unparseable JSON response returns INVALID_OUTPUT failure
[PASS] 2.2: Non-object JSON response returns INVALID_OUTPUT failure
[PASS] 2.3: status === 'ERROR' returns MODEL_ERROR failure
[PASS] 2.4: status === 'SUCCESS' with missing or invalid response returns INVALID_OUTPUT
[PASS] 2.5: Unexpected or unknown status returns INVALID_OUTPUT (never success)
[PASS] 2.6: status === 'SUCCESS' with valid string response succeeds
[PASS] 2.7: invokeTransport enforces response envelope validation on process execution
[PASS] 3.1: Deterministic prompt construction with minimal packet
[PASS] 3.2: Deterministic prompt construction with complete structured packet
[PASS] 3.3: Task alias 'objective' is accepted when 'task' is omitted
[PASS] 3.4: Rejection of invalid handoff packets (throws InvalidHandoffPacketError)
[PASS] 3.5: Strict prohibition of raw conversational state in handoff packet
[PASS] 3.6: Contract-level invoke returns structured error for invalid packet
[PASS] 4.1: Single-role chain detection blocks invocation (RECURSION_DETECTED)
[PASS] 4.2: Multi-role chain detection blocks re-entrant role (RECURSION_DETECTED)
[PASS] 5.1: Live Piledriver bounded invocation (gemini-3.1-pro-high)
[PASS] 5.2: Live Bulldozer bounded invocation (gemini-3.8-flash-high)
=========================================================
Summary: 23 passed, 0 failed (Total: 23)
```

### 7.2 Live Invocation Receipts

#### Piledriver (`gemini-3.1-pro-high`)
- **Packet:** `{ task: "Reply with exactly: PILEDRIVER_SPIKE_PASS" }`
- **Composed Prompt:**
  ```markdown
  ## Role
  piledriver

  ## Task
  Reply with exactly: PILEDRIVER_SPIKE_PASS
  ```
- **Response:** `"PILEDRIVER_SPIKE_PASS\n"`
- **Duration:** `4.19s`
- **Usage:** 5857 input tokens, 141 output tokens (134 thinking tokens), 8092 cache read tokens.

#### Bulldozer (`gemini-3.8-flash-high`)
- **Packet:** `{ task: "Reply with exactly: BULLDOZER_SPIKE_PASS" }`
- **Composed Prompt:**
  ```markdown
  ## Role
  bulldozer

  ## Task
  Reply with exactly: BULLDOZER_SPIKE_PASS
  ```
- **Response:** `"BULLDOZER_SPIKE_PASS\n"`
- **Duration:** `1.36s`
- **Usage:** 5553 input tokens, 40 output tokens (31 thinking tokens), 8130 cache read tokens.


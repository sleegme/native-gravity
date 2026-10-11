# Gate review: PR #129, feat/114-piledriver-visibility (Refs #114)

- recommendation: **APPROVE (PASS)**
- reviewed head: `4a61955` (worktree `/home/sleeg/work/native-gravity-114`), diff vs `origin/main` at `115b526`
- blockers: none

## originalIntent
The PO chose option B for #114. Piledriver's replan context should say which artifact or lane failed and include the failed step's tool name plus its args or command line, with redaction rules applied. Prompt text, role text and contract fragments are tier C and must never be included.

## desiredOutcome
`requestPlan` should send Piledriver a bounded tier-B projection instead of the raw ledger. The projection should carry the failed lane id, the failure class and the failed step's tool and args. Secrets and paths should be redacted, tier-C material should be excluded by construction, Piledriver should stay advisory, and both the docs and the tests should prove the negative case.

## userOutcomeReview
The PR delivers this. `requestPlan` now sends `{ task, replan_context }` (spine.mjs `buildReplanContext`) where it used to send `{ task, ledger: this.state }`. `failed_step` is populated for the three failure paths (`runner.invoke`, `invoke_subagent`, `zen_review`), and every one of them is built only from fixed identifiers. The agy command is rebuilt with `--print (prompt withheld)`, and specialist slices contribute only `slice_keys`. Candidate packets and Zen `details` are dropped structurally. Free-text error blobs never enter the projection, because `projectFailureRecord` whitelists its fields.

## Criteria check

| # | Criterion | Result | Evidence |
|---|---|---|---|
| a | Boundary: lane id + tool args/command present; prompt, role and contract text absent | PASS | `scripts/telemetry.mjs` `projectFailureRecord` whitelist (milestone_id, status, timestamp, failed_step, transcript_ref, escalation_needs). `buildReplanContext` builds `verification_summary` from 6 named fields. `#transportCommand` withholds `--print`. `args.error` is only a runner enum code (runner.mjs:375-745: `EXECUTION_FAILED`, `INVALID_RESPONSE_FORMAT`, ...). |
| b | Redaction scrubs secrets, env names and paths | PASS against the documented list (see N1 for gaps) | Probe `/tmp/probe114.mjs`: `--token=sk-x` -> `--token=<redacted>`; `API_KEY=y` -> `API_KEY=<redacted>`; `/home/sleeg/x` -> `(local path)`; `OPENAI_API_KEY="a b c"`, `--api-key=abc123` and `sk-ant-api03-...` are all redacted. |
| c | Piledriver stays advisory, with no new execution paths | PASS | `#step` only annotates a thrown error with `failedStep` and rethrows it. `invokeSpecialist` control flow is the same, just re-indented inside the thunk. `requestPlan` still returns advice and has no adoption or mutation path. |
| d | Docs updated (contract spec + role docs) | PASS | Contract §4.3 (tier table, projection shape, tier-C list, redaction list), the §2 Piledriver bullet, the ledger evidence comment, `docs/specs/vnext/agents/piledriver.md` (input and must-not paragraphs), and `docs/specs/vnext/docs/architecture.md`. |
| e | Tests assert the negative case | PASS | `tests/test_telemetry.mjs`: `SUPERSECRET_CANARY` delegated prompt absent; `CANARY_CONTRACT_FRAGMENT` / `prompt_echo` absent (non-vacuous, because ledger.mjs:1206/1298 stores the verdict in `details`); `changes_made` / `verification_evidence` absent; `'ledger' in contract === false`; raw ghp token absent both on disk and in the packet. |
| f | No scope creep | PASS | 7 files, all on the #114 path. No runtime entry or default activation changes. |

## Tests run (this session)
- `node --test tests/test_telemetry.mjs`: 7/7 pass
- `node --test tests/test_spine.mjs`: 96/96 pass
- `node --test tests/test_ledger.mjs`: 1/1 pass. This file is a single script; the PR's "39/39" figure is its internal check count, which I did not count separately.
- Combined run: 104 pass, 0 fail
- PR CI: guards (3.9/3.11/3.13) and npm-package are SUCCESS

## Notes (non-blocking)
- **N1, redaction gaps.** Hostile probes that pass through **unredacted**:
  - Space-separated secret flags: `--token sk-x`, `--password hunter2`
  - `password: hunter2`
  - Short bearer values: `Authorization: Bearer abc` (the pattern needs 16+ characters)
  - URL credentials: `https://user:pass@host/x`
  - Absolute paths outside user homes: `/root/.ssh/id_rsa`, `~/x`, `C:\Users\...`

  These do not block, because the spec documents the list as a floor covering only `/home|/Users` paths, and no current `failed_step` path carries user-supplied CLI args. The real exposure today is the free-text fields (`escalation_needs`, blocker `description`, `repair_needs`, `goal`). **Before any real tool args are recorded**, add redaction for `--<secret-name> <value>` and URL userinfo, and decide on `/root` and `~`.
- **N2.** The `KEY` substring over-redacts (`MONKEY=banana` -> `<redacted>`). This is harmless.
- **N3.** Blocker `description` is redacted only in the projection, not at the ledger boundary (only `escalation_path` is). The ledger therefore keeps raw paths and secrets from blocker descriptions. The spec only claims ledger-boundary redaction for failure records, so this does not contradict the doc, but it is inconsistent.
- **N4.** `MAX_RELEVANT_FAILURES = 5` truncation is not mentioned in contract §4.3.
- **N5.** The INVOCATION_FAILURE test does not plant a canary for the Bulldozer instruction or contract text, and no test plants a role-body canary. The structural whitelist makes this low-risk; the specialist and Zen canaries cover the negative case.
- **N6.** Only the vNext role doc was updated. Root `agents/piledriver.md` (the shipped runtime role) and the vNext `steamroller.md` are unchanged. That is acceptable because the spine is the isolated vNext coordinator; contract §4.3 covers what Steamroller has to do.
- **Slop pass.** `isSecretEnvName` is exported mainly for tests (minor). There are no tautological or deletion-only tests. The first test is a dense unit table but checks real behavior.

## Checked artifacts
`scripts/telemetry.mjs`, `scripts/spine.mjs`, `scripts/ledger.mjs`, `scripts/runner.mjs` (error codes), `tests/test_telemetry.mjs`, `docs/specs/vnext-architecture-contract.md`, `docs/specs/vnext/agents/piledriver.md`, `docs/specs/vnext/docs/architecture.md`, issue #114, PR #129 body and checks.

## Evidence gaps
- No code-review report or QA matrix was provided, so this review is direct inspection only.
- The Python guard suite was not re-run locally; CI is green.

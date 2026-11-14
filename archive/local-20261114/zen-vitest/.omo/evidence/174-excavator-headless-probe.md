# PR #174: one bounded live probe of the TEMPORARY headless Excavator path

Observed 2026-10-25 on AGY 1.4.7 (host catalog exposes `gemini-4-argon-high`).
Worktree head under test: `feat/excavator-agy-headless` at the commit opening
this PR. One Argon call was spent, owner-authorized; no other live model call
was made for this PR.

## Verdict

| Check | Observed result | Verdict |
| --- | --- | --- |
| Script exit | `0`, stderr empty | PASS |
| Resolved model | `slug: "gemini-4-argon-high"` in the script result (policy-table resolution against `agy models`) | PASS |
| Real repair in workspace | `counter.mjs` line 3 changed from `return a - b;` to `return a + b;` — the single smallest edit | PASS |
| Acceptance criterion | `node check.mjs` exited `1` before (baseline `FAIL: add(2,3) returned -1, expected 5`), exited `0` after (`PASS: add(2,3) === 5`) | PASS |
| Worker result shape | `STATUS: "READY"`, `ROOT_CAUSE: "CONFIRMED: OBSERVED ..."` with pre/post OBSERVED evidence, `CHANGES`, `ROLLBACK`, `RESIDUAL_RISK` | PASS |
| Telemetry visibility | one JSONL record appended to `<workspace>/.ntg/excavator-agy-calls.jsonl` with start/end/model/exit/status/usage | PASS |
| Guardrail | fixture edit only; `check.mjs` sha256 unchanged (`b721cb45...e36`), no new files | PASS |

## Setup

Tiny synthetic repair under `/tmp/ntg-excavator-headless-probe/` (paths
outside the repo; no repository or home state touched):

- `counter.mjs`: `add(a, b)` returned `a - b` (injected bug).
- `check.mjs`: asserts `add(2, 3) === 5`; baseline run exited `1`.
- `packet.json`: milestone `probe-counter-fix`, objective "diagnose and
  repair counter.mjs", bounded scope `counter.mjs`, acceptance "node
  check.mjs exits 0", constraints "do not modify check.mjs",
  "single smallest edit".

Exact command (worktree prefix redacted to `<WORKTREE>`):

```sh
cd /tmp/ntg-excavator-headless-probe \
  && node <WORKTREE>/scripts/excavator-agy.mjs \
     --packet packet.json \
     --blocker 'node check.mjs exits 1: add(2,3) returned -1, expected 5' \
     --timeout 480 --cwd /tmp/ntg-excavator-headless-probe
```

The script resolved `gemini-4-argon-high` from the frozen policy table,
loaded the shipped `agents/excavator.md` body (frontmatter stripped), and ran
agy with `--output-format stream-json --print-timeout 450s
--dangerously-skip-permissions -p <prompt>` (outer spawn timeout 480 s).

## Observed outcome

- Duration **73.014 s** (`started_at` 2026-10-25T08:56:12.250Z, `ended_at`
  08:57:25.265Z), script `exit_status: 0`.
- Provider usage from the stream-json result event: input 23,600; output
  2,679; thinking 1,657; cache-read 41,707; total 26,279 tokens.
- Repaired `counter.mjs` sha256 as reported by the worker:
  `57455f7b33131ad1b0f5c7bbdd5b21f34ea03cb2d01dbb2544100b6f5512d463`.
- Worker returned `READY` with `ROOT_CAUSE CONFIRMED` (reproduction and
  mechanism both observed), `ROLLBACK` (restore line 3), and an honest
  `RESIDUAL_RISK` (UNKNOWN for non-numeric operands outside the probe).

Artifacts beside this receipt:

- `174-excavator-headless-probe-stdout.json`: exact script stdout (verbatim;
  contains only `/tmp` paths).
- `174-excavator-headless-probe-call-log.jsonl`: the exact telemetry record
  appended to `.ntg/excavator-agy-calls.jsonl` (verbatim).

## Limits

- One call, one trivial fixture: it proves the transport (exact Argon slug,
  stream-json parsing, workspace mutation, worker-result shape, telemetry),
  not the difficulty of a real hard repair.
- `check.mjs`'s hash and the no-new-files claim are the worker's own report;
  the fixture after-state and `PASS` line were observed directly in the probe
  shell output and are quoted above.
- No 429/quota, timeout or unparseable-output condition occurred live; those
  paths are covered by stubbed tests only.

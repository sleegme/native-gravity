# 44E durable provenance re-run

## Outcome

PR #51 now points to `3d7681ce61a3d23e076a97d717c0c0c5e4337e6b`, identical to the new local HEAD on `feat/issue-44e-minimal-spine`. The replacement is one seven-file commit over `95b64ad21189579a6e560fae1f7a0d62d30fe9b3`, with message `feat(44E): minimal spine integration (#44E)`.

Cleanroom:

`/home/sleeg/work/ntg-vnext/.omo/evidence/ulw/01a0949f-7dc8-7494-b4b1-f137cebd5e3a/G001-root-work-ntg-vnext-parent-dir-is-no/a1/cleanroom-44e/`

All seven files were authored into this directory before copying them into the 44E worktree. `receipts/authored-sha256.txt` records their pre-copy SHA-256 values. Copy-time and pre-commit checks matched all seven. This report documents a new authoring run; it does not claim to recover the lost original transcripts.

## Sources and approach

Governing sources:

- `docs/specs/pre-vnext-v0.4-behavior-baseline.md`: frozen issue #32 behavior, role/effect boundaries, evidence discipline, and guard obligations.
- `docs/specs/vnext-architecture-contract.md`: frozen #44A topology, candidate/verdict binding, explicit completion authority, independent Zen gate, and non-activation boundary.
- The seven verified-clean files at `d7e35e4b2396916ed3a3832c2680a71bb178b030`: explicitly authorized semantic reference for this re-run. Runtime control flow, machine-consumed metadata, and existing regression cases were deliberately retained rather than changed for cosmetic novelty.
- Installed official `agy plugin validate .`: accepted all nine agents and both hooks, including the authored frontmatter fields `name`, `description`, `tools`, `mainAgent`, `subagent`, `model`, and `commandExecutionPolicy`. No undocumented frontmatter field was introduced.

Compatibility inspection covered the merged 44B runner and 44C ledger interfaces, their tests, distribution metadata, CI commands, and scoped commit history/blame. Repository-wide search located consumers and the still-unactivated v0.4 surfaces; those legacy role/rule implementations were not drafting sources. No abandoned rewrite branch, PR #41 implementation, external OMO/GJC/OMP text, or baseline implementation was used for authoring.

Two approaches were considered: redesign the coordinator/guard while rebuilding evidence, or re-author the bounded artifacts with the authorized reference semantics unchanged. The latter won because this is a provenance re-run, not a request for new behavior. Agent prose was independently restated; runtime checks were manually authored with the same control flow; test cases preserve the original behavioral coverage. `hooks.json` is byte-identical to the authorized reference because the same two registrations are required. A source comparison records that explicitly rather than manufacturing a config change.

## Per-file decisions

| File | Design decision and retained obligation |
| --- | --- |
| `agents/bobcat.md` | Explicit native Flash worker identity and bounded implementation authority. Only Strix Halo delegation; REQUIRED cannot become NONE because an advisor is unavailable. READY and ACCEPT stay local. Bobcat cannot invoke Zen or provide a route around independent review. Bulldozer must issue its own candidate status; Steamroller observes matching current GO before promotion. |
| `agents/zen.md` | Explicit `name: zen`, descriptive identity, native Pro, `mainAgent: false`, `subagent: true`, sandbox policy, and read-only tool set. Independent review, mandatory marker, no mutation or delegation. Echo milestone/version/result binding directly to Steamroller; stale verdicts and worker confidence never authorize promotion. Keep the v0.4 versus isolated-vNext distinction. |
| `hooks/zen-shell-guard.py` | Retain the narrow marked read-only grammar, strict prefix, shlex command segmentation, effectful-option exclusions, and rejection of wrappers, redirection, expansion, inline programs, and arbitrary project execution. Unmarked calls remain outside this role guard. Malformed shell payloads deny; policy denials exit zero with JSON. Host executable resolution remains outside this guard's guarantees. |
| `hooks.json` | Author the Zen and preserved Excavator `PreToolUse` registrations for `^run_command$`, each invoking its actual Python guard with a positive ten-second timeout. Do not replace Excavator machinery or activate vNext. Identical machine-consumed registration is intentional. |
| `scripts/spine.mjs` | Preserve the exported `MinimalSpine` API and existing runner/ledger adapters. Steamroller alone owns state. Planning remains advisory; native Bobcat stays inside Bulldozer. Only explicit DONE enters independent Zen review, never READY or missing status. Persist immutable candidate references before review, reject forged/stale/mismatched authority and non-observed evidence, and retain NO-GO, failure, concurrency, replan, recovery, and completion checks. Changes relative to the semantic reference are comments only. |
| `tests/test_spine.mjs` | Preserve 27 behavioral cases with the real runner envelope and authoritative ledger. The host double writes real bounded artifacts; independent review reads and hashes them. Exercise READY/missing status rejection, forged authority, current candidate binding, NO-GO repair, fresh resume, stale review, interrupted invocation, and hard pending-review gates. Async review uses pre-subscribed promises and a bounded test timeout, not sleeps or polling. No prompt prose is pinned. |
| `tests/test_zen_shell_guard.py` | Preserve seven process-level tests and all mutation/bypass cases. Feed the actual AGY payload to the real subprocess, execute the actual registered hook command, and inspect parsed Zen metadata for identity and non-mutating capabilities. Assert decisions and machine-consumed values, not prose. |

## Verification

The required chained command ran once and exited zero:

```sh
node tests/test_spine.mjs && python3 tests/test_zen_shell_guard.py && node tests/test_runner_spike.mjs && node tests/test_ledger.mjs
```

| Suite/check | Observed result |
| --- | --- |
| Spine | 27 passed, 0 failed |
| Zen guard | 7 passed, 0 failed |
| Runner spike | 24 passed, 0 failed; includes installed model resolution and live Piledriver/Bulldozer bounded invocations |
| Ledger | 37 passed, 0 failed |
| Official AGY plugin validation | Exit 0; 9 agents and 2 hooks processed |
| Synthetic marked read-only hook payload | `allow`, exit 0 |
| Synthetic marked mutation hook payload | `deny`, exit 0; mutation was payload text, not executed |
| Node syntax, Python AST syntax, hooks JSON parse | Passed |
| CI installer syntax and `npm pack --dry-run` | Passed; no project build script exists |
| Exact seven-file staged scope, whitespace, authored hashes | Passed |
| Push and PR identity | Explicit force-with-lease push succeeded; PR #51 `headRefOid` equals HEAD |

Node was `v26.7.0`; Python was `3.14.7`. Test temporary files were redirected to the durable cleanroom's `receipts/runtime` using TMPDIR; Python bytecode writes were disabled. npm cache was directed into `receipts/npm-cache`.

LSP checks were requested for all seven files but unavailable: no Markdown server configured, and TypeScript, Biome, and Basedpyright servers not installed. `receipts/diagnostics.txt` records this limitation; syntax checks and official AGY validation passed instead. No claim of clean LSP/type diagnostics is made. The integration test's native-host callbacks and the live-hook payloads are synthetic; this run does not claim a full live Steamroller -> native Bobcat -> independent native Zen migration validation. That remains outside this provenance re-run and does not authorize 44G activation.

## Git and scope handling

The supplied location is actually a Git worktree: its common Git directory is `/home/sleeg/work/native-gravity/.git`, as recorded in `receipts/source-receipts.txt`. The task's "independent clone" description was therefore not used as an operational assumption. Only the named 44E branch was reset, committed, and pushed; normal Git metadata changes are inherent in those explicitly authorized operations. No parallel worktree was edited.

`git reset --soft d7e35e4b2396916ed3a3832c2680a71bb178b030^` rebuilt the single commit without restoring legacy worktree files or touching unscoped project paths. The original remote-tracking branch was checked against `d7e35e4b2396916ed3a3832c2680a71bb178b030` before commit. The exact push was:

```sh
git push --force-with-lease origin feat/issue-44e-minimal-spine
```

Its full output and the subsequent PR head equality assertion are preserved. No PR was merged, main was not pushed, and vNext was not activated. No unscoped tracked project file was modified; the committed worktree was clean.

## Receipt index

Required durable evidence:

- `receipts/authored-sha256.txt`: all seven authored files, hashed before copying.
- `receipts/git-receipts.txt`: exact reset/copy/add/commit commands, outputs, exit status, scope and hash checks, new HEAD, clean worktree.
- `receipts/push-receipt.txt`: exact visible force-with-lease command, full output, PR head JSON, equality assertion.
- `receipts/test-receipts.txt`: complete output of the four required suites.
- `receipts/live-hook.txt`: exact synthetic allow/deny pipelines, JSON results, assertions.
- `receipts/plugin-validate.txt`: official AGY validator output.
- `REPORT.md`: this provenance and per-file decision record.

Supporting evidence:

- `receipts/source-receipts.txt`: reference commit, spec hashes, worktree metadata, authored-file comparison.
- `receipts/build-receipts.txt`: syntax and package dry-run output.
- `receipts/diagnostics.txt`: unavailable LSP checks and fallback validation scope.
- `receipts/live-allow.json`, `receipts/live-deny.json`, `receipts/pr-head.json`: machine-readable observed outputs.
- `receipts/reset-copy.sh`, `receipts/validate.sh`, `receipts/commit.sh`: exact executed orchestration scripts.

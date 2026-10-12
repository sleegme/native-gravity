# Issue #138: vNext-only verification

Status: implementation checks and four required runner live scenarios passed;
independent gate and merge approval pending.

## Scope and decisions

- Remove the approved pre-vNext structure and its exclusive tests.
- Keep the runner, ledger, independent Zen milestone gate, specialists and
  native Excavator with its completion and shell guards.
- Version: `1.0.0`; maturity: alpha; validated host runtime: AGY `1.3.3`.
- English and Korean README describe the runner topology and native Excavator.
- OQ-6 / #137 remains open; Excavator inheritance is not decided here.

## Implementation worker

Command Code session: `9b9d0deb-31e2-458c-9f5b-bf10431ff3ee`.
Observed model: `xiaomi/mimo-v2.6-pro`.
The implementation run ended with `subtype: max_turns`, exit code `8`,
after 80 turns. This is a partial execution, not a success verdict.
The same session was resumed for live verification only. The lead owns
subsequent file edits, evidence, commits and PR creation.

## Initial worker test observations

All commands ran from the issue worktree. Temporary test files used
`TMPDIR=$HOME/.cache/ntg138-tmp`.

| Command | Reported result |
| --- | --- |
| `python3 -m unittest discover -s tests` | 74 tests, OK |
| `node tests/test_dag_view.mjs` | 10 tests, 9 pass, 0 fail, 1 skipped |
| `node tests/test_ledger.mjs` | 39 pass, 0 fail |
| `node tests/test_ntg_vnext.mjs` | 10 pass, 0 fail |
| `node tests/test_runner_spike.mjs` | 46 pass, 0 fail, including live Piledriver and Bulldozer invocations |
| `node tests/test_spine.mjs` | 96 pass, 0 fail |
| `node tests/test_studio_runner.mjs` | 10 pass, 0 fail |
| `node tests/test_telemetry.mjs` | 7 pass, 0 fail |

These summaries total 291 passing tests and one skipped test. The worker
also reran Python suites individually; those repeat runs are not added to
the total. Several commands filtered output through shell pipelines
without `pipefail`. The summaries are observed, but they are not a
fail-fast final-tree run. The lead subsequently ran the fail-fast check below.

Other initial observations:

- JSON parsing and JavaScript syntax checks completed.
- `agy plugin validate .` reported three processed hooks.
- `node scripts/npm-install.mjs --version` printed `1.0.0`.
- `npm pack --dry-run` initially included three generated Python bytecode
  files; the worker removed them and a second dry-run reported 29 files.
  The final-tree dry-run also reported 29 files and no Python bytecode.
- The lead's `git diff --check` returned no whitespace diagnostics.

## Final-tree checks

The lead ran the following command with `bash -o pipefail`, `set -e`, and
`TMPDIR=$HOME/.cache/ntg138-tmp`, `PYTHONDONTWRITEBYTECODE=1`,
`SKIP_LIVE_TESTS=1`:

```bash
python3 -m unittest discover -s tests -v
for f in tests/*.mjs; do node "$f"; done
agy plugin validate .
npm pack --dry-run
node scripts/npm-install.mjs --version
git diff --check
```

Commands ran sequentially and the monitor reported exit code 0. Evidence:
[`138-final-suite.log`](138-final-suite.log). Python: 74 passing tests.
JavaScript: 215 passing checks, one pre-existing DAG-view skip; runner
spike separately skipped its two paid live calls, which the worker had
already observed passing. Combined final deterministic run: 289 pass,
0 fail, one pre-existing skip plus two explicit live-call skips.
Plugin validation: nine agents, three hooks. Installer: `1.0.0`.
Package: 29 files, no removed primary gate or `ntg-run` entry.

The lead packed the actual npm tarball, extracted it into a fresh cache
directory, invoked the package installer for `1.0.0`, and invoked
`ntg-vnext` through an executable symlink. Supported `init` and `status`
commands both returned the expected v1 ledger and next milestone m1.
The initial `--help` probe returned usage with exit 1 because that flag is
not supported; no source change was made for it. Supported-command QA and
recursive main-install comparisons completed successfully. Evidence:
[`138-package-qa.log`](138-package-qa.log).

Only evidence and a correction to English/Korean historical validation
prose changed after these tests; executable code and role contracts did not.
Python LSP diagnostics could not run because `basedpyright-langserver`
is not installed. No dependency or global configuration was changed.

## Live verification and QA matrix

Harness: existing `.omo/evidence/134-live-probe/probe.mjs`, copied into
worker scratch space with only checkout/artifact roots changed.
Environment: `NTG134_WORK_DIR=$HOME/.cache/ntg138-live`,
`TMPDIR=$HOME/.cache/ntg138-tmp`. Actual argv, output, sessions and timings:
[`138-live-results.jsonl`](138-live-results.jsonl). Personal paths are
redacted; candidate references and UUIDs are preserved, not recomputed.

| Scenario | Action | Observed result | Artifact |
| --- | --- | --- | --- |
| Dependency-order GO | `node <scratchpad>/probe138.mjs p1` | P1b verifies m1; P1f then verifies dependent m2 and completes v1 | records P1b, P1f |
| Interrupted fresh-context resume | same p1 phase | P1c SIGKILL; P1d expected lock refusal (exit 1); P1e recovers stale owner and terminates executor; P1f fresh process completes m2 (exit 0) | records P1c-P1f |
| Replan requires fresh GO | `node <scratchpad>/probe138.mjs p2` | advisory Piledriver plan; v2 clears completion and stales v1 verdicts; retained m1 receives fresh v2 GO with a new reference (exit 0) | records P2a-P2c |
| NO-GO cannot complete | `node <scratchpad>/probe138.mjs p3` | tampered artifact receives NO-GO, exit 2, no completed milestone | record P3b |
| Repair requires a new GO | same p3 phase | new candidate reference receives GO, exit 0; final file is exactly `alpha\n` | records P3c-P3d |
| Native Excavator and guards preserved | inspect unchanged Excavator files and run Python tests | Excavator remains native; review gate, shell guard and Zen guard tests pass | final-suite log and `agents/excavator.md` |
| Main installation restored after branch probes | supported uninstall/install and recursive comparison | main checkout clean at `0bbea4a`; installed agents/hooks/rules/hooks.json match main | package-QA log, success sentinel |
| Packaged symlink CLI | pack, extract, symlink; installer version; init and status | version 1.0.0, initialized v1 state, next milestone m1 | package-QA log, success sentinel |

The four runner scenarios cover 13 recorded steps and 18 AGY sessions.
All three harness phase commands exited 0; their expected negative steps
are explicitly recorded above. The lead inspected raw records and current
ledgers rather than accepting the worker's success summary.

Representative sessions:

- m1: `17a00ba6-c2cf-4ca2-b53a-f630ff396066`,
  `35fcd42b-1f3b-4558-a13c-ce62a6ddcba3`,
  `4b0c463d-672b-446b-8468-751ed1560dc9`.
- resumed m2: `261b293f-4342-4d22-a27f-61623c42d656`,
  `9619f491-ec62-4b19-ba59-5af207726bd4`,
  `f90f66cc-a80d-4ecb-9633-a2465cec574b`.
- fresh v2: `1302a9f9-6cf0-42c0-8f60-87714e3f81cc`,
  `6297dfd1-e1f0-4518-91ec-acf40e29cfb1`,
  `ac96a787-27a6-4dad-b2be-86df4b4f5893`.
- NO-GO: `2de51f53-ee7d-4854-9448-f65580f703d8`,
  `9bf4f5b0-5b34-4bb1-ac69-37932ef769cb`,
  `f9de2123-0cd5-45c8-a0cd-613975a22985`.
- repaired GO: `6913f175-a04c-47ca-a469-84f0c34d6fc4`,
  `b22df322-a0ab-4895-9844-fdf240bc98af`,
  `c4a76c76-2a96-4614-99fb-791904a53173`.

Residual prior gap: Excavator's full live NO-GO repair loop and post-GO-write
re-review are not revalidated here. Excavator contracts/hooks are unchanged;
their deterministic tests pass. The current runner NO-GO/repair scenario
must not be reported as live Excavator proof.

## Final gate and installation

Pending: independent gate approval, PR merge, clean merged-main installation
comparison and issue closure.
No completion or approval is claimed by this document.

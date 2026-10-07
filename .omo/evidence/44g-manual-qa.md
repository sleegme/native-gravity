# Manual QA — 44G role-contract conflict fix (finish & ship)

Executor: omo-native-qa-executor (senpi-task st_01a101fc)
Date: 2026-10-03
Note: no ulw-loop plan exists in this session (agentToolkit.status().result.currentAttemptDir = null),
so artifacts live in the caller's evidence directory: /home/sleeg/work/native-gravity/.omo/evidence/.

## surfaceEvidence

| scenario | criterion | surface | exact invocation | verdict | artifactRefs |
|---|---|---|---|---|---|
| ship-branch-commit | branch with commits on the fix | git CLI | `git checkout -b fix/44g-role-contract-conflict` (already existed at main HEAD); `git add` the 6 files; `git commit -m "fix(runner): align vNext role contracts + strict response-packet unwrap (Refs #44)"` | PASS — 0f2b116 contains exactly the 6 files; `git status` shows remaining dirt is unrelated untracked evidence only | art-log, art-diffstat |
| live-compare | bounded live before/after strict-parser re-check, ~8 agy calls, unchanged complex packets, gemini-3.8-flash-high + claude-sonnet-5-5-high | agy headless via harness | `node .omo/evidence/2026-10-03-44g-role-contract-live.mjs` (cwd repo root; 8 calls, packet asserted byte-identical to historical complex packet) | PASS — 8/8 calls executed; before 1/4 strict-pass, after 3/4 (3/3 excluding symmetric print-timeout); table recorded in findings Verification section | art-transcript, art-findings |
| runner-tests | parser regression suite | node CLI | `node tests/test_runner_spike.mjs` | PASS — 41/41 | art-test-runner |
| spine-tests | state-machine gate strictness | node CLI | `node --test tests/test_spine.mjs` | PASS — 41/41 | art-test-spine |
| push-pr | remote branch + PR with `Refs #44`, never `Closes` | git + gh CLI | `git push -u origin fix/44g-role-contract-conflict`; `gh pr create --body "Refs #44 ..."`; verified `gh pr view 81 --json body` (hasCloses: false) | PASS — PR https://github.com/sleegme/native-gravity/pull/81 OPEN, head fix/44g-role-contract-conflict -> main | art-pr |
| findings-commit | findings file committed as part of the diff | git CLI | `git add .omo/evidence/2026-10-03-44g-role-contract-{findings.md,live.mjs,transcript.json}`; `git commit -m "docs(44g): bounded live role-contract re-check + transcript (Refs #44)"` | PASS — ca467f1 | art-log |

## adversarialCases

| scenario | criterion | adversarial class | expected behavior | verdict | artifactRefs |
|---|---|---|---|---|---|
| adv-hard-holds | no vNext activation / no AGENTS.md rewrite / no agy permission or allowlist changes / gate stays strict | scope-boundary violation | diff touches only the 6 files + 3 evidence files; live agents/, AGENTS.md, settings untouched; spine gate still rejects without independent Zen GO | PASS — `git show --stat 0f2b116 ca467f1` lists only those paths; test_spine 6 new guards assert strictness | art-diffstat, art-test-spine |
| adv-unrelated-dirty | unrelated dirty files must not be committed | contamination | .omo/evidence/pr-53-gate-review.md, 44g-role-contract-code-review.md, framing/model-ab files remain untracked | PASS — post-commit `git status --porcelain` shows them as `??` still | art-log |
| adv-partial-timeout | agy print-timeout mid-run | flaky transport | timeout counted as not-completed in BOTH arms (symmetric), not silently treated as pass or dropped | PASS — gemini/piledriver timed out at 90s in both arms; both recorded partial:true, EMPTY_RESPONSE, excluded from pass-rate honestly in findings | art-transcript, art-findings |
| adv-fail-closed-parser | multi-object / narration-wrapped payloads | parser robustness | strict unwrap rejects ambiguous payloads, extracts only a single well-formed object | PASS — before:claude:bulldozer -> INVALID_RESPONSE_FORMAT (competing fragments); before:claude:piledriver -> extracted single object | art-transcript |

## artifactRefs

| id | kind | description | path |
|---|---|---|---|
| art-log | cli-transcript | git status/diff/commit/push output captured in session log | session transcript (senpi-task st_01a101fc) |
| art-diffstat | git-object | commit stats: 0f2b116 (6 files, +175/-11), ca467f1 (3 evidence files, +1045) | /home/sleeg/work/native-gravity (`git show --stat`) |
| art-transcript | json | 8-call live harness transcript with per-call parse verdicts | /home/sleeg/work/native-gravity/.omo/evidence/2026-10-03-44g-role-contract-transcript.json (132,980 bytes; also /tmp/ntg-44g-role-contract-r9RWNc/transcript.json) |
| art-findings | markdown | findings doc with Verification section + pass-rate table | /home/sleeg/work/native-gravity/.omo/evidence/2026-10-03-44g-role-contract-findings.md |
| art-test-runner | cli-transcript | `node tests/test_runner_spike.mjs` -> "Summary: 41 passed, 0 failed" | session transcript |
| art-test-spine | cli-transcript | `node --test tests/test_spine.mjs` -> pass 41, fail 0 | session transcript |
| art-pr | url | PR #81, OPEN, body begins "Refs #44", no Closes | https://github.com/sleegme/native-gravity/pull/81 |

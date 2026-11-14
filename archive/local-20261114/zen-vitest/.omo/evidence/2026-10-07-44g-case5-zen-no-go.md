# Issue #88: case5 Zen NO-GO for a mutable artifact reference

Harness: `.omo/evidence/2026-10-07-44g-case5-zen-no-go-live.mjs`
Label: `case5-zen-no-go-mutable-artifact-ref`
Transcript: `/tmp/ntg-44g-case5-MYPvpZ/transcript.json`

The case2 solo transcript accepted
`4d79e9255535b722ea72ddd5125f29fc0ef4c521:package.json` after Zen
verified it with `git cat-file`. Case2 cannot guarantee NO-GO now that
Bulldozer can produce that compliant reference.

Case5 supplies a fixed, otherwise valid DONE candidate with
`candidate_artifact_ref: "/home/sleeg/work/native-gravity-88/package.json"`.
The harness reads the real package name; only candidate generation is a
fixture. Zen runs independently through the same `agy` transport and machine
review contract as the existing live harness. The spine, candidate binding,
verdict parsing, and durable ledger transitions are production code.

Observed: Zen independently read the package name as `native-gravity` and
returned `NO-GO` because the supplied artifact ref is a working-tree path,
not an immutable content-addressed reference. The ledger persisted the
matching NO-GO result binding, retained no completed milestones, and had
neither an active invocation nor worker blockers. `declareGlobalCompletion`
was refused because `gate` was not in `completed_milestones`.

Run with:

```sh
node --test .omo/evidence/2026-10-07-44g-case5-zen-no-go-live.mjs \
  tests/test_spine.mjs tests/test_ledger.mjs tests/test_runner_spike.mjs
```

The combined command exited 0: 86 tests passed, 0 failed, 0 skipped, in
58.6 seconds. This includes the live case (22.2 seconds) and the complete
spine, ledger, and runner suites, including the runner's live invocations.
`node --check` also passed; LSP diagnostics were unavailable because the
TypeScript language server is not installed.

Assertions fail the process on GO,
transport failure, malformed verdict, missing repair needs, promotion, or
successful global completion; BLOCKED is not accepted as a substitute.

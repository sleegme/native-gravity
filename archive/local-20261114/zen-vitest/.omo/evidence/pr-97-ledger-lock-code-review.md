# Code review: PR #97 (fix/44g-92-ledger-lock @ 951ffd4), ledger lockfile

The ulw attempt dir was not resolvable here because no JS eval cell was available, so this report uses the fallback path.

## Verdict
- codeQualityStatus: WATCH
- recommendation: APPROVE
- blockers: none (no CRITICAL or HIGH findings)

## Evidence (collected in this session)
- `node --test tests/test_ntg_run.mjs tests/test_spine.mjs` on Node v26.8.1 gave 59 tests, 59 pass, 0 fail, in 847 ms.
- `npm test` does not exist ("Missing script: test"), so the repo has no aggregate test entry point. This was already true before the PR.
- Probe: ENOENT spawn with `--ledger` exits 254 and removes the lock. Without `--ledger` it also exits 254. On `main`, the same case exits 1.
- Probe: SIGHUP to a process holding `acquireLedgerLock` exits 129 and leaves `l.json.lock` on disk.
- Writer search: `.save(` / `AuthoritativeLedger` / `ledger.json` turn up only in `scripts/ledger.mjs` (primitive), `scripts/spine.mjs` (behind the lock) and `scripts/ntg-run.mjs`. No hook, CLI subcommand or Python hook writes the ledger. `docs/specs/vnext/hooks/zen-shell-guard.py` only pattern-matches fs write calls.

## Focus answers
1. **Exclusivity.** `openSync(path, 'wx')` is `O_CREAT|O_EXCL`, which is atomic on local Linux filesystems and on NFSv3+. The lock really is exclusive across processes. Write and close are right: on a write failure the code unlinks the lock and then `finally` closes the fd, so neither the fd nor the lock leaks. If `unlinkSync` throws there, it hides the original error (nit). The `'exit'` listener runs synchronously on `process.exit()`, on natural drain and on uncaught-exception exit, and `release` uses only sync calls, so it is reliable on those paths. The SIGINT/SIGTERM handlers do not leak: `release()` removes all three listeners, and they are `once`. Several spines in one process add 3 listeners each, so more than about 10 open spines will trigger a MaxListeners warning (unlikely in practice).
2. **Stale lock.** The lock fails closed: an existing lock always refuses, whatever PID or content it holds, and the test covers this. The README recovery procedure is adequate, and it correctly warns about PID reuse. It leaves out SIGHUP (see M1).
3. **Other writers.** None found. `AuthoritativeLedger.save/load` can still be used without the lock, as the README states. `ledger.save` uses a unique temp file and then rename, so it is atomic per write.
4. **Tests.** The tests prove that a second ntg-run and a second MinimalSpine refuse with `LEDGER_LOCKED`. They check that the ledger bytes are unchanged, that the lock holds the owner PID, that the lock is released on normal exit, SIGINT (130) and SIGTERM (143), that the next run can acquire the lock straight away, and that a failed init releases the lock. They use real child processes with readiness signals (stdout line / IPC message) and no sleeps.

## CRITICAL
None.

## HIGH
None.

## MEDIUM
- **M1. SIGHUP leaves a stale lock.** `scripts/ledger-lock.mjs:47-50` and `scripts/ntg-run.mjs` (signal forwarding) handle only SIGINT and SIGTERM. Node's default SIGHUP action kills the process without emitting `'exit'`, as the probe confirmed. Closing a terminal, killing a tmux pane or dropping an ssh session is a normal way to end a run, and every one of them leaves the lock behind and forces manual recovery. It fails closed, so this is not a correctness bug, but the UX is poor, and the README's list of stale-lock causes leaves it out. Fix: add SIGHUP (exit 129) wherever SIGINT/SIGTERM are handled or forwarded, or at least document it.
- **M2. A library installs process-wide signal handlers that force exit.** In `scripts/ledger-lock.mjs:36-37,48-49`, `MinimalSpine` (spine.mjs:37) uses `handleSignals: true` by default. This registers SIGINT/SIGTERM listeners that call `process.exit(130/143)`. A host that embeds MinimalSpine and has its own graceful-shutdown handler gets cut off: the handlers fire in registration order, and the first `process.exit` wins. Also, registering any SIGINT listener disables Node's default behaviour process-wide. That is acceptable for the current CLI-style consumers. Consider exposing `handleSignals` through the `MinimalSpine` options, or relying only on `'exit'` plus explicit `close()`.
- **M3. ntg-run exit code changed on spawn failure.** In `scripts/ntg-run.mjs` (`child.once("close", ...)`), when `agy` is missing `close` reports `code = -2`, which becomes `process.exit(-2)` and exits 254. On main this exited 1. The change applies even without `--ledger`, so this PR changes the existing marker-only path. Fix: use `code === null || code < 0 ? ... : code`, or track the `error` event and exit 1.

## LOW
- **L1.** `release()` unconditionally `unlinkSync`s the lock path (`ledger-lock.mjs:39`) without checking that the PID inside is still its own. If an operator wrongly removes a live lock and a second owner acquires it, the first owner's exit deletes the second owner's lock. If the file is already gone, `unlinkSync` throws inside the `'exit'` handler. The README forbids removing live locks, so this is LOW.
- **L2.** The lock key is `realpath(dirname) + basename`. A ledger that is reached through a symlinked *file* (as opposed to a symlinked directory) gets a different lock name for each path. The README already says "same ledger path".
- **L3.** Ctrl-C on a TTY sends SIGINT to the whole foreground process group. `agy` therefore gets SIGINT twice: once from the TTY and once forwarded by ntg-run. This is harmless for most CLIs. Forwarding exists for non-TTY senders.
- **L4.** The test fixture's `t.after` (tests/test_spine.mjs, around line 102) calls `owner.close()` before `rmSync`. If a test fails while an invocation is busy, `close()` throws and the temp dir is not removed. This only affects cleanup.

## Skill-perspective check (remove-ai-slops, programming)
The skill files were not loadable in this session, so I applied the documented criteria from the task prompt instead.
- **Tests.** No deletion-only, tautological or constant-mirroring tests. The assertions target machine-consumed values: exit codes, the `LEDGER_LOCKED` code, lock file contents equal to the PID, and ledger bytes. There are no prose or prompt pins. Exit-code constants 130/143 are asserted, but they are the contract being tested, not mirrored internals.
- **Production code.** No needless abstraction or untyped escape hatches. The `--ledger` argument parsing in ntg-run sits at a CLI boundary, which is appropriate. Neither skill perspective is violated.
- **Scope.** The README rewrite of the native-first paragraph is relevant to the new flag. The `spawnSync` to async `spawn` change in ntg-run is needed to hold the lock and forward signals, but it caused M3.

# QA Skill: Behavioral Verification

Verification discipline for runtime behavior vs. static configuration, observable test efficacy, and error-masking patterns.

## Applicability

Applies when a change introduces or alters:
- runtime logic, dispatch tables, execution hooks, or lifecycle handlers
- configuration that dictates runtime selection, routing, or resolution
- automated test suites asserting system behavior
- error handling, fallbacks, exception boundaries, or recovery logic

## Evidence surfaces

Inspect the following surfaces directly:
- Process execution logs, exit codes, stdout/stderr streams
- Negative test execution outputs and rejected-input results
- Exception traces confirming that contract-required errors reach caller boundaries
- Test assertion source code to verify observable state inspection

## Observable vs. inferable

- **Observable**: Directly inspecting runtime process execution outputs, status codes, and emitted events; observing tests fail when assertions are deliberately invalidated; observing that invalid inputs produce explicit contract-defined failures.
- **Inferable (prohibited as verification basis)**: Inferring runtime correctness from static syntax/schema checks; assuming error handling works because no unhandled exception crashed the process; assuming a test proves behavior because it exits with code 0 without asserting observable effects.

## Failure modes

The following conditions are defects:
- Static-only conformity: configuration passes static schema/lint checks but runtime dispatch, routing, or execution fails or resolves incorrectly.
- Tautological or shallow tests: tests passing syntactically while testing trivial constants, mocking away the behavior under test, or omitting assertions on observable outcomes.
- Error-masking: broad exception handlers (`try...except: pass`, catch-all fallbacks) that swallow contract-required failures or convert failure into default success.
- Unobservable error suppression: failures logged or ignored when the contract requires an explicit failure status, error code, or raised exception.

## Minimum verification procedure

1. **Verify runtime execution**: For runtime-dependent changes, execute the candidate component and observe actual runtime behavior and outputs, not merely static validity.
2. **Execute negative paths**: Exercise invalid inputs, missing prerequisites, or error conditions. Confirm the system fails closed and raises contract-specified errors.
3. **Audit exception boundaries**: Inspect handlers to confirm that contract violations and fatal conditions are not caught and swallowed by broad default handlers.
4. **Audit test assertions**: Inspect test implementations to confirm assertions check observable output, state changes, or emitted errors rather than self-referential tautologies.

## PASS / FAIL / UNKNOWN reporting

- **PASS**: Runtime behavior observed and verified against contract; negative cases verified to fail closed with expected errors; error handlers surface required failures; tests assert observable effects.
- **FAIL**: Runtime behavior contradicts static configuration; tests pass without verifying behavior; error-masking swallows contract violations. Report the exact component, observed behavior, and contract requirement.
- **UNKNOWN**: Runtime environment is unavailable to execute or observe the behavioral path. Report the unverified runtime condition as an evidence gap. Do not convert static syntax compliance into runtime PASS.

## Independent vs. self-check distinction

Tests authored alongside the implementation are valuable local checks but remain self-checks. Independent verification requires executing tests in an isolated execution harness or obtaining verification from an independent review role (e.g. Zen).

This skill does not grant new tools or permissions; verification operates strictly within the active role's existing authority.

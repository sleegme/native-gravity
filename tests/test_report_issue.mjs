import test from "node:test";
import assert from "node:assert/strict";
import { resolve, join } from "node:path";
import { readFileSync, mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

import { collectReport, redact, renderIssue, reportIssueCli } from "../scripts/report-issue.mjs";
import { runCli, shouldPromptForReport, REPORT_PROMPT_QUESTION } from "../scripts/ntg-vnext.mjs";


test("redact: masks OpenAI and Stripe-style sk- keys", () => {
  const secret = "sk-proj-1234567890abcdef12345678";
  const input = `Error connecting with key: ${secret} in configuration.`;
  const result = redact(input);
  assert.doesNotMatch(result, new RegExp(secret));
  assert.match(result, /\[REDACTED\]/);
});

test("redact: masks GitHub tokens across all standard prefixes", () => {
  const tokens = [
    "ghp_12345678901234567890",
    "gho_12345678901234567890",
    "ghu_12345678901234567890",
    "ghs_12345678901234567890",
    "ghr_12345678901234567890",
    "github_pat_12345678901234567890_abcdef",
  ];
  for (const token of tokens) {
    const input = `GitHub auth failure with token ${token}`;
    const output = redact(input);
    assert.doesNotMatch(output, new RegExp(token), `Should redact ${token}`);
    assert.match(output, /\[REDACTED\]/);
  }
});

test("redact: masks Google API keys (AIza...)", () => {
  const key = "AIzaSyD-1234567890abcdefghijklmnopqrstuv";
  const input = `Request to https://maps.googleapis.com?key=${key} failed.`;
  const result = redact(input);
  assert.doesNotMatch(result, new RegExp(key));
  assert.match(result, /\[REDACTED\]/);
});

test("redact: masks Slack tokens (xox[abprs]-...)", () => {
  const tokens = [
    "xoxb-1234567890-1234567890123-abcdef",
    "xoxa-1234567890-1234567890123-abcdef",
    "xoxp-1234567890-1234567890123-abcdef",
    "xoxr-1234567890-1234567890123-abcdef",
    "xoxs-1234567890-1234567890123-abcdef",
  ];
  for (const token of tokens) {
    const input = `Slack webhook error using ${token}`;
    const output = redact(input);
    assert.doesNotMatch(output, new RegExp(token));
    assert.match(output, /\[REDACTED\]/);
  }
});

test("redact: masks Authorization and Bearer headers", () => {
  const secret1 = "secret-token-value-1234567890";
  const secret2 = "another-bearer-value-9876543210";
  const input1 = `Authorization: Bearer ${secret1}`;
  const input2 = `authorization: ${secret2}`;
  const input3 = `Bearer ${secret1}`;

  const res1 = redact(input1);
  const res2 = redact(input2);
  const res3 = redact(input3);

  assert.doesNotMatch(res1, new RegExp(secret1));
  assert.doesNotMatch(res2, new RegExp(secret2));
  assert.doesNotMatch(res3, new RegExp(secret1));
});

test("redact: masks JWTs", () => {
  const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
  const input = `Received JWT token: ${jwt}`;
  const result = redact(input);
  assert.doesNotMatch(result, new RegExp(jwt.slice(0, 20)));
  assert.match(result, /\[REDACTED\]/);
});

test("redact: masks AWS access keys and 32+ hex character keys", () => {
  const awsKey = "AKIAIOSFODNN7EXAMPLE";
  const hexKey = "4f8b2c1d9e3a7b5f0c8d2e4a6b8c0d2e"; // 32 hex chars

  const inputAws = `AWS error with credential ${awsKey}`;
  const inputHex = `Client secret: ${hexKey}`;

  assert.doesNotMatch(redact(inputAws), new RegExp(awsKey));
  assert.doesNotMatch(redact(inputHex), new RegExp(hexKey));
});

test("redact: masks PEM private keys", () => {
  const pem = `-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA0Y3wZ...fake...private...key...data...
-----END RSA PRIVATE KEY-----`;
  const input = `Key file contents:\n${pem}\nEnd of log.`;
  const result = redact(input);
  assert.doesNotMatch(result, /MIIEowIBAAKCAQEA/);
  assert.match(result, /\[REDACTED\]/);
});

test("redact: masks email addresses with [REDACTED_EMAIL]", () => {
  const emails = [
    "alice@example.com",
    "john.doe+tag@company.co.uk",
    "user_123@sub.domain.org",
  ];
  for (const email of emails) {
    const input = `Contact maintainer at ${email} for support.`;
    const result = redact(input);
    assert.doesNotMatch(result, new RegExp(email));
    assert.match(result, /\[REDACTED_EMAIL\]/);
  }
});

test("redact: replaces absolute home paths with ~", () => {
  assert.strictEqual(
    redact("/home/alice/project/file.txt"),
    "~/project/file.txt"
  );
  assert.strictEqual(
    redact("/Users/bob/code/repo/index.js"),
    "~/code/repo/index.js"
  );
  assert.strictEqual(
    redact("Logged in as /home/fakeuser on machine"),
    "Logged in as ~ on machine"
  );
  assert.strictEqual(
    redact("Path in quotes: \"/home/alice/workspace\""),
    "Path in quotes: \"~/workspace\""
  );
});

test("redact: masks hostnames and secrets from process environment", () => {
  const customEnv = {
    HOSTNAME: "production-worker-node-01",
    MY_DATABASE_PASSWORD: "super_secret_db_pass_12345",
    THIRD_PARTY_API_KEY: "secret_api_key_value_987",
    UNRELATED_ENV: "normal_value",
  };

  const input = "Connecting to production-worker-node-01 with password super_secret_db_pass_12345 and key secret_api_key_value_987.";
  const result = redact(input, { env: customEnv });

  assert.doesNotMatch(result, /production-worker-node-01/);
  assert.doesNotMatch(result, /super_secret_db_pass_12345/);
  assert.doesNotMatch(result, /secret_api_key_value_987/);
  assert.match(result, /\[REDACTED_HOST\]/);
  assert.match(result, /\[REDACTED\]/);
});

test("redact: masks inline assignments (FOO_SECRET=..., MY_KEY=..., PASSWORD=...)", () => {
  const input = "export DB_PASSWORD=mySecretPass123 API_KEY='key-xyz-789' FOO_SECRET=\"tok-12345\" NORMAL_VAR=hello";
  const result = redact(input);

  assert.match(result, /DB_PASSWORD=\[REDACTED\]/);
  assert.match(result, /API_KEY=\[REDACTED\]/);
  assert.match(result, /FOO_SECRET=\[REDACTED\]/);
  assert.match(result, /NORMAL_VAR=hello/);
});

test("redact: preserves ordinary text intact without false positives", () => {
  const normalTexts = [
    "The quick brown fox jumps over the lazy dog.",
    "version: 1.2.3",
    "sk-short", // shorter than 16 chars
    "AKIA123", // shorter than 16 chars
    "https://example.com/api/v1/users",
    "Error: file not found at src/app.ts:42",
    "Process exited with status 0",
  ];
  for (const text of normalTexts) {
    assert.strictEqual(redact(text), text);
  }
});

test("collectReport: summarizes ledger and never includes candidate payload, changes_made bodies, or source files", () => {
  const fixtureLedgerPath = resolve("tests/fixtures/report-issue/fixture.ledger.json");
  const sampleLogPath = resolve("tests/fixtures/report-issue/sample.log");
  const samplePlanPath = resolve("tests/fixtures/report-issue/sample-plan.md");

  // Read fixture file content to know the fake secrets and proprietary strings
  const fixtureRaw = readFileSync(fixtureLedgerPath, "utf-8");
  assert.match(fixtureRaw, /confidentialAlgorithm/);
  assert.match(fixtureRaw, /fake secret changes_made body containing proprietary text/);
  assert.match(fixtureRaw, /raw transcript data that must never be leaked/);
  assert.match(fixtureRaw, /sk-proj-1234567890abcdef12345678/);

  const report = collectReport({
    ledgerPath: fixtureLedgerPath,
    planPath: samplePlanPath,
    logPaths: [sampleLogPath],
  });

  // Verify all summary fields are present
  assert.ok("ntg_version" in report, "ntg_version present");
  assert.strictEqual(report.node_version, process.version);
  assert.strictEqual(report.platform, process.platform);
  assert.strictEqual(report.plan_version, 3);
  assert.ok(Array.isArray(report.milestones), "milestones is array");
  assert.ok(Array.isArray(report.failure_evidence), "failure_evidence is array");
  assert.ok(Array.isArray(report.verdicts), "verdicts is array");
  assert.ok(typeof report.usage_totals === "object", "usage_totals is object");
  assert.ok(Array.isArray(report.logs_summary), "logs_summary is array");
  assert.ok(report.plan_summary !== null, "plan_summary is present");

  // Check milestone statuses
  const m1 = report.milestones.find((m) => m.id === "m1");
  const m2 = report.milestones.find((m) => m.id === "m2");
  assert.ok(m1);
  assert.ok(m2);
  assert.strictEqual(m1.status, "COMPLETED");
  // m2 is active and has a blocker affecting it
  assert.strictEqual(m2.status, "ACTIVE");

  // Check usage totals
  assert.ok(report.usage_totals.bobcat);
  assert.strictEqual(report.usage_totals.bobcat.entries, 2);
  assert.strictEqual(report.usage_totals.bobcat.duration_ms, 2500);
  assert.strictEqual(report.usage_totals.bobcat.input_tokens, 210);
  assert.strictEqual(report.usage_totals.bobcat.output_tokens, 110);
  assert.strictEqual(report.usage_totals.bobcat.total_tokens, 320);

  assert.ok(report.usage_totals["strix-halo"]);
  assert.strictEqual(report.usage_totals["strix-halo"].entries, 1);
  assert.strictEqual(report.usage_totals["strix-halo"].duration_ms, 500);

  // Check verdicts
  assert.strictEqual(report.verdicts.length, 1);
  assert.strictEqual(report.verdicts[0].milestone_id, "m1");
  assert.strictEqual(report.verdicts[0].verdict, "GO");
  assert.strictEqual(report.verdicts[0].plan_version, 3);
  assert.strictEqual(report.verdicts[0].is_stale, false);

  // CRITICAL: candidate payload, changes_made bodies, source code, transcripts MUST NOT appear in report
  const reportJson = JSON.stringify(report);
  assert.doesNotMatch(reportJson, /confidentialAlgorithm/);
  assert.doesNotMatch(reportJson, /fake secret changes_made body/);
  assert.doesNotMatch(reportJson, /raw transcript data/);
  assert.doesNotMatch(reportJson, /sk-proj-1234567890abcdef12345678/);
  assert.doesNotMatch(reportJson, /super-secret-bearer-token/);
  assert.doesNotMatch(reportJson, /AIzaSyD-1234567890abcdefghijklmnopqrstuv/);
  assert.doesNotMatch(reportJson, /xoxb-1234567890/);
  assert.doesNotMatch(reportJson, /ghp_1234567890/);
  assert.doesNotMatch(reportJson, /\/home\/fakeuser/);
});

test("renderIssue: formats clean Markdown with redacted banner and no unredacted secrets", () => {
  const fixtureLedgerPath = resolve("tests/fixtures/report-issue/fixture.ledger.json");
  const sampleLogPath = resolve("tests/fixtures/report-issue/sample.log");
  const samplePlanPath = resolve("tests/fixtures/report-issue/sample-plan.md");

  const report = collectReport({
    ledgerPath: fixtureLedgerPath,
    planPath: samplePlanPath,
    logPaths: [sampleLogPath],
  });

  const { title, body } = renderIssue(report);

  // Title checks
  assert.ok(typeof title === "string" && title.length > 0);
  assert.match(title, /\[Bug Report\]/);
  assert.match(title, /plan 3/);

  // Body checks: Redaction notice banner
  assert.match(body, /> \*\*Notice\*\*:/);
  assert.match(body, /redacted/i);

  // Body sections
  assert.match(body, /### System Information/);
  assert.match(body, /### Milestones/);
  assert.match(body, /### Verdicts/);
  assert.match(body, /### Failure Evidence/);
  assert.match(body, /### Usage Totals/);
  assert.match(body, /### Log Summaries/);
  assert.match(body, /### Plan Summary/);

  // Secret absence in title and body
  const rendered = `${title}\n\n${body}`;
  assert.doesNotMatch(rendered, /sk-proj-1234567890abcdef12345678/);
  assert.doesNotMatch(rendered, /ghp_12345678901234567890/);
  assert.doesNotMatch(rendered, /AIzaSyD-1234567890abcdefghijklmnopqrstuv/);
  assert.doesNotMatch(rendered, /xoxb-1234567890-1234567890123-abcdef/);
  assert.doesNotMatch(rendered, /super-secret-bearer-token-12345678/);
  assert.doesNotMatch(rendered, /fake-engineer@example\.com/);
  assert.doesNotMatch(rendered, /\/home\/fakeuser/);
  assert.doesNotMatch(rendered, /confidentialAlgorithm/);
  assert.doesNotMatch(rendered, /raw transcript data/);
});

test("reportIssueCli: requires --ledger argument and exits with code 1", async () => {
  let stderrBuf = "";
  const stderr = { write: (str) => { stderrBuf += str; } };
  const code = await reportIssueCli([], {
    stderr,
    stdout: { write: () => {} },
  });
  assert.equal(code, 1);
  assert.match(stderrBuf, /Usage: ntg-report-issue --ledger <path>/);
});

test("reportIssueCli: TTY answer 'yes' calls gh exactly once with --body-file pointing to preview file", async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "ntg-issue-test-"));
  try {
    const fixtureLedger = resolve("tests/fixtures/report-issue/fixture.ledger.json");
    const outPath = join(tmpDir, "custom-preview.md");
    const calls = [];
    const mockSpawn = (cmd, args, opts) => {
      calls.push({ cmd, args, opts });
      return { status: 0 };
    };
    let stdoutBuf = "";
    const stdout = { write: (str) => { stdoutBuf += str; } };

    const code = await reportIssueCli(
      ["--ledger", fixtureLedger, "--out", outPath],
      {
        cwd: tmpDir,
        isTTY: true,
        prompt: async () => "  yes  ",
        spawn: mockSpawn,
        stdout,
        stderr: { write: () => {} },
      }
    );

    assert.equal(code, 0);
    assert.equal(calls.length, 1, "gh should be called exactly once");
    assert.equal(calls[0].cmd, "gh");
    assert.equal(calls[0].args[0], "issue");
    assert.equal(calls[0].args[1], "create");
    assert.equal(calls[0].args[2], "--repo");
    assert.equal(calls[0].args[3], "sleegme/native-gravity");
    assert.equal(calls[0].args[4], "--title");
    assert.ok(typeof calls[0].args[5] === "string" && calls[0].args[5].length > 0);
    assert.equal(calls[0].args[6], "--body-file");
    assert.equal(calls[0].args[7], outPath);
    assert.deepEqual(calls[0].opts, { stdio: "inherit" });

    // Acceptance criterion 2: Preview file content equals the redacted body that would be sent
    const fileContent = readFileSync(outPath, "utf-8");
    assert.match(fileContent, /> \*\*Notice\*\*:/);
    assert.ok(stdoutBuf.includes(fileContent));
    assert.doesNotMatch(fileContent, /sk-proj-1234567890abcdef12345678/);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("reportIssueCli: preview file content strictly equals the redacted body", async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "ntg-issue-test-"));
  try {
    const fixtureLedger = resolve("tests/fixtures/report-issue/fixture.ledger.json");
    const outPath = join(tmpDir, "equality-preview.md");
    let stdoutBody = "";
    const stdout = {
      write: (str) => {
        if (!stdoutBody) {
          stdoutBody = str;
        }
      },
    };

    const code = await reportIssueCli(
      ["--ledger", fixtureLedger, "--out", outPath],
      {
        cwd: tmpDir,
        isTTY: false,
        stdout,
        stderr: { write: () => {} },
      }
    );

    assert.equal(code, 0);
    const fileContent = readFileSync(outPath, "utf-8");
    // Verify file content is identical to the rendered body (trimmed of trailing newline from stdout.write)
    assert.equal(fileContent, stdoutBody.replace(/\n$/, ""));
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("reportIssueCli: TTY answer other than 'yes' aborts and never calls gh", async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "ntg-issue-test-"));
  try {
    const fixtureLedger = resolve("tests/fixtures/report-issue/fixture.ledger.json");
    const outPath = join(tmpDir, "abort-preview.md");

    for (const nonYesAnswer of ["no", "n", "yes please", "", "CANCEL", "nope"]) {
      const calls = [];
      const mockSpawn = () => { calls.push(1); return { status: 0 }; };
      let stdoutBuf = "";
      const stdout = { write: (str) => { stdoutBuf += str; } };

      const code = await reportIssueCli(
        ["--ledger", fixtureLedger, "--out", outPath],
        {
          cwd: tmpDir,
          isTTY: true,
          prompt: async () => nonYesAnswer,
          spawn: mockSpawn,
          stdout,
          stderr: { write: () => {} },
        }
      );

      assert.equal(code, 0);
      assert.equal(calls.length, 0, `gh must not be called when answer is '${nonYesAnswer}'`);
      assert.match(stdoutBuf, /aborted/i);
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("reportIssueCli: non-TTY never calls gh and prints the manual command", async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "ntg-issue-test-"));
  try {
    const fixtureLedger = resolve("tests/fixtures/report-issue/fixture.ledger.json");
    const outPath = join(tmpDir, "nontty-preview.md");
    const calls = [];
    let stdoutBuf = "";
    const stdout = { write: (str) => { stdoutBuf += str; } };

    const code = await reportIssueCli(
      ["--ledger", fixtureLedger, "--out", outPath],
      {
        cwd: tmpDir,
        isTTY: false,
        spawn: () => { calls.push(1); },
        stdout,
        stderr: { write: () => {} },
      }
    );

    assert.equal(code, 0);
    assert.equal(calls.length, 0, "Non-TTY must never call gh");
    assert.match(
      stdoutBuf,
      new RegExp(`gh issue create --repo sleegme/native-gravity --title ".*" --body-file ${outPath}`)
    );
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("reportIssueCli: missing gh (ENOENT) prints manual command and GitHub URL", async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "ntg-issue-test-"));
  try {
    const fixtureLedger = resolve("tests/fixtures/report-issue/fixture.ledger.json");
    const outPath = join(tmpDir, "missing-gh-preview.md");
    let stderrBuf = "";
    const stderr = { write: (str) => { stderrBuf += str; } };

    const code = await reportIssueCli(
      ["--ledger", fixtureLedger, "--out", outPath, "--repo", "custom-owner/custom-repo"],
      {
        cwd: tmpDir,
        isTTY: true,
        prompt: async () => "yes",
        spawn: () => {
          const err = new Error("spawnSync gh ENOENT");
          err.code = "ENOENT";
          return { error: err };
        },
        stdout: { write: () => {} },
        stderr,
      }
    );

    assert.equal(code, 1);
    assert.match(
      stderrBuf,
      new RegExp(`gh issue create --repo custom-owner/custom-repo --title ".*" --body-file ${outPath}`)
    );
    assert.match(stderrBuf, /https:\/\/github\.com\/custom-owner\/custom-repo\/issues\/new/);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("package.json: bin and files contain ntg-report-issue, and npm pack lists it", () => {
  const pkg = JSON.parse(readFileSync(resolve("package.json"), "utf-8"));
  assert.equal(pkg.bin["ntg-report-issue"], "scripts/report-issue.mjs");
  assert.ok(pkg.files.includes("scripts/report-issue.mjs"));

  const pack = spawnSync("npm", ["pack", "--dry-run"], { encoding: "utf-8" });
  assert.equal(pack.status, 0);
  assert.match(pack.stdout + pack.stderr, /scripts\/report-issue\.mjs/);
});

test("ntg-vnext: failure output includes one-line report-issue hint", () => {
  const resWithLedger = spawnSync(
    process.execPath,
    ["scripts/ntg-vnext.mjs", "run", "--ledger", "custom/path/ledger.json"],
    { encoding: "utf-8" }
  );
  assert.equal(resWithLedger.status, 1);
  assert.match(resWithLedger.stderr, /To report this issue: ntg-report-issue --ledger custom\/path\/ledger\.json/);

  const resWithoutLedger = spawnSync(
    process.execPath,
    ["scripts/ntg-vnext.mjs", "invalid-subcommand"],
    { encoding: "utf-8" }
  );
  assert.equal(resWithoutLedger.status, 1);
  assert.match(resWithoutLedger.stderr, /To report this issue: ntg-report-issue --ledger <path>/);
});

test("shouldPromptForReport: honors TTY, CI, and NTG_NO_REPORT_PROMPT rules", () => {
  const tty = { isTTY: true };
  const notty = { isTTY: false };
  const undefTty = {};

  // Prompt only when both stdin and stderr are TTYs
  assert.equal(shouldPromptForReport({ stdin: tty, stderr: tty, env: {} }), true);
  assert.equal(shouldPromptForReport({ stdin: notty, stderr: tty, env: {} }), false);
  assert.equal(shouldPromptForReport({ stdin: tty, stderr: notty, env: {} }), false);
  assert.equal(shouldPromptForReport({ stdin: undefTty, stderr: tty, env: {} }), false);
  assert.equal(shouldPromptForReport({ stdin: tty, stderr: undefTty, env: {} }), false);

  // Skip when CI is set
  assert.equal(shouldPromptForReport({ stdin: tty, stderr: tty, env: { CI: "true" } }), false);
  assert.equal(shouldPromptForReport({ stdin: tty, stderr: tty, env: { CI: "1" } }), false);

  // Skip when NTG_NO_REPORT_PROMPT is 1
  assert.equal(shouldPromptForReport({ stdin: tty, stderr: tty, env: { NTG_NO_REPORT_PROMPT: "1" } }), false);
});

test("ntg-vnext: interactive failure plus 'y' or 'yes' invokes report flow once with same --ledger path and keeps original exit code", async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "ntg-vnext-prompt-"));
  try {
    const fixtureLedger = resolve("tests/fixtures/report-issue/fixture.ledger.json");

    // Case 1: Error exit (exit code 1) with 'yes' / 'y' variants
    for (const yesAnswer of ["y", "yes", "  yes  ", "Y", "YES"]) {
      const calls = [];
      let stderrBuf = "";
      let stdoutBuf = "";
      const mockReportIssue = async (argv, opts) => {
        calls.push({ argv, opts });
        return 0;
      };

      const res = await runCli(["invalid-command", "--ledger", fixtureLedger], {
        stdin: { isTTY: true },
        stderr: { isTTY: true, write: (s) => { stderrBuf += s; } },
        stdout: { write: (s) => { stdoutBuf += s; } },
        env: {},
        prompt: async () => yesAnswer,
        reportIssue: mockReportIssue,
      });

      assert.equal(res.code, 1, `exit code must remain 1 for answer '${yesAnswer}'`);
      assert.equal(calls.length, 1, `report flow must be invoked once for answer '${yesAnswer}'`);
      assert.deepEqual(calls[0].argv, ["--ledger", fixtureLedger]);
      assert.match(stderrBuf, /Report this problem as an issue\? \(y\/N\)/);
    }

    // Case 2: Milestone NO-GO / BLOCKED outcome (exit code 2) with 'y'
    const planPath = join(tmpDir, "plan.json");
    writeFileSync(planPath, JSON.stringify({
      goal: "Test goal", constraints: [], decision_invariants: [], plan_version: "v1",
      milestones: [{ id: "m1", title: "m1", objective: "obj", bounded_scope: ["m1.txt"], acceptance_criteria: ["c1"], non_goals: [], dependencies: [] }],
    }));
    const ledgerPath = join(tmpDir, "ledger.json");

    // Init ledger first
    await runCli(["init", "--ledger", ledgerPath, "--plan", planPath], {
      stdin: { isTTY: false },
      stderr: { isTTY: false, write: () => {} },
      stdout: { write: () => {} },
      env: {},
    });

    const calls = [];
    let stderrBuf = "";
    const mockReportIssue = async (argv, opts) => {
      calls.push({ argv, opts });
      return 0;
    };
    const deps = {
      handleSignals: false,
      invokeRole: async () => ({
        ok: true,
        status: "SUCCESS",
        response: JSON.stringify({
          milestone_id: "m1", plan_version: "v1", status: "DONE",
          changes_made: ["m1.txt"], verification_evidence: [{ classification: "OBSERVED", criterion: "c1", result: "ok" }],
          unresolved_unknowns: [], scope_deviations: [], candidate_artifact_ref: "sha256:m1",
        }),
      }),
      invokeZen: async (request) => ({
        milestone_id: request.milestone_id,
        plan_version: request.plan_version,
        result_ref: request.result_ref,
        verdict: "NO-GO",
        verification_evidence: [{ classification: "OBSERVED", criterion: "c1", result: "failed" }],
        repair_needs: "repair milestone",
      }),
    };


    const res = await runCli(["run", "--ledger", ledgerPath], {
      stdin: { isTTY: true },
      stderr: { isTTY: true, write: (s) => { stderrBuf += s; } },
      stdout: { write: () => {} },
      env: {},
      prompt: async () => "y",
      reportIssue: mockReportIssue,
      deps,
    });

    assert.equal(res.code, 2, "exit code must remain 2 for NO-GO outcome");
    assert.equal(calls.length, 1, "report flow must be invoked once");
    assert.deepEqual(calls[0].argv, ["--ledger", ledgerPath]);
    assert.match(stderrBuf, /Report this problem as an issue\? \(y\/N\)/);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("ntg-vnext: interactive failure plus Enter, 'n', or other input declines and does not invoke report flow", async () => {
  const fixtureLedger = resolve("tests/fixtures/report-issue/fixture.ledger.json");
  const declineAnswers = ["", "\n", "n", "N", "no", "NO", "nope", "cancel", "xyz"];

  for (const answer of declineAnswers) {
    const calls = [];
    let stderrBuf = "";
    const mockReportIssue = async () => { calls.push(1); return 0; };

    const res = await runCli(["invalid-command", "--ledger", fixtureLedger], {
      stdin: { isTTY: true },
      stderr: { isTTY: true, write: (s) => { stderrBuf += s; } },
      stdout: { write: () => {} },
      env: {},
      prompt: async () => answer,
      reportIssue: mockReportIssue,
    });

    assert.equal(res.code, 1, `exit code must remain 1 for declined answer '${answer}'`);
    assert.equal(calls.length, 0, `report flow must NOT be invoked for answer '${answer}'`);
    assert.match(stderrBuf, /Report this problem as an issue\? \(y\/N\)/);
  }
});

test("ntg-vnext: non-TTY, CI is set, or NTG_NO_REPORT_PROMPT=1 never prompts and prints existing one-line hint", async () => {
  const fixtureLedger = resolve("tests/fixtures/report-issue/fixture.ledger.json");
  const nonInteractiveConfigs = [
    { stdin: { isTTY: false }, stderr: { isTTY: true }, env: {}, desc: "stdin not TTY" },
    { stdin: { isTTY: true }, stderr: { isTTY: false }, env: {}, desc: "stderr not TTY" },
    { stdin: { isTTY: false }, stderr: { isTTY: false }, env: {}, desc: "neither TTY" },
    { stdin: { isTTY: true }, stderr: { isTTY: true }, env: { CI: "true" }, desc: "CI=true" },
    { stdin: { isTTY: true }, stderr: { isTTY: true }, env: { CI: "1" }, desc: "CI=1" },
    { stdin: { isTTY: true }, stderr: { isTTY: true }, env: { NTG_NO_REPORT_PROMPT: "1" }, desc: "NTG_NO_REPORT_PROMPT=1" },
  ];

  for (const cfg of nonInteractiveConfigs) {
    let promptCalled = false;
    let reportCalled = false;
    let stderrBuf = "";

    const res = await runCli(["invalid-command", "--ledger", fixtureLedger], {
      stdin: cfg.stdin,
      stderr: { ...cfg.stderr, write: (s) => { stderrBuf += s; } },
      stdout: { write: () => {} },
      env: cfg.env,
      prompt: async () => { promptCalled = true; return "yes"; },
      reportIssue: async () => { reportCalled = true; return 0; },
    });

    assert.equal(res.code, 1, `exit code must be 1 for ${cfg.desc}`);
    assert.equal(promptCalled, false, `prompt must not be called when ${cfg.desc}`);
    assert.equal(reportCalled, false, `reportIssue must not be called when ${cfg.desc}`);
    assert.doesNotMatch(stderrBuf, /Report this problem as an issue\? \(y\/N\)/, `prompt must not appear when ${cfg.desc}`);
    assert.match(stderrBuf, new RegExp(`To report this issue: ntg-report-issue --ledger ${fixtureLedger.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  }
});

test("ntg-vnext: successful run (exit 0) never prompts or prints report hint", async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "ntg-vnext-success-"));
  try {
    const planPath = join(tmpDir, "plan.json");
    writeFileSync(planPath, JSON.stringify({
      goal: "Test goal", constraints: [], decision_invariants: [], plan_version: "v1",
      milestones: [{ id: "m1", title: "m1", objective: "obj", bounded_scope: ["m1.txt"], acceptance_criteria: ["c1"], non_goals: [], dependencies: [] }],
    }));
    const ledgerPath = join(tmpDir, "ledger.json");

    let promptCalled = false;
    let reportCalled = false;
    let stderrBuf = "";
    let stdoutBuf = "";

    const res = await runCli(["init", "--ledger", ledgerPath, "--plan", planPath], {
      stdin: { isTTY: true },
      stderr: { isTTY: true, write: (s) => { stderrBuf += s; } },
      stdout: { write: (s) => { stdoutBuf += s; } },
      env: {},
      prompt: async () => { promptCalled = true; return "yes"; },
      reportIssue: async () => { reportCalled = true; return 0; },
    });

    assert.equal(res.code, 0, "successful init must exit 0");
    assert.equal(promptCalled, false, "prompt must not be called on exit 0");
    assert.equal(reportCalled, false, "report must not be called on exit 0");
    assert.doesNotMatch(stderrBuf, /Report this problem as an issue/);
    assert.doesNotMatch(stderrBuf, /To report this issue/);
    assert.ok(stdoutBuf.includes('"next_milestone": "m1"'));
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("ntg-vnext: no prompt can appear before main() settles and releases ledger lock", async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "ntg-vnext-locktest-"));
  try {
    const planPath = join(tmpDir, "plan.json");
    writeFileSync(planPath, JSON.stringify({
      goal: "Test goal", constraints: [], decision_invariants: [], plan_version: "v1",
      milestones: [{ id: "m1", title: "m1", objective: "obj", bounded_scope: ["m1.txt"], acceptance_criteria: ["c1"], non_goals: [], dependencies: [] }],
    }));
    const ledgerPath = join(tmpDir, "ledger.json");
    const lockPath = `${ledgerPath}.lock`;

    // Init ledger
    await runCli(["init", "--ledger", ledgerPath, "--plan", planPath], {
      stdin: { isTTY: false },
      stderr: { isTTY: false, write: () => {} },
      stdout: { write: () => {} },
      env: {},
    });

    const events = [];
    const deps = {
      handleSignals: false,
      invokeRole: async () => {
        events.push("main_executing");
        assert.ok(existsSync(lockPath), "ledger lock must be held during main execution");
        return {
          ok: true,
          status: "SUCCESS",
          response: JSON.stringify({
            milestone_id: "m1", plan_version: "v1", status: "DONE",
            changes_made: ["m1.txt"], verification_evidence: [{ classification: "OBSERVED", criterion: "c1", result: "ok" }],
            unresolved_unknowns: [], scope_deviations: [], candidate_artifact_ref: "sha256:m1",
          }),
        };
      },
      invokeZen: async (request) => {
        events.push("zen_executing");
        assert.ok(existsSync(lockPath), "ledger lock must be held during zen verification");
        return {
          milestone_id: request.milestone_id,
          plan_version: request.plan_version,
          result_ref: request.result_ref,
          verdict: "NO-GO",
          verification_evidence: [{ classification: "OBSERVED", criterion: "c1", result: "failed" }],
          repair_needs: "need repair",
        };
      },
    };

    const res = await runCli(["run", "--ledger", ledgerPath], {
      stdin: { isTTY: true },
      stderr: { isTTY: true, write: () => {} },
      stdout: { write: () => {} },
      env: {},
      prompt: async () => {
        events.push("prompt_called");
        assert.equal(existsSync(lockPath), false, "ledger lock must be released before prompt is shown");
        return "n";
      },
      reportIssue: async () => { events.push("report_called"); return 0; },
      deps,
    });

    assert.equal(res.code, 2);
    assert.deepEqual(events, ["main_executing", "zen_executing", "prompt_called"],
      "prompt must appear strictly after main() settles and releases lock");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});



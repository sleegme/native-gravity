#!/usr/bin/env node
import { existsSync, readFileSync, statSync, writeFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

/**
 * Known secret patterns and common API token prefixes.
 */
const SECRET_ENV_KEY_NAME = /(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH)/i;

const INLINE_ASSIGNMENT_RE =
  /\b([A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH)[A-Za-z0-9_]*)=(?:("[^"]*")|('[^']*')|(\S+))/gi;

const COMMON_SECRET_PATTERNS = [
  // PEM private keys
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  // GitHub tokens (ghp_, gho_, ghu_, ghs_, ghr_, github_pat_)
  /\b(?:gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,})\b/g,
  // OpenAI / Stripe-style sk- keys (16+ chars)
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  // Google API keys (AIza + 35 chars)
  /\bAIza[0-9A-Za-z-_]{35}\b/g,
  // Slack tokens (xoxb-, xoxa-, xoxp-, xoxr-, xoxs-)
  /\bxox[abprs]-[A-Za-z0-9-]{8,}\b/g,
  // AWS access key IDs
  /\bAKIA[0-9A-Z]{16}\b/g,
  // High entropy 32+ hex character keys
  /\b[0-9a-fA-F]{32,}\b/g,
  // JWT tokens (three base64url segments starting with eyJ)
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
];

// Bearer / Authorization headers
const AUTH_HEADER_RE = /(?:bearer|authorization):\s+(?:bearer\s+)?[A-Za-z0-9._~+/=-]{16,}/gi;
const STANDALONE_BEARER_RE = /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/gi;

// Email addresses
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// Absolute home paths (/home/<user> or /Users/<user>)
const HOME_PATH_RE = /(?:\/home|\/Users)\/([^\s/'"`:;,]+)/g;

const REDACTED_MARKER = "[REDACTED]";
const REDACTED_EMAIL = "[REDACTED_EMAIL]";
const REDACTED_HOST = "[REDACTED_HOST]";

/**
 * Pure function: masks secrets, credentials, emails, and home paths.
 *
 * @param {string} text
 * @param {object} [options]
 * @param {object} [options.env=process.env]
 * @returns {string}
 */
export function redact(text, { env = process.env } = {}) {
  if (typeof text !== "string" || text.length === 0) {
    return text;
  }

  let out = text;

  // 1. Hostnames from environment
  if (env) {
    for (const varName of ["HOSTNAME", "HOST"]) {
      const val = env[varName];
      if (typeof val === "string") {
        const trimmed = val.trim();
        if (
          trimmed.length >= 2 &&
          !["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(trimmed.toLowerCase())
        ) {
          out = out.split(trimmed).join(REDACTED_HOST);
        }
      }
    }

    // 2. Values of environment variables whose name contains KEY, TOKEN, SECRET, or PASSWORD
    const envSecretValues = new Set();
    for (const [k, v] of Object.entries(env)) {
      if (SECRET_ENV_KEY_NAME.test(k) && typeof v === "string") {
        const trimmed = v.trim();
        if (trimmed.length >= 3) {
          envSecretValues.add(trimmed);
        }
      }
    }
    // Sort descending by length so longer substrings are masked first
    const sortedEnvSecrets = Array.from(envSecretValues).sort((a, b) => b.length - a.length);
    for (const secretVal of sortedEnvSecrets) {
      out = out.split(secretVal).join(REDACTED_MARKER);
    }
  }

  // 3. Inline assignments (FOO_SECRET=..., MY_KEY=..., PASSWORD=...)
  out = out.replace(INLINE_ASSIGNMENT_RE, (match, varName) => `${varName}=${REDACTED_MARKER}`);

  // 4. Common provider prefixes and secret patterns
  for (const pattern of COMMON_SECRET_PATTERNS) {
    out = out.replace(pattern, REDACTED_MARKER);
  }

  // 5. Authorization / Bearer headers
  out = out.replace(AUTH_HEADER_RE, (match) => {
    const colonIdx = match.indexOf(":");
    if (colonIdx !== -1) {
      return `${match.slice(0, colonIdx + 1)} ${REDACTED_MARKER}`;
    }
    return `${REDACTED_MARKER}`;
  });
  out = out.replace(STANDALONE_BEARER_RE, `Bearer ${REDACTED_MARKER}`);

  // 6. Email addresses
  out = out.replace(EMAIL_RE, REDACTED_EMAIL);

  // 7. Absolute home paths (/home/alice/x -> ~/x, /Users/bob/y -> ~/y)
  out = out.replace(HOME_PATH_RE, "~");

  return out;
}

/**
 * Deeply redacts any string within an object, array, or primitive.
 *
 * @param {*} val
 * @param {object} [options]
 * @returns {*}
 */
export function redactValue(val, options) {
  if (typeof val === "string") {
    return redact(val, options);
  }
  if (Array.isArray(val)) {
    return val.map((item) => redactValue(item, options));
  }
  if (val !== null && typeof val === "object") {
    const res = {};
    for (const [k, v] of Object.entries(val)) {
      const safeKey = typeof k === "string" ? redact(k, options) : k;
      res[safeKey] = redactValue(v, options);
    }
    return res;
  }
  return val;
}

/**
 * Helper to compute milestone status in a ledger.
 */
function computeMilestoneStatus(m, ledger) {
  const id = String(m?.id ?? "");
  const completed = new Set(ledger?.completed_milestones || []);
  const current = ledger?.current_milestone;
  const blockers = Array.isArray(ledger?.blockers) ? ledger.blockers : [];
  const verification = ledger?.verification || {};
  const ver = verification[id];

  if (completed.has(id)) {
    return "COMPLETED";
  }
  if (id === current) {
    return "ACTIVE";
  }
  if (blockers.some((b) => b?.affects_milestone === id)) {
    return "BLOCKED";
  }
  if (ver && ver.verdict === "NO-GO" && !ver.is_stale) {
    return "FAILED";
  }
  if (ver && ver.is_stale) {
    return "STALE";
  }
  if (Array.isArray(m?.dependencies) && m.dependencies.length > 0) {
    const allDone = m.dependencies.every((dep) => completed.has(dep));
    return allDone ? "READY" : "PENDING";
  }
  return "READY";
}

/**
 * Pure function: collects a redacted issue report summary from explicitly provided files.
 * Does NOT crawl or discover unnamed files.
 * Never includes candidate payloads, changes_made bodies, source file contents, or full transcripts.
 *
 * @param {object} params
 * @param {string} [params.ledgerPath]
 * @param {string} [params.planPath]
 * @param {string[]} [params.logPaths]
 * @param {string} [params.cwd=process.cwd()]
 * @returns {object}
 */
export function collectReport({ ledgerPath, planPath, logPaths, cwd = process.cwd() } = {}) {
  // Read NTG version from cwd/package.json if available
  let ntgVersion = null;
  try {
    const pkgPath = resolve(cwd, "package.json");
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      if (pkg && typeof pkg.version === "string") {
        ntgVersion = pkg.version;
      }
    }
  } catch {
    ntgVersion = null;
  }

  // Read ledger if provided
  let ledger = null;
  if (ledgerPath && typeof ledgerPath === "string") {
    try {
      const resolvedLedger = resolve(cwd, ledgerPath);
      if (existsSync(resolvedLedger)) {
        ledger = JSON.parse(readFileSync(resolvedLedger, "utf-8"));
      }
    } catch {
      ledger = null;
    }
  }

  // Milestones summary
  const milestones = (ledger?.milestones || []).map((m) => ({
    id: redact(String(m?.id ?? "")),
    title: redact(String(m?.title ?? m?.id ?? "")),
    status: computeMilestoneStatus(m, ledger),
  }));

  // Failure evidence (bounded to last 5 per milestone, max 10 total; no payloads or blobs)
  const failureEvidence = [];
  if (ledger?.evidence && typeof ledger.evidence === "object") {
    for (const [milestoneId, mEvidence] of Object.entries(ledger.evidence)) {
      if (!mEvidence || typeof mEvidence !== "object" || Array.isArray(mEvidence)) continue;
      const list = mEvidence.failure_evidence;
      if (Array.isArray(list) && list.length > 0) {
        const sliced = list.slice(-5);
        for (const entry of sliced) {
          if (!entry || typeof entry !== "object") continue;
          const failedStep = entry.evidence?.failed_step || entry.failed_step || null;
          let safeFailedStep = null;
          if (failedStep && typeof failedStep === "object") {
            safeFailedStep = {
              tool: failedStep.tool ? redact(String(failedStep.tool)) : null,
              args: failedStep.args ? redactValue(failedStep.args) : null,
              command: failedStep.command ? redact(String(failedStep.command)) : null,
            };
          }
          failureEvidence.push({
            milestone_id: redact(String(entry.milestone_id || milestoneId)),
            status: entry.status ? redact(String(entry.status)) : null,
            timestamp: entry.timestamp ?? null,
            failed_step: safeFailedStep,
            escalation_needs: entry.escalation_needs ? redact(String(entry.escalation_needs)) : null,
          });
        }
      }
    }
  }
  const boundedFailureEvidence = failureEvidence.slice(-10);

  // Verdicts summary
  const verdicts = [];
  if (ledger?.verification && typeof ledger.verification === "object") {
    for (const [mId, ver] of Object.entries(ledger.verification)) {
      if (!ver || typeof ver !== "object") continue;
      verdicts.push({
        milestone_id: redact(String(mId)),
        verdict: ver.verdict ? redact(String(ver.verdict)) : null,
        plan_version: ver.plan_version ?? null,
        is_stale: Boolean(ver.is_stale),
      });
    }
  }

  // Usage totals aggregated per role
  const usageTotals = {};
  if (ledger?.usage && typeof ledger.usage === "object") {
    for (const entries of Object.values(ledger.usage)) {
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        if (!entry || typeof entry !== "object") continue;
        const role = String(entry.role || "unknown");
        if (!usageTotals[role]) {
          usageTotals[role] = {
            duration_ms: 0,
            input_tokens: 0,
            output_tokens: 0,
            total_tokens: 0,
            entries: 0,
          };
        }
        usageTotals[role].entries += 1;
        if (typeof entry.duration_ms === "number" && !isNaN(entry.duration_ms) && entry.duration_ms >= 0) {
          usageTotals[role].duration_ms += entry.duration_ms;
        }
        if (entry.usage && typeof entry.usage === "object") {
          const inp = Number(entry.usage.input_tokens ?? entry.usage.prompt_tokens ?? 0) || 0;
          const out = Number(entry.usage.output_tokens ?? entry.usage.completion_tokens ?? 0) || 0;
          const tot = Number(entry.usage.total_tokens ?? (inp + out)) || 0;
          usageTotals[role].input_tokens += inp;
          usageTotals[role].output_tokens += out;
          usageTotals[role].total_tokens += tot;
        }
      }
    }
  }

  // Bounded summary of explicitly provided logPaths
  const logsSummary = [];
  if (Array.isArray(logPaths)) {
    for (const logPath of logPaths) {
      if (!logPath || typeof logPath !== "string") continue;
      try {
        const resolved = resolve(cwd, logPath);
        if (existsSync(resolved)) {
          const stat = statSync(resolved);
          const raw = readFileSync(resolved, "utf-8");
          const lines = raw.split("\n");
          const tailLines = lines.slice(-20).map((l) => redact(l));
          logsSummary.push({
            path: redact(logPath),
            size_bytes: stat.size,
            line_count: lines.length,
            tail: tailLines,
          });
        }
      } catch {
        // Skip unreadable files gracefully
      }
    }
  }

  // Bounded summary of explicitly provided planPath
  let planSummary = null;
  if (planPath && typeof planPath === "string") {
    try {
      const resolved = resolve(cwd, planPath);
      if (existsSync(resolved)) {
        const stat = statSync(resolved);
        const raw = readFileSync(resolved, "utf-8");
        const lines = raw.split("\n");
        const head = lines.slice(0, 50).map((l) => redact(l)).join("\n");
        planSummary = {
          path: redact(planPath),
          size_bytes: stat.size,
          line_count: lines.length,
          preview: head,
        };
      }
    } catch {
      planSummary = null;
    }
  }

  return {
    ntg_version: ntgVersion,
    node_version: process.version,
    platform: process.platform,
    plan_version: ledger?.plan_version ?? null,
    milestones,
    failure_evidence: boundedFailureEvidence,
    verdicts,
    usage_totals: usageTotals,
    logs_summary: logsSummary.length > 0 ? logsSummary : null,
    plan_summary: planSummary,
  };
}

/**
 * Pure function: formats a report object into Markdown issue title and body.
 * Ensures the body includes a redaction banner and contains no unredacted secret.
 *
 * @param {object} report
 * @returns {{ title: string, body: string }}
 */
export function renderIssue(report) {
  if (!report || typeof report !== "object") {
    return {
      title: "[Bug Report] Empty report",
      body: "> **Notice**: Sensitive data (tokens, credentials, emails, and home paths) has been automatically redacted.\n\n*No report data provided.*",
    };
  }

  const planVer = report.plan_version !== null && report.plan_version !== undefined
    ? `plan ${report.plan_version}`
    : "unversioned plan";
  const rawTitle = `[Bug Report] NTG Issue Report (${planVer})`;
  const title = redact(rawTitle);

  const sections = [];

  // Redaction Notice Banner
  sections.push(
    "> **Notice**: Sensitive data (API keys, tokens, credentials, email addresses, and absolute home directory paths) has been automatically redacted from this issue report."
  );

  // System Information
  sections.push(`### System Information
- **NTG Version**: ${report.ntg_version ?? "N/A"}
- **Node Version**: ${report.node_version ?? "unknown"}
- **Platform**: ${report.platform ?? "unknown"}
- **Plan Version**: ${report.plan_version ?? "N/A"}`);

  // Milestones
  if (Array.isArray(report.milestones) && report.milestones.length > 0) {
    const rows = report.milestones.map(
      (m) => `| ${m.id} | ${m.title} | ${m.status} |`
    );
    sections.push(`### Milestones
| Milestone ID | Title | Status |
| --- | --- | --- |
${rows.join("\n")}`);
  } else {
    sections.push(`### Milestones\n*No milestones recorded.*`);
  }

  // Verdicts
  if (Array.isArray(report.verdicts) && report.verdicts.length > 0) {
    const rows = report.verdicts.map(
      (v) => `| ${v.milestone_id} | ${v.verdict ?? "N/A"} | ${v.plan_version ?? "N/A"} | ${v.is_stale ? "Yes" : "No"} |`
    );
    sections.push(`### Verdicts
| Milestone ID | Verdict | Plan Version | Stale |
| --- | --- | --- | --- |
${rows.join("\n")}`);
  } else {
    sections.push(`### Verdicts\n*No verdicts recorded.*`);
  }

  // Failure Evidence
  if (Array.isArray(report.failure_evidence) && report.failure_evidence.length > 0) {
    const failureItems = report.failure_evidence.map((f) => {
      const lines = [
        `- **Milestone**: \`${f.milestone_id}\` | **Status**: \`${f.status ?? "UNKNOWN"}\`${f.timestamp ? ` | **Time**: ${f.timestamp}` : ""}`,
      ];
      if (f.failed_step) {
        if (f.failed_step.tool) lines.push(`  - **Tool**: \`${f.failed_step.tool}\``);
        if (f.failed_step.command) lines.push(`  - **Command**: \`${f.failed_step.command}\``);
        if (f.failed_step.args) lines.push(`  - **Args**: \`${JSON.stringify(f.failed_step.args)}\``);
      }
      if (f.escalation_needs) {
        lines.push(`  - **Escalation**: ${f.escalation_needs}`);
      }
      return lines.join("\n");
    });
    sections.push(`### Failure Evidence\n${failureItems.join("\n")}`);
  } else {
    sections.push(`### Failure Evidence\n*No failure evidence recorded.*`);
  }

  // Usage Totals
  if (report.usage_totals && typeof report.usage_totals === "object" && Object.keys(report.usage_totals).length > 0) {
    const rows = Object.entries(report.usage_totals).map(([role, u]) => {
      const durSec = (u.duration_ms / 1000).toFixed(2);
      return `| ${role} | ${u.entries} | ${durSec} | ${u.input_tokens} | ${u.output_tokens} | ${u.total_tokens} |`;
    });
    sections.push(`### Usage Totals
| Role | Invocations | Duration (s) | Input Tokens | Output Tokens | Total Tokens |
| --- | --- | --- | --- | --- | --- |
${rows.join("\n")}`);
  } else {
    sections.push(`### Usage Totals\n*No usage totals recorded.*`);
  }

  // Logs Summary
  if (Array.isArray(report.logs_summary) && report.logs_summary.length > 0) {
    const logItems = report.logs_summary.map((l) => {
      const tailPreview = l.tail && l.tail.length > 0 ? l.tail.join("\n") : "(empty)";
      return `#### Log: \`${l.path}\` (${l.line_count} lines, ${l.size_bytes} bytes)\n\`\`\`text\n${tailPreview}\n\`\`\``;
    });
    sections.push(`### Log Summaries\n${logItems.join("\n\n")}`);
  }

  // Plan Summary
  if (report.plan_summary) {
    sections.push(`### Plan Summary
**File**: \`${report.plan_summary.path}\` (${report.plan_summary.line_count} lines, ${report.plan_summary.size_bytes} bytes)
\`\`\`markdown
${report.plan_summary.preview}
\`\`\``);
  }

  const rawBody = sections.join("\n\n");
  const body = redact(rawBody);

  return { title, body };
}

/**
 * CLI interface for report-issue.
 *
 * @param {string[]} argv
 * @param {object} [options]
 * @param {string} [options.cwd=process.cwd()]
 * @param {NodeJS.ReadableStream} [options.stdin=process.stdin]
 * @param {NodeJS.WritableStream} [options.stdout=process.stdout]
 * @param {NodeJS.WritableStream} [options.stderr=process.stderr]
 * @param {boolean} [options.isTTY=process.stdin.isTTY]
 * @param {function} [options.prompt=null]
 * @param {function} [options.spawn=spawnSync]
 * @param {object} [options.env=process.env]
 * @returns {Promise<number>} Exit code
 */
export async function reportIssueCli(argv = [], options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const isTTY = options.isTTY !== undefined ? Boolean(options.isTTY) : Boolean(stdin?.isTTY);
  const prompt = options.prompt ?? null;
  const spawn = options.spawn ?? spawnSync;
  const env = options.env ?? process.env;

  let ledgerPath = null;
  const logPaths = [];
  let repo = "sleegme/native-gravity";
  let outArg = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--ledger" && i + 1 < argv.length) {
      ledgerPath = argv[++i];
    } else if (arg === "--log" && i + 1 < argv.length) {
      logPaths.push(argv[++i]);
    } else if (arg === "--repo" && i + 1 < argv.length) {
      repo = argv[++i];
    } else if (arg === "--out" && i + 1 < argv.length) {
      outArg = argv[++i];
    }
  }

  if (!ledgerPath) {
    stderr.write("Usage: ntg-report-issue --ledger <path> [--log <path> ...] [--repo <owner/name>] [--out <file>]\n");
    return 1;
  }

  const outPath = outArg ? resolve(cwd, outArg) : resolve(cwd, "issue-preview.md");

  const report = collectReport({ ledgerPath, logPaths, cwd });
  const { title, body } = renderIssue(report);

  writeFileSync(outPath, body, "utf8");
  stdout.write(body + "\n");

  const manualCommand = `gh issue create --repo ${repo} --title "${title}" --body-file ${outPath}`;

  if (!isTTY) {
    stdout.write(`Non-interactive session: issue not submitted automatically.\nTo submit manually, run:\n  ${manualCommand}\n`);
    return 0;
  }

  let answer = "";
  const promptMessage = "Submit this issue to GitHub? Type 'yes' to confirm: ";
  if (typeof prompt === "function") {
    answer = await prompt(promptMessage);
  } else {
    const rl = createInterface({ input: stdin, output: stdout });
    answer = await new Promise((res) => {
      rl.question(promptMessage, (ans) => {
        rl.close();
        res(ans);
      });
    });
  }

  if (typeof answer === "string" && answer.trim() === "yes") {
    let res;
    try {
      res = spawn(
        "gh",
        ["issue", "create", "--repo", repo, "--title", title, "--body-file", outPath],
        { stdio: "inherit" }
      );
    } catch (err) {
      res = { error: err };
    }

    if (res?.error?.code === "ENOENT") {
      stderr.write(
        `gh: command not found.\nTo submit manually, run:\n  ${manualCommand}\nOr open in browser:\n  https://github.com/${repo}/issues/new\n`
      );
      return 1;
    }
    if (res?.status != null && res.status !== 0) {
      return res.status;
    }
    return 0;
  } else {
    stdout.write("Submission aborted.\n");
    return 0;
  }
}

function invokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  reportIssueCli(process.argv.slice(2)).then((code) => {
    process.exitCode = Number.isInteger(code) ? code : 0;
  }, (error) => {
    process.stderr.write(`ntg-report-issue: ${error?.message ?? error}\n`);
    process.exitCode = 1;
  });
}


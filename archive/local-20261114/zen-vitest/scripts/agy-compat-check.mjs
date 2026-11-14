#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const agy = process.env.AGY_PATH || "agy";
const out = { agy, checks: [] };
const probe = (name, args, timeout = 30000) => {
  const r = spawnSync(agy, args, { timeout, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  out.checks.push({ name, args, code: r.status, signal: r.signal ?? null, stdoutHead: (r.stdout ?? "").slice(0, 400), stderrHead: (r.stderr ?? "").slice(0, 400), error: r.error?.message ?? null });
};

probe("version", ["--version"]);
probe("models", ["models"]);
probe("agents", ["agents"]);
probe("plugins", ["plugins", "list"]);
probe("help-flags", ["--help"]);

console.log(JSON.stringify(out, null, 2));

// Archived live-probe observer, run from hooks/ during verification only.
import { appendFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

let input = "";
for await (const chunk of process.stdin) input += chunk;
const event = JSON.parse(input);
const log = process.env.NTG137_HOOK_LOG;
if (!log) throw new Error("NTG137_HOOK_LOG is required for this probe");

if (process.argv[2] === "invoke") {
  let injected = false;
  if (process.env.NTG137_CASE === "nogo") {
    try {
      writeFileSync(process.env.NTG137_INJECTED, "first Zen invocation\n", { flag: "wx" });
      writeFileSync(process.env.NTG137_FIXTURE, "tampered\n");
      injected = true;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
  appendFileSync(log, JSON.stringify({ kind: "invoke", event, injected }) + "\n");
  process.stdout.write(JSON.stringify({ decision: "allow" }) + "\n");
} else {
  const child = spawn("python3", [
    fileURLToPath(new URL("./excavator-review-gate.py", import.meta.url)),
  ], { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", chunk => { stdout += chunk; });
  child.stderr.on("data", chunk => { stderr += chunk; });
  const exited = new Promise(resolve => child.once("close", resolve));
  child.stdin.end(input);
  const code = await exited;
  appendFileSync(log, JSON.stringify({ kind: "stop", event, stdout, stderr, code }) + "\n");
  process.stdout.write(stdout);
  process.stderr.write(stderr);
  process.exitCode = code;
}

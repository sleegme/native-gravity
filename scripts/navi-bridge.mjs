import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

/**
 * Stdio proxy for the desktop MCP server. AGY probes every stdio server with a
 * custom `server/discover` request before the standard MCP handshake; some
 * servers, including the desktop server, treat that as fatal and exit before
 * `initialize`. This bridge answers the probe exactly as a standard server
 * would (JSON-RPC method not found) and forwards every other message verbatim
 * in both directions. It never inspects arguments or results.
 *
 * Shutdown is bounded: on stdin close (AGY went away) or on SIGTERM/SIGINT to
 * the bridge, the server gets SIGTERM, then SIGKILL when it is still alive
 * after 3 s; the bridge reaps it and exits with its status.
 *
 * Usage: node navi-bridge.mjs <server-command> [server-args...]
 */
const [, , server, ...serverArgs] = process.argv;
const child = spawn(server, serverArgs, { stdio: ["pipe", "pipe", "inherit"] });
const requests = createInterface({ input: process.stdin, crlfDelay: Infinity });
requests.on("line", (line) => {
  let message = null;
  try {
    message = JSON.parse(line);
  } catch {
    // Forward non-JSON lines unchanged; the server decides what to do with them.
  }
  if (message && message.method === "server/discover") {
    const id = message.id === undefined ? null : message.id;
    process.stdout.write(
      `${JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found: server/discover" } })}\n`,
    );
    return;
  }
  child.stdin.write(`${line}\n`);
});
createInterface({ input: child.stdout, crlfDelay: Infinity })
  .on("line", (line) => process.stdout.write(`${line}\n`));

// Bounded shutdown: SIGTERM the server, escalate to SIGKILL when it is still
// alive after the grace period, then reap it (await its exit) and exit with
// its status. Triggers: AGY closes the bridge's stdin, or the bridge itself
// receives SIGTERM/SIGINT.
const SHUTDOWN_GRACE_MS = 3000;
let shuttingDown = false;
let escalateTimer = null;

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  escalateTimer = setTimeout(() => child.kill("SIGKILL"), SHUTDOWN_GRACE_MS);
  child.kill("SIGTERM");
}

child.on("exit", (code, signal) => {
  if (escalateTimer) clearTimeout(escalateTimer);
  process.exit(signal ? 1 : (code ?? 0));
});
process.stdin.on("close", shutdown);
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

import { spawnSync } from "node:child_process";
import { accessSync, constants, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Owner session variables the desktop server needs inside the sandbox. */
const DESKTOP_ENV = ["WAYLAND_DISPLAY", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS"];

/**
 * AGY probes stdio servers with a custom `server/discover` request before the
 * standard handshake; the desktop server exits on it. The bridge answers that
 * probe and forwards everything else unchanged, so the registration points at
 * node + bridge + server instead of the raw server binary.
 */
const BRIDGE = fileURLToPath(new URL("./navi-bridge.mjs", import.meta.url));

/**
 * Runs `run(env, prefix)` with a private per-process HOME that registers only
 * the desktop MCP server `cu`. The temp root is removed in all outcomes; the
 * owner's credential is exposed read-only through a symlink plus a bubblewrap
 * read-only bind so the child can authenticate without writing it. Errors
 * never carry configuration output, credential contents or owner paths.
 */
export function withNaviHome(opts, run) {
  const source = { ...process.env, ...(opts.env || {}) };
  for (const key of DESKTOP_ENV) {
    if (!source[key]) {
      throw Object.assign(new Error("Desktop environment is incomplete"), {
        code: "NAVI_ENV_MISSING", variable: key,
      });
    }
  }
  const owner = source.HOME || homedir();
  const ownerData = join(owner, ".gemini", "antigravity-cli");
  const credential = join(ownerData, "antigravity-oauth-token");
  const server = join(owner, ".local", "bin", "computer-use-linux");
  try {
    accessSync(credential, constants.R_OK);
  } catch {
    throw Object.assign(new Error("Desktop credential is unavailable"), {
      code: "NAVI_CREDENTIAL_MISSING",
    });
  }
  try {
    accessSync(server, constants.X_OK);
  } catch {
    throw Object.assign(new Error("Desktop server is unavailable"), {
      code: "NAVI_SERVER_MISSING",
    });
  }
  const root = mkdtempSync(join(tmpdir(), "ntg-navi-"));
  try {
    const data = join(root, ".gemini", "antigravity-cli");
    mkdirSync(data, { recursive: true });
    symlinkSync(credential, join(data, "antigravity-oauth-token"));
    // Keep normal conversation evidence, not private config or auth, in AGY's
    // existing store so the invocation remains inspectable after cleanup.
    for (const directory of ["conversations", "brain"]) {
      mkdirSync(join(ownerData, directory), { recursive: true });
      symlinkSync(join(ownerData, directory), join(data, directory));
    }
    const env = { ...source, HOME: root, AGY_CLI_DISABLE_AUTO_UPDATE: "1" };
    const args = ["mcp", "add"];
    for (const key of DESKTOP_ENV) {
      args.push("--env", `${key}=${source[key]}`);
    }
    args.push("cu", process.execPath, BRIDGE, server, "mcp");
    const registration = spawnSync(opts.agyPath || process.env.AGY_PATH || "agy", args, {
      env, encoding: "utf-8", timeout: Math.min(opts.timeout ?? 120000, 30000),
      killSignal: "SIGKILL", maxBuffer: 1024 * 1024,
    });
    if (registration.error || registration.status !== 0) {
      throw Object.assign(new Error("Private MCP registration failed"), {
        code: "NAVI_MCP_CONFIG_FAILED",
      });
    }
    return run(env, [
      "--bind", "/", "/", "--dev-bind", "/dev", "/dev",
      "--ro-bind", credential, credential, "--die-with-parent", "--",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

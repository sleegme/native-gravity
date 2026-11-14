import { spawnSync } from "node:child_process";
import { accessSync, constants, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
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
const WINDOWS_JOB = fileURLToPath(new URL("./navi-validation/windows-job.ps1", import.meta.url));
// Detach the supervisor from the owner's lifetime without detaching PowerShell
// from its stdio handles (Windows PowerShell otherwise exits silently).
const WINDOWS_RELAY = `
const child = require("node:child_process").spawn("powershell.exe", process.argv.slice(1),
  { stdio: "inherit", windowsHide: true,
    env: { ...process.env, NTG_NAVI_RELAY_PID: String(process.pid) } });
if (child.pid) require("node:fs").writeFileSync(require("node:path").join(
  require("node:path").dirname(process.argv[process.argv.indexOf("-RequestFile") + 1]),
  ".job-supervisor.pid"), String(child.pid));
child.once("error", () => process.exit(1));
child.once("exit", code => process.exit(code === null ? 1 : code));
`;

function windowsExecutable(command, source, cwd) {
  const forbidden = resolve(source.USERPROFILE || homedir(), ".gemini").toLowerCase();
  const candidates = isAbsolute(command) || /[\\/]/.test(command)
    ? [resolve(cwd, command)]
    : (source.Path || source.PATH || "").split(";").filter(Boolean)
      .map(directory => join(directory, command.endsWith(".exe") ? command : `${command}.exe`));
  return candidates.find(candidate => {
    const full = resolve(candidate).toLowerCase();
    if (full === forbidden || full.startsWith(`${forbidden}\\`)) return false;
    try { return statSync(candidate).isFile(); } catch { return false; }
  });
}

function withWindowsNaviHome(opts, run) {
  const source = { ...process.env, ...(opts.env || {}) };
  const cwd = resolve(opts.cwd || process.cwd());
  // Resolve against the original environment, never the overridden profile.
  const requested = opts.agyPath || source.AGY_PATH;
  const agyPath = requested
    ? windowsExecutable(requested, source, cwd)
    : windowsExecutable(join(source.USERPROFILE || homedir(), "AppData", "Local", "agy", "bin", "agy.exe"), source, cwd)
      || windowsExecutable("agy", source, cwd);
  const backend = windowsExecutable(opts.windowsBackend || source.NTG_NAVI_WINDOWS_BACKEND || "windows-mcp.exe", source, cwd);
  if (!agyPath || !backend) {
    throw Object.assign(new Error("Windows Navi executable is unavailable"), {
      code: !agyPath ? "NAVI_AGY_MISSING" : "NAVI_SERVER_MISSING",
    });
  }
  const root = mkdtempSync(join(tmpdir(), "ntg-navi-"));
  try {
    const config = join(root, ".gemini", "config");
    mkdirSync(config, { recursive: true });
    writeFileSync(join(config, "mcp_config.json"), JSON.stringify({
      mcpServers: {
        cu: {
          command: process.execPath,
          args: [BRIDGE, "--windows", backend, ...(opts.windowsBackendArgs || [
            "serve", "--transport", "stdio", "--tools", "Snapshot,Screenshot,Click,Type,Scroll,Move,Shortcut,WaitFor",
          ])],
          env: { ANONYMIZED_TELEMETRY: "false", PYTHONIOENCODING: "utf-8" },
        },
      },
    }), { flag: "wx" });
    const env = { ...source, USERPROFILE: root, HOME: root, AGY_CLI_DISABLE_AUTO_UPDATE: "1" };
    const jobSpawn = (executable, args, options) => {
      if (opts.signal?.aborted) {
        return { status: 130, stdout: "", stderr: "" };
      }
      const requestFile = join(root, ".job-request.json");
      writeFileSync(requestFile, JSON.stringify({
        executable, arguments: args, cwd: options.cwd || cwd,
        timeout: options.timeout || 90000, parentPid: process.pid,
        cleanupDirectory: root, propagateExitCode: true,
      }));
      const result = spawnSync(process.execPath, ["-e", WINDOWS_RELAY, "--",
        "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
        "-File", WINDOWS_JOB, "-RequestFile", requestFile,
      ], {
        ...options, env: options.env || env, windowsHide: true, detached: true,
        timeout: (options.timeout || 90000) + 30000,
      });
      // spawnSync may kill the relay on output overflow. The native supervisor
      // also watches that relay; await its cleanup before touching the profile.
      if (result.error) {
        let pid;
        try {
          pid = Number(readFileSync(join(root, ".job-supervisor.pid"), "utf8"));
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
        if (Number.isSafeInteger(pid) && pid > 0) {
          const wait = `try {$p=[Diagnostics.Process]::GetProcessById(${pid})} catch {exit 0}; if($p.WaitForExit(15000)){exit 0}else{exit 1}`;
          const finished = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand",
            Buffer.from(wait, "utf16le").toString("base64")], { windowsHide: true, timeout: 20000 });
          if (finished.status !== 0) {
            throw Object.assign(new Error("Windows cleanup was not confirmed"), { code: "NAVI_CLEANUP_UNVERIFIED" });
          }
        }
      }
      if (!/^NAVI_JOB_CLEANUP_PASS\r?$/m.test(result.stderr || "")) {
        return { status: null, stdout: "", stderr: "",
          error: Object.assign(new Error("Windows Navi supervision failed"), { code: "NAVI_JOB_FAILED" }) };
      }
      if (result.status === 124) {
        result.error = Object.assign(new Error("Windows Navi timed out"), { code: "ETIMEDOUT" });
      }
      return result;
    };
    return run(env, [], { agyPath, spawn: jobSpawn });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/**
 * Runs `run(env, prefix)` with a private per-process HOME that registers only
 * the desktop MCP server `cu`. The temp root is removed in all outcomes; the
 * owner's credential is exposed read-only through a symlink plus a bubblewrap
 * read-only bind so the child can authenticate without writing it. Errors
 * never carry configuration output, credential contents or owner paths.
 */
export function withNaviHome(opts, run) {
  if (process.platform === "win32") return withWindowsNaviHome(opts, run);
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

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const bridge = fileURLToPath(new URL('../navi-bridge.mjs', import.meta.url));
const desktopTools = new Set(['Snapshot', 'Screenshot', 'Click', 'Type', 'Scroll', 'Move', 'Shortcut', 'WaitFor']);

// This client never starts AGY or reads credentials. Native findings are
// deliberately separate from the production Navi authentication gate.
export async function probe({ backend, backendArgs = [], steps = [], timeout = 30000 }) {
  if (!backend || !Array.isArray(backendArgs) || !backendArgs.every(arg => typeof arg === 'string')) {
    throw new Error('INVALID_BACKEND');
  }
  if (!Array.isArray(steps) || steps.some(step => !desktopTools.has(step.name)
    || !step.arguments || typeof step.arguments !== 'object' || Array.isArray(step.arguments))) {
    throw new Error('INVALID_DESKTOP_STEPS');
  }
  const child = spawn(process.execPath, [bridge, '--windows', backend, ...backendArgs], {
    stdio: ['pipe', 'pipe', 'ignore'], detached: process.platform !== 'win32',
    env: { ...process.env, ANONYMIZED_TELEMETRY: 'false', PYTHONIOENCODING: 'utf-8' },
  });
  let nextId = 0;
  let closed = false;
  const pending = new Map();
  const rejectPending = code => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error(code));
    }
    pending.clear();
  };
  const exited = new Promise(resolveExit => {
    child.once('error', () => { closed = true; rejectPending('BACKEND_SPAWN_FAILED'); resolveExit(); });
    child.once('close', () => { closed = true; rejectPending('BACKEND_EXITED'); resolveExit(); });
  });
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  lines.on('line', line => {
    let message;
    try { message = JSON.parse(line); } catch { rejectPending('INVALID_MCP_JSON'); return; }
    const entry = pending.get(message.id);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(message.id);
    if (message.error) entry.reject(new Error('MCP_REQUEST_REJECTED'));
    else entry.resolve(message.result);
  });
  child.stdin.on('error', () => rejectPending('BACKEND_PIPE_CLOSED'));
  const request = (method, params = {}) => new Promise((resolveRequest, reject) => {
    if (closed) { reject(new Error('BACKEND_EXITED')); return; }
    const id = ++nextId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('MCP_TIMEOUT'));
    }, timeout);
    pending.set(id, { resolve: resolveRequest, reject, timer });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  const report = {
    schema_version: 1, scope: 'backend_protocol_probe', platform: process.platform, node: process.version,
    production_windows_support: 'PENDING',
    checks: [], tools: [], steps: [],
    native_pending: ['AGY private authentication and keyring fallback', 'credential original-path protection',
      'production Navi invocation and confirmation', 'packaged Windows installation'],
  };
  try {
    try {
      await request('server/discover');
      throw new Error('INVALID_DISCOVERY_RESPONSE');
    } catch (error) {
      if (error.message !== 'MCP_REQUEST_REJECTED') throw error;
      report.checks.push({ name: 'discovery', status: 'PASS' });
    }
    const init = await request('initialize', {
      protocolVersion: '2024-11-05', capabilities: {},
      clientInfo: { name: 'ntg-navi-validation', version: '1' },
    });
    if (!init?.serverInfo || !init?.protocolVersion) throw new Error('INVALID_INITIALIZE_RESPONSE');
    report.backend = { name: init.serverInfo.name, version: init.serverInfo.version };
    report.checks.push({ name: 'initialize', status: 'PASS' });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    const list = await request('tools/list');
    if (!Array.isArray(list?.tools) || list.tools.length === 0) throw new Error('NO_DESKTOP_TOOLS');
    report.tools = list.tools.map(tool => ({ name: tool.name, inputSchema: tool.inputSchema }));
    if (report.tools.some(tool => !desktopTools.has(tool.name))) throw new Error('TOOL_BOUNDARY_FAILED');
    report.checks.push({ name: 'filtered_tools', status: 'PASS' });
    try {
      await request('tools/call', { name: 'PowerShell', arguments: {} });
      throw new Error('TOOL_BOUNDARY_FAILED');
    } catch (error) {
      if (error.message !== 'MCP_REQUEST_REJECTED') throw error;
      report.checks.push({ name: 'blocked_direct_call', status: 'PASS' });
    }
    for (const step of steps) {
      if (!report.tools.some(tool => tool.name === step.name)) throw new Error('REQUIRED_TOOL_MISSING');
      const result = await request('tools/call', step);
      const images = result?.content?.filter(item => item.type === 'image').length ?? 0;
      report.steps.push({ name: step.name, status: result?.isError ? 'FAIL' : 'RETURNED', images,
        outcome_verified: false });
      // Tool content can contain screenshots, desktop text and private paths.
      // Never copy it to the return-to-owner artifact.
      if (result?.isError) throw new Error('DESKTOP_TOOL_FAILED');
    }
    report.status = 'PASS';
  } catch (error) {
    report.status = 'FAIL';
    report.error = error.message;
  } finally {
    child.stdin.end();
    let shutdown;
    await Promise.race([exited, new Promise(resolveGrace => {
      shutdown = setTimeout(resolveGrace, 5000);
    })]);
    clearTimeout(shutdown);
    if (!closed) {
      if (process.platform === 'win32') {
        await new Promise(resolveKill => {
          const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
          killer.once('error', resolveKill);
          killer.once('close', resolveKill);
        });
      } else {
        try { process.kill(-child.pid, 'SIGKILL'); } catch (error) {
          if (error.code !== 'ESRCH') throw error;
        }
      }
      let deadline;
      await Promise.race([exited, new Promise(resolveDeadline => {
        deadline = setTimeout(resolveDeadline, 5000);
      })]);
      clearTimeout(deadline);
      if (!closed) { child.unref(); child.stdout.destroy(); child.stdin.destroy(); }
    }
    lines.close();
    rejectPending('PROBE_CLOSED');
    report.checks.push({ name: 'bridge_exit', status: closed ? 'PASS' : 'FAIL' });
    if (!closed) { report.status = 'FAIL'; report.error = 'CLEANUP_UNVERIFIED'; }
  }
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = name => {
    const index = args.indexOf(name);
    return index === -1 ? undefined : args[index + 1];
  };
  const output = value('--output') ?? 'navi-backend-result.json';
  try {
    const steps = value('--steps') ? JSON.parse(readFileSync(value('--steps'), 'utf8')) : [];
    const report = await probe({
      backend: value('--backend'),
      backendArgs: value('--backend-args') ? JSON.parse(value('--backend-args')) : ['serve', '--transport', 'stdio',
        '--tools', [...desktopTools].join(',')],
      steps,
    });
    writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    console.log(`NAVI_BACKEND_${report.status}`);
    process.exitCode = report.status === 'PASS' ? 0 : 1;
  } catch {
    console.error('NAVI_BACKEND_SETUP_FAILED');
    process.exitCode = 1;
  }
}

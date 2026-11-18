import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

export class LedgerLockedError extends Error {
  constructor(lockPath, message) {
    super(message || `${lockPath} already exists; verify its owner before stale-lock recovery`);
    this.name = 'LedgerLockedError';
    this.code = 'LEDGER_LOCKED';
    this.lockPath = lockPath;
  }
}

/**
 * The durable ledger was removed or taken over during an invocation.
 * Fail closed: never silently recreate the ledger or continue the run.
 */
export class LedgerIntegrityError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'LedgerIntegrityError';
    this.code = 'LEDGER_INTEGRITY';
    Object.assign(this, details);
  }
}

/** In-process map of lockPath -> ownerToken acquired by this process (#201 A2). */
const activeLockTokens = new Map();

/**
 * Parses lock file content (`<pid>\n[token:<ownerToken>\n]`).
 */
export function parseLockFileContent(raw) {
  const lines = String(raw ?? '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const pid = lines.length > 0 ? Number(lines[0]) : NaN;
  const tokenLine = lines.find(l => l.startsWith('token:'));
  const token = tokenLine ? tokenLine.slice('token:'.length).trim() : null;
  return { pid, token: token || null };
}

function defaultIsProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (err.code === 'ESRCH') return false;
    return true;
  }
}

/**
 * Verifies, after a runner, worker or Zen invocation returns and before the
 * supervisor next saves or acts on the ledger, that the invocation did not
 * remove or take over the durable ledger: the lock file must still exist,
 * record this process as owner (PID and owner token when tracked), and
 * ledger.json must still exist.
 */
export function verifyLedgerIntegrity(ledgerPath, { role = null, milestoneId = null, invocationError, expectedToken } = {}) {
  const path = resolve(ledgerPath);
  const where = role ? ` (after ${role} invocation${milestoneId ? ` for milestone ${milestoneId}` : ''})` : '';
  const details = { ledgerPath: path, lockPath: `${path}.lock`, role, milestoneId };
  if (invocationError !== undefined) details.invocationError = invocationError;
  let dir;
  try {
    dir = realpathSync(dirname(path));
  } catch {
    throw new LedgerIntegrityError(
      `ledger integrity violated: ${details.lockPath} was removed during execution${where}`, details);
  }
  const lockPath = join(dir, `${basename(path)}.lock`);
  details.lockPath = lockPath;
  if (!existsSync(lockPath)) {
    throw new LedgerIntegrityError(
      `ledger integrity violated: ${lockPath} was removed during execution${where}`, details);
  }
  let parsed;
  try {
    parsed = parseLockFileContent(readFileSync(lockPath, 'utf8'));
  } catch (error) {
    throw new LedgerIntegrityError(
      `ledger integrity violated: ${lockPath} owner PID is unreadable (${error.code ?? error.message})${where}`,
      details);
  }
  const owner = parsed.pid;
  if (!Number.isInteger(owner) || owner !== process.pid) {
    throw new LedgerIntegrityError(
      `ledger integrity violated: ${lockPath} is owned by ${Number.isInteger(owner) ? `pid ${owner}` : `unparseable owner`}, not this process (pid ${process.pid})${where}`,
      details);
  }
  const trackedToken = expectedToken ?? activeLockTokens.get(lockPath);
  if (trackedToken && parsed.token !== trackedToken) {
    throw new LedgerIntegrityError(
      `ledger integrity violated: ${lockPath} owner token mismatch during execution${where}`,
      details);
  }
  if (!existsSync(path)) {
    throw new LedgerIntegrityError(
      `ledger integrity violated: ${path} was removed during execution${where}`, details);
  }
}

/**
 * Recovers a stale lock only after verifying the caller's expected owner token
 * against the lock file and confirming the owning PID is no longer alive (#201 A2).
 */
export function recoverStaleLock(ledgerPath, { expectedToken, isProcessAlive = defaultIsProcessAlive } = {}) {
  const path = resolve(ledgerPath);
  let dir;
  try {
    dir = realpathSync(dirname(path));
  } catch {
    return { recovered: false, reason: 'NO_DIR' };
  }
  const lockPath = join(dir, `${basename(path)}.lock`);
  if (!existsSync(lockPath)) {
    return { recovered: false, reason: 'NO_LOCK', lockPath };
  }
  const parsed = parseLockFileContent(readFileSync(lockPath, 'utf8'));
  if (!expectedToken || typeof expectedToken !== 'string' || !parsed.token || parsed.token !== expectedToken) {
    throw new LedgerLockedError(
      lockPath,
      `${lockPath} owner-token verification failed; refusing stale-lock recovery`
    );
  }
  if (Number.isInteger(parsed.pid) && isProcessAlive(parsed.pid)) {
    throw new LedgerLockedError(
      lockPath,
      `${lockPath} owner process pid ${parsed.pid} is still alive; refusing stale-lock recovery`
    );
  }
  try {
    unlinkSync(lockPath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  activeLockTokens.delete(lockPath);
  return {
    recovered: true,
    stalePid: parsed.pid,
    ownerToken: parsed.token,
    lockPath,
  };
}

/** Hold a ledger's lock across the entire read/modify/write session. */
export function acquireLedgerLock(ledgerPath, { handleSignals = true, ownerToken } = {}) {
  const path = resolve(ledgerPath);
  mkdirSync(dirname(path), { recursive: true });
  const lockPath = join(realpathSync(dirname(path)), `${basename(path)}.lock`);
  const token = ownerToken || randomUUID();
  let fd;
  try {
    fd = openSync(lockPath, 'wx', 0o600);
  } catch (error) {
    if (error.code === 'EEXIST') throw new LedgerLockedError(lockPath);
    throw error;
  }
  try {
    writeFileSync(fd, `${process.pid}\ntoken:${token}\n`, 'utf8');
  } catch (error) {
    unlinkSync(lockPath);
    throw error;
  } finally {
    closeSync(fd);
  }
  activeLockTokens.set(lockPath, token);

  let released = false;
  const onInterrupt = () => process.exit(130);
  const onTerminate = () => process.exit(143);
  const onHangup = () => process.exit(129);
  const release = () => {
    if (released) return;
    try {
      unlinkSync(lockPath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    activeLockTokens.delete(lockPath);
    released = true;
    process.removeListener('exit', release);
    process.removeListener('SIGINT', onInterrupt);
    process.removeListener('SIGTERM', onTerminate);
    process.removeListener('SIGHUP', onHangup);
  };
  release.ownerToken = token;
  release.lockPath = lockPath;

  process.once('exit', release);
  if (handleSignals) {
    process.once('SIGINT', onInterrupt);
    process.once('SIGTERM', onTerminate);
    process.once('SIGHUP', onHangup);
  }
  return release;
}

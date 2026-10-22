import { closeSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

export class LedgerLockedError extends Error {
  constructor(lockPath) {
    super(`${lockPath} already exists; verify its owner before stale-lock recovery`);
    this.name = 'LedgerLockedError';
    this.code = 'LEDGER_LOCKED';
    this.lockPath = lockPath;
  }
}

/**
 * The durable ledger was removed or taken over during an invocation
 * (incident WQ-5: a worker deleted the live .ntg/ directory mid-run and the
 * supervisor silently re-wrote ledger.json from memory). Fail closed:
 * never silently recreate the ledger or continue the run.
 */
export class LedgerIntegrityError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'LedgerIntegrityError';
    this.code = 'LEDGER_INTEGRITY';
    Object.assign(this, details);
  }
}

/**
 * Verifies, after a runner, worker or Zen invocation returns and before the
 * supervisor next saves or acts on the ledger, that the invocation did not
 * remove or take over the durable ledger: the lock file must still exist and
 * still record this process as owner, and ledger.json must still exist.
 * Throws LedgerIntegrityError naming the affected file and the invocation
 * (role and milestone) otherwise.
 */
export function verifyLedgerIntegrity(ledgerPath, { role = null, milestoneId = null, invocationError } = {}) {
  const path = resolve(ledgerPath);
  const where = role ? ` (after ${role} invocation${milestoneId ? ` for milestone ${milestoneId}` : ''})` : '';
  const details = { ledgerPath: path, lockPath: `${path}.lock`, role, milestoneId };
  if (invocationError !== undefined) details.invocationError = invocationError;
  let dir;
  try {
    dir = realpathSync(dirname(path));
  } catch {
    // The ledger directory itself is gone, so lock and ledger are both gone.
    throw new LedgerIntegrityError(
      `ledger integrity violated: ${details.lockPath} was removed during execution${where}`, details);
  }
  const lockPath = join(dir, `${basename(path)}.lock`);
  details.lockPath = lockPath;
  if (!existsSync(lockPath)) {
    throw new LedgerIntegrityError(
      `ledger integrity violated: ${lockPath} was removed during execution${where}`, details);
  }
  let owner;
  try {
    owner = Number(readFileSync(lockPath, 'utf8').trim());
  } catch (error) {
    throw new LedgerIntegrityError(
      `ledger integrity violated: ${lockPath} owner PID is unreadable (${error.code ?? error.message})${where}`,
      details);
  }
  if (!Number.isInteger(owner) || owner !== process.pid) {
    throw new LedgerIntegrityError(
      `ledger integrity violated: ${lockPath} is owned by ${Number.isInteger(owner) ? `pid ${owner}` : `unparseable owner`}, not this process (pid ${process.pid})${where}`,
      details);
  }
  if (!existsSync(path)) {
    throw new LedgerIntegrityError(
      `ledger integrity violated: ${path} was removed during execution${where}`, details);
  }
}

/** Hold a ledger's lock across the entire read/modify/write session. */
export function acquireLedgerLock(ledgerPath, { handleSignals = true } = {}) {
  const path = resolve(ledgerPath);
  mkdirSync(dirname(path), { recursive: true });
  const lockPath = join(realpathSync(dirname(path)), `${basename(path)}.lock`);
  let fd;
  try {
    fd = openSync(lockPath, 'wx', 0o600);
  } catch (error) {
    if (error.code === 'EEXIST') throw new LedgerLockedError(lockPath);
    throw error;
  }
  try {
    writeFileSync(fd, `${process.pid}\n`, 'utf8');
  } catch (error) {
    unlinkSync(lockPath);
    throw error;
  } finally {
    closeSync(fd);
  }

  let released = false;
  const onInterrupt = () => process.exit(130);
  const onTerminate = () => process.exit(143);
  const onHangup = () => process.exit(129);
  const release = () => {
    if (released) return;
    try {
      unlinkSync(lockPath);
    } catch (error) {
      // An external actor may already have removed the lock (incident WQ-5
      // deleted the whole ledger directory mid-run): a vanished lock is
      // already released. Every other unlink failure still propagates; the
      // removal itself is reported by verifyLedgerIntegrity, not here.
      if (error.code !== 'ENOENT') throw error;
    }
    released = true;
    process.removeListener('exit', release);
    process.removeListener('SIGINT', onInterrupt);
    process.removeListener('SIGTERM', onTerminate);
    process.removeListener('SIGHUP', onHangup);
  };
  process.once('exit', release);
  if (handleSignals) {
    process.once('SIGINT', onInterrupt);
    process.once('SIGTERM', onTerminate);
    process.once('SIGHUP', onHangup);
  }
  return release;
}

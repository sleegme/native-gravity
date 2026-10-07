import { closeSync, mkdirSync, openSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

export class LedgerLockedError extends Error {
  constructor(lockPath) {
    super(`${lockPath} already exists; verify its owner before stale-lock recovery`);
    this.name = 'LedgerLockedError';
    this.code = 'LEDGER_LOCKED';
    this.lockPath = lockPath;
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
    unlinkSync(lockPath);
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

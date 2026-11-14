import fs from 'node:fs';
import path from 'node:path';
import { redactTelemetryValue } from './telemetry.mjs';

/**
 * Checks whether an event name indicates an end event.
 *
 * @param {string} event
 * @returns {boolean}
 */
function isEndEvent(event) {
  return typeof event === 'string' && /(?:^|[_\-:.])end$/i.test(event);
}

/**
 * Creates an event object with exact allowed schema. Drops unknown/extra fields.
 *
 * @param {object} [fields]
 * @param {string} [fields.role]
 * @param {string} [fields.milestone]
 * @param {string} [fields.event]
 * @param {string} [fields.status]
 * @param {number} [fields.durationMs]
 * @param {number} [fields.duration_ms]
 * @param {string} [fields.ts]
 * @returns {object}
 */
export function makeEvent({ role, milestone, event, status, durationMs, duration_ms, ts } = {}) {
  const isEnd = isEndEvent(event);
  const out = {
    ts: ts ?? new Date().toISOString(),
    role: role ?? null,
    milestone: milestone ?? null,
    event: event ?? null,
  };
  if (isEnd) {
    out.status = status ?? null;
    out.duration_ms = durationMs ?? duration_ms ?? null;
  }
  return out;
}

/**
 * Serializes an event object to a single-line JSON string ending in exactly one newline.
 *
 * @param {object} obj
 * @returns {string}
 */
export function serializeEvent(obj) {
  return JSON.stringify(obj) + '\n';
}

/**
 * Creates an event log manager for a given directory.
 *
 * @param {object} options
 * @param {string} options.dir
 * @param {Function} [options.redact]
 * @returns {{ append: (obj: object) => Promise<void> }}
 */
export function createEventLog({ dir, redact = redactTelemetryValue } = {}) {
  const filePath = path.join(dir, 'events.jsonl');
  let writeQueue = Promise.resolve();

  async function append(obj) {
    const redacted = typeof redact === 'function' ? redact(obj) : obj;
    const line = serializeEvent(redacted);

    writeQueue = writeQueue
      .then(async () => {
        try {
          await fs.promises.appendFile(filePath, line, 'utf8');
        } catch (err) {
          const code = err?.code || err?.message || String(err);
          console.error(`events.jsonl append failed: ${code}`);
        }
      })
      .catch((err) => {
        const code = err?.code || err?.message || String(err);
        console.error(`events.jsonl append failed: ${code}`);
      });

    return writeQueue;
  }

  return { append };
}

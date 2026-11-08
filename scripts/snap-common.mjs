// Shared output-bounding helpers for the read-only snap tools (#183).
//
// Both snap tools are strictly read-only: they read files and print, nothing
// else. This module deliberately imports nothing with write capability.

/** Default output cap in lines (override: --max-lines or NTG_SNAP_MAX_LINES). */
export const DEFAULT_MAX_LINES = 200;

/** Per-line character cap; bounds total output bytes under (lines+1)*(width+1). */
export const MAX_LINE_WIDTH = 200;

/**
 * Resolves the effective line cap from an explicit --max-lines argument or
 * the NTG_SNAP_MAX_LINES environment variable.
 *
 * @param {{ arg?: string|number|null, env?: object }} opts
 * @returns {number}
 */
export function resolveMaxLines({ arg = null, env = process.env } = {}) {
  const raw = arg ?? env.NTG_SNAP_MAX_LINES ?? null;
  if (raw === null || raw === undefined || String(raw).trim() === '') return DEFAULT_MAX_LINES;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`max lines must be a positive integer, got ${JSON.stringify(String(raw))}`);
  }
  return n;
}

/** Clips one output line to at most `width` characters, marking the cut. */
export function clipLine(s, width = MAX_LINE_WIDTH) {
  const str = String(s ?? '');
  return str.length <= width ? str : str.slice(0, width - 1) + '…';
}

/**
 * Caps a rendered line array at `maxLines` lines, reserving the final shown
 * line for an explicit truncation marker when content was dropped.
 *
 * @param {string[]} lines
 * @param {number} maxLines
 * @returns {{ lines: string[], truncated: boolean, total: number }}
 */
export function capLines(lines, maxLines) {
  const all = Array.isArray(lines) ? lines : [...lines];
  if (all.length <= maxLines) return { lines: all, truncated: false, total: all.length };
  const shown = all.slice(0, maxLines - 1);
  shown.push(`… truncated: ${shown.length} of ${all.length} content lines shown (raise the cap with --max-lines)`);
  return { lines: shown, truncated: true, total: all.length };
}

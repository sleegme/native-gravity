#!/usr/bin/env node
// ntg-dag — read-only NTG ledger DAG renderer
// Reads an AuthoritativeLedger JSON snapshot and prints the milestone
// dependency graph as Unicode boxes. --watch redraws in place.

import { readFileSync, watchFile, unwatchFile } from "node:fs";
import { resolve } from "node:path";

const WIDE = /[\u1100-\u115f\u2329\u232a\u2e80-\u303e\u3041-\u33ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/;

function dispW(s) {
  let w = 0;
  for (const ch of s) w += WIDE.test(ch) ? 2 : 1;
  return w;
}
function pad(s, w) {
  const d = w - dispW(s);
  return d <= 0 ? s : s + " ".repeat(d);
}
function clip(s, w) {
  if (dispW(s) <= w) return s;
  let out = "", used = 0;
  for (const ch of s) {
    const cw = WIDE.test(ch) ? 2 : 1;
    if (used + cw > w - 1) break;
    out += ch; used += cw;
  }
  return out + "…";
}

const ESC = { reset: "\x1b[0m", cyan: "\x1b[36m", green: "\x1b[32m", yellow: "\x1b[33m", red: "\x1b[31m", magenta: "\x1b[35m", bold: "\x1b[1m", dim: "\x1b[2m" };
const COLORS = { ACTIVE: "cyan", DONE: "green", BLOCKED: "yellow", "NO-GO": "red", STALE: "magenta", READY: "bold", PENDING: "dim" };

function stateOf(id, ledger) {
  const completed = new Set(ledger.completed_milestones || []);
  const current = ledger.current_milestone;
  const blockers = ledger.blockers || [];
  const ver = (ledger.verification || {})[id];
  if (id === current) return "ACTIVE";
  if (completed.has(id)) return "DONE";
  if (blockers.some(b => b.affects_milestone === id)) return "BLOCKED";
  if (ver && ver.verdict === "NO-GO" && !ver.is_stale) return "NO-GO";
  if (ver && ver.is_stale) return "STALE";
  const ms = (ledger.milestones || []).find(m => m.id === id);
  if (ms && (ms.dependencies || []).every(d => completed.has(d))) return "READY";
  return "PENDING";
}

function layers(milestones) {
  const done = new Map();
  const l = m => {
    if (done.has(m.id)) return done.get(m.id);
    const d = Math.max(-1, ...(m.dependencies || []).map(dep => {
      const dm = milestones.find(x => x.id === dep);
      return dm ? l(dm) : -1;
    }));
    const lvl = d + 1;
    done.set(m.id, lvl);
    return lvl;
  };
  milestones.forEach(m => l(m));
  const out = new Map();
  for (const m of milestones) {
    const lvl = done.get(m.id);
    if (!out.has(lvl)) out.set(lvl, []);
    out.get(lvl).push(m);
  }
  return [...out.entries()].sort((a, b) => a[0] - b[0]);
}

function checkGraph(milestones) {
  if (!Array.isArray(milestones) || !milestones.length) throw new Error("milestones must be a non-empty array");
  const ids = new Set();
  for (const m of milestones) {
    if (!m.id || typeof m.id !== "string" || ids.has(m.id)) throw new Error(`bad milestone id: ${m.id}`);
    ids.add(m.id);
  }
  for (const m of milestones) for (const d of m.dependencies || []) {
    if (d === m.id) throw new Error(`self-edge on ${m.id}`);
    if (!ids.has(d)) throw new Error(`dangling dep ${d} on ${m.id}`);
  }
  // cycle check
  const color = new Map();
  const dfs = (id, stack) => {
    if (color.get(id) === 1) throw new Error(`cycle through ${stack.concat(id).join("->")}`);
    if (color.get(id) === 2) return;
    color.set(id, 1);
    const m = milestones.find(x => x.id === id);
    for (const d of (m && m.dependencies) || []) dfs(d, stack.concat(id));
    color.set(id, 2);
  };
  for (const m of milestones) dfs(m.id, []);
}

function render(ledger, width, color) {
  const milestones = ledger.milestones || [];
  checkGraph(milestones);
  const boxW = Math.max(20, Math.min(32, Math.max(...milestones.map(m => dispW(m.id) + 10)) + 4));
  const perRow = Math.max(1, Math.floor((width - 2) / (boxW + 2)));
  const lines = [];
  const ver = ledger.verification || {};
  const blockers = ledger.blockers || [];
  const completed = new Set(ledger.completed_milestones || []);

  // header
  const pv = ledger.plan_version;
  const doneN = completed.size;
  const total = milestones.length;
  const active = ledger.current_milestone || "none";
  const nb = blockers.length;
  lines.push(clip(`NTG ledger · plan ${pv} · ${doneN}/${total} done · active: ${active} · ${nb} blocker${nb === 1 ? "" : "s"}`, width));
  if (ledger.goal) lines.push(clip(`goal: ${ledger.goal}`, width));
  lines.push("");

  if (width < boxW + 4) {
    // list layout
    for (const [lvl, ms] of layers(milestones)) {
      for (const m of ms) {
        const st = stateOf(m.id, ledger);
        const deps = (m.dependencies || []).join(", ");
        const note = st === "STALE" ? ` (was ${ver[m.id] && ver[m.id].verdict}@${ver[m.id] && ver[m.id].plan_version})` : "";
        lines.push(clip(`L${lvl} ${st.padEnd(7)} ${m.id}${deps ? ` ← ${deps}` : ""}${note}`, width));
      }
    }
  } else {
    for (const [lvl, ms] of layers(milestones)) {
      for (let i = 0; i < ms.length; i += perRow) {
        const row = ms.slice(i, i + perRow);
        const boxes = row.map(m => {
          const st = stateOf(m.id, ledger);
          const title = m.title && m.title !== m.id ? m.title : null;
          const deps = (m.dependencies || []).join(", ");
          const v = ver[m.id];
          const staleNote = st === "STALE" && v ? `was ${v.verdict}@${v.plan_version}` : null;
          const blk = blockers.find(b => b.affects_milestone === m.id);
          const blkNote = st === "BLOCKED" && blk ? blk.description : null;
          const inner = boxW - 2;
          const titleLine = title ? ` ${clip(title, inner - 2)}` : null;
          const depLine = deps ? ` ← ${clip(deps, inner - 4)}` : null;
          const noteLine = staleNote || blkNote ? ` ${clip(staleNote || blkNote, inner - 2)}` : null;
          const lines3 = [titleLine, depLine, noteLine].filter(Boolean);
          const h = Math.max(3, lines3.length + 2);
          const idLen = dispW(m.id), stLen = dispW(st);
          const fill = Math.max(1, inner - idLen - stLen - 4);
          const top = `┌ ${m.id} ${"─".repeat(fill)} ${st} ┐`;
          const mids = [];
          if (titleLine) mids.push(`│${pad(titleLine, inner)}│`);
          if (depLine) mids.push(`│${pad(depLine, inner)}│`);
          if (noteLine) mids.push(`│${pad(noteLine, inner)}│`);
          while (mids.length < h - 2) mids.push(`│${" ".repeat(inner)}│`);
          const bot = `└${"─".repeat(inner)}┘`;
          return { top, mids, bot };
        });
        const h = Math.max(...boxes.map(b => b.mids.length));
        for (const b of boxes) while (b.mids.length < h) b.mids.push(`│${" ".repeat(boxW - 2)}│`);
        const label = `L${lvl}`;
        lines.push(`${label}  ${boxes.map(b => b.top).join("  ")}`);
        for (let r = 0; r < h; r++) lines.push(`    ${boxes.map(b => b.mids[r]).join("  ")}`);
        lines.push(`    ${boxes.map(b => b.bot).join("  ")}`);
        lines.push("");
      }
    }
  }

  // footer
  if (ledger.next_action) lines.push(clip(`next: ${ledger.next_action}`, width));
  for (const b of blockers.slice(0, 5)) lines.push(clip(`blocker ${b.affects_milestone}: ${b.description || ""}`, width));
  if (blockers.length > 5) lines.push(`+${blockers.length - 5} more`);
  return lines;
}

function usage() {
  console.error("Usage: ntg-dag --ledger <path> [--watch] [--width <cols>] [--no-color]");
  process.exit(2);
}

const args = process.argv.slice(2);
let ledgerPath = process.env.NTG_LEDGER || null;
let watch = false, widthArg = null, noColor = false;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--watch") watch = true;
  else if (a === "--no-color") noColor = true;
  else if (a === "--ledger") ledgerPath = args[++i];
  else if (a.startsWith("--ledger=")) ledgerPath = a.slice(9);
  else if (a === "--width") widthArg = parseInt(args[++i], 10);
  else if (a.startsWith("--width=")) widthArg = parseInt(a.slice(8), 10);
  else if (a === "-h" || a === "--help") { usage(); }
  else usage();
}
if (!ledgerPath) usage();
if (widthArg != null && (!Number.isInteger(widthArg) || widthArg <= 0)) usage();

ledgerPath = resolve(ledgerPath);
const isTTY = process.stdout.isTTY;
const color = !noColor && isTTY && !(process.env.NO_COLOR || "");
const width = widthArg || (isTTY ? process.stdout.columns : parseInt(process.env.COLUMNS || "80", 10)) || 80;

function load() {
  try {
    const text = readFileSync(ledgerPath, "utf-8");
    const j = JSON.parse(text);
    return { ok: true, ledger: j };
  } catch (e) {
    return { ok: false, err: String(e && e.message || e) };
  }
}

let lastGood = null;
function draw(err) {
  const w = isTTY ? process.stdout.columns || width : width;
  if (isTTY) process.stdout.write("\x1b[H\x1b[2J");
  const hdr = [`watching ${ledgerPath} · updated ${new Date().toTimeString().slice(0, 8)}`];
  const r = err ? { ok: false, err } : load();
  if (r.ok) {
    try {
      const lines = render(r.ledger, w, color);
      lastGood = r.ledger;
      if (isTTY) process.stdout.write(lines.join("\n") + "\n");
      else console.log(lines.join("\n"));
      return;
    } catch (e) {
      // render threw (bad graph) — show last good if we have it
      const msg = lastGood ? `! ${e.message} (showing last good frame)` : `waiting for ${ledgerPath}: ${e.message}`;
      if (lastGood) {
        const lines = hdr.concat([msg], render(lastGood, w, color));
        if (isTTY) process.stdout.write(lines.join("\n") + "\n");
        else console.log(lines.join("\n"));
      } else {
        const lines = hdr.concat([msg]);
        if (isTTY) process.stdout.write(lines.join("\n") + "\n");
        else console.log(lines.join("\n"));
      }
      return;
    }
  } else {
    const msg = lastGood ? `! ${r.err} (showing last good frame)` : `waiting for ${ledgerPath}: ${r.err}`;
    const lines = lastGood ? hdr.concat([msg], render(lastGood, w, color)) : hdr.concat([msg]);
    if (isTTY) process.stdout.write(lines.join("\n") + "\n");
    else console.log(lines.join("\n"));
  }
}

if (!watch) {
  const r = load();
  if (!r.ok) { console.error(`ntg-dag: ${r.err}`); process.exit(1); }
  try {
    const lines = render(r.ledger, width, color);
    console.log(lines.join("\n"));
  } catch (e) { console.error(`ntg-dag: ${e.message}`); process.exit(1); }
  process.exit(0);
}

draw();
watchFile(ledgerPath, { interval: 500 }, () => draw());
if (isTTY) process.stdout.on("resize", () => draw());

#!/usr/bin/env node
/**
 * ntg-run — thin wrapper for `agy` that injects the NTG_ROLE marker so the
 * primary review gate can attribute the session's primary role on AGY 1.2.x,
 * where `--agent` no longer writes the role body into the transcript (issue #64,
 * convention from PR #71).
 *
 * Marker is injected only for gated roles (bulldozer, piledriver) — the roles the
 * gate actually enforces. Other agents pass through unchanged so the gate stays
 * out of their way (PR #71 provenance boundary). If the prompt already contains
 * an NTG_ROLE marker, it is left alone — no double injection.
 *
 * Usage:
 *   ntg-run --agent bulldozer -p "do the thing"
 *   ntg-run --agent piledriver --model gemini-3.1-pro -p "plan it" -- --passthrough
 *
 * Anything after `--` passes verbatim to agy.
 */
import { spawnSync } from "node:child_process";
import process from "node:process";

const GATED_ROLES = Object.freeze(new Set(["bulldozer", "piledriver"]));
const MARKER_RE = /^\s*NTG_ROLE\s*:/im;

/** Finds the prompt argument. Returns { index, prefix } — prefix is "" for `-p`/`--print`
 *  two-token form and "--print=" for the inline form, so the flag itself is preserved
 *  when the marker is prepended. "-p=..." is deliberately skipped: it would collide
 *  with bundled short flags like `-pm`. */
function firstPromptIndex(args) {
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "-p" || args[index] === "--print") {
      return { index: index + 1, prefix: "" };
    }
    if (args[index]?.startsWith("--print=")) {
      return { index, prefix: "--print=" };
    }
  }
  return { index: -1, prefix: "" };
}

function agentArg(args) {
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--agent" || args[index] === "-a") {
      return args[index + 1]?.trim().toLowerCase() ?? null;
    }
    if (args[index]?.startsWith("--agent=")) {
      return args[index].slice("--agent=".length).trim().toLowerCase();
    }
  }
  return null;
}

function main() {
  const raw = process.argv.slice(2);
  const passthrough = raw.indexOf("--");
  const ours = passthrough === -1 ? raw : raw.slice(0, passthrough);
  const rest = passthrough === -1 ? [] : raw.slice(passthrough + 1);

  const role = agentArg(ours);
  const prompt = firstPromptIndex(ours);
  const args = [...ours];

  if (role !== null && GATED_ROLES.has(role) && prompt.index !== -1 && prompt.index < args.length) {
    const text = args[prompt.index].slice(prompt.prefix.length);
    if (!MARKER_RE.test(text)) {
      args[prompt.index] = `${prompt.prefix}NTG_ROLE: ${role}\n${text}`;
    }
  }

  const agy = process.env.AGY_PATH ?? "agy";
  const child = spawnSync(agy, [...args, ...rest], { stdio: "inherit", env: process.env });
  process.exit(child.status ?? 1);
}

main();

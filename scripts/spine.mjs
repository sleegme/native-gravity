/**
 * Compatibility re-export shim for NTG 1.x callers importing `scripts/spine.mjs` (#234).
 *
 * The canonical Season 2 execution engine and runtime orchestration live in
 * `src/runtime/steamroller-controller.mjs` (`SteamrollerController`) and
 * `src/runtime/track-runner.mjs` (`TrackRunner`).
 */
export {
  MAX_REPAIR_ATTEMPTS,
  MinimalSpine,
  SALVAGEABLE_ERRORS,
  SALVAGE_MAX_CALLS,
  SALVAGE_TIMEOUT_MS,
  STRIX_FLAG_ENV,
  SteamrollerController,
  SteamrollerSpine,
  advisorGateEnabled,
  decideRepairAction,
  recommendNeedsAlt,
  repairStopQuestion,
  zenNoGoSignature,
} from '../src/runtime/steamroller-controller.mjs';

export { TrackRunner } from '../src/runtime/track-runner.mjs';

/**
 * Presentation contract for the MCV <-> Construction Yard conversion.
 *
 * These phases use the existing presentation-only animClip/animTime columns.
 * They never affect gameplay or the lockstep checksum. DeployService advances
 * them on fixed ticks so pause, replay, and render FPS cannot change the motion.
 */

import { CELL, SIM_DT } from './config';
import { EntityKind } from './types';

/** High values stay clear of authored infantry/building clip indices. */
export const enum DeployVisualClip {
  None = 0,
  Fold = 250,
  Rise = 251,
}

/** The spawned form settles after the gameplay conversion has completed. */
export const DEPLOY_SETTLE_SECONDS = 0.8;
export const DEPLOY_SETTLE_TICKS = Math.max(1, Math.round(DEPLOY_SETTLE_SECONDS / SIM_DT));

export function isDeployVisualClip(clip: number): boolean {
  return clip === DeployVisualClip.Fold || clip === DeployVisualClip.Rise;
}

/** 0 = authored pose, 1 = fully collapsed below the conversion dust. */
export function deployCollapse(clip: number, progress: number): number {
  const t = Math.max(0, Math.min(1, progress));
  const phase = clip === DeployVisualClip.Rise ? 1 - t
    : clip === DeployVisualClip.Fold ? t
      : 0;
  return phase * phase * (3 - 2 * phase);
}

/** Hydraulic width pulse at the middle of either fold or rise. */
export function deployBulge(clip: number, progress: number): number {
  if (!isDeployVisualClip(clip)) return 0;
  const t = Math.max(0, Math.min(1, progress));
  return Math.sin(Math.PI * t);
}

/** How far the model origin travels under its pad while collapsed. */
export function deploySink(kind: EntityKind, footprintW: number, footprintH: number): number {
  if (kind === EntityKind.Building) {
    return Math.max(4.5, Math.max(footprintW, footprintH, 1) * CELL * 0.42);
  }
  return kind === EntityKind.Vehicle ? 1.15 : 0;
}

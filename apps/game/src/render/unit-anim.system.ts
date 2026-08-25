/**
 * VOLTMARCH — the unit animation system. `RenderPhase.UnitAnim` (40).
 *
 * THIS PHASE HAD NO REGISTRATIONS AT ALL until this file existed, and that is
 * the whole of "Troops walking animation doesnt exist at all". Everything else
 * was already in place and had been since the foundation commit:
 *
 *   core/types.ts    `UnitAnim = 40` sits in the RenderPhase enum
 *   core/loop.ts     the write-ownership table assigns `animClip` / `animTime`
 *                    to "unit-art", cadence "render frame"
 *   core/world.ts    both columns allocated across MAX_ENTITIES
 *   game/SaveGame.ts `animTime` persisted at column 92
 *   render/render-bridge.system.ts  its header explains that anim modules write
 *                    `animTime` for the NEXT frame
 *
 * Five files describing a module that was never written. It is the repo's
 * signature defect and `docs/SPEC_DRIFT_AUDIT.md` catalogues the family.
 *
 * WHAT IT DOES. One pass over living infantry, advancing a gait phase from the
 * unit's ACTUAL speed so the stride matches the ground it covers, and unwinding
 * that phase to a neutral stance when it stops. `RenderBridge` reads the column
 * into `aState.w` and `src/render/Gait.ts`'s vertex stage swings the limbs.
 *
 * WHY THE PHASE IS 40 AND THE BRIDGE IS 30. This runs AFTER the bridge, so the
 * bridge publishes last frame's phase — one frame of latency at 60 fps, on a
 * limb swinging at 1.5 Hz, which is 0.6% of a cycle. Running it before the
 * bridge instead would mean animating entities the bridge has not yet decided
 * are visible. The ordering is the one the header of render-bridge.system.ts
 * already documented; this module just finally honours it.
 */

import { UNIT_GAIT } from '../core/config';
import { defineSystem } from '../core/loop';
import { EntityFlag, EntityKind, RenderPhase } from '../core/types';
import type { RenderContext } from '../core/types';
import { ctx } from '../game/context';

/** Cycles per second at `speed`, from the stride length. */
function cyclesPerSecond(speed: number): number {
  return speed / UNIT_GAIT.strideMetres;
}

/**
 * Unwind `phase` toward the nearer of the two neutral stances (0 and 0.5).
 *
 * Returned in `[0, 1)`. Snaps once it is within a step, so a stopped unit
 * reaches EXACTLY neutral rather than asymptotically approaching it — the
 * shader's `sin` then returns exactly 0 and the model is bit-identical to the
 * un-animated one, which is what makes a parked army perfectly still.
 */
function settle(phase: number, step: number): number {
  const target = phase < 0.25 ? 0 : phase < 0.75 ? 0.5 : 1;
  const delta = target - phase;
  if (Math.abs(delta) <= step) return target >= 1 ? 0 : target;
  return phase + Math.sign(delta) * step;
}

export default defineSystem({
  id: 'render.unitAnim',
  renderPhase: RenderPhase.UnitAnim,
  order: 100,

  frame(r: RenderContext): void {
    const { world, debug } = ctx();
    const s = world.store;
    const walkers = s.byKind[EntityKind.Infantry];
    const n = s.byKindCount[EntityKind.Infantry];
    const settleStep = UNIT_GAIT.settleRate * r.dt;
    let moving = 0;

    for (let a = 0; a < n; a++) {
      const i = walkers[a];
      if ((s.flags[i] & EntityFlag.PendingDestroy) !== 0) continue;
      const speed = s.speed[i];
      if (speed <= UNIT_GAIT.idleSpeed) {
        const p = s.animTime[i];
        // The overwhelmingly common case is a unit that has been parked for a
        // while and is already exactly neutral. Skip the arithmetic for it.
        if (p !== 0 && p !== 0.5) s.animTime[i] = settle(p, settleStep);
        continue;
      }
      moving++;
      // WALL-CLOCK dt, deliberately, and this is a RENDER module for exactly
      // that reason: the swing must stay smooth at 144 fps and must not tick in
      // 30 Hz steps. `Math.random`/`Date.now` are banned inside `simTick`; this
      // is not inside it, and `animTime` is render-owned per core/loop.ts.
      let p = s.animTime[i] + cyclesPerSecond(speed) * r.dt;
      p -= Math.floor(p);
      s.animTime[i] = p;
    }

    debug.counters.walking = moving;
  },
});

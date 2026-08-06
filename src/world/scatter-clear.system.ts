/**
 * ============================================================================
 * VOLTMARCH — src/world/scatter-clear.system.ts
 * ============================================================================
 * BUILDINGS FELL WHAT THEY LAND ON.
 *
 * Placing a structure on a copse used to leave the trees standing through the
 * roof. This module closes that: it listens to `building:placed` and asks
 * `Scatter.clearFootprint()` to retire every prop whose canopy overlaps the
 * new footprint, then raises a little dust where the big ones stood.
 *
 * WHY AN EVENT AND NOT A CALL FROM Placement.ts
 * ---------------------------------------------
 * `building:placed` already carries exactly what this needs — `cx, cz, w, h`,
 * the footprint in cells — and it is emitted from the ONE commit point in
 * `Production.spawnBuilding()`, right next to `markOccupied()` and `stampPad()`.
 * Every other consumer that cares about a new footprint (pathing, power, audio,
 * the HUD) is wired the same way. Reaching into the placement path to add a
 * second call site would give the same behaviour with one more coupling.
 *
 * FOUR DECISIONS, ALL ARGUABLE, ALL DELIBERATE
 * --------------------------------------------
 * 1. MARGIN, NOT EXACT FOOTPRINT. `PROP_CLEAR_MARGIN` (1.25 m) grows the
 *    rectangle, and the overlap test uses the prop's VISUAL disc rather than
 *    its trunk — see the constant's own comment in Scatter.ts. A tree whose
 *    stump clears the wall by a centimetre but whose crown sits on the roof
 *    still reads as broken, so it goes.
 *
 * 2. CLEARING IS PERMANENT. `building:placed` fires when the foundation is
 *    poured, not when the structure finishes, so a build that is cancelled or
 *    destroyed at 5% leaves the props gone. That is the correct answer and not
 *    merely the cheap one: the same commit point ALSO paints the concrete pad
 *    (`Production.stampPad`) and claims the cells (`terrain.markOccupied`), and
 *    neither of those is reverted either. RA does the same — ground cleared for
 *    a structure stays cleared. A tree that pops back into existence when a
 *    half-built barracks dies would be the more surprising behaviour.
 *
 *    Permanent means ACROSS A SAVE too, and always has here: `save.system.ts`
 *    listens to the same event and keeps the footprint ledger. What did not
 *    survive was `src/sim/Crush.ts`'s half of the same rule; `Scatter` §3.10b
 *    now carries both as one bit per placement and the ledger is the fallback.
 *
 * 3. VISIBLE, BUT CHEAP. RA3 flattens vegetation on screen, so this raises
 *    `FxKind.DustPuff` through the presentation queue — an effect the VFX pool
 *    already owns, with no new recipe, no new material and no new draw call.
 *    Only props above `PUFF_MIN_RADIUS` puff, and only the `PUFF_MAX` BIGGEST
 *    of those, so bulldozing a meadow of grass tufts does not become a smoke
 *    screen on a build that is already GPU-bound — and the dust that is raised
 *    lands where a tree fell rather than where the cell scan happened to start.
 *
 * 4. NO FOG TEST. The puff is pushed wherever the structure lands, including
 *    inside an enemy's fog. That matches every other FX producer in the sim
 *    (Damage, Deploy, Crates all push unconditionally) and the VFX system does
 *    no visibility filtering of its own; adding one here alone would be an
 *    inconsistency, not a fix. If FX ever gain a fog gate it belongs in the VFX
 *    system for all of them at once.
 *
 * DETERMINISM
 * -----------
 * The handler runs inside `simTick` (the event is emitted from Phase.Production)
 * and touches neither `s.rng` nor a clock. Which props are cleared is a pure
 * function of the footprint and the placement list; how many puffs are raised
 * is a pure function of that result. Replays are unaffected.
 *
 * PROPS AND PATHING
 * -----------------
 * Nothing in the SIM consumes `Scatter.blockers()` — grepped across the tree,
 * its only caller is `tests/scatter.spec.ts` — and Scatter never writes
 * `passGrid`, `costGrid` or the occupancy grid (its own header says so, and
 * loop.ts's write-ownership table enforces it). Props are therefore PURELY
 * DECORATIVE with respect to navigation, so
 * removing them cannot desynchronise a nav grid and this module deliberately
 * does not invalidate one. `sim/pathing.system.ts` already invalidates the
 * flow-field cache on the same event, for the building's own footprint.
 * ============================================================================
 */

import { defineSystem } from '../core/loop';
import { Faction, FxKind, NONE, Phase } from '../core/types';
import { CELL } from '../core/config';
import { ctx } from '../game/context';
import { getScatter, PROP_CLEAR_MARGIN } from './Scatter';

/** Props smaller than this raise no dust — grass tufts are not felled trees. */
const PUFF_MIN_RADIUS = 0.8;
/** Hard cap on puffs per placement. A 6x6 pad over a copse can clear ~20. */
const PUFF_MAX = 10;
/**
 * Capacity of the report buffer, in props. A 6x6-cell pad is 576 m2, which at
 * the wilderness density of 260/ha holds ~15 props; the densest measured clear
 * on a generated map felled 23. 128 is therefore headroom, not a budget, and
 * above it the extras still clear — they just raise no dust.
 */
const REPORT_CAPACITY = 128;

/** Caller-supplied output for `clearFootprint`: (x, y, z, radius) quads. */
const CLEARED = new Float32Array(REPORT_CAPACITY * 4);

/**
 * Indices into CLEARED of the PUFF_MAX biggest props felled, largest first.
 *
 * Taking the FIRST ten instead would spend the whole dust budget on whatever
 * the cell scan reached first, and a cell scan reaches grass tufts before it
 * reaches the oak in the corner — so a pad dropped on a meadow with three trees
 * in it would puff ten times and never once where a tree fell. The selection is
 * an insertion into a ten-slot array, so it costs at most 10 shifts per
 * candidate over <=128 candidates and allocates nothing.
 */
const PUFF_PICK = new Int32Array(PUFF_MAX);

let unsubscribe: (() => void) | null = null;
/** Cumulative, for the F3 overlay and for the tests. */
let totalCleared = 0;

/**
 * Fell the props under one footprint and raise dust. Exported for the tests,
 * which drive it without standing up an event bus.
 */
export function clearPropsUnder(
  cx: number, cz: number, w: number, h: number,
  push: (kind: FxKind, x: number, y: number, z: number,
    dx: number, dy: number, dz: number, scale: number) => void,
): number {
  const scatter = getScatter();
  if (scatter === null) return 0;

  const n = scatter.clearFootprint(
    cx * CELL, cz * CELL, (cx + w) * CELL, (cz + h) * CELL,
    PROP_CLEAR_MARGIN, CLEARED,
  );
  if (n === 0) return 0;
  totalCleared += n;

  const reported = Math.min(n, REPORT_CAPACITY);

  // Select the biggest felled props, largest first. Ties keep the lower report
  // index, which is cell-scan order and therefore deterministic.
  let picked = 0;
  for (let i = 0; i < reported; i++) {
    const r = CLEARED[i * 4 + 3];
    if (r < PUFF_MIN_RADIUS) continue;
    let slot = picked < PUFF_MAX ? picked : PUFF_MAX - 1;
    if (picked >= PUFF_MAX && r <= CLEARED[PUFF_PICK[slot] * 4 + 3]) continue;
    while (slot > 0 && CLEARED[PUFF_PICK[slot - 1] * 4 + 3] < r) {
      PUFF_PICK[slot] = PUFF_PICK[slot - 1];
      slot--;
    }
    PUFF_PICK[slot] = i;
    if (picked < PUFF_MAX) picked++;
  }

  for (let k = 0; k < picked; k++) {
    const i = PUFF_PICK[k];
    // Bigger prop, bigger cloud, clamped so a water tower does not detonate.
    const scale = Math.min(0.5 + CLEARED[i * 4 + 3] * 0.45, 1.8);
    push(
      FxKind.DustPuff,
      CLEARED[i * 4], CLEARED[i * 4 + 1] + 0.35, CLEARED[i * 4 + 2],
      0, 1, 0, scale,
    );
  }
  return n;
}

/** Total props felled by construction this match. For tests and diagnostics. */
export function clearedPropCount(): number { return totalCleared; }

export default defineSystem({
  id: 'world.scatterClear',
  // Phase.Cleanup / 20500 puts this init AFTER `world.scatter` (20000), so the
  // console line below can quote a real prop count. The handler itself reaches
  // the module through `getScatter()` at call time, so it would survive a
  // reordering — this is tidiness, not a dependency.
  phase: Phase.Cleanup,
  order: 20500,

  init(): void {
    const { channels, debug } = ctx();
    totalCleared = 0;
    debug.setCounter('propsCleared', 0);

    unsubscribe = channels.events.on('building:placed', (e) => {
      const n = clearPropsUnder(e.cx, e.cz, e.w, e.h, (kind, x, y, z, dx, dy, dz, scale) => {
        channels.fx.push(kind, x, y, z, dx, dy, dz, scale, NONE, Faction.Neutral);
      });
      if (n > 0) debug.setCounter('propsCleared', totalCleared);
    });

    const scatter = getScatter();
    console.info(
      `%c[scatter]%c construction clears props inside the footprint ` +
      `+${PROP_CLEAR_MARGIN} m (${scatter === null ? 'no scatter — inert' : `${scatter.propCount} props live`})`,
      'color:#7fd', 'color:inherit',
    );
  },

  dispose(): void {
    unsubscribe?.();
    unsubscribe = null;
    totalCleared = 0;
  },
});

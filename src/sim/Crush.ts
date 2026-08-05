/**
 * ============================================================================
 * VOLTMARCH — src/sim/Crush.ts
 * ============================================================================
 * HEAVY VEHICLES FLATTEN SOFT SCENERY.
 *
 * THE HOLE THIS FILLS
 * -------------------
 * `docs/SPEC_DRIFT_AUDIT.md` §10 catalogues this file's absence exactly:
 * "Crushing is a complete authored vocabulary with zero implementation."
 * `EntityFlag.Crusher` and `EntityFlag.Crushable` exist, `world.ts` allocates
 * `crushLevel` and `crushableBy` columns, `Defs.ts` authors fourteen values,
 * `FxKind.CrushSquish` exists, `audio/Weapons.ts` maps it to `SFX.crush`,
 * `vfx.system.ts` has a recipe for it, and `Damage.ts`'s own death sweep lists
 * "crushing" as a cause of death it handles. Every part was built. Nothing
 * read any of it: the columns had two writes and zero reads, and a measured
 * probe confirmed a Scrapjaw driving through a tree at 5.6 m/s with the tree
 * at full HP on the far side.
 *
 * This is the reader. It invents no new state — the flags, the two columns and
 * the FX id were all already authored for it.
 *
 * WHAT GETS CRUSHED
 * -----------------
 * 1. ENTITY PROPS (`EntityKind.Prop`, ~140 per match, from
 *    `ScenarioBuilder.spawnProp`). `EntityFlag.Crushable` says soft;
 *    `crushableBy` says how heavy you must be. Killed with `store.markDead`,
 *    which is all that is needed: `Damage.cleanupTick` already emits
 *    `entity:killed` and already gives a dead prop "a splinter shower and a
 *    puff, nothing more" (`Damage.onDeath`'s default branch). Reusing that is
 *    why this file pushes no debris FX of its own.
 *
 * 2. SCATTER VEGETATION (instanced, ~7000 per match, no entity). Reached
 *    through `Scatter.crushDisc`, which filters on `PropDef.family`. Without
 *    this half the feature would be a bug rather than a fix: entity props and
 *    scatter props are drawn from the SAME geometry by design
 *    (`entity-props.system.ts`: "the frame reads as one world rather than
 *    two"), so crushing only the 2% that happen to be entities would mean two
 *    visually identical trees behaving differently.
 *
 * WHAT DOES NOT
 * -------------
 * Rock. `FALLBACK_PROPS` gives `rock` (r 2.0) and `boulder` (r 3.2)
 * `EntityFlag.BlocksNav` and NOT `Crushable`, so they fail the flag test here
 * and are instead made solid by `Movement.relax`. A boulder dissolving under a
 * harvester would read as a missing collision, not as strength.
 *
 * Infantry. `crushableBy: 1` is authored on every foot unit and `crushLevel:
 * 3..6` on every tank, so extending the victim test past `EntityKind.Prop` is
 * a one-line change — deliberately NOT taken here. Crushing infantry is a
 * balance change that touches target selection, veterancy and the AI, and it
 * belongs to its own decision with its own tests, not to a scenery bug fix.
 *
 * PHASE
 * -----
 * `Phase.Movement` + a late order, copied from `Crates.ts` — the other
 * drive-over mechanic — and for its reason: the test must read THIS tick's
 * position, and consuming the victim before `Phase.SpatialRebuild` keeps the
 * index honest. The broadphase is one tick stale, which cannot matter: props
 * never move, so only the QUERY CENTRE is fresh, and that is the crusher's own
 * current position, read directly.
 *
 * DETERMINISM
 * -----------
 * No clock and no RNG. Victims are visited in `byKind[Vehicle]` order and, per
 * crusher, in spatial-bucket order; both are total orders the store already
 * guarantees. Which props die is a pure function of positions, so replays and
 * `npm run soak` are unaffected.
 * ============================================================================
 */

import { EntityFlag, EntityKind, Faction, FxKind, NONE } from '../core/types';
import type { SimContext } from '../core/types';
import type { World } from '../core/world';
import type { Channels } from '../core/events';
import { MAX_QUERY_RESULTS } from '../core/config';
import { getScatter } from '../world/Scatter';

/* ==========================================================================
 * 1. TUNING
 *
 * Module-private on purpose: `src/core/config.ts` is owned elsewhere, and
 * `Deploy.ts` and `Capture.ts` already set the precedent of a feature keeping
 * its own numbers next to the code that reads them.
 * ========================================================================== */

export const CRUSH = {
  /**
   * Metres per second below which a hull crushes nothing.
   *
   * Without it a tank parked in a hedge deletes it on the tick it stops, and —
   * worse — a unit standing still next to a tree that regrows into range
   * (it cannot, but a scenario respawn can) would eat it silently. Crushing
   * should be something a player SEES happen while driving.
   */
  minSpeed: 0.6,
  /**
   * Fraction of the hull disc that actually flattens things.
   *
   * `store.radius` is a fitted collision disc, deliberately generous so tanks
   * do not interpenetrate (`Scenarios.spawnUnit`: "too small and tanks
   * interpenetrate"). Using all of it would fell trees the hull visibly passed
   * beside. 0.7 keeps the kill under the chassis.
   */
  hullFrac: 0.7,
  /**
   * `crushableBy` to assume for a prop whose column was never written.
   *
   * NOT a reinterpretation of the documented "0 = uncrushable" rule, which is
   * correct and load-bearing for UNITS: an MCV carries `crushableBy: 0` and
   * must never be crushable. But no prop spawn path writes the column at all —
   * `Scenarios.spawnProp` sets hp, radius, locomotor and flags and never
   * touches `crushableBy` — so for a prop the value is "unset", not "immune",
   * and the `Crushable` FLAG is the authored signal. 1 means any crusher.
   */
  propDefaultLevel: 1,
  /**
   * Victims per crusher per tick. A hull 7.7 m across driving into a copse can
   * legitimately touch several trunks at once; this only bounds the worst case.
   */
  maxPerTick: 4,
  /** Scatter props reported back per crusher per tick, for the dust. */
  reportCapacity: 8,
  /** Below this radius a felled prop is not worth a separate squish. */
  minSquishRadius: 0.5,
} as const;

/* ==========================================================================
 * 2. THE RESOLVER
 * ========================================================================== */

export class CrushResolver {
  /** Entity props flattened this match. */
  public crushedProps = 0;
  /** Scatter instances flattened this match. */
  public crushedScatter = 0;
  /** Victims on the last tick, for the debug overlay and the tests. */
  public lastCrushed = 0;

  private readonly scratch = new Int32Array(MAX_QUERY_RESULTS);
  private readonly cleared = new Float32Array(CRUSH.reportCapacity * 4);

  constructor(
    private readonly world: World,
    private readonly channels: Channels,
  ) {}

  simTick(_s: SimContext): void {
    const w = this.world;
    const st = w.store;
    const list = st.byKind[EntityKind.Vehicle];
    const count = st.byKindCount[EntityKind.Vehicle];
    let crushed = 0;

    for (let k = 0; k < count; k++) {
      const i = list[k];
      const f = st.flags[i];
      if ((f & EntityFlag.Alive) === 0) continue;
      if ((f & (EntityFlag.PendingDestroy | EntityFlag.Garrisoned)) !== 0) continue;
      if ((f & EntityFlag.Crusher) === 0) continue;
      const level = st.crushLevel[i];
      if (level === 0) continue;
      if (st.speed[i] < CRUSH.minSpeed) continue;
      crushed += this.crushUnder(i, level);
    }

    this.lastCrushed = crushed;
  }

  /** Everything one hull flattens on one tick. Returns the victim count. */
  private crushUnder(i: number, level: number): number {
    const w = this.world;
    const st = w.store;
    const px = st.posX[i];
    const pz = st.posZ[i];
    const hull = st.radius[i] * CRUSH.hullFrac;
    if (hull <= 0) return 0;
    let victims = 0;

    /* -- 1. entity props ------------------------------------------------- */
    // `queryCircleFat` accepts a candidate when the discs touch, which is the
    // test we want; the exact compare below is still done here so a future
    // change to the broadphase cannot quietly widen the kill.
    const found = w.spatial.queryCircleFat(px, pz, hull, this.scratch);
    for (let k = 0; k < found && victims < CRUSH.maxPerTick; k++) {
      const j = this.scratch[k];
      if (j === i) continue;
      if (st.kind[j] !== EntityKind.Prop) continue;
      const jf = st.flags[j];
      if ((jf & EntityFlag.Alive) === 0) continue;
      if ((jf & EntityFlag.PendingDestroy) !== 0) continue;
      if ((jf & EntityFlag.Crushable) === 0) continue;

      const authored = st.crushableBy[j];
      const need = authored > 0 ? authored : CRUSH.propDefaultLevel;
      if (need > level) continue;

      const rj = st.radius[j];
      const dx = st.posX[j] - px;
      const dz = st.posZ[j] - pz;
      const want = hull + rj;
      if (dx * dx + dz * dz >= want * want) continue;

      if (!st.markDead(st.handleOf(j))) continue;
      // The splinters and the dust come free: `Damage.onDeath`'s default branch
      // already gives a dead prop `Debris` + `DustPuff`. This adds only the
      // crunch — `FxKind.CrushSquish`, whose VFX and audio recipes were both
      // written for a mechanic that until now never fired.
      this.squish(st.posX[j], st.posY[j], st.posZ[j], rj);
      this.crushedProps++;
      victims++;
    }

    /* -- 2. scatter vegetation -------------------------------------------- */
    const scatter = getScatter();
    if (scatter !== null) {
      const felled = scatter.crushDisc(px, pz, hull, this.cleared);
      if (felled > 0) {
        this.crushedScatter += felled;
        victims += felled;
        // Scatter props are not entities, so nothing downstream will raise dust
        // for them. Report order is cell-scan order and therefore deterministic.
        const reported = felled < CRUSH.reportCapacity ? felled : CRUSH.reportCapacity;
        for (let q = 0; q < reported; q++) {
          this.squish(
            this.cleared[q * 4], this.cleared[q * 4 + 1], this.cleared[q * 4 + 2],
            this.cleared[q * 4 + 3],
          );
          this.channels.fx.push(
            FxKind.DustPuff,
            this.cleared[q * 4], this.cleared[q * 4 + 1] + 0.3, this.cleared[q * 4 + 2],
            0, 1, 0, Math.min(0.5 + this.cleared[q * 4 + 3] * 0.45, 1.8),
            NONE, Faction.Neutral,
          );
        }
      }
    }

    return victims;
  }

  /**
   * The crunch. Skipped for anything too small to hear.
   *
   * `Faction.Neutral` because that is whose prop it was — the FX channel keys
   * palette off faction and a felled tree must not flash in team colour.
   */
  private squish(x: number, y: number, z: number, radius: number): void {
    if (radius < CRUSH.minSquishRadius) return;
    this.channels.fx.push(
      FxKind.CrushSquish, x, y + 0.25, z, 0, 1, 0,
      Math.min(0.6 + radius * 0.4, 1.6), NONE, Faction.Neutral,
    );
  }

  /** Between matches. */
  reset(): void {
    this.crushedProps = 0;
    this.crushedScatter = 0;
    this.lastCrushed = 0;
  }
}

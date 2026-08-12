/**
 * ============================================================================
 * VOLTMARCH — src/sim/Crush.ts
 * ============================================================================
 * HEAVY VEHICLES FLATTEN SOFT SCENERY, AND THE MEN STANDING IN FRONT OF THEM.
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
 * 3. INFANTRY (`EntityKind.Infantry`). The genre's most recognisable verb, and
 *    the one this file shipped without — the victim test read
 *    `if (st.kind[j] !== EntityKind.Prop) continue` and nothing else, so a
 *    tank flattened trees and drove harmlessly through men. THE INFANTRY RULE
 *    below is the whole of it.
 *
 * WHAT DOES NOT
 * -------------
 * Rock. `FALLBACK_PROPS` gives `rock` (r 2.0) and `boulder` (r 3.2) NEITHER
 * `Crushable` nor `BlocksNav`, so they fail the flag test here and nothing else
 * makes them solid either — a hull drives over the spot.
 *
 * THE SECOND HALF OF THAT USED TO READ "are instead made solid by
 * `Movement.relax`", and that is the claim that changed: the relax branch is
 * deleted. It made a rock solid to the PHYSICS while leaving it invisible to
 * the PLANNER, and `config.ts` measured what that costs under
 * HARVESTER_NAV_GIVEUP_SECONDS — a 2 m rock sealing a one-cell corridor and
 * parking a hull for 2100 ticks on a route the flow field thought was open.
 *
 * The reason they are still not `Crushable` is unchanged and is the sentence
 * that always mattered: a boulder dissolving under a harvester would read as a
 * missing collision, not as strength. It is now joined by a mechanical reason —
 * entity and scatter props share geometry, `CRUSHABLE_FAMILIES` excludes the
 * rock family, and `spawnProp` writes no `crushableBy`, so a crushable boulder
 * would die to the lightest crusher in the game beside an identical instanced
 * one that survives.
 *
 * VEHICLES. Fifteen hulls carry a `crushableBy` of 4..6 and it is read by
 * nothing, here or anywhere. That is not an oversight in this file: NOT ONE
 * VEHICLE IN THE ROSTER CARRIES `EntityFlag.Crushable` — the flag whose own
 * docstring is "dies instantly under a Crusher with a higher crushLevel" —
 * and every foot unit does. The roster therefore already says who the victims
 * are, and a ram that deletes a 420 HP Rhino because an Apocalypse touched it
 * is a balance decision with no authored intent behind it. The `crushableBy`
 * numbers on hulls describe a ram rule that does not exist; they are reported,
 * not implemented. See `docs/SPEC_DRIFT_AUDIT.md` §10.
 *
 * THE INFANTRY RULE, IN FOUR PARTS
 * --------------------------------
 * 1. WHO. A live `EntityFlag.Crusher` with `crushLevel > 0`, moving at or
 *    above `CRUSH.minSpeed`, flattens a live `EntityKind.Infantry` carrying
 *    `EntityFlag.Crushable` whose `crushableBy` is non-zero and no greater
 *    than that level. `crushesUnit` in §2 is the ONE function that says so;
 *    nothing re-derives it. A Grizzly (3) flattens every rifleman in the game
 *    (1); an Apocalypse (`crushableBy: 0`) is flattened by nothing, because 0
 *    means UNCRUSHABLE for a unit. That is the exact opposite of what 0 means
 *    for a prop — see `CRUSH.propDefaultLevel`, and do not merge the two.
 *
 * 2. NEVER YOUR OWN. `w.areAllied` gates it, matching how DIRECT harm behaves
 *    everywhere else in the sim: `Targeting.ts:401` will not acquire an ally,
 *    `Projectiles.ts:352` will not detonate on one, `Combat.ts:741` skips
 *    them. The one place friendly fire is real is SPLASH, and there it is
 *    halved rather than waived (`Damage.applySplash`) — a blast cannot pick
 *    its victims and a driver can. There is no half of an instant death to
 *    apply, so the rule is the direct-harm one.
 *
 * 3. IT IS A KILL, NOT A DELETION. The prop path above uses `store.markDead`,
 *    which is right for a tree and wrong for a man: it skips the armour
 *    matrix, the `entity:damaged` event, the kill credit and the veterancy
 *    promotion, all of which live inside `Damage.applyOne`. So a crushed
 *    soldier is pushed onto `channels.damage` exactly as a bullet would be —
 *    same queue, same drain, same `Damage.onDeath` giving him the body, the
 *    puff and `EvaLine.UnitLost`, same `unitsLost`/`unitsKilled` accounting.
 *    `Phase.Movement` is upstream of `Phase.Damage`, so it lands on the SAME
 *    tick and nothing observes a man who is half crushed.
 *
 *    The amount is `hp` divided BACK through the armour multiplier, so the
 *    matrix row is a formality and the kill is exact rather than an overkill
 *    number: `audio.system.ts` drives combat-music intensity off the damage
 *    actually dealt, and a 10x "make sure" figure would spike it.
 *
 * 4. THE HULL HAS TO GET THERE. Two systems used to stop it, and a measured
 *    probe put a Grizzly's closest approach to a standing rifleman at 2.83 m
 *    against the 2.19 m its own hull disc needs — so the rule above would
 *    have been correct and unreachable. `Steering` leaned the tank around him
 *    and inherited his walking pace as a queue brake; `Movement.relax` then
 *    held the two discs 3.02 m apart as a hard constraint. Both now call
 *    `crushPassesThrough` and skip the pair. A hull does not steer around,
 *    brake for, or bounce off a man it is entitled to drive over — and that
 *    carve-out is gated on the same `minSpeed` as the kill, so a PARKED tank
 *    still shoves infantry aside rather than letting them stand inside it.
 *
 * WHAT IS DELIBERATELY NOT HERE
 * -----------------------------
 * AUTO-SCATTER. `OrderKind.Scatter` and `planScatter` exist, and having the
 * victim dodge was considered and rejected on two counts. The first is that
 * there is no order stack: `OrderExecutor.write` overwrites `orderX`/`orderZ`
 * and nothing restores them, so a sim-issued dodge silently cancels whatever
 * the player told that squad to do — a crush would become a movement bug with
 * no visible cause. The second kills the idea outright in multiplayer:
 * `net.system.ts` harvests the command ring at `Phase.Command` ORDER 0 of the
 * NEXT tick and ships whatever it finds to the relay, and the relay rewrites
 * `player` to the slot of the socket that sent it. A dodge the sim generated
 * for player 1 would therefore arrive stamped player 0 from one client and
 * player 1 from the other, and `OrderExecutor` drops a command whose owner does
 * not match — applied on one machine, dropped on the other, which is a desync
 * with no findable cause. Scatter is a PLAYER verb; it is already on a hotkey
 * (`input.system.ts:880`) and that is where it belongs.
 *
 * THE STAIN, WHICH IS NOW REAL. This paragraph used to record `DecalKind.Squish`
 * as deliberately unmapped: the field enum had no counterpart, so `vfx.system.ts`
 * dropped the kind and nothing here pushed a decal that was known to be
 * swallowed. That was the right call for a mark nobody had drawn, and the wrong
 * end state — a tank drove over a man, the counter moved, the crunch played, and
 * the ground was untouched. `world/Decals.ts` owns atlas tile 10 now (a pressed
 * strip carrying the same cleat rhythm as the tread marks, oriented to the
 * CRUSHER's heading), the port maps it, and `runDown` stamps it. It goes through
 * `world.vfx`, which is a RENDER port and a null object in a headless sim, so it
 * costs the simulation nothing and cannot perturb a replay.
 *
 * ONLY INFANTRY. `squish()` below is the PROP path — a felled tree gets splinters
 * and a puff, and pressing a track print into the ground where a hedge was is a
 * claim about what happened that is not true.
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
 * `npm run soak` are unaffected. The infantry half adds no state and no random
 * draw either: the damage record it queues is a pure function of the victim's
 * `hp` and armour class, and it enters the same queue in the same order every
 * run.
 *
 * SAVES
 * -----
 * Crushing is permanent for the match and it SURVIVES A LOAD, but nothing here
 * records it: this file keeps no ledger and pushes nothing extra into a save.
 * `Scatter` §3.10b hands `SaveGame` one bit per prop placement, which is the
 * felled state itself rather than a log of the events that produced it, so the
 * sim path stays allocation-free and there is nothing to keep in step. Do NOT
 * add a per-crush record here; it was measured and rejected. See that section.
 * ============================================================================
 */

import {
  ArmorClass, DecalKind, EntityFlag, EntityKind, Faction, FxKind, NONE, WarheadClass,
} from '../core/types';
import type { PlayerId, SimContext } from '../core/types';
import type { World } from '../core/world';
import type { Channels } from '../core/events';
import { MAX_QUERY_RESULTS, SQUISH_HALF_SIZE } from '../core/config';
import { getScatter } from '../world/Scatter';
import { armorMultiplier } from './Damage';

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
  /**
   * The row of the armour matrix a crushed man is resolved through.
   *
   * `SmallArms` for its Infantry column, which is 1.00, because that is the
   * only column this rule can reach — `EntityFlag.Crushable` is authored on
   * foot units and on props and on nothing else. The amount is divided BACK
   * through the multiplier at the call site, so the row is a formality and
   * cannot change the outcome. It still selects the `entity:damaged` warhead
   * and it is not `Tesla`, which is the one row `Damage.pushImpactFx` treats
   * specially.
   *
   * If a `setArmorMatrix` table ever put a ZERO in [SmallArms][Infantry] a
   * tank track would stop being lethal. `tests/crush-infantry.spec.ts` pins
   * the kill, which is the only mechanism that would catch it.
   */
  warhead: WarheadClass.SmallArms,
  /**
   * Height above the victim's origin at which the crunch is spawned.
   *
   * `Damage.estimatedHeight` puts a rifleman at 2.2 m and the FX belongs at
   * ground level, under the tracks — this is a body being flattened, not a
   * chest hit.
   */
  squishY: 0.35,
  /**
   * Half-size of the ground mark, as a fraction of the CRUSHER's collision disc.
   *
   * The crusher's, not the victim's: the print is made by the track, so an
   * Apocalypse leaves a wider one than a Grizzly and a rifleman's 0.23 m
   * footprint has nothing to do with it. A Grizzly's disc is 2.79 m
   * (`hullRadius` = max(l,w) * 0.45), so 0.34 of it is a 1.9 m square patch —
   * inside which the tile draws a strip ~1.0 m across and ~1.7 m long. Compare
   * the tread stamp it lands between: `TREAD_HALF_WIDTH` 0.42 is a 0.84 m strip.
   * `SQUISH_HALF_SIZE` floors it so a light hull still prints a track's width.
   */
  stainFrac: 0.34,
} as const;

/* ==========================================================================
 * 2. THE PAIR RULE
 *
 * ONE PREDICATE, THREE READERS. The kill below, the collision carve-out in
 * `Movement.relax` and the steering carve-out in `SteeringSolver` all have to
 * agree about who may drive over whom, and the cost of them disagreeing is not
 * a wrong number — it is a rule that is correct and unreachable, which is
 * exactly what a measured probe found before these two functions existed (part
 * 4 of THE INFANTRY RULE). So the answer is computed here and nowhere else.
 * ========================================================================== */

/**
 * May the hull in slot `i` drive over the unit in slot `j`?
 *
 * Deliberately does NOT test speed or distance: this is the ENTITLEMENT, and
 * the two carve-outs need it before contact. `crushPassesThrough` adds the
 * speed gate; `CrushResolver.crushUnder` adds the distance one.
 */
export function crushesUnit(w: World, i: number, j: number): boolean {
  if (i === j) return false;
  const st = w.store;

  /* -- the hull ------------------------------------------------------------
   * `EntityKind.Vehicle` first, mirroring `CrushResolver.simTick`, which walks
   * `byKind[Vehicle]` and therefore could never visit any other crusher. Said
   * out loud here so this predicate cannot answer yes about a pair the
   * resolver would never look at — the two carve-outs believe it.            */
  if (st.kind[i] !== EntityKind.Vehicle) return false;
  const f = st.flags[i];
  if ((f & EntityFlag.Alive) === 0) return false;
  if ((f & (EntityFlag.PendingDestroy | EntityFlag.Garrisoned)) !== 0) return false;
  if ((f & EntityFlag.Crusher) === 0) return false;
  const level = st.crushLevel[i];
  if (level === 0) return false;

  /* -- the man ------------------------------------------------------------
   * `EntityKind.Infantry` and not merely the flag. Widening this to whatever
   * happens to carry `Crushable` is how a future roster edit would quietly
   * start deleting vehicles; see WHAT DOES NOT in the header.               */
  if (st.kind[j] !== EntityKind.Infantry) return false;
  const jf = st.flags[j];
  if ((jf & EntityFlag.Alive) === 0) return false;
  if ((jf & (EntityFlag.PendingDestroy | EntityFlag.Garrisoned)) !== 0) return false;
  if ((jf & EntityFlag.Crushable) === 0) return false;

  // 0 IS UNCRUSHABLE FOR A UNIT — the documented meaning of the column, and
  // what keeps an Apocalypse (`crushableBy: 0`) safe from everything. It means
  // the opposite for a prop, whose column no spawn path writes at all; that
  // asymmetry is `CRUSH.propDefaultLevel` and it must not leak into here.
  const need = st.crushableBy[j];
  if (need === 0 || need > level) return false;

  // Direct harm never touches an ally. See part 2 of the header.
  return !w.areAllied(st.owner[i] as PlayerId, st.owner[j] as PlayerId);
}

/**
 * Must this pair be allowed to occupy the same ground this tick?
 *
 * Symmetric, because both `Movement.relax` and `SteeringSolver` evaluate a
 * pair once from each side and a one-sided answer would let the victim slide
 * out from under a hull that is not allowed to slide away from him.
 *
 * Gated on the crusher actually ROLLING, and on the same threshold as the
 * kill: a parked tank is not entitled to anything, so it keeps its collision
 * and shoves infantry aside instead of letting them stand inside its hull.
 */
export function crushPassesThrough(w: World, a: number, b: number): boolean {
  const st = w.store;
  // FAST OUT, and it earns its place: this runs inside `Movement.relax`'s
  // neighbour loop (12 candidates x 2 iterations per mover) and inside the
  // steering scan, so it is asked about roughly ten thousand pairs a tick and
  // says no to almost all of them. `crushesUnit` requires a Vehicle on one side
  // and Infantry on the other, so two hulls — or two men — cannot be a crush
  // pair, and that is two typed-array reads instead of twenty.
  const aVehicle = st.kind[a] === EntityKind.Vehicle;
  if (aVehicle === (st.kind[b] === EntityKind.Vehicle)) return false;

  if (aVehicle) return st.speed[a] >= CRUSH.minSpeed && crushesUnit(w, a, b);
  return st.speed[b] >= CRUSH.minSpeed && crushesUnit(w, b, a);
}

/* ==========================================================================
 * 3. THE RESOLVER
 * ========================================================================== */

export class CrushResolver {
  /** Entity props flattened this match. */
  public crushedProps = 0;
  /** Scatter instances flattened this match. */
  public crushedScatter = 0;
  /**
   * Infantry run down this match.
   *
   * Counted where the damage record is QUEUED, not where the man dies, so it
   * is the number of crushes this file caused and not the number of deaths
   * `Damage` resolved — those differ by anything that was already dying.
   */
  public crushedUnits = 0;
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

    /* -- 1. entity props and infantry -------------------------------------
     * ONE query, two victim kinds. `queryCircleFat` accepts a candidate when
     * the discs touch, which is the test we want; the exact compare below is
     * still done per branch so a future change to the broadphase cannot
     * quietly widen the kill. `maxPerTick` is shared on purpose — it bounds
     * the WORK a single hull does in a tick, and a hull inside a copse and a
     * hull inside a squad are the same worst case.                          */
    const found = w.spatial.queryCircleFat(px, pz, hull, this.scratch);
    for (let k = 0; k < found && victims < CRUSH.maxPerTick; k++) {
      const j = this.scratch[k];
      if (j === i) continue;
      const jk = st.kind[j];

      if (jk === EntityKind.Infantry) {
        // The whole entitlement — kinds, flags, levels, allegiance — lives in
        // ONE place, because `Steering` and `Movement.relax` have to agree
        // with it or the hull never arrives. See §2.
        if (!crushesUnit(w, i, j)) continue;
        const dx = st.posX[j] - px;
        const dz = st.posZ[j] - pz;
        const want = hull + st.radius[j];
        if (dx * dx + dz * dz >= want * want) continue;
        this.runDown(i, j);
        victims++;
        continue;
      }

      if (jk !== EntityKind.Prop) continue;
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
   * One man, under the tracks.
   *
   * NOT `store.markDead`. A tree is deleted; a soldier is KILLED, and every
   * consequence of a kill — the armour matrix, `entity:damaged`, kill credit,
   * the veterancy promotion, `unitsLost`/`unitsKilled`, the death puffs from
   * `Damage.infantryDeath`, `EvaLine.UnitLost` — lives behind
   * `channels.damage`. Pushing onto that queue is how every weapon in the game
   * kills something and it is how this does too; only the source of the record
   * differs. `Phase.Movement` is upstream of `Phase.Damage`, so it resolves on
   * this tick.
   *
   * THE AMOUNT IS EXACT. `hp` divided back through the multiplier the matrix
   * will apply, plus one, so the outcome does not depend on which warhead row
   * was chosen and the figure that reaches `entity:damaged` is the damage a
   * crush really did. `audio.system.ts` sizes its combat-intensity heuristic
   * off that number — an overkill "make sure" value would read as a firefight.
   */
  private runDown(i: number, j: number): void {
    const st = this.world.store;
    const mult = armorMultiplier(CRUSH.warhead, st.armorClass[j] as ArmorClass);
    // Zero only if a `setArmorMatrix` table waived this row entirely; see
    // `CRUSH.warhead`. Leaving the man standing is the safe failure, and
    // `tests/crush-infantry.spec.ts` is what stops it happening unnoticed.
    if (mult <= 0) return;

    this.channels.damage.push(
      st.handleOf(j), st.handleOf(i), st.hp[j] / mult + 1, CRUSH.warhead,
      st.posX[j], st.posY[j], st.posZ[j], 0, 0,
    );

    // The crunch, and the sound: `audio/Weapons.ts` maps `FxKind.CrushSquish`
    // to `SFX.crush`, which is backed by `public/audio/sfx/crush.squish.*.ogg`.
    // Pushed directly rather than through `squish()` because that gate is a
    // PROP gate — a rifleman's collision disc is 0.23 m, well under
    // `minSquishRadius`, and a man is a man-sized crunch whatever his
    // footprint says. His OWN faction, matching `Damage.infantryDeath`: the FX
    // channel keys palette off it and this is his death, not the driver's.
    this.channels.fx.push(
      FxKind.CrushSquish,
      st.posX[j], st.posY[j] + CRUSH.squishY, st.posZ[j],
      0, 1, 0, 1, st.handleOf(j), st.faction[j] as Faction,
    );

    // THE MARK. `world.vfx` is the RENDER port — a null object in every headless
    // sim test — so this is free of the simulation and cannot move a replay. The
    // yaw is the CRUSHER's, so the print lands square with the tread strips its
    // own tracks are laying either side of it; the size is the crusher's hull,
    // for the reason in `CRUSH.stainFrac`.
    this.world.vfx.decal(
      DecalKind.Squish, st.posX[j], st.posZ[j],
      st.yaw[i], Math.max(SQUISH_HALF_SIZE, st.radius[i] * CRUSH.stainFrac),
    );
    this.crushedUnits++;
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
    this.crushedUnits = 0;
    this.lastCrushed = 0;
  }
}

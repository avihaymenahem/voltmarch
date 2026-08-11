/**
 * ============================================================================
 * src/sim/Transport.ts — INFANTRY RIDE INSIDE VEHICLES
 * ============================================================================
 *
 * `EntityFlag.Garrisoned` has said "Inside a transport or a garrison" since the
 * contract layer was written, `OrderKind.Enter` has resolved from a right-click
 * onto a friendly hull since `input/Commands.ts` was written, and
 * `roleResolver().transportCapacity()` has been asked and answered on the way
 * to that order. The one thing missing was a consumer: `sim/Garrison.ts:248`
 * rejected any target that was not a `Building` and cleared the order, so the
 * Hover Transport — a unit whose entire blurb is "Carries a squad across water"
 * — could not carry anything. This is the consumer.
 *
 * WHAT A TRANSPORT IS HERE
 * ------------------------
 * A vehicle whose def sets `passengers > 0`. Infantry walk to it, vanish from
 * the field, and ride. The hull is the only thing on the map; killing it kills
 * everyone aboard. `OrderKind.Unload` puts them back on the ground around it.
 *
 * PASSENGERS DO NOT SHOOT, AND THAT IS THE DESIGN
 * ----------------------------------------------
 * A garrisoned building volleys with the sum of its occupants' rifles, and
 * `GarrisonService.weaponsTick` goes to real trouble to make that one target
 * scan rather than five. A transport deliberately does none of it:
 *
 *   - The hull already has its own `weaponIndex` and its own turret. Merging a
 *     passenger volley into a unit that is ALSO firing means two damage records
 *     per tick from one entity, at two different ranges, off one cooldown.
 *   - A garrison is a fixed firing position. A transport is a delivery, and a
 *     transport that fights as well as it carries is strictly better than the
 *     tank it drove past.
 *
 * So the carried squad is inert until it lands. That is what the Hover
 * Transport's blurb promises and it is the whole verb.
 *
 * WHO OWNS AN `Enter` ORDER
 * -------------------------
 * Both services scan for it at `Phase.Cleanup`, and the split is by TARGET KIND
 * rather than by whoever runs first:
 *
 *   Garrison (order -400)   target is a Building     -> mine
 *   Transport (order -395)  target is anything else  -> mine
 *
 * Each one `continue`s past an order it does not own rather than clearing it,
 * because clearing is how the order silently died for four months. A target
 * that no longer exists is cleared by whichever service reaches it first; that
 * is idempotent, so the ordering does not matter.
 *
 * THE BODIES RIDE ALONG
 * ---------------------
 * `GarrisonService.enter` parks an occupant at its host's centre once, because
 * a building does not move. A transport does, so passengers are re-parked on
 * the hull EVERY tick. Nothing targets them (`TARGETABLE_REJECT_MASK` carries
 * `Garrisoned`) and nothing moves them (`Movement`, `Steering`, `Vision`,
 * `Crush`, `Damage` and `Regen` all skip the flag), so this buys exactly one
 * thing and it is the thing that matters: when the hull dies in the middle of
 * the sea, the squad dies in the middle of the sea, and when it unloads the men
 * appear beside it rather than beside the beach they boarded from.
 *
 * UNLOADING PICKS GROUND INFANTRY CAN STAND ON
 * --------------------------------------------
 * A ring around the hull, `Locomotor.Foot`-passable and unoccupied, widening by
 * a fixed step until it finds room. A naval transport is by definition sitting
 * on water when it arrives, so a garrison-style unconditional ring would drown
 * the squad it just ferried. If NOTHING within `UNLOAD_RINGS` works the men
 * stay aboard and the order is refused — a transport that cannot find a beach
 * keeps its cargo rather than deleting it.
 *
 * DETERMINISM
 * -----------
 * No wall clock and no RNG. The ring is walked in a fixed order, ties break on
 * that order, and every scan iterates `store.byKind` in slot order, so two runs
 * of one seed load and unload the same men into the same positions.
 *
 * NOT SAVED. `hostOf` is service state and `game/SaveGame.ts` does not persist
 * it — exactly as it does not persist garrison occupancy. Loading a save puts
 * every passenger back on the field where it stands. Fixing that means a real
 * store column and a save-format bump, and it should fix both services at once.
 * ============================================================================
 */

import type { Channels } from '../core/events';
import type { World } from '../core/world';
import { PerEntityU32 } from '../core/world';
import {
  EntityFlag, EntityKind, FxKind, Locomotor, NONE, OrderKind, UnitState,
} from '../core/types';
import type { DefTables, EntityId, Faction, PlayerId, SimContext } from '../core/types';
import { MAX_ENTITIES } from '../core/config';
import { isInMap, worldToCell } from '../core/math';

/* ==========================================================================
 * 1. TUNING
 * ========================================================================== */

export const TRANSPORT = {
  /** Metres of clearance beyond the hull radius that counts as "at the ramp". */
  reachMetres: 2.6,
  /** Metres from the hull centre the first unload ring sits at. */
  unloadInsetMetres: 1.4,
  /** Metres each successive ring adds. */
  unloadRingStepMetres: 2.2,
  /** How many rings are tried before the unload is refused. */
  unloadRings: 4,
  /** Candidate positions per ring. Walked in a fixed order, so ties are stable. */
  unloadSpokes: 8,
} as const;

/* ==========================================================================
 * 2. PUBLIC SHAPES
 * ========================================================================== */

export interface TransportStats {
  /** Hulls carrying at least one passenger. */
  loaded: number;
  /** Total men riding. */
  riding: number;
  boarded: number;
  unloaded: number;
  /** Unload orders refused because no ring had standable ground. */
  unloadRefusals: number;
  /** Men lost with the hull they were riding in. */
  drowned: number;
}

/** Why a unit cannot board. Empty string when it can. */
export type BoardRefusal =
  | '' | 'not a transport' | 'gone' | 'not infantry' | 'hostile' | 'full';

/* ==========================================================================
 * 3. THE SERVICE
 * ========================================================================== */

/**
 * Scratch for the per-tick tally, keyed by host SLOT and cleared by
 * touched-list so the reset is O(hulls) rather than O(MAX_ENTITIES). Same
 * shape, and for the same reason, as `Garrison.ts`'s `OCC_COUNT`/`TOUCHED`.
 */
const RIDER_COUNT = new Int32Array(MAX_ENTITIES);
const RIDER_TOUCHED = new Int32Array(MAX_ENTITIES);

export class TransportService {
  readonly stats: TransportStats = {
    loaded: 0, riding: 0, boarded: 0, unloaded: 0, unloadRefusals: 0, drowned: 0,
  };

  /** For a passenger: the hull's handle. 0 when not aboard anything. */
  private readonly hostOf: PerEntityU32;

  /**
   * Seats per unit def, resolved once from the def tables.
   *
   * Int8 because five is the largest number in the roster and a seat count that
   * needed more than 127 would be a content bug rather than a range problem.
   * Empty until `bindDefs`, which answers 0 for everything — the honest reading
   * of "no def tables are installed", and the same shape `Garrison`'s
   * `fallbackWeapon` uses for the same reason.
   */
  private seatsByDef: Int8Array = new Int8Array(0);

  private unhookKilled: (() => void) | null = null;

  constructor(
    private readonly world: World,
    private readonly channels: Channels,
  ) {
    this.hostOf = new PerEntityU32(world.store, 0);
  }

  /** Publish the seat counts. Called once at init, from the def binding. */
  bindDefs(tables: DefTables): void {
    const units = tables.units;
    const seats = new Int8Array(units.length);
    for (let d = 0; d < units.length; d++) {
      const p = units[d].passengers;
      seats[d] = p > 127 ? 127 : p < 0 ? 0 : p | 0;
    }
    this.seatsByDef = seats;
  }

  /** Wire into the rest of the sim. Kept out of the constructor, as Garrison is. */
  attach(): void {
    // The hull goes, everyone riding in it goes with it. There is no bailout:
    // a squad that survives the transport being shot out from under it makes
    // the transport free, and every game in this genre sinks the passengers.
    this.unhookKilled = this.channels.events.on('entity:killed', (ev) => {
      if (ev.kind === EntityKind.Building) return;
      this.killPassengers(ev.id);
    });
  }

  /* -- queries ----------------------------------------------------------- */

  /** Seats on the hull in slot `i`. 0 when it is not a transport. */
  capacityAt(i: number): number {
    const st = this.world.store;
    if (st.kind[i] === EntityKind.Building) return 0;
    const d = st.defId[i];
    return d >= 0 && d < this.seatsByDef.length ? this.seatsByDef[d] : 0;
  }

  /** Seats on `hull`. 0 when it is gone or is not a transport. */
  capacity(hull: EntityId): number {
    const i = this.world.store.index(hull);
    return i < 0 ? 0 : this.capacityAt(i);
  }

  /** The hull this unit is riding in, or NONE. */
  hostOfUnit(unit: EntityId): EntityId {
    const h = this.hostOf.get(unit) as EntityId;
    return this.world.store.index(h) >= 0 ? h : NONE;
  }

  /** How many men are aboard `hull` right now. O(infantry), called rarely. */
  passengerCount(hull: EntityId): number {
    const st = this.world.store;
    const b = st.index(hull);
    return b < 0 ? 0 : this.passengerCountAt(b);
  }

  private passengerCountAt(b: number): number {
    const st = this.world.store;
    const list = st.byKind[EntityKind.Infantry];
    const n = st.byKindCount[EntityKind.Infantry];
    let count = 0;
    for (let a = 0; a < n; a++) {
      const i = list[a];
      if ((st.flags[i] & EntityFlag.Garrisoned) === 0) continue;
      if (st.index(this.hostOf.getAt(i) as EntityId) === b) count++;
    }
    return count;
  }

  /** Passenger handles into `out`. Returns how many were written. */
  passengers(hull: EntityId, out: Int32Array): number {
    const st = this.world.store;
    const b = st.index(hull);
    if (b < 0) return 0;
    const list = st.byKind[EntityKind.Infantry];
    const n = st.byKindCount[EntityKind.Infantry];
    let count = 0;
    for (let a = 0; a < n && count < out.length; a++) {
      const i = list[a];
      if ((st.flags[i] & EntityFlag.Garrisoned) === 0) continue;
      if (st.index(this.hostOf.getAt(i) as EntityId) !== b) continue;
      out[count++] = st.handleOf(i) as number;
    }
    return count;
  }

  /** '' when the unit in slot `i` may board `hull`, otherwise the reason. */
  refusalFor(hull: EntityId, i: number): BoardRefusal {
    const w = this.world;
    const st = w.store;
    const b = st.index(hull);
    if (b < 0) return 'gone';
    const hf = st.flags[b];
    if ((hf & EntityFlag.Alive) === 0 || (hf & EntityFlag.PendingDestroy) !== 0) return 'gone';

    const seats = this.capacityAt(b);
    if (seats <= 0) return 'not a transport';
    // Vehicles do not ride inside vehicles. `passengerCountAt` counts the
    // infantry list and nothing else, so admitting one would make the seat
    // accounting lie in a way nothing downstream could detect.
    if (st.kind[i] !== EntityKind.Infantry) return 'not infantry';
    if (!w.areAllied(st.owner[i] as PlayerId, st.owner[b] as PlayerId)) return 'hostile';
    if (this.passengerCountAt(b) >= seats) return 'full';
    return '';
  }

  /** True when the hull in slot `i` has somebody to put down. */
  isLoadedAt(i: number): boolean {
    return this.capacityAt(i) > 0 && this.passengerCountAt(i) > 0;
  }

  /* -- the tick (Phase.Cleanup) ------------------------------------------ */

  simTick(_s: SimContext): void {
    this.board();
    this.ride();
    this.unloadOrders();
  }

  /**
   * Walk every infantryman with a live `Enter` order onto its hull.
   *
   * The order point is rewritten to the hull's CURRENT position every tick, so
   * a squad chases a transport that is still moving instead of walking to where
   * it used to be. That is the one behaviour a garrison never needs.
   */
  private board(): void {
    const st = this.world.store;
    const list = st.byKind[EntityKind.Infantry];
    const count = st.byKindCount[EntityKind.Infantry];

    for (let a = 0; a < count; a++) {
      const i = list[a];
      const f = st.flags[i];
      if ((f & EntityFlag.Alive) === 0) continue;
      if ((f & (EntityFlag.PendingDestroy | EntityFlag.Garrisoned)) !== 0) continue;
      if ((st.orderKind[i] as OrderKind) !== OrderKind.Enter) continue;

      const target = st.orderTarget[i] as EntityId;
      const t = st.index(target);
      if (t < 0) { this.clearOrder(i); continue; }
      // A Building target belongs to GarrisonService, which ran 5 slots ago.
      if (st.kind[t] === EntityKind.Building) continue;

      if (this.refusalFor(target, i) !== '') { this.clearOrder(i); continue; }

      st.orderX[i] = st.posX[t];
      st.orderZ[i] = st.posZ[t];
      st.state[i] = UnitState.Moving;

      if (!this.withinReach(i, t)) continue;
      this.embark(i, t);
    }
  }

  /** Move one man aboard. */
  private embark(i: number, t: number): void {
    const st = this.world.store;
    const host = st.handleOf(t);

    st.flags[i] |= EntityFlag.Garrisoned | EntityFlag.Immobilized;
    st.state[i] = UnitState.Idle;
    st.orderKind[i] = OrderKind.None;
    st.orderTarget[i] = 0;
    st.velX[i] = 0; st.velZ[i] = 0; st.speed[i] = 0;
    this.hostOf.setAt(i, host as number);
    this.carry(i, t);

    this.channels.fx.push(
      FxKind.DustPuff, st.posX[t], st.posY[t] + 0.6, st.posZ[t],
      0, 1, 0, 0.7, host, st.faction[t] as Faction,
    );
    this.stats.boarded++;
  }

  /**
   * Drag every passenger to its hull, and count what is riding.
   *
   * Also the recovery path for a passenger whose host vanished without an
   * `entity:killed` — a save load, a `flushDestroyed` race, a service disposed
   * mid-match. `RenderBridge.ts:765` already calls out that an entity left
   * carrying `Garrisoned` after its host is gone is alive, immobile and
   * invisible, which is the worst state in the game to leave a unit in.
   */
  private ride(): void {
    const st = this.world.store;
    const list = st.byKind[EntityKind.Infantry];
    const n = st.byKindCount[EntityKind.Infantry];
    let men = 0;
    let touched = 0;

    for (let a = 0; a < n; a++) {
      const i = list[a];
      const f = st.flags[i];
      if ((f & EntityFlag.Garrisoned) === 0) continue;
      if ((f & EntityFlag.PendingDestroy) !== 0) continue;
      const held = this.hostOf.getAt(i) as EntityId;
      if ((held as number) === 0) continue;          // a garrisoned man, not ours
      const t = st.index(held);
      if (t < 0) { this.strand(i); continue; }
      // THE HULL IS ALREADY DYING, AND CATCHING IT HERE IS WHAT MAKES THE SQUAD
      // COUNT. `Phase.Damage` (1200) stamps `PendingDestroy`; this runs at
      // Phase.Cleanup order -395; `Damage.cleanupTick` runs at Phase.Cleanup
      // order 0 and scans the alive list for that flag, emitting exactly one
      // `entity:killed` per corpse whatever killed it. Marking the passengers
      // HERE therefore puts them in front of that scan, so each one gets its
      // own event, its own "unit lost" and its own scoreboard entry.
      //
      // Doing it from the `entity:killed` hook alone would not: that hook fires
      // from inside the death scan's own loop, so a passenger whose slot index
      // sits EARLIER in the alive list than its hull's has already been walked
      // past, and `flushDestroyed()` would free it in the same call with no
      // event ever emitted. The hook stays as the backstop for a hull killed
      // outside the tick, where this pass has not run.
      if ((st.flags[t] & EntityFlag.PendingDestroy) !== 0) { this.sink(i); continue; }

      this.carry(i, t);
      men++;
      // DISTINCT hulls, not adjacent runs: `byKind` is walked in slot order and
      // one hull's passengers are nowhere near each other in it, so comparing
      // against the previous slot would count the same transport repeatedly.
      if (RIDER_COUNT[t] === 0 && touched < RIDER_TOUCHED.length) {
        RIDER_TOUCHED[touched++] = t;
      }
      RIDER_COUNT[t]++;
    }

    this.stats.riding = men;
    this.stats.loaded = touched;
    for (let k = 0; k < touched; k++) RIDER_COUNT[RIDER_TOUCHED[k]] = 0;
  }

  /** Park a passenger's body on its hull. */
  private carry(i: number, t: number): void {
    const st = this.world.store;
    st.posX[i] = st.posX[t];
    st.posY[i] = st.posY[t];
    st.posZ[i] = st.posZ[t];
    st.prevX[i] = st.posX[t];
    st.prevY[i] = st.posY[t];
    st.prevZ[i] = st.posZ[t];
    st.orderX[i] = st.posX[t];
    st.orderZ[i] = st.posZ[t];
    st.guardX[i] = st.posX[t];
    st.guardZ[i] = st.posZ[t];
  }

  /** Consume every standing `OrderKind.Unload`. */
  private unloadOrders(): void {
    const st = this.world.store;
    const list = st.byKind[EntityKind.Vehicle];
    const n = st.byKindCount[EntityKind.Vehicle];

    for (let a = 0; a < n; a++) {
      const i = list[a];
      if ((st.orderKind[i] as OrderKind) !== OrderKind.Unload) continue;
      if ((st.flags[i] & EntityFlag.PendingDestroy) !== 0) { this.clearOrder(i); continue; }
      const put = this.unload(st.handleOf(i));
      // A refusal leaves the order standing for exactly one more tick, so a
      // transport told to unload while still over water puts its squad down the
      // moment it touches a coast rather than dropping the order on the floor.
      if (put > 0 || this.passengerCountAt(i) === 0) this.clearOrder(i);
    }
  }

  /* -- leaving ----------------------------------------------------------- */

  /**
   * Put everybody on the ground around `hull`. Returns how many got out.
   *
   * All-or-nothing per man, not per hull: if the fourth passenger finds no
   * standable cell the first three still landed, and the fourth rides on. The
   * alternative — refuse unless everyone fits — strands a full transport on a
   * narrow beach forever.
   */
  unload(hull: EntityId): number {
    const st = this.world.store;
    const b = st.index(hull);
    if (b < 0) return 0;

    const list = st.byKind[EntityKind.Infantry];
    const n = st.byKindCount[EntityKind.Infantry];
    let out = 0;
    let refused = 0;
    for (let a = 0; a < n; a++) {
      const i = list[a];
      if ((st.flags[i] & EntityFlag.Garrisoned) === 0) continue;
      if (st.index(this.hostOf.getAt(i) as EntityId) !== b) continue;
      if (this.place(i, b, out)) out++;
      else refused++;
    }
    this.stats.unloaded += out;
    if (refused > 0 && out === 0) this.stats.unloadRefusals++;
    return out;
  }

  /**
   * Put one man down on the first standable cell of a widening ring.
   *
   * `ordinal` rotates the starting spoke so five men do not all try the same
   * cell and stack on the same metre. Returns false when nothing in
   * `unloadRings` rings works — the man stays aboard.
   */
  private place(i: number, b: number, ordinal: number): boolean {
    const st = this.world.store;
    const world = this.world;
    const spokes = TRANSPORT.unloadSpokes;
    const base = st.radius[b] + TRANSPORT.unloadInsetMetres;

    for (let ring = 0; ring < TRANSPORT.unloadRings; ring++) {
      const r = base + ring * TRANSPORT.unloadRingStepMetres;
      for (let s = 0; s < spokes; s++) {
        const spoke = (s + ordinal) % spokes;
        const angle = (spoke / spokes) * Math.PI * 2;
        const px = st.posX[b] + Math.sin(angle) * r;
        const pz = st.posZ[b] + Math.cos(angle) * r;
        const cx = worldToCell(px);
        const cz = worldToCell(pz);
        if (!isInMap(cx, cz)) continue;
        // Foot passability is the whole point: a naval transport is sitting ON
        // WATER when it arrives, and a garrison-style unconditional ring would
        // put the squad it just ferried into the sea.
        if (!world.terrain.isPassable(cx, cz, Locomotor.Foot)) continue;
        if (world.terrain.isOccupied(cx, cz)) continue;
        this.disembark(i, px, pz);
        return true;
      }
    }
    return false;
  }

  /** Put one man back on the field at a validated point. */
  private disembark(i: number, px: number, pz: number): void {
    const st = this.world.store;
    st.flags[i] &= ~(EntityFlag.Garrisoned | EntityFlag.Immobilized);
    st.posX[i] = px; st.posZ[i] = pz;
    st.posY[i] = this.world.terrain.heightAt(px, pz);
    st.prevX[i] = px; st.prevZ[i] = pz; st.prevY[i] = st.posY[i];
    st.orderX[i] = px; st.orderZ[i] = pz;
    st.guardX[i] = px; st.guardZ[i] = pz;
    st.orderKind[i] = OrderKind.None;
    st.orderTarget[i] = 0;
    st.state[i] = UnitState.Idle;
    st.velX[i] = 0; st.velZ[i] = 0; st.speed[i] = 0;
    this.hostOf.clear(st.handleOf(i));
  }

  /**
   * A passenger whose hull is gone but which never got an `entity:killed`.
   *
   * Dropped where it stands rather than killed: this path is reached by save
   * loads and disposal, not by combat, and deleting a squad because a service
   * was torn down would be a silent loss with no cause the player can see.
   */
  private strand(i: number): void {
    const st = this.world.store;
    this.disembark(i, st.posX[i], st.posZ[i]);
  }

  /**
   * The hull died. Everyone riding dies with it, quietly.
   *
   * The BACKSTOP, not the usual path — see the note in `ride`. Idempotent, so
   * a hull that reaches both routes in one tick sinks its squad once.
   */
  private killPassengers(hull: EntityId): void {
    const st = this.world.store;
    const b = st.index(hull);
    if (b < 0) return;
    if (this.capacityAt(b) <= 0) return;
    const list = st.byKind[EntityKind.Infantry];
    const n = st.byKindCount[EntityKind.Infantry];
    for (let a = 0; a < n; a++) {
      const i = list[a];
      if ((st.flags[i] & EntityFlag.Garrisoned) === 0) continue;
      if (st.index(this.hostOf.getAt(i) as EntityId) !== b) continue;
      this.sink(i);
    }
  }

  /**
   * One passenger goes down with the hull.
   *
   * `UnitState.Selling` is `sim/Damage.ts`'s "left the world without dying"
   * channel — no second fireball and no second wreck on top of the hull's own.
   * They still count as lost: the death scan emits `entity:killed` for every
   * corpse it finds, whatever set the flag.
   */
  private sink(i: number): void {
    const st = this.world.store;
    const h = st.handleOf(i);
    if (!st.markDead(h)) { this.hostOf.clear(h); return; }
    st.state[i] = UnitState.Selling;
    this.hostOf.clear(h);
    this.stats.drowned++;
  }

  /* -- helpers ----------------------------------------------------------- */

  private withinReach(i: number, t: number): boolean {
    const st = this.world.store;
    const dx = st.posX[i] - st.posX[t];
    const dz = st.posZ[i] - st.posZ[t];
    const reach = TRANSPORT.reachMetres + st.radius[i] + st.radius[t];
    return dx * dx + dz * dz <= reach * reach;
  }

  private clearOrder(i: number): void {
    const st = this.world.store;
    st.orderKind[i] = OrderKind.None;
    st.orderTarget[i] = 0;
    st.orderX[i] = st.posX[i];
    st.orderZ[i] = st.posZ[i];
    if (st.state[i] === UnitState.Moving) st.state[i] = UnitState.Idle;
  }

  dispose(): void {
    this.unhookKilled?.();
    this.unhookKilled = null;
  }
}

/* ==========================================================================
 * 4. MODULE ACCESSOR
 * ========================================================================== */

let active: TransportService | null = null;

export function setTransportService(next: TransportService | null): void {
  active = next;
}

export function transportService(): TransportService | null {
  return active;
}

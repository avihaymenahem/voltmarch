/**
 * ============================================================================
 * src/sim/Transport.ts — AN ARMY RIDES INSIDE A HULL
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
 * WHAT A CARRIER IS HERE
 * ----------------------
 * A vehicle whose def sets `cargoSlots > 0`. Infantry and vehicles drive to it,
 * vanish from the field, and ride. The hull is the only thing on the map;
 * killing it kills everyone aboard. `OrderKind.Unload` puts them back on the
 * ground around it.
 *
 * A SLOT IS NOT A SEAT. Infantry cost one, a vehicle costs two, so the number
 * on the def is a hold and not a bench. This started as infantry-only, and the
 * reason was honest at the time: every query here scanned
 * `byKind[EntityKind.Infantry]` and nothing else, so admitting a vehicle would
 * have made the accounting lie in a way nothing downstream could detect. Six
 * scan sites and the `'not infantry'` refusal are gone; `store.carrierId` is a
 * real column and `collect` walks both cargo kinds.
 *
 * The cost of NOT having this was not abstract. On Sunder Atoll there is no
 * land route between any two armies, so "infantry only" meant the entire
 * vehicle roster was unusable against three of your four opponents.
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
 * SAVED, AND HASHED. `store.carrierId` is a real column: `SaveGame` remaps it
 * with the other entity references and `Checksum.hashEntities` mixes it.
 *
 * It used to be a service-private `PerEntityU32`, and that was two live bugs
 * rather than a gap. A load bumps every `store.gen[i]`, so the side array's
 * stamp check failed and returned 0; `ride` skips at `held === 0`, so `strand`
 * was unreachable and every passenger in every saved game came back
 * `Alive | Garrisoned | Immobilized` with no host — unrenderable, unselectable,
 * untargetable, unmovable, permanently. And two lockstep clients that disagreed
 * about WHICH hull a man was in produced an identical checksum.
 *
 * `GarrisonService` has the sibling column `store.garrisonId`, saved and hashed
 * the same way. TWO columns and not one, so "in a building or in a hull, never
 * both" is true by construction rather than by scan order — `ride` below skips
 * a unit with no `carrierId` in one comparison, and sharing a column would send
 * every garrison occupant down this service's repair branches instead.
 * ============================================================================
 */

import type { Channels } from '../core/events';
import type { World } from '../core/world';
import {
  ENTITY_KIND_COUNT, EntityFlag, EntityKind, FxKind, NONE, OrderKind, UnitState,
} from '../core/types';
import type { DefTables, EntityId, Faction, PlayerId, SimContext } from '../core/types';
import { CELL, MAX_ENTITIES } from '../core/config';
import { isInMap, worldToCell } from '../core/math';
import { locomotorForMoveClass } from './Flowfield';
import { moveClassAt } from './Movement';
import {
  PICKUP_SETTLE_METRES, nearestBoardingWater,
} from './NavalWater';

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

/**
 * Whether boarding may divert a carrier toward a stranded passenger.
 *
 * `orderKind` is an intent ledger, not a live-state flag: Steering deliberately
 * leaves the completed order recorded after a hull becomes Idle. Reading that
 * column alone made a carrier that had ever attacked or guarded permanently
 * refuse a later pickup. Live Attacking/Guarding/etc. states still win, and an
 * explicit Unload is protected even though it is consumed while the hull is
 * idle. Carrier nesting remains rejected separately by `refusalFor`.
 */
export function carrierMayAnswerPickup(state: UnitState, order: OrderKind): boolean {
  if (order === OrderKind.Unload) return false;
  return state === UnitState.Idle || state === UnitState.Moving;
}

/**
 * What one passenger costs, by `EntityKind`.
 *
 * A slot is the unit of cargo, not a seat: infantry cost one and a vehicle
 * costs two, so an eight-slot hull is four tanks or eight riflemen or any mix
 * that adds up. Indexed by kind so there is no branch and no table lookup on
 * the hot path, and so a kind nobody thought about (a Building, a Prop) costs
 * more slots than any hull has and is therefore refused by arithmetic rather
 * than by a special case.
 */
/** A cost no hull can pay, so an ineligible kind is refused by arithmetic. */
const SLOT_COST_NEVER = 9999;

const SLOT_COST_BY_KIND = (() => {
  const t = new Int32Array(ENTITY_KIND_COUNT).fill(SLOT_COST_NEVER);
  t[EntityKind.Infantry] = 1;
  t[EntityKind.Vehicle] = 2;
  return t;
})();

/** Kind lists a passenger can be found in. Order fixes the unload order. */
const CARGO_KINDS: readonly EntityKind[] = [EntityKind.Infantry, EntityKind.Vehicle];

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
  /** Carriers diverted to collect a squad that could not walk to them. */
  pickups: number;
  /**
   * Passengers orphaned by a lost hull who found no standable ground and were
   * drowned rather than left afloat. See `strand`. A non-zero value here in a
   * normal match means hulls are being freed without `killPassengers` running.
   */
  stranded: number;
}

/** Why a unit cannot board. Empty string when it can. */
export type BoardRefusal =
  | '' | 'not a transport' | 'gone' | 'cannot ride' | 'hostile' | 'full';

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

/**
 * Scratch for `collect`. Sized well past the largest hull in the roster (eight
 * slots, so at most eight passengers) because the cost of being wrong is a
 * silently short passenger list, and re-entrancy is impossible here: every
 * caller finishes its walk before it mutates anything.
 */
const PASSENGER_SLOTS = new Int32Array(64);

/** [cx, cz] out-param for the pickup search. */
const PICKUP_CELL = new Int32Array(2);

/**
 * The tick on which each hull slot was last sent to a pickup, so five men
 * boarding one carrier issue ONE diversion between them rather than five that
 * each restart the hull's path.
 *
 * STAMPED, not cleared. `RIDER_COUNT` next to it uses a touched-list because it
 * is a COUNT and has to start each tick at zero; this is a monotonically
 * increasing stamp, so a stale entry can never equal the current epoch and
 * there is nothing to reset. That also keeps it from being half module state
 * and half instance state, which a touched-list would have made it.
 */
const PICKUP_TICK = new Int32Array(MAX_ENTITIES);
let pickupEpoch = 0;

export class TransportService {
  readonly stats: TransportStats = {
    loaded: 0, riding: 0, boarded: 0, unloaded: 0, unloadRefusals: 0, drowned: 0,
    pickups: 0, stranded: 0,
  };

  /**
   * Cargo slots per unit def, resolved once from the def tables.
   *
   * Int8 because eight is the largest number in the roster and a capacity that
   * needed more than 127 would be a content bug rather than a range problem.
   * Empty until `bindDefs`, which answers 0 for everything — the honest reading
   * of "no def tables are installed", and the same shape `Garrison`'s
   * `fallbackWeapon` uses for the same reason.
   */
  private slotsByDef: Int8Array = new Int8Array(0);

  private unhookKilled: (() => void) | null = null;

  constructor(
    private readonly world: World,
    private readonly channels: Channels,
  ) {}

  /** Publish the slot counts. Called once at init, from the def binding. */
  bindDefs(tables: DefTables): void {
    const units = tables.units;
    const slots = new Int8Array(units.length);
    for (let d = 0; d < units.length; d++) {
      const p = units[d].cargoSlots;
      slots[d] = p > 127 ? 127 : p < 0 ? 0 : p | 0;
    }
    this.slotsByDef = slots;
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

  /** Cargo slots on the hull in slot `i`. 0 when it is not a carrier. */
  capacityAt(i: number): number {
    const st = this.world.store;
    if (st.kind[i] === EntityKind.Building) return 0;
    const d = st.defId[i];
    return d >= 0 && d < this.slotsByDef.length ? this.slotsByDef[d] : 0;
  }

  /** Cargo slots on `hull`. 0 when it is gone or is not a carrier. */
  capacity(hull: EntityId): number {
    const i = this.world.store.index(hull);
    return i < 0 ? 0 : this.capacityAt(i);
  }

  /** Slots one passenger in slot `i` occupies. Infantry 1, vehicle 2. */
  slotCostAt(i: number): number {
    const k = this.world.store.kind[i];
    return k >= 0 && k < SLOT_COST_BY_KIND.length ? SLOT_COST_BY_KIND[k] : SLOT_COST_NEVER;
  }

  /** The hull this unit is riding in, or NONE. */
  hostOfUnit(unit: EntityId): EntityId {
    const st = this.world.store;
    const i = st.index(unit);
    if (i < 0) return NONE;
    const h = st.carrierId[i] as EntityId;
    return st.index(h) >= 0 ? h : NONE;
  }

  /** How many passengers are aboard `hull` right now. */
  passengerCount(hull: EntityId): number {
    const st = this.world.store;
    const b = st.index(hull);
    return b < 0 ? 0 : this.passengerCountAt(b);
  }

  private passengerCountAt(b: number): number {
    return this.collect(b, PASSENGER_SLOTS);
  }

  /** Slots CONSUMED aboard the hull in slot `b`, which is not a head count. */
  usedSlotsAt(b: number): number {
    const n = this.collect(b, PASSENGER_SLOTS);
    let used = 0;
    for (let k = 0; k < n; k++) used += this.slotCostAt(PASSENGER_SLOTS[k]);
    return used;
  }

  /** Slots consumed aboard `hull`. 0 when it is gone. */
  usedSlots(hull: EntityId): number {
    const b = this.world.store.index(hull);
    return b < 0 ? 0 : this.usedSlotsAt(b);
  }

  /** Passenger handles into `out`. Returns how many were written. */
  passengers(hull: EntityId, out: Int32Array): number {
    const st = this.world.store;
    const b = st.index(hull);
    if (b < 0) return 0;
    const n = this.collect(b, PASSENGER_SLOTS);
    let count = 0;
    for (let k = 0; k < n && count < out.length; k++) {
      out[count++] = st.handleOf(PASSENGER_SLOTS[k]) as number;
    }
    return count;
  }

  /**
   * Every passenger SLOT aboard the hull in slot `b`, into `out`.
   *
   * Walks the Infantry list and then the Vehicle list - the two kinds that can
   * be cargo - rather than `store.alive`, which would make a question asked
   * once per loaded hull per tick O(world). The kind order also fixes the
   * unload order, so two runs of one seed put the same men on the same metre.
   *
   * `carrierId` is a store column, so this is a filter and not a join against a
   * side table a save load could invalidate. That mattered: it used to be one,
   * and every passenger in every saved game came back as an invisible immortal.
   */
  private collect(b: number, out: Int32Array): number {
    const st = this.world.store;
    let n = 0;
    for (let c = 0; c < CARGO_KINDS.length; c++) {
      const kind = CARGO_KINDS[c];
      const list = st.byKind[kind];
      const count = st.byKindCount[kind];
      for (let a = 0; a < count && n < out.length; a++) {
        const i = list[a];
        if ((st.flags[i] & EntityFlag.Garrisoned) === 0) continue;
        if (st.index(st.carrierId[i] as EntityId) !== b) continue;
        out[n++] = i;
      }
    }
    return n;
  }

  /** '' when the unit in slot `i` may board `hull`, otherwise the reason. */
  refusalFor(hull: EntityId, i: number): BoardRefusal {
    const w = this.world;
    const st = w.store;
    const b = st.index(hull);
    if (b < 0) return 'gone';
    const hf = st.flags[b];
    if ((hf & EntityFlag.Alive) === 0 || (hf & EntityFlag.PendingDestroy) !== 0) return 'gone';

    const slots = this.capacityAt(b);
    if (slots <= 0) return 'not a transport';
    // A CARRIER MAY NOT BOARD A CARRIER, and nothing else detects the cycle:
    // `capacityAt` answers for any non-Building, and two hulls each holding the
    // other would copy each other's position forever. Nesting used to be
    // prevented only as a side effect of the infantry-only rule that this
    // replaces, so removing that rule without this line reopens it.
    if (this.capacityAt(i) > 0) return 'cannot ride';
    const cost = this.slotCostAt(i);
    // Anything that is not Infantry or Vehicle costs more slots than any hull
    // in the game has, so a Building or a Prop is refused by arithmetic rather
    // than by a special case that could fall out of step with the kind list.
    if (cost > slots) return 'cannot ride';
    if (!w.areAllied(st.owner[i] as PlayerId, st.owner[b] as PlayerId)) return 'hostile';
    if (this.usedSlotsAt(b) + cost > slots) return 'full';
    return '';
  }

  /** True when the hull in slot `i` has somebody to put down. */
  isLoadedAt(i: number): boolean {
    return this.capacityAt(i) > 0 && this.passengerCountAt(i) > 0;
  }

  /* -- the tick (Phase.Cleanup) ------------------------------------------ */

  simTick(_s: SimContext): void {
    pickupEpoch++;
    this.board();
    this.ride();
    this.unloadOrders();
  }

  /**
   * Walk everything with a live `Enter` order onto its hull.
   *
   * The order point is rewritten to the hull's CURRENT position every tick, so
   * a squad chases a carrier that is still moving instead of walking to where
   * it used to be. That is the one behaviour a garrison never needs.
   *
   * BOTH CARGO KINDS, not just infantry. A vehicle carrying `OrderKind.Enter`
   * used to be visited by neither this loop nor `Garrison`'s, so the order was
   * never executed AND never cleared: the tank drove onto the hull, parked in
   * `UnitState.Moving`, and stayed there. Nothing rejected it, because nothing
   * looked at it.
   */
  private board(): void {
    const st = this.world.store;

    for (let c = 0; c < CARGO_KINDS.length; c++) {
      const kind = CARGO_KINDS[c];
      const list = st.byKind[kind];
      const count = st.byKindCount[kind];

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

        if (!this.withinReach(i, t)) { this.callHullIn(i, t); continue; }
        this.embark(i, t);
      }
    }
  }

  /**
   * Bring a carrier in to a squad that cannot walk to it.
   *
   * THE HALF OF BOARDING THAT NEVER EXISTED FOR THE PLAYER. A carrier is
   * `MoveClass.Naval` and a rifleman is `MoveClass.Foot`; water is impassable
   * to Foot, so `Flowfield.requestFieldClass` snaps the squad's goal back to
   * the last dry cell. Told to board a hull lying offshore they walked to the
   * sand and stood there, while `board` re-stamped the order onto the hull's
   * position every tick — a boarding that sat at 0 aboard for as long as the
   * player was willing to watch it. `sim/AI.ts` documents hitting exactly this
   * and worked around it privately, by ordering its own hull onto the beach;
   * nothing did it for a player's click.
   *
   * Deliberately NOT gated on "the hull is naval": the question is whether THIS
   * passenger can reach it, so a beached amphibious lift is left alone and the
   * same code brings in a Sandskiff that happens to be out at sea.
   *
   * It overrides an idle hull's stale completed order, or its current Move.
   * A hull actively attacking, guarding, deploying, repairing or unloading is
   * doing something the player asked for more recently and keeps that work.
   */
  private callHullIn(i: number, t: number): void {
    const st = this.world.store;
    const world = this.world;

    // Can this passenger simply walk there? Then the hull stays put.
    const loco = locomotorForMoveClass(moveClassAt(st, i));
    const hcx = worldToCell(st.posX[t]);
    const hcz = worldToCell(st.posZ[t]);
    if (isInMap(hcx, hcz) && world.terrain.isPassable(hcx, hcz, loco)) return;

    if (!carrierMayAnswerPickup(
      st.state[t] as UnitState,
      st.orderKind[t] as OrderKind,
    )) return;

    // ONE diversion per hull per tick. Five men boarding one carrier would
    // otherwise write five destinations, and each write restarts the path.
    if (PICKUP_TICK[t] === pickupEpoch) return;
    PICKUP_TICK[t] = pickupEpoch;

    const bcx = worldToCell(st.posX[i]);
    const bcz = worldToCell(st.posZ[i]);
    if (!isInMap(bcx, bcz)) return;
    if (!nearestBoardingWater(bcx, bcz, PICKUP_CELL)) return;

    const px = (PICKUP_CELL[0] + 0.5) * CELL;
    const pz = (PICKUP_CELL[1] + 0.5) * CELL;
    const dx = st.posX[t] - px;
    const dz = st.posZ[t] - pz;
    // Already close enough. Re-issuing here is what leaves a hull shuffling on
    // the spot instead of holding station while the squad walks down.
    if (dx * dx + dz * dz <= PICKUP_SETTLE_METRES * PICKUP_SETTLE_METRES) return;

    st.orderKind[t] = OrderKind.Move;
    st.orderTarget[t] = 0;
    st.orderX[t] = px;
    st.orderZ[t] = pz;
    st.state[t] = UnitState.Moving;
    this.stats.pickups++;
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
    st.carrierId[i] = host as number;
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
    let men = 0;
    let touched = 0;

    for (let c = 0; c < CARGO_KINDS.length; c++) {
      const kind = CARGO_KINDS[c];
      const list = st.byKind[kind];
      const n = st.byKindCount[kind];

      for (let a = 0; a < n; a++) {
        const i = list[a];
        const f = st.flags[i];
        if ((f & EntityFlag.Garrisoned) === 0) continue;
        if ((f & EntityFlag.PendingDestroy) !== 0) continue;
        const held = st.carrierId[i] as EntityId;
        if ((held as number) === 0) {
          // NEITHER COLUMN CLAIMS HIM, so nobody ever will. `GarrisonService`
          // owns anyone with a `garrisonId` and skips the rest, and this loop
          // used to skip anyone without a `carrierId` — so a unit carrying
          // `Garrisoned` and neither id fell between the two services and
          // stayed alive, immobile and invisible forever.
          //
          // It is reachable by exactly one route and that route is a save
          // written before these columns existed: `restoreEntities` finds no
          // column, leaves `alloc`'s 0, and the `Garrisoned` bit rides back in
          // on the `flags` column, which HAS always been persisted. Garrison
          // occupants are recovered by `GarrisonService.recover`'s own no-host
          // branch; a VEHICLE passenger has no equivalent, because a vehicle
          // could not ride at all until this release.
          if (st.garrisonId[i] === 0) this.strand(i);
          continue;
        }
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
    // Every carrier in the game is a Vehicle, and `refusalFor` refuses anything
    // with capacity as CARGO, so a carrier can never be inside another list.
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

    const n = this.collect(b, PASSENGER_SLOTS);
    let out = 0;
    let refused = 0;
    for (let k = 0; k < n; k++) {
      if (this.place(PASSENGER_SLOTS[k], b, out)) out++;
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
    // THE PASSENGER'S OWN RADIUS, not just the hull's. A tank put down at a
    // rifleman's inset overlaps the hull it came out of and spends its first
    // seconds being shoved clear by `Movement.relax`.
    const base = st.radius[b] + st.radius[i] + TRANSPORT.unloadInsetMetres;
    return this.setDownNear(i, st.posX[b], st.posZ[b], base, ordinal, false);
  }

  /**
   * Find a cell this passenger can actually stand on and put him there.
   *
   * `origin` is the centre of the search, `base` the radius of the first ring.
   * `includeOrigin` also tests the centre cell itself before widening — which
   * `place` must NOT do (the centre is the hull, and a hull floats) but
   * `strand` must (its centre is wherever the body was parked, which on a save
   * load is a legitimate standing point and should be preserved exactly).
   *
   * Returns false when nothing in `unloadRings` rings works. The caller decides
   * what that means: `place` leaves the man aboard, `strand` drowns him.
   */
  private setDownNear(
    i: number, ox: number, oz: number, base: number, ordinal: number, includeOrigin: boolean,
  ): boolean {
    const st = this.world.store;
    const world = this.world;
    const spokes = TRANSPORT.unloadSpokes;
    // THE PASSENGER'S OWN LOCOMOTOR, resolved through its move class so an
    // amphibious swimmer reads as Hover and can be put down in the water it
    // swims in. This was hardcoded `Locomotor.Foot`, which is right for a
    // rifleman and wrong twice over now: a tank would be dropped on foot-only
    // ground its own class cannot leave, and a swimmer unloaded over deep water
    // would be refused every ring and ride on forever.
    const loco = locomotorForMoveClass(moveClassAt(st, i));

    if (includeOrigin) {
      const cx = worldToCell(ox);
      const cz = worldToCell(oz);
      if (isInMap(cx, cz) && world.terrain.isPassable(cx, cz, loco)
        && !world.terrain.isOccupied(cx, cz)) {
        this.disembark(i, ox, oz);
        return true;
      }
    }

    for (let ring = 0; ring < TRANSPORT.unloadRings; ring++) {
      const r = base + ring * TRANSPORT.unloadRingStepMetres;
      for (let s = 0; s < spokes; s++) {
        const spoke = (s + ordinal) % spokes;
        const angle = (spoke / spokes) * Math.PI * 2;
        const px = ox + Math.sin(angle) * r;
        const pz = oz + Math.cos(angle) * r;
        const cx = worldToCell(px);
        const cz = worldToCell(pz);
        if (!isInMap(cx, cz)) continue;
        // Passability is the whole point: a carrier is sitting ON WATER when it
        // arrives, and a garrison-style unconditional ring would put the squad
        // it just ferried into the sea.
        if (!world.terrain.isPassable(cx, cz, loco)) continue;
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
    st.carrierId[i] = 0;
  }

  /**
   * A passenger whose hull is gone but which never got an `entity:killed`.
   *
   * WHERE HE STANDS IS THE SEA, AND THAT LEFT MATCHES UNWINNABLE.
   *
   * This used to be a bare `disembark(i, posX[i], posZ[i])` — the same call
   * `Garrison.strand` makes, and its comment said so. The premise does not
   * carry over. A GARRISON occupant's body has been parked at the BUILDING's
   * centre, which is on land by construction, so dropping him in place is
   * right. A PASSENGER's body has been parked at the HULL's centre by `ride`,
   * and since carriers became `waterOnly` a shipyard hull never touches dry
   * land — so the same call put a tank, or a harvester, into open water with
   * `Immobilized` cleared and a `MoveClass` that cannot traverse the cell it is
   * standing on. `Flowfield` cannot pull it off an impassable cell, no land
   * unit can reach it, and `Shell.pollOutcome` counts it through
   * `countLivingAssets` — which filters on nothing. Reported as a wiped-out
   * enemy on Sunder Atoll that would not resolve: two harvesters, at sea,
   * unkillable, holding the match open forever.
   *
   * `disembark`'s own contract is "at a VALIDATED point" and this was the one
   * caller that passed an unvalidated one.
   *
   * So: try where he stands FIRST — that preserves the save-load and disposal
   * cases exactly, which are the ones the old comment was protecting and which
   * really are on legitimate ground — then widen through the same rings
   * `place` uses. If nothing in reach is standable he drowns, because the
   * alternative is the immortal unit above. It is not a silent loss: `sink`
   * goes through `markDead` and `UnitState.Drowned`, so he raises his own
   * `entity:killed`, his own "unit lost" and his own scoreboard entry.
   */
  private strand(i: number): void {
    const st = this.world.store;
    const base = st.radius[i] + TRANSPORT.unloadInsetMetres;
    if (this.setDownNear(i, st.posX[i], st.posZ[i], base, 0, true)) return;
    this.sink(i);
    this.stats.stranded++;
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
    const n = this.collect(b, PASSENGER_SLOTS);
    for (let k = 0; k < n; k++) this.sink(PASSENGER_SLOTS[k]);
  }

  /**
   * One passenger goes down with the hull.
   *
   * `UnitState.Drowned` is `sim/Damage.ts`'s "went down inside something else"
   * channel — no second fireball and no second wreck on top of the hull's own,
   * but a real loss. It used to be `Selling`, which returns before the
   * statistics block, so this comment's promise that "they still count as lost"
   * was false for as long as it had been written.
   */
  private sink(i: number): void {
    const st = this.world.store;
    const h = st.handleOf(i);
    if (!st.markDead(h)) { st.carrierId[i] = 0; return; }
    st.state[i] = UnitState.Drowned;
    st.carrierId[i] = 0;
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

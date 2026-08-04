/**
 * ============================================================================
 * src/sim/Garrison.ts — INFANTRY OCCUPY STRUCTURES AND FIRE FROM THE WINDOWS
 * ============================================================================
 *
 * `EntityFlag.Garrisoned` was already respected in four places — selection
 * skips it, the render bridge hides it, targeting and combat reject it — and
 * `OrderKind.Enter` already resolved from a right-click. Nothing ever SET the
 * flag. This is the thing that sets it.
 *
 * WHAT A GARRISON IS HERE
 * -----------------------
 * A structure with no weapon of its own and a footprint big enough to stand
 * inside becomes a firing position. Up to `GARRISON.capacity` infantry walk in,
 * vanish from the field, and the BUILDING starts shooting with the sum of their
 * rifles. Killing the building kills everyone inside. Emptying it hands it back.
 *
 * Occupying a NEUTRAL structure flips it to the occupier's colours for as long
 * as it is held, which is what turns a civilian block into a strongpoint worth
 * fighting over. It reverts the moment the last man leaves or dies.
 *
 * WHY THE BUILDING SHOOTS HERE AND NOT IN Combat.ts
 * -------------------------------------------------
 * Combat fires ONE weapon per entity off `store.weaponIndex`. A garrison's
 * whole point is that firepower scales with occupancy, so the volley is
 * resolved here — one target acquisition, one damage record whose amount is the
 * sum of the occupants' weapons, at the best occupant's cooldown. That keeps
 * `weaponIndex` untouched (it is spawn-owned) and keeps five men in a building
 * from costing five target scans.
 *
 * CONTENT NOTE. There are no civilian buildings in the roster yet, so the
 * eligible set today is "your own unarmed, non-production structures" —
 * Power Plant, Ore Silo, Battle Lab — plus any neutral-owned structure the
 * moment one exists. See the report for the def rows that would open this up
 * properly.
 *
 * PHASES. Entry runs at `Phase.Cleanup` (negative order, beside Capture) so it
 * sees final positions. The volley runs at `Phase.Weapons` so its damage lands
 * in the same `Phase.Damage` drain as everything else.
 * ============================================================================
 */

import type { Channels } from '../core/events';
import type { World } from '../core/world';
import { PerEntityF32, PerEntityU32 } from '../core/world';
import {
  EntityFlag, EntityKind, Faction, FxKind, NONE, OrderKind, TARGETABLE_REJECT_MASK,
  UnitState,
} from '../core/types';
import type { EntityId, PlayerId, SimContext, WeaponDef } from '../core/types';
import { CELL, MAX_ENTITIES } from '../core/config';

import { weaponAt, weaponIndexOf } from './Combat';
import { captureService } from './Capture';

/**
 * A man in a window has a rifle even when the def tables have not bound yet
 * (`store.weaponIndex` is -1 for every unit until src/data/Defs.ts publishes).
 * Resolved once, lazily, because the weapon table is installed at init.
 */
let fallbackWeapon = -2;
function garrisonWeaponFor(index: number): number {
  if (index >= 0) return index;
  if (fallbackWeapon === -2) fallbackWeapon = weaponIndexOf('rifle');
  return fallbackWeapon;
}

/* ==========================================================================
 * 1. TUNING
 * ========================================================================== */

export const GARRISON = {
  /** Men per structure. Five is the RA2 number and it reads correctly. */
  capacity: 5,
  /** Metres of clearance beyond the footprint edge that counts as "at the door". */
  reachMetres: 2.2,
  /** Metres added to the occupants' own weapon range for shooting downward. */
  rangeBonus: 6,
  /** Each rifle is worth this much of its field damage from behind a wall. */
  damageMul: 0.9,
  /** Metres from the footprint edge that evacuating infantry are placed. */
  evacuateMetres: 2.0,
  /** Minimum footprint (cells, both axes) a structure needs to be occupied. */
  minFootprint: 2,
} as const;

/* ==========================================================================
 * 2. PUBLIC SHAPES
 * ========================================================================== */

export interface GarrisonStats {
  /** Structures with at least one occupant. */
  occupied: number;
  /** Total men inside structures. */
  occupants: number;
  entries: number;
  evacuations: number;
  volleys: number;
}

/** Why a structure cannot be entered. Empty string when it can. */
export type GarrisonRefusal =
  | '' | 'not a structure' | 'unfinished' | 'armed' | 'too small'
  | 'production structure' | 'hostile' | 'full';

/* ==========================================================================
 * 3. THE SERVICE
 * ========================================================================== */

/** Scratch: occupant tallies keyed by host slot, cleared by touched-list. */
const OCC_COUNT = new Int32Array(MAX_ENTITIES);
const OCC_DAMAGE = new Float32Array(MAX_ENTITIES);
const OCC_WEAPON = new Int32Array(MAX_ENTITIES);
const TOUCHED = new Int32Array(MAX_ENTITIES);

export class GarrisonService {
  readonly stats: GarrisonStats = {
    occupied: 0, occupants: 0, entries: 0, evacuations: 0, volleys: 0,
  };

  /** For an occupant: the host structure's handle. 0 when not garrisoned. */
  private readonly hostOf: PerEntityU32;
  /** For a structure: `owner + 1` before the first occupier took it. */
  private readonly originalOwner: PerEntityU32;
  /** For a structure: seconds until the next volley. */
  private readonly volleyCooldown: PerEntityF32;

  /** Host slots touched during the last tally, so the scratch clears in O(hosts). */
  private touchedCount = 0;
  private unhookVeto: (() => void) | null = null;
  private unhookKilled: (() => void) | null = null;

  constructor(
    private readonly world: World,
    private readonly channels: Channels,
  ) {
    this.hostOf = new PerEntityU32(world.store, 0);
    this.originalOwner = new PerEntityU32(world.store, 0);
    this.volleyCooldown = new PerEntityF32(world.store, 0);
  }

  /**
   * Wire into the rest of the sim. Kept out of the constructor so a test can
   * build the service without a live event bus contract.
   */
  attach(): void {
    // An occupied strongpoint cannot be walked into by an engineer. Clear it
    // out first — that is the whole tactical point of holding one.
    this.unhookVeto = captureService()?.addVeto((target) => this.occupantCount(target) > 0) ?? null;

    // The building goes, everyone in it goes with it.
    this.unhookKilled = this.channels.events.on('entity:killed', (ev) => {
      if (ev.kind !== EntityKind.Building) return;
      this.killOccupants(ev.id);
    });
  }

  /* -- queries ----------------------------------------------------------- */

  /** The structure this unit is inside, or NONE. */
  hostOfUnit(unit: EntityId): EntityId {
    const h = this.hostOf.get(unit) as EntityId;
    return this.world.store.index(h) >= 0 ? h : NONE;
  }

  /** How many men are inside `building` right now. O(infantry), called rarely. */
  occupantCount(building: EntityId): number {
    const st = this.world.store;
    const b = st.index(building);
    if (b < 0) return 0;
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

  /** Occupant handles into `out`. Returns how many were written. */
  occupants(building: EntityId, out: Int32Array): number {
    const st = this.world.store;
    const b = st.index(building);
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

  /** '' when `byPlayer` may garrison `building`, otherwise the reason. */
  refusalFor(building: EntityId, byPlayer: PlayerId): GarrisonRefusal {
    const w = this.world;
    const st = w.store;
    const b = st.index(building);
    if (b < 0 || st.kind[b] !== EntityKind.Building) return 'not a structure';
    const f = st.flags[b];
    if ((f & EntityFlag.Alive) === 0 || (f & EntityFlag.PendingDestroy) !== 0) {
      return 'not a structure';
    }
    if ((f & EntityFlag.UnderConstruction) !== 0) return 'unfinished';
    // A Tesla Coil does not need help. Unarmed structures are the ones with
    // windows, and the ones a squad meaningfully changes.
    if (st.weaponIndex[b] >= 0 || (f & EntityFlag.CanAttack) !== 0) return 'armed';
    if (st.footprintW[b] < GARRISON.minFootprint || st.footprintH[b] < GARRISON.minFootprint) {
      return 'too small';
    }
    const busy = EntityFlag.IsBuilder | EntityFlag.IsFactory | EntityFlag.IsRefinery
      | EntityFlag.IsRadar;
    if ((f & busy) !== 0) return 'production structure';

    const ownerPlayer = w.players[st.owner[b]];
    const neutral = ownerPlayer === undefined || ownerPlayer.faction === Faction.Neutral;
    if (!neutral && !w.areAllied(byPlayer, st.owner[b] as PlayerId)) return 'hostile';
    if (this.occupantCount(building) >= GARRISON.capacity) return 'full';
    return '';
  }

  /** Convenience predicate over `refusalFor`. */
  canGarrison(building: EntityId, byPlayer: PlayerId): boolean {
    return this.refusalFor(building, byPlayer) === '';
  }

  /* -- entry tick (Phase.Cleanup) ---------------------------------------- */

  simTick(_s: SimContext): void {
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
      if (t < 0 || st.kind[t] !== EntityKind.Building) { this.clearOrder(i); continue; }

      const byPlayer = st.owner[i] as PlayerId;
      if (this.refusalFor(target, byPlayer) !== '') { this.clearOrder(i); continue; }

      st.orderX[i] = st.posX[t];
      st.orderZ[i] = st.posZ[t];
      st.state[i] = UnitState.Moving;

      if (!this.withinReach(i, t)) continue;
      this.enter(i, t);
    }

    // Hand a structure back the moment it empties. Cheap: only structures we
    // have ever taken carry an `originalOwner` stamp.
    this.releaseEmptied();
  }

  /** Move one man inside. */
  private enter(i: number, t: number): void {
    const st = this.world.store;
    const unit = st.handleOf(i);
    const host = st.handleOf(t);

    st.flags[i] |= EntityFlag.Garrisoned | EntityFlag.Immobilized;
    st.state[i] = UnitState.Idle;
    st.orderKind[i] = OrderKind.None;
    st.orderTarget[i] = 0;
    st.velX[i] = 0; st.velZ[i] = 0; st.speed[i] = 0;
    // Park the body at the structure's centre so the spatial index, vision
    // stamping and the eventual evacuation all agree about where it is.
    st.posX[i] = st.posX[t];
    st.posZ[i] = st.posZ[t];
    st.prevX[i] = st.posX[t];
    st.prevZ[i] = st.posZ[t];
    st.orderX[i] = st.posX[t];
    st.orderZ[i] = st.posZ[t];
    st.guardX[i] = st.posX[t];
    st.guardZ[i] = st.posZ[t];
    this.hostOf.setAt(i, host as number);

    // First man into a neutral block raises your flag over it.
    const owner = st.owner[i] as PlayerId;
    if (this.originalOwner.getAt(t) === 0) {
      this.originalOwner.setAt(t, (st.owner[t] as number) + 1);
    }
    const ownerPlayer = this.world.players[st.owner[t]];
    if (ownerPlayer !== undefined && ownerPlayer.faction === Faction.Neutral
      && (owner as number) !== (st.owner[t] as number)) {
      captureService()?.captureBuilding(host, owner, unit);
    }

    this.channels.fx.push(
      FxKind.DustPuff, st.posX[t], st.posY[t] + 1.0, st.posZ[t],
      0, 1, 0, 0.9, host, st.faction[t] as Faction,
    );
    this.stats.entries++;
  }

  /* -- the volley (Phase.Weapons) ---------------------------------------- */

  weaponsTick(s: SimContext): void {
    const w = this.world;
    const st = w.store;
    this.tally();

    let occupiedHosts = 0;
    for (let k = 0; k < this.touchedCount; k++) {
      const b = TOUCHED[k];
      const men = OCC_COUNT[b];
      if (men <= 0) continue;
      occupiedHosts++;

      const cd = this.volleyCooldown.getAt(b) - s.dt;
      const weapon = weaponAt(OCC_WEAPON[b]);
      if (weapon === undefined) { this.volleyCooldown.setAt(b, 0); continue; }
      if (cd > 0) { this.volleyCooldown.setAt(b, cd); continue; }

      const range = weapon.range + GARRISON.rangeBonus;
      const owner = st.owner[b] as PlayerId;
      const victim = w.spatial.nearest(
        st.posX[b], st.posZ[b], range + st.radius[b],
        w.enemyMask(owner),
        EntityFlag.Alive,
        TARGETABLE_REJECT_MASK | EntityFlag.NotATarget,
      );
      if (victim < 0) { this.volleyCooldown.setAt(b, 0); continue; }
      if (!w.vision.canSee(owner, st.handleOf(victim))) { this.volleyCooldown.setAt(b, 0); continue; }

      this.fire(b, victim, weapon, OCC_DAMAGE[b]);
      this.volleyCooldown.setAt(b, weapon.cooldown);
    }

    this.stats.occupied = occupiedHosts;
    this.clearTally();
  }

  private fire(b: number, victim: number, weapon: WeaponDef, damage: number): void {
    const st = this.world.store;
    const faction = st.faction[b] as Faction;
    const host = st.handleOf(b);

    this.channels.damage.push(
      st.handleOf(victim), host, damage, weapon.warhead,
      st.posX[victim], st.posY[victim] + 0.8, st.posZ[victim],
      weapon.splashRadius, weapon.splashFalloff,
    );

    // Muzzle flash at the wall facing the target, so the fire visibly comes
    // out of the building rather than out of its centre.
    const dx = st.posX[victim] - st.posX[b];
    const dz = st.posZ[victim] - st.posZ[b];
    const len = Math.hypot(dx, dz) || 1;
    const edge = Math.max(st.footprintW[b], st.footprintH[b]) * CELL * 0.5;
    const mx = st.posX[b] + (dx / len) * edge;
    const mz = st.posZ[b] + (dz / len) * edge;
    const my = st.posY[b] + 3.0;

    this.channels.fx.push(FxKind.MuzzleFlashSmall, mx, my, mz, dx, 0, dz, 1, host, faction);
    this.channels.fx.push(FxKind.TracerBullet, mx, my, mz, dx, 0, dz, 1, host, faction);
    this.stats.volleys++;
  }

  /** One pass over the infantry list, grouping occupants by host slot. */
  private tally(): void {
    const st = this.world.store;
    const list = st.byKind[EntityKind.Infantry];
    const n = st.byKindCount[EntityKind.Infantry];
    let men = 0;
    this.touchedCount = 0;

    for (let a = 0; a < n; a++) {
      const i = list[a];
      const f = st.flags[i];
      if ((f & EntityFlag.Garrisoned) === 0) continue;
      if ((f & EntityFlag.PendingDestroy) !== 0) continue;
      const b = st.index(this.hostOf.getAt(i) as EntityId);
      if (b < 0) continue;

      if (OCC_COUNT[b] === 0) {
        if (this.touchedCount >= TOUCHED.length) continue;
        TOUCHED[this.touchedCount++] = b;
        OCC_DAMAGE[b] = 0;
        OCC_WEAPON[b] = -1;
      }
      OCC_COUNT[b]++;
      men++;

      const wi = garrisonWeaponFor(st.weaponIndex[i]);
      const wd = weaponAt(wi);
      if (wd === undefined) continue;
      OCC_DAMAGE[b] += wd.damage * GARRISON.damageMul;
      // The longest-ranged rifle in the room sets the room's reach and rhythm.
      const best = weaponAt(OCC_WEAPON[b]);
      if (best === undefined || wd.range > best.range) OCC_WEAPON[b] = wi;
    }
    this.stats.occupants = men;
  }

  private clearTally(): void {
    for (let k = 0; k < this.touchedCount; k++) OCC_COUNT[TOUCHED[k]] = 0;
    this.touchedCount = 0;
  }

  /* -- leaving ----------------------------------------------------------- */

  /**
   * Turn everybody out. Returns how many left. The unload verb: bind it to the
   * HUD's evacuate button or a right-click on an occupied structure.
   */
  evacuate(building: EntityId): number {
    const st = this.world.store;
    const b = st.index(building);
    if (b < 0) return 0;

    const list = st.byKind[EntityKind.Infantry];
    const n = st.byKindCount[EntityKind.Infantry];
    let out = 0;
    for (let a = 0; a < n; a++) {
      const i = list[a];
      if ((st.flags[i] & EntityFlag.Garrisoned) === 0) continue;
      if (st.index(this.hostOf.getAt(i) as EntityId) !== b) continue;
      this.place(i, b, out);
      out++;
    }
    if (out > 0) {
      this.stats.evacuations += out;
      this.restoreOwner(b);
    }
    return out;
  }

  /** Every structure `player` holds gives up its garrison. Used on defeat. */
  evacuateAll(player: PlayerId): number {
    const st = this.world.store;
    const list = st.byKind[EntityKind.Building];
    const n = st.byKindCount[EntityKind.Building];
    let out = 0;
    for (let a = 0; a < n; a++) {
      const b = list[a];
      if (st.owner[b] !== (player as number)) continue;
      out += this.evacuate(st.handleOf(b));
    }
    return out;
  }

  /** Put one man back on the ground on a deterministic ring around the host. */
  private place(i: number, b: number, ordinal: number): void {
    const st = this.world.store;
    const halfW = Math.max(st.footprintW[b], 1) * CELL * 0.5 + GARRISON.evacuateMetres;
    const halfH = Math.max(st.footprintH[b], 1) * CELL * 0.5 + GARRISON.evacuateMetres;
    const angle = (ordinal / GARRISON.capacity) * Math.PI * 2;
    const px = st.posX[b] + Math.sin(angle) * halfW;
    const pz = st.posZ[b] + Math.cos(angle) * halfH;

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

  /** The building died. Everyone inside dies with it, quietly. */
  private killOccupants(building: EntityId): void {
    const st = this.world.store;
    const b = st.index(building);
    if (b < 0) return;
    const list = st.byKind[EntityKind.Infantry];
    const n = st.byKindCount[EntityKind.Infantry];
    for (let a = 0; a < n; a++) {
      const i = list[a];
      if ((st.flags[i] & EntityFlag.Garrisoned) === 0) continue;
      if (st.index(this.hostOf.getAt(i) as EntityId) !== b) continue;
      // They are already inside a building that is exploding on its own; a
      // second body-and-stain per man on top of that is noise.
      st.state[i] = UnitState.Selling;
      st.markDead(st.handleOf(i));
      this.hostOf.clear(st.handleOf(i));
    }
  }

  /**
   * Any structure we took from a neutral owner and no longer hold goes back.
   * Only structures with an `originalOwner` stamp are considered, so this is a
   * scan over "buildings we have ever touched", not over the whole world.
   */
  private releaseEmptied(): void {
    const st = this.world.store;
    const list = st.byKind[EntityKind.Building];
    const n = st.byKindCount[EntityKind.Building];
    for (let a = 0; a < n; a++) {
      const b = list[a];
      if (this.originalOwner.getAt(b) === 0) continue;
      if ((st.flags[b] & EntityFlag.PendingDestroy) !== 0) continue;
      if (this.occupantCount(st.handleOf(b)) > 0) continue;
      this.restoreOwner(b);
    }
  }

  private restoreOwner(b: number): void {
    const st = this.world.store;
    const stamped = this.originalOwner.getAt(b);
    if (stamped === 0) return;
    this.originalOwner.clear(st.handleOf(b));
    const original = (stamped - 1) as PlayerId;
    if ((original as number) === (st.owner[b] as number)) return;
    const p = this.world.players[original as number];
    // Only ever hand a structure BACK to a neutral caretaker. Reverting a real
    // player's captured building would be an ownership war between two systems.
    if (p === undefined || p.faction !== Faction.Neutral) return;
    captureService()?.captureBuilding(st.handleOf(b), original, NONE);
  }

  /* -- helpers ----------------------------------------------------------- */

  private withinReach(i: number, t: number): boolean {
    const st = this.world.store;
    const halfW = Math.max(st.footprintW[t], 1) * CELL * 0.5;
    const halfH = Math.max(st.footprintH[t], 1) * CELL * 0.5;
    const dx = Math.max(0, Math.abs(st.posX[i] - st.posX[t]) - halfW);
    const dz = Math.max(0, Math.abs(st.posZ[i] - st.posZ[t]) - halfH);
    const reach = GARRISON.reachMetres + st.radius[i];
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
    this.unhookVeto?.();
    this.unhookVeto = null;
    this.unhookKilled?.();
    this.unhookKilled = null;
    this.clearTally();
  }
}

/* ==========================================================================
 * 4. MODULE ACCESSOR
 * ========================================================================== */

let active: GarrisonService | null = null;

export function setGarrisonService(next: GarrisonService | null): void {
  active = next;
}

export function garrisonService(): GarrisonService | null {
  return active;
}

/**
 * Strategic-air-wing state and the four physical airbase bays.
 *
 * The packed word is saved and checksummed by EntityStore. This module owns
 * its runtime transitions; Production owns only the initial reservation.
 */
import { EntityFlag, EntityKind, Faction, Locomotor, OrderKind, Stance, UnitState } from '../core/types';
import type { EntityId, SimContext } from '../core/types';
import { CELL, NAV_ARRIVE_SLACK } from '../core/config';
import { clampCell, worldToCell } from '../core/math';
import type { World } from '../core/world';
import { MoveClass } from './Flowfield';
import { setMoveClass } from './Movement';

export const enum BomberSortieState {
  None = 0,
  DockedReady = 1,
  EnRoute = 2,
  Returning = 3,
  Reloading = 4,
  FreeFlight = 5,
}

const STATE_MASK = 0x7;
const SLOT_SHIFT = 3;
const SLOT_MASK = 0x3;
const AMMO_SHIFT = 5;
const REARM_SHIFT = 6;
const REARM_MASK = 0x1ff;
export const BOMBER_BAY_COUNT = 4;
export const BOMBER_REARM_TICKS = 300;
const MIN_DOCK_RADIUS = 3.25;

/** Local bay centres in the airbase's yaw-zero coordinate frame. */
const BAY_X = new Float32Array([-5.5, 5.5, -5.5, 5.5]);
const BAY_Z = new Float32Array([-5.5, -5.5, 5.5, 5.5]);

/**
 * Terrain-relative touchdown height for each faction's authored bay deck.
 *
 * These are measured vertical-ray intersections against the conditioned LOD0
 * building meshes after their runtime height fit, plus 0.18 m undercarriage
 * clearance. Parking at terrain height put produced Molots 1.93 m inside the
 * Heavy Aviation Works deck even though their reservation and HUD remained
 * visible. Neutral is the procedural/testing fallback.
 */
export const BOMBER_TOUCHDOWN_HEIGHT = new Float32Array([
  0.18, // Neutral / procedural fallback
  1.01, // Allied Strategic Airbase: 0.83 m deck
  2.29, // Soviet Heavy Aviation Works: 2.11 m deck
  0.67, // Meridian Solar Aerodrome: 0.49 m deck
  1.98, // Reclamation Carrion Roost: 1.80 m deck
]);

function pack(state: BomberSortieState, slot: number, ammo: boolean, rearm: number): number {
  return (state & STATE_MASK)
    | ((slot & SLOT_MASK) << SLOT_SHIFT)
    | ((ammo ? 1 : 0) << AMMO_SHIFT)
    | ((Math.max(0, Math.min(REARM_MASK, rearm | 0)) & REARM_MASK) << REARM_SHIFT);
}

export function sortieState(data: number): BomberSortieState {
  return (data & STATE_MASK) as BomberSortieState;
}

export function sortieSlot(data: number): number {
  return (data >>> SLOT_SHIFT) & SLOT_MASK;
}

export function sortieHasBomb(data: number): boolean {
  return ((data >>> AMMO_SHIFT) & 1) !== 0;
}

function sortieRearm(data: number): number {
  return (data >>> REARM_SHIFT) & REARM_MASK;
}

export function firstFreeBomberBay(world: World, hostSlot: number, ignoreSlot = -1): number {
  const st = world.store;
  let occupied = 0;
  for (let a = 0; a < st.aliveCount; a++) {
    const i = st.alive[a];
    if (i === ignoreSlot || (st.flags[i] & EntityFlag.PendingDestroy) !== 0) continue;
    if (st.index(st.sortieHostId[i] as EntityId) !== hostSlot) continue;
    if (sortieState(st.sortieData[i]) === BomberSortieState.None) continue;
    occupied |= 1 << sortieSlot(st.sortieData[i]);
  }
  for (let bay = 0; bay < BOMBER_BAY_COUNT; bay++) {
    if ((occupied & (1 << bay)) === 0) return bay;
  }
  return -1;
}

export function bomberBayPosition(
  world: World, hostSlot: number, bay: number, out: Float32Array,
): Float32Array {
  const st = world.store;
  const yaw = st.yaw[hostSlot];
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const lx = BAY_X[bay & SLOT_MASK];
  const lz = BAY_Z[bay & SLOT_MASK];
  out[0] = st.posX[hostSlot] + lx * cos + lz * sin;
  out[1] = st.posZ[hostSlot] + lz * cos - lx * sin;
  return out;
}

/** Reserve the first deterministic free bay and park a newly built bomber. */
export function dockNewBomber(world: World, bomber: EntityId, host: EntityId): boolean {
  const st = world.store;
  const bi = st.index(bomber);
  const hi = st.index(host);
  if (bi < 0 || hi < 0 || st.kind[hi] !== EntityKind.Building) return false;

  const bay = firstFreeBomberBay(world, hi, bi);
  if (bay < 0) return false;

  const point = new Float32Array(2);
  bomberBayPosition(world, hi, bay, point);
  park(world, bi, hi, point[0], point[1]);
  st.sortieHostId[bi] = host as number;
  st.sortieData[bi] = pack(BomberSortieState.DockedReady, bay, true, 0);
  st.cooldown[bi] = 0;
  return true;
}

function park(world: World, i: number, hostSlot: number, x: number, z: number): void {
  const st = world.store;
  const y = touchdownY(world, hostSlot, x, z);
  st.prevX[i] = st.posX[i] = x;
  st.prevY[i] = st.posY[i] = y;
  st.prevZ[i] = st.posZ[i] = z;
  st.cellX[i] = clampCell(worldToCell(x));
  st.cellZ[i] = clampCell(worldToCell(z));
  st.yaw[i] = st.prevYaw[i] = st.yaw[hostSlot];
  st.velX[i] = st.velZ[i] = 0;
  st.speed[i] = 0;
  st.locomotor[i] = Locomotor.Static;
  // `MoveClass` is generation-stamped independently from `locomotor`. Leaving
  // Air cached here makes a parked aircraft climb vertically every movement
  // tick despite being immobilized; leaving Track cached on launch makes it
  // taxi across terrain. Keep the two explicit at every mode transition.
  setMoveClass(st, st.handleOf(i), MoveClass.Track);
  st.flags[i] |= EntityFlag.Immobilized;
  st.state[i] = UnitState.Idle;
  st.stance[i] = Stance.HoldFire;
  st.orderKind[i] = OrderKind.None;
  st.orderTarget[i] = 0;
  st.targetId[i] = 0;
  st.orderX[i] = st.guardX[i] = x;
  st.orderZ[i] = st.guardZ[i] = z;
}

function touchdownY(world: World, hostSlot: number, x: number, z: number): number {
  const faction = world.store.faction[hostSlot] as Faction;
  return world.terrain.heightAt(x, z)
    + (BOMBER_TOUCHDOWN_HEIGHT[faction] ?? BOMBER_TOUCHDOWN_HEIGHT[Faction.Neutral]);
}

function beginFlight(world: World, i: number): void {
  const st = world.store;
  st.locomotor[i] = Locomotor.Air;
  setMoveClass(st, st.handleOf(i), MoveClass.Air);
  st.flags[i] &= ~EntityFlag.Immobilized;
}

/** Publish the one authoritative return-to-bay transition. */
function orderHome(
  world: World, i: number, hostSlot: number, data: number,
  hasBomb = sortieHasBomb(data),
): void {
  const st = world.store;
  bomberBayPosition(world, hostSlot, sortieSlot(data), HOME_POINT);
  st.sortieData[i] = pack(
    BomberSortieState.Returning, sortieSlot(data), hasBomb, sortieRearm(data),
  );
  st.targetId[i] = 0;
  st.orderTarget[i] = 0;
  st.orderKind[i] = OrderKind.Move;
  st.orderX[i] = HOME_POINT[0];
  st.orderZ[i] = HOME_POINT[1];
  st.state[i] = UnitState.Moving;
  st.stance[i] = Stance.HoldFire;
}

const HOME_POINT = new Float32Array(2);

/**
 * Context-clicking a friendly structure resolves to a point Move order. The
 * input layer deliberately does not retain that structure as `orderTarget`, so
 * the sortie controller recognizes a click anywhere inside the bomber's own
 * host footprint as the player asking it to land. Ordinary nearby ground
 * remains an ordinary free-flight destination.
 */
function moveOrdersHome(world: World, i: number, hostSlot: number): boolean {
  const st = world.store;
  if (st.orderKind[i] !== OrderKind.Move) return false;
  const dx = st.orderX[i] - st.posX[hostSlot];
  const dz = st.orderZ[i] - st.posZ[hostSlot];
  // Structure picking covers the visible square, not only its inscribed
  // circle. A click on an outer landing deck must therefore count as Return
  // Home just as surely as a click on the operations core.
  const halfW = st.footprintW[hostSlot] * CELL * 0.5;
  const halfH = st.footprintH[hostSlot] * CELL * 0.5;
  if (halfW > 0 && halfH > 0 && Math.abs(dx) <= halfW && Math.abs(dz) <= halfH) return true;
  const radius = Math.max(3.25, st.radius[hostSlot]);
  return dx * dx + dz * dz <= radius * radius;
}

/** Runs immediately before ordinary targeting. */
export class BomberSortieSystem {
  private readonly point = new Float32Array(2);
  private readonly compatibleHostDefs = new Set<number>();

  constructor(private readonly world: World, hostDefIds: readonly number[] = []) {
    this.setCompatibleHostDefs(hostDefIds);
  }

  setCompatibleHostDefs(hostDefIds: readonly number[]): void {
    this.compatibleHostDefs.clear();
    for (const id of hostDefIds) if (id >= 0) this.compatibleHostDefs.add(id);
  }

  /** Pooled HUD read: [empty, ready, airborne, reloading]. */
  summaryForHost(host: EntityId, out: Uint8Array): boolean {
    out.fill(0);
    const st = this.world.store;
    const hi = st.index(host);
    if (hi < 0 || st.kind[hi] !== EntityKind.Building
        || !this.compatibleHostDefs.has(st.defId[hi])) return false;
    out[0] = BOMBER_BAY_COUNT;
    for (let a = 0; a < st.aliveCount; a++) {
      const i = st.alive[a];
      if ((st.flags[i] & EntityFlag.PendingDestroy) !== 0
          || st.sortieHostId[i] !== (host as number)) continue;
      const state = sortieState(st.sortieData[i]);
      if (state === BomberSortieState.None) continue;
      if (out[0] > 0) out[0]--;
      if (state === BomberSortieState.DockedReady) out[1]++;
      else if (state === BomberSortieState.Reloading) out[3]++;
      else out[2]++;
    }
    return true;
  }

  private rehome(i: number): boolean {
    const st = this.world.store;
    const owner = st.owner[i];
    let bestHost = -1;
    let bestBay = -1;
    let bestDist = Number.POSITIVE_INFINITY;
    let bestHandle = Number.POSITIVE_INFINITY;
    for (let a = 0; a < st.aliveCount; a++) {
      const hi = st.alive[a];
      if (st.kind[hi] !== EntityKind.Building || st.owner[hi] !== owner) continue;
      if (!this.compatibleHostDefs.has(st.defId[hi])) continue;
      const flags = st.flags[hi];
      if ((flags & (EntityFlag.PendingDestroy | EntityFlag.UnderConstruction)) !== 0
          || st.buildProgress[hi] < 1) continue;
      if ((flags & (EntityFlag.NeedsPower | EntityFlag.Powered)) === EntityFlag.NeedsPower) continue;
      const bay = firstFreeBomberBay(this.world, hi, i);
      if (bay < 0) continue;
      const dx = st.posX[i] - st.posX[hi];
      const dz = st.posZ[i] - st.posZ[hi];
      const dist = dx * dx + dz * dz;
      const handle = st.handleOf(hi) as number;
      if (dist < bestDist || (dist === bestDist && handle < bestHandle)) {
        bestHost = hi;
        bestBay = bay;
        bestDist = dist;
        bestHandle = handle;
      }
    }
    if (bestHost < 0) return false;

    const data = st.sortieData[i];
    const state = sortieState(data);
    st.sortieHostId[i] = st.handleOf(bestHost) as number;
    st.sortieData[i] = pack(state, bestBay, sortieHasBomb(data), sortieRearm(data));
    if (state === BomberSortieState.DockedReady || state === BomberSortieState.Reloading) {
      beginFlight(this.world, i);
      st.sortieData[i] = pack(
        BomberSortieState.Returning, bestBay, sortieHasBomb(data), sortieRearm(data),
      );
      bomberBayPosition(this.world, bestHost, bestBay, this.point);
      st.orderKind[i] = OrderKind.Move;
      st.orderTarget[i] = 0;
      st.targetId[i] = 0;
      st.orderX[i] = this.point[0];
      st.orderZ[i] = this.point[1];
      st.state[i] = UnitState.Moving;
      st.stance[i] = Stance.HoldFire;
    }
    return true;
  }

  preTick(_s: SimContext): void {
    const st = this.world.store;
    const units = st.alive;
    const count = st.aliveCount;
    for (let a = 0; a < count; a++) {
      const i = units[a];
      const data = st.sortieData[i];
      const state = sortieState(data);
      if (state === BomberSortieState.None || (st.flags[i] & EntityFlag.PendingDestroy) !== 0) continue;

      const hi = st.index(st.sortieHostId[i] as EntityId);
      if (hi < 0 || (st.flags[hi] & EntityFlag.PendingDestroy) !== 0
          || st.owner[hi] !== st.owner[i]) {
        if (this.rehome(i)) continue;
        // The aircraft survives a lost base but has no place to refuel. It is
        // deliberately left player-controllable and empty rather than deleted.
        st.sortieHostId[i] = 0;
        st.sortieData[i] = 0;
        beginFlight(this.world, i);
        st.state[i] = UnitState.Idle;
        continue;
      }

      // Saves and live dev sessions created before authored deck heights parked
      // bombers at terrain + 0.18 m. Correct only the vertical component here:
      // calling `park()` would erase an attack/move order before DockedReady
      // has a chance to launch it.
      if (state === BomberSortieState.DockedReady || state === BomberSortieState.Reloading) {
        st.prevY[i] = st.posY[i] = touchdownY(this.world, hi, st.posX[i], st.posZ[i]);
      }

      if (state === BomberSortieState.DockedReady) {
        const order = st.orderKind[i] as OrderKind;
        const attack = order === OrderKind.Attack
          || order === OrderKind.ForceAttack
          || order === OrderKind.AttackMove;
        if (order !== OrderKind.Move && !attack) continue;
        if (moveOrdersHome(this.world, i, hi)) {
          // A bomber already in its bay should not launch just because the
          // player clicked its own airbase again.
          st.orderKind[i] = OrderKind.None;
          st.orderTarget[i] = 0;
          st.state[i] = UnitState.Idle;
          continue;
        }
        beginFlight(this.world, i);
        st.sortieData[i] = pack(
          attack ? BomberSortieState.EnRoute : BomberSortieState.FreeFlight,
          sortieSlot(data), true, 0,
        );
        st.state[i] = attack
          ? (order === OrderKind.AttackMove ? UnitState.AttackMoving : UnitState.Attacking)
          : UnitState.Moving;
        continue;
      }

      if (state === BomberSortieState.FreeFlight) {
        const order = st.orderKind[i] as OrderKind;
        const attack = order === OrderKind.Attack
          || order === OrderKind.ForceAttack
          || order === OrderKind.AttackMove;
        if (attack && sortieHasBomb(data)) {
          st.sortieData[i] = pack(
            BomberSortieState.EnRoute, sortieSlot(data), true, sortieRearm(data),
          );
          st.state[i] = order === OrderKind.AttackMove
            ? UnitState.AttackMoving : UnitState.Attacking;
        } else if (order === OrderKind.Guard || moveOrdersHome(this.world, i, hi)) {
          bomberBayPosition(this.world, hi, sortieSlot(data), this.point);
          st.sortieData[i] = pack(
            BomberSortieState.Returning, sortieSlot(data), sortieHasBomb(data), sortieRearm(data),
          );
          st.targetId[i] = 0;
          st.orderTarget[i] = 0;
          st.orderKind[i] = OrderKind.Move;
          st.orderX[i] = this.point[0];
          st.orderZ[i] = this.point[1];
          st.state[i] = UnitState.Moving;
          st.stance[i] = Stance.HoldFire;
        } else if (attack) {
          // An empty bomber remains controllable but cannot fake a second
          // strike. Recall it with Guard to land and begin the rearm cycle.
          st.targetId[i] = 0;
          st.orderTarget[i] = 0;
          st.orderKind[i] = OrderKind.None;
          st.state[i] = UnitState.Idle;
        }
        continue;
      }

      if (state === BomberSortieState.EnRoute) {
        const order = st.orderKind[i] as OrderKind;
        // An explicit strike can lose its target before the bomber gets a
        // firing window (another unit kills it, or it is pending destruction).
        // Leaving the stale Attack order in place strands the aircraft in
        // EnRoute forever: Targeting has no live target to resolve and this
        // state no longer has a destination that movement can finish. A
        // one-bomb sortie has no useful reason to loiter in that case, so RTB.
        const explicitTarget = order === OrderKind.Attack || order === OrderKind.ForceAttack;
        if (explicitTarget && st.orderTarget[i] !== 0) {
          const ti = st.index(st.orderTarget[i] as EntityId);
          if (ti < 0 || (st.flags[ti] & EntityFlag.PendingDestroy) !== 0) {
            orderHome(this.world, i, hi, data);
            continue;
          }
        }
        if (moveOrdersHome(this.world, i, hi) || order === OrderKind.Guard) {
          orderHome(this.world, i, hi, data);
        } else if (order === OrderKind.Move
            || (order === OrderKind.None && st.state[i] === UnitState.Idle)) {
          // Stop or a normal move cancels the attack run without forcing the
          // aircraft home. The loaded bomb remains available for a later run.
          st.sortieData[i] = pack(
            BomberSortieState.FreeFlight, sortieSlot(data), sortieHasBomb(data), 0,
          );
          st.targetId[i] = 0;
          st.orderTarget[i] = 0;
        }
        continue;
      }

      if (state === BomberSortieState.Returning) {
        bomberBayPosition(this.world, hi, sortieSlot(data), this.point);
        const order = st.orderKind[i] as OrderKind;
        const manualStop = order === OrderKind.None && st.state[i] === UnitState.Idle;
        const manualMove = order === OrderKind.Move && !moveOrdersHome(this.world, i, hi)
          && Math.abs(st.orderX[i] - this.point[0]) + Math.abs(st.orderZ[i] - this.point[1]) > 0.5;
        const newAttack = sortieHasBomb(data) && (
          order === OrderKind.Attack
          || order === OrderKind.ForceAttack
          || order === OrderKind.AttackMove
        );
        if (manualStop || manualMove || newAttack) {
          st.sortieData[i] = pack(
            newAttack ? BomberSortieState.EnRoute : BomberSortieState.FreeFlight,
            sortieSlot(data), sortieHasBomb(data), sortieRearm(data),
          );
          if (newAttack) st.state[i] = UnitState.Attacking;
          continue;
        }
        st.orderX[i] = this.point[0];
        st.orderZ[i] = this.point[1];
        const dx = st.posX[i] - this.point[0];
        const dz = st.posZ[i] - this.point[1];
        // NavAssigner parks a hull at `radius + NAV_ARRIVE_SLACK`. The old
        // fixed 3.25 m touchdown circle was smaller than every strategic
        // bomber's ~7 m navigation arrival radius, so steering stopped while
        // the sortie controller waited forever for a distance it could never
        // reach. Accept the same hull-aware arrival contract here.
        const dockRadius = Math.max(MIN_DOCK_RADIUS, st.radius[i] + NAV_ARRIVE_SLACK);
        if (dx * dx + dz * dz <= dockRadius * dockRadius) {
          const hasBomb = sortieHasBomb(data);
          const interruptedRearm = sortieRearm(data);
          park(this.world, i, hi, this.point[0], this.point[1]);
          st.sortieData[i] = hasBomb
            ? pack(BomberSortieState.DockedReady, sortieSlot(data), true, 0)
            : pack(
              BomberSortieState.Reloading, sortieSlot(data), false,
              interruptedRearm > 0 ? interruptedRearm : BOMBER_REARM_TICKS,
            );
        }
        continue;
      }

      if (state === BomberSortieState.Reloading) {
        const flags = st.flags[hi];
        const complete = (flags & EntityFlag.UnderConstruction) === 0 && st.buildProgress[hi] >= 1;
        const powered = (flags & (EntityFlag.NeedsPower | EntityFlag.Powered)) !== EntityFlag.NeedsPower;
        let ticks = sortieRearm(data);
        if (complete && powered && ticks > 0) ticks--;
        st.sortieData[i] = ticks === 0
          ? pack(BomberSortieState.DockedReady, sortieSlot(data), true, 0)
          : pack(BomberSortieState.Reloading, sortieSlot(data), false, ticks);
      }
    }
  }

  /** Runs after the weapon pass so a successful single release orders RTB. */
  postWeaponsTick(): void {
    const st = this.world.store;
    const units = st.alive;
    const count = st.aliveCount;
    for (let a = 0; a < count; a++) {
      const i = units[a];
      const data = st.sortieData[i];
      if (sortieState(data) !== BomberSortieState.EnRoute || !sortieHasBomb(data)) continue;
      // The Albatross has no other weapon. A positive cooldown immediately
      // after Weapons therefore means its one bomb was actually released.
      if (st.cooldown[i] <= 0) continue;
      const hi = st.index(st.sortieHostId[i] as EntityId);
      if (hi < 0) continue;
      orderHome(this.world, i, hi, data, false);
    }
  }
}

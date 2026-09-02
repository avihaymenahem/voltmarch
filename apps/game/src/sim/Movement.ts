/**
 * ============================================================================
 * VOLTMARCH — src/sim/Movement.ts
 * ============================================================================
 * THE INTEGRATOR. Phase.Movement (700).
 *
 * Steering produced a DESIRED velocity. This turns it into an actual pose:
 * chassis-specific turning, acceleration, terrain conforming, body pitch/roll
 * from the ground normal, overlap relaxation, and the tread/wake/dust hooks.
 *
 * WHY THE CHASSIS MODELS MATTER VISUALLY
 * --------------------------------------
 * §0 property 2 of the look bible calls units "toys" — chamfered, oversized,
 * deliberately readable. A toy that slides around like a cursor destroys that
 * read instantly. The four models below are the cheapest possible way to make
 * an Anvil feel like 40 tonnes and a conscript feel like a person:
 *
 *   Foot   — free pivot. Faces travel almost immediately, no speed penalty.
 *   Track  — TURNS IN PLACE. Beyond MOVE_TURN_IN_PLACE_ANGLE of heading error
 *            the hull stops and rotates, then drives. This single rule is what
 *            makes tracked vehicles read as tracked.
 *   Wheel  — TURNING CIRCLE. Turn rate scales with speed, so a stationary
 *            wheeled vehicle can barely turn and has to roll forward to swing
 *            its nose around.
 *   Hover  — slides. Travel direction is a blend of hull forward and the
 *            steering direction, so hovercraft drift through corners.
 *   Naval  — like Track but with a long turn and no in-place rotation, plus a
 *            slow bob and a heel out of the turn.
 *   Air    — banks into turns, holds a cruise altitude over the heightfield.
 *
 * BODY PITCH AND ROLL — NOT OPTIONAL
 * ----------------------------------
 * A tank cresting a ridge MUST tilt. Without it the whole game reads as
 * sprites on a plane no matter how good the terrain is. We sample the ground
 * normal, decompose it onto the hull's forward and right axes, clamp, and damp.
 *
 * SIGN CONVENTION (matches src/render/RenderBridge.ts's header exactly):
 *   hullPitch > 0 raises the +Z-facing nose (applied as Euler-X of -pitch).
 *   hullRoll  > 0 drops the +X side.        (applied as Euler-Z, YXZ order.)
 * So: ground rising ahead => positive pitch. Ground rising to the RIGHT =>
 * the right side goes UP => NEGATIVE roll. Both fall out of the atan2 forms
 * below; if the bridge ever flips its convention, these two lines flip too.
 *
 * PREV COLUMNS
 * ------------
 * `GameLoop.stepSim` calls `store.snapshotPrev()` before any system runs, so
 * prevX/prevZ/prevYaw are already correct when we mutate here. This module
 * must never write them itself — doing so would zero the render interpolation
 * and every unit would visibly step at 30 Hz.
 * ============================================================================
 */

import {
  MAP_SIZE, MAX_ENTITIES, RELAX_DAMPING, RELAX_ITERATIONS, RELAX_MAX_PUSH,
  MAX_QUERY_RESULTS, WATER_LEVEL,
  MOVE_DECEL_MUL, MOVE_TURN_IN_PLACE_ANGLE, MOVE_TRACK_CORNER_BRAKE,
  MOVE_WHEEL_MIN_TURN_FRAC, MOVE_WHEEL_CORNER_BRAKE, MOVE_FOOT_TURN_MUL,
  MOVE_HOVER_TURN_MUL, MOVE_HOVER_DRIFT, MOVE_NAVAL_TURN_MUL, MOVE_NAVAL_HEEL,
  MOVE_NAVAL_BOB, MOVE_NAVAL_BOB_HZ, MOVE_AIR_TURN_MUL, MOVE_AIR_BANK,
  MOVE_TILT_LAMBDA, MOVE_MAX_TILT, MOVE_TREAD_SPACING, MOVE_DUST_METRES,
  MOVE_WAKE_METRES, MOVE_MIN_FX_SPEED, MOVE_TREAD_GAUGE_FRAC,
  AIR_CRUISE_ALTITUDE, AIR_CLIMB_LAMBDA, SIM_DT,
} from '../core/config';
import { EntityFlag, EntityKind, FxKind, UpgradeLever } from '../core/types';
import type { EntityId, SimContext } from '../core/types';
import type { EntityStore, World } from '../core/world';
import type { Channels } from '../core/events';
import { angleDelta, clamp, hashU32, isInMap, turnToward, worldToCell } from '../core/math';
import {
  MoveClass, locomotorForMoveClass, moveClassForLocomotor, movesShareSpace,
  type FlowFieldCache,
} from './Flowfield';
import { crushPassesThrough } from './Crush';
import { upgradeMul } from './Upgrades';
import { getTerrain } from '../world/Terrain';
import { layTread } from '../world/Decals';
import { addWake, waterLevelAt } from '../world/Water';
import { isRoad } from '../world/Roads';

/* ==========================================================================
 * 1. THE MOVE-CLASS TABLE
 *
 * `Locomotor` has an Air member but no Naval one, so an aircraft declares
 * itself in the entity store and a ship still spawns as `Locomotor.Hover`.
 * This table is the override layer: whoever owns unit data calls
 * `setMoveClass` at spawn; anything that never does gets a lazy default
 * derived from its locomotor and — for Hover — from whether it is standing in
 * water the first time it is asked.
 * ========================================================================== */

/**
 * Per-slot class, valid only while `classStamp` matches the store generation.
 *
 * Module-level rather than per-instance so `setMoveClass` can stay a plain
 * function that any module can call with nothing but a store and a handle.
 * That is safe because the game has exactly one `World`; `resetMoveClasses()`
 * (called from the MovementIntegrator constructor) is what keeps a second one
 * — a new match, or a test rig — from inheriting the first one's table.
 */
const classOf = new Uint8Array(MAX_ENTITIES);
const classStamp = new Uint16Array(MAX_ENTITIES);

/** Forget every cached and explicit class. New match / new test rig. */
export function resetMoveClasses(): void {
  classStamp.fill(0);
  classOf.fill(0);
}

/**
 * Declare an entity's movement class. Call it any time after spawn; the value
 * survives until the slot is recycled.
 *
 * Aircraft no longer need it — `Locomotor.Air` carries that through
 * `moveClassForLocomotor`, which is the one mapping a saved game, a replay and
 * a scenario all agree on. This override remains the only way to say NAVAL,
 * because `Locomotor` still has no member for it, and the water heuristic in
 * `moveClassAt` is a guess rather than a declaration.
 */
export function setMoveClass(store: EntityStore, id: EntityId, cls: MoveClass): boolean {
  const i = store.index(id);
  if (i < 0) return false;
  classOf[i] = cls;
  classStamp[i] = store.gen[i];
  return true;
}

/** Clear an override so the slot falls back to the derived default. */
export function clearMoveClass(store: EntityStore, id: EntityId): void {
  const i = store.index(id);
  if (i < 0) return;
  classStamp[i] = 0;
}

/**
 * The movement class of a live slot. Derives and caches on first use.
 *
 * The Hover-on-water rule: a hovercraft and a destroyer are indistinguishable
 * in the entity store, so the first time we are asked about a Hover unit we
 * look at the cell it is standing in. Spawned on water => Naval (water only).
 * Spawned on land => Hover (amphibious). It is a heuristic, it is
 * deterministic, and `setMoveClass` overrides it.
 */
export function moveClassAt(store: EntityStore, i: number): MoveClass {
  if (classStamp[i] === store.gen[i]) return classOf[i] as MoveClass;
  let cls = moveClassForLocomotor(store.locomotor[i]);
  if (cls === MoveClass.Hover) {
    const t = getTerrain();
    const cx = worldToCell(store.posX[i]);
    const cz = worldToCell(store.posZ[i]);
    if (t !== null && isInMap(cx, cz) && t.isWater(cx, cz)) cls = MoveClass.Naval;
  }
  classOf[i] = cls;
  classStamp[i] = store.gen[i];
  return cls;
}

/** By handle, for callers outside the sim loop. */
export function moveClassOf(store: EntityStore, id: EntityId): MoveClass | -1 {
  const i = store.index(id);
  return i < 0 ? -1 : moveClassAt(store, i);
}

/**
 * True when entity slot `i` may physically occupy a world point.
 *
 * Relocation effects write positions without going through a flow field, so
 * they need the same movement-class distinction the integrator enforces:
 * ordinary ground units stay on dry passable ground, amphibious Hover units
 * may use either surface, ships require water, and aircraft only require an
 * in-map point. Keep this as the one relocation predicate; deriving a
 * `Locomotor` alone loses the Naval/Hover distinction because both are stored
 * as `Locomotor.Hover`.
 */
export function canRelocateTo(world: World, i: number, x: number, z: number): boolean {
  const cx = worldToCell(x);
  const cz = worldToCell(z);
  if (!isInMap(cx, cz)) return false;

  const cls = moveClassAt(world.store, i);
  if (cls === MoveClass.Air) return true;
  const terrain = world.terrain;
  if (cls === MoveClass.Naval) {
    return terrain.isWater(cx, cz)
      && terrain.isPassable(cx, cz, locomotorForMoveClass(cls));
  }
  return terrain.isPassable(cx, cz, locomotorForMoveClass(cls));
}

/* ==========================================================================
 * 2. PRESENTATION SINKS
 *
 * Movement drives three presentation channels directly: `Decals.layTread` for
 * tread marks, `Water.addWake` for ship wakes, and the PresentationQueue for
 * dust. All three free functions are no-ops before their module exists, so
 * nothing here is conditional on load order.
 *
 * The two sinks below are OVERRIDES, not fallbacks: a module that wants to
 * take a channel over (a fancier wake, a tread system with per-surface
 * material response) registers one and Movement stops calling the default.
 * ========================================================================== */

/** Called once per wake segment for a moving ship. */
export type WakeSink = (
  id: EntityId, x: number, z: number, dirX: number, dirZ: number, speed: number,
) => void;

/** Called once per tread-mark stamp. `gauge` is the track separation, metres. */
export type TreadSink = (
  id: EntityId, x: number, z: number, yaw: number, gauge: number, speed: number,
) => void;

let wakeSink: WakeSink | null = null;
let treadSink: TreadSink | null = null;

/** Water module: `setWakeSink((id,x,z,dx,dz,speed) => water.addWake(...))`. */
export function setWakeSink(fn: WakeSink | null): void { wakeSink = fn; }
/** Roads/decals module: register the tread-mark decal writer here. */
export function setTreadSink(fn: TreadSink | null): void { treadSink = fn; }

/* ==========================================================================
 * 3. SCRATCH
 * ========================================================================== */

const N3 = new Float32Array(3);
const NEIGHBOURS = new Int32Array(MAX_QUERY_RESULTS);
/** Neighbours examined per unit per relaxation iteration. */
const RELAX_SCAN_CAP = 12;
/** Metres travelled since the last tread stamp / dust puff / wake segment. */
const treadAccum = new Float32Array(MAX_ENTITIES);
const dustAccum = new Float32Array(MAX_ENTITIES);
const wakeAccum = new Float32Array(MAX_ENTITIES);

/* ==========================================================================
 * 4. THE INTEGRATOR
 * ========================================================================== */

/**
 * Eight unit directions for splitting a perfect stack, as EXACT constants.
 *
 * 0, +/-1 and +/-Math.SQRT1_2 — every component is exactly representable and
 * every vector is exactly unit length, so no trigonometry is on the path and
 * two machines in a lockstep match cannot disagree in the last mantissa bit.
 * Eight rather than four so a pile of six does not open along one axis.
 */
const SEPARATE_DIRS = new Float64Array([
  1, 0,
  Math.SQRT1_2, Math.SQRT1_2,
  0, 1,
  -Math.SQRT1_2, Math.SQRT1_2,
  -1, 0,
  -Math.SQRT1_2, -Math.SQRT1_2,
  0, -1,
  Math.SQRT1_2, -Math.SQRT1_2,
]);

export class MovementIntegrator {
  /** Diagnostics. */
  public moved = 0;
  public relaxPushes = 0;

  constructor(
    private readonly world: World,
    private readonly nav: FlowFieldCache,
    private readonly channels: Channels,
  ) {
    // The class table is module-level (see `resetMoveClasses`); claiming it
    // here is what stops a second World inheriting the first one's answers.
    resetMoveClasses();
    treadAccum.fill(0);
    dustAccum.fill(0);
    wakeAccum.fill(0);
  }

  simTick(s: SimContext): void {
    const w = this.world;
    const st = w.store;
    const dt = s.dt;
    const terrain = w.terrain;
    let moved = 0;

    const n = st.aliveCount;
    for (let a = 0; a < n; a++) {
      const i = st.alive[a];
      const f = st.flags[i];
      if ((f & EntityFlag.Alive) === 0) continue;
      if ((f & (EntityFlag.PendingDestroy | EntityFlag.Garrisoned)) !== 0) continue;
      if ((f & EntityFlag.CanMove) === 0) continue;
      const kind = st.kind[i];
      if (kind !== EntityKind.Infantry && kind !== EntityKind.Vehicle) continue;

      const cls = moveClassAt(st, i);
      const immobile = (f & EntityFlag.Immobilized) !== 0;

      /* -- desired velocity from Steering -------------------------------- */
      let wantSpeed = 0;
      if (!immobile) {
        const vx = st.velX[i], vz = st.velZ[i];
        wantSpeed = Math.sqrt(vx * vx + vz * vz);
      }
      // THE PURCHASED SPEED MULTIPLIER, read at the instant the cap is applied.
      // `st.maxSpeed` itself is never touched: it is the unit's authored stat,
      // it is what `SaveGame` round-trips, and it is what the AI's scout picker
      // (`AI.ts:2234`) scores hulls on. Scaling it in place would make a loaded
      // save re-apply the upgrade on top of itself.
      const maxSpeed = st.maxSpeed[i]
        * upgradeMul(w.players[st.owner[i]], UpgradeLever.Speed, kind as EntityKind);
      if (wantSpeed > maxSpeed) wantSpeed = maxSpeed;

      /* -- turning ------------------------------------------------------- */
      const yaw0 = st.yaw[i];
      const desired = wantSpeed > 0.02 ? st.desiredYaw[i] : yaw0;
      const err = angleDelta(yaw0, desired);
      const absErr = err < 0 ? -err : err;
      const turnRate = st.turnRate[i];
      let allow = 1;
      let turnStep = turnRate * dt;

      switch (cls) {
        case MoveClass.Foot:
          // Free pivot: infantry face where they walk almost immediately and
          // never pay for it in speed.
          turnStep *= MOVE_FOOT_TURN_MUL;
          break;

        case MoveClass.Track:
          // Turn in place: past the threshold the hull stops and rotates.
          if (absErr > MOVE_TURN_IN_PLACE_ANGLE) allow = 0;
          else allow = 1 - (absErr / MOVE_TURN_IN_PLACE_ANGLE) * MOVE_TRACK_CORNER_BRAKE;
          break;

        case MoveClass.Wheel: {
          // Turning circle: steering authority is proportional to road speed.
          const frac = maxSpeed > 0 ? st.speed[i] / maxSpeed : 0;
          turnStep *= clamp(frac, MOVE_WHEEL_MIN_TURN_FRAC, 1);
          allow = 1 - Math.min(1, absErr / Math.PI) * MOVE_WHEEL_CORNER_BRAKE;
          break;
        }

        case MoveClass.Hover:
          turnStep *= MOVE_HOVER_TURN_MUL;
          break;

        case MoveClass.Naval:
          turnStep *= MOVE_NAVAL_TURN_MUL;
          // A ship cannot pivot; it needs way on to turn at all.
          allow = 1 - Math.min(1, absErr / Math.PI) * 0.35;
          break;

        case MoveClass.Air:
          turnStep *= MOVE_AIR_TURN_MUL;
          break;
      }

      const yaw = turnToward(yaw0, desired, turnStep);
      const applied = angleDelta(yaw0, yaw);
      st.yaw[i] = yaw;

      /* -- speed --------------------------------------------------------- */
      const target = wantSpeed * allow;
      const speed0 = st.speed[i];
      const rate = (target > speed0 ? st.accel[i] : st.accel[i] * MOVE_DECEL_MUL) * dt;
      let speed = speed0 + clamp(target - speed0, -rate, rate);
      if (speed < 0) speed = 0;
      st.speed[i] = speed;

      /* -- travel direction ---------------------------------------------- */
      const fwdX = Math.sin(yaw), fwdZ = Math.cos(yaw);
      let dirX = fwdX, dirZ = fwdZ;
      if (cls === MoveClass.Foot || cls === MoveClass.Hover) {
        // These two may travel off-axis. Infantry effectively always face
        // their travel direction anyway; hovercraft drift.
        const vx = st.velX[i], vz = st.velZ[i];
        const vl = Math.sqrt(vx * vx + vz * vz);
        if (vl > 1e-4) {
          const sx = vx / vl, sz = vz / vl;
          const k = cls === MoveClass.Foot ? 1 : MOVE_HOVER_DRIFT;
          dirX = fwdX + (sx - fwdX) * k;
          dirZ = fwdZ + (sz - fwdZ) * k;
          const dl = Math.sqrt(dirX * dirX + dirZ * dirZ);
          if (dl > 1e-4) { dirX /= dl; dirZ /= dl; }
        }
      }

      /* -- integrate ------------------------------------------------------ */
      const px = st.posX[i], pz = st.posZ[i];
      const step = speed * dt;
      let nx = px + dirX * step;
      let nz = pz + dirZ * step;

      if (step > 0) {
        const margin = st.radius[i];
        nx = clamp(nx, margin, MAP_SIZE - margin);
        nz = clamp(nz, margin, MAP_SIZE - margin);
        // Wall slide: if the new cell is closed, keep whichever axis is open.
        //
        // Skipped entirely when the cell we are STANDING IN is already closed.
        // That happens for real — a structure lands on a unit, terrain is
        // regenerated under an army, a spawn lands on a cliff — and the
        // constraint exists to keep units OUT of blocked cells, not to
        // imprison them in one. Enforcing it from inside a blocked cell means
        // every candidate fails, the unit can never take a step in any
        // direction, and it is frozen for the rest of the match with no
        // watchdog able to help it (a frozen unit is in no region at all, so
        // the pocket rescue in Steering cannot see it either).
        if (cls !== MoveClass.Air && !this.canStand(nx, nz, cls)) {
          const standing = this.canStand(px, pz, cls);
          if (standing) {
            if (this.canStand(nx, pz, cls)) {
              nz = pz;
            } else if (this.canStand(px, nz, cls)) {
              nx = px;
            } else {
              nx = px; nz = pz;
              // Fully boxed in: kill the momentum so the chassis does not keep
              // grinding at full throttle into the obstacle.
              speed *= 0.35;
              st.speed[i] = speed;
            }
          } else if (
            cls !== MoveClass.Hover && cls !== MoveClass.Naval
            && terrain.isWater(worldToCell(px), worldToCell(pz))
            && terrain.isWater(worldToCell(nx), worldToCell(nz))
          ) {
            // A malformed spawn or position-writing effect may leave a ground
            // unit on water. The general closed-cell escape rule below this
            // branch must still let a unit drive OUT of a building or a cliff,
            // but water is different: advancing from one wet cell to another
            // turns one bad placement into a tank that can cross the sea.
            // Hold it here; a dry, standable next cell remains a legal escape.
            nx = px; nz = pz;
            speed *= 0.35;
            st.speed[i] = speed;
          }
        }
      }

      const travelled = Math.abs(nx - px) + Math.abs(nz - pz);
      st.posX[i] = nx;
      st.posZ[i] = nz;
      if (travelled > 1e-4) moved++;

      /* -- height --------------------------------------------------------- */
      const ground = terrain.heightAt(nx, nz);
      if (cls === MoveClass.Air) {
        const cruise = ground + AIR_CRUISE_ALTITUDE;
        // Exponential approach so an aircraft crossing a mesa climbs rather
        // than teleporting to the new altitude.
        st.posY[i] = st.posY[i] + (cruise - st.posY[i]) * (1 - Math.exp(-AIR_CLIMB_LAMBDA * dt));
      } else if (cls === MoveClass.Naval) {
        // The water module owns the surface height; WATER_LEVEL is the answer
        // on a map that has no water module (or no water).
        const wl = waterLevelAt(nx, nz);
        st.posY[i] = wl > -Infinity ? wl : WATER_LEVEL;
      } else if (cls === MoveClass.Hover) {
        st.posY[i] = ground > WATER_LEVEL ? ground : WATER_LEVEL;
      } else {
        st.posY[i] = ground;
      }

      /* -- body pitch / roll ---------------------------------------------- */
      this.applyTilt(i, cls, nx, nz, yaw, applied, dt, s.tick, turnRate);

      /* -- cell cache and tread scroll ------------------------------------ */
      st.cellX[i] = worldToCell(nx);
      st.cellZ[i] = worldToCell(nz);
      st.treadPhase[i] = (st.treadPhase[i] + speed * dt) % 64;

      /* -- ground / water FX ---------------------------------------------- */
      if (speed > MOVE_MIN_FX_SPEED) this.emitTrail(i, cls, nx, nz, yaw, speed, step);
      else { treadAccum[i] = 0; dustAccum[i] = 0; wakeAccum[i] = 0; }
    }

    this.moved = moved;
    this.relax();
  }

  /* ---------------------------------------------------------------------- */

  /**
   * True when a class may PHYSICALLY occupy the cell containing (x,z).
   *
   * `isStandable`, not `isPassableClass`. The two differ by the nav clearance
   * rule (Flowfield §4c), which closes corridors narrower than the widest hull
   * so the PLANNER never routes anybody into one. Applying that same rule here
   * would be the opposite of the intent: a unit that is already inside a slot —
   * because it was there before the second building finished, because a
   * scenario posed it there, because relaxation shoved it — could no longer
   * take a step in any direction and would be frozen for the rest of the match.
   * Physics enforces the ground and the footprints; planning enforces the fit.
   */
  private canStand(x: number, z: number, cls: MoveClass): boolean {
    const cx = worldToCell(x), cz = worldToCell(z);
    if (!isInMap(cx, cz)) return false;
    return this.nav.isStandable(cx, cz, cls);
  }

  /**
   * Ground normal -> hull pitch/roll, or motion -> bank for the classes that
   * are not on the ground. Damped, because a raw per-tick normal read makes a
   * unit crossing a terrace seam snap by several degrees in one tick.
   */
  private applyTilt(
    i: number, cls: MoveClass,
    x: number, z: number, yaw: number,
    appliedTurn: number, dt: number, tick: number, turnRate: number,
  ): void {
    const st = this.world.store;
    let targetPitch = 0;
    let targetRoll = 0;

    if (cls === MoveClass.Air) {
      // Bank proportional to how hard we are actually turning this tick.
      const maxTurn = turnRate * dt;
      const frac = maxTurn > 1e-6 ? clamp(appliedTurn / maxTurn, -1, 1) : 0;
      targetRoll = frac * MOVE_AIR_BANK;
      targetPitch = -frac * MOVE_AIR_BANK * 0.15;
    } else if (cls === MoveClass.Naval) {
      const maxTurn = turnRate * dt;
      const frac = maxTurn > 1e-6 ? clamp(appliedTurn / maxTurn, -1, 1) : 0;
      // Heel OUT of the turn: turning right (+ yaw) lifts the +X side.
      targetRoll = -frac * MOVE_NAVAL_HEEL;
      // Slow bob, phased per entity so a fleet does not pulse in unison.
      // `tick` and `seed`, never a wall clock — this stays deterministic.
      const phase = tick * SIM_DT * MOVE_NAVAL_BOB_HZ * Math.PI * 2 + st.seed[i] * 6.2831853;
      targetPitch = Math.sin(phase) * MOVE_NAVAL_BOB;
      targetRoll += Math.cos(phase * 0.7) * MOVE_NAVAL_BOB * 0.6;
    } else {
      this.world.terrain.normalAt(x, z, N3);
      const ny = N3[1] > 0.2 ? N3[1] : 0.2;
      const fx = Math.sin(yaw), fz = Math.cos(yaw);
      const rx = Math.cos(yaw), rz = -Math.sin(yaw);
      const nf = N3[0] * fx + N3[2] * fz;
      const nr = N3[0] * rx + N3[2] * rz;
      // Ground rising ahead => nf < 0 => positive pitch => nose up. Ground
      // rising to the right => nr < 0 => negative roll => +X side up.
      targetPitch = clamp(Math.atan2(-nf, ny), -MOVE_MAX_TILT, MOVE_MAX_TILT);
      targetRoll = clamp(Math.atan2(nr, ny), -MOVE_MAX_TILT, MOVE_MAX_TILT);
    }

    const k = 1 - Math.exp(-MOVE_TILT_LAMBDA * dt);
    st.hullPitch[i] += (targetPitch - st.hullPitch[i]) * k;
    st.hullRoll[i] += (targetRoll - st.hullRoll[i]) * k;
  }

  /**
   * Tread marks, dust and wakes. All three are DISTANCE gated, not time gated:
   * a unit crawling out of a factory must not machine-gun decals, and a unit at
   * full speed must not leave a dotted line.
   */
  private emitTrail(
    i: number, cls: MoveClass,
    x: number, z: number, yaw: number, speed: number, step: number,
  ): void {
    const st = this.world.store;
    const id = st.handleOf(i);
    const faction = st.faction[i];

    if (cls === MoveClass.Naval) {
      wakeAccum[i] += step;
      if (wakeAccum[i] >= MOVE_WAKE_METRES) {
        wakeAccum[i] = 0;
        const fx = Math.sin(yaw), fz = Math.cos(yaw);
        if (wakeSink !== null) {
          wakeSink(id, x, z, fx, fz, speed);
        } else {
          // `Water.addWake` takes atan2(dz, dx) — the OPPOSITE argument order
          // to our yaw convention (atan2(dx, dz)). Derive it from the forward
          // vector rather than converting the angle, so a future change to
          // either convention cannot silently mirror every wake.
          const maxSpeed = st.maxSpeed[i];
          const strength = maxSpeed > 0 ? speed / maxSpeed : 0;
          const landed = addWake(x, z, Math.atan2(fz, fx), strength, st.radius[i] * 3);
          if (!landed) {
            this.channels.fx.push(
              FxKind.Splash, x, st.posY[i], z, fx, 0, fz, 0.6, id, faction,
            );
          }
        }
      }
      return;
    }
    if (cls === MoveClass.Air) return;

    if (cls === MoveClass.Track || cls === MoveClass.Wheel) {
      treadAccum[i] += step;
      if (treadAccum[i] >= MOVE_TREAD_SPACING) {
        treadAccum[i] = 0;
        const gauge = st.radius[i] * MOVE_TREAD_GAUGE_FRAC * 2;
        if (treadSink !== null) {
          treadSink(id, x, z, yaw, gauge, speed);
        } else {
          // Bible 8.10: two strips at track gauge multiplying the ground, and
          // a much fainter mark on paving. `layTread` is a safe no-op before
          // the decal field exists.
          layTread(x, z, yaw, gauge, isRoad(x, z), cls === MoveClass.Wheel);
        }
      }
    }

    dustAccum[i] += step;
    if (dustAccum[i] >= MOVE_DUST_METRES) {
      dustAccum[i] = 0;
      const back = -Math.sin(yaw), backZ = -Math.cos(yaw);
      this.channels.fx.push(
        FxKind.DustTrail,
        x + back * st.radius[i] * 0.7, st.posY[i] + 0.15, z + backZ * st.radius[i] * 0.7,
        back, 0.35, backZ,
        cls === MoveClass.Track ? 1 : 0.7,
        id, faction,
      );
    }
  }

  /**
   * Push overlapping units apart, and push them out of solid scenery.
   * Steering's separation term handles the approach; this is the hard
   * constraint that stops two tanks ending a tick inside each other after a
   * head-on meeting.
   *
   * It used to be the one thing that made a `BlocksNav` prop solid, which is
   * why it took `EntityKind.Prop` at all. Rocks and boulders are ordinary
   * scenery now — see `FALLBACK_PROPS` — so nothing here special-cases a prop
   * and the `CanMove` test skips every one of them.
   *
   * Position-based and applied in `alive` order, so it is order-dependent but
   * fully deterministic. Each unit moves only ITSELF by half the overlap; the
   * partner does the same on its own visit, which nets the full separation
   * without needing a symmetric write.
   */
  private relax(): void {
    const w = this.world;
    const st = w.store;
    let pushes = 0;

    const n = st.aliveCount;
    for (let a = 0; a < n; a++) {
      const i = st.alive[a];
      const f = st.flags[i];
      if ((f & EntityFlag.CanMove) === 0) continue;
      if ((f & (EntityFlag.PendingDestroy | EntityFlag.Garrisoned)) !== 0) continue;
      const kind = st.kind[i];
      if (kind !== EntityKind.Infantry && kind !== EntityKind.Vehicle) continue;

      const cls = moveClassAt(st, i);

      const ri = st.radius[i];

      // ONE broadphase query, RELAX_ITERATIONS corrections against it.
      //
      // The query is the expensive half (measured: 2.35 of the 2.75 ms this
      // pass costs at 240 units), and neighbourSHIP cannot change between two
      // sub-millimetre corrections even though the distances do. Capped for
      // the same reason as the steering scan: a converged blob puts the whole
      // army inside one radius, and only the nearest handful can overlap us.
      const count = w.spatial.queryCircle(
        st.posX[i], st.posZ[i], ri * 2 + 2, NEIGHBOURS, RELAX_SCAN_CAP,
      );
      if (count <= 1) continue;

      for (let iter = 0; iter < RELAX_ITERATIONS; iter++) {
        const px = st.posX[i], pz = st.posZ[i];
        let dxSum = 0, dzSum = 0;

        for (let q = 0; q < count; q++) {
          const j = NEIGHBOURS[q];
          if (j === i) continue;
          const jf = st.flags[j];
          if ((jf & (EntityFlag.PendingDestroy | EntityFlag.Garrisoned)) !== 0) continue;
          const jk = st.kind[j];

          /* NO PROP IS SOLID ANY MORE, and the branch that made one solid is
           * gone rather than disabled.
           *
           * It used to give `rock` and `boulder` a hard, full-overlap push, and
           * argued that keeping the constraint PHYSICAL rather than putting it
           * in the nav grid was the safe choice — "the flow field still routes
           * straight over the cell and the hull simply slides around a 3 m disc
           * that is smaller than the 4 m cell it sits in, so no route can ever
           * become unreachable". The opposite was already measured and recorded
           * in `config.ts` under HARVESTER_NAV_GIVEUP_SECONDS: a 2 m rock the
           * planner could not see sealed a one-cell corridor against a 3.87 m
           * hull and parked it for 2100 consecutive ticks. An obstacle that
           * stops a unit but is invisible to the thing choosing the route is
           * the worst of both designs, and it is what "they blocking in a weird
           * ways" describes.
           *
           * Props now fall through to the `CanMove` test below like any other
           * non-mover. `Steering`'s separation term still pushes hulls off them
           * softly, so they read as scenery rather than as holes. */
          if ((jf & EntityFlag.CanMove) === 0) continue;
          if (jk !== EntityKind.Infantry && jk !== EntityKind.Vehicle) continue;
          const jc = moveClassAt(st, j);
          if (!movesShareSpace(jc, cls)) continue;

          // A ROLLING HULL DOES NOT BOUNCE OFF A MAN IT IS ENTITLED TO CRUSH.
          //
          // The mirror image of the prop branch above: that one makes a rock
          // solid because `sim/Crush.ts` will not flatten it, and this one
          // makes a rifleman permeable because `sim/Crush.ts` will. Without it
          // the crush rule is correct and unreachable — this constraint holds
          // a Warden and a rifleman 3.02 m apart while the crush test needs
          // 2.19 m, and a measured probe put the closest approach at 2.83 m
          // with the man untouched on the far side.
          //
          // Symmetric and speed-gated inside `crushPassesThrough`, so a PARKED
          // tank keeps its collision and still shoves infantry out of its hull.
          if (crushPassesThrough(w, i, j)) continue;

          const dx = px - st.posX[j];
          const dz = pz - st.posZ[j];
          const want = ri + st.radius[j];
          const d2 = dx * dx + dz * dz;
          if (d2 >= want * want) continue;
          /*
           * TWO UNITS ON EXACTLY ONE POINT NEVER SEPARATE, AND THIS IS WHERE
           * THAT WAS TRUE.
           *
           * Reported as "dont allow soldier to be on top of each other". The
           * degenerate case used to fall out through `|| d2 < 1e-9` — it HAS
           * to leave the normal path, because the division by `d` below is
           * otherwise a divide by zero — and there was nothing behind it. Six
           * infantry at identical coordinates were measured at 0.0000 m
           * pairwise separation at 1, 10, 60, 300 AND 1800 ticks. Not slow to
           * resolve: permanent.
           *
           * It is reachable today without any new code. `Transport.setDownNear`
           * places passengers against terrain passability and `isOccupied`
           * only, with no entity test at all, and is saved from stacking solely
           * by `ordinal` rotating the starting spoke — so one refusal puts two
           * men on one spoke at one radius. A save/load restores positions
           * bit-exactly, so a stack survives it.
           *
           * THE DIRECTION MUST BE ANTISYMMETRIC IN (i, j) OR THE FIX MAKES IT
           * WORSE. Each unit moves only ITSELF here, by design — the partner
           * does the same on its own visit, which is what avoids an ordering
           * hazard — so a direction derived symmetrically would send both the
           * same way and translate the stack instead of splitting it. The pair
           * hash is taken on (min, max) so both visits agree on the axis, and
           * the sign is flipped for the higher index so they walk apart.
           *
           * EXACT ARITHMETIC ONLY, because this runs inside `simTick` on a
           * lockstep path. The eight directions are 0, +/-1 and +/-SQRT1_2 —
           * constants, not trigonometry — and `hashU32` is integer. Two
           * machines cannot disagree about which way a stack opened.
           */
          if (d2 < 1e-9) {
            const lo = i < j ? i : j;
            const hi = i < j ? j : i;
            const k = (hashU32(lo * 0x9e37 + hi) & 7) * 2;
            const sign = i < j ? 1 : -1;
            const push = want * 0.5 * RELAX_DAMPING;
            dxSum += SEPARATE_DIRS[k] * sign * push;
            dzSum += SEPARATE_DIRS[k + 1] * sign * push;
            continue;
          }
          const d = Math.sqrt(d2);
          // Each unit moves only ITSELF, by half the overlap; the partner does
          // the same on its own visit, which nets the full separation without
          // a symmetric write (and therefore without an ordering hazard).
          const overlap = (want - d) * 0.5 * RELAX_DAMPING;
          dxSum += (dx / d) * overlap;
          dzSum += (dz / d) * overlap;
        }

        if (dxSum === 0 && dzSum === 0) break;
        const cap = ri * RELAX_MAX_PUSH;
        const l = Math.sqrt(dxSum * dxSum + dzSum * dzSum);
        if (l > cap) { dxSum = dxSum / l * cap; dzSum = dzSum / l * cap; }

        let nx = clamp(px + dxSum, ri, MAP_SIZE - ri);
        let nz = clamp(pz + dzSum, ri, MAP_SIZE - ri);
        // Relaxation must never shove a unit into a cliff or a building.
        if (!this.canStand(nx, nz, cls)) {
          if (this.canStand(nx, pz, cls)) nz = pz;
          else if (this.canStand(px, nz, cls)) nx = px;
          else break;
        }
        if (nx === px && nz === pz) break;
        st.posX[i] = nx;
        st.posZ[i] = nz;
        pushes++;
      }

      st.cellX[i] = worldToCell(st.posX[i]);
      st.cellZ[i] = worldToCell(st.posZ[i]);
      // Naval sits on the waterline and does not resample; aircraft use the
      // same in-map ride-height path as every other non-naval mover.
      if (cls !== MoveClass.Naval) {
        st.posY[i] = this.nav.rideHeight(cls, st.posX[i], st.posZ[i]);
      }
    }
    this.relaxPushes = pushes;
  }

  /** Between matches: forget every accumulator and class override. */
  reset(): void {
    treadAccum.fill(0);
    dustAccum.fill(0);
    wakeAccum.fill(0);
    resetMoveClasses();
  }
}

/* ==========================================================================
 * 5. SMALL PUBLIC HELPERS
 * ========================================================================== */

/**
 * Ground-relative forward vector of an entity, written into `out` as [x,z].
 * Combat and VFX both want this and neither should re-derive the convention.
 */
export function forwardOf(store: EntityStore, i: number, out: Float32Array): Float32Array {
  const y = store.yaw[i];
  out[0] = Math.sin(y); out[1] = Math.cos(y);
  return out;
}

/** True if this entity is currently making meaningful progress. */
export function isTravelling(store: EntityStore, i: number): boolean {
  return store.speed[i] > MOVE_MIN_FX_SPEED;
}

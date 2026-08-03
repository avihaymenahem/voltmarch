/**
 * ============================================================================
 * RED ALERT — src/sim/Targeting.ts
 * ============================================================================
 * WHO SHOOTS WHAT. Round-robin sliced acquisition over the spatial hash.
 *
 * TWO COSTS, DELIBERATELY SEPARATED
 * ---------------------------------
 *   VALIDATION runs for every armed entity every tick and is a handful of
 *   integer tests: is the handle still live, still hostile, still visible,
 *   still inside the leash. It has to run every tick, because a target that
 *   died must not be shot at for another quarter second.
 *
 *   ACQUISITION runs for 1/TARGETING_SLICE of the army per tick via
 *   `sliceForEntity`, plus immediately for any unit whose target just went
 *   invalid. It is a circle query, a scored sweep and at most two line-of-sight
 *   walks. At 200 units and TARGETING_SLICE = 8 that is 25 scans a tick.
 *
 * PERSISTENCE IS A FEATURE, NOT AN OPTIMISATION
 * ---------------------------------------------
 * Without hysteresis, twenty tanks in a firefight re-pick the marginally
 * closest enemy every tick and the whole army's turrets twitch. Three
 * mechanisms stop that:
 *   - the held target scores x`stickiness` (1.35) so a rival must be clearly
 *     better, not marginally better, to steal the lock;
 *   - the drop range (`leashRangeMul`) is wider than the acquire range
 *     (`acquireRangeMul`), so a target sitting exactly on the range boundary
 *     cannot oscillate;
 *   - acquisition is sliced, so even a genuine change of mind cannot happen
 *     more than once every TARGETING_SLICE ticks.
 *
 * SCORING, IN ONE SENTENCE
 * ------------------------
 * Prefer things that shoot back, things you can actually hurt, things that hurt
 * you recently, wounded things, and near things — in that order of weight, with
 * structures last unless they are defences.
 *
 * WRITE OWNERSHIP: this file writes `targetId` and nothing else.
 * DETERMINISM: no wall clock, no Math.random; candidate order comes from the
 * spatial index, which is a counting sort over the dense alive list.
 * ============================================================================
 */

import {
  COMBAT_TARGETING, MAX_QUERY_RESULTS, RETALIATE_MEMORY, TARGETING_SLICE,
} from '../core/config';
import {
  ArmorClass, EntityFlag, EntityKind, OrderKind, ProjectileKind, Stance, UnitState,
} from '../core/types';
import type { EntityId, PlayerId, SimContext, WeaponDef } from '../core/types';
import type { World } from '../core/world';
import type { Channels } from '../core/events';
import { sliceForEntity } from '../core/loop';
import { armorMultiplier, hitRadius } from './Damage';
import { stanceAllowsAcquire, stateAllowsCombat, weaponCanHurt } from './Combat';
import type { WeaponSystem } from './Combat';

export interface TargetingStats {
  /** Armed entities considered this tick. */
  armed: number;
  /** Entities holding a live target at the end of the tick. */
  engaged: number;
  /** Acquisition scans run this tick. */
  scans: number;
  /** Targets newly acquired this tick. */
  acquired: number;
  /** Candidates rejected for having no line of sight. */
  losRejects: number;
}

export class TargetingSystem {
  /** Owned scratch: the world's shared buffer is not re-entrant here. */
  private readonly candidates = new Int32Array(MAX_QUERY_RESULTS);

  readonly stats: TargetingStats = { armed: 0, engaged: 0, scans: 0, acquired: 0, losRejects: 0 };

  constructor(
    private readonly world: World,
    private readonly channels: Channels,
    private readonly weapons: WeaponSystem,
  ) {}

  /* ====================================================================== */

  tick(s: SimContext): void {
    const st = this.world.store;
    const n = st.aliveCount;
    this.stats.armed = 0;
    this.stats.engaged = 0;
    this.stats.scans = 0;
    this.stats.acquired = 0;
    this.stats.losRejects = 0;

    for (let a = 0; a < n; a++) {
      const i = st.alive[a];
      const f = st.flags[i];
      if ((f & EntityFlag.PendingDestroy) !== 0) continue;
      if ((f & EntityFlag.CanAttack) === 0) {
        if (st.targetId[i] !== 0) st.targetId[i] = 0;
        continue;
      }
      if ((f & EntityFlag.UnderConstruction) !== 0) { st.targetId[i] = 0; continue; }
      if (!stateAllowsCombat(st.state[i] as UnitState)) { st.targetId[i] = 0; continue; }

      const w = this.weapons.weaponFor(i);
      if (w === undefined) { st.targetId[i] = 0; continue; }
      this.stats.armed++;

      // --- an explicit order beats everything -----------------------------
      const order = st.orderKind[i] as OrderKind;
      if (order === OrderKind.Attack || order === OrderKind.ForceAttack) {
        const ot = st.index(st.orderTarget[i] as EntityId);
        if (ot >= 0 && (st.flags[ot] & EntityFlag.PendingDestroy) === 0) {
          // A forced attack ignores alliance, visibility and priority. It does
          // NOT ignore the leash: an order to attack something 400 m away still
          // has to wait for the movement layer to close the distance.
          st.targetId[i] = st.handleOf(ot) as number;
          this.stats.engaged++;
          continue;
        }
        // ForceAttack on a dead thing falls through to normal acquisition,
        // which is what makes "attack that tank" keep meaning something once
        // the tank is gone.
      }

      // --- validate ---------------------------------------------------------
      const hadTarget = st.targetId[i] !== 0;
      const cur = st.index(st.targetId[i] as EntityId);
      const stillGood = cur >= 0 && this.isValidTarget(i, cur, w, COMBAT_TARGETING.leashRangeMul);
      if (!stillGood && hadTarget) st.targetId[i] = 0;

      // --- acquire ----------------------------------------------------------
      // Slice ticks do the routine sweep. A unit that JUST lost its lock — the
      // target died, cloaked, or drove out of the leash — scans immediately
      // instead of waiting for its slot to come round, because standing idle
      // for a quarter second after a kill is the most visible AI failure an RTS
      // has. That burst is bounded by the number of targets lost this tick.
      const sliceTick = sliceForEntity(s.tick, i, TARGETING_SLICE);
      if (stillGood && !sliceTick) { this.stats.engaged++; continue; }
      if (!stillGood && !sliceTick && !hadTarget) continue;
      if (!stanceAllowsAcquire(st.stance[i] as Stance) && !stillGood) continue;

      const before = st.targetId[i];
      this.acquire(s, i, w, cur);
      if (st.targetId[i] !== 0) {
        this.stats.engaged++;
        if (st.targetId[i] !== before) this.stats.acquired++;
      }
    }
  }

  /* ======================================================================
   * VALIDATION
   * ====================================================================== */

  /** Everything that must remain true for `t` to stay this entity's target. */
  private isValidTarget(i: number, t: number, w: WeaponDef, rangeMul: number): boolean {
    const world = this.world;
    const st = world.store;
    const f = st.flags[t];
    if ((f & EntityFlag.Alive) === 0) return false;
    if ((f & (EntityFlag.PendingDestroy | EntityFlag.Cloaked |
              EntityFlag.Garrisoned | EntityFlag.NotATarget)) !== 0) return false;

    const me = st.owner[i] as PlayerId;
    if (world.areAllied(me, st.owner[t] as PlayerId)) return false;
    if (!weaponCanHurt(w, st.armorClass[t] as ArmorClass)) return false;
    if (!world.vision.canSee(me, st.handleOf(t))) return false;

    const dx = st.posX[t] - st.posX[i], dz = st.posZ[t] - st.posZ[i];
    const surface = Math.sqrt(dx * dx + dz * dz)
      - hitRadius(st.footprintW[t], st.footprintH[t], st.radius[t]);
    if (surface > w.range * rangeMul) return false;
    // A target that has walked INSIDE an artillery piece's dead zone is no
    // longer a target for it — otherwise the gun sits pointed at its own feet.
    if (w.minRange > 0 && surface < w.minRange * 0.75) return false;
    return true;
  }

  /* ======================================================================
   * ACQUISITION
   * ====================================================================== */

  /**
   * Sweep everything hostile inside the acquire radius and take the best.
   * Keeps the best AND the runner-up so a line-of-sight rejection has somewhere
   * to fall back to without a second query.
   */
  private acquire(s: SimContext, i: number, w: WeaponDef, currentIdx: number): void {
    const world = this.world;
    const st = world.store;
    this.stats.scans++;

    const radius = w.range * COMBAT_TARGETING.acquireRangeMul
      + hitRadius(st.footprintW[i], st.footprintH[i], st.radius[i]);
    const me = st.owner[i] as PlayerId;
    const myX = st.posX[i], myZ = st.posZ[i];
    const out = this.candidates;
    const count = world.spatial.queryCircleFat(
      myX, myZ, radius, out, Math.min(out.length, COMBAT_TARGETING.maxCandidates),
    );

    const retaliating = (s.time - st.lastHitTime[i]) <= RETALIATE_MEMORY;
    const revenge = retaliating ? (st.lastAttackerId[i] as number) : 0;
    const invRange = 1 / Math.max(1, w.range);

    let best = -1, bestScore = 0;
    let second = -1, secondScore = 0;

    for (let c = 0; c < count; c++) {
      const t = out[c];
      if (t === i) continue;
      if (!this.isValidTarget(i, t, w, COMBAT_TARGETING.acquireRangeMul)) continue;

      const dx = st.posX[t] - myX, dz = st.posZ[t] - myZ;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const tf = st.flags[t];
      const kind = st.kind[t] as EntityKind;

      let score = 1;
      if ((tf & EntityFlag.CanAttack) !== 0) score *= COMBAT_TARGETING.armedTarget;
      if (kind === EntityKind.Building) {
        score *= (tf & EntityFlag.CanAttack) !== 0
          ? COMBAT_TARGETING.defenceBuilding
          : COMBAT_TARGETING.softBuilding;
      }
      if ((tf & EntityFlag.IsHarvester) !== 0) score *= COMBAT_TARGETING.harvester;

      const maxHp = st.maxHp[t];
      if (maxHp > 0 && st.hp[t] / maxHp < COMBAT_TARGETING.woundedFrac) {
        score *= COMBAT_TARGETING.wounded;
      }
      if (revenge !== 0 && (st.handleOf(t) as number) === revenge) {
        score *= COMBAT_TARGETING.retaliation;
      }
      if (t === currentIdx) score *= COMBAT_TARGETING.stickiness;

      // Shooting a Rhino with a rifle is legal and almost always wrong.
      if (armorMultiplier(w.warhead, st.armorClass[t] as ArmorClass)
          <= COMBAT_TARGETING.ineffectiveBelow) {
        score *= COMBAT_TARGETING.ineffective;
      }

      score /= (COMBAT_TARGETING.distanceSoftness + dist * invRange);

      if (score > bestScore) {
        second = best; secondScore = bestScore;
        best = t; bestScore = score;
      } else if (score > secondScore) {
        second = t; secondScore = score;
      }
    }

    // Line of sight, only for the winner (and the runner-up if the winner is
    // behind a ridge). Arcing weapons skip it entirely — lobbing over cover is
    // the entire point of artillery.
    const needsLos = w.projectile !== ProjectileKind.Shell;
    if (best >= 0 && needsLos && !this.hasLineOfSight(i, best)) {
      this.stats.losRejects++;
      best = (second >= 0 && this.hasLineOfSight(i, second)) ? second : -1;
      if (best < 0) this.stats.losRejects++;
    }

    st.targetId[i] = best >= 0 ? (st.handleOf(best) as number) : 0;
  }

  /* ======================================================================
   * LINE OF SIGHT
   * ====================================================================== */

  /**
   * Walk the heightfield between the muzzle and the aim point.
   *
   * This is a TERRAIN test, not an occlusion test: units and buildings do not
   * block fire. That is a deliberate C&C rule, not a shortcut — mutual
   * blocking turns any two-rank formation into a traffic jam of units refusing
   * to shoot, and no Westwood game has ever done it.
   */
  private hasLineOfSight(i: number, t: number): boolean {
    const terrain = this.world.terrain;

    this.weapons.muzzleOf(i, LOS_A);
    this.weapons.aimPointOf(t, LOS_B);
    const ax = LOS_A[0], ay = LOS_A[1], az = LOS_A[2];
    const bx = LOS_B[0], by = LOS_B[1], bz = LOS_B[2];

    const dx = bx - ax, dz = bz - az;
    const flat = Math.sqrt(dx * dx + dz * dz);
    if (flat < 1e-3) return true;
    const steps = Math.min(24, Math.max(1, Math.ceil(flat / COMBAT_TARGETING.losStepMetres)));
    const clearance = COMBAT_TARGETING.losClearance;

    // Skip the endpoints: the muzzle is inside its own hull's cell and the aim
    // point is inside the target's, and both would self-block on a slope.
    for (let k = 1; k < steps; k++) {
      const u = k / steps;
      const sx = ax + dx * u;
      const sz = az + dz * u;
      const lineY = ay + (by - ay) * u;
      if (terrain.heightAt(sx, sz) > lineY + clearance) return false;
    }
    return true;
  }

  /** Between matches. */
  reset(): void {
    const st = this.world.store;
    for (let a = 0; a < st.aliveCount; a++) st.targetId[st.alive[a]] = 0;
  }
}

/** Module-level LOS scratch. Never held across a call. */
const LOS_A = new Float32Array(3);
const LOS_B = new Float32Array(3);

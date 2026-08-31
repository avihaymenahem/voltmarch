/**
 * ============================================================================
 * VOLTMARCH — src/sim/Projectiles.ts
 * ============================================================================
 * THE POOLED PROJECTILE STORE. 2048 slots, structure of arrays, allocated once.
 *
 * PROJECTILES ARE NOT ENTITIES. They have their own id space (`ProjectileId`),
 * their own free list and their own dense live list. They never touch
 * EntityStore, never appear in the spatial index, are never selectable, never
 * targetable, and never consume one of the 4096 entity slots. A 40-tank
 * skirmish can have 300 shells in the air without the entity store noticing.
 *
 * FOUR FLIGHT MODELS
 * ------------------
 *   Bullet   Flat, fast, no gravity. Swept segment test every tick.
 *   Shell    Real ballistics: the launch elevation is SOLVED at fire time by
 *            `ballisticArc`, then integrated under `COMBAT_PROJECTILES.gravity`.
 *            It bursts on the heightfield, so an artillery round that clears a
 *            ridge and lands behind it does exactly that.
 *   Rocket   Homing with a hard turn-rate limit, plus a short arming distance
 *            of straight flight so a launch reads as a launch.
 *   Flame    A short-lived cone of burning gas: splash on expiry, damage on
 *            contact, no gravity.
 *
 * Instant / Beam / TeslaBolt never enter this store — they resolve in the same
 * tick they are fired (see Combat.ts) and only push FX.
 *
 * WHY A SWEPT TEST AND NOT A POINT TEST
 * -------------------------------------
 * At 30 Hz a 120 m/s tank round covers FOUR METRES per tick, which is wider
 * than most hulls. A point-in-circle test at the end position tunnels through
 * roughly half of all targets. `segCircleHit` from core/math is the fix, and
 * it is not optional.
 *
 * ZERO ALLOCATION: every buffer here is allocated in the constructor. `tick()`
 * allocates nothing, takes no closures and calls no varargs.
 * ============================================================================
 */

import {
  COMBAT_PROJECTILES, MAX_PROJECTILES, MAX_QUERY_RESULTS, MAP_SIZE, WATER_LEVEL,
} from '../core/config';
import {
  EntityFlag, EntityKind, Faction, FxKind, NONE, ProjectileKind, WarheadClass,
} from '../core/types';
import type { EntityId, PlayerId, ProjectileId, SimContext } from '../core/types';
import type { World } from '../core/world';
import type { Channels } from '../core/events';
import { closestPointOnSegment, segCircleHit, DEG2RAD } from '../core/math';
import { estimatedHeight, hitRadius } from './Damage';

/** Per-projectile bitfield. */
const enum PFlag {
  /** Slot is in use. */
  Live = 1 << 0,
  /** Integrates under gravity and bursts on the heightfield. */
  Ballistic = 1 << 1,
  /** Steers toward `target` once past the arming distance. */
  Homing = 1 << 2,
  /** Detonates when its life expires rather than fizzling out. */
  BurstOnExpiry = 1 << 3,
  /** Has travelled past its arming distance. */
  Armed = 1 << 4,
}

/* ==========================================================================
 * THE STORE
 * ========================================================================== */

export class ProjectileSystem {
  readonly capacity = MAX_PROJECTILES;

  /* -- flight ------------------------------------------------------------- */
  readonly kind = new Uint8Array(MAX_PROJECTILES);
  readonly pflags = new Uint8Array(MAX_PROJECTILES);
  readonly x = new Float32Array(MAX_PROJECTILES);
  readonly y = new Float32Array(MAX_PROJECTILES);
  readonly z = new Float32Array(MAX_PROJECTILES);
  /** Position at the START of the current tick — the swept segment's origin. */
  readonly px = new Float32Array(MAX_PROJECTILES);
  readonly py = new Float32Array(MAX_PROJECTILES);
  readonly pz = new Float32Array(MAX_PROJECTILES);
  readonly vx = new Float32Array(MAX_PROJECTILES);
  readonly vy = new Float32Array(MAX_PROJECTILES);
  readonly vz = new Float32Array(MAX_PROJECTILES);
  readonly speed = new Float32Array(MAX_PROJECTILES);
  /** Radians per second of homing authority. */
  readonly turnRate = new Float32Array(MAX_PROJECTILES);
  readonly life = new Float32Array(MAX_PROJECTILES);
  /** Metres flown, for arming and for the trail bead cadence. */
  readonly travelled = new Float32Array(MAX_PROJECTILES);
  readonly nextBead = new Float32Array(MAX_PROJECTILES);

  /* -- payload ------------------------------------------------------------ */
  readonly damage = new Float32Array(MAX_PROJECTILES);
  readonly warhead = new Uint8Array(MAX_PROJECTILES);
  readonly splashRadius = new Float32Array(MAX_PROJECTILES);
  readonly splashFalloff = new Float32Array(MAX_PROJECTILES);
  /**
   * `WeaponDef.airMultiplier`, carried to the damage record this round writes.
   *
   * A ROUND IN FLIGHT DOES NOT KNOW ITS WEAPON — only `damage`, `warhead` and
   * the two splash numbers travel — so without this column the multiplier would
   * have to be folded into `damage` at SPAWN time, against the target the
   * shooter was AIMING at. `sweep` hits whatever it meets first, so a rifle
   * round fired at a gunship and clipping a passing tank would have taken the
   * gunship's answer to the tank. Three of the four rows that carry a
   * multiplier are `ProjectileKind.Bullet`, so this is their whole path.
   */
  readonly airMul = new Float32Array(MAX_PROJECTILES);
  readonly impactFx = new Uint8Array(MAX_PROJECTILES);
  readonly travelFx = new Uint8Array(MAX_PROJECTILES);

  /* -- provenance --------------------------------------------------------- */
  readonly attacker = new Int32Array(MAX_PROJECTILES);
  readonly target = new Int32Array(MAX_PROJECTILES);
  readonly owner = new Uint8Array(MAX_PROJECTILES);
  readonly faction = new Uint8Array(MAX_PROJECTILES);

  /* -- allocator ---------------------------------------------------------- */
  private readonly freeList = new Int32Array(MAX_PROJECTILES);
  private freeCount = 0;
  /** Dense list of live slots, for an O(live) tick instead of O(capacity). */
  private readonly liveList = new Int32Array(MAX_PROJECTILES);
  private readonly livePos = new Int32Array(MAX_PROJECTILES);
  private liveCountInternal = 0;

  /** Diagnostics. */
  spawnFailures = 0;
  shotsFired = 0;
  hits = 0;

  /** Query scratch for the swept test. Owned; the world's is not re-entrant. */
  private readonly scratch = new Int32Array(MAX_QUERY_RESULTS);

  constructor(
    private readonly world: World,
    private readonly channels: Channels,
  ) {
    for (let i = 0; i < MAX_PROJECTILES; i++) this.freeList[i] = MAX_PROJECTILES - 1 - i;
    this.freeCount = MAX_PROJECTILES;
  }

  get liveCount(): number { return this.liveCountInternal; }

  /* ======================================================================
   * SPAWNING
   * ====================================================================== */

  /**
   * Launch one projectile. `dirX/dirY/dirZ` must be unit length; the caller
   * already computed it to aim the turret, so normalizing again here would be
   * wasted work in the hottest path in the game.
   *
   * Returns the slot, or -1 when the pool is exhausted (counted, never grown).
   */
  spawn(
    pkind: ProjectileKind,
    warhead: WarheadClass,
    damage: number,
    splashRadius: number, splashFalloff: number,
    ox: number, oy: number, oz: number,
    dirX: number, dirY: number, dirZ: number,
    speed: number,
    attacker: EntityId, target: EntityId,
    owner: PlayerId, faction: Faction,
    impactFx: FxKind, travelFx: FxKind,
    turnRateRad: number,
    airMul = 1,
  ): number {
    if (this.freeCount === 0) { this.spawnFailures++; return -1; }
    const i = this.freeList[--this.freeCount];

    let flags = PFlag.Live;
    switch (pkind) {
      case ProjectileKind.Shell:
      case ProjectileKind.Bomb:
        flags |= PFlag.Ballistic | PFlag.BurstOnExpiry;
        break;
      case ProjectileKind.Rocket:
        flags |= PFlag.Homing | PFlag.BurstOnExpiry;
        break;
      case ProjectileKind.Flame:
        flags |= PFlag.BurstOnExpiry | PFlag.Armed;
        break;
      default:
        flags |= PFlag.Armed;
        break;
    }

    this.kind[i] = pkind;
    this.pflags[i] = flags;
    this.x[i] = ox; this.y[i] = oy; this.z[i] = oz;
    this.px[i] = ox; this.py[i] = oy; this.pz[i] = oz;
    this.vx[i] = dirX * speed; this.vy[i] = dirY * speed; this.vz[i] = dirZ * speed;
    this.speed[i] = speed;
    this.turnRate[i] = turnRateRad;
    this.life[i] = pkind === ProjectileKind.Flame
      ? COMBAT_PROJECTILES.flameLifeSeconds
      : COMBAT_PROJECTILES.maxLifeSeconds;
    this.travelled[i] = 0;
    this.nextBead[i] = COMBAT_PROJECTILES.trailBeadMetres;

    this.damage[i] = damage;
    this.warhead[i] = warhead;
    this.splashRadius[i] = splashRadius;
    this.splashFalloff[i] = splashFalloff;
    this.airMul[i] = airMul;
    this.impactFx[i] = impactFx;
    // A tracer describes the round itself, not a smoke trail. The old path
    // stored it here and `bead()` emitted another independent tracer every
    // 2.4 metres, so a single tank shell became a moving bundle of roughly ten
    // luminous lines. Emit it once at launch and keep only genuinely repeating
    // trail effects in the projectile slot.
    const isTracer = travelFx === FxKind.TracerBullet || travelFx === FxKind.TracerCannon;
    this.travelFx[i] = isTracer ? FxKind.None : travelFx;

    this.attacker[i] = attacker as number;
    this.target[i] = target as number;
    this.owner[i] = owner as number;
    this.faction[i] = faction;

    if (isTracer) {
      this.channels.fx.push(
        travelFx, ox, oy, oz, dirX, dirY, dirZ, 1, attacker, faction,
      );
    }

    this.livePos[i] = this.liveCountInternal;
    this.liveList[this.liveCountInternal++] = i;
    this.shotsFired++;
    return i;
  }

  /** Return a slot to the pool. Swap-and-pop out of the dense live list. */
  private free(i: number): void {
    if ((this.pflags[i] & PFlag.Live) === 0) return;
    this.pflags[i] = 0;
    const last = this.liveCountInternal - 1;
    const p = this.livePos[i];
    const moved = this.liveList[last];
    this.liveList[p] = moved;
    this.livePos[moved] = p;
    this.liveCountInternal = last;
    this.freeList[this.freeCount++] = i;
  }

  /* ======================================================================
   * INTEGRATION — Phase.Projectiles (1100)
   *
   * Runs AFTER SpatialRebuild, so every query in here sees this tick's
   * positions and a shell can never hit where a tank used to be.
   * ====================================================================== */

  tick(s: SimContext): void {
    const dt = s.dt;
    const g = COMBAT_PROJECTILES.gravity;
    const terrain = this.world.terrain;

    // Iterate backwards: `free()` swaps the tail into the current slot, so a
    // forward loop would skip whatever moved down into the hole.
    for (let a = this.liveCountInternal - 1; a >= 0; a--) {
      const i = this.liveList[a];
      const flags = this.pflags[i];

      this.px[i] = this.x[i]; this.py[i] = this.y[i]; this.pz[i] = this.z[i];

      if ((flags & PFlag.Homing) !== 0) this.steer(i, dt);
      if ((flags & PFlag.Ballistic) !== 0) this.vy[i] -= g * dt;

      const nx = this.x[i] + this.vx[i] * dt;
      const ny = this.y[i] + this.vy[i] * dt;
      const nz = this.z[i] + this.vz[i] * dt;
      this.x[i] = nx; this.y[i] = ny; this.z[i] = nz;

      const dx = nx - this.px[i], dy = ny - this.py[i], dz = nz - this.pz[i];
      const step = Math.sqrt(dx * dx + dy * dy + dz * dz);
      this.travelled[i] += step;
      if ((flags & PFlag.Armed) === 0 &&
          this.travelled[i] >= COMBAT_PROJECTILES.rocketArmMetres) {
        this.pflags[i] |= PFlag.Armed;
      }

      // --- entity collision (swept) -------------------------------------
      const victim = this.sweep(i);
      if (victim >= 0) { this.detonate(i, victim); continue; }

      // --- world collision ----------------------------------------------
      if (nx < 0 || nz < 0 || nx > MAP_SIZE || nz > MAP_SIZE) { this.free(i); continue; }
      const ground = terrain.heightAt(nx, nz);
      if (ny <= ground + COMBAT_PROJECTILES.groundBias) {
        this.y[i] = ground;
        this.groundBurst(i, ground <= WATER_LEVEL);
        continue;
      }

      // --- life ----------------------------------------------------------
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        if ((this.pflags[i] & PFlag.BurstOnExpiry) !== 0) this.detonate(i, -1);
        else this.free(i);
        continue;
      }

      this.bead(i, dx, dy, dz, step);
    }
  }

  /**
   * Rotate the velocity toward the target by at most `turnRate * dt`.
   * A normalized lerp rather than a true slerp: the two agree to well under a
   * degree for the small per-tick angles a missile actually turns, and this
   * costs one sqrt instead of two trig calls per missile per tick.
   */
  private steer(i: number, dt: number): void {
    if ((this.pflags[i] & PFlag.Armed) === 0) return;
    const st = this.world.store;
    const t = st.index(this.target[i] as EntityId);
    // A missile whose target died keeps flying straight and bursts on the
    // ground. That is both correct and the right LOOK — an unguided miss.
    if (t < 0) return;

    const h = estimatedHeight(st.footprintW[t], st.radius[t], st.kind[t] as EntityKind);
    let dx = st.posX[t] - this.x[i];
    let dy = (st.posY[t] + h * 0.5) - this.y[i];
    let dz = st.posZ[t] - this.z[i];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 1e-4) return;
    dx /= d; dy /= d; dz /= d;

    const sp = this.speed[i];
    const inv = sp > 1e-4 ? 1 / sp : 0;
    let cx = this.vx[i] * inv, cy = this.vy[i] * inv, cz = this.vz[i] * inv;

    const dot = cx * dx + cy * dy + cz * dz;
    const ang = Math.acos(dot < -1 ? -1 : dot > 1 ? 1 : dot);
    const maxAng = this.turnRate[i] * dt;
    if (ang <= maxAng || ang < 1e-5) {
      cx = dx; cy = dy; cz = dz;
    } else {
      const k = maxAng / ang;
      cx += (dx - cx) * k; cy += (dy - cy) * k; cz += (dz - cz) * k;
      const l = Math.sqrt(cx * cx + cy * cy + cz * cz);
      if (l > 1e-6) { cx /= l; cy /= l; cz /= l; }
    }
    this.vx[i] = cx * sp; this.vy[i] = cy * sp; this.vz[i] = cz * sp;
  }

  /**
   * Swept segment vs every plausible hull. Returns the slot index of the first
   * thing hit along the segment, or -1.
   *
   * Allies are transparent to friendly fire in FLIGHT (you cannot shoot your
   * own tank in the back), but they are NOT transparent to the splash that
   * follows — that asymmetry is exactly how C&C has always played.
   */
  private sweep(i: number): number {
    const w = this.world;
    const st = w.store;
    const ax = this.px[i], az = this.pz[i];
    const bx = this.x[i], bz = this.z[i];
    const mx = (ax + bx) * 0.5, mz = (az + bz) * 0.5;
    const halfLen = Math.sqrt((bx - ax) * (bx - ax) + (bz - az) * (bz - az)) * 0.5;

    const out = this.scratch;
    const n = w.spatial.queryCircleFat(mx, mz, halfLen + 0.5, out);
    const shooter = st.index(this.attacker[i] as EntityId);
    const ownerPlayer = this.owner[i] as PlayerId;

    let best = -1;
    let bestT = 2;
    for (let c = 0; c < n; c++) {
      const j = out[c];
      if (j === shooter) continue;
      const f = st.flags[j];
      if ((f & EntityFlag.Alive) === 0) continue;
      if ((f & (EntityFlag.PendingDestroy | EntityFlag.Cloaked | EntityFlag.Garrisoned |
                EntityFlag.NotATarget)) !== 0) continue;
      if (w.areAllied(ownerPlayer, st.owner[j] as PlayerId)) continue;

      const r = hitRadius(st.footprintW[j], st.footprintH[j], st.radius[j])
        + COMBAT_PROJECTILES.hitRadiusPad;
      const t = segCircleHit(ax, az, bx, bz, st.posX[j], st.posZ[j], r);
      if (t < 0 || t >= bestT) continue;

      // Vertical gate: a shell arcing over a pillbox must NOT clip it.
      //
      // Sampled as a SPAN, not as a point, and that distinction is the whole
      // difference between anti-air working and anti-air being decoration.
      // `t` is where the segment ENTERS the hull's XZ disc, and for a steeply
      // climbing shot that point is systematically BELOW the hull: a flak
      // burst at a gunship 22 m up from 16 m away crosses the disc edge four
      // metres under it and only reaches the target's altitude at the centre,
      // where it was aimed. Testing the entry alone therefore rejected every
      // close-range anti-air shot in the game and made an aircraft safest
      // directly over the battery — precisely backwards, and invisible,
      // because the tracers all looked right.
      //
      // The span runs from the entry to the point of CLOSEST APPROACH, which
      // is where the muzzle was pointed, and a hit needs only an overlap. It
      // is a strict widening of the old test (the old sample is inside the
      // span), so nothing that used to hit can stop hitting; and it does not
      // weaken the case it exists for, because a shell that clears a pillbox
      // is above it at closest approach too.
      const dyStep = this.y[i] - this.py[i];
      const tc = closestPointOnSegment(st.posX[j], st.posZ[j], ax, az, bx, bz, SWEEP_NEAR);
      const hyA = this.py[i] + dyStep * t;
      const hyB = this.py[i] + dyStep * (tc > t ? tc : t);
      const hyLo = hyA < hyB ? hyA : hyB;
      const hyHi = hyA < hyB ? hyB : hyA;
      const base = st.posY[j];
      const top = base + estimatedHeight(st.footprintW[j], st.radius[j], st.kind[j] as EntityKind);
      if (hyHi < base - 1.0 || hyLo > top + 0.6) continue;

      bestT = t; best = j;
    }
    if (best >= 0) {
      // Snap to the impact point so the explosion happens on the hull, not on
      // the far side of it.
      this.x[i] = ax + (bx - ax) * bestT;
      this.z[i] = az + (bz - az) * bestT;
      this.y[i] = this.py[i] + (this.y[i] - this.py[i]) * bestT;
    }
    return best;
  }

  /** Resolve a hit on `victimIdx` (or a pure splash detonation when -1). */
  private detonate(i: number, victimIdx: number): void {
    const st = this.world.store;
    const hx = this.x[i], hy = this.y[i], hz = this.z[i];
    const splash = this.splashRadius[i];
    const target = victimIdx >= 0 ? st.handleOf(victimIdx) : NONE;

    if (splash > 0) {
      // Splash is resolved from the impact POINT, so the direct victim eats the
      // full amount (falloff 1 at distance 0) and everything nearby scales down.
      this.channels.damage.push(
        NONE, this.attacker[i] as EntityId, this.damage[i], this.warhead[i] as WarheadClass,
        hx, hy, hz, splash, this.splashFalloff[i], this.airMul[i],
      );
    } else if (target !== NONE) {
      this.channels.damage.push(
        target, this.attacker[i] as EntityId, this.damage[i], this.warhead[i] as WarheadClass,
        hx, hy, hz, 0, 0, this.airMul[i],
      );
    }

    this.channels.fx.push(
      this.impactFx[i] as FxKind, hx, hy, hz,
      -this.vx[i], -this.vy[i], -this.vz[i],
      splash > 0 ? Math.max(1, splash * 0.5) : 1,
      NONE, this.faction[i] as Faction,
    );
    if (splash >= 2.5) {
      this.world.audio.play(FxKind.ExplosionSmall, hx, hz, 0.8);
    }
    this.hits++;
    this.free(i);
  }

  /** Impact on the heightfield (or the water surface). */
  private groundBurst(i: number, water: boolean): void {
    const splash = this.splashRadius[i];
    const hx = this.x[i], hy = this.y[i], hz = this.z[i];
    if (splash > 0) {
      this.channels.damage.push(
        NONE, this.attacker[i] as EntityId, this.damage[i], this.warhead[i] as WarheadClass,
        hx, hy, hz, splash, this.splashFalloff[i], this.airMul[i],
      );
      this.channels.fx.push(
        this.impactFx[i] as FxKind, hx, hy, hz, 0, 1, 0,
        Math.max(1, splash * 0.5), NONE, this.faction[i] as Faction,
      );
      this.world.audio.play(FxKind.ExplosionSmall, hx, hz, 0.7);
    } else {
      // A rifle round in the dirt: a puff, no damage, no crater.
      this.channels.fx.push(
        water ? FxKind.ImpactWater : FxKind.ImpactDirt, hx, hy, hz,
        -this.vx[i], -this.vy[i], -this.vz[i], 0.7, NONE, this.faction[i] as Faction,
      );
    }
    this.free(i);
  }

  /**
   * Trail beads. Bible 8.6 is explicit: trails are DISCRETE PUFFS every
   * ~16-20 screen px of travel, never a continuous ribbon — "a scanline along
   * any trail must show >= 6 luminance oscillations". Emitting one FX record
   * per `trailBeadMetres` is how the sim expresses that without knowing
   * anything about particles.
   */
  private bead(i: number, dx: number, dy: number, dz: number, step: number): void {
    const fx = this.travelFx[i];
    if (fx === FxKind.None) return;
    this.nextBead[i] -= step;
    if (this.nextBead[i] > 0) return;
    this.nextBead[i] += COMBAT_PROJECTILES.trailBeadMetres;
    this.channels.fx.push(
      fx as FxKind, this.x[i], this.y[i], this.z[i],
      dx, dy, dz, 1,
      this.attacker[i] as EntityId, this.faction[i] as Faction,
    );
  }

  /* ======================================================================
   * READ ACCESS (for a VFX module that wants to draw the shells themselves)
   * ====================================================================== */

  /**
   * Copy the live projectiles into a caller-supplied Float32Array as
   * `[x, y, z, vx, vy, vz, kind, faction]` octets. Returns the count written.
   * Caller-supplied output, no allocation — this is the render seam.
   */
  readLive(out: Float32Array): number {
    const stride = 8;
    const max = (out.length / stride) | 0;
    const n = Math.min(max, this.liveCountInternal);
    for (let a = 0; a < n; a++) {
      const i = this.liveList[a];
      const o = a * stride;
      out[o] = this.x[i]; out[o + 1] = this.y[i]; out[o + 2] = this.z[i];
      out[o + 3] = this.vx[i]; out[o + 4] = this.vy[i]; out[o + 5] = this.vz[i];
      out[o + 6] = this.kind[i]; out[o + 7] = this.faction[i];
    }
    return n;
  }

  /** Slot index of the `n`-th live projectile, for direct column access. */
  liveSlot(n: number): ProjectileId {
    return this.liveList[n] as ProjectileId;
  }

  /** Drop everything in flight. Between matches, or on a scenario rebuild. */
  clear(): void {
    for (let a = this.liveCountInternal - 1; a >= 0; a--) this.free(this.liveList[a]);
    this.spawnFailures = 0;
    this.shotsFired = 0;
    this.hits = 0;
  }
}

/**
 * Scratch for the sweep's closest-approach probe. Module level and reused so
 * the hot collision loop stays allocation-free; `closestPointOnSegment` is
 * synchronous and the value is consumed on the next line, so there is nothing
 * to hold across a call.
 */
const SWEEP_NEAR = new Float32Array(2);

/** Default homing authority in radians/second. */
export const ROCKET_TURN_RATE = COMBAT_PROJECTILES.rocketTurnRateDeg * DEG2RAD;

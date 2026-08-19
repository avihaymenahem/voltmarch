/**
 * ============================================================================
 * tests/aircraft-killer-probe.spec.ts — WHAT ACTUALLY KILLS AN AIRCRAFT?
 * ============================================================================
 * THE REPORT: *"3 airplanes destroyed by 1 tank in a second... something is
 * weird"*.
 *
 * One fix has already shipped for it (`Damage.applySplash` gained a vertical
 * term, v-current, `src/sim/Damage.ts:294`), and shipping a fix is not the same
 * as knowing it was the cause. THIS FILE IS THE DISCRIMINATOR. It answers four
 * questions the fix did not:
 *
 *   §1  How far did a ground blast reach an aircraft BEFORE the fix, and how
 *       far does it reach now? Both computed from the SAME two formulas the
 *       two versions of `applySplash` use, so the "before" column is a real
 *       measurement of the shipped defect rather than a memory of it.
 *
 *   §2  Per aircraft death in a real engagement: WHO killed it and by WHICH
 *       PATH — `applySplash` or the direct `applyOne`. This is the question the
 *       task was written for, and nothing in the game recorded it, so the two
 *       private methods are wrapped on the instance and every `hp` write is
 *       attributed. `DamageSystem.applyOne` is the ONLY function in the game
 *       that writes `hp` (its own header says so), which is what makes a wrap
 *       there complete rather than a sample.
 *
 *   §3  Is the AA Battery turret hot? CLAUDE.md's aerial block flags it at
 *       "187-261% of an aircraft's health on ONE 26 m pass" and says in terms
 *       that it must be re-measured. Measured here, in the simulation, not on
 *       paper.
 *
 *   §4  The anti-hang floor. CLAUDE.md: from every reachable tech state every
 *       army must be able to produce something whose weapon carries
 *       `canTargetAir`, ungated. The splash fix's own defence is that "a weapon
 *       that can elevate aims AT the aircraft, so the vertical gap is ~0 and
 *       nothing changed for it" — VERIFIED here rather than assumed, by reading
 *       the `y` of the damage record a real AA burst actually pushes.
 *
 * WHY IT IS ALL ALWAYS ON, AND WHY THERE IS NO 20-MINUTE MATCH IN HERE. Every
 * measurement is a fact about the SHIPPED TABLES and a rig with a fixed seed —
 * no terrain, no AI, no economy, no pathing — and the whole file runs in about
 * two seconds. A natural-distribution run was considered and rejected: aircraft
 * sit behind `warFactory` + `radar`, so a 20-minute AI match produces a handful
 * of airframes at best and the answer would be a fact about one seed. §6 stages
 * the engagement against a real Allied position instead and says what that does
 * not cover.
 *
 * THE TRAP FROM THIS WEEK, PAID EVERYWHERE. "Check a metric CAN move before
 * citing it." §1 computes the PRE-fix reach with the pre-fix formula and
 * asserts it non-zero for every ground splash row, so the post-fix zero is a
 * change rather than a constant. §3b re-runs the identical tank engagement with
 * the flight at 5 m, where the same shells DO reach it. §3's two path counters
 * are each asserted to have moved somewhere in the case table. And the stack
 * sweep's first metric — total splash damage — was thrown away for exactly this
 * reason: it came back 564 / 566 / 566, a number pinned by the targets' health
 * rather than by the blast.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';

import { World } from '../src/core/world';
import { Channels } from '../src/core/events';
import { Rng } from '../src/core/math';
import {
  ARMOR_MATRIX, AIR_CRUISE_ALTITUDE, COMBAT_DAMAGE, SIM_DT,
} from '../src/core/config';
import {
  ArmorClass, EntityFlag, EntityKind, Faction, Locomotor, NONE, Stance, UnitState,
  WarheadClass,
} from '../src/core/types';
import type {
  EntityId, EvEntityKilled, PlayerId, SimContext, WeaponDef,
} from '../src/core/types';

import {
  DamageSystem, estimatedHeight, hitRadius, setArmorMatrix,
} from '../src/sim/Damage';
import { ProjectileSystem } from '../src/sim/Projectiles';
import { WeaponSystem, setContentWeaponMap, setWeaponKeyResolver, setWeaponTable } from '../src/sim/Combat';
import { TargetingSystem } from '../src/sim/Targeting';
import { createCatalog, ProductionService, setProduction } from '../src/sim/Production';
import type { BuildEntry } from '../src/sim/Production';
import { WEAPONS, UNITS } from '../src/data/Defs';

const P0 = 0 as PlayerId;
const P1 = 1 as PlayerId;

/* ==========================================================================
 * §0. THE AIRCRAFT, OFF THE SHIPPED TABLE
 *
 * Four, one per army, and `tests/air-layer.spec.ts` pins that there are exactly
 * four. Their hp and radius are what every seconds-to-kill number below is
 * divided by, so they are read rather than quoted.
 * ========================================================================== */

const AIRCRAFT_KEYS = ['vindicator', 'mig', 'mrdKestrel', 'rclHornet'] as const;

interface Airframe {
  readonly key: string;
  readonly maxHp: number;
  readonly radius: number;
  /** The height `estimatedHeight` derives for it — the term that makes the fix. */
  readonly height: number;
}

const AIRFRAMES: readonly Airframe[] = AIRCRAFT_KEYS.map((key) => {
  const u = UNITS.find((d) => d.key === key);
  if (u === undefined) throw new Error(`no aircraft def '${key}'`);
  return {
    key,
    maxHp: u.maxHp,
    radius: u.radius,
    height: estimatedHeight(0, u.radius, u.kind),
  };
});

/* ==========================================================================
 * §1. HOW FAR A GROUND BLAST REACHES, BEFORE AND AFTER
 *
 * Both functions are the acceptance test out of `applySplash`, transcribed. The
 * ONLY difference between them is the two lines the fix added, which is what
 * makes the pair a measurement of the defect rather than an illustration of it.
 *
 *   pre:   surface = sqrt(dx*dx + dz*dz)              - hitRadius(victim)
 *   post:  gap  = |dy| - estimatedHeight(victim) * 0.5
 *          plan = dx*dx + dz*dz + (gap > 0 ? gap*gap : 0)
 *          surface = sqrt(plan)                       - hitRadius(victim)
 *
 * and in both, a victim is damaged iff `surface < splashRadius`.
 * ========================================================================== */

/** Largest horizontal offset at which the PRE-fix formula damaged `a`. */
function reachPre(splashRadius: number, a: Airframe): number {
  // surface = dxz - r < R  =>  dxz < R + r. Altitude was not read at all.
  return splashRadius <= 0 ? 0 : splashRadius + hitRadius(0, 0, a.radius);
}

/** Largest horizontal offset at which the SHIPPED formula damages `a`. */
function reachPost(splashRadius: number, a: Airframe, dy: number): number {
  if (splashRadius <= 0) return 0;
  const r = hitRadius(0, 0, a.radius);
  const gap = Math.abs(dy) - a.height * 0.5;
  const g2 = gap > 0 ? gap * gap : 0;
  // sqrt(dxz^2 + g2) - r < R  =>  dxz^2 < (R + r)^2 - g2
  const lim = (splashRadius + r) * (splashRadius + r) - g2;
  return lim <= 0 ? 0 : Math.sqrt(lim);
}

/** The cycle/dps convention `Defs.ts` and CLAUDE.md's aerial sweep both use. */
function cycleOf(w: WeaponDef): number {
  return w.burstCount > 1 ? (w.burstCount - 1) * w.burstDelay + w.cooldown : w.cooldown;
}
function rawDps(w: WeaponDef): number {
  return (w.burstCount * w.damage) / cycleOf(w);
}
function vsAirDps(w: WeaponDef): number {
  return rawDps(w) * ARMOR_MATRIX[w.warhead as number][ArmorClass.Light as number]
    * COMBAT_DAMAGE.globalMul;
}

/** Every splash-carrying row that CANNOT elevate. These are the tank cannons. */
const GROUND_SPLASH = WEAPONS.filter((w) => w.splashRadius > 0 && !w.canTargetAir);
/** Every splash-carrying row that CAN. These aim at the aircraft. */
const AIR_SPLASH = WEAPONS.filter((w) => w.splashRadius > 0 && w.canTargetAir);

describe('§1 a ground blast and an aircraft 22 m over it', () => {
  it('reached every aircraft in the game before the fix, and reaches none now', () => {
    const rows: Record<string, unknown>[] = [];
    let anyPre = 0;
    let anyPost = 0;
    for (const w of GROUND_SPLASH) {
      for (const a of AIRFRAMES) {
        const pre = reachPre(w.splashRadius, a);
        const post = reachPost(w.splashRadius, a, AIR_CRUISE_ALTITUDE);
        if (pre > 0) anyPre++;
        if (post > 0) anyPost++;
        rows.push({
          weapon: w.key, splashR: w.splashRadius, aircraft: a.key,
          hullR: +hitRadius(0, 0, a.radius).toFixed(2),
          estHeight: +a.height.toFixed(2),
          reachPre_m: +pre.toFixed(2),
          reachPost_m: +post.toFixed(2),
          // What ONE shell took off that airframe at dead centre, pre-fix.
          shotPctPre: +(
            (w.damage * ARMOR_MATRIX[w.warhead as number][ArmorClass.Light as number]
              * COMBAT_DAMAGE.globalMul) / a.maxHp * 100
          ).toFixed(1),
        });
      }
    }
    console.log(`[airkill §1] ground splash vs cruise altitude ${AIR_CRUISE_ALTITUDE} m\n${
      rows.map((r) => JSON.stringify(r)).join('\n')}`);

    // THE METRIC CAN MOVE. Every one of these pairs was non-zero before and is
    // zero now; if the first assertion ever fails, the "before" column has
    // stopped describing the defect and every number above it is decoration.
    expect(anyPre, 'no ground splash row reached an aircraft even PRE-fix').toBe(rows.length);
    expect(anyPost, 'a ground blast still reaches an aircraft at cruise altitude').toBe(0);
  });

  it('leaves the elevating splash rows able to reach an aircraft they aim at', () => {
    // The other half of the same arithmetic, and the anti-hang floor's
    // mechanism: a weapon that elevates puts its blast AT the target, dy = 0,
    // and the vertical term contributes nothing.
    expect(AIR_SPLASH.length, 'no elevating splash row at all').toBeGreaterThan(0);
    for (const w of AIR_SPLASH) {
      for (const a of AIRFRAMES) {
        expect(
          reachPost(w.splashRadius, a, 0),
          `${w.key} lost its reach against ${a.key} at its own altitude`,
        ).toBeCloseTo(reachPre(w.splashRadius, a), 6);
      }
    }
  });

  it('names the altitude band a ground blast can still touch, because it is not zero', () => {
    /*
     * NOT A HOLE — A MEASUREMENT NOBODY HAD. The fix is a distance, so it has a
     * threshold rather than a switch, and `Movement` puts an aircraft's
     * altitude on an exponential approach to `ground + AIR_CRUISE_ALTITUDE`
     * (src/sim/Movement.ts:400). An aircraft crossing onto a mesa is therefore
     * genuinely lower over the new ground for a fraction of a second. This is
     * the altitude below which the biggest tank cannon in the game still
     * splashes it — quote this number, not "aircraft are immune".
     */
    const rows = AIRFRAMES.map((a) => {
      let worst = 0;
      let by = '';
      for (const w of GROUND_SPLASH) {
        // Solve reachPost(dy) > 0 at dxz = 0: |dy| < R + r + height/2.
        const dy = w.splashRadius + hitRadius(0, 0, a.radius) + a.height * 0.5;
        if (dy > worst) { worst = dy; by = w.key; }
      }
      return { aircraft: a.key, safeAboveGroundBlast_m: +worst.toFixed(2), worstWeapon: by };
    });
    console.log(`[airkill §1] ground-blast ceiling (cruise is ${AIR_CRUISE_ALTITUDE} m)\n${
      rows.map((r) => JSON.stringify(r)).join('\n')}`);
    for (const r of rows) {
      // Under cruise, which is what makes the fix hold in level flight, and
      // above zero, which is what makes it a threshold rather than a switch.
      expect(r.safeAboveGroundBlast_m).toBeLessThan(AIR_CRUISE_ALTITUDE);
      expect(r.safeAboveGroundBlast_m).toBeGreaterThan(0);
    }
  });
});

/* ==========================================================================
 * §2. THE RIG — REAL DEFS, REAL TARGETING, REAL PROJECTILES, REAL DAMAGE
 *
 * `makeCombatRig` in `tests/air-layer.spec.ts` hand-fills columns with synthetic
 * numbers, which is right for the invariants it pins and wrong for a question
 * about BALANCE: "how long does an Anvil take" cannot be answered by a hull with
 * a made-up 600 hp. This one spawns through `ProductionService.spawnUnit` and
 * `spawnBuilding` off the shipped catalog with `bindingTables` and
 * `setWeaponTable` both bound, so every hp, radius, armour class and weapon row
 * is the one that ships.
 *
 * `bindingTables` IS THE TRAP AND IT IS SILENT. `spawnUnit` reads
 * `st.weaponIndex[i] = def !== undefined ? def.weapons[0] : -1`, so a rig that
 * forgets it spawns an entire army that cannot shoot, and every timing measured
 * on it is a measurement of that. `assertArmed()` below refuses to run a case
 * whose shooter came out with `weaponIndex < 0`.
 * ========================================================================== */

/**
 * TURN THE HULL AT THE TARGET — THE ONE THING THIS RIG STANDS IN FOR.
 *
 * `canTraverse` is `HasTurret || kind === Building`, so a rifleman's gun is
 * welded to his chest and `Combat.engage` refuses the shot outside `HULL_ARC`
 * (14 degrees, `COMBAT_WEAPONS.hullArcDeg`). In a match `Steering` writes
 * `desiredYaw` and `Movement` turns the hull; neither system is in this rig,
 * because both need terrain and a flow field and neither can affect a damage
 * number.
 *
 * WITHOUT THIS LINE THE WHOLE FILE MEASURES NOTHING. The first run of it read
 * `shots 0 / slewing 2` across all twelve cases and every seconds-to-kill came
 * back -1 — eight riflemen standing under an aircraft with their backs to it,
 * forever. That is a fact about the rig, not about the gun, and it is exactly
 * the shape of failure the task warned about: a metric that cannot move.
 */
function faceTargets(st: World['store']): void {
  const n = st.aliveCount;
  for (let a = 0; a < n; a++) {
    const i = st.alive[a];
    if ((st.flags[i] & EntityFlag.CanAttack) === 0) continue;
    if ((st.flags[i] & EntityFlag.HasTurret) !== 0) continue;
    if (st.kind[i] === EntityKind.Building) continue;
    const t = st.index(st.targetId[i] as EntityId);
    if (t < 0) continue;
    st.yaw[i] = Math.atan2(st.posX[t] - st.posX[i], st.posZ[t] - st.posZ[i]);
  }
}

type Path = 'splash' | 'direct';

interface Hit {
  readonly victim: number;
  readonly attacker: number;
  readonly path: Path;
  readonly dealt: number;
  readonly killed: boolean;
  readonly tick: number;
}

/** One `applySplash` invocation: where it went off, and who it touched. */
interface SplashEvent {
  readonly x: number; readonly y: number; readonly z: number;
  readonly radius: number;
  readonly tick: number;
  /** Entity handles this one blast actually took hp off. */
  readonly victims: number[];
}

interface Rig {
  world: World;
  channels: Channels;
  production: ProductionService;
  damage: DamageSystem;
  /** Every `hp` write this rig has resolved, in order. */
  hits: Hit[];
  /** Every splash blast, with its own victim list. */
  splashes: SplashEvent[];
  /** `entity:killed` in order, with the path of the killing blow. */
  deaths: { victimKey: string; killerKey: string; path: Path; tick: number }[];
  tick: number;
  step(n: number): void;
  spawn(player: PlayerId, key: string, x: number, z: number): EntityId;
  spawnAir(player: PlayerId, key: string, x: number, z: number, y?: number): EntityId;
  spawnStruct(player: PlayerId, key: string, cx: number, cz: number): EntityId;
  keyOf(id: EntityId): string;
  dispose(): void;
}

async function makeRig(seed = 7): Promise<Rig> {
  setArmorMatrix(ARMOR_MATRIX);
  setContentWeaponMap({});
  setWeaponKeyResolver(null);

  const world = new World();
  const channels = new Channels();
  world.addPlayer(Faction.Allies, 'A', true, true);
  world.addPlayer(Faction.Soviets, 'B', false, false);

  const { catalog, binding } = await createCatalog();
  const production = new ProductionService(world, channels, catalog);
  setProduction(production);
  expect(binding.tables, 'def binding failed — every number would be fallback data')
    .not.toBeNull();
  production.bindingTables = binding.tables;
  expect(setWeaponTable(binding.tables!.weapons), 'the content armoury was refused').toBe(true);

  const projectiles = new ProjectileSystem(world, channels);
  const damage = new DamageSystem(world, channels);
  const weapons = new WeaponSystem(world, channels, projectiles);
  const targeting = new TargetingSystem(world, channels, weapons);
  const rng = new Rng(seed);

  const st = world.store;
  const hits: Hit[] = [];
  const deaths: { victimKey: string; killerKey: string; path: Path; tick: number }[] = [];
  let tick = 0;

  /*
   * THE DISCRIMINATOR ITSELF.
   *
   * `applySplash` and `applyOne` are `private`, which is a compile-time word
   * and not a runtime one; assigning to the INSTANCE shadows the prototype
   * method, and every internal call site goes through `this.`, including
   * `applySplash`'s own call to `applyOne`. So one flag around the outer call
   * attributes every write the inner one makes.
   *
   * Nothing in the game records this. `entity:killed` carries the killer and
   * not the route, and `DamageStats` counts applications and kills in bulk.
   */
  /*
   * EVERY PARAMETER MUST BE FORWARDED, AND A DROPPED ONE IS INVISIBLE.
   *
   * These wrappers are POSITIONAL re-declarations of two private methods, so a
   * parameter added to either one is silently discarded here and the real
   * method reads its default instead. That is not hypothetical: when
   * `WeaponDef.airMultiplier` landed, the first run of this file reported the
   * whole §3 table UNCHANGED — one G.I. still killing an Interceptor in 8.47 s
   * for exactly 190 damage — because `applyOne`'s new 7th argument stopped at
   * this line. Thirteen green tests measuring the behaviour the change had just
   * removed. `airMul` is threaded through explicitly below for that reason; the
   * next parameter has to be too.
   */
  const dyn = damage as unknown as {
    applySplash: (...a: unknown[]) => void;
    applyOne: (s: SimContext, i: number, attacker: EntityId, amount: number,
      warhead: WarheadClass, intensity: number, airMul?: number) => void;
  };
  const realSplash = dyn.applySplash.bind(damage);
  const realOne = dyn.applyOne.bind(damage);
  const splashes: SplashEvent[] = [];
  let current: SplashEvent | null = null;
  dyn.applySplash = (...a: unknown[]): void => {
    // (s, x, y, z, radius, rimFalloff, amount, warhead, attacker)
    const ev: SplashEvent = {
      x: a[1] as number, y: a[2] as number, z: a[3] as number,
      radius: a[4] as number, tick, victims: [],
    };
    current = ev;
    try { realSplash(...a); } finally { current = null; }
    splashes.push(ev);
  };
  dyn.applyOne = (
    s: SimContext, i: number, attacker: EntityId, amount: number,
    warhead: WarheadClass, intensity: number, airMul?: number,
  ): void => {
    const before = st.hp[i];
    const victim = st.handleOf(i) as number;
    const ev = current;
    const path: Path = ev !== null ? 'splash' : 'direct';
    realOne(s, i, attacker, amount, warhead, intensity, airMul);
    const after = st.hp[i];
    if (after === before) return;              // refused (matrix 0, construction, dead)
    if (ev !== null) ev.victims.push(victim);
    hits.push({
      victim, attacker: attacker as number, path,
      dealt: before - after, killed: after <= 0 && before > 0, tick,
    });
  };

  /*
   * `(none)` IS A REAL ROW, NOT A LOOKUP FAILURE. `Damage.pushBurnDamage` queues
   * fire damage with `attacker = NONE`, so an airframe under `BURN_HP_THRESHOLD`
   * takes a trickle nobody owns. It showed up as 2.4 damage from `?` the first
   * time §6 ran and is worth naming rather than filtering.
   */
  const keyOf = (id: EntityId): string =>
    id === NONE ? '(burn/none)' : production.entryOf(id)?.key ?? '(gone)';

  channels.events.on('entity:killed', (e: EvEntityKilled) => {
    // The LAST write to this victim is the killing blow, and the wrapper above
    // ran before `kill()` did, so it is already in the list.
    let path: Path = 'direct';
    for (let k = hits.length - 1; k >= 0; k--) {
      if (hits[k].victim !== (e.id as number)) continue;
      path = hits[k].path;
      break;
    }
    deaths.push({
      victimKey: keyOf(e.id as EntityId),
      killerKey: keyOf(e.killer as EntityId),
      path, tick,
    });
  });

  const entry = (key: string): BuildEntry => {
    const e = catalog.byKey(key);
    if (e === null) throw new Error(`no catalog entry '${key}'`);
    return e;
  };

  const rig: Rig = {
    world, channels, production, damage, hits, splashes, deaths, tick: 0,
    step(n: number): void {
      for (let k = 0; k < n; k++) {
        tick++;
        rig.tick = tick;
        st.snapshotPrev();
        world.tick = tick;
        world.time = tick * SIM_DT;
        channels.setTick(tick);
        const s: SimContext = { dt: SIM_DT, tick, time: tick * SIM_DT, rng };
        world.spatial.rebuild();
        targeting.tick(s);
        faceTargets(st);
        weapons.tick(s);
        projectiles.tick(s);
        damage.damageTick(s);
        damage.cleanupTick(s);
        channels.fx.clear();
      }
    },
    spawn(player, key, x, z) {
      const id = production.spawnUnit(world.player(player), entry(key), x, z, 0);
      expect(id, `spawn '${key}' failed`).not.toBe(NONE);
      const i = st.index(id);
      st.state[i] = UnitState.Idle;
      st.stance[i] = Stance.Aggressive;
      st.flags[i] |= EntityFlag.ProvidesVision;
      return id;
    },
    spawnAir(player, key, x, z, y = AIR_CRUISE_ALTITUDE) {
      const id = rig.spawn(player, key, x, z);
      const i = st.index(id);
      // `Movement` is not in this rig: it is what lifts an aircraft, and it is
      // deliberately absent so the geometry is exactly what each case declares.
      expect(st.locomotor[i], `'${key}' is not an aircraft`).toBe(Locomotor.Air);
      st.posY[i] = y;
      /*
       * DISARMED, DELIBERATELY. The question is how fast the SHOOTER clears the
       * sky, and an armed aircraft shooting back turns every row into the
       * outcome of a duel — the shooter dies partway through and the
       * seconds-to-kill column starts measuring the aircraft's gun. One
       * direction at a time.
       */
      st.weaponIndex[i] = -1;
      st.flags[i] &= ~EntityFlag.CanAttack;
      return id;
    },
    spawnStruct(player, key, cx, cz) {
      const id = production.spawnBuilding(world.player(player), entry(key), cx, cz, 1, 0);
      expect(id, `spawn structure '${key}' failed`).not.toBe(NONE);
      const i = st.index(id);
      st.flags[i] &= ~EntityFlag.UnderConstruction;
      st.flags[i] |= EntityFlag.Powered | EntityFlag.ProvidesVision;
      st.stance[i] = Stance.Aggressive;
      return id;
    },
    keyOf,
    dispose(): void {
      setProduction(null);
      setWeaponTable(WEAPONS);
    },
  };
  return rig;
}

/** Refuse a case whose shooter cannot shoot — the `bindingTables` trap. */
function assertArmed(rig: Rig, ids: readonly EntityId[]): void {
  const st = rig.world.store;
  for (const id of ids) {
    const i = st.index(id);
    expect(i, 'shooter did not survive spawn').toBeGreaterThanOrEqual(0);
    expect(
      st.weaponIndex[i],
      `${rig.keyOf(id)} spawned with weaponIndex -1 — the rig is unarmed, see §2`,
    ).toBeGreaterThanOrEqual(0);
  }
}

/* ==========================================================================
 * §3. THE ENGAGEMENT — THREE AIRCRAFT OVER A SHOOTER
 *
 * Parked rather than flying on purpose. A moving target adds a hit rate to the
 * measurement and the question here is an upper bound on the shooter, not an
 * average over an approach. Every seconds-to-kill below is therefore a FLOOR.
 *
 * THE STANDOFF IS 14 m AND IT IS NOT A ROUND NUMBER PICKED FOR NEATNESS.
 * `COMBAT_WEAPONS.maxElevationDeg` is 62, and `Combat.engage` clamps the launch
 * pitch to it, so a projectile fired at an aircraft directly overhead leaves the
 * muzzle at 62 degrees and passes underneath it. The floor is
 * `AIR_CRUISE_ALTITUDE / tan(62 deg)` = 11.70 m of HORIZONTAL separation —
 * measured, and pinned in its own test below, because a probe that parks the
 * flight at dxz = 0 records every projectile weapon in the game as unable to
 * shoot down an aircraft and that is an artefact of the geometry rather than a
 * fact about the guns. 14 m clears it and is inside `rifle`'s 18 m range.
 * ========================================================================== */

/** Horizontal metres between shooter and flight. See the block above. */
const STANDOFF = 14;
/** `AIR_CRUISE_ALTITUDE / tan(maxElevationDeg)` — the overhead blind cone. */
const BLIND_CONE = AIR_CRUISE_ALTITUDE / Math.tan(62 * Math.PI / 180);

interface CaseResult {
  readonly shooter: string;
  readonly shooters: number;
  readonly cost: number;
  readonly aircraft: string;
  readonly killed: number;
  readonly secondsToFirst: number;
  readonly secondsToAll: number;
  readonly viaSplash: number;
  readonly viaDirect: number;
  readonly damageSplash: number;
  readonly damageDirect: number;
  /** Most aircraft ONE splash blast took hp off. 1 means splash bought nothing. */
  readonly maxAircraftPerBlast: number;
  /** Blasts that damaged two or more aircraft at once. */
  readonly multiBlasts: number;
  /** Splash blasts that went off within 8 m of the flight's ground point. */
  readonly blastsUnderFlight: number;
}

const AIR_LIMIT_TICKS = 30 * 30;   // 30 sim-seconds

/**
 * `bait: true` PUTS AN ENEMY TANK ON THE GROUND UNDER THE FLIGHT, AND WITHOUT IT
 * EVERY TANK ROW IN §3 IS A VACUOUS PASS.
 *
 * A main battle tank cannot ACQUIRE an aircraft — `Targeting` refuses and
 * `Combat.engage` holds the trigger — so a Warden alone under a flight simply
 * never fires, reports 0 damage, and satisfies "no tank damages an aircraft"
 * whatever `applySplash` does. Mutation-verified: with the vertical term
 * disabled the tank rows still passed. They only mean something once the tank
 * has something it IS allowed to shoot at, standing where the shells will land.
 */
async function runCase(
  shooterKey: string, count: number, airKey: string, planes = 3, spread = 0,
  standoff = STANDOFF, altitude = AIR_CRUISE_ALTITUDE, bait = false,
): Promise<CaseResult> {
  const rig = await makeRig();
  try {
    const st = rig.world.store;
    const shooters: EntityId[] = [];
    const isBuilding = (rig.production.catalog.byKey(shooterKey)?.footprintW ?? 0) > 0;
    for (let k = 0; k < count; k++) {
      // Infantry and vehicles in a short arc so they do not stack on one point;
      // a structure goes on the grid under the flight.
      const ang = (k / Math.max(1, count)) * Math.PI * 2;
      shooters.push(isBuilding
        ? rig.spawnStruct(P0, shooterKey, 48, 48)
        : rig.spawn(P0, shooterKey, 200 + Math.cos(ang) * 3, 200 + Math.sin(ang) * 3));
    }
    assertArmed(rig, shooters);
    const si = st.index(shooters[0]);
    const cx = st.posX[si];
    const cz = st.posZ[si];

    const air: EntityId[] = [];
    for (let k = 0; k < planes; k++) {
      air.push(rig.spawnAir(P1, airKey, cx + standoff, cz + k * spread, altitude));
    }
    // Directly under the flight, so any splash that lands on it is a blast the
    // flight is inside of horizontally.
    let baitId = bait ? rig.spawn(P1, 'grizzly', cx + standoff, cz) : NONE;
    const airSet = new Set(air.map((a) => a as number));

    let firstTick = -1;
    let allTick = -1;
    let killed = 0;
    let baitHits = 0;
    for (let t = 0; t < AIR_LIMIT_TICKS; t++) {
      if (baitId !== NONE && !st.isAlive(baitId)) {
        // Keep the shells coming for the whole window: a dead bait stops the
        // tank firing and shortens the exposure the aircraft is being measured
        // against. THE HANDLE MUST BE REASSIGNED — a `const baitId` here kept
        // testing the FIRST corpse and spawned a fresh Warden every tick for
        // the rest of the run.
        baitId = rig.spawn(P1, 'grizzly', cx + standoff, cz);
      }
      rig.step(1);
      let live = 0;
      for (const a of air) if (st.isAlive(a)) live++;
      if (live < planes && firstTick < 0) firstTick = rig.tick;
      if (live === 0) { allTick = rig.tick; killed = planes; break; }
      killed = planes - live;
    }

    let viaSplash = 0; let viaDirect = 0; let dmgS = 0; let dmgD = 0;
    for (const h of rig.hits) {
      if (!airSet.has(h.victim)) continue;
      if (h.path === 'splash') { dmgS += h.dealt; if (h.killed) viaSplash++; }
      else { dmgD += h.dealt; if (h.killed) viaDirect++; }
    }
    for (const ev of rig.splashes) {
      if (Math.hypot(ev.x - (cx + standoff), ev.z - cz) < 8) baitHits++;
    }
    let maxPer = 0; let multi = 0;
    for (const ev of rig.splashes) {
      let n = 0;
      for (const v of ev.victims) if (airSet.has(v)) n++;
      if (n > maxPer) maxPer = n;
      if (n >= 2) multi++;
    }
    return {
      shooter: shooterKey, shooters: count,
      cost: (rig.production.catalog.byKey(shooterKey)?.cost ?? 0) * count,
      aircraft: airKey, killed,
      secondsToFirst: firstTick < 0 ? -1 : +(firstTick * SIM_DT).toFixed(2),
      secondsToAll: allTick < 0 ? -1 : +(allTick * SIM_DT).toFixed(2),
      viaSplash, viaDirect,
      damageSplash: +dmgS.toFixed(1), damageDirect: +dmgD.toFixed(1),
      maxAircraftPerBlast: maxPer, multiBlasts: multi,
      blastsUnderFlight: baitHits,
    };
  } finally {
    rig.dispose();
  }
}

describe('§2/§3 three aircraft over one shooter — who kills them, and how', () => {
  it('runs the whole candidate table and attributes every death to a path', async () => {
    const cases: readonly (readonly [string, number, boolean])[] = [
      // The accused. All three main battle tank cannons carry splash and none
      // carries `canTargetAir`, so each gets a BAIT — see `runCase`.
      ['grizzly', 1, true], ['rhino', 1, true], ['apocalypse', 1, true],
      // The rival candidate CLAUDE.md named, and its mobile sibling.
      ['aaTurret', 1, false], ['ifv', 1, false],
      // The floor: the four line-infantry rifles, one man and a screen of eight.
      ['gi', 1, false], ['gi', 8, false], ['conscript', 8, false],
      ['mrdWayfarer', 8, false], ['rclPicker', 8, false],
      // The dedicated AA infantryman, for the per-credit inversion.
      ['flakTrooper', 1, false], ['flakTrooper', 8, false],
    ];
    const out: CaseResult[] = [];
    for (const [key, n, bait] of cases) {
      out.push(await runCase(key, n, 'mig', 3, 0, STANDOFF, AIR_CRUISE_ALTITUDE, bait));
    }
    console.log(`[airkill §3] 3x mig (190 hp) stacked at ${AIR_CRUISE_ALTITUDE} m, dxz = ${
      STANDOFF} m\n${
      out.map((r) => JSON.stringify(r)).join('\n')}`);

    // THE HEADLINE. No tank cannon may kill an aircraft at all any more, and
    // the metric is not vacuous because the same table shows other rows doing
    // it in the same rig on the same tick budget.
    for (const r of out) {
      if (r.shooter !== 'grizzly' && r.shooter !== 'rhino' && r.shooter !== 'apocalypse') continue;
      // The bait has to have been shelled, or the two lines under it are a
      // measurement of a tank that never pulled the trigger.
      expect(
        r.blastsUnderFlight,
        `${r.shooter} never landed a shell under the flight — the bait failed`,
      ).toBeGreaterThan(0);
      expect(r.killed, `${r.shooter} still kills aircraft`).toBe(0);
      expect(r.damageSplash + r.damageDirect, `${r.shooter} still damages aircraft`).toBe(0);
    }
    expect(
      out.some((r) => r.killed === 3),
      'nothing in the table killed three aircraft — the rig may be inert',
    ).toBe(true);
    // BOTH PATH COUNTERS MUST BE ABLE TO MOVE, or "0 via splash" means nothing.
    expect(out.some((r) => r.damageSplash > 0), 'no case ever went through applySplash').toBe(true);
    expect(out.some((r) => r.damageDirect > 0), 'no case ever went through the direct path').toBe(true);
  }, 240_000);

  it('measures what one splash burst does to a STACK, because aircraft stack', async () => {
    /*
     * THE MECHANISM THE ANALYTIC SWEEP CANNOT SEE, AND THE HONEST READING OF
     * "3 AIRPLANES IN A SECOND".
     *
     * `movesShareSpace` lets two aircraft occupy one point (pinned in
     * `air-layer.spec.ts`), so a formation is not a loose one — and `aaCannon`
     * carries `splashRadius` 1.2 against an airframe whose own hit disc is
     * larger than that. One burst therefore lands on more than one aircraft,
     * and CLAUDE.md's aerial sweep is a per-target dps table that cannot
     * express it.
     *
     * Measured at three spreads so the number is a curve rather than a point.
     */
    const rows: CaseResult[] = [];
    for (const spread of [0, 2, 6]) {
      rows.push({ ...await runCase('aaTurret', 1, 'mig', 3, spread), shooter: `aaTurret@${spread}m` });
    }
    console.log(`[airkill §3] one AA Battery vs 3 migs, by spacing\n${
      rows.map((r) => JSON.stringify(r)).join('\n')}`);
    /*
     * TOTAL DAMAGE IS THE WRONG METRIC HERE AND IT WAS THE FIRST ONE TRIED.
     * Three Interceptors hold 570 hp between them and every row in this sweep kills all
     * three, so `damageSplash` came back 564.4 / 566.0 / 566.0 — a quantity
     * pinned by the targets' health rather than by the blast, i.e. a number
     * that cannot move and must not be cited. TIME and VICTIMS-PER-BLAST can.
     */
    const tight = rows[0];
    const loose = rows[rows.length - 1];
    expect(tight.maxAircraftPerBlast, 'no blast ever touched two aircraft').toBeGreaterThan(1);
    expect(loose.maxAircraftPerBlast, 'a 6 m spread still eats a single blast').toBe(1);
    expect(
      tight.secondsToAll,
      'spacing the flight out changed nothing — splash-on-a-stack is not real',
    ).toBeLessThan(loose.secondsToAll);
  }, 240_000);
});

describe('§3b the reported incident, staged', () => {
  it('a tank shelling a tank does not touch the flight loitering over it', async () => {
    /*
     * THE ACTUAL SHAPE OF "3 AIRPLANES DESTROYED BY 1 TANK". A tank cannot
     * TARGET an aircraft — `Combat.ts:573` holds the trigger and `Targeting`
     * will not acquire one — so the only route it ever had was a shell aimed at
     * something on the ground going off underneath the flight. That is what the
     * pre-fix `applySplash` allowed, and it is what this stages: an enemy tank
     * to shoot at, with the three aircraft parked directly over the victim.
     */
    const rig = await makeRig();
    try {
      const st = rig.world.store;
      const shooter = rig.spawn(P0, 'rhino', 200, 200);
      const victim = rig.spawn(P1, 'grizzly', 218, 200);
      assertArmed(rig, [shooter]);
      const vx = st.posX[st.index(victim)];
      const vz = st.posZ[st.index(victim)];
      const air = [0, 1, 2].map((k) => rig.spawnAir(P1, 'mig', vx, vz + k * 0.5));
      const airSet = new Set(air.map((a) => a as number));

      for (let t = 0; t < 20 * 30 && st.isAlive(victim); t++) rig.step(1);

      let toAir = 0;
      let blastsNearFlight = 0;
      for (const h of rig.hits) if (airSet.has(h.victim)) toAir += h.dealt;
      for (const e of rig.splashes) {
        if (Math.hypot(e.x - vx, e.z - vz) < 6) blastsNearFlight++;
      }
      const alive = air.filter((a) => st.isAlive(a)).length;
      console.log(`[airkill §3b] rhino vs grizzly, 3 migs at ${AIR_CRUISE_ALTITUDE} m over the victim: ${
        blastsNearFlight} blasts under the flight, ${toAir.toFixed(1)} damage to it, ${
        alive}/3 still flying, victim ${st.isAlive(victim) ? 'alive' : 'dead'}`);

      // THE COUNTER CAN MOVE — the same rig, the same shells, the flight at
      // 8 m instead of 22. Without this the "0" below is unfalsifiable.
      expect(blastsNearFlight, 'the tank never landed a shell under the flight').toBeGreaterThan(0);
      expect(toAir, 'a tank shell still reaches a flight at cruise altitude').toBe(0);
      expect(alive).toBe(3);
    } finally {
      rig.dispose();
    }
  }, 120_000);

  it('still reaches the same flight at 8 m, which is what makes the 0 above a reading', async () => {
    const rig = await makeRig();
    try {
      const st = rig.world.store;
      const shooter = rig.spawn(P0, 'rhino', 200, 200);
      const victim = rig.spawn(P1, 'grizzly', 218, 200);
      assertArmed(rig, [shooter]);
      const vx = st.posX[st.index(victim)];
      const vz = st.posZ[st.index(victim)];
      // 5 m is inside `heavyCannon`'s own ground-blast ceiling, which is
      // 2.1 + 2.43 + 2.065 = 6.60 m. §1's 11.0 m is `artillery`'s 6.5 m blast
      // and does NOT apply to a tank cannon — the ceiling is per weapon, and a
      // first attempt at this test used 11.0 for a shell that reaches 6.6.
      const air = [0, 1, 2].map((k) => rig.spawnAir(P1, 'mig', vx, vz + k * 0.5, 5));
      const airSet = new Set(air.map((a) => a as number));
      for (let t = 0; t < 20 * 30 && st.isAlive(victim); t++) rig.step(1);
      let toAir = 0;
      let maxPer = 0;
      for (const h of rig.hits) if (airSet.has(h.victim)) toAir += h.dealt;
      for (const e of rig.splashes) {
        let n = 0;
        for (const v of e.victims) if (airSet.has(v)) n++;
        if (n > maxPer) maxPer = n;
      }
      const alive = air.filter((a) => st.isAlive(a)).length;
      console.log(`[airkill §3b] THE SAME SHELLS with the flight at 5 m: ${
        toAir.toFixed(1)} damage, worst blast touched ${maxPer} of 3, ${alive}/3 still flying`);
      expect(toAir, 'the vertical term has become unconditional — it should be a distance')
        .toBeGreaterThan(0);
    } finally {
      rig.dispose();
    }
  }, 120_000);

  it('cannot be hit at all inside 8 m horizontally, and that is the elevation clamp', async () => {
    /*
     * A SECOND MECHANISM, FOUND WHILE BUILDING THIS FILE, AND IT IS NOT A
     * REGRESSION — it predates every change here and the splash fix does not
     * touch it.
     *
     * `Combat.engage` clamps the launch pitch to `COMBAT_WEAPONS.maxElevationDeg`
     * (62 degrees), so a projectile weapon firing at a target 22 m up sends the
     * round out at 62 degrees no matter how steep the real bearing is. The
     * round then climbs 1.88 m for every metre downrange and only reaches the
     * aircraft's altitude band well BEYOND it. The gun tracks, the trigger
     * releases, the tracer looks right, and nothing connects.
     *
     * CLAUDE.md states that `Combat.engage` puts `dy` in neither the range test
     * nor the arc, so "a rifleman standing directly beneath an aircraft is at
     * flat = 0" — true, and the consequence is the opposite of the one implied:
     * he is IN RANGE and CANNOT HIT. The safest place for an aircraft is
     * directly over the battery.
     *
     * MEASURED, NOT DERIVED, because the derivation is wrong by 3 m. A single
     * shooter, a single Interceptor at cruise, horizontal separation swept 0..20 m:
     *
     *     d (m)     0   2   4   5   6   7   8   9  10  12  14  16  18  20
     *     rifle     .   .   .   .   .   .   K   K   K   K   K   K   K   K
     *     flakBurst .   .   .   .   .   .   K   K   K   K   K   K   K   K
     *
     * The centre-line figure `AIR_CRUISE_ALTITUDE / tan(62 deg)` is 11.70 m;
     * the real edge is 8 m because the round is accepted anywhere inside the
     * airframe's hit disc and `Projectiles.sweep` tests a SPAN rather than a
     * point. Quote 8, not 11.70.
     */
    const inside = await runCase('gi', 1, 'mig', 1, 0, 7);
    const outside = await runCase('gi', 1, 'mig', 1, 0, 8);
    console.log(`[airkill §3b] one gi vs one mig at ${AIR_CRUISE_ALTITUDE} m — 7 m: ${
      JSON.stringify(inside)}
  8 m: ${JSON.stringify(outside)}`);
    expect(inside.damageDirect + inside.damageSplash, 'the dead zone has closed — re-measure it')
      .toBe(0);
    /*
     * THE CONTROL IS DAMAGE, NOT A KILL, AND IT WAS A KILL UNTIL 2026-08-19.
     *
     * This is a claim about GEOMETRY — whether a round fired at 62 degrees ever
     * reaches the aircraft's band inside the airframe's hit disc — and the
     * honest control for it is "rounds connect at 8 m and none connect at 7".
     * `killed === 1` was a proxy that also depended on the rifle's DPS, and
     * `WeaponDef.airMultiplier` (0.25 on all four line rifles) took one G.I.
     * from 8.47 s to kill an Interceptor to 33.8 s — past this rig's 30-second
     * window. The measurement did not change: 190.0 damage delivered before,
     * 177.8 delivered in the same window now, both from 8 m, both zero at 7.
     * A control that moves when an unrelated balance number moves is the wrong
     * control.
     */
    expect(
      outside.damageDirect,
      'the control at 8 m landed nothing either, so the dead-zone reading proves nothing',
    ).toBeGreaterThan(0);
    // The centre-line derivation, kept so a change to `maxElevationDeg` shows up
    // here rather than in a player's match.
    expect(BLIND_CONE).toBeGreaterThan(11);
    expect(BLIND_CONE).toBeLessThan(12);
  }, 240_000);
});

/* ==========================================================================
 * §4. THE AA BATTERY, RE-MEASURED
 *
 * CLAUDE.md: "after any such nerf the AA Battery turret becomes the
 * dominant answer and must be RE-MEASURED", and separately flags it at
 * "187-261% of an aircraft's health on ONE 26 m pass". Both are claims about
 * the SAME weapon and neither has a live number behind it.
 * ========================================================================== */

describe('§4 is the AA Battery hot', () => {
  it('prices one pass against every airframe, from the shipped row', () => {
    const aa = WEAPONS.find((w) => w.key === 'aaCannon');
    expect(aa, 'no aaCannon row').toBeDefined();
    const dps = vsAirDps(aa!);
    const rows = AIRFRAMES.map((a) => {
      const speed = UNITS.find((u) => u.key === a.key)!.maxSpeed;
      // A pass: in range at `aa.range`, out at `aa.range`, straight overhead.
      const passSeconds = (2 * aa!.range) / speed;
      return {
        aircraft: a.key, hp: a.maxHp, speed,
        passSeconds: +passSeconds.toFixed(2),
        dpsVsAir: +dps.toFixed(1),
        secondsToKill: +(a.maxHp / dps).toFixed(2),
        pctOfHealthPerPass: +((dps * passSeconds) / a.maxHp * 100).toFixed(0),
      };
    });
    console.log(`[airkill §4] aaCannon: ${aa!.burstCount}x${aa!.damage} / ${
      cycleOf(aa!).toFixed(2)}s, range ${aa!.range}, splash ${aa!.splashRadius}\n${
      rows.map((r) => JSON.stringify(r)).join('\n')}`);
    // Not an assertion about balance — an assertion that the row still exists
    // in a shape these numbers were derived from. If it is retuned this fails
    // and the numbers above get re-derived instead of quietly rotting.
    expect(aa!.canTargetAir).toBe(true);
    expect(aa!.range).toBe(26);
    for (const r of rows) expect(r.secondsToKill).toBeGreaterThan(1);
  });

  it('shows the published sweep is a SINGLE-TARGET table and names the correction', async () => {
    /*
     * WHAT CLAUDE.md's AERIAL SWEEP CANNOT SEE, AND IT IS NOT THE SPLASH FIX.
     *
     * That table is `raw * ARMOR_MATRIX[warhead][Light] * globalMul` — a
     * per-target dps. Every row that carries BOTH `canTargetAir` and a
     * `splashRadius` delivers that dps to EVERY aircraft inside the blast, and
     * `movesShareSpace` lets aircraft occupy one point. So the published
     * seconds-to-kill is correct for one aircraft and is an over-estimate by up
     * to the size of the formation for a flight.
     *
     * Measured per aircraft, not per engagement, so the two columns are
     * comparable.
     */
    const rows: { shooter: string; solo: number; flightOf3: number; ratio: number }[] = [];
    for (const [key, n] of [['flakTrooper', 1], ['flakTrooper', 8], ['aaTurret', 1]] as const) {
      const one = await runCase(key, n, 'mig', 1);
      const three = await runCase(key, n, 'mig', 3);
      const solo = one.secondsToAll;
      const per = three.secondsToAll / 3;
      rows.push({
        shooter: `${key} x${n}`, solo, flightOf3: +per.toFixed(2),
        ratio: +(solo / per).toFixed(2),
      });
    }
    console.log(`[airkill §4] seconds per aircraft: alone vs in a stacked flight of 3\n${
      rows.map((r) => JSON.stringify(r)).join('\n')}`);
    for (const r of rows) {
      expect(r.solo, `${r.shooter} could not kill a lone aircraft`).toBeGreaterThan(0);
      expect(
        r.ratio,
        `${r.shooter} is no faster per aircraft against a flight — the correction is not real`,
      ).toBeGreaterThan(1.5);
    }
  }, 240_000);
});

/* ==========================================================================
 * §5. THE ANTI-HANG FLOOR, VERIFIED RATHER THAN ASSUMED
 *
 * CLAUDE.md's floor: from every reachable tech state, every army must be able
 * to produce something whose weapon carries `canTargetAir`, ungated. The splash
 * fix's defence of the floor is a claim about GEOMETRY — "a weapon that can
 * elevate aims AT the aircraft so the vertical gap is ~0". That is a claim
 * about where the damage record's `y` lands, and it is checkable.
 * ========================================================================== */

describe('§5 the floor still holds after the splash fix', () => {
  it('puts an elevating weapon\'s blast AT the aircraft, not under it', async () => {
    const rig = await makeRig();
    try {
      const st = rig.world.store;
      const aa = rig.spawnStruct(P0, 'aaTurret', 48, 48);
      assertArmed(rig, [aa]);
      const ai = st.index(aa);
      const plane = rig.spawnAir(P1, 'mig', st.posX[ai] + 14, st.posZ[ai]);
      const pi = st.index(plane);
      const planeY = st.posY[pi];

      /*
       * READ OFF THE RECORDED BLASTS, NOT OFF `channels.damage`. `drain()` ends
       * with `q.clear()`, so the queue is empty by the time `step` returns and a
       * first attempt at this test read zero records and reported that the
       * turret never fired. The rig's `applySplash` wrapper captures the centre
       * of every blast at the moment it is resolved instead.
       */
      const planeX = st.posX[pi];
      const planeZ = st.posZ[pi];
      for (let t = 0; t < 300 && st.isAlive(plane); t++) rig.step(1);
      const ys = rig.splashes
        .filter((e) => Math.hypot(e.x - planeX, e.z - planeZ) < 6)
        .map((e) => e.y);
      expect(ys.length, 'the AA turret never landed a round on the aircraft').toBeGreaterThan(0);
      const worst = ys.reduce((m, y) => Math.max(m, Math.abs(y - planeY)), 0);
      console.log(`[airkill §5] aaCannon impact y vs plane y=${planeY.toFixed(2)}: ${
        ys.length} records, worst |dy| ${worst.toFixed(2)} m`);
      // JUST OUTSIDE THE AIRFRAME'S OWN VERTICAL EXTENT, AND IT DOES NOT CLAMP.
      // `estimatedHeight(0, radius, kind)` gives an Interceptor 4.131 m, so half is
      // 2.0655 and a worst |dy| of 2.362 leaves `gap = +0.296 m` — small, and
      // NOT zero. Reach falls 3.63 -> 3.62 m, which is why the floor is
      // unharmed, but the term is live rather than clamped.
      //
      // Two drafts of this comment were wrong in opposite directions. The first
      // claimed the gap clamps to zero, under `height * 0.5 + 1` — a metre of
      // undeclared slack that could not tell a clamp from a near miss. The
      // second put the half-extent at 2.30 by calling `estimatedHeight` with a
      // NON-ZERO `footprintW`, which takes its BUILDING branch; a unit has no
      // footprint and must pass 0. The bounds below bracket the gap on both
      // sides so neither mistake can be made again in silence.
      const frame = AIRFRAMES.find((a) => a.key === 'mig')!;
      expect(worst, 'an elevating weapon is landing its blast off the target\'s altitude')
        .toBeLessThan(frame.height * 0.5 + 0.5);
      expect(
        worst - frame.height * 0.5,
        'the gap clamps to zero now — the vertical term has become unconditional',
      ).toBeGreaterThan(0);
    } finally {
      rig.dispose();
    }
  }, 120_000);

  it('lets each army\'s ungated line infantry still take an aircraft down', async () => {
    // The floor is held up by four line-infantry rifles. Eight men of each, and
    // the requirement is only that the aircraft DIES — a floor is about
    // reachability, not about speed.
    const rows: CaseResult[] = [];
    for (const key of ['gi', 'conscript', 'mrdWayfarer', 'rclPicker']) {
      rows.push(await runCase(key, 8, 'mig', 1));
    }
    console.log(`[airkill §5] the anti-hang floor, 8 men vs 1 mig\n${
      rows.map((r) => JSON.stringify(r)).join('\n')}`);
    for (const r of rows) {
      expect(r.killed, `${r.shooter} x8 could not kill an aircraft — THE FLOOR IS GONE`).toBe(1);
    }
  }, 240_000);
});

/* ==========================================================================
 * §6. THE DISTRIBUTION OVER A REALISTIC FORCE
 *
 * §3 isolates one shooter per row, which is what makes each number readable and
 * is NOT what a flight actually meets. This is the mixed answer: an Allied
 * defensive position — four Wardens, one AA Battery, one IFV and eight
 * G.I.s — against three Interceptors at cruise, with every death attributed to a def
 * key and a path. The bill is printed rather than quoted here.
 *
 * WHAT THIS IS NOT. It is not a full match. There is no terrain, no AI, no
 * economy and no `MovementIntegrator`, so the flight is parked rather than
 * flying a pass and the numbers are an upper bound on the defence. A full-match
 * version needs the `tests/defence-line-probe.spec.ts` harness and would answer
 * a different question — how often a flight and a tank column MEET — which is a
 * fact about one seed rather than about the damage rules. The question this
 * file was written for is "which weapon and which code path", and a staged
 * engagement answers that exactly.
 * ========================================================================== */

describe('§6 who actually gets the kill when a flight meets a real position', () => {
  it('attributes every aircraft death to a def key and a path', async () => {
    const rig = await makeRig();
    try {
      const st = rig.world.store;
      const line: { key: string; n: number }[] = [
        { key: 'grizzly', n: 4 }, { key: 'aaTurret', n: 1 },
        { key: 'ifv', n: 1 }, { key: 'gi', n: 8 },
      ];
      const shooters: EntityId[] = [];
      let slot = 0;
      let cost = 0;
      for (const row of line) {
        for (let k = 0; k < row.n; k++) {
          const id = row.key === 'aaTurret'
            ? rig.spawnStruct(P0, row.key, 48, 48)
            : rig.spawn(P0, row.key, 190 + slot * 3, 200);
          shooters.push(id);
          cost += rig.production.catalog.byKey(row.key)?.cost ?? 0;
          slot++;
        }
      }
      assertArmed(rig, shooters);

      // Over the middle of the position, at cruise, stacked — the geometry the
      // report describes and the worst case for the defenders' splash.
      const air = [0, 1, 2].map((k) => rig.spawnAir(P1, 'mig', 200 + k * 0.4, 214));
      const airSet = new Set(air.map((a) => a as number));
      // A ground escort under the flight, so the four Wardens actually fire.
      // Without it they never acquire anything and "no tank damaged the flight"
      // is true of a tank that never pulled the trigger — mutation-verified.
      let escort = rig.spawn(P1, 'rhino', 200, 214);

      for (let t = 0; t < AIR_LIMIT_TICKS && air.some((a) => st.isAlive(a)); t++) {
        if (!st.isAlive(escort)) escort = rig.spawn(P1, 'rhino', 200, 214);
        rig.step(1);
      }

      const byKiller = new Map<string, { kills: number; damage: number; splash: number }>();
      for (const h of rig.hits) {
        if (!airSet.has(h.victim)) continue;
        const key = rig.keyOf(h.attacker as EntityId);
        const row = byKiller.get(key) ?? { kills: 0, damage: 0, splash: 0 };
        row.damage += h.dealt;
        if (h.path === 'splash') row.splash += h.dealt;
        if (h.killed) row.kills++;
        byKiller.set(key, row);
      }
      const table = [...byKiller.entries()]
        .map(([key, v]) => ({
          killer: key, kills: v.kills,
          damage: +v.damage.toFixed(1),
          viaSplashPct: +(v.damage > 0 ? (v.splash / v.damage) * 100 : 0).toFixed(0),
        }))
        .sort((a, b) => b.damage - a.damage);
      const down = air.filter((a) => !st.isAlive(a)).length;
      console.log(`[airkill §6] ${cost} credits of Allied position vs 3 migs — ${
        down}/3 down, ${rig.deaths.filter((d) => d.victimKey === 'mig').length} recorded deaths\n${
        table.map((r) => JSON.stringify(r)).join('\n')}`);
      console.log(`[airkill §6] deaths: ${
        rig.deaths.filter((d) => d.victimKey === 'mig')
          .map((d) => `${d.killerKey}/${d.path}@${(d.tick * SIM_DT).toFixed(2)}s`).join(' ')}`);

      // NO TANK MAY APPEAR IN THAT TABLE AT ALL — not as a killer, and not as a
      // contributor of a single point of damage.
      for (const r of table) {
        expect(r.killer, 'a main battle tank damaged an aircraft').not.toBe('grizzly');
      }
      // Which is only a reading if the Wardens were shooting. They are firing
      // at the escort standing under the flight, so their shells are landing in
      // the right place and the absence above is a decision rather than silence.
      const shelled = rig.splashes.filter((e) => Math.hypot(e.x - 200, e.z - 214) < 8).length;
      expect(shelled, 'no shell landed under the flight — the escort failed').toBeGreaterThan(0);
      expect(table.length, 'nothing at all damaged the flight').toBeGreaterThan(0);
      expect(down, 'a 6100-credit position could not clear three aircraft').toBe(3);
    } finally {
      rig.dispose();
    }
  }, 240_000);
});

/**
 * THE AIR LAYER — end to end, and the couplings that used to hold it shut.
 *
 * `MoveClass.Air` was implemented in three subsystems (pathing, movement, the
 * AI's anti-air doctrine) and NOTHING IN THE GAME COULD PRODUCE ONE.
 * `Locomotor` had five members and none of them was Air; `moveClassForLocomotor`
 * fell through to Foot; the two units authored as gunships were `Locomotor.Hover`
 * and therefore sat at ground level; `AI_BUILD.airAltitudeMetres` was never once
 * exceeded, so `sawAirTick` never left -1 and the anti-air interrupt in
 * `chooseBuild` never fired; and the four structures registered under
 * `BuildRole.AntiAir` — prismTower, teslaCoil, mrdHelios, rclPylon — appear in
 * no opening script, so the AI could not build ANY of them by any other route.
 * A complete vocabulary with no producer, which is prior case #4 of
 * `docs/SPEC_DRIFT_AUDIT.md` (`deploysInto`) with a different noun.
 *
 * Every assertion here is a link in that chain. They are grouped by the failure
 * each one prevents rather than by the file each one touches, because the bug
 * was never in one file — it was in the gaps between four.
 *
 * The one that is easiest to reintroduce, and hardest to see, is §2: an
 * aircraft cruising at or below `airAltitudeMetres` looks completely correct on
 * screen and makes the AI blind again. Nothing else in the game reads either
 * constant, so nothing else can catch it.
 */

import { describe, expect, it } from 'vitest';

import { World } from '../src/core/world';
import { Channels } from '../src/core/events';
import { Rng } from '../src/core/math';
import {
  ARMOR_CLASS_COUNT, ArmorClass, CommandKind, EntityFlag, EntityKind, Faction,
  Locomotor, OrderKind, Stance, UnitState,
} from '../src/core/types';
import type { Command, EntityId, IRng, PlayerId, SimContext, WeaponDef } from '../src/core/types';
import {
  AI_BUILD, AI_DIFFICULTY, AI_SKILL, AIR_CLIMB_LAMBDA, AIR_CRUISE_ALTITUDE,
  ARMOR_MATRIX, CELL, SIM_DT, SIM_HZ,
} from '../src/core/config';

import { FlowFieldCache, MoveClass, isFlying, moveClassForLocomotor } from '../src/sim/Flowfield';
import { MovementIntegrator, moveClassAt } from '../src/sim/Movement';
import { NavAgents, NavAssigner, SteeringSolver } from '../src/sim/Steering';
import {
  DEFAULT_WEAPONS, WeaponSystem, isAirborne, setContentWeaponMap, setWeaponKeyResolver,
  weaponCanHurt, weaponIndexOf,
} from '../src/sim/Combat';
import { TargetingSystem } from '../src/sim/Targeting';
import { ProjectileSystem } from '../src/sim/Projectiles';
import { DamageSystem, setArmorMatrix } from '../src/sim/Damage';
import { AiBrain } from '../src/sim/AI';
import { BuildCatalog, BuildRole, difficultyProfile } from '../src/sim/AIStrategy';
import type { CatalogEntry, DefLookup } from '../src/sim/AIStrategy';

import { DEF_TABLES, UNITS, BUILDINGS, WEAPONS } from '../src/data/Defs';

const P0 = 0 as PlayerId;
const P1 = 1 as PlayerId;

/** The two authored aircraft. There are exactly these and no more. */
const AIRCRAFT_KEYS = ['mrdKestrel', 'rclHornet'] as const;

function unitDef(key: string) {
  const d = UNITS.find((u) => u.key === key);
  expect(d, `no unit def '${key}'`).toBeDefined();
  return d!;
}

function weaponByKey(key: string): WeaponDef {
  const w = WEAPONS.find((x) => x.key === key);
  expect(w, `no weapon '${key}'`).toBeDefined();
  return w!;
}

/* ==========================================================================
 * 1. THE PRODUCER — Locomotor.Air exists and something is tagged with it
 * ========================================================================== */

describe('the air layer has a producer at all', () => {
  it('maps Locomotor.Air onto MoveClass.Air', () => {
    // The single line whose absence made every other air branch dead code.
    expect(moveClassForLocomotor(Locomotor.Air)).toBe(MoveClass.Air);
    expect(isFlying(moveClassForLocomotor(Locomotor.Air))).toBe(true);
    // And nothing else was quietly promoted with it.
    expect(moveClassForLocomotor(Locomotor.Foot)).toBe(MoveClass.Foot);
    expect(moveClassForLocomotor(Locomotor.Track)).toBe(MoveClass.Track);
    expect(moveClassForLocomotor(Locomotor.Wheel)).toBe(MoveClass.Wheel);
    expect(moveClassForLocomotor(Locomotor.Hover)).toBe(MoveClass.Hover);
    expect(isFlying(moveClassForLocomotor(Locomotor.Static))).toBe(false);
  });

  it('gives both authored gunships the Air locomotor', () => {
    for (const key of AIRCRAFT_KEYS) {
      expect(unitDef(key).locomotor, key).toBe(Locomotor.Air);
    }
  });

  it('leaves every ship on Hover — `Locomotor` still has no Naval member', () => {
    // The Kestrel and the Hornet were retagged; the naval hulls next to them in
    // the same file were NOT, and must not be. `MoveClass.Naval` is still
    // reached only by the water heuristic in `moveClassAt`.
    for (const key of ['mrdCorvette', 'mrdMonitor', 'rclScow', 'rclHulk', 'destroyer']) {
      expect(unitDef(key).locomotor, key).toBe(Locomotor.Hover);
    }
  });

  it('keeps aircraft on ArmorClass.Light — there is no seventh armour class', () => {
    // Prior case #6: a 4th faction indexing past a 3x3 table produced undefined
    // -> NaN in an instance colour -> bloom spread NaN through its mip chain ->
    // a black frame. The air/ground distinction is a TARGETING gate, never a
    // matrix row, and this is the assertion that keeps it one.
    expect(ARMOR_CLASS_COUNT).toBe(6);
    expect(ARMOR_MATRIX.length).toBe(7);
    for (const row of ARMOR_MATRIX) expect(row.length).toBe(ARMOR_CLASS_COUNT);
    for (const key of AIRCRAFT_KEYS) {
      expect(unitDef(key).armor, key).toBe(ArmorClass.Light);
    }
  });

  it('treats the whole map as passable for the Air class and nothing else', () => {
    const world = new World();
    const nav = new FlowFieldCache(world.terrain);
    // A cell off the far edge is still off the map for everybody.
    expect(nav.isPassableClass(-1, 0, MoveClass.Air)).toBe(false);
    expect(nav.isStandable(4, 4, MoveClass.Air)).toBe(true);
    expect(nav.isDirectPathClearClass(10, 10, 400, 400, MoveClass.Air)).toBe(true);
    // A direct field: ready the moment it is requested, no expansion at all.
    const field = nav.requestFieldClass(60, 60, MoveClass.Air);
    expect(field).toBeGreaterThanOrEqual(0);
    expect(nav.isReady(field)).toBe(true);
  });
});

/* ==========================================================================
 * 2. THE ALTITUDE COUPLING — the subtle one
 *
 * Two constants in two files that no third thing reads. If the cruise altitude
 * ever sinks to `airAltitudeMetres` or below, the AI stops seeing aircraft, the
 * anti-air interrupt stops firing, and everything below still passes on screen.
 * ========================================================================== */

interface FlightRig {
  world: World;
  movement: MovementIntegrator;
  step(n: number): void;
}

function makeFlightRig(): FlightRig {
  const world = new World();
  world.addPlayer(Faction.Meridian, 'Pact', true, true);
  const channels = new Channels();
  const nav = new FlowFieldCache(world.terrain);
  const agents = new NavAgents();
  const assigner = new NavAssigner(world, nav, agents);
  const steering = new SteeringSolver(world, nav, agents);
  const movement = new MovementIntegrator(world, nav, channels);
  const rng = new Rng(99);
  let tick = 0;
  return {
    world,
    movement,
    step(n: number): void {
      for (let k = 0; k < n; k++) {
        tick++;
        const s: SimContext = { dt: SIM_DT, tick, time: tick * SIM_DT, rng };
        world.store.snapshotPrev();
        assigner.simTick(s);
        steering.simTick(s);
        movement.simTick(s);
        world.spatial.rebuild();
      }
    },
  };
}

/** A mover in the store. Spawned at ground level, exactly as production does. */
function spawnMover(rig: FlightRig, x: number, z: number, loco: Locomotor): number {
  const st = rig.world.store;
  const y = rig.world.terrain.heightAt(x, z);
  const id = st.alloc(EntityKind.Vehicle, -1, P0, Faction.Meridian, x, y, z, 0);
  const i = st.index(id);
  st.flags[i] |= EntityFlag.CanMove;
  st.maxSpeed[i] = 12;
  st.accel[i] = 9;
  st.turnRate[i] = 3.2;
  st.radius[i] = 2;
  st.locomotor[i] = loco;
  st.hp[i] = 210; st.maxHp[i] = 210;
  st.armorClass[i] = ArmorClass.Light;
  return i;
}

describe('cruise altitude vs the altitude the AI calls airborne', () => {
  it('leaves a margin big enough that the AI cannot be blinded by a rounding', () => {
    // The relationship, not the numbers: either may be tuned, but a cruise
    // altitude at or under the detection line silently un-implements the air
    // layer. 2x is the floor; the shipped pair is 22 vs 6, i.e. 3.67x.
    expect(AIR_CRUISE_ALTITUDE).toBeGreaterThan(AI_BUILD.airAltitudeMetres * 2);
    expect(AIR_CRUISE_ALTITUDE - AI_BUILD.airAltitudeMetres).toBeGreaterThanOrEqual(10);
    // And the detection line has to stay clear of ground clutter: a tank
    // cresting a ridge must never register as an aircraft.
    expect(AI_BUILD.airAltitudeMetres).toBeGreaterThan(3);
  });

  it('climbs a freshly spawned aircraft past the detection line within a second', () => {
    // Production spawns every unit at `terrain.heightAt` and knows nothing about
    // altitude, so the climb integrator is the ONLY thing that gets a gunship
    // off the ground. The analytic answer at lambda 1.6 is ~0.2 s; a second is
    // five times that and still far inside "before anything can see it".
    const rig = makeFlightRig();
    const i = spawnMover(rig, 120, 120, Locomotor.Air);
    expect(moveClassAt(rig.world.store, i)).toBe(MoveClass.Air);
    expect(rig.world.store.posY[i]).toBe(rig.world.terrain.heightAt(120, 120));

    rig.step(SIM_HZ);
    const ground = rig.world.terrain.heightAt(
      rig.world.store.posX[i], rig.world.store.posZ[i],
    );
    expect(rig.world.store.posY[i] - ground).toBeGreaterThan(AI_BUILD.airAltitudeMetres);
  });

  it('settles at the cruise altitude and holds it', () => {
    const rig = makeFlightRig();
    const i = spawnMover(rig, 120, 120, Locomotor.Air);
    rig.step(SIM_HZ * 6);
    const st = rig.world.store;
    const ground = rig.world.terrain.heightAt(st.posX[i], st.posZ[i]);
    expect(st.posY[i] - ground).toBeCloseTo(AIR_CRUISE_ALTITUDE, 1);
  });

  it('leaves a ground unit on the ground, so the AI test above cannot pass vacuously', () => {
    const rig = makeFlightRig();
    const i = spawnMover(rig, 160, 160, Locomotor.Track);
    rig.step(SIM_HZ * 3);
    const st = rig.world.store;
    const ground = rig.world.terrain.heightAt(st.posX[i], st.posZ[i]);
    expect(st.posY[i] - ground).toBeLessThan(AI_BUILD.airAltitudeMetres);
  });

  it('keeps the climb rate a real exponential rather than a snap', () => {
    // A snap to altitude would also pass every assertion above, and would look
    // wrong the first time an aircraft crossed a mesa. One tick must move it a
    // FRACTION of the way, and that fraction is 1 - exp(-lambda*dt).
    const rig = makeFlightRig();
    const i = spawnMover(rig, 200, 200, Locomotor.Air);
    rig.step(1);
    const expected = AIR_CRUISE_ALTITUDE * (1 - Math.exp(-AIR_CLIMB_LAMBDA * SIM_DT));
    expect(rig.world.store.posY[i]).toBeCloseTo(expected, 4);
    expect(rig.world.store.posY[i]).toBeLessThan(AIR_CRUISE_ALTITUDE * 0.2);
  });
});

/* ==========================================================================
 * 3. THE TARGETING GATE — who is allowed to shoot up
 * ========================================================================== */

interface CombatRig {
  world: World;
  step(n?: number): void;
}

function makeCombatRig(): CombatRig {
  setContentWeaponMap({});
  setWeaponKeyResolver(null);
  setArmorMatrix(ARMOR_MATRIX);

  const world = new World();
  const channels = new Channels();
  world.addPlayer(Faction.Allies, 'A', true, true);
  world.addPlayer(Faction.Soviets, 'B', false, false);

  const projectiles = new ProjectileSystem(world, channels);
  const damage = new DamageSystem(world, channels);
  const weapons = new WeaponSystem(world, channels, projectiles);
  const targeting = new TargetingSystem(world, channels, weapons);
  const rng = new Rng(11);
  let tick = 0;

  return {
    world,
    step(n = 1): void {
      for (let k = 0; k < n; k++) {
        tick++;
        world.store.snapshotPrev();
        world.tick = tick;
        world.time = tick * SIM_DT;
        const s: SimContext = { dt: SIM_DT, tick, time: tick * SIM_DT, rng };
        world.spatial.rebuild();
        targeting.tick(s);
        weapons.tick(s);
        projectiles.tick(s);
        damage.damageTick(s);
        damage.cleanupTick(s);
        channels.damage.clear();
        channels.fx.clear();
      }
    },
  };
}

function spawnShooter(
  rig: CombatRig, player: PlayerId, x: number, z: number, weapon: number,
): EntityId {
  const st = rig.world.store;
  const faction = player === P0 ? Faction.Allies : Faction.Soviets;
  const h = st.alloc(EntityKind.Vehicle, -1, player, faction, x, 0, z, 0);
  const i = st.index(h);
  st.maxHp[i] = 600; st.hp[i] = 600;
  st.armorClass[i] = ArmorClass.Medium;
  st.radius[i] = 2;
  st.sight[i] = 40;
  st.weaponIndex[i] = weapon;
  st.locomotor[i] = Locomotor.Track;
  st.state[i] = UnitState.Idle;
  st.stance[i] = Stance.Aggressive;
  st.turretTurnRate[i] = 8;
  st.flags[i] |= EntityFlag.ProvidesVision | EntityFlag.CanAttack | EntityFlag.HasTurret;
  return h;
}

/** A gunship: `Locomotor.Air`, parked at cruise altitude. */
function spawnGunship(rig: CombatRig, player: PlayerId, x: number, z: number): EntityId {
  const st = rig.world.store;
  const faction = player === P0 ? Faction.Allies : Faction.Soviets;
  const h = st.alloc(EntityKind.Vehicle, -1, player, faction, x, AIR_CRUISE_ALTITUDE, z, 0);
  const i = st.index(h);
  st.maxHp[i] = 210; st.hp[i] = 210;
  st.armorClass[i] = ArmorClass.Light;
  st.radius[i] = 2;
  st.sight[i] = 36;
  st.weaponIndex[i] = -1;
  st.locomotor[i] = Locomotor.Air;
  st.state[i] = UnitState.Idle;
  st.stance[i] = Stance.Aggressive;
  st.flags[i] |= EntityFlag.ProvidesVision | EntityFlag.CanMove;
  return h;
}

const W_RIFLE = weaponIndexOf('rifle');
const W_HEAVY_CANNON = weaponIndexOf('heavyCannon');
const W_AA = weaponIndexOf('aaCannon');

describe('canTargetAir — the gate, and its default', () => {
  it('defaults to false, which is the opposite of its sibling', () => {
    // `canTargetInfantry` defaults TRUE: a gun shoots a man unless told not to.
    // `canTargetAir` defaults FALSE, and that asymmetry is the entire balance
    // decision in this change. A layer every gun already answers is not a layer.
    // The two rows below both take the default and prove which way it falls.
    expect(weaponByKey('lightCannon').canTargetInfantry).toBe(true);
    expect(weaponByKey('lightCannon').canTargetAir).toBe(false);
  });

  it('refuses the armoured column and allows the answers', () => {
    // The rule: a soldier points his own weapon up, an autocannon tracks, a
    // guided rocket follows, a purpose-built AA mount is what it says. A tank
    // cannon, an artillery piece, a flamethrower, a torpedo, a naval deck gun,
    // a siege beam and an emplaced MG do not.
    const can = ['rifle', 'conscriptRifle', 'chaingun', 'aaCannon', 'rocketLauncher',
      'shipMissile', 'prismTowerBeam', 'teslaBolt',
      'pulseCarbine', 'sunLance', 'arcRepeater', 'heliosLance', 'kestrelPod', 'monitorLance',
      'arcProd', 'spitCoil', 'hornetArc', 'pylonArc'];
    const cannot = ['lightCannon', 'heavyCannon', 'twinCannon', 'prismBeam', 'flameJet',
      'pillboxMg', 'artillery', 'navalGun', 'torpedo', 'bite',
      'focusLance', 'zenithBeam', 'glaiveRepeater', 'mirrorGun',
      'slagCharge', 'grinderArc', 'slagMortar', 'scowGun', 'hulkBattery', 'postCoil'];
    for (const k of can) expect(weaponByKey(k).canTargetAir, k).toBe(true);
    for (const k of cannot) expect(weaponByKey(k).canTargetAir, k).toBe(false);
    // Every weapon in the game is in exactly one of those two lists, so a new
    // row cannot be added without deciding which side it is on.
    expect(new Set([...can, ...cannot]).size).toBe(WEAPONS.length);
  });

  it('vetoes in weaponCanHurt before the armour matrix is consulted', () => {
    const cannon = weaponByKey('heavyCannon');
    const flak = weaponByKey('aaCannon');
    // Both hurt Light armour perfectly well on the ground.
    expect(weaponCanHurt(cannon, ArmorClass.Light, false)).toBe(true);
    expect(weaponCanHurt(flak, ArmorClass.Light, false)).toBe(true);
    // Airborne, only one of them is allowed to try.
    expect(weaponCanHurt(cannon, ArmorClass.Light, true)).toBe(false);
    expect(weaponCanHurt(flak, ArmorClass.Light, true)).toBe(true);
    // The default argument keeps every ground-only caller reading unchanged.
    expect(weaponCanHurt(cannon, ArmorClass.Light)).toBe(true);
  });

  it('reads airborne off the locomotor, not off the altitude', () => {
    // A unit climbing out of a valley must not flicker in and out of being
    // targetable, so the exact answer is the declaration and not the position.
    const rig = makeCombatRig();
    const gunship = spawnGunship(rig, P1, 100, 100);
    const tank = spawnShooter(rig, P0, 100, 115, W_HEAVY_CANNON);
    const st = rig.world.store;
    expect(isAirborne(st, st.index(gunship))).toBe(true);
    expect(isAirborne(st, st.index(tank))).toBe(false);
    // Drag the gunship down to the deck: still an aircraft.
    st.posY[st.index(gunship)] = 0;
    expect(isAirborne(st, st.index(gunship))).toBe(true);
  });

  it('will not let a tank acquire a gunship, and will let a rifleman', () => {
    const rig = makeCombatRig();
    const gunship = spawnGunship(rig, P1, 100, 100);
    const tank = spawnShooter(rig, P0, 100, 114, W_HEAVY_CANNON);
    const rifle = spawnShooter(rig, P0, 86, 100, W_RIFLE);
    rig.step(60);
    const st = rig.world.store;
    expect(st.targetId[st.index(tank)], 'a 125 mm gun does not elevate').toBe(0);
    expect(st.targetId[st.index(rifle)], 'a rifleman can point up').toBe(gunship as number);
  });

  it('holds the trigger even on an explicit attack order', () => {
    // Targeting writes `targetId` straight past `isValidTarget` for an explicit
    // Attack/ForceAttack (see Targeting §"an explicit order beats everything"),
    // so a gate that lived only in acquisition would be defeated by a click.
    const rig = makeCombatRig();
    const gunship = spawnGunship(rig, P1, 100, 100);
    const tank = spawnShooter(rig, P0, 100, 112, W_HEAVY_CANNON);
    const st = rig.world.store;
    const ti = st.index(tank);
    st.orderKind[ti] = OrderKind.Attack;
    st.orderTarget[ti] = gunship as number;
    st.state[ti] = UnitState.Attacking;

    const hp0 = st.hp[st.index(gunship)];
    rig.step(120);
    expect(st.hp[st.index(gunship)], 'a forced attack must not bypass the gate').toBe(hp0);
  });

  it('lets an air-capable weapon actually take a gunship apart', () => {
    // The gate is only half the feature. If nothing can convert "allowed to
    // shoot" into damage at 22 m of altitude, anti-air is decoration — and this
    // case found a real one. `Projectiles.sweep` sampled its vertical gate at
    // the point where the swept segment ENTERS the target's XZ disc, which for
    // a steeply climbing burst is metres BELOW the aircraft: every shot was
    // rejected, and the closer the battery the worse it got, so a gunship was
    // safest parked directly over the flak. Fixed there by testing the y SPAN
    // from the entry to the closest approach. 16 m is inside `aaCannon`'s 26 m
    // reach and steep enough (~58 degrees) to reproduce it.
    const rig = makeCombatRig();
    const gunship = spawnGunship(rig, P1, 100, 100);
    spawnShooter(rig, P0, 100, 116, W_AA);
    const st = rig.world.store;
    const hp0 = st.hp[st.index(gunship)];
    rig.step(150);
    const gi = st.index(gunship);
    const hp1 = gi < 0 ? 0 : st.hp[gi];
    expect(hp1, 'flak did no damage to a target it is allowed to shoot').toBeLessThan(hp0);
  });

  it('still hits from the far edge of the envelope, where the shot is shallow', () => {
    // The other end of the same band. If the span fix had over-corrected into
    // "any segment near the disc hits", this would pass for the wrong reason —
    // so the tank in the identical geometry is checked alongside it.
    const rig = makeCombatRig();
    const gunship = spawnGunship(rig, P1, 100, 100);
    spawnShooter(rig, P0, 100, 124, W_AA);
    const decoy = spawnGunship(rig, P1, 200, 200);
    spawnShooter(rig, P0, 200, 224, W_HEAVY_CANNON);
    const st = rig.world.store;
    const hp0 = st.hp[st.index(gunship)];
    rig.step(150);
    const gi = st.index(gunship);
    expect(gi < 0 ? 0 : st.hp[gi], 'flak at 24 m').toBeLessThan(hp0);
    expect(st.hp[st.index(decoy)], 'a 125 mm gun in the same geometry').toBe(210);
  });
});

/* ==========================================================================
 * 4. THE AI'S ANSWER — the payoff
 * ========================================================================== */

function syntheticBinding(): DefLookup {
  const catalog = new BuildCatalog();
  const unitId: Record<string, number> = {};
  const buildingId: Record<string, number> = {};
  let u = 0;
  let b = 0;
  for (const e of catalog.all) {
    if (e.isBuilding) buildingId[e.key] = b++;
    else unitId[e.key] = u++;
  }
  return { tables: null, unitId, buildingId };
}

interface AiRig {
  world: World;
  brain: AiBrain;
  catalog: BuildCatalog;
  /** Tick of the first ProductionStart naming the faction's AntiAir entry. */
  antiAirTick: number;
  antiAirStarts: number;
  step(ticks: number): void;
}

/**
 * An AI with a Construction Yard, a power plant and a RADAR — the Soviet
 * anti-air prereq — and a bank it cannot run out of. Nothing here executes the
 * AI's commands; the assertion is about what it ASKS for, which is the only
 * thing the brain is allowed to do (`channels.command` is its single exit).
 */
function makeAiRig(difficulty: number): AiRig {
  const world = new World();
  const channels = new Channels();
  world.addPlayer(Faction.Allies, 'Commander', true, true);
  world.addPlayer(Faction.Soviets, 'Opponent', false, false);
  const ai = world.player(P1);
  ai.aiDifficulty = difficulty;
  ai.aiPersonality = 0;
  ai.credits = 400_000;
  ai.powerProduced = 800;
  ai.powerConsumed = 20;

  const st = world.store;
  const building = (x: number, z: number, w: number, h: number, flags: number, power: number) => {
    const id = st.alloc(EntityKind.Building, -1, P1, Faction.Soviets, x, 0, z, 0);
    const i = st.index(id);
    st.flags[i] |= flags | EntityFlag.BlocksNav;
    st.footprintW[i] = w; st.footprintH[i] = h;
    st.powerDraw[i] = power;
    st.hp[i] = 2000; st.maxHp[i] = 2000;
    st.armorClass[i] = ArmorClass.Concrete;
    st.buildProgress[i] = 1;
    world.terrain.markOccupied(
      Math.floor(x / CELL) - ((w / 2) | 0), Math.floor(z / CELL) - ((h / 2) | 0), w, h, id,
    );
    return id;
  };
  building(400, 400, 3, 3, EntityFlag.IsBuilder | EntityFlag.IsFactory, -20);
  building(380, 400, 2, 2, 0, 100);
  // The anti-air prereq. `teslaCoil` is gated on a radar, and without one the
  // interrupt fires, finds the entry unavailable, and this test would prove
  // that the AI wants anti-air rather than that it can get it.
  building(380, 380, 2, 2, EntityFlag.IsRadar, -40);

  const catalog = new BuildCatalog();
  catalog.bind(syntheticBinding());
  const brain = new AiBrain(world, channels.commands, catalog, P1, 4242);
  brain.attach(channels.events);

  const aaEntry = catalog.forRole(BuildRole.AntiAir, Faction.Soviets) as CatalogEntry;
  const rng: IRng = new Rng(7);
  let tick = 0;

  const rig: AiRig = {
    world, brain, catalog,
    antiAirTick: -1,
    antiAirStarts: 0,
    step(ticks: number): void {
      for (let n = 0; n < ticks; n++) {
        tick++;
        world.tick = tick;
        world.time = tick * SIM_DT;
        channels.setTick(tick);
        brain.tick({ dt: SIM_DT, tick, time: tick * SIM_DT, rng });
        channels.commands.drain((c: Command) => {
          if (c.kind !== CommandKind.ProductionStart) return;
          if (c.defId !== aaEntry.defId) return;
          rig.antiAirStarts++;
          if (rig.antiAirTick < 0) rig.antiAirTick = tick;
        });
      }
    },
  };
  return rig;
}

/** An enemy aircraft, parked in the AI's field of view at cruise altitude. */
function spawnEnemyGunship(rig: AiRig, x: number, z: number): EntityId {
  const st = rig.world.store;
  const id = st.alloc(EntityKind.Vehicle, -1, P0, Faction.Meridian, x, AIR_CRUISE_ALTITUDE, z, 0);
  const i = st.index(id);
  st.flags[i] |= EntityFlag.CanMove | EntityFlag.CanAttack | EntityFlag.ProvidesVision;
  st.hp[i] = 210; st.maxHp[i] = 210;
  st.maxSpeed[i] = 12;
  st.armorClass[i] = ArmorClass.Light;
  st.radius[i] = 2;
  st.locomotor[i] = Locomotor.Air;
  return id;
}

describe('the AI answers an aircraft it has actually seen', () => {
  it('never registers air, and never builds anti-air, without one', () => {
    // The control. This is the state the game shipped in for its whole life:
    // the doctrine is present, correct, and unreachable.
    const rig = makeAiRig(3);
    // A GROUND vehicle in the same place, so the only difference is altitude.
    const st = rig.world.store;
    const id = st.alloc(EntityKind.Vehicle, -1, P0, Faction.Allies, 400, 0, 430, 0);
    const i = st.index(id);
    st.flags[i] |= EntityFlag.CanMove | EntityFlag.CanAttack | EntityFlag.ProvidesVision;
    st.hp[i] = 300; st.maxHp[i] = 300;
    st.armorClass[i] = ArmorClass.Medium;
    st.radius[i] = 2;
    st.locomotor[i] = Locomotor.Track;

    rig.step(SIM_HZ * 20);
    expect(rig.brain.firstAirSightingTick).toBe(-1);
    expect(rig.brain.lastAirSightingTick).toBe(-1);
    expect(rig.brain.antiAirCount).toBe(0);
    expect(rig.antiAirStarts, 'anti-air with nothing in the air').toBe(0);
  });

  it('sees a gunship and queues anti-air', () => {
    const rig = makeAiRig(3);
    spawnEnemyGunship(rig, 400, 430);
    rig.step(SIM_HZ * 20);

    expect(rig.brain.firstAirSightingTick, 'the AI never noticed the aircraft')
      .toBeGreaterThanOrEqual(0);
    expect(rig.antiAirStarts, 'saw a gunship and queued no anti-air')
      .toBeGreaterThan(0);
    // And it names the AntiAir structure by def id — this is a real
    // ProductionStart on the command bus, not a mutation of anything.
    const aa = rig.catalog.forRole(BuildRole.AntiAir, Faction.Soviets)!;
    expect(aa.role).toBe(BuildRole.AntiAir);
    expect(aa.defId).toBeGreaterThanOrEqual(0);
  });

  it('measures the reaction from the FIRST sighting, not the latest', () => {
    // `sawAirTick` is refreshed every census while the aircraft is visible. If
    // the reaction delay were measured from it, a gunship that simply stayed on
    // screen would reset the timer forever and a slow rung would never react.
    const rig = makeAiRig(0);
    spawnEnemyGunship(rig, 400, 430);
    rig.step(SIM_HZ * 40);
    expect(rig.brain.lastAirSightingTick)
      .toBeGreaterThan(rig.brain.firstAirSightingTick);
    expect(rig.antiAirStarts, 'Easy never got there').toBeGreaterThan(0);
  });
});

/* ==========================================================================
 * 5. DIFFICULTY — a doctrine switching on is a strengthening
 * ========================================================================== */

describe('the anti-air answer is on the difficulty ladder', () => {
  it('ramps both halves of the response and never goes backwards', () => {
    for (let i = 1; i < AI_SKILL.length; i++) {
      const lo = AI_SKILL[i - 1]!;
      const hi = AI_SKILL[i]!;
      expect(hi.maxAntiAir, `${AI_DIFFICULTY[i]!.name} towers`)
        .toBeGreaterThanOrEqual(lo.maxAntiAir);
      expect(hi.airReactionSec, `${AI_DIFFICULTY[i]!.name} reaction`)
        .toBeLessThanOrEqual(lo.airReactionSec);
    }
    // Ordered is not the same as felt. Easy must be visibly worse at this.
    expect(AI_SKILL[0]!.maxAntiAir).toBeLessThan(AI_SKILL[3]!.maxAntiAir);
    expect(AI_SKILL[0]!.airReactionSec).toBeGreaterThan(AI_SKILL[3]!.airReactionSec + 5);
    // And no rung may exceed the ceiling the build layer documents.
    for (const rung of AI_SKILL) {
      expect(rung.maxAntiAir).toBeLessThanOrEqual(AI_BUILD.maxAntiAir);
    }
  });

  it('carries both onto the resolved profile', () => {
    for (let d = 0; d < AI_DIFFICULTY.length; d++) {
      const p = difficultyProfile(d);
      expect(p.maxAntiAir, `${p.name} towers`).toBe(AI_SKILL[d]!.maxAntiAir);
      const sec = AI_SKILL[d]!.airReactionSec;
      expect(p.airReactionTicks, `${p.name} ticks`)
        .toBe(sec <= 0 ? 0 : Math.max(1, Math.round(sec * SIM_HZ)));
    }
  });

  it('does not touch the economy handicap that v1.27.0 shipped', () => {
    // Guard rail. The air work is allowed to add axes to this table; it is not
    // allowed to walk back the ones that made Easy an actual beginner.
    expect(AI_DIFFICULTY[0]!.resourceBonus).toBe(0.8);
    expect(AI_SKILL[0]!.maxHarvesters).toBe(5);
    expect(AI_SKILL[0]!.maxRefineries).toBe(2);
    expect(AI_SKILL[0]!.queueDepth).toBe(1);
  });

  it('makes Brutal answer sooner than Easy against the identical gunship', () => {
    const easy = makeAiRig(0);
    spawnEnemyGunship(easy, 400, 430);
    easy.step(SIM_HZ * 40);

    const brutal = makeAiRig(3);
    spawnEnemyGunship(brutal, 400, 430);
    brutal.step(SIM_HZ * 40);

    expect(brutal.antiAirTick).toBeGreaterThanOrEqual(0);
    expect(easy.antiAirTick).toBeGreaterThan(brutal.antiAirTick);
    // Roughly the authored gap, allowing for the build cadence either side.
    const gap = (AI_SKILL[0]!.airReactionSec - AI_SKILL[3]!.airReactionSec) * SIM_HZ;
    expect(easy.antiAirTick - brutal.antiAirTick).toBeGreaterThan(gap * 0.5);
  });
});

/* ==========================================================================
 * 6. NO VOCABULARY WITHOUT A PRODUCER — the invariant this whole file is for
 * ========================================================================== */

describe('every air claim in the content has something behind it', () => {
  const catalog = new BuildCatalog();

  it('gives every BuildRole.AntiAir structure a weapon that can shoot up', () => {
    // The load-bearing one. The AI's anti-air interrupt pre-empts almost every
    // other build decision; a tower it queues that cannot elevate is worse than
    // no answer at all, because it also spends the credits.
    const aa = catalog.all.filter((e) => e.isBuilding && e.role === BuildRole.AntiAir);
    expect(aa.length, 'no AntiAir structures at all').toBeGreaterThanOrEqual(4);
    for (const entry of aa) {
      const def = BUILDINGS.find((b) => b.key === entry.key);
      expect(def, `${entry.key} has no building def`).toBeDefined();
      expect(def!.weapons.length, `${entry.key} is unarmed`).toBeGreaterThan(0);
      for (const wi of def!.weapons) {
        expect(WEAPONS[wi]!.canTargetAir, `${entry.key} fires ${WEAPONS[wi]!.key}`).toBe(true);
      }
    }
  });

  it('never lets a unit claim an air answer its gun cannot deliver', () => {
    // `CatalogEntry.answers` documents 1.0 as "does its job". Anything the
    // composition scorer would reach for AS an answer to air has to be able to
    // shoot air — otherwise seeing a gunship makes the AI build the wrong army,
    // confidently. (This is what put `apocalypse` at 1.2 with a 125 mm gun.)
    const AIR = 4;
    for (const entry of catalog.all) {
      if (entry.isBuilding) continue;
      if (entry.answers[AIR] < 1) continue;
      const def = UNITS.find((u) => u.key === entry.key);
      if (def === undefined) continue;             // fallback-only catalog key
      const capable = def.weapons.some((wi) => WEAPONS[wi]!.canTargetAir);
      expect(capable, `${entry.key} scores ${entry.answers[AIR]} vs air but cannot shoot it`)
        .toBe(true);
    }
  });

  it('leaves every faction a buildable answer to a gunship', () => {
    // Four armies; each must own at least one AIR-CAPABLE thing, or the air
    // layer is an unanswerable position for whoever is missing one.
    const factions = [Faction.Allies, Faction.Soviets, Faction.Meridian, Faction.Reclaim];
    for (const f of factions) {
      const units = UNITS.filter((u) => u.faction === f || u.faction === Faction.Neutral)
        .filter((u) => u.weapons.some((wi) => WEAPONS[wi]!.canTargetAir));
      const structures = BUILDINGS.filter((b) => b.faction === f || b.faction === Faction.Neutral)
        .filter((b) => b.weapons.some((wi) => WEAPONS[wi]!.canTargetAir));
      expect(units.length, `faction ${f} has no mobile answer to air`).toBeGreaterThan(0);
      expect(structures.length, `faction ${f} has no static answer to air`).toBeGreaterThan(0);
    }
  });

  it('gives the aircraft themselves a way to fight each other', () => {
    // "Own the only gunship" must not be a win condition.
    for (const key of AIRCRAFT_KEYS) {
      const def = unitDef(key);
      expect(def.weapons.length, key).toBeGreaterThan(0);
      expect(def.weapons.some((wi) => WEAPONS[wi]!.canTargetAir), key).toBe(true);
    }
  });

  it('keeps the sim armoury a true prefix of the content armoury', () => {
    // `store.weaponIndex` is a bare integer. Adding `canTargetAir` touched both
    // tables; if the two ever disagreed by identity, every unit spawned before
    // `setWeaponTable(WEAPONS)` would fire its neighbour's gun.
    for (let i = 0; i < DEFAULT_WEAPONS.length; i++) {
      expect(WEAPONS[i], `weapon row ${i}`).toBe(DEFAULT_WEAPONS[i]);
    }
    expect(DEF_TABLES.weapons).toBe(WEAPONS);
  });
});

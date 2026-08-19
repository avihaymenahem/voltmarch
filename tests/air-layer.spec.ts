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
  ARMOR_CLASS_COUNT, ArmorClass, BuildTab, CommandKind, EntityFlag, EntityKind, Faction, FxKind, Locomotor, NONE, OrderKind, Stance, UnitState, WarheadClass,
} from '../src/core/types';
import type {
  Command, EntityId, IRng, ITerrain, PlayerId, SimContext, WeaponDef,
} from '../src/core/types';
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
// §7 crosses the four tables an aircraft has to appear in at once. That is the
// whole point of it: each of them fails silently on its own.
import { FALLBACK_UNITS, resolveDefBinding } from '../src/game/Scenarios';
import {
  PRODUCTION_CONTENT, ProductionCatalog, ProductionService,
} from '../src/sim/Production';
import { cameoModelKey } from '../src/ui/Cameos';

const P0 = 0 as PlayerId;
const P1 = 1 as PlayerId;

/**
 * The authored aircraft. There are exactly these and no more.
 *
 * It was TWO for the whole life of the air layer, and the missing pair is the
 * subject of §7: `allied_vindicator` and `soviet_mig` were built, merged and
 * silhouette-validated on every boot with no `UnitDef` behind either of them,
 * so two of the four armies could be flown at and could not fly.
 */
const AIRCRAFT_KEYS = ['mrdKestrel', 'rclHornet', 'vindicator', 'mig'] as const;

/** One per army, so a per-faction assertion cannot pass by testing one twice. */
const AIRCRAFT_BY_FACTION: readonly (readonly [Faction, string])[] = [
  [Faction.Allies, 'vindicator'],
  [Faction.Soviets, 'mig'],
  [Faction.Meridian, 'mrdKestrel'],
  [Faction.Reclaim, 'rclHornet'],
];

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
  /** Exposed so a test can queue one damage record and resolve it directly. */
  readonly channels: Channels;
  readonly damage: DamageSystem;
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
    channels,
    damage,
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
      'arcProd', 'spitCoil', 'hornetArc', 'pylonArc',
      // The man-portable flak gun. `aaCannon` above is the EMPLACED battery and
      // is balanced as one; this is the version an infantryman can carry. Its
      // Air answer (1.7) WAS the highest in the Soviet army — `migCannon` below
      // is 1.9 now — which is still the whole reason a flak trooper is called
      // one. The Javelin needs no row here: it fires `rocketLauncher`, already
      // listed above.
      'flakBurst',
      // The Allied and Soviet air arms. Both elevate, for the reason the
      // Kestrel's pods and the Hornet's arc do: aircraft must be able to answer
      // aircraft, or owning the only one is a win condition.
      'vindicatorMissile', 'migCannon',
      // The Sabre IFV's replacement gun. It elevates for the same reason
      // `chaingun` (still row 6, still listed above) did: an autocannon on a
      // turret is the textbook mobile AA mount, and the IFV is the Allied
      // army's only one that moves. See `REBALANCE_WEAPONS` in Defs.ts — the
      // rebalance cut its damage, never its ability to shoot up.
      'ifvChaingun'];
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

/* ==========================================================================
 * 7. THE OTHER TWO ARMIES, AND THE EDGES AN AIRCRAFT HAS THAT A TANK DOES NOT
 *
 * `Locomotor.Air` shipped with TWO producers, both in factions added after the
 * game did — so for the whole life of the air layer the Allies and the Soviets
 * could be flown at and could not fly. It was not a missing feature: it was a
 * missing content row, in exactly the shape of prior case `soviet_flak`.
 * `allied_vindicator` and `soviet_mig` were in `UNIT_MASS_LISTS`, so every
 * match paid to merge their geometry and validate their silhouette, and the
 * boot log printed a scorecard line for each of them, every boot, forever.
 *
 * The rest of this section is the part that is NOT a def row. An aircraft has
 * four edges a ground unit does not, every one of them already implemented by
 * something generic, and every one of them documented in the roster header in
 * `src/data/Defs.ts`. These are the assertions that keep that documentation
 * true — a header nobody checks is the defect `docs/SPEC_DRIFT_AUDIT.md` is a
 * catalogue of.
 * ========================================================================== */

describe('all four armies field exactly one aircraft', () => {
  it('gives each faction its own, and none of them Neutral', () => {
    // Neutral would put the same aircraft in every other army's sidebar, which
    // is the failure the Pact and Reclamation catalog blocks both warn about.
    for (const [faction, key] of AIRCRAFT_BY_FACTION) {
      expect(unitDef(key).faction, key).toBe(faction);
    }
    const flying = UNITS.filter((u) => u.locomotor === Locomotor.Air).map((u) => u.key);
    expect(flying.sort()).toEqual([...AIRCRAFT_KEYS].sort());
  });

  it('prices them as ONE band, so no army pays a different rate to fly', () => {
    // The brief for the two new rows was "comparable", and comparable has to
    // mean a number. Cheapest to dearest the four are 900/1000/1100/1200 and
    // 180/190/210/240 hp; a 2x spread in either would mean one faction's air
    // tier is a different decision from another's.
    const costs = AIRCRAFT_KEYS.map((k) => unitDef(k).cost);
    const hps = AIRCRAFT_KEYS.map((k) => unitDef(k).maxHp);
    expect(Math.max(...costs) / Math.min(...costs)).toBeLessThanOrEqual(1.5);
    expect(Math.max(...hps) / Math.min(...hps)).toBeLessThanOrEqual(1.5);
    // And every one of them is the thinnest-skinned thing its army can build
    // for the money — an aircraft is bought for where it stands, never for how
    // much it survives.
    for (const key of AIRCRAFT_KEYS) {
      const d = unitDef(key);
      expect(d.armor, key).toBe(ArmorClass.Light);
      expect(d.maxHp, key).toBeLessThan(300);
    }
  });

  it('reaches its air tier at the same depth in every tech tree', () => {
    // War factory plus radar, one tier under the tech building, in all four.
    // A faction whose aircraft sat behind the lab would field it a full tier
    // later than everyone else for no stated reason.
    const factories = new Set([
      'warFactory', 'mrdForgeyard', 'rclBreakerYard',
    ]);
    const radars = new Set(['radar', 'mrdOculus', 'rclSpotter']);
    const techs = new Set(['battleLab', 'mrdReliquary', 'rclCrucible']);
    for (const key of AIRCRAFT_KEYS) {
      const p = unitDef(key).prereqs;
      expect(p.length, key).toBe(2);
      expect(p.some((k) => factories.has(k)), `${key} has no vehicle factory prereq`).toBe(true);
      expect(p.some((k) => radars.has(k)), `${key} has no radar prereq`).toBe(true);
      expect(p.some((k) => techs.has(k)), `${key} is gated on a tech building`).toBe(false);
    }
  });

  it('gates all four behind the same unlock, or none of them', () => {
    // `UNLOCK_TAGS` mirrors its groups across the four armies on purpose, and
    // `unit.air` named two keys while four aircraft existed in doctrine. A
    // player who switches faction must not be sent back down the curve.
    for (const key of AIRCRAFT_KEYS) {
      expect(unitDef(key).unlockedBy, key).toBe('unit.air');
    }
  });

  it('gives every aircraft a model binding a spawn can actually resolve', () => {
    // The def row is half of it. `RenderBridge` resolves art by (kind, faction,
    // defId) and `units.system.ts` registers that mapping from its own private
    // table — the exact line that was missing for `soviet_flak`. Checked from
    // the UI's mirror of the same join, which is the only copy a test can see.
    for (const [faction, key] of AIRCRAFT_BY_FACTION) {
      expect(cameoModelKey(key, faction, false), key).not.toBeNull();
    }
    expect(cameoModelKey('vindicator', Faction.Allies, false)).toBe('allied_vindicator');
    expect(cameoModelKey('mig', Faction.Soviets, false)).toBe('soviet_mig');
  });

  it('makes each one buildable and each one known to the AI', () => {
    // Four tables have to agree before an aircraft exists: the def row, the
    // production spec, the fallback row and the AI catalog. Three of the four
    // fail SILENTLY when they disagree — a missing production spec is a unit
    // with no cameo, a missing fallback row is a build bar that reaches 100%
    // and delivers nothing, and a missing catalog entry is a unit the human
    // can build and the AI never will.
    const catalog = new BuildCatalog();
    for (const [faction, key] of AIRCRAFT_BY_FACTION) {
      const spec = PRODUCTION_CONTENT.find((c) => c.key === key);
      expect(spec, `${key} has no production spec`).toBeDefined();
      expect(spec!.faction, key).toBe(faction);
      expect(FALLBACK_UNITS[key], `${key} has no fallback row`).toBeDefined();
      const entry = catalog.get(key);
      expect(entry, `${key} is not in the AI catalog`).toBeDefined();
      expect(entry!.answers[4], `${key} scores nothing against air`).toBeGreaterThan(0);
    }
  });

  it('keeps the def table and the fallback table agreeing to the digit', () => {
    // `ProductionService.spawnUnit` reads the FALLBACK first and the def
    // second, so a disagreement gives one unit two different chassis depending
    // on whether the data module happened to bind.
    for (const key of AIRCRAFT_KEYS) {
      const def = unitDef(key);
      const fb = FALLBACK_UNITS[key];
      expect(fb, key).toBeDefined();
      expect(fb!.locomotor, `${key} locomotor`).toBe(def.locomotor);
      expect(fb!.maxHp, `${key} hp`).toBe(def.maxHp);
      expect(fb!.maxSpeed, `${key} speed`).toBe(def.maxSpeed);
      expect(fb!.turnRate, `${key} turn`).toBeCloseTo(def.turnRate, 6);
      expect(fb!.sight, `${key} sight`).toBe(def.sight);
      expect(fb!.armor, `${key} armour`).toBe(def.armor);
      // The flag trap: `Defs.unit()` leaves `flags` at 0 for the two original
      // armies because `spawnUnit` ORs the def's on top of the fallback's. So
      // for an Allied or Soviet aircraft the fallback is the ONLY owner of
      // CanMove — and without CanMove the climb never runs, because the climb
      // lives inside `MovementIntegrator`. The unit would sit on the runway.
      expect(fb!.flags & EntityFlag.CanMove, `${key} cannot move`).not.toBe(0);
      expect(fb!.flags & EntityFlag.CanAttack, `${key} cannot shoot`).not.toBe(0);
    }
  });
});

/* --------------------------------------------------------------------------
 * THE FACTORY DOOR. Found by RUNNING the game, not by reading it.
 * ------------------------------------------------------------------------ */

/**
 * Terrain that answers `isPassable` the way the SHIPPED one does.
 *
 * `World`'s null-object `FlatTerrain` answers `isPassable(cx, cz)` with a
 * two-argument signature that ignores the locomotor entirely and returns true.
 * `world/Terrain.ts` answers `(this.passGrid[i] & (1 << loco)) !== 0` — and
 * nothing has ever set bit 5, so the real map says NO to `Locomotor.Air` in
 * every cell of every match.
 *
 * That gap is the reason the bug below survived: every headless test in this
 * repo runs on the flat null object, which cannot express "this class has no
 * bit". This double can, and it is the minimum needed to reproduce.
 */
function airBlindTerrain(base: ITerrain): ITerrain {
  return {
    heightAt: (x, z) => base.heightAt(x, z),
    normalAt: (x, z, out) => base.normalAt(x, z, out),
    slopeAt: (x, z) => base.slopeAt(x, z),
    // The whole point: bit 5 of `passGrid` is unset, so Air is impassable
    // everywhere, exactly as on a real map.
    isPassable: (cx, cz, loco) => loco !== Locomotor.Air && base.isPassable(cx, cz, loco),
    isBuildable: (cx, cz) => base.isBuildable(cx, cz),
    isOccupied: (cx, cz) => base.isOccupied(cx, cz),
    markOccupied: (cx, cz, w, h, id) => { base.markOccupied(cx, cz, w, h, id); },
    clearOccupied: (cx, cz, w, h) => { base.clearOccupied(cx, cz, w, h); },
    occupancyVersion: () => base.occupancyVersion(),
    isWater: (cx, cz) => base.isWater(cx, cz),
    raycastGround: (ox, oy, oz, dx, dy, dz, out) =>
      base.raycastGround(ox, oy, oz, dx, dy, dz, out),
  };
}

describe('an aircraft can actually leave the factory', () => {
  it('egresses onto a map whose passability grid has no bit for Air', async () => {
    /*
     * THE BUG, IN ONE SENTENCE: `Production.findEgressSpot` asked
     * `terrain.isPassable(cx, cz, Locomotor.Air)`, which is false in every cell
     * of every real map, so it never found a spot and no aircraft ever came out
     * of a factory — in ANY faction, since the day `Locomotor.Air` shipped.
     *
     * What it looked like from the player's side, measured on a live match
     * before the fix: 1200 credits charged, the build bar at 100%, `ready:
     * true` at tick 1377 — and the same item still sitting in the queue at tick
     * 1802, with the Vehicles tab blocked behind it. No error, no warning, no
     * refund. `egressRetry` re-armed every `egressRetrySeconds` forever.
     *
     * Everything ELSE in the air layer worked, which is why the file above
     * could assert an end-to-end feature and be right about every link except
     * the one that hands a player a plane. The gap between "the simulation
     * flies aircraft correctly" and "a player can obtain one" is exactly one
     * function, and only running the game crosses it.
     */
    const world = new World();
    world.terrain = airBlindTerrain(world.terrain);
    world.addPlayer(Faction.Allies, 'Commander', true, true);
    const channels = new Channels();
    const binding = await resolveDefBinding();
    const catalog = new ProductionCatalog(binding);
    const service = new ProductionService(world, channels, catalog);
    const p = 0 as PlayerId;
    world.player(p).credits = 100_000;

    // The Petrel Bomber's whole tech tree, planted by hand: a yard, power, the
    // factory that services the Vehicles tab, and the radar it is gated on.
    const st = world.store;
    const plant = (key: string, x: number, z: number, extraFlags: number): void => {
      const e = catalog.byKey(key)!;
      const h = st.alloc(EntityKind.Building, e.defId, p, Faction.Allies, x, 0, z, 0);
      const i = st.index(h);
      st.flags[i] |= extraFlags | EntityFlag.BlocksNav;
      st.footprintW[i] = e.footprintW;
      st.footprintH[i] = e.footprintH;
      st.hp[i] = 1000; st.maxHp[i] = 1000;
      st.powerDraw[i] = e.power;
      st.buildProgress[i] = 1;
    };
    plant('conyard', 160, 200, EntityFlag.IsBuilder | EntityFlag.IsFactory);
    plant('powerPlant', 180, 200, 0);
    plant('warFactory', 200, 200, EntityFlag.IsFactory);
    plant('radar', 220, 200, EntityFlag.IsRadar);
    world.player(p).powerProduced = 500;

    const rng = new Rng(17);
    let tick = 0;
    const run = (n: number): void => {
      for (let k = 0; k < n; k++) {
        tick++;
        world.tick = tick;
        world.time = tick * SIM_DT;
        service.tick({ dt: SIM_DT, tick, time: world.time, rng });
        world.spatial.rebuild();
      }
    };
    run(2);

    const vind = catalog.byKey('vindicator')!;
    // Asserted before the order, so "no aircraft came out" cannot secretly mean
    // "the sidebar would have greyed the cameo anyway".
    expect(service.availability(p, vind.publicId).ok, 'not buildable in this rig').toBe(true);
    service.enqueue(p, vind.publicId);
    // Twice the build time, so "still queued" cannot mean "still building".
    run(Math.ceil(vind.buildTime / SIM_DT) * 2 + 60);

    let built = 0;
    for (let a = 0; a < st.aliveCount; a++) {
      const i = st.alive[a];
      if (st.kind[i] === EntityKind.Vehicle && st.defId[i] === vind.defId) built++;
    }
    const queued = world.player(p).queues[BuildTab.Vehicles].items.length;
    expect(built, 'the aircraft never left the factory').toBe(1);
    expect(queued, 'the queue is still holding a finished aircraft').toBe(0);
  });

  it('still refuses to hand a GROUND unit a spot the grid closed', () => {
    // The fix is a branch on `Locomotor.Air`, so the ground path has to be
    // shown intact — otherwise "it egresses now" could mean "the egress rule
    // stopped being a rule", which would put tanks inside cliffs.
    const world = new World();
    const base = world.terrain;
    world.terrain = {
      ...airBlindTerrain(base),
      isPassable: () => false,          // nowhere at all is passable
    };
    world.addPlayer(Faction.Allies, 'Commander', true, true);
    const channels = new Channels();
    const catalog = new ProductionCatalog({ tables: null, unitId: {}, buildingId: {} });
    const service = new ProductionService(world, channels, catalog);
    const p = 0 as PlayerId;
    world.player(p).credits = 100_000;

    const st = world.store;
    const wf = catalog.byKey('warFactory')!;
    const h = st.alloc(EntityKind.Building, wf.defId, p, Faction.Allies, 200, 0, 200, 0);
    const bi = st.index(h);
    st.flags[bi] |= EntityFlag.IsFactory | EntityFlag.BlocksNav;
    st.footprintW[bi] = wf.footprintW;
    st.footprintH[bi] = wf.footprintH;
    st.hp[bi] = 1000; st.maxHp[bi] = 1000;
    st.buildProgress[bi] = 1;

    const rng = new Rng(19);
    let tick = 0;
    const run = (n: number): void => {
      for (let k = 0; k < n; k++) {
        tick++;
        world.tick = tick;
        world.time = tick * SIM_DT;
        service.tick({ dt: SIM_DT, tick, time: world.time, rng });
        world.spatial.rebuild();
      }
    };
    run(2);

    const grizzly = catalog.byKey('grizzly')!;
    service.enqueue(p, grizzly.publicId);
    run(Math.ceil(grizzly.buildTime / SIM_DT) * 2 + 60);

    let built = 0;
    for (let a = 0; a < st.aliveCount; a++) {
      const i = st.alive[a];
      if (st.kind[i] === EntityKind.Vehicle) built++;
    }
    expect(built, 'a tank egressed onto ground the grid closed').toBe(0);
  });
});

describe('an aircraft with nothing to do', () => {
  it('loiters at cruise altitude and never lands, because there is nowhere to', () => {
    // THE DESIGN DECISION, ASSERTED. This game has no airfield, no rearm and
    // no fuel; `Movement` holds `MoveClass.Air` at `ground + AIR_CRUISE_ALTITUDE`
    // unconditionally, every tick, order or no order. So an idle aircraft holds
    // station — it does not return to a pad, and a pad would have nothing to do.
    // The cost of that is real and is the point: an idle aircraft is a thing
    // two thirds of the army cannot shoot which is also achieving nothing.
    const rig = makeFlightRig();
    const i = spawnMover(rig, 180, 180, Locomotor.Air);
    rig.step(SIM_HZ * 4);
    const st = rig.world.store;

    let lowest = Infinity;
    for (let k = 0; k < SIM_HZ * 30; k++) {
      rig.step(1);
      const ground = rig.world.terrain.heightAt(st.posX[i], st.posZ[i]);
      lowest = Math.min(lowest, st.posY[i] - ground);
    }
    expect(lowest).toBeCloseTo(AIR_CRUISE_ALTITUDE, 1);
    // Holding station, not orbiting: nothing here makes it drift off its spot.
    expect(st.speed[i]).toBe(0);
    expect(st.posX[i]).toBeCloseTo(180, 4);
    expect(st.posZ[i]).toBeCloseTo(180, 4);
  });

  it('shares no space — two of them stack, two tanks do not', () => {
    // `Steering` and `Movement` both skip `MoveClass.Air` in the separation
    // pass ("aircraft share no space"). The consequence a player sees is that
    // four gunships over one target is legal and there is no air traffic; the
    // consequence a test can see is that co-located aircraft stay co-located.
    // 0.4 m apart, not zero: `relax` skips an EXACT overlap (`d2 < 1e-9` has no
    // push direction), so a zero-distance pair would prove nothing about either
    // class. Both radii are 2, so 0.4 is deep inside the 4 m they each want.
    const START = 0.4;
    const air = makeFlightRig();
    const a0 = spawnMover(air, 200, 200, Locomotor.Air);
    const a1 = spawnMover(air, 200 + START, 200, Locomotor.Air);
    air.step(SIM_HZ * 2);
    const ast = air.world.store;
    const airGap = Math.hypot(ast.posX[a0] - ast.posX[a1], ast.posZ[a0] - ast.posZ[a1]);

    const ground = makeFlightRig();
    const g0 = spawnMover(ground, 200, 200, Locomotor.Track);
    const g1 = spawnMover(ground, 200 + START, 200, Locomotor.Track);
    ground.step(SIM_HZ * 2);
    const gst = ground.world.store;
    const groundGap = Math.hypot(gst.posX[g0] - gst.posX[g1], gst.posZ[g0] - gst.posZ[g1]);

    expect(airGap, 'the relaxation pass pushed two aircraft apart').toBeCloseTo(START, 4);
    expect(groundGap, 'two tanks in one spot must be separated').toBeGreaterThan(START * 3);
  });
});

/* --------------------------------------------------------------------------
 * Death. The fireball belongs at the altitude it happened; everything that
 * OUTLIVES the fireball is debris, and debris falls.
 * ------------------------------------------------------------------------ */

/** Terrain double: a flat slab at `height`, wet or dry on demand. */
function slabTerrain(base: ITerrain, height: number, water: boolean): ITerrain {
  return {
    heightAt: () => height,
    normalAt: (x, z, out) => base.normalAt(x, z, out),
    slopeAt: (x, z) => base.slopeAt(x, z),
    isPassable: (cx, cz, loco) => base.isPassable(cx, cz, loco),
    isBuildable: (cx, cz) => base.isBuildable(cx, cz),
    isOccupied: (cx, cz) => base.isOccupied(cx, cz),
    markOccupied: (cx, cz, w, h, id) => { base.markOccupied(cx, cz, w, h, id); },
    clearOccupied: (cx, cz, w, h) => { base.clearOccupied(cx, cz, w, h); },
    occupancyVersion: () => base.occupancyVersion(),
    isWater: () => water,
    raycastGround: (ox, oy, oz, dx, dy, dz, out) =>
      base.raycastGround(ox, oy, oz, dx, dy, dz, out),
  };
}

const GROUND_Y = 7;

/** Kill one airborne vehicle over `water`, and hand back what it left behind. */
function killAloft(water: boolean): {
  wreckY: number | null;
  splashY: number | null;
  fireballY: number | null;
} {
  setArmorMatrix(ARMOR_MATRIX);
  const world = new World();
  world.terrain = slabTerrain(world.terrain, GROUND_Y, water);
  const channels = new Channels();
  world.addPlayer(Faction.Allies, 'A', true, true);
  const damage = new DamageSystem(world, channels);

  const st = world.store;
  const h = st.alloc(
    EntityKind.Vehicle, -1, P0, Faction.Allies,
    300, GROUND_Y + AIR_CRUISE_ALTITUDE, 300, 0,
  );
  const i = st.index(h);
  st.maxHp[i] = 100; st.hp[i] = 100;
  st.armorClass[i] = ArmorClass.Light;
  st.radius[i] = 2;
  st.locomotor[i] = Locomotor.Air;
  st.flags[i] |= EntityFlag.CanMove;

  const s: SimContext = { dt: SIM_DT, tick: 1, time: SIM_DT, rng: new Rng(3) };
  world.tick = 1;
  st.snapshotPrev();
  channels.damage.push(h, h, 500, WarheadClass.AutoCannon, 300, GROUND_Y, 300);
  damage.damageTick(s);
  damage.cleanupTick(s);

  let splashY: number | null = null;
  let fireballY: number | null = null;
  for (let k = 0; k < channels.fx.count; k++) {
    if (channels.fx.kind[k] === (FxKind.Splash as number)) splashY = channels.fx.y[k];
    if (channels.fx.kind[k] === (FxKind.ExplosionMedium as number)) fireballY = channels.fx.y[k];
  }

  let wreckY: number | null = null;
  const n = st.byKindCount[EntityKind.Wreck];
  if (n > 0) wreckY = st.posY[st.byKind[EntityKind.Wreck][0]];

  return { wreckY, splashY, fireballY };
}

describe('an aircraft that dies at altitude', () => {
  it('drops its hulk to the ground instead of hanging it in the sky', () => {
    // The bug this replaces was reachable by the Kestrel and the Hornet from
    // the day `Locomotor.Air` shipped: `Damage.spawnWreck` took the victim's
    // `posY` straight through, so a downed gunship left a BURNING HULK sitting
    // at 22 m for the full `wreckSeconds` and nothing was looking at it.
    const { wreckY, fireballY } = killAloft(false);
    expect(wreckY, 'an aircraft over dry land must leave a hulk').not.toBeNull();
    expect(wreckY!).toBeCloseTo(GROUND_Y, 4);
    // And the fireball stays where the aircraft was. The two are different
    // events and collapsing them either way looks wrong: an explosion on the
    // deck under an intact-looking plane, or a wreck in the air.
    expect(fireballY, 'no fireball at all').not.toBeNull();
    expect(fireballY!).toBeGreaterThan(GROUND_Y + AIR_CRUISE_ALTITUDE * 0.9);
  });

  it('sinks over water, and splashes at the surface rather than at altitude', () => {
    // Same rule the Corvette and the Slag Scow already follow — `vehicleDeath`
    // asks `terrain.isWater(cell)`, never the height — with the one difference
    // that an aircraft's fall is 22 m longer. No hulk on the waves.
    const { wreckY, splashY } = killAloft(true);
    expect(wreckY, 'a hulk floating on the sea').toBeNull();
    expect(splashY, 'no splash').not.toBeNull();
    expect(splashY!).toBeLessThan(GROUND_Y + AIR_CRUISE_ALTITUDE * 0.5);
  });

  it('leaves a ground vehicle exactly where it was, so the fix is scoped', () => {
    // The branch reads `Locomotor.Air`, not an altitude threshold, for the
    // reason `Combat.isAirborne` does: a tank cresting a ridge must never fall
    // down it. Proven by driving the same rig with a Track locomotor.
    setArmorMatrix(ARMOR_MATRIX);
    const world = new World();
    world.terrain = slabTerrain(world.terrain, GROUND_Y, false);
    const channels = new Channels();
    world.addPlayer(Faction.Allies, 'A', true, true);
    const damage = new DamageSystem(world, channels);
    const st = world.store;
    // Deliberately parked ABOVE its own ground height — a hull on a bridge, a
    // hull the terrain moved under. The wreck must land where the hull was.
    const h = st.alloc(EntityKind.Vehicle, -1, P0, Faction.Allies, 300, GROUND_Y + 3, 300, 0);
    const i = st.index(h);
    st.maxHp[i] = 100; st.hp[i] = 100;
    st.armorClass[i] = ArmorClass.Medium;
    st.radius[i] = 2;
    st.locomotor[i] = Locomotor.Track;

    const s: SimContext = { dt: SIM_DT, tick: 1, time: SIM_DT, rng: new Rng(5) };
    world.tick = 1;
    st.snapshotPrev();
    channels.damage.push(h, h, 500, WarheadClass.AutoCannon, 300, GROUND_Y + 3, 300);
    damage.damageTick(s);
    damage.cleanupTick(s);

    expect(st.byKindCount[EntityKind.Wreck]).toBe(1);
    expect(st.posY[st.byKind[EntityKind.Wreck][0]]).toBeCloseTo(GROUND_Y + 3, 4);
  });
});

/* ========================================================================== */

/**
 * A BLAST ON THE GROUND DOES NOT REACH AN AIRCRAFT 22 M ABOVE IT.
 *
 * Reported as "3 airplanes destroyed by 1 tank in a second". `applySplash` took
 * a `y` parameter and read it for nothing but the crater decal: the candidate
 * query was `queryCircleFat(x, z, ...)` and the acceptance test was
 * `sqrt(dx*dx + dz*dz)`, both purely horizontal. Its victim loop filters on
 * Alive, PendingDestroy and Garrisoned and asks nothing else — there is no
 * airborne test and no `canTargetAir` test anywhere in it.
 *
 * So every splash weapon in the game hit aircraft at FULL effect, including the
 * ones whose entire doctrine is that they cannot elevate: all three main battle
 * tank cannons carry splash (1.6 / 2.1 / 2.2 m) and not one carries
 * `canTargetAir`. `Combat.ts` gates TARGETING on that flag, and this path never
 * went through targeting — which is also why the aerial sweep recorded in
 * CLAUDE.md could not see it and concluded that nothing single kills an
 * aircraft quickly. A measured claim with a hole exactly the shape of the bug.
 *
 * THE FIX IS DISTANCE, NOT A FLAG, and the two behave differently. A
 * `canTargetAir` gate on splash would delete incidental air damage outright,
 * and CLAUDE.md's anti-hang floor — the rule that stops an enemy reduced to
 * nothing but aircraft from being unkillable — is held up entirely by four
 * line-infantry rifles. Real distance keeps that floor BY CONSTRUCTION, which
 * is what §3 below pins: a weapon that can elevate aims AT the aircraft, so the
 * blast is at its altitude and nothing changes for it.
 */
describe('splash measures the distance it actually is', () => {
  const AP = WarheadClass.ArmorPiercing;

  /** Queue one splash event and resolve it, returning hp lost by `victim`. */
  function blast(
    rig: CombatRig, victim: EntityId, attacker: EntityId,
    x: number, y: number, z: number, radius: number,
  ): number {
    const st = rig.world.store;
    const before = st.hp[st.index(victim)];
    rig.world.spatial.rebuild();
    rig.channels.damage.push(NONE, attacker, 200, AP, x, y, z, radius, 0.3);
    rig.damage.damageTick({ dt: SIM_DT, tick: 1, time: SIM_DT, rng: new Rng(1) });
    const after = st.hp[st.index(victim)];
    rig.channels.damage.clear();
    return before - after;
  }

  it('does not reach an aircraft at cruise altitude from a blast on the ground', () => {
    // THE REPORT. A tank shell landing directly beneath a gunship, with the
    // largest main-battle-tank splash in the game.
    const rig = makeCombatRig();
    const tank = spawnShooter(rig, P0, 0, 0, 0);
    const plane = spawnGunship(rig, P1, 0, 0);
    expect(rig.world.store.posY[rig.world.store.index(plane)])
      .toBeCloseTo(AIR_CRUISE_ALTITUDE, 1);
    expect(blast(rig, plane, tank, 0, 0, 0, 2.2), 'ground blast reached cruise altitude')
      .toBe(0);
  });

  it('still reaches a GROUND unit standing on the blast, unchanged', () => {
    // THE PROPERTY THAT MAKES THIS A FIX AND NOT A STEALTH BALANCE CHANGE, and
    // the REASON given here was wrong for a whole release. This said the
    // vertical term is "guarded on `Locomotor.Air`". It is not, and `Damage.ts`
    // says so in terms: there is no `Locomotor` test anywhere in `applySplash`,
    // and the `Locomotor.Air` version was the REJECTED first attempt, because
    // it failed the mirror case of an AA burst splashing the ground beneath it.
    //
    // What actually keeps ground combat bit-identical is that the term is a
    // DISTANCE: `gap = |dy| - estimatedHeight * 0.5`, folded in only when it is
    // positive. A hull's `posY` is its centre, so a shell landing at a tank's
    // feet is already inside that half-extent and contributes exactly zero. The
    // conclusion below was always true; only this explanation of it was not.
    const rig = makeCombatRig();
    const a = spawnShooter(rig, P0, 0, 0, 0);
    const b = spawnShooter(rig, P1, 0, 0, 0);
    expect(blast(rig, b, a, 0, 0, 0, 2.2)).toBeGreaterThan(0);
  });

  it('still reaches an aircraft when the blast is at its own altitude', () => {
    // THE ANTI-HANG FLOOR, PINNED. A weapon that can elevate puts its blast on
    // the aircraft, so `dy` is ~0 and this change costs it nothing. If this
    // ever fails, incidental air damage has been deleted and an enemy reduced
    // to nothing but aircraft may have become unkillable.
    const rig = makeCombatRig();
    const aa = spawnShooter(rig, P0, 0, 0, 0);
    const plane = spawnGunship(rig, P1, 0, 0);
    expect(blast(rig, plane, aa, 0, AIR_CRUISE_ALTITUDE, 0, 2.2)).toBeGreaterThan(0);
  });

  it('does not splash the ground from a burst fired at an aircraft', () => {
    // The mirror image, which nobody reported and which the same arithmetic
    // fixes: an anti-air burst used to damage whatever was standing under its
    // target.
    const rig = makeCombatRig();
    const aa = spawnShooter(rig, P0, 0, 0, 0);
    const grunt = spawnShooter(rig, P1, 0, 0, 0);
    expect(blast(rig, grunt, aa, 0, AIR_CRUISE_ALTITUDE, 0, 2.2)).toBe(0);
  });

  it('is horizontal again between two aircraft at the same altitude', () => {
    // Two gunships side by side are as splashable as two tanks. The vertical
    // term must not make aircraft immune to each other or to real AA splash.
    const rig = makeCombatRig();
    const aa = spawnShooter(rig, P0, 40, 40, 0);
    const a = spawnGunship(rig, P1, 0, 0);
    const b = spawnGunship(rig, P1, 1.5, 0);
    expect(blast(rig, b, aa, 0, AIR_CRUISE_ALTITUDE, 0, 4)).toBeGreaterThan(0);
    void a;
  });
});

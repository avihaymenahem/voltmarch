/**
 * FOUR STANCES, FOUR BEHAVIOURS — and the guard point that finally means
 * something.
 *
 * `Stance` has always had four members with four distinct docstrings, and two
 * of them described the same code path. Measured on the commit before this
 * file, with an enemy 34 m from a 24 m gun, over ten seconds of simulation:
 *
 *     Aggressive  moved 0.00 m   no target acquired
 *     Defensive   moved 0.00 m   no target acquired
 *     HoldFire    moved 0.00 m   no target acquired
 *     HoldGround  moved 0.00 m   no target acquired
 *
 * and with the enemy at 26 m — inside the acquire radius, outside the gun —
 * all four still moved 0.00 m while three of them held a target they could not
 * shoot. `GUARD_LEASH` was read nowhere. `guardX/guardZ` were written by six
 * modules and read for behaviour by none. `OrderKind.Guard` did not even drive
 * a unit to the point it was told to guard.
 *
 * Everything here is pure simulation — flow field, steering blend, integrator,
 * targeting, weapons, projectiles and damage — with no GL, no THREE and no DOM.
 * The phases run in the order `core/loop.ts` gives them: PathRequest 500,
 * Steering 600, Movement 700, SpatialRebuild 800, Targeting 900, Weapons 1000,
 * Projectiles 1100, Damage 1200.
 *
 * EVERY SCENARIO IS BUILT AROUND THE MAP CENTRE, not the origin. `Movement`
 * clamps a hull inside the map, so a unit spawned at (0,0) is shoved 2.4 m to
 * (radius, radius) the first tick anything drives it — which reads as stance
 * behaviour and is not.
 */

import { describe, expect, it } from 'vitest';

import { World } from '../src/core/world';
import { Channels } from '../src/core/events';
import { Rng } from '../src/core/math';
import {
  ArmorClass, EntityFlag, EntityKind, Faction, Locomotor, OrderKind, Stance, UnitState,
} from '../src/core/types';
import type { PlayerId, SimContext } from '../src/core/types';
import {
  ARMOR_MATRIX, CELL, GUARD_LEASH, MAP_CELLS, SIM_DT,
  STANCE_CHASE_METRES, STANCE_RETURNS,
} from '../src/core/config';

import { FlowFieldCache, MoveClass } from '../src/sim/Flowfield';
import { NavAgents, NavAssigner, SteeringSolver } from '../src/sim/Steering';
import { MovementIntegrator, setMoveClass } from '../src/sim/Movement';
import { DamageSystem, setArmorMatrix } from '../src/sim/Damage';
import { ProjectileSystem } from '../src/sim/Projectiles';
import {
  WeaponSystem, setContentWeaponMap, setWeaponKeyResolver, setWeaponTable, weaponIndexOf,
} from '../src/sim/Combat';
import { TargetingSystem } from '../src/sim/Targeting';
import { ProductionCatalog, ProductionService } from '../src/sim/Production';
import type { BuildEntry } from '../src/sim/Production';
import { DEF_TABLES } from '../src/data/Defs';
import { hashOnly } from '../src/game/Checksum';

const P0 = 0 as PlayerId;
const P1 = 1 as PlayerId;

/** Map centre. Everything below is expressed as an offset from here. */
const MID = MAP_CELLS * CELL * 0.5;

/** The gun every unit in this file carries. 24 m of range, so 34 m is past it. */
const GUN = 'lightCannon';
const GUN_RANGE = 24;

interface Rig {
  world: World;
  targeting: TargetingSystem;
  production: ProductionService;
  step(n?: number): void;
  unit(key: string, player: PlayerId, dx: number, dz: number): number;
}

function makeRig(seed = 7): Rig {
  setContentWeaponMap({});
  setWeaponKeyResolver(null);
  setWeaponTable(DEF_TABLES.weapons);
  setArmorMatrix(ARMOR_MATRIX);

  const world = new World();
  world.addPlayer(Faction.Allies, 'A', true, true);
  world.addPlayer(Faction.Soviets, 'B', false, false);
  const channels = new Channels();
  const unitId: Record<string, number> = {};
  DEF_TABLES.unitByKey.forEach((id, key) => { unitId[key] = id; });
  const buildingId: Record<string, number> = {};
  DEF_TABLES.buildingByKey.forEach((id, key) => { buildingId[key] = id; });
  const production = new ProductionService(
    world,
    channels,
    new ProductionCatalog({ tables: DEF_TABLES, unitId, buildingId }),
  );
  production.bindingTables = DEF_TABLES;

  const nav = new FlowFieldCache(world.terrain);
  const agents = new NavAgents();
  const assigner = new NavAssigner(world, nav, agents);
  const steering = new SteeringSolver(world, nav, agents);
  const movement = new MovementIntegrator(world, nav, channels);
  const projectiles = new ProjectileSystem(world, channels);
  const damage = new DamageSystem(world, channels);
  const weapons = new WeaponSystem(world, channels, projectiles);
  const targeting = new TargetingSystem(world, channels, weapons);
  const rng = new Rng(seed);
  let tick = 0;

  return {
    world,
    targeting,
    production,
    step(n = 1): void {
      for (let k = 0; k < n; k++) {
        tick++;
        world.store.snapshotPrev();
        world.tick = tick;
        world.time = tick * SIM_DT;
        const s: SimContext = { dt: SIM_DT, tick, time: tick * SIM_DT, rng };
        assigner.simTick(s);
        steering.simTick(s);
        movement.simTick(s);
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
    unit(key, player, dx, dz): number {
      const entry = production.catalog.byKey(key) as BuildEntry;
      expect(entry, `catalog is missing "${key}"`).not.toBeNull();
      const id = production.spawnUnit(
        world.players[player as number], entry, MID + dx, MID + dz, 0,
      );
      return world.store.index(id);
    },
  };
}

/** A mobile gun tank at (MID + dx, MID + dz). Returns the slot index. */
function spawnTank(rig: Rig, player: PlayerId, dx: number, dz: number, stance: Stance): number {
  const st = rig.world.store;
  const faction = player === P0 ? Faction.Allies : Faction.Soviets;
  const id = st.alloc(EntityKind.Vehicle, -1, player, faction, MID + dx, 0, MID + dz, 0);
  const i = st.index(id);
  st.maxHp[i] = 4000; st.hp[i] = 4000;
  st.armorClass[i] = ArmorClass.Medium;
  st.radius[i] = 1.7;
  st.sight[i] = 60;
  st.maxSpeed[i] = 6;
  st.accel[i] = 8;
  st.turnRate[i] = 2.2;
  st.locomotor[i] = Locomotor.Track;
  st.weaponIndex[i] = weaponIndexOf(GUN);
  st.state[i] = UnitState.Idle;
  st.stance[i] = stance;
  st.flags[i] |= EntityFlag.ProvidesVision | EntityFlag.CanAttack
    | EntityFlag.HasTurret | EntityFlag.CanMove;
  setMoveClass(st, id, MoveClass.Track);
  return i;
}

/** The same combat hull promoted to the air layer for autonomy coverage. */
function spawnAircraft(
  rig: Rig, player: PlayerId, dx: number, dz: number, stance: Stance,
): number {
  const i = spawnTank(rig, player, dx, dz, stance);
  const st = rig.world.store;
  st.locomotor[i] = Locomotor.Air;
  setMoveClass(st, st.handleOf(i), MoveClass.Air);
  return i;
}

/**
 * A target that cannot move and cannot shoot. `hp` is a caller's choice because
 * every measurement here is about where the SHOOTER ends up: a dummy that dies
 * halfway through ends the engagement for the wrong reason, and a dummy that
 * never dies cannot demonstrate the walk home.
 */
function spawnDummy(rig: Rig, player: PlayerId, dx: number, dz: number, hp = 1e9): number {
  const st = rig.world.store;
  const faction = player === P0 ? Faction.Allies : Faction.Soviets;
  const id = st.alloc(EntityKind.Vehicle, -1, player, faction, MID + dx, 0, MID + dz, 0);
  const i = st.index(id);
  st.maxHp[i] = hp; st.hp[i] = hp;
  st.armorClass[i] = ArmorClass.Medium;
  st.radius[i] = 1.7;
  st.sight[i] = 20;
  st.weaponIndex[i] = -1;
  st.locomotor[i] = Locomotor.Static;
  st.state[i] = UnitState.Idle;
  st.stance[i] = Stance.HoldGround;
  st.flags[i] |= EntityFlag.ProvidesVision;
  return i;
}

/** Metres between an entity and a map-centre-relative point. */
function distTo(rig: Rig, i: number, dx: number, dz: number): number {
  const st = rig.world.store;
  const ex = st.posX[i] - (MID + dx), ez = st.posZ[i] - (MID + dz);
  return Math.sqrt(ex * ex + ez * ez);
}

/** Metres between an entity and its own post. */
function distToPost(rig: Rig, i: number): number {
  const st = rig.world.store;
  const ex = st.posX[i] - st.guardX[i], ez = st.posZ[i] - st.guardZ[i];
  return Math.sqrt(ex * ex + ez * ez);
}

/** Metres between two entities. */
function gap(rig: Rig, a: number, b: number): number {
  const st = rig.world.store;
  const ex = st.posX[a] - st.posX[b], ez = st.posZ[a] - st.posZ[b];
  return Math.sqrt(ex * ex + ez * ez);
}

/**
 * The Guard order exactly as `OrderExecutor.write()` applies it. Mirrored
 * rather than imported because `src/input/Commands.ts` needs a whole command
 * bus to reach, and what is under test is what the SIM does with the columns
 * once they are set.
 */
function orderGuard(rig: Rig, i: number, dx: number, dz: number): void {
  const st = rig.world.store;
  st.orderKind[i] = OrderKind.Guard;
  st.orderTarget[i] = 0;
  st.orderX[i] = MID + dx;
  st.orderZ[i] = MID + dz;
  st.guardX[i] = MID + dx;
  st.guardZ[i] = MID + dz;
  st.state[i] = UnitState.Guarding;
}

/* ==========================================================================
 * 1. THE FOUR STANCES ARE FOUR BEHAVIOURS
 *
 * One scenario, four stances, four answers. The shooter starts at the centre
 * with a 24 m gun; the enemy sits 34 m away — ten metres past the muzzle, well
 * inside the 18 m leash. Every row of this table used to read 0.00 m.
 * ========================================================================== */

describe('the four stances produce four behaviours', () => {
  function run(stance: Stance, enemyZ: number, ticks = 300): {
    moved: number; gap: number; hasTarget: boolean;
  } {
    const rig = makeRig();
    const tank = spawnTank(rig, P0, 0, 0, stance);
    const foe = spawnDummy(rig, P1, 0, enemyZ);
    rig.step(ticks);
    return {
      moved: distTo(rig, tank, 0, 0),
      gap: gap(rig, tank, foe),
      hasTarget: rig.world.store.targetId[tank] !== 0,
    };
  }

  it('Aggressive closes on an enemy that is past its gun', () => {
    const r = run(Stance.Aggressive, 34);
    expect(r.moved, 'an aggressive unit chases').toBeGreaterThan(8);
    expect(r.gap, 'and stops inside its own range').toBeLessThan(GUN_RANGE);
    expect(r.gap, 'without driving onto the target').toBeGreaterThan(4);
  });

  it('Defensive holds position for the same enemy', () => {
    expect(run(Stance.Defensive, 34).moved).toBeLessThan(0.5);
  });

  it('HoldGround holds position for the same enemy', () => {
    expect(run(Stance.HoldGround, 34).moved).toBeLessThan(0.5);
  });

  it('HoldFire holds position and never acquires', () => {
    const r = run(Stance.HoldFire, 34);
    expect(r.moved).toBeLessThan(0.5);
    expect(r.hasTarget).toBe(false);
  });

  it('Aggressive and Defensive are not the same code path', () => {
    const a = run(Stance.Aggressive, 34);
    const d = run(Stance.Defensive, 34);
    expect(a.moved - d.moved, 'the whole point of the stance system')
      .toBeGreaterThan(8);
  });

  it('Aggressive steps out even for a target just past the muzzle', () => {
    // 26 m: inside the 1.08x acquire radius, outside the 24 m gun. Before this
    // change the unit held a target it could not shoot and never moved.
    const a = run(Stance.Aggressive, 26);
    expect(a.moved).toBeGreaterThan(3);
    expect(run(Stance.Defensive, 26).moved).toBeLessThan(0.5);
  });

  it('nobody fires under HoldFire', () => {
    const rig = makeRig();
    spawnTank(rig, P0, 0, 0, Stance.HoldFire);
    const foe = spawnDummy(rig, P1, 0, 12); // well inside range
    const hp = rig.world.store.hp[foe];
    rig.step(300);
    expect(rig.world.store.hp[foe]).toBe(hp);
  });

  it('the other three do fire when the enemy is in range', () => {
    for (const stance of [Stance.Aggressive, Stance.Defensive, Stance.HoldGround]) {
      const rig = makeRig();
      spawnTank(rig, P0, 0, 0, stance);
      const foe = spawnDummy(rig, P1, 0, 12);
      const hp = rig.world.store.hp[foe];
      rig.step(300);
      expect(rig.world.store.hp[foe], `stance ${stance} must shoot`).toBeLessThan(hp);
    }
  });
});

/* ==========================================================================
 * 2. GUARD_LEASH IS READ, AND IT BOUNDS THE EXCURSION
 * ========================================================================== */

describe('the chase is bounded by the leash', () => {
  it('ignores a target further from the post than the envelope allows', () => {
    const rig = makeRig();
    const tank = spawnTank(rig, P0, 0, 0, Stance.Aggressive);
    // The envelope is `GUARD_LEASH + range * APPROACH_STOP_FRAC` = 37.2 m.
    spawnDummy(rig, P1, 0, 50);
    rig.step(300);
    expect(distTo(rig, tank, 0, 0)).toBeLessThan(0.5);
  });

  it('never ends up further from its post than the envelope', () => {
    const rig = makeRig();
    const tank = spawnTank(rig, P0, 0, 0, Stance.Aggressive);
    // A column of enemies marching away from the post, each dying in turn, is
    // the classic "walk the whole army off the map, one kill at a time" case.
    for (let k = 0; k < 8; k++) spawnDummy(rig, P1, 0, 20 + k * 10, 40);
    rig.step(1800);
    expect(distToPost(rig, tank), 'the leash is a hard bound')
      .toBeLessThanOrEqual(GUARD_LEASH + 1);
  });

  it('comes home when there is nothing left to fight', () => {
    const rig = makeRig();
    const tank = spawnTank(rig, P0, 0, 0, Stance.Aggressive);
    const st = rig.world.store;
    const foe = spawnDummy(rig, P1, 0, 30, 60);

    rig.step(150);
    expect(distTo(rig, tank, 0, 0), 'it left the post to engage').toBeGreaterThan(4);

    rig.step(600);
    expect((st.flags[foe] & EntityFlag.Alive) === 0 || st.hp[foe] <= 0,
      'the dummy should be dead by now').toBe(true);
    expect(distTo(rig, tank, 0, 0), 'and it walked back').toBeLessThan(3.5);
    expect(st.state[tank], 'and dropped back to idle').toBe(UnitState.Idle);
  });
});

/* ==========================================================================
 * 3. THE GUARD ORDER
 * ========================================================================== */

describe('OrderKind.Guard travels to a point and holds it', () => {
  it('drives to the guard point', () => {
    const rig = makeRig();
    const tank = spawnTank(rig, P0, 0, 0, Stance.Aggressive);
    orderGuard(rig, tank, 0, 30);
    rig.step(300);
    expect(distTo(rig, tank, 0, 30), 'a guard order is a destination too')
      .toBeLessThan(3);
  });

  it('keeps its weapon cold until it reaches the guard point', () => {
    const rig = makeRig();
    const tank = spawnTank(rig, P0, 0, 0, Stance.Aggressive);
    const foe = spawnDummy(rig, P1, 0, 18, 4000);
    orderGuard(rig, tank, 0, 30);

    rig.step(30);
    expect(rig.world.store.hp[foe], 'Guard travel is not Attack Move').toBe(4000);

    rig.step(300);
    expect(distTo(rig, tank, 0, 30)).toBeLessThan(3);
    expect(rig.world.store.hp[foe], 'the weapon becomes hot at the post').toBeLessThan(4000);
  });

  it('is a hard hold command even when the unit stance is Aggressive', () => {
    const rig = makeRig();
    const tank = spawnTank(rig, P0, 0, 0, Stance.Aggressive);
    const st = rig.world.store;
    orderGuard(rig, tank, 0, 0);

    spawnDummy(rig, P1, 0, 30, 60);
    rig.step(600);
    expect(distTo(rig, tank, 0, 0), 'Guard means hold this exact post')
      .toBeLessThan(0.5);
    expect(st.orderKind[tank]).toBe(OrderKind.Guard);
    expect(st.state[tank]).toBe(UnitState.Guarding);
    expect(st.guardX[tank]).toBeCloseTo(MID, 3);
    expect(st.guardZ[tank]).toBeCloseTo(MID, 3);
  });

  it('still fires from the guarded point when an enemy enters weapon range', () => {
    const rig = makeRig();
    const tank = spawnTank(rig, P0, 0, 0, Stance.Aggressive);
    const st = rig.world.store;
    orderGuard(rig, tank, 0, 0);
    const foe = spawnDummy(rig, P1, 0, 18, 4000);

    rig.step(300);
    expect(distTo(rig, tank, 0, 0)).toBeLessThan(0.5);
    expect(st.hp[foe], 'a hard hold is not HoldFire').toBeLessThan(4000);
  });

  it('a HoldGround unit under a guard order does not move at all', () => {
    const rig = makeRig();
    const tank = spawnTank(rig, P0, 0, 0, Stance.HoldGround);
    orderGuard(rig, tank, 0, 30);
    rig.step(300);
    expect(distTo(rig, tank, 0, 0), '"never move for any reason" is literal')
      .toBeLessThan(0.5);
  });

  it('a Defensive unit walks back to a guard point it was pushed off', () => {
    const rig = makeRig();
    const tank = spawnTank(rig, P0, 0, 0, Stance.Defensive);
    orderGuard(rig, tank, 0, 0);
    rig.step(10);
    // A neighbour's separation force, a scatter or a nav pocket rescue all do
    // this for real; here it is done directly so the measurement is exact.
    const st = rig.world.store;
    st.posX[tank] = MID + 14; st.posZ[tank] = MID + 6;
    rig.step(400);
    expect(distTo(rig, tank, 0, 0), 'defensive returns to where it belongs')
      .toBeLessThan(3.5);
  });

  it('a HoldGround unit pushed off its guard point stays where it landed', () => {
    const rig = makeRig();
    const tank = spawnTank(rig, P0, 0, 0, Stance.HoldGround);
    orderGuard(rig, tank, 0, 0);
    rig.step(10);
    const st = rig.world.store;
    st.posX[tank] = MID + 14; st.posZ[tank] = MID + 6;
    rig.step(400);
    expect(distTo(rig, tank, 14, 6), 'hold ground never walks').toBeLessThan(0.5);
  });
});

describe('aircraft autonomous attack runs', () => {
  it('a shipped Defensive aircraft automatically prioritises an enemy aircraft in sight', () => {
    const rig = makeRig();
    const petrel = rig.unit('vindicator', P0, 0, 0);
    rig.unit('rhino', P1, 0, 10); // legal and closer ground distraction
    const interceptor = rig.unit('mig', P1, 0, 18);
    const st = rig.world.store;

    expect(st.stance[petrel]).toBe(Stance.Defensive);
    expect(st.orderKind[petrel]).toBe(OrderKind.None);
    rig.step(8);

    expect(st.targetId[petrel], 'Defensive aircraft acquires without a manual order')
      .toBe(st.handleOf(interceptor) as number);
  });

  it('a shipped dedicated AA troop chooses aircraft over a nearer ground unit', () => {
    const rig = makeRig();
    const flak = rig.unit('flakTrooper', P0, 0, 0);
    rig.unit('gi', P1, 0, 8); // closer and armed, but not the AA troop's first job
    const interceptor = rig.unit('mig', P1, 0, 15);
    const st = rig.world.store;

    rig.step(8);

    expect(st.targetId[flak]).toBe(st.handleOf(interceptor) as number);
  });

  it('a Defensive aircraft initiates, closes and keeps attacking on its own', () => {
    const rig = makeRig();
    const aircraft = spawnAircraft(rig, P0, 0, 0, Stance.Defensive);
    const foe = spawnDummy(rig, P1, 0, 34, 4000);
    const st = rig.world.store;

    rig.step(600);

    expect(distTo(rig, aircraft, 0, 0), 'the patrol found and approached the target')
      .toBeGreaterThan(6);
    expect(gap(rig, aircraft, foe), 'it completed an attack run without a manual Attack order')
      .toBeLessThan(GUN_RANGE);
    expect(st.hp[foe], 'the lock produced more than a fly-by visual').toBeLessThan(4000);
  });

  it('a Guard order also pins an aircraft instead of starting a patrol', () => {
    const rig = makeRig();
    const aircraft = spawnAircraft(rig, P0, 0, 0, Stance.Defensive);
    orderGuard(rig, aircraft, 0, 0);
    spawnDummy(rig, P1, 0, 34, 4000);

    rig.step(600);
    expect(distTo(rig, aircraft, 0, 0)).toBeLessThan(0.5);
  });
});

describe('movement order weapon discipline', () => {
  function run(state: UnitState, order: OrderKind): number {
    const rig = makeRig();
    const tank = spawnTank(rig, P0, 0, 0, Stance.Aggressive);
    const foe = spawnDummy(rig, P1, 0, 18, 4000);
    const st = rig.world.store;
    st.state[tank] = state;
    st.orderKind[tank] = order;
    st.orderX[tank] = MID + 30;
    st.orderZ[tank] = MID;
    rig.step(60);
    return st.hp[foe];
  }

  it('a plain Move stays weapons-cold', () => {
    expect(run(UnitState.Moving, OrderKind.Move)).toBe(4000);
  });

  it('Attack Move remains the explicit move-and-fire order', () => {
    expect(run(UnitState.AttackMoving, OrderKind.AttackMove)).toBeLessThan(4000);
  });
});

/* ==========================================================================
 * 4. THE PLAYER'S ORDER ALWAYS WINS
 *
 * There is no order stack: `OrderExecutor.write` overwrites orderX/orderZ and
 * nothing restores them. The return goal therefore lives in guardX/guardZ,
 * which no order consumes, and the excursion is abandoned the instant a player
 * order moves the unit out of `Guarding`. Command is phase 100 and Targeting
 * is phase 900, so that happens inside the same tick.
 * ========================================================================== */

describe('an auto-engagement never destroys a player order', () => {
  it('a move order issued mid-chase is obeyed, and its goal is not rewritten', () => {
    const rig = makeRig();
    const tank = spawnTank(rig, P0, 0, 0, Stance.Aggressive);
    const st = rig.world.store;
    spawnDummy(rig, P1, 0, 30);

    rig.step(60);
    expect(distTo(rig, tank, 0, 0), 'chasing').toBeGreaterThan(2);

    // The player right-clicks somewhere else entirely.
    st.orderKind[tank] = OrderKind.Move;
    st.orderTarget[tank] = 0;
    st.orderX[tank] = MID - 60; st.orderZ[tank] = MID;
    st.state[tank] = UnitState.Moving;

    rig.step(600);
    expect(distTo(rig, tank, -60, 0), 'the move order is honoured').toBeLessThan(4);
  });

  it('the post follows a completed move order, so "home" is where you left it', () => {
    const rig = makeRig();
    const tank = spawnTank(rig, P0, 0, 0, Stance.Aggressive);
    const st = rig.world.store;
    st.orderKind[tank] = OrderKind.Move;
    st.orderX[tank] = MID; st.orderZ[tank] = MID + 60;
    st.state[tank] = UnitState.Moving;
    rig.step(500);

    expect(distTo(rig, tank, 0, 60), 'arrived').toBeLessThan(4);
    expect(distToPost(rig, tank),
      'the post is where the order ended, not where the unit spawned')
      .toBeLessThan(1);
  });

  it('an explicit attack order still closes, from beyond any leash', () => {
    const rig = makeRig();
    const tank = spawnTank(rig, P0, 0, 0, Stance.Aggressive);
    const st = rig.world.store;
    const foe = spawnDummy(rig, P1, 0, 120);
    st.orderKind[tank] = OrderKind.Attack;
    st.orderTarget[tank] = st.handleOf(foe) as number;
    st.orderX[tank] = st.posX[foe]; st.orderZ[tank] = st.posZ[foe];
    st.state[tank] = UnitState.Attacking;

    rig.step(1200);
    expect(gap(rig, tank, foe), 'the leash never applies to an ORDER')
      .toBeLessThan(GUN_RANGE);
  });

  it('a HoldGround unit still refuses to close on an ordered target', () => {
    const rig = makeRig();
    const tank = spawnTank(rig, P0, 0, 0, Stance.HoldGround);
    const st = rig.world.store;
    const foe = spawnDummy(rig, P1, 0, 60);
    st.orderKind[tank] = OrderKind.Attack;
    st.orderTarget[tank] = st.handleOf(foe) as number;
    st.orderX[tank] = st.posX[foe]; st.orderZ[tank] = st.posZ[foe];
    st.state[tank] = UnitState.Attacking;

    rig.step(600);
    expect(distTo(rig, tank, 0, 0)).toBeLessThan(0.5);
  });
});

/* ==========================================================================
 * 5. THE TABLES ARE COMPLETE
 *
 * A fifth stance without a row here is a unit that silently reads 0 / false.
 * ========================================================================== */

describe('the stance tables cover every stance', () => {
  it('has one chase distance per stance, and only Aggressive chases', () => {
    expect(STANCE_CHASE_METRES.length).toBe(4);
    expect(STANCE_CHASE_METRES[Stance.Aggressive]).toBe(GUARD_LEASH);
    expect(STANCE_CHASE_METRES[Stance.Defensive]).toBe(0);
    expect(STANCE_CHASE_METRES[Stance.HoldFire]).toBe(0);
    expect(STANCE_CHASE_METRES[Stance.HoldGround]).toBe(0);
  });

  it('has one return policy per stance, and only HoldGround refuses', () => {
    expect(STANCE_RETURNS.length).toBe(4);
    expect(STANCE_RETURNS[Stance.Aggressive]).toBe(true);
    expect(STANCE_RETURNS[Stance.Defensive]).toBe(true);
    expect(STANCE_RETURNS[Stance.HoldFire]).toBe(true);
    expect(STANCE_RETURNS[Stance.HoldGround]).toBe(false);
  });
});

/* ==========================================================================
 * 6. THE DESYNC DETECTOR CAN SEE ALL OF THIS
 *
 * `guardX/guardZ` and `stance` were both unhashed while nothing read them for
 * behaviour, which was defensible. Now they decide whether a unit leaves its
 * post at all, so two clients disagreeing about either is a divergence — and an
 * unhashed divergence is one nobody finds until the units are metres apart.
 * ========================================================================== */

describe('the post and the stance are in the checksum', () => {
  it('notices a moved post', () => {
    const rig = makeRig();
    const tank = spawnTank(rig, P0, 0, 0, Stance.Aggressive);
    const before = hashOnly(rig.world);
    rig.world.store.guardX[tank] += 5;
    expect(hashOnly(rig.world)).not.toBe(before);
    rig.world.store.guardX[tank] -= 5;
    expect(hashOnly(rig.world)).toBe(before);
    rig.world.store.guardZ[tank] += 5;
    expect(hashOnly(rig.world)).not.toBe(before);
  });

  it('notices a changed stance', () => {
    const rig = makeRig();
    const tank = spawnTank(rig, P0, 0, 0, Stance.Aggressive);
    const before = hashOnly(rig.world);
    rig.world.store.stance[tank] = Stance.HoldGround;
    expect(hashOnly(rig.world)).not.toBe(before);
  });

  it('still notices everything it noticed before', () => {
    const rig = makeRig();
    const tank = spawnTank(rig, P0, 0, 0, Stance.Aggressive);
    const st = rig.world.store;
    const before = hashOnly(rig.world);
    st.state[tank] = UnitState.Moving;
    expect(hashOnly(rig.world)).not.toBe(before);
    st.state[tank] = UnitState.Idle;
    st.orderKind[tank] = OrderKind.Guard;
    expect(hashOnly(rig.world)).not.toBe(before);
  });
});

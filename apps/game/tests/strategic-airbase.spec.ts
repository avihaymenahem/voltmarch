import { afterEach, describe, expect, it } from 'vitest';

import { Channels } from '../src/core/events';
import { Rng } from '../src/core/math';
import { World } from '../src/core/world';
import {
  ArmorClass, EntityFlag, EntityKind, Faction, Locomotor, OrderKind, ProjectileKind,
  Stance, UnitState,
} from '../src/core/types';
import type { EntityId, PlayerId, SimContext } from '../src/core/types';
import { NAV_ARRIVE_SLACK, SIM_DT } from '../src/core/config';
import { WEAPONS } from '../src/data/Defs';
import {
  BomberSortieState, BomberSortieSystem, BOMBER_REARM_TICKS, BOMBER_TOUCHDOWN_HEIGHT,
  bomberBayPosition,
  dockNewBomber, sortieHasBomb, sortieSlot, sortieState,
} from '../src/sim/BomberSortie';
import { DEFAULT_WEAPONS, WeaponSystem, setWeaponTable } from '../src/sim/Combat';
import { ProjectileSystem } from '../src/sim/Projectiles';
import { TargetingSystem } from '../src/sim/Targeting';
import { ProductionCatalog } from '../src/sim/Production';
import { MoveClass } from '../src/sim/Flowfield';
import { moveClassOf } from '../src/sim/Movement';

const P0 = 0 as PlayerId;
const AIRBASE_DEF = 77;

function context(tick: number): SimContext {
  return { dt: SIM_DT, tick, time: tick * SIM_DT, rng: new Rng(17) };
}

function rig(): {
  world: World;
  host: EntityId;
  spawnBomber(): EntityId;
} {
  const world = new World();
  world.addPlayer(Faction.Allies, 'Commander', true, true);
  world.addPlayer(Faction.Soviets, 'Opponent', false, false);
  const st = world.store;
  const host = st.alloc(EntityKind.Building, AIRBASE_DEF, P0, Faction.Allies, 120, 0, 120, 0);
  const hi = st.index(host);
  st.buildProgress[hi] = 1;
  st.flags[hi] |= EntityFlag.Powered | EntityFlag.NeedsPower;
  st.footprintW[hi] = 6;
  st.footprintH[hi] = 6;

  return {
    world,
    host,
    spawnBomber(): EntityId {
      const id = st.alloc(EntityKind.Vehicle, -1, P0, Faction.Allies, 120, 0, 120, 0);
      const i = st.index(id);
      st.maxHp[i] = st.hp[i] = 320;
      st.armorClass[i] = ArmorClass.Light;
      st.maxSpeed[i] = 10;
      st.radius[i] = 5.9;
      st.sight[i] = 34;
      st.weaponIndex[i] = WEAPONS.findIndex((w) => w.key === 'albatrossBomb');
      st.locomotor[i] = Locomotor.Air;
      st.flags[i] |= EntityFlag.CanMove | EntityFlag.CanAttack;
      return id;
    },
  };
}

afterEach(() => { setWeaponTable(DEFAULT_WEAPONS); });

describe('Strategic Airbase bay contract', () => {
  it('binds each faction bomber only to its own four-slot airbase family', () => {
    const catalog = new ProductionCatalog({ tables: null, unitId: {}, buildingId: {} });
    expect(catalog.producersFor('alliedAlbatross').map((entry) => entry.key))
      .toEqual(['alliedAirbase']);
    expect(catalog.producersFor('sovietMolot').map((entry) => entry.key))
      .toEqual(['sovietAviationWorks']);
    expect(catalog.producersFor('mrdEcliptic').map((entry) => entry.key))
      .toEqual(['mrdSolarAerodrome']);
    expect(catalog.producersFor('rclScrapvulture').map((entry) => entry.key))
      .toEqual(['rclCarrionRoost']);
    for (const key of [
      'alliedAirbase', 'sovietAviationWorks', 'mrdSolarAerodrome', 'rclCarrionRoost',
    ]) {
      expect(catalog.byKey(key)?.footprintW, key).toBe(6);
      expect(catalog.byKey(key)?.footprintH, key).toBe(6);
      expect(catalog.byKey(key)?.maxAlive, key).toBe(1);
      expect(catalog.byKey(key)?.cost, key).toBe(3000);
    }
    expect(WEAPONS.find((weapon) => weapon.key === 'molotBomb')?.damage).toBe(650);
    expect(WEAPONS.find((weapon) => weapon.key === 'eclipticCharge')?.damage).toBe(575);
    expect(WEAPONS.find((weapon) => weapon.key === 'scrapvultureCask')?.damage).toBe(480);
  });

  it('assigns four deterministic physical bays and refuses a fifth aircraft', () => {
    const { world, host, spawnBomber } = rig();
    for (let bay = 0; bay < 4; bay++) {
      const bomber = spawnBomber();
      expect(dockNewBomber(world, bomber, host)).toBe(true);
      const i = world.store.index(bomber);
      expect(sortieSlot(world.store.sortieData[i])).toBe(bay);
      expect(sortieState(world.store.sortieData[i])).toBe(BomberSortieState.DockedReady);
      expect(sortieHasBomb(world.store.sortieData[i])).toBe(true);
      expect(world.store.locomotor[i]).toBe(Locomotor.Static);
      expect(world.store.flags[i] & EntityFlag.Immobilized).not.toBe(0);
    }
    expect(dockNewBomber(world, spawnBomber(), host)).toBe(false);
    const summary = new Uint8Array(4);
    expect(new BomberSortieSystem(world, [AIRBASE_DEF]).summaryForHost(host, summary)).toBe(true);
    expect(Array.from(summary)).toEqual([0, 4, 0, 0]);
  });

  it('keeps all four bay centres inside the compact 24 metre footprint', () => {
    const { world, host } = rig();
    const centreX = world.store.posX[world.store.index(host)];
    const centreZ = world.store.posZ[world.store.index(host)];
    const point = new Float32Array(2);
    for (let bay = 0; bay < 4; bay++) {
      bomberBayPosition(world, world.store.index(host), bay, point);
      expect(Math.abs(point[0] - centreX), `bay ${bay} X`).toBeLessThan(12);
      expect(Math.abs(point[1] - centreZ), `bay ${bay} Z`).toBeLessThan(12);
    }
  });

  it('parks each faction bomber above its authored landing deck', () => {
    const expected = [
      ['Allies', Faction.Allies, 1.01],
      ['Soviets', Faction.Soviets, 2.29],
      ['Meridian', Faction.Meridian, 0.67],
      ['Reclamation', Faction.Reclaim, 1.98],
    ] as const;
    for (const [label, faction, height] of expected) {
      const { world, host, spawnBomber } = rig();
      const st = world.store;
      const hi = st.index(host);
      st.faction[hi] = faction;
      const bomber = spawnBomber();
      expect(dockNewBomber(world, bomber, host)).toBe(true);
      const bi = st.index(bomber);
      const terrainY = world.terrain.heightAt(st.posX[bi], st.posZ[bi]);
      expect(st.posY[bi] - terrainY, label).toBeCloseTo(height, 2);
      expect(BOMBER_TOUCHDOWN_HEIGHT[faction], label).toBeCloseTo(height, 2);

      // An old save/live-HMR entity at the retired terrain-relative height is
      // lifted without requiring the bomber or its host to be rebuilt.
      st.prevY[bi] = st.posY[bi] = terrainY + 0.18;
      new BomberSortieSystem(world, [AIRBASE_DEF]).preTick(context(1));
      expect(st.posY[bi] - terrainY, `${label} migration`).toBeCloseTo(height, 2);
    }
  });

  it('launches for an ordinary Move and uses the airborne movement layer', () => {
    const { world, host, spawnBomber } = rig();
    const st = world.store;
    const bomber = spawnBomber();
    expect(dockNewBomber(world, bomber, host)).toBe(true);
    const bi = st.index(bomber);
    const sorties = new BomberSortieSystem(world, [AIRBASE_DEF]);

    st.orderKind[bi] = OrderKind.Move;
    st.orderX[bi] = st.posX[bi] + 40;
    st.orderZ[bi] = st.posZ[bi] + 24;
    st.state[bi] = UnitState.Moving;
    sorties.preTick(context(1));

    expect(sortieState(st.sortieData[bi])).toBe(BomberSortieState.FreeFlight);
    expect(sortieHasBomb(st.sortieData[bi])).toBe(true);
    expect(st.locomotor[bi]).toBe(Locomotor.Air);
    expect(moveClassOf(st, bomber)).toBe(MoveClass.Air);
    expect(st.flags[bi] & EntityFlag.Immobilized).toBe(0);

    st.orderKind[bi] = OrderKind.None;
    st.state[bi] = UnitState.Idle;
    sorties.preTick(context(2));
    expect(sortieState(st.sortieData[bi])).toBe(BomberSortieState.FreeFlight);
  });

  it('launches, releases exactly one bomb, returns and rearms for 300 powered ticks', () => {
    expect(setWeaponTable(WEAPONS)).toBe(true);
    const { world, host, spawnBomber } = rig();
    const channels = new Channels();
    const projectiles = new ProjectileSystem(world, channels);
    const weapons = new WeaponSystem(world, channels, projectiles);
    const targeting = new TargetingSystem(world, channels, weapons);
    const sorties = new BomberSortieSystem(world);
    const bomber = spawnBomber();
    expect(dockNewBomber(world, bomber, host)).toBe(true);
    const st = world.store;
    const bi = st.index(bomber);
    expect(weapons.weaponFor(bi)?.key).toBe('albatrossBomb');

    const target = st.alloc(
      EntityKind.Building, -1, 1 as PlayerId, Faction.Soviets,
      st.posX[bi], 0, st.posZ[bi] + 1, 0,
    );
    const ti = st.index(target);
    st.maxHp[ti] = st.hp[ti] = 1000;
    st.radius[ti] = 1;
    st.armorClass[ti] = ArmorClass.Heavy;
    st.buildProgress[ti] = 1;

    st.orderKind[bi] = OrderKind.Attack;
    st.orderTarget[bi] = target as number;
    st.state[bi] = UnitState.Attacking;
    const s = context(1);
    sorties.preTick(s);
    expect(sortieState(st.sortieData[bi])).toBe(BomberSortieState.EnRoute);
    expect(st.locomotor[bi]).toBe(Locomotor.Air);

    world.spatial.rebuild();
    for (let tick = 1; tick <= 90 && st.cooldown[bi] <= 0; tick++) {
      const aim = context(tick);
      st.targetId[bi] = target as number;
      targeting.tick(aim);
      // Target acquisition is independently covered by combat.spec; pin the
      // explicit strike target here so this test measures the one-bomb FSM.
      st.targetId[bi] = target as number;
      weapons.tick(aim);
    }
    expect(st.cooldown[bi], JSON.stringify({
      target: st.targetId[bi], active: weapons.stats.active, shots: weapons.stats.shots,
      slewing: weapons.stats.slewing, yaw: st.yaw[bi], turret: st.turretYaw[bi],
      pitch: st.barrelPitch[bi], locomotor: st.locomotor[bi], flags: st.flags[bi],
      sortie: st.sortieData[bi], bomb: sortieHasBomb(st.sortieData[bi]), stance: st.stance[bi],
      order: st.orderKind[bi], range: weapons.weaponFor(bi)?.range,
    })).toBeGreaterThan(0);
    expect(projectiles.liveCount).toBe(1);
    expect(Array.from(projectiles.kind).includes(ProjectileKind.Bomb)).toBe(true);
    sorties.postWeaponsTick();
    expect(sortieState(st.sortieData[bi])).toBe(BomberSortieState.Returning);
    expect(sortieHasBomb(st.sortieData[bi])).toBe(false);
    expect(st.orderKind[bi]).toBe(OrderKind.Move);

    const pad = new Float32Array(2);
    bomberBayPosition(world, st.index(host), 0, pad);
    st.posX[bi] = pad[0];
    st.posZ[bi] = pad[1];
    sorties.preTick(context(2));
    expect(sortieState(st.sortieData[bi])).toBe(BomberSortieState.Reloading);

    // A blackout pauses the exact-tick counter.
    st.flags[st.index(host)] &= ~EntityFlag.Powered;
    for (let tick = 3; tick < 33; tick++) sorties.preTick(context(tick));
    expect(sortieState(st.sortieData[bi])).toBe(BomberSortieState.Reloading);

    st.flags[st.index(host)] |= EntityFlag.Powered;
    for (let n = 0; n < BOMBER_REARM_TICKS - 1; n++) sorties.preTick(context(33 + n));
    expect(sortieState(st.sortieData[bi])).toBe(BomberSortieState.Reloading);
    expect(sortieHasBomb(st.sortieData[bi])).toBe(false);
    sorties.preTick(context(33 + BOMBER_REARM_TICKS));
    expect(sortieState(st.sortieData[bi])).toBe(BomberSortieState.DockedReady);
    expect(sortieHasBomb(st.sortieData[bi])).toBe(true);
    expect(st.stance[bi]).toBe(Stance.HoldFire);
  });

  it('lets the HUD AttackMove command fire a newly launched HoldFire bomber', () => {
    expect(setWeaponTable(WEAPONS)).toBe(true);
    const { world, host, spawnBomber } = rig();
    const channels = new Channels();
    const projectiles = new ProjectileSystem(world, channels);
    const weapons = new WeaponSystem(world, channels, projectiles);
    const targeting = new TargetingSystem(world, channels, weapons);
    const sorties = new BomberSortieSystem(world, [AIRBASE_DEF]);
    const bomber = spawnBomber();
    const st = world.store;
    const bi = st.index(bomber);
    expect(dockNewBomber(world, bomber, host)).toBe(true);
    const target = st.alloc(
      EntityKind.Building, 91, 1 as PlayerId, Faction.Soviets,
      st.posX[bi], 0, st.posZ[bi] + 1, 0,
    );
    const ti = st.index(target);
    st.maxHp[ti] = st.hp[ti] = 1000;
    st.radius[ti] = 1;
    st.armorClass[ti] = ArmorClass.Heavy;
    st.buildProgress[ti] = 1;

    st.orderKind[bi] = OrderKind.AttackMove;
    st.orderX[bi] = st.posX[ti];
    st.orderZ[bi] = st.posZ[ti];
    st.state[bi] = UnitState.AttackMoving;
    sorties.preTick(context(1));
    expect(sortieState(st.sortieData[bi])).toBe(BomberSortieState.EnRoute);
    expect(st.stance[bi]).toBe(Stance.HoldFire);

    world.spatial.rebuild();
    for (let tick = 1; tick <= 16 && st.cooldown[bi] <= 0; tick++) {
      targeting.tick(context(tick));
      weapons.tick(context(tick));
    }
    expect(st.cooldown[bi]).toBeGreaterThan(0);
    expect(projectiles.liveCount).toBe(1);
    sorties.postWeaponsTick();
    expect(sortieState(st.sortieData[bi])).toBe(BomberSortieState.Returning);
    expect(sortieHasBomb(st.sortieData[bi])).toBe(false);
  });

  it('lets Stop cancel an attack run without forcing the loaded bomber home', () => {
    const { world, host, spawnBomber } = rig();
    const st = world.store;
    const bomber = spawnBomber();
    expect(dockNewBomber(world, bomber, host)).toBe(true);
    const bi = st.index(bomber);
    const sorties = new BomberSortieSystem(world, [AIRBASE_DEF]);

    st.orderKind[bi] = OrderKind.ForceAttack;
    st.state[bi] = UnitState.Attacking;
    sorties.preTick(context(1));
    expect(sortieState(st.sortieData[bi])).toBe(BomberSortieState.EnRoute);

    // Command execution represents Stop as None + Idle for non-harvesters.
    st.orderKind[bi] = OrderKind.None;
    st.state[bi] = UnitState.Idle;
    sorties.preTick(context(2));
    expect(sortieState(st.sortieData[bi])).toBe(BomberSortieState.FreeFlight);
    expect(sortieHasBomb(st.sortieData[bi])).toBe(true);

    // Guard is the explicit recall after a player has chosen to stay aloft.
    st.orderKind[bi] = OrderKind.Guard;
    st.state[bi] = UnitState.Guarding;
    sorties.preTick(context(3));
    expect(sortieState(st.sortieData[bi])).toBe(BomberSortieState.Returning);
    const pad = new Float32Array(2);
    bomberBayPosition(world, st.index(host), sortieSlot(st.sortieData[bi]), pad);
    st.posX[bi] = pad[0];
    st.posZ[bi] = pad[1];
    sorties.preTick(context(4));
    expect(sortieState(st.sortieData[bi])).toBe(BomberSortieState.DockedReady);
    expect(sortieHasBomb(st.sortieData[bi])).toBe(true);
  });

  it('auto-returns after release but Stop leaves the empty bomber airborne', () => {
    const { world, host, spawnBomber } = rig();
    const st = world.store;
    const bomber = spawnBomber();
    expect(dockNewBomber(world, bomber, host)).toBe(true);
    const bi = st.index(bomber);
    const sorties = new BomberSortieSystem(world, [AIRBASE_DEF]);

    st.orderKind[bi] = OrderKind.Attack;
    st.state[bi] = UnitState.Attacking;
    sorties.preTick(context(1));
    st.cooldown[bi] = 1;
    sorties.postWeaponsTick();
    expect(sortieState(st.sortieData[bi])).toBe(BomberSortieState.Returning);
    expect(sortieHasBomb(st.sortieData[bi])).toBe(false);

    st.orderKind[bi] = OrderKind.None;
    st.state[bi] = UnitState.Idle;
    sorties.preTick(context(2));
    expect(sortieState(st.sortieData[bi])).toBe(BomberSortieState.FreeFlight);
    expect(sortieHasBomb(st.sortieData[bi])).toBe(false);
    expect(st.locomotor[bi]).toBe(Locomotor.Air);
  });

  it('returns a loaded bomber when its explicit target disappears before release', () => {
    const { world, host, spawnBomber } = rig();
    const st = world.store;
    const bomber = spawnBomber();
    const target = st.alloc(
      EntityKind.Building, 91, 1 as PlayerId, Faction.Soviets, 170, 0, 120, 0,
    );
    expect(dockNewBomber(world, bomber, host)).toBe(true);
    const bi = st.index(bomber);

    st.orderKind[bi] = OrderKind.Attack;
    st.orderTarget[bi] = target as number;
    st.state[bi] = UnitState.Attacking;
    const sorties = new BomberSortieSystem(world, [AIRBASE_DEF]);
    sorties.preTick(context(1));
    expect(sortieState(st.sortieData[bi])).toBe(BomberSortieState.EnRoute);

    // The target remains readable until Cleanup, which is the real window in
    // which this bug occurred: Targeting sees it as pending and clears its
    // lock, while the sortie still carried the stale explicit Attack order.
    st.markDead(target);
    sorties.preTick(context(2));
    expect(sortieState(st.sortieData[bi])).toBe(BomberSortieState.Returning);
    expect(sortieHasBomb(st.sortieData[bi])).toBe(true);
    expect(st.orderKind[bi]).toBe(OrderKind.Move);
    expect(st.orderTarget[bi]).toBe(0);
  });

  it('treats a Move onto its own airbase as a landing request', () => {
    const { world, host, spawnBomber } = rig();
    const st = world.store;
    const bomber = spawnBomber();
    expect(dockNewBomber(world, bomber, host)).toBe(true);
    const bi = st.index(bomber);
    const hi = st.index(host);
    const sorties = new BomberSortieSystem(world, [AIRBASE_DEF]);

    st.orderKind[bi] = OrderKind.Move;
    st.orderX[bi] = st.posX[bi] + 40;
    st.orderZ[bi] = st.posZ[bi] + 20;
    st.state[bi] = UnitState.Moving;
    sorties.preTick(context(1));
    expect(sortieState(st.sortieData[bi])).toBe(BomberSortieState.FreeFlight);

    // A context click on a friendly structure arrives as a point Move.
    st.orderKind[bi] = OrderKind.Move;
    st.orderX[bi] = st.posX[hi];
    st.orderZ[bi] = st.posZ[hi];
    st.state[bi] = UnitState.Moving;
    sorties.preTick(context(2));
    expect(sortieState(st.sortieData[bi])).toBe(BomberSortieState.Returning);

    const pad = new Float32Array(2);
    bomberBayPosition(world, hi, sortieSlot(st.sortieData[bi]), pad);
    expect(st.orderX[bi]).toBeCloseTo(pad[0]);
    expect(st.orderZ[bi]).toBeCloseTo(pad[1]);
    st.posX[bi] = pad[0];
    st.posZ[bi] = pad[1];
    sorties.preTick(context(3));
    expect(sortieState(st.sortieData[bi])).toBe(BomberSortieState.DockedReady);
    expect(st.locomotor[bi]).toBe(Locomotor.Static);
  });

  it('treats every visible corner of the square airbase as a landing request', () => {
    const { world, host, spawnBomber } = rig();
    const st = world.store;
    const bomber = spawnBomber();
    expect(dockNewBomber(world, bomber, host)).toBe(true);
    const bi = st.index(bomber);
    const hi = st.index(host);
    const sorties = new BomberSortieSystem(world, [AIRBASE_DEF]);

    st.orderKind[bi] = OrderKind.Move;
    st.orderX[bi] = st.posX[bi] + 40;
    st.orderZ[bi] = st.posZ[bi] + 20;
    st.state[bi] = UnitState.Moving;
    sorties.preTick(context(1));
    expect(sortieState(st.sortieData[bi])).toBe(BomberSortieState.FreeFlight);

    // 11.5/11.5 is inside a 24 m square but outside its 12 m inscribed circle.
    st.orderKind[bi] = OrderKind.Move;
    st.orderX[bi] = st.posX[hi] + 11.5;
    st.orderZ[bi] = st.posZ[hi] + 11.5;
    st.state[bi] = UnitState.Moving;
    sorties.preTick(context(2));
    expect(sortieState(st.sortieData[bi])).toBe(BomberSortieState.Returning);
  });

  it('lands when navigation reaches its hull-aware arrival distance', () => {
    const { world, host, spawnBomber } = rig();
    const st = world.store;
    const bomber = spawnBomber();
    expect(dockNewBomber(world, bomber, host)).toBe(true);
    const bi = st.index(bomber);
    const hi = st.index(host);
    const sorties = new BomberSortieSystem(world, [AIRBASE_DEF]);

    st.orderKind[bi] = OrderKind.Move;
    st.orderX[bi] = st.posX[hi];
    st.orderZ[bi] = st.posZ[hi];
    st.state[bi] = UnitState.Moving;
    // First click away launches; the second click on home enters Returning.
    st.orderX[bi] += 40;
    sorties.preTick(context(1));
    st.orderKind[bi] = OrderKind.Move;
    st.orderX[bi] = st.posX[hi];
    st.orderZ[bi] = st.posZ[hi];
    st.state[bi] = UnitState.Moving;
    sorties.preTick(context(2));
    expect(sortieState(st.sortieData[bi])).toBe(BomberSortieState.Returning);

    const pad = new Float32Array(2);
    bomberBayPosition(world, hi, sortieSlot(st.sortieData[bi]), pad);
    const navArrival = st.radius[bi] + NAV_ARRIVE_SLACK - 0.01;
    st.posX[bi] = pad[0] + navArrival;
    st.posZ[bi] = pad[1];
    // This is the exact state NavAssigner leaves after completing the Move.
    st.state[bi] = UnitState.Idle;
    st.orderKind[bi] = OrderKind.Move;
    st.orderX[bi] = pad[0];
    st.orderZ[bi] = pad[1];
    sorties.preTick(context(3));
    expect(sortieState(st.sortieData[bi])).toBe(BomberSortieState.DockedReady);
    expect(st.locomotor[bi]).toBe(Locomotor.Static);
  });

  it('keeps returning when the player clicks the host centre', () => {
    const { world, host, spawnBomber } = rig();
    const st = world.store;
    const bomber = spawnBomber();
    expect(dockNewBomber(world, bomber, host)).toBe(true);
    const bi = st.index(bomber);
    const hi = st.index(host);
    const sorties = new BomberSortieSystem(world, [AIRBASE_DEF]);

    st.orderKind[bi] = OrderKind.Attack;
    st.state[bi] = UnitState.Attacking;
    sorties.preTick(context(1));
    st.cooldown[bi] = 1;
    sorties.postWeaponsTick();
    expect(sortieState(st.sortieData[bi])).toBe(BomberSortieState.Returning);

    // Keep the synthetic aircraft airborne; it began this test on its bay and
    // would otherwise correctly complete landing during the next pre-tick.
    st.posX[bi] += 40;
    st.posZ[bi] += 20;

    st.orderKind[bi] = OrderKind.Move;
    st.orderX[bi] = st.posX[hi];
    st.orderZ[bi] = st.posZ[hi];
    st.state[bi] = UnitState.Moving;
    sorties.preTick(context(2));
    expect(sortieState(st.sortieData[bi])).toBe(BomberSortieState.Returning);
    expect(sortieHasBomb(st.sortieData[bi])).toBe(false);
  });

  it('rehomes a parked loaded bomber to the nearest powered free compatible bay', () => {
    const { world, host, spawnBomber } = rig();
    const st = world.store;
    const replacement = st.alloc(
      EntityKind.Building, AIRBASE_DEF, P0, Faction.Allies, 164, 0, 120, 0,
    );
    const ri = st.index(replacement);
    st.buildProgress[ri] = 1;
    st.flags[ri] |= EntityFlag.Powered | EntityFlag.NeedsPower;
    const bomber = spawnBomber();
    expect(dockNewBomber(world, bomber, host)).toBe(true);
    const bi = st.index(bomber);

    st.flags[st.index(host)] |= EntityFlag.PendingDestroy;
    const sorties = new BomberSortieSystem(world, [AIRBASE_DEF]);
    sorties.preTick(context(1));
    expect(st.sortieHostId[bi]).toBe(replacement as number);
    expect(sortieState(st.sortieData[bi])).toBe(BomberSortieState.Returning);
    expect(sortieHasBomb(st.sortieData[bi])).toBe(true);
    expect(st.locomotor[bi]).toBe(Locomotor.Air);

    const pad = new Float32Array(2);
    bomberBayPosition(world, ri, sortieSlot(st.sortieData[bi]), pad);
    st.posX[bi] = pad[0];
    st.posZ[bi] = pad[1];
    sorties.preTick(context(2));
    expect(sortieState(st.sortieData[bi])).toBe(BomberSortieState.DockedReady);
    expect(sortieHasBomb(st.sortieData[bi])).toBe(true);
    expect(st.locomotor[bi]).toBe(Locomotor.Static);
  });

  it('keeps aircraft with their original owner when an occupied host is captured', () => {
    const { world, host, spawnBomber } = rig();
    const st = world.store;
    const replacement = st.alloc(
      EntityKind.Building, AIRBASE_DEF, P0, Faction.Allies, 164, 0, 120, 0,
    );
    const ri = st.index(replacement);
    st.buildProgress[ri] = 1;
    st.flags[ri] |= EntityFlag.Powered | EntityFlag.NeedsPower;
    const bomber = spawnBomber();
    expect(dockNewBomber(world, bomber, host)).toBe(true);
    const bi = st.index(bomber);

    st.owner[st.index(host)] = 1;
    const sorties = new BomberSortieSystem(world, [AIRBASE_DEF]);
    sorties.preTick(context(1));
    expect(st.owner[bi]).toBe(P0 as number);
    expect(st.sortieHostId[bi]).toBe(replacement as number);
    expect(sortieState(st.sortieData[bi])).toBe(BomberSortieState.Returning);
  });
});

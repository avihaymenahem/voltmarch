/**
 * "when right click attack on enemy building, my army doesnt attack!"
 *
 * Reported twice by the player. The order path and the combat path are written
 * by different modules and were each individually correct, so this file drives
 * the WHOLE chain the mouse drives — resolve the right-click, issue the order,
 * then step targeting -> weapons -> projectiles -> damage — and asserts the
 * building actually loses hit points.
 *
 * Everything here is pure simulation: no GL, no THREE, no DOM.
 */

import { describe, expect, it } from 'vitest';

import { World } from '../src/core/world';
import { Channels } from '../src/core/events';
import { Rng } from '../src/core/math';
import {
  ArmorClass, EntityFlag, EntityKind, Faction, Locomotor, OrderKind, Stance, UnitState,
} from '../src/core/types';
import type { EntityId, PlayerId, SimContext } from '../src/core/types';
import { ARMOR_MATRIX, SIM_DT } from '../src/core/config';

import { DamageSystem, setArmorMatrix } from '../src/sim/Damage';
import { ProjectileSystem } from '../src/sim/Projectiles';
import {
  WeaponSystem, setContentWeaponMap, setWeaponKeyResolver, weaponIndexOf,
} from '../src/sim/Combat';
import { TargetingSystem } from '../src/sim/Targeting';
import { seeksGoal } from '../src/sim/Steering';

const P0 = 0 as PlayerId;
const P1 = 1 as PlayerId;

interface Rig {
  world: World;
  channels: Channels;
  step(n?: number): void;
}

function makeRig(seed = 11): Rig {
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
  const rng = new Rng(seed);
  let tick = 0;

  return {
    world,
    channels,
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

function spawnTank(rig: Rig, player: PlayerId, x: number, z: number): EntityId {
  const st = rig.world.store;
  const faction = player === P0 ? Faction.Allies : Faction.Soviets;
  const h = st.alloc(EntityKind.Vehicle, -1, player, faction, x, 0, z, 0);
  const i = st.index(h);
  st.maxHp[i] = 400; st.hp[i] = 400;
  st.armorClass[i] = ArmorClass.Medium;
  st.radius[i] = 2.0;
  st.sight[i] = 40;
  st.weaponIndex[i] = weaponIndexOf('lightCannon');
  st.locomotor[i] = Locomotor.Track;
  st.state[i] = UnitState.Idle;
  st.stance[i] = Stance.Aggressive;
  st.flags[i] |= EntityFlag.ProvidesVision | EntityFlag.CanAttack | EntityFlag.HasTurret;
  return h;
}

function spawnBuilding(rig: Rig, player: PlayerId, x: number, z: number): EntityId {
  const st = rig.world.store;
  const faction = player === P0 ? Faction.Allies : Faction.Soviets;
  const h = st.alloc(EntityKind.Building, -1, player, faction, x, 0, z, 0);
  const i = st.index(h);
  st.maxHp[i] = 2000; st.hp[i] = 2000;
  st.armorClass[i] = ArmorClass.Concrete;
  st.radius[i] = 6.0;
  st.sight[i] = 20;
  st.weaponIndex[i] = -1;
  st.locomotor[i] = Locomotor.Static;
  st.state[i] = UnitState.Idle;
  st.stance[i] = Stance.Aggressive;
  st.footprintW[i] = 3; st.footprintH[i] = 3;
  st.flags[i] |= EntityFlag.ProvidesVision;
  return h;
}

/**
 * The right-click. Mirrors `OrderExecutor.write()` in `src/input/Commands.ts`
 * for `OrderKind.Attack` exactly: the order columns, the target position it
 * bakes in, and the `UnitState.Attacking` it puts the unit into.
 */
function orderAttack(rig: Rig, unit: EntityId, target: EntityId): void {
  const st = rig.world.store;
  const i = st.index(unit);
  const t = st.index(target);
  st.orderKind[i] = OrderKind.Attack;
  st.orderTarget[i] = target as number;
  st.orderX[i] = st.posX[t];
  st.orderZ[i] = st.posZ[t];
  st.state[i] = UnitState.Attacking;
}

describe('right-clicking an enemy building makes the army attack it', () => {
  it('damages the building when ordered', () => {
    const rig = makeRig();
    const tank = spawnTank(rig, P0, 0, 0);
    const hq = spawnBuilding(rig, P1, 0, 18);

    const st = rig.world.store;
    const before = st.hp[st.index(hq)];

    orderAttack(rig, tank, hq);
    rig.step(90); // three seconds

    const after = st.hp[st.index(hq)];
    expect(after, 'the building must lose hit points').toBeLessThan(before);
  });

  it('acquires the ordered building as its target, not something else', () => {
    const rig = makeRig();
    const tank = spawnTank(rig, P0, 0, 0);
    const hq = spawnBuilding(rig, P1, 0, 18);

    orderAttack(rig, tank, hq);
    rig.step(2);

    const st = rig.world.store;
    expect(st.targetId[st.index(tank)], 'targeting must lock the ordered building')
      .toBe(hq as number);
  });

  it('a whole army all engage the same ordered building', () => {
    const rig = makeRig();
    const hq = spawnBuilding(rig, P1, 0, 22);
    const army: EntityId[] = [];
    for (let k = 0; k < 6; k++) army.push(spawnTank(rig, P0, -10 + k * 4, 0));

    const st = rig.world.store;
    const before = st.hp[st.index(hq)];
    for (const u of army) orderAttack(rig, u, hq);
    rig.step(90);

    expect(st.hp[st.index(hq)]).toBeLessThan(before);
    for (const u of army) {
      expect(st.targetId[st.index(u)], 'every unit must be on the ordered target')
        .toBe(hq as number);
    }
  });

  it('puts the unit in a state that CLOSES THE DISTANCE — the reported bug', () => {
    // THE BUG. `types.ts:204` documents UnitState.Attacking as "Stationary or
    // CLOSING ON targetId, weapon hot", and an Attack order writes exactly that
    // state (`Commands.ts` write()). But `seeksGoal()` — the predicate that
    // decides which units are given a flow field — omitted it, so
    // `Steering` released the nav field and the unit never moved.
    //
    // In range that is invisible: the unit fires from where it stands and every
    // other test in this file passes. Across the map, which is how you actually
    // right-click an enemy base, the army simply stands there. That is the
    // player's report, twice: "my army doesnt attack!".
    const rig = makeRig();
    const tank = spawnTank(rig, P0, 0, 0);
    const hq = spawnBuilding(rig, P1, 0, 400);

    orderAttack(rig, tank, hq);
    rig.step(1);

    const st = rig.world.store;
    const i = st.index(tank);
    expect(st.state[i], 'an Attack order must leave the unit in Attacking').toBe(UnitState.Attacking);
    expect(
      seeksGoal(st.state[i]),
      'a unit ordered to attack something out of range must seek a goal, or it never closes',
    ).toBe(true);
  });

  it('keeps attacking a building that never shoots back', () => {
    // The building is unarmed, so nothing about this engagement is reciprocal.
    // A retaliation-driven bug would pass the first test and fail this one.
    const rig = makeRig();
    const tank = spawnTank(rig, P0, 0, 0);
    const hq = spawnBuilding(rig, P1, 0, 18);
    const st = rig.world.store;

    orderAttack(rig, tank, hq);
    rig.step(30);
    const mid = st.hp[st.index(hq)];
    rig.step(60);
    const end = st.hp[st.index(hq)];

    expect(mid).toBeLessThan(2000);
    expect(end, 'damage must keep accumulating, not stall after the first shot')
      .toBeLessThan(mid);
  });
});

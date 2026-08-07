/**
 * ============================================================================
 * tests/emplacement-traverse.spec.ts
 * ============================================================================
 * "Flame tower doesnt seem to do anything at all."
 *
 * It does not, and neither does any other turretless defence. `WeaponSystem`
 * splits the world into two cases — HasTurret, which traverses, and everything
 * else, whose `turretYaw` is welded to its HULL yaw and which may only fire
 * within `hullArcDeg` (14 degrees) of that bearing. For a VEHICLE that is
 * correct: Steering rotates the hull to bring the gun to bear, so the arc is a
 * transient. A BUILDING has no steering. Its yaw is whatever it was placed at
 * and it never changes again, so a 28-degree window out of 360 is permanent —
 * an emplacement that can engage 7.8% of the compass.
 *
 * The art side already found this and fixed the wrong half of it.
 * `BuildingDefs.sovietFlameTower` carries the diagnosis verbatim:
 *
 *     `Defs.flameTower` does not set `hasTurret`, so `EntityFlag.HasTurret` is
 *     never raised, `Combat.ts` never slews `turretYaw` [...] Giving this thing
 *     a directional gun [...] produces an emplacement whose barrel points at
 *     one fixed compass bearing forever. So it has no barrel.
 *
 * The MODEL was made omnidirectional. The GUN was left pointing north.
 *
 * WHAT THESE CASES PROTECT
 * ------------------------
 *   - AN EMPLACEMENT COVERS ALL BEARINGS. Every armed structure, at every
 *     approach angle. This is the whole report.
 *   - A TURRETLESS VEHICLE IS UNCHANGED. The hull arc is load-bearing there and
 *     the fix must not reach it, or every Reclamation hull starts firing
 *     sideways out of a welded gun.
 *   - A WEAPON'S RANGE IS REACHABLE BY ITS OWN PROJECTILE. `flameJet` asked for
 *     15 m from a round that dies at 14.3, which is the kind of arithmetic
 *     nothing notices until someone stands at 14.5 m and survives.
 *
 * Pure simulation: no GL, no THREE, no DOM.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';

import { World } from '../src/core/world';
import { Channels } from '../src/core/events';
import { Rng } from '../src/core/math';
import {
  ArmorClass, EntityFlag, EntityKind, Faction, Locomotor, ProjectileKind, Stance, UnitState,
} from '../src/core/types';
import type { EntityId, PlayerId, SimContext } from '../src/core/types';
import {
  ARMOR_MATRIX, COMBAT_PROJECTILES, COMBAT_WEAPONS, MAP_SIZE, SIM_DT,
} from '../src/core/config';

import { DamageSystem, setArmorMatrix } from '../src/sim/Damage';
import { ProjectileSystem } from '../src/sim/Projectiles';
import {
  DEFAULT_WEAPONS, WeaponSystem, setContentWeaponMap, setWeaponKeyResolver, weaponIndexOf,
} from '../src/sim/Combat';
import { TargetingSystem } from '../src/sim/Targeting';

const P0 = 0 as PlayerId;
const P1 = 1 as PlayerId;

/**
 * Everything is built around the middle of the map, not the origin.
 *
 * `ProjectileSystem.tick` frees any round whose next position leaves
 * `0..MAP_SIZE`, so a tower at (0,0) sweeping the compass has half its
 * bearings silently swallowed by the map edge — which reads exactly like the
 * traverse bug this file is about and cost a debugging pass to tell apart.
 */
const CX = MAP_SIZE * 0.5;
const CZ = MAP_SIZE * 0.5;

interface Rig {
  world: World;
  step(n?: number): void;
}

function makeRig(seed = 7): Rig {
  setContentWeaponMap({});
  setWeaponKeyResolver(null);
  setArmorMatrix(ARMOR_MATRIX);

  const world = new World();
  const channels = new Channels();
  world.addPlayer(Faction.Soviets, 'A', true, true);
  world.addPlayer(Faction.Allies, 'B', false, false);

  const projectiles = new ProjectileSystem(world, channels);
  const damage = new DamageSystem(world, channels);
  const weapons = new WeaponSystem(world, channels, projectiles);
  const targeting = new TargetingSystem(world, channels, weapons);
  const rng = new Rng(seed);
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

/**
 * An armed structure, placed at `yawDeg`. `yawDeg` is the whole point: a
 * building is placed once and never turns, so the test sweeps the target around
 * a tower whose own bearing never moves.
 */
function spawnDefence(rig: Rig, weaponKey: string, x: number, z: number, yawDeg: number): EntityId {
  const st = rig.world.store;
  const h = st.alloc(EntityKind.Building, -1, P0, Faction.Soviets, CX + x, 0, CZ + z, (yawDeg * Math.PI) / 180);
  const i = st.index(h);
  st.maxHp[i] = 550; st.hp[i] = 550;
  st.armorClass[i] = ArmorClass.Concrete;
  st.radius[i] = 2.0;
  st.sight[i] = 30;
  st.footprintW[i] = 1; st.footprintH[i] = 1;
  st.weaponIndex[i] = weaponIndexOf(weaponKey);
  st.locomotor[i] = Locomotor.Static;
  st.state[i] = UnitState.Idle;
  st.stance[i] = Stance.Aggressive;
  st.flags[i] |= EntityFlag.ProvidesVision | EntityFlag.CanAttack | EntityFlag.Powered;
  return h;
}

/** A rifleman for the tower to burn. Unarmed, so it never shoots back. */
function spawnVictim(rig: Rig, x: number, z: number): EntityId {
  const st = rig.world.store;
  const h = st.alloc(EntityKind.Infantry, -1, P1, Faction.Allies, CX + x, 0, CZ + z, 0);
  const i = st.index(h);
  st.maxHp[i] = 120; st.hp[i] = 120;
  st.armorClass[i] = ArmorClass.Infantry;
  st.radius[i] = 0.5;
  st.sight[i] = 20;
  st.locomotor[i] = Locomotor.Foot;
  st.state[i] = UnitState.Idle;
  st.stance[i] = Stance.Aggressive;
  st.flags[i] |= EntityFlag.ProvidesVision;
  return h;
}

/** A turretless HULL gunner — the case the 14-degree arc is actually for. */
function spawnHullGunner(rig: Rig, x: number, z: number, yawDeg: number): EntityId {
  const st = rig.world.store;
  const h = st.alloc(EntityKind.Vehicle, -1, P0, Faction.Soviets, CX + x, 0, CZ + z, (yawDeg * Math.PI) / 180);
  const i = st.index(h);
  st.maxHp[i] = 300; st.hp[i] = 300;
  st.armorClass[i] = ArmorClass.Medium;
  st.radius[i] = 2.0;
  st.sight[i] = 40;
  st.weaponIndex[i] = weaponIndexOf('lightCannon');
  st.locomotor[i] = Locomotor.Track;
  st.state[i] = UnitState.Idle;
  st.stance[i] = Stance.Aggressive;
  st.flags[i] |= EntityFlag.ProvidesVision | EntityFlag.CanAttack;
  return h;
}

/* ========================================================================== */

describe('an emplacement covers every bearing, not a 28-degree slice', () => {
  /**
   * Eight approaches around the compass against a tower facing due north. Seven
   * of the eight are outside the hull arc, and before the fix every one of them
   * walked away untouched.
   */
  it('burns an attacker at any approach angle', () => {
    for (let deg = 0; deg < 360; deg += 45) {
      const rig = makeRig();
      spawnDefence(rig, 'flameJet', 0, 0, 0);
      const rad = (deg * Math.PI) / 180;
      const victim = spawnVictim(rig, Math.sin(rad) * 9, Math.cos(rad) * 9);

      const st = rig.world.store;
      const before = st.hp[st.index(victim)];
      rig.step(60); // two seconds — four flame cycles at 0.5 s

      const idx = st.index(victim);
      const after = idx < 0 ? 0 : st.hp[idx];
      expect(after, `approach from ${deg} degrees must be engaged`).toBeLessThan(before);
    }
  });

  it('does it for every turretless defence weapon, not just the flame tower', () => {
    for (const key of ['flameJet', 'pillboxMg', 'teslaBolt'] as const) {
      const rig = makeRig();
      spawnDefence(rig, key, 0, 0, 0);
      // Due SOUTH: 180 degrees off the tower's fixed bearing, the worst case.
      const victim = spawnVictim(rig, 0, -9);

      const st = rig.world.store;
      const before = st.hp[st.index(victim)];
      rig.step(90);

      const idx = st.index(victim);
      const after = idx < 0 ? 0 : st.hp[idx];
      expect(after, `${key} must engage a target behind it`).toBeLessThan(before);
    }
  });

  it('slews the emplacement gun toward the target rather than pinning it to yaw', () => {
    const rig = makeRig();
    const tower = spawnDefence(rig, 'flameJet', 0, 0, 0);
    spawnVictim(rig, 9, 0); // due east — a quarter turn away

    const st = rig.world.store;
    rig.step(30);

    const i = st.index(tower);
    expect(st.yaw[i], 'the structure itself must not rotate').toBeCloseTo(0, 6);
    // 0 faces +Z and yaw increases toward +X, so due east is +PI/2.
    expect(Math.abs(st.turretYaw[i] - Math.PI / 2), 'the gun must have come to bear')
      .toBeLessThan(COMBAT_WEAPONS.aimToleranceDeg * (Math.PI / 180));
  });
});

/* ========================================================================== */

describe('the hull arc still binds where it is supposed to', () => {
  it('keeps a turretless VEHICLE welded to its hull bearing', () => {
    const rig = makeRig();
    const tank = spawnHullGunner(rig, 0, 0, 0);
    spawnVictim(rig, 9, 0); // due east, 90 degrees off the hull

    const st = rig.world.store;
    rig.step(30);

    const i = st.index(tank);
    // Steering is not in this rig, so the hull cannot turn; the gun must stay
    // welded to it. If this ever reads PI/2 the fix has leaked into vehicles.
    expect(st.turretYaw[i], 'a hull gun tracks the hull, never the target')
      .toBeCloseTo(st.yaw[i], 6);
  });
});

/* ========================================================================== */

describe('a weapon may not out-range its own projectile', () => {
  /**
   * `Flame` is the only kind with a life shorter than `maxLifeSeconds`, so it is
   * the only one whose reach is bounded by anything other than the map. It
   * asked for 15 m out of 26 m/s x 0.55 s = 14.3 m of flight.
   */
  it('lets a flame round physically reach the range the weapon claims', () => {
    const flame = DEFAULT_WEAPONS[weaponIndexOf('flameJet')]!;
    expect(flame.projectile).toBe(ProjectileKind.Flame);
    const reach = COMBAT_PROJECTILES.flameSpeed * COMBAT_PROJECTILES.flameLifeSeconds;
    expect(reach, 'the tongue must carry as far as the weapon shoots')
      .toBeGreaterThanOrEqual(flame.range);
  });

  it('actually kills something standing at the edge of the envelope', () => {
    const rig = makeRig();
    spawnDefence(rig, 'flameJet', 0, 0, 0);
    const flame = DEFAULT_WEAPONS[weaponIndexOf('flameJet')]!;
    // Just inside maximum range, dead ahead so the arc is not what is measured.
    const victim = spawnVictim(rig, 0, flame.range - 0.5);

    const st = rig.world.store;
    const before = st.hp[st.index(victim)];
    rig.step(60);

    const idx = st.index(victim);
    const after = idx < 0 ? 0 : st.hp[idx];
    expect(after, 'a target at the range limit must still burn').toBeLessThan(before);
  });

  it('keeps the placement preview ring honest about that range', async () => {
    // `PlacementSpec.weaponRange` comes from FALLBACK_BUILDINGS and draws the
    // coverage circle the player sees while holding the structure. It is the
    // only consumer of that field, so a disagreement with the armoury is a lie
    // told directly to the player at the moment they choose where to build.
    const { FALLBACK_BUILDINGS } = await import('../src/game/Scenarios');
    const pairs: ReadonlyArray<readonly [string, string]> = [
      ['flameTower', 'flameJet'],
      ['pillbox', 'pillboxMg'],
      ['teslaCoil', 'teslaBolt'],
      ['prismTower', 'prismTowerBeam'],
    ];
    for (const [key, weaponKey] of pairs) {
      const fb = FALLBACK_BUILDINGS[key]!;
      const w = DEFAULT_WEAPONS[weaponIndexOf(weaponKey)]!;
      expect(fb.weaponRange, `${key}'s preview ring must match ${weaponKey}`).toBe(w.range);
    }
  });
});

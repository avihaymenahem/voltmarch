/**
 * Combat — targeting, weapons, projectiles, damage, death.
 *
 * Everything here is pure simulation: no GL, no THREE, no DOM. The four
 * subsystems are constructed against a bare `World` + `Channels` and driven
 * through the same phase order the registry would use, so these tests exercise
 * the real integration and not a mock of it.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { World } from '../src/core/world';
import { Channels } from '../src/core/events';
import { Rng } from '../src/core/math';
import {
  ArmorClass, EntityFlag, EntityKind, Faction, FxKind, Locomotor, ProjectileKind,
  Stance, UnitState, WarheadClass,
} from '../src/core/types';
import type { EntityId, PlayerId, SimContext } from '../src/core/types';
import {
  ARMOR_MATRIX, BURN_HP_THRESHOLD, COMBAT_DAMAGE, SIM_DT, VETERANCY_KILLS, MAX_PROJECTILES,
} from '../src/core/config';
import {
  BUILDING_RUBBLE_DEF, VEHICLE_WRECK_DEF, vehicleWreckDefForRadius,
} from '../src/core/wrecks';

import {
  DamageSystem, armorMultiplier, estimatedHeight, hitRadius, setArmorMatrix,
} from '../src/sim/Damage';
import { ProjectileSystem } from '../src/sim/Projectiles';
import {
  DEFAULT_WEAPONS, WeaponSystem, setContentWeaponMap, setWeaponKeyResolver,
  weaponIndexOf,
} from '../src/sim/Combat';
import { TargetingSystem } from '../src/sim/Targeting';

/* -------------------------------------------------------------------------- */
/* Rig                                                                        */
/* -------------------------------------------------------------------------- */

interface Rig {
  world: World;
  channels: Channels;
  projectiles: ProjectileSystem;
  damage: DamageSystem;
  weapons: WeaponSystem;
  targeting: TargetingSystem;
  tick: number;
  step(n?: number): void;
  ctx(): SimContext;
}

const P0 = 0 as PlayerId;
const P1 = 1 as PlayerId;

function makeRig(seed = 7): Rig {
  // No content bindings in the unit tests: every entity gets an explicit
  // `weaponIndex`, so the heuristic path never runs and the assertions are
  // about combat, not about guessing.
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

  const rig: Rig = {
    world, channels, projectiles, damage, weapons, targeting,
    tick: 0,
    ctx(): SimContext {
      return { dt: SIM_DT, tick: rig.tick, time: rig.tick * SIM_DT, rng };
    },
    step(n = 1): void {
      for (let k = 0; k < n; k++) {
        rig.tick++;
        world.store.snapshotPrev();
        world.tick = rig.tick;
        world.time = rig.tick * SIM_DT;
        const s = rig.ctx();
        world.spatial.rebuild();          // Phase.SpatialRebuild
        targeting.tick(s);                // Phase.Targeting
        weapons.tick(s);                  // Phase.Weapons
        projectiles.tick(s);              // Phase.Projectiles
        damage.damageTick(s);             // Phase.Damage
        damage.cleanupTick(s);            // Phase.Cleanup
        channels.damage.clear();
        channels.fx.clear();
      }
    },
  };
  return rig;
}

interface SpawnOpts {
  kind?: EntityKind;
  hp?: number;
  armor?: ArmorClass;
  weapon?: number;
  yaw?: number;
  radius?: number;
  turretTurnRate?: number;
  flags?: number;
  footprint?: number;
}

function spawn(rig: Rig, player: PlayerId, x: number, z: number, o: SpawnOpts = {}): EntityId {
  const st = rig.world.store;
  const kind = o.kind ?? EntityKind.Vehicle;
  const faction = player === P0 ? Faction.Allies : Faction.Soviets;
  const h = st.alloc(kind, -1, player, faction, x, 0, z, o.yaw ?? 0);
  const i = st.index(h);
  st.maxHp[i] = o.hp ?? 400;
  st.hp[i] = o.hp ?? 400;
  st.armorClass[i] = o.armor ?? ArmorClass.Medium;
  st.radius[i] = o.radius ?? 2.0;
  st.sight[i] = 30;
  st.weaponIndex[i] = o.weapon ?? -1;
  st.locomotor[i] = kind === EntityKind.Building ? Locomotor.Static : Locomotor.Track;
  st.state[i] = UnitState.Idle;
  st.stance[i] = Stance.Aggressive;
  st.turretTurnRate[i] = o.turretTurnRate ?? 0;
  if (o.footprint !== undefined) { st.footprintW[i] = o.footprint; st.footprintH[i] = o.footprint; }
  let flags = EntityFlag.ProvidesVision | (o.flags ?? 0);
  if ((o.weapon ?? -1) >= 0) flags |= EntityFlag.CanAttack | EntityFlag.HasTurret;
  st.flags[i] |= flags;
  return h;
}

/**
 * Hand a unit its target directly. Acquisition is round-robin sliced over
 * TARGETING_SLICE ticks by design, so a test that wants to measure the FIRING
 * cycle must not also be measuring the acquisition delay. Targeting re-validates
 * this every tick and will drop it the moment it stops being legal.
 */
function aimAt(rig: Rig, shooter: EntityId, target: EntityId): void {
  rig.world.store.targetId[rig.world.store.index(shooter)] = target as number;
}

const W_LIGHT_CANNON = weaponIndexOf('lightCannon');
const W_RIFLE = weaponIndexOf('rifle');
const W_ARTILLERY = weaponIndexOf('artillery');
const W_PRISM = weaponIndexOf('prismBeam');
const W_TESLA = weaponIndexOf('teslaBolt');

/* -------------------------------------------------------------------------- */

describe('armour matrix', () => {
  it('is 7 warheads x 6 armours', () => {
    expect(ARMOR_MATRIX.length).toBe(7);
    for (const row of ARMOR_MATRIX) expect(row.length).toBe(6);
  });

  it('encodes the counter-triangle: rifles shred flesh and bounce off heavies', () => {
    const vsInfantry = armorMultiplier(WarheadClass.SmallArms, ArmorClass.Infantry);
    const vsHeavy = armorMultiplier(WarheadClass.SmallArms, ArmorClass.Heavy);
    expect(vsInfantry).toBeGreaterThan(0.9);
    expect(vsHeavy).toBeLessThan(0.2);
    // AP is the answer to armour and a waste on infantry.
    expect(armorMultiplier(WarheadClass.ArmorPiercing, ArmorClass.Heavy)).toBeGreaterThan(0.9);
    expect(armorMultiplier(WarheadClass.ArmorPiercing, ArmorClass.Infantry)).toBeLessThan(0.5);
    // HE is the building killer.
    expect(armorMultiplier(WarheadClass.HighExplosive, ArmorClass.Concrete))
      .toBeGreaterThan(armorMultiplier(WarheadClass.ArmorPiercing, ArmorClass.Concrete));
    // Tesla deletes infantry.
    expect(armorMultiplier(WarheadClass.Tesla, ArmorClass.Infantry)).toBeGreaterThan(1);
  });

  it('refuses a malformed table rather than producing NaN damage', () => {
    expect(setArmorMatrix([[1, 1, 1]])).toBe(false);
    expect(setArmorMatrix(ARMOR_MATRIX)).toBe(true);
    expect(armorMultiplier(WarheadClass.SmallArms, ArmorClass.Infantry)).toBe(1);
  });
});

describe('damage application', () => {
  let rig: Rig;
  beforeEach(() => { rig = makeRig(); });

  it('scales raw damage through the matrix and emits entity:damaged once', () => {
    const victim = spawn(rig, P1, 100, 100, { hp: 500, armor: ArmorClass.Heavy });
    let seen = 0;
    let amount = 0;
    rig.channels.events.on('entity:damaged', (e) => { seen++; amount = e.amount; });

    rig.channels.damage.push(victim, 0 as EntityId, 100, WarheadClass.SmallArms, 100, 0, 100);
    rig.world.spatial.rebuild();
    rig.damage.damageTick(rig.ctx());

    expect(seen).toBe(1);
    // The matrix is not the whole formula. `COMBAT_DAMAGE.globalMul` — the
    // time-to-kill knob — is applied in `applyOne` alongside the armour
    // multiplier, so an assertion that omits it is asserting a formula the
    // game does not use, and would fail the moment anyone tunes the pace.
    expect(amount).toBeCloseTo(
      100 * armorMultiplier(WarheadClass.SmallArms, ArmorClass.Heavy) * COMBAT_DAMAGE.globalMul,
      4,
    );
    expect(rig.world.store.hp[rig.world.store.index(victim)]).toBeCloseTo(500 - amount, 4);
  });

  it('splash falls off with distance and reaches a building by its wall', () => {
    const near = spawn(rig, P1, 100, 100, { hp: 2000 });
    const far = spawn(rig, P1, 106, 100, { hp: 2000 });
    const base = spawn(rig, P1, 120, 100, {
      kind: EntityKind.Building, hp: 4000, armor: ArmorClass.Concrete, footprint: 3, radius: 6,
    });
    rig.world.spatial.rebuild();

    rig.channels.damage.push(
      0 as EntityId, 0 as EntityId, 200, WarheadClass.HighExplosive,
      100, 0, 100, 12, 0.2,
    );
    rig.damage.damageTick(rig.ctx());

    const st = rig.world.store;
    const dNear = 2000 - st.hp[st.index(near)];
    const dFar = 2000 - st.hp[st.index(far)];
    const dBase = 4000 - st.hp[st.index(base)];
    expect(dNear).toBeGreaterThan(dFar);
    expect(dFar).toBeGreaterThan(0);
    // The Construction Yard's CENTRE is 20 m away — outside the 12 m blast —
    // but its wall is not, and `queryCircleFat` is what makes that true.
    expect(hitRadius(3, 3, 6)).toBeGreaterThan(8);
    expect(dBase).toBeGreaterThan(0);
  });

  it('halves splash on friendlies but never zeroes it', () => {
    const enemy = spawn(rig, P1, 100, 100, { hp: 2000 });
    const friend = spawn(rig, P0, 100, 100, { hp: 2000 });
    const attacker = spawn(rig, P0, 140, 140, { hp: 2000 });
    rig.world.spatial.rebuild();

    rig.channels.damage.push(
      0 as EntityId, attacker, 200, WarheadClass.HighExplosive, 100, 0, 100, 6, 0.2,
    );
    rig.damage.damageTick(rig.ctx());

    const st = rig.world.store;
    const dEnemy = 2000 - st.hp[st.index(enemy)];
    const dFriend = 2000 - st.hp[st.index(friend)];
    expect(dFriend).toBeGreaterThan(0);
    expect(dFriend).toBeCloseTo(dEnemy * COMBAT_DAMAGE.friendlyFireMul, 3);
  });

  it('leaves a structure under construction alone', () => {
    const site = spawn(rig, P1, 100, 100, {
      kind: EntityKind.Building, hp: 1000, armor: ArmorClass.Concrete, footprint: 2,
      flags: EntityFlag.UnderConstruction,
    });
    rig.world.spatial.rebuild();
    rig.channels.damage.push(site, 0 as EntityId, 5000, WarheadClass.HighExplosive, 100, 0, 100);
    rig.damage.damageTick(rig.ctx());
    expect(rig.world.store.hp[rig.world.store.index(site)]).toBe(1000);
  });
});

describe('death, wrecks and veterancy', () => {
  let rig: Rig;
  beforeEach(() => { rig = makeRig(); });

  it('emits entity:killed exactly once and leaves a burning hulk', () => {
    const victim = spawn(rig, P1, 100, 100, { hp: 50 });
    let killed = 0;
    rig.channels.events.on('entity:killed', () => { killed++; });

    rig.world.spatial.rebuild();
    rig.channels.damage.push(victim, 0 as EntityId, 500, WarheadClass.ArmorPiercing, 100, 0, 100);
    rig.damage.damageTick(rig.ctx());
    expect(rig.world.store.isPendingDestroy(victim)).toBe(true);

    rig.damage.cleanupTick(rig.ctx());
    expect(killed).toBe(1);
    expect(rig.world.store.isAlive(victim)).toBe(false);

    const wrecks = rig.world.store.byKindCount[EntityKind.Wreck];
    expect(wrecks).toBe(1);
    const wi = rig.world.store.byKind[EntityKind.Wreck][0];
    expect(rig.world.store.defId[wi]).toBe(vehicleWreckDefForRadius(2));
    expect(rig.world.store.defId[wi]).toBe(VEHICLE_WRECK_DEF.light);
    expect(rig.world.store.flags[wi] & EntityFlag.Burning).toBeTruthy();
    expect(rig.world.store.flags[wi] & EntityFlag.NotATarget).toBeTruthy();
  });

  it('CLEARS Burning when healed back over the threshold — it is a flag, not a sentence', () => {
    // The `if` that sets this flag had no `else` for the whole life of the file,
    // while its own comment claimed "it is recomputed from health every hit, so
    // a repaired unit stops burning without anyone having to remember".
    //
    // Nothing cleared it, so anything that once dipped under the threshold
    // burned at BURN_DPS until it died, with nobody attacking it. Repairing to
    // full stopped the PARTICLES (those are health-driven) but left the flag,
    // so it caught fire again minutes later. That was the user's
    // "building keeps burning even after war is finished" — and because the
    // burn tick re-stamps lastHitTime, it also blocked Regen and kept
    // entity:damaged firing, so the combat music never drained either.
    const victim = spawn(rig, P1, 120, 120, { hp: 100 });
    const i = rig.world.store.index(victim);
    const st = rig.world.store;
    st.maxHp[i] = 100;
    rig.world.spatial.rebuild();

    /*
     * Knock it under the burn threshold — with the raw damage DERIVED from the
     * threshold rather than hard-coded.
     *
     * This was a literal 80, which crossed the line only because of what the
     * armour matrix and `COMBAT_DAMAGE.globalMul` happened to be that day. The
     * first time the time-to-kill knob was tuned, 80 stopped crossing and this
     * test failed on its SETUP — reporting "should be burning under the
     * threshold" for a test that is about the CLEAR path and had nothing to
     * say about the change. Ask for enough damage to land at half the
     * threshold and the setup stays true at any pace.
     */
    const perPoint = armorMultiplier(WarheadClass.ArmorPiercing, st.armorClass[i] as ArmorClass)
      * COMBAT_DAMAGE.globalMul;
    const raw = (100 * (1 - BURN_HP_THRESHOLD / 2)) / perPoint;
    rig.channels.damage.push(victim, 0 as EntityId, raw, WarheadClass.ArmorPiercing, 120, 0, 120);
    rig.damage.damageTick(rig.ctx());
    expect(st.isAlive(victim)).toBe(true);
    expect(st.flags[i] & EntityFlag.Burning, 'should be burning under the threshold').toBeTruthy();

    // Repair it — the wrench is the player's escape hatch and must actually work.
    st.hp[i] = st.maxHp[i];
    // Any subsequent damage event re-evaluates the flag. A scratch is enough.
    rig.channels.damage.push(victim, 0 as EntityId, 1, WarheadClass.ArmorPiercing, 120, 0, 120);
    rig.damage.damageTick(rig.ctx());

    expect(st.isAlive(victim)).toBe(true);
    expect(
      st.flags[i] & EntityFlag.Burning,
      'a repaired entity must stop burning, or it burns down on its own',
    ).toBeFalsy();
  });

  it('ages the hulk out after COMBAT_DAMAGE.wreckSeconds', () => {
    const victim = spawn(rig, P1, 100, 100, { hp: 10 });
    rig.world.spatial.rebuild();
    rig.channels.damage.push(victim, 0 as EntityId, 500, WarheadClass.ArmorPiercing, 100, 0, 100);
    rig.damage.damageTick(rig.ctx());
    rig.damage.cleanupTick(rig.ctx());
    expect(rig.world.store.byKindCount[EntityKind.Wreck]).toBe(1);

    const ticks = Math.ceil(COMBAT_DAMAGE.wreckSeconds / SIM_DT) + 2;
    for (let k = 0; k < ticks; k++) {
      rig.tick++;
      rig.damage.cleanupTick(rig.ctx());
    }
    expect(rig.world.store.byKindCount[EntityKind.Wreck]).toBe(0);
  });

  it('a structure leaves persistent, non-blocking faction rubble', () => {
    const base = spawn(rig, P1, 100, 100, {
      kind: EntityKind.Building, hp: 20, armor: ArmorClass.Concrete, footprint: 3,
    });
    rig.world.spatial.rebuild();
    rig.channels.damage.push(base, 0 as EntityId, 900, WarheadClass.HighExplosive, 100, 0, 100);
    rig.damage.damageTick(rig.ctx());
    rig.damage.cleanupTick(rig.ctx());
    expect(rig.world.store.byKindCount[EntityKind.Wreck]).toBe(1);
    const rubble = rig.world.store.byKind[EntityKind.Wreck][0];
    expect(rig.world.store.defId[rubble]).toBe(BUILDING_RUBBLE_DEF.large);
    expect(rig.world.store.flags[rubble] & EntityFlag.NotATarget).toBeTruthy();
    expect(rig.world.store.isAlive(base)).toBe(false);

    // Vehicle hulks time out at 26 seconds; ruins are battlefield history and
    // remain until salvaged or covered by a new foundation.
    const ticks = Math.ceil(COMBAT_DAMAGE.wreckSeconds / SIM_DT) + 2;
    for (let k = 0; k < ticks; k++) {
      rig.tick++;
      rig.damage.cleanupTick(rig.ctx());
    }
    expect(rig.world.store.byKindCount[EntityKind.Wreck]).toBe(1);
    expect(rig.world.store.flags[rubble] & EntityFlag.Burning).toBeFalsy();
  });

  it('promotes a killer at VETERANCY_KILLS[0] and raises its max HP', () => {
    const killer = spawn(rig, P0, 100, 100, { hp: 400, weapon: W_LIGHT_CANNON });
    const st = rig.world.store;
    const ki = st.index(killer);
    const baseMax = st.maxHp[ki];
    let promoted = -1;
    rig.channels.events.on('entity:veterancy', (e) => { promoted = e.rank; });

    for (let k = 0; k < VETERANCY_KILLS[0]; k++) {
      const victim = spawn(rig, P1, 140 + k, 140, { hp: 10 });
      rig.world.spatial.rebuild();
      rig.channels.damage.push(victim, killer, 500, WarheadClass.ArmorPiercing, 140 + k, 0, 140);
      rig.damage.damageTick(rig.ctx());
      rig.damage.cleanupTick(rig.ctx());
      rig.tick++;
    }
    expect(st.killCount[ki]).toBe(VETERANCY_KILLS[0]);
    expect(st.veterancy[ki]).toBe(1);
    expect(promoted).toBe(1);
    expect(st.flags[ki] & EntityFlag.Veteran1).toBeTruthy();
    expect(st.maxHp[ki]).toBeGreaterThan(baseMax);
  });

  it('gives no kill credit for killing an ally', () => {
    const killer = spawn(rig, P0, 100, 100, { weapon: W_LIGHT_CANNON });
    const friend = spawn(rig, P0, 110, 100, { hp: 10 });
    rig.world.spatial.rebuild();
    rig.channels.damage.push(friend, killer, 500, WarheadClass.ArmorPiercing, 110, 0, 100);
    rig.damage.damageTick(rig.ctx());
    expect(rig.world.store.killCount[rig.world.store.index(killer)]).toBe(0);
  });
});

describe('targeting', () => {
  let rig: Rig;
  beforeEach(() => { rig = makeRig(); });

  it('acquires a hostile in range and ignores allies', () => {
    const me = spawn(rig, P0, 100, 100, { weapon: W_LIGHT_CANNON, yaw: Math.PI / 2 });
    const ally = spawn(rig, P0, 104, 100);
    const foe = spawn(rig, P1, 112, 100);
    rig.world.spatial.rebuild();
    rig.targeting.tick(rig.ctx());

    const st = rig.world.store;
    expect(st.targetId[st.index(me)]).toBe(foe as number);
    expect(st.targetId[st.index(me)]).not.toBe(ally as number);
  });

  it('never picks something outside weapon range', () => {
    const me = spawn(rig, P0, 100, 100, { weapon: W_LIGHT_CANNON });
    spawn(rig, P1, 100, 200);
    rig.world.spatial.rebuild();
    rig.targeting.tick(rig.ctx());
    expect(rig.world.store.targetId[rig.world.store.index(me)]).toBe(0);
  });

  it('persists: a marginally closer newcomer does not steal the lock', () => {
    const me = spawn(rig, P0, 100, 100, { weapon: W_LIGHT_CANNON });
    const first = spawn(rig, P1, 112, 100);
    rig.world.spatial.rebuild();
    // Run enough ticks that every slice offset has come round.
    for (let k = 0; k < 12; k++) { rig.tick++; rig.targeting.tick(rig.ctx()); }
    const st = rig.world.store;
    expect(st.targetId[st.index(me)]).toBe(first as number);

    // A newcomer 1 m closer. `stickiness` (1.35) must beat a ~9% distance edge.
    spawn(rig, P1, 111, 100);
    rig.world.spatial.rebuild();
    for (let k = 0; k < 12; k++) { rig.tick++; rig.targeting.tick(rig.ctx()); }
    expect(st.targetId[st.index(me)]).toBe(first as number);
  });

  it('drops a dead target and reacquires in the same tick', () => {
    const me = spawn(rig, P0, 100, 100, { weapon: W_LIGHT_CANNON });
    const a = spawn(rig, P1, 110, 100);
    const b = spawn(rig, P1, 116, 100);
    rig.world.spatial.rebuild();
    for (let k = 0; k < 12; k++) { rig.tick++; rig.targeting.tick(rig.ctx()); }
    const st = rig.world.store;
    expect(st.targetId[st.index(me)]).toBe(a as number);

    st.markDead(a);
    st.flushDestroyed();
    rig.world.spatial.rebuild();
    rig.tick++;
    rig.targeting.tick(rig.ctx());
    // Not "no target for eight ticks" — the reacquire is immediate.
    expect(st.targetId[st.index(me)]).toBe(b as number);
  });

  it('prefers an armed enemy over an unarmed one at the same distance', () => {
    const me = spawn(rig, P0, 100, 100, { weapon: W_LIGHT_CANNON });
    const truck = spawn(rig, P1, 100, 112);
    const tank = spawn(rig, P1, 112, 100, { weapon: W_LIGHT_CANNON });
    rig.world.spatial.rebuild();
    for (let k = 0; k < 12; k++) { rig.tick++; rig.targeting.tick(rig.ctx()); }
    const st = rig.world.store;
    expect(st.targetId[st.index(me)]).toBe(tank as number);
    expect(st.targetId[st.index(me)]).not.toBe(truck as number);
  });

  it('will not lock onto something its warhead cannot hurt', () => {
    const rifleman = spawn(rig, P0, 100, 100, {
      kind: EntityKind.Infantry, weapon: W_RIFLE, radius: 0.5,
    });
    // Only a Heavy in range: SmallArms scores 0.10 against it, below
    // `ineffectiveBelow`, but it is still the only thing there so it is taken.
    const heavy = spawn(rig, P1, 108, 100, { armor: ArmorClass.Heavy });
    rig.world.spatial.rebuild();
    for (let k = 0; k < 12; k++) { rig.tick++; rig.targeting.tick(rig.ctx()); }
    const st = rig.world.store;
    expect(st.targetId[st.index(rifleman)]).toBe(heavy as number);

    // Add a soft target further away; the penalty must flip the choice.
    const soft = spawn(rig, P1, 100, 115, { kind: EntityKind.Infantry, armor: ArmorClass.Infantry, radius: 0.5 });
    rig.world.spatial.rebuild();
    for (let k = 0; k < 12; k++) { rig.tick++; rig.targeting.tick(rig.ctx()); }
    expect(st.targetId[st.index(rifleman)]).toBe(soft as number);
  });
});

describe('weapons: traverse, burst, recoil', () => {
  let rig: Rig;
  beforeEach(() => { rig = makeRig(); });

  it('slews the turret toward the target independently of the hull yaw', () => {
    // Hull points north (+Z); the enemy is due east (+X).
    const me = spawn(rig, P0, 100, 100, { weapon: W_LIGHT_CANNON, yaw: 0, turretTurnRate: 1.0 });
    const foe = spawn(rig, P1, 115, 100);
    const st = rig.world.store;
    const hullYaw = st.yaw[st.index(me)];
    aimAt(rig, me, foe);

    rig.step(4);
    const i = st.index(me);
    expect(st.yaw[i]).toBe(hullYaw);                 // combat never touches yaw
    // 1.0 rad/s over four 1/30 s ticks. The gun has moved and the hull has not.
    expect(st.turretYaw[i]).toBeCloseTo(4 / 30, 4);
    expect(st.turretYaw[i]).toBeLessThan(Math.PI / 2);

    rig.step(60);
    expect(st.turretYaw[st.index(me)]).toBeCloseTo(Math.PI / 2, 2);
  });

  it('mirrors the hull for a turretless shooter', () => {
    const me = spawn(rig, P0, 100, 100, { weapon: W_RIFLE, yaw: 0.7 });
    const st = rig.world.store;
    st.flags[st.index(me)] &= ~EntityFlag.HasTurret;
    const foe = spawn(rig, P1, 100, 112);
    aimAt(rig, me, foe);
    rig.step(3);
    const i = st.index(me);
    expect(st.turretYaw[i]).toBeCloseTo(st.yaw[i], 6);
  });

  it('respects the cooldown and fires a burst at burstDelay', () => {
    const me = spawn(rig, P0, 100, 100, { weapon: W_RIFLE, yaw: Math.PI / 2, turretTurnRate: 12 });
    const foe = spawn(rig, P1, 110, 100, { hp: 5000 });
    aimAt(rig, me, foe);
    const rifle = DEFAULT_WEAPONS[W_RIFLE];
    expect(rifle.burstCount).toBe(3);

    rig.step(1);
    expect(rig.projectiles.shotsFired).toBe(1);
    const st = rig.world.store;
    // Mid-burst the cooldown is the SHORT one.
    expect(st.cooldown[st.index(me)]).toBeCloseTo(rifle.burstDelay, 5);
    expect(st.burstLeft[st.index(me)]).toBe(2);

    // Finish the burst, then verify the long cooldown gates the next one.
    rig.step(6);
    expect(rig.projectiles.shotsFired).toBe(3);
    expect(st.cooldown[st.index(me)]).toBeGreaterThan(rifle.burstDelay);
  });

  it('writes a recoil impulse on the shot and decays it back to zero', () => {
    const me = spawn(rig, P0, 100, 100, { weapon: W_LIGHT_CANNON, yaw: Math.PI / 2, turretTurnRate: 12 });
    const foe = spawn(rig, P1, 112, 100, { hp: 9000 });
    aimAt(rig, me, foe);
    const st = rig.world.store;
    rig.step(1);
    expect(st.recoil[st.index(me)]).toBeGreaterThan(0);
    rig.step(20);
    expect(st.recoil[st.index(me)]).toBe(0);
  });

  it('a requiresStop weapon holds fire while moving', () => {
    const me = spawn(rig, P0, 100, 100, { weapon: W_PRISM, yaw: Math.PI / 2, turretTurnRate: 12 });
    const foe = spawn(rig, P1, 112, 100, { hp: 9000 });
    aimAt(rig, me, foe);
    const st = rig.world.store;
    st.speed[st.index(me)] = 6;
    rig.step(6);
    // A prism beam is instant, so "held fire" means "target untouched".
    expect(st.hp[st.index(foe)]).toBe(9000);
    st.speed[st.index(me)] = 0;
    rig.step(2);
    expect(st.hp[st.index(foe)]).toBeLessThan(9000);
  });

  it('a HoldFire unit tracks but never shoots', () => {
    const me = spawn(rig, P0, 100, 100, { weapon: W_LIGHT_CANNON, yaw: Math.PI / 2, turretTurnRate: 12 });
    const foe = spawn(rig, P1, 112, 100, { hp: 9000 });
    const st = rig.world.store;
    st.stance[st.index(me)] = Stance.HoldFire;
    aimAt(rig, me, foe);
    rig.step(20);
    expect(rig.projectiles.shotsFired).toBe(0);
    expect(st.hp[st.index(foe)]).toBe(9000);
  });
});

describe('projectiles', () => {
  let rig: Rig;
  beforeEach(() => { rig = makeRig(); });

  it('a direct-fire round actually reaches and damages the target', () => {
    const me = spawn(rig, P0, 100, 100, { weapon: W_LIGHT_CANNON, yaw: Math.PI / 2, turretTurnRate: 12 });
    const foe = spawn(rig, P1, 112, 100, { hp: 5000, armor: ArmorClass.Medium });
    aimAt(rig, me, foe);
    const st = rig.world.store;
    rig.step(12);
    expect(rig.projectiles.shotsFired).toBeGreaterThan(0);
    expect(rig.projectiles.hits).toBeGreaterThan(0);
    expect(st.hp[st.index(foe)]).toBeLessThan(5000);
  });

  it('does not tunnel: a fast round covers 4 m per tick and still connects', () => {
    const cannon = DEFAULT_WEAPONS[W_LIGHT_CANNON];
    // The premise of the swept test: one tick of travel is wider than a hull.
    expect(cannon.projectileSpeed * SIM_DT).toBeGreaterThan(3);
    const me = spawn(rig, P0, 100, 100, { weapon: W_LIGHT_CANNON, yaw: Math.PI / 2, turretTurnRate: 12 });
    const foe = spawn(rig, P1, 118, 100, { hp: 5000, radius: 1.2 });
    aimAt(rig, me, foe);
    rig.step(14);
    expect(rig.world.store.hp[rig.world.store.index(foe)]).toBeLessThan(5000);
  });

  it('shells arc: an artillery round leaves the muzzle climbing', () => {
    const me = spawn(rig, P0, 100, 100, { weapon: W_ARTILLERY, yaw: Math.PI / 2, turretTurnRate: 12 });
    const foe = spawn(rig, P1, 140, 100, { hp: 9000 });
    aimAt(rig, me, foe);
    // Give the barrel time to elevate, then catch the shell in flight.
    for (let k = 0; k < 40 && rig.projectiles.liveCount === 0; k++) rig.step(1);
    expect(rig.projectiles.liveCount).toBeGreaterThan(0);
    const slot = rig.projectiles.liveSlot(0) as unknown as number;
    expect(rig.projectiles.kind[slot]).toBe(ProjectileKind.Shell);
    expect(rig.projectiles.vy[slot]).toBeGreaterThan(0);
  });

  it('an artillery round eventually lands and splashes', () => {
    const me = spawn(rig, P0, 100, 100, { weapon: W_ARTILLERY, yaw: Math.PI / 2, turretTurnRate: 12 });
    const foe = spawn(rig, P1, 140, 100, { hp: 9000, armor: ArmorClass.Light });
    aimAt(rig, me, foe);
    rig.step(180);
    expect(rig.world.store.hp[rig.world.store.index(foe)]).toBeLessThan(9000);
  });

  it('friendly units are transparent to a round in flight', () => {
    const me = spawn(rig, P0, 100, 100, { weapon: W_LIGHT_CANNON, yaw: Math.PI / 2, turretTurnRate: 12 });
    const friend = spawn(rig, P0, 106, 100, { hp: 5000 });
    const foe = spawn(rig, P1, 116, 100, { hp: 5000 });
    aimAt(rig, me, foe);
    rig.step(14);
    const st = rig.world.store;
    // The friend sits directly on the firing line and is untouched by the
    // round itself; only the impact splash may graze it.
    expect(st.hp[st.index(foe)]).toBeLessThan(5000);
    expect(st.hp[st.index(friend)]).toBe(5000);
  });

  it('never grows the pool: exhaustion is counted, not allocated', () => {
    expect(rig.projectiles.capacity).toBe(MAX_PROJECTILES);
    for (let k = 0; k < MAX_PROJECTILES + 8; k++) {
      rig.projectiles.spawn(
        ProjectileKind.Bullet, WarheadClass.SmallArms, 1, 0, 0,
        10, 2, 10, 0, 0, 1, 50,
        0 as EntityId, 0 as EntityId, P0, Faction.Allies,
        0, 0, 0,
      );
    }
    expect(rig.projectiles.liveCount).toBe(MAX_PROJECTILES);
    expect(rig.projectiles.spawnFailures).toBe(8);
    rig.projectiles.clear();
    expect(rig.projectiles.liveCount).toBe(0);
  });

  it('reads live projectiles into a caller-supplied buffer', () => {
    rig.projectiles.spawn(
      ProjectileKind.Bullet, WarheadClass.SmallArms, 1, 0, 0,
      11, 2, 12, 0, 0, 1, 50,
      0 as EntityId, 0 as EntityId, P0, Faction.Allies, 0, 0, 0,
    );
    const out = new Float32Array(64);
    expect(rig.projectiles.readLive(out)).toBe(1);
    expect(out[0]).toBeCloseTo(11, 5);
    expect(out[2]).toBeCloseTo(12, 5);
  });
});

describe('instant and chained weapons', () => {
  let rig: Rig;
  beforeEach(() => { rig = makeRig(); });

  it('a prism beam damages in the same tick it fires, with no projectile', () => {
    const me = spawn(rig, P0, 100, 100, { weapon: W_PRISM, yaw: Math.PI / 2, turretTurnRate: 12 });
    const foe = spawn(rig, P1, 112, 100, { hp: 5000, armor: ArmorClass.Medium });
    aimAt(rig, me, foe);
    rig.step(2);
    expect(rig.projectiles.shotsFired).toBe(0);
    expect(rig.world.store.hp[rig.world.store.index(foe)]).toBeLessThan(5000);
  });

  it('tesla chains to a second victim that was never targeted', () => {
    const coil = spawn(rig, P0, 100, 100, {
      kind: EntityKind.Building, weapon: W_TESLA, footprint: 2, radius: 4,
      yaw: Math.PI / 2, turretTurnRate: 12, hp: 700,
    });
    const primary = spawn(rig, P1, 118, 100, { hp: 5000, armor: ArmorClass.Light });
    const neighbour = spawn(rig, P1, 122, 100, { hp: 5000, armor: ArmorClass.Light });
    aimAt(rig, coil, primary);
    rig.step(3);
    const st = rig.world.store;
    expect(st.hp[st.index(primary)]).toBeLessThan(5000);
    expect(st.hp[st.index(neighbour)]).toBeLessThan(5000);
    // The chain link is weaker than the primary bolt.
    expect(5000 - st.hp[st.index(neighbour)]).toBeLessThan(5000 - st.hp[st.index(primary)]);
  });
});

describe('geometry helpers', () => {
  it('derives a plausible height for units and structures', () => {
    expect(estimatedHeight(0, 2.0, EntityKind.Vehicle)).toBeCloseTo(3.4, 5);
    expect(estimatedHeight(0, 0.5, EntityKind.Infantry)).toBeCloseTo(2.2, 5);
    expect(estimatedHeight(3, 6, EntityKind.Building)).toBeGreaterThan(10);
  });

  it('uses the footprint half-diagonal for a structure hit radius', () => {
    expect(hitRadius(0, 0, 2.5)).toBe(2.5);
    expect(hitRadius(2, 2, 1)).toBeCloseTo(Math.sqrt(4 * 4 + 4 * 4), 5);
  });
});

describe('determinism', () => {
  it('two identical runs produce byte-identical health', () => {
    function run(): number[] {
      const rig = makeRig(1234);
      spawn(rig, P0, 100, 100, { weapon: W_LIGHT_CANNON, yaw: Math.PI / 2, turretTurnRate: 2 });
      spawn(rig, P0, 100, 106, { weapon: W_RIFLE, yaw: Math.PI / 2, turretTurnRate: 2 });
      spawn(rig, P1, 118, 100, { hp: 600 });
      spawn(rig, P1, 118, 106, { hp: 600, weapon: W_LIGHT_CANNON, turretTurnRate: 2 });
      rig.step(120);
      const st = rig.world.store;
      const out: number[] = [];
      for (let a = 0; a < st.aliveCount; a++) out.push(st.hp[st.alive[a]]);
      return out;
    }
    expect(run()).toEqual(run());
  });
});

/* ==========================================================================
 * Death FX: the pushed size is a MULTIPLIER, not a length
 *
 * REGRESSION GUARD for the reported "whenever i destroy enemy buildings, the
 * entire ground around just looks black".
 *
 * `channels.fx.push` takes a DIMENSIONLESS size multiplier — `events.ts` calls
 * it "a size multiplier" and defaults it to 1 — and `vfx.system.ts` multiplies
 * it by its own per-kind base tank length (1.2 / 2.2 / 3.4 / 5.0). `Damage` was
 * pushing METRES instead: `buildingBlastMetres` (5.2) times a footprint clamp.
 *
 * For a 4x4 structure that asked for 5.0 * 8.67 = 43 tank lengths where
 * `spawnExplosion`'s own docstring says "structure death 5.0". The scorch
 * radius is linear in it, so a single death painted a roughly 162 x 276 m decal
 * on a 512 m map.
 *
 * Nothing anywhere asserted the units. That is why it shipped, and it is the
 * whole reason this block exists — the numbers below are deliberately wide
 * bands, because the defect was an order of magnitude, not a tuning drift.
 * ========================================================================== */

describe('death FX size is a multiplier, not a length', () => {
  /** The per-kind base tank lengths `vfx.system.ts` multiplies the scale by. */
  const BASE_TL = { building: 5.0, unit: 2.2 } as const;

  /**
   * Kill `victim` and leave `channels.fx` intact for inspection.
   *
   * Deliberately not `rig.step()`: step() ends by clearing `channels.fx`, which
   * is exactly the buffer under test.
   */
  function killLeavingFx(rig: Rig, victim: EntityId): void {
    rig.channels.damage.push(
      victim, 0 as EntityId, 99_999, WarheadClass.HighExplosive, 100, 0, 100,
    );
    const s = rig.ctx();
    rig.damage.damageTick(s);
    rig.damage.cleanupTick(s);
  }

  /** The tank-length size the vfx layer will actually ask `spawnExplosion` for. */
  function requestedTL(rig: Rig, want: FxKind, baseTL: number): number {
    const fx = rig.channels.fx;
    for (let i = 0; i < fx.count; i++) if (fx.kind[i] === want) return baseTL * fx.scale[i];
    throw new Error(`no fx of kind ${want} was pushed`);
  }

  it('a structure death asks for roughly the documented five tank lengths', () => {
    const rig = makeRig();
    const b = spawn(rig, P1, 100, 100, { kind: EntityKind.Building, hp: 100, footprint: 4 });
    killLeavingFx(rig, b);
    // Documented 5.0. The bug made this ~43.
    const tl = requestedTL(rig, FxKind.ExplosionBuilding, BASE_TL.building);
    expect(tl).toBeGreaterThan(3);
    expect(tl).toBeLessThan(12);
  });

  it('a vehicle death asks for roughly the documented 2.2 tank lengths', () => {
    const rig = makeRig();
    const v = spawn(rig, P1, 100, 100, { hp: 100 });
    killLeavingFx(rig, v);
    // Documented 2.2. The bug made this ~4.8 — the same error, smaller.
    const tl = requestedTL(rig, FxKind.ExplosionMedium, BASE_TL.unit);
    expect(tl).toBeGreaterThan(1);
    expect(tl).toBeLessThan(5);
  });

  it('scales with footprint, so a bigger building still makes a bigger bang', () => {
    // The fix must not flatten the size ramp into a constant.
    const small = makeRig();
    killLeavingFx(small, spawn(small, P1, 100, 100,
      { kind: EntityKind.Building, hp: 100, footprint: 2 }));
    const big = makeRig();
    killLeavingFx(big, spawn(big, P1, 100, 100,
      { kind: EntityKind.Building, hp: 100, footprint: 6 }));

    expect(requestedTL(big, FxKind.ExplosionBuilding, BASE_TL.building))
      .toBeGreaterThan(requestedTL(small, FxKind.ExplosionBuilding, BASE_TL.building));
  });

  it('never pushes a scale big enough to be a length', () => {
    // The tell, and the cheapest guard against the whole bug class: a
    // multiplier is O(1). A length in this game is O(10) — `buildingBlastMetres`
    // alone is 5.2 before the footprint clamp multiplies it. Nothing a death
    // pushes should approach that.
    const rig = makeRig();
    killLeavingFx(rig, spawn(rig, P1, 100, 100,
      { kind: EntityKind.Building, hp: 100, footprint: 6 }));
    const fx = rig.channels.fx;
    expect(fx.count).toBeGreaterThan(0);
    for (let i = 0; i < fx.count; i++) {
      expect(fx.scale[i]).toBeLessThan(COMBAT_DAMAGE.buildingBlastMetres);
    }
  });
});

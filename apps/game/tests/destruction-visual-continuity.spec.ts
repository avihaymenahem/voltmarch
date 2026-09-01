import { describe, expect, it } from 'vitest';

import { COMBAT_DAMAGE, SIM_DT } from '../src/core/config';
import { Channels } from '../src/core/events';
import { Rng } from '../src/core/math';
import {
  ArmorClass, DecalKind, EntityFlag, EntityKind, Faction, Locomotor,
  UnitState, WarheadClass,
} from '../src/core/types';
import type { EntityId, PlayerId, SimContext } from '../src/core/types';
import { World } from '../src/core/world';
import { DamageSystem, armorMultiplier } from '../src/sim/Damage';

interface DecalCall {
  kind: DecalKind;
  x: number;
  z: number;
  yaw: number;
  size: number;
}

interface Rig {
  world: World;
  channels: Channels;
  damage: DamageSystem;
  decals: DecalCall[];
  attacker: EntityId;
  building: EntityId;
  context: SimContext;
}

function rig(): Rig {
  const world = new World();
  const channels = new Channels();
  world.addPlayer(Faction.Allies, 'A', true, true);
  world.addPlayer(Faction.Soviets, 'B', false, false);
  const decals: DecalCall[] = [];
  world.vfx = {
    play(): void {},
    attach(): number { return -1; },
    detach(): void {},
    decal(kind, x, z, yaw, size): void { decals.push({ kind, x, z, yaw, size }); },
    shake(): void {},
    particleCount(): number { return 0; },
  };
  const attacker = world.store.alloc(
    EntityKind.Vehicle, -1, 0 as PlayerId, Faction.Allies, 30, 0, 10, 0,
  );
  const building = world.store.alloc(
    EntityKind.Building, -1, 1 as PlayerId, Faction.Soviets, 10, 0, 10, 0,
  );
  const i = world.store.index(building);
  world.store.maxHp[i] = 100;
  world.store.hp[i] = 100;
  world.store.armorClass[i] = ArmorClass.Concrete;
  world.store.footprintW[i] = 4;
  world.store.footprintH[i] = 2;
  world.store.radius[i] = 8;
  world.store.locomotor[i] = Locomotor.Static;
  world.store.state[i] = UnitState.Idle;
  const damage = new DamageSystem(world, channels);
  return {
    world, channels, damage, decals, attacker, building,
    context: { dt: SIM_DT, tick: 1, time: SIM_DT, rng: new Rng(7) },
  };
}

function rawDamageForLanded(landed: number): number {
  return landed / (
    armorMultiplier(WarheadClass.HighExplosive, ArmorClass.Concrete)
    * COMBAT_DAMAGE.globalMul
  );
}

function hit(r: Rig, landed: number, attacker = r.attacker): void {
  r.channels.damage.push(
    r.building, attacker, rawDamageForLanded(landed),
    WarheadClass.HighExplosive, 10, 0, 10,
  );
  r.damage.damageTick(r.context);
  r.channels.damage.clear();
}

describe('structure destruction visual continuity', () => {
  it('lays one attacker-facing scorch at the damage threshold and never repeats it', () => {
    const r = rig();
    hit(r, 55);
    expect(r.decals).toHaveLength(1);
    expect(r.decals[0].kind).toBe(DecalKind.Scorch);
    // Attacker is east of the 4x2 footprint, so the mark belongs on that wall.
    expect(r.decals[0].x).toBeGreaterThan(10);
    expect(r.decals[0].z).toBeCloseTo(10, 5);
    expect(r.decals[0].size).toBeGreaterThanOrEqual(1.1);
    expect(r.decals[0].size).toBeLessThanOrEqual(2.8);

    hit(r, 5);
    hit(r, 5);
    expect(r.decals, 'burn ticks and repeat hits must not churn the static decal ring').toHaveLength(1);
  });

  it('keeps the same story and pool cost through rubble replacement', () => {
    const r = rig();
    const st = r.world.store;
    const sourceSeed = st.seed[st.index(r.building)];
    hit(r, 55);
    const livingScorch = { ...r.decals[0] };
    hit(r, 500);
    r.damage.cleanupTick(r.context);

    expect(r.decals.map((d) => d.kind)).toEqual([DecalKind.Scorch, DecalKind.Rubble]);
    expect(r.decals[0]).toEqual(livingScorch);
    expect(r.decals[1].yaw).toBe(livingScorch.yaw);
    expect(st.byKindCount[EntityKind.Wreck]).toBe(1);
    const rubble = st.byKind[EntityKind.Wreck][0];
    expect(st.seed[rubble]).toBe(sourceSeed);
    expect(st.yaw[rubble]).toBeCloseTo(livingScorch.yaw, 6);
    expect(st.flags[rubble] & EntityFlag.Burning).toBeTruthy();
    expect(st.isAlive(r.building)).toBe(false);
  });

  it('retains the laid scar direction when another attacker lands the killing blow', () => {
    const r = rig();
    hit(r, 55);
    const livingScorch = { ...r.decals[0] };
    const westAttacker = r.world.store.alloc(
      EntityKind.Vehicle, -1, 0 as PlayerId, Faction.Allies, -10, 0, 10, 0,
    );

    hit(r, 500, westAttacker);
    r.damage.cleanupTick(r.context);

    expect(r.decals[0]).toEqual(livingScorch);
    expect(r.decals[1].yaw).toBe(livingScorch.yaw);
    const rubble = r.world.store.byKind[EntityKind.Wreck][0];
    expect(r.world.store.yaw[rubble]).toBeCloseTo(livingScorch.yaw, 6);
  });

  it('makes a one-shot and staged kill converge on identical persistent marks', () => {
    const staged = rig();
    hit(staged, 55);
    hit(staged, 500);
    staged.damage.cleanupTick(staged.context);

    const oneShot = rig();
    hit(oneShot, 500);
    oneShot.damage.cleanupTick(oneShot.context);
    expect(oneShot.decals).toEqual(staged.decals);
  });

  it('gives scripted deaths the deterministic seed fallback without another asset path', () => {
    const a = rig();
    a.world.store.markDead(a.building);
    a.damage.cleanupTick(a.context);
    const b = rig();
    b.world.store.markDead(b.building);
    b.damage.cleanupTick(b.context);

    expect(a.decals.map((d) => d.kind)).toEqual([DecalKind.Scorch, DecalKind.Rubble]);
    expect(a.decals).toEqual(b.decals);
    expect(a.decals.every((d) => Number.isFinite(d.x + d.z + d.yaw + d.size))).toBe(true);
  });
});
